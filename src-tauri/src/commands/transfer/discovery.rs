use crate::transfer::server::{generate_qr_svg, list_network_interfaces, NetworkInterfaceInfo};
use crate::transfer::DiscoveredDevice;
use tauri::AppHandle;

use super::helpers::{get_service, local_ip};

/// Returns `{ running, port, localIp }`.
#[tauri::command]
pub async fn get_transfer_service_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let service = get_service(&app)?;
    Ok(serde_json::json!({
        "running":  service.is_running(),
        "port":     service.get_bound_port(),
        "localIp":  local_ip(),
    }))
}

/// Returns the list of network interfaces and IP addresses on this machine.
#[tauri::command]
pub async fn get_network_interfaces(_app: AppHandle) -> Result<Vec<NetworkInterfaceInfo>, String> {
    Ok(list_network_interfaces())
}

/// Returns the list of devices discovered via UDP multicast or active subnet scan.
#[tauri::command]
pub async fn get_discovered_devices(app: AppHandle) -> Result<Vec<DiscoveredDevice>, String> {
    let service = get_service(&app)?;
    Ok(service
        .discovered_devices
        .iter()
        .map(|e| e.value().clone())
        .collect())
}

/// Triggers an active subnet scan to discover LocalSend nodes even if UDP multicast is blocked.
#[tauri::command]
pub async fn scan_local_network(app: AppHandle) -> Result<Vec<DiscoveredDevice>, String> {
    let service = get_service(&app)?;
    let ip = local_ip();
    if ip == "127.0.0.1" {
        return Ok(Vec::new());
    }

    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return Ok(Vec::new());
    }

    let subnet_prefix = format!("{}.{}.{}.", parts[0], parts[1], parts[2]);
    let bound_port = service.get_bound_port();
    let ports = if bound_port == 53317 {
        vec![53317, 53318]
    } else {
        vec![53317, bound_port]
    };

    let discovered =
        crate::transfer::discovery::scan_subnet(service.clone(), &subnet_prefix, &ports).await;
    Ok(discovered)
}

/// Returns a real standards-compliant SVG QR code string.
#[tauri::command]
pub async fn get_transfer_qr_code(
    app: AppHandle,
    custom_url: Option<String>,
) -> Result<String, String> {
    let service = get_service(&app)?;
    let url = match custom_url {
        Some(u) if !u.trim().is_empty() => u,
        _ => {
            let ip = local_ip();
            let port = service.get_bound_port();
            format!("http://{}:{}", ip, port)
        }
    };
    generate_qr_svg(&url)
}
