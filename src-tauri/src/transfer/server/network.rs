use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::types::NetworkInterfaceInfo;

/// Enumerate all active IPv4 network interfaces on the system.
pub fn list_network_interfaces() -> Vec<NetworkInterfaceInfo> {
    let mut results = Vec::new();

    #[cfg(unix)]
    unsafe {
        let mut ifap: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut ifap) == 0 && !ifap.is_null() {
            let mut cur = ifap;
            while !cur.is_null() {
                let ifa = *cur;
                let flags = ifa.ifa_flags as i32;
                let is_up = (flags & libc::IFF_UP) != 0;
                let is_loopback = (flags & libc::IFF_LOOPBACK) != 0;
                let is_running = (flags & libc::IFF_RUNNING) != 0;

                if is_up && is_running && !is_loopback && !ifa.ifa_addr.is_null() {
                    let family = (*ifa.ifa_addr).sa_family as i32;
                    if family == libc::AF_INET {
                        let name = std::ffi::CStr::from_ptr(ifa.ifa_name)
                            .to_string_lossy()
                            .into_owned();
                        let sockaddr_in = ifa.ifa_addr as *const libc::sockaddr_in;
                        let ip_num = u32::from_be((*sockaddr_in).sin_addr.s_addr);
                        let ip = std::net::Ipv4Addr::from(ip_num);

                        if !ip.is_loopback() && !ip.is_link_local() {
                            let ip_str = ip.to_string();
                            if !results
                                .iter()
                                .any(|r: &NetworkInterfaceInfo| r.name == name && r.ip == ip_str)
                            {
                                results.push(NetworkInterfaceInfo {
                                    name,
                                    ip: ip_str,
                                    is_default: false,
                                });
                            }
                        }
                    }
                }
                cur = ifa.ifa_next;
            }
            libc::freeifaddrs(ifap);
        }
    }

    if results.is_empty() {
        let targets = [
            "8.8.8.8:80",
            "1.1.1.1:80",
            "192.168.1.1:80",
            "192.168.0.1:80",
            "10.0.0.1:80",
            "172.20.10.1:80",
            "192.168.43.1:80",
        ];
        for target in targets {
            if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
                if socket.connect(target).is_ok() {
                    if let Ok(local_addr) = socket.local_addr() {
                        let ip = local_addr.ip().to_string();
                        if ip != "127.0.0.1" && !ip.starts_with("169.254.") {
                            results.push(NetworkInterfaceInfo {
                                name: "lan".to_string(),
                                ip,
                                is_default: true,
                            });
                            break;
                        }
                    }
                }
            }
        }
    }

    let best_ip = select_best_lan_ip(&results);
    for item in &mut results {
        if item.ip == best_ip {
            item.is_default = true;
        }
    }

    results
}

pub fn select_best_lan_ip(interfaces: &[NetworkInterfaceInfo]) -> String {
    // 1. Prefer en0 (standard macOS WiFi/Ethernet) or wlan
    for iface in interfaces {
        if iface.name == "en0" || iface.name.starts_with("wlan") {
            return iface.ip.clone();
        }
    }
    // 2. Prefer 192.168.x.x
    for iface in interfaces {
        if iface.ip.starts_with("192.168.") {
            return iface.ip.clone();
        }
    }
    // 3. Prefer 10.x.x.x or 172.16..31.x.x (including hotspot 172.20.10.x)
    for iface in interfaces {
        if iface.ip.starts_with("10.") || iface.ip.starts_with("172.") {
            return iface.ip.clone();
        }
    }
    if let Some(first) = interfaces.first() {
        return first.ip.clone();
    }

    "127.0.0.1".to_string()
}

/// Returns the primary LAN IP address.
pub fn local_ip() -> String {
    let ifaces = list_network_interfaces();
    if let Some(def) = ifaces.iter().find(|i| i.is_default) {
        return def.ip.clone();
    }
    select_best_lan_ip(&ifaces)
}

/// Generates a real, standards-compliant QR Code as an SVG string.
pub fn generate_qr_svg(content: &str) -> Result<String, String> {
    use qrcode::render::svg;
    use qrcode::QrCode;

    let code = QrCode::new(content.as_bytes()).map_err(|e| e.to_string())?;
    let svg = code
        .render::<svg::Color>()
        .min_dimensions(240, 240)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(svg)
}

/// Generates a non-colliding file path inside `dir` for `file_name` by appending `(1)`, `(2)`, etc.
pub fn get_non_colliding_path(dir: &Path, file_name: &str) -> PathBuf {
    let base_path = dir.join(file_name);
    if !base_path.exists() {
        return base_path;
    }

    let p = Path::new(file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");

    for i in 1..10000 {
        let candidate = if ext.is_empty() {
            format!("{} ({})", stem, i)
        } else {
            format!("{} ({}).{}", stem, i, ext)
        };
        let candidate_path = dir.join(&candidate);
        if !candidate_path.exists() {
            return candidate_path;
        }
    }
    base_path
}

/// Unix timestamp helper
pub fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
