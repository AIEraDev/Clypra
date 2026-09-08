use serde::{Deserialize, Serialize};

/// LocalSend v2 device info, advertised over UDP multicast and returned from
/// the `/api/localsend/v2/register` HTTP endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub alias: String,
    pub version: String,
    pub device_model: Option<String>,
    pub device_type: String,
    pub fingerprint: String,
    pub port: u16,
    pub protocol: String,
    /// Always `false` for LocalSend v2 receive-only desktop client.
    pub download: bool,
}

impl DeviceInfo {
    /// Build a `DeviceInfo` appropriate for the current OS, using the
    /// provided fingerprint (a random UUID generated once on startup).
    pub fn new(fingerprint: String, port: u16) -> Self {
        let (alias, device_model) = Self::os_info();
        Self {
            alias,
            version: "2.0".to_string(),
            device_model: Some(device_model),
            device_type: "desktop".to_string(),
            fingerprint,
            port,
            protocol: "http".to_string(),
            download: true,
        }
    }

    fn os_info() -> (String, String) {
        #[cfg(target_os = "macos")]
        return ("Clypra Desktop".to_string(), "Mac".to_string());

        #[cfg(target_os = "windows")]
        return ("Clypra Desktop".to_string(), "Windows".to_string());

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        return ("Clypra Desktop".to_string(), "Linux".to_string());
    }
}

/// A remote device discovered via UDP multicast or active polling.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    pub alias: String,
    pub device_type: Option<String>,
    pub ip: String,
    pub port: u16,
    pub fingerprint: String,
    /// Unix timestamp (seconds) of the last UDP announcement from this device.
    pub last_seen_secs: u64,
}
