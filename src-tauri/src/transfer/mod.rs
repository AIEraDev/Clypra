pub mod device;
pub mod discovery;
pub mod server;
pub mod session;

pub use device::{DeviceInfo, DiscoveredDevice};
pub use session::{FileToken, IncomingFile, SessionState, TransferSession};

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::path::PathBuf;

use dashmap::DashMap;
use uuid::Uuid;

use tauri::AppHandle;

/// A local file staged on the desktop for peer download (via Web Hub or LocalSend).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedFile {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    pub size: u64,
    pub mime_type: String,
    pub created_at: u64,
}

/// Central state object for the phone-transfer service.
/// Stored in Tauri's managed state as `Arc<TransferService>`.
pub struct TransferService {
    /// Default port for both HTTP and UDP discovery.
    pub server_port: u16,
    /// Active/pending transfer sessions, keyed by session ID.
    pub sessions: Arc<DashMap<String, TransferSession>>,
    /// Files staged on desktop for phone/peer download.
    pub staged_files: Arc<DashMap<String, StagedFile>>,
    /// Devices seen via UDP multicast, keyed by fingerprint.
    pub discovered_devices: Arc<DashMap<String, DiscoveredDevice>>,
    /// Becomes `true` once the HTTP server is successfully bound.
    pub server_running: Arc<AtomicBool>,
    /// Oneshot senders waiting for user consent; key = session_id.
    pub consent_senders: Arc<DashMap<String, tokio::sync::oneshot::Sender<bool>>>,
    /// Per-file upload tokens; key = "{session_id}:{file_id}".
    pub file_tokens: Arc<DashMap<String, String>>,
    /// This device's LocalSend identity (alias, fingerprint, …).
    pub device_info: DeviceInfo,
    /// Active directory on disk where incoming files are saved.
    pub inbox_dir: Arc<parking_lot::RwLock<PathBuf>>,
    /// Theme colors for mobile web UI matching editor theme.
    pub theme_colors: Arc<parking_lot::RwLock<std::collections::HashMap<String, String>>>,
    /// The actual port that was successfully bound (may differ from
    /// `server_port` if there was a collision).
    pub bound_port: Arc<std::sync::Mutex<u16>>,
}

impl TransferService {
    pub fn new() -> Self {
        let port = 53317u16;
        let fingerprint = Uuid::new_v4().to_string();
        let mut default_theme = std::collections::HashMap::new();
        default_theme.insert("bg".to_string(), "#0b0e12".to_string());
        default_theme.insert("card".to_string(), "#12171d".to_string());
        default_theme.insert("cardInner".to_string(), "#1a2028".to_string());
        default_theme.insert("border".to_string(), "#27313b".to_string());
        default_theme.insert("accent".to_string(), "#5ab8d4".to_string());
        default_theme.insert("accentHover".to_string(), "#86cde0".to_string());
        default_theme.insert("text".to_string(), "#edf2f4".to_string());
        default_theme.insert("textMuted".to_string(), "#788991".to_string());
        default_theme.insert("danger".to_string(), "#e26061".to_string());
        default_theme.insert("success".to_string(), "#34d399".to_string());
        default_theme.insert("fontFamily".to_string(), "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif".to_string());
        default_theme.insert("fontFamilyName".to_string(), "system".to_string());

        Self {
            server_port: port,
            sessions: Arc::new(DashMap::new()),
            staged_files: Arc::new(DashMap::new()),
            discovered_devices: Arc::new(DashMap::new()),
            server_running: Arc::new(AtomicBool::new(false)),
            consent_senders: Arc::new(DashMap::new()),
            file_tokens: Arc::new(DashMap::new()),
            device_info: DeviceInfo::new(fingerprint, port),
            inbox_dir: Arc::new(parking_lot::RwLock::new(PathBuf::new())),
            theme_colors: Arc::new(parking_lot::RwLock::new(default_theme)),
            bound_port: Arc::new(std::sync::Mutex::new(port)),
        }
    }

    /// Gets the current save directory for incoming transfers.
    pub fn get_inbox_dir(&self) -> PathBuf {
        self.inbox_dir.read().clone()
    }

    /// Sets the save directory for incoming transfers.
    pub fn set_inbox_dir(&self, dir: PathBuf) {
        *self.inbox_dir.write() = dir;
    }

    /// Gets the current editor theme colors for mobile web UI.
    pub fn get_theme_colors(&self) -> std::collections::HashMap<String, String> {
        self.theme_colors.read().clone()
    }

    /// Sets the editor theme colors for mobile web UI.
    pub fn set_theme_colors(&self, colors: std::collections::HashMap<String, String>) {
        *self.theme_colors.write() = colors;
    }

    /// Start the HTTP server and UDP discovery socket.
    ///
    /// This is idempotent — if already running it returns immediately.
    pub async fn start(self: Arc<Self>, app_handle: AppHandle, inbox_dir: PathBuf) -> Result<(), String> {
        self.set_inbox_dir(inbox_dir);
        if self.server_running.load(Ordering::Relaxed) {
            return Ok(());
        }

        // Start HTTP server
        let bound = server::start(self.clone(), app_handle.clone()).await?;
        self.server_running.store(true, Ordering::Relaxed);

        // Update bound port in device_info (fingerprint + alias already set)
        if let Ok(mut p) = self.bound_port.lock() {
            *p = bound;
        }

        // Start UDP discovery (failures are logged, not propagated)
        discovery::start(self.clone())?;

        log::info!("[Transfer] Service started on port {bound}");
        Ok(())
    }

    /// Returns `true` if the HTTP server is currently running.
    pub fn is_running(&self) -> bool {
        self.server_running.load(Ordering::Relaxed)
    }

    /// Returns the bound port (may differ from `server_port`).
    pub fn get_bound_port(&self) -> u16 {
        self.bound_port.lock().map(|p| *p).unwrap_or(self.server_port)
    }
}
