use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;

use super::device::DiscoveredDevice;
use super::server::unix_secs;
use super::TransferService;

/// Start UDP multicast for LocalSend v2 discovery.
///
/// Spawns two background tasks:
/// 1. **Announcer** – broadcasts this device's presence every 4 seconds.
/// 2. **Listener** – receives announcements from peers, updates `discovered_devices`,
///    and sends immediate direct unicast response back to bypass multicast drops.
pub fn start(service: Arc<TransferService>) -> Result<(), String> {
    let multicast_addr: Ipv4Addr = "224.0.0.167".parse().unwrap();
    let port = service.server_port;

    // Announce socket (sends multicast)
    let announce_socket = match UdpSocket::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0)) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[Transfer/Discovery] Cannot bind announce socket: {e}. Skipping UDP discovery.");
            return Ok(());
        }
    };
    if let Err(e) = announce_socket.set_broadcast(true) {
        log::warn!("[Transfer/Discovery] set_broadcast failed: {e}");
    }

    // Direct response socket (sends unicast back to discovering peers)
    let direct_socket = match UdpSocket::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0)) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            log::warn!("[Transfer/Discovery] Cannot bind direct response socket: {e}");
            Arc::new(announce_socket.try_clone().unwrap())
        }
    };

    // Listen socket (receives multicast and unicast packets on port)
    let listen_socket = match UdpSocket::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port)) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[Transfer/Discovery] Cannot bind listen socket on :{port}: {e}. Skipping UDP discovery.");
            return Ok(());
        }
    };
    if let Err(e) = listen_socket.join_multicast_v4(&multicast_addr, &Ipv4Addr::UNSPECIFIED) {
        log::warn!("[Transfer/Discovery] join_multicast_v4 failed: {e}");
    }
    listen_socket
        .set_read_timeout(Some(Duration::from_secs(2)))
        .ok();

    let multicast_target: SocketAddr = format!("{}:{}", multicast_addr, port).parse().unwrap();

    // ── Announcer task ───────────────────────────────────────────────────────
    let svc_ann = service.clone();
    std::thread::spawn(move || {
        while svc_ann.server_running.load(Ordering::Relaxed) {
            let payload = build_announcement(&svc_ann);
            if let Ok(bytes) = serde_json::to_vec(&payload) {
                if let Err(e) = announce_socket.send_to(&bytes, multicast_target) {
                    log::debug!("[Transfer/Discovery] Announce send error: {e}");
                }
            }
            std::thread::sleep(Duration::from_secs(4));
        }
        log::debug!("[Transfer/Discovery] Announcer stopped.");
    });

    // ── Listener task ────────────────────────────────────────────────────────
    let svc_listen = service.clone();
    let resp_sock = direct_socket.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while svc_listen.server_running.load(Ordering::Relaxed) {
            match listen_socket.recv_from(&mut buf) {
                Ok((len, src)) => {
                    if let Ok(text) = std::str::from_utf8(&buf[..len]) {
                        if let Some(peer_fingerprint) = handle_announcement(&svc_listen, text, src) {
                            // Send direct unicast response back to sender to guarantee visibility
                            let payload = build_announcement(&svc_listen);
                            if let Ok(resp_bytes) = serde_json::to_vec(&payload) {
                                let _ = resp_sock.send_to(&resp_bytes, src);
                            }
                            log::debug!("[Transfer/Discovery] Responded to peer {peer_fingerprint} at {src}");
                        }
                    }
                }
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    // Loop again
                }
                Err(e) => {
                    log::debug!("[Transfer/Discovery] recv_from error: {e}");
                }
            }
        }
        log::debug!("[Transfer/Discovery] Listener stopped.");
    });

    Ok(())
}

fn build_announcement(service: &TransferService) -> serde_json::Value {
    let info = &service.device_info;
    json!({
        "alias":       info.alias,
        "version":     info.version,
        "deviceModel": info.device_model,
        "deviceType":  info.device_type,
        "fingerprint": info.fingerprint,
        "port":        service.get_bound_port(),
        "protocol":    info.protocol,
        "download":    true,
        "announce":    true,
    })
}

fn handle_announcement(
    service: &TransferService,
    text: &str,
    src: SocketAddr,
) -> Option<String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Announcement {
        #[serde(default)]
        alias: String,
        #[serde(default)]
        device_type: Option<String>,
        #[serde(default)]
        fingerprint: String,
        #[serde(default)]
        port: u16,
    }

    let ann = serde_json::from_str::<Announcement>(text).ok()?;

    if ann.fingerprint.is_empty() || ann.fingerprint == service.device_info.fingerprint {
        return None;
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let ip = src.ip().to_string();
    let effective_port = if ann.port != 0 { ann.port } else { src.port() };

    service.discovered_devices.insert(
        ann.fingerprint.clone(),
        DiscoveredDevice {
            alias: if ann.alias.is_empty() { "Peer Device".to_string() } else { ann.alias },
            device_type: ann.device_type,
            ip,
            port: effective_port,
            fingerprint: ann.fingerprint.clone(),
            last_seen_secs: now,
        },
    );

    Some(ann.fingerprint)
}

// ── Active Subnet Scanner ────────────────────────────────────────────────────

/// Scan a `/24` subnet for LocalSend v2 nodes by polling `GET /api/localsend/v2/info`.
///
/// Runs up to 40 concurrent HTTP requests with a 1.2s timeout.
/// Populates `service.discovered_devices` for any responsive devices found.
pub async fn scan_subnet(
    service: Arc<TransferService>,
    subnet_prefix: &str,
    target_ports: &[u16],
) -> Vec<DiscoveredDevice> {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut tasks = Vec::new();
    for host in 1u8..=254 {
        let ip = format!("{}{}", subnet_prefix, host);
        for &port in target_ports {
            let cl = client.clone();
            let svc = service.clone();
            let ip_clone = ip.clone();

            tasks.push(async move {
                let url = format!("http://{}:{}/api/localsend/v2/info", ip_clone, port);
                let resp = cl.get(&url).send().await.ok()?;
                if !resp.status().is_success() {
                    return None;
                }

                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct PeerInfo {
                    alias: String,
                    #[serde(default)]
                    device_type: Option<String>,
                    fingerprint: String,
                    #[serde(default)]
                    port: Option<u16>,
                }

                let info = resp.json::<PeerInfo>().await.ok()?;
                if info.fingerprint.is_empty() || info.fingerprint == svc.device_info.fingerprint {
                    return None;
                }

                let effective_port = info.port.unwrap_or(port);
                let device = DiscoveredDevice {
                    alias: info.alias,
                    device_type: info.device_type,
                    ip: ip_clone,
                    port: effective_port,
                    fingerprint: info.fingerprint.clone(),
                    last_seen_secs: unix_secs(),
                };

                svc.discovered_devices.insert(info.fingerprint, device.clone());
                Some(device)
            });
        }
    }

    let stream = futures_util::stream::iter(tasks).buffer_unordered(40);
    let results: Vec<Option<DiscoveredDevice>> = stream.collect().await;

    results.into_iter().flatten().collect()
}
