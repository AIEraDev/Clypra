use std::net::UdpSocket;
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use super::TransferService;

/// Start UDP multicast for LocalSend v2 discovery.
///
/// Spawns two background tasks:
/// 1. **Announcer** – broadcasts this device's presence every 5 seconds.
/// 2. **Listener** – receives announcements from peers and updates
///    `discovered_devices`.
///
/// If the UDP socket cannot be bound (e.g. permission denied or port already
/// in use), a warning is logged and the function returns `Ok(())` so that the
/// HTTP server can still function without discovery.
pub fn start(service: std::sync::Arc<TransferService>) -> Result<(), String> {
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    let multicast_addr: Ipv4Addr = "224.0.0.167".parse().unwrap();
    let port = service.server_port;

    // ── Bind the announce socket ─────────────────────────────────────────────
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

    // ── Bind the listen socket ───────────────────────────────────────────────
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
        .set_read_timeout(Some(std::time::Duration::from_secs(2)))
        .ok();

    let multicast_target: SocketAddr = format!("{}:{}", multicast_addr, port).parse().unwrap();

    // ── Announcer task ───────────────────────────────────────────────────────
    let svc_ann = service.clone();
    std::thread::spawn(move || {
        while svc_ann.server_running.load(Ordering::Relaxed) {
            let payload = build_announcement(&svc_ann);
            if let Ok(bytes) = serde_json::to_vec(&payload) {
                if let Err(e) = announce_socket.send_to(&bytes, multicast_target) {
                    log::warn!("[Transfer/Discovery] Announce send error: {e}");
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
        log::debug!("[Transfer/Discovery] Announcer stopped.");
    });

    // ── Listener task ────────────────────────────────────────────────────────
    let svc_listen = service.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while svc_listen.server_running.load(Ordering::Relaxed) {
            match listen_socket.recv_from(&mut buf) {
                Ok((len, src)) => {
                    if let Ok(text) = std::str::from_utf8(&buf[..len]) {
                        handle_announcement(&svc_listen, text, src);
                    }
                }
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    // normal timeout – loop again to check server_running
                }
                Err(e) => {
                    log::warn!("[Transfer/Discovery] recv_from error: {e}");
                }
            }
        }
        log::debug!("[Transfer/Discovery] Listener stopped.");
    });

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn build_announcement(service: &TransferService) -> serde_json::Value {
    let info = &service.device_info;
    json!({
        "alias":       info.alias,
        "version":     info.version,
        "deviceModel": info.device_model,
        "deviceType":  info.device_type,
        "fingerprint": info.fingerprint,
        "port":        info.port,
        "protocol":    info.protocol,
        "download":    info.download,
        "announce":    true,
    })
}

fn handle_announcement(
    service: &TransferService,
    text: &str,
    src: std::net::SocketAddr,
) {
    use super::device::DiscoveredDevice;

    #[derive(serde::Deserialize)]
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

    let Ok(ann) = serde_json::from_str::<Announcement>(text) else {
        return;
    };

    // Skip ourselves
    if ann.fingerprint == service.device_info.fingerprint {
        return;
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
            alias: ann.alias,
            device_type: ann.device_type,
            ip,
            port: effective_port,
            fingerprint: ann.fingerprint,
            last_seen_secs: now,
        },
    );
}
