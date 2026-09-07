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

/// Central state object for the phone-transfer service.
/// Stored in Tauri's managed state as `Arc<TransferService>`.
pub struct TransferService {
    /// Default port for both HTTP and UDP discovery.
    pub server_port: u16,
    /// Active/pending transfer sessions, keyed by session ID.
    pub sessions: Arc<DashMap<String, TransferSession>>,
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
    /// The actual port that was successfully bound (may differ from
    /// `server_port` if there was a collision).
    pub bound_port: Arc<std::sync::Mutex<u16>>,
}

impl TransferService {
    pub fn new() -> Self {
        let port = 53317u16;
        let fingerprint = Uuid::new_v4().to_string();
        Self {
            server_port: port,
            sessions: Arc::new(DashMap::new()),
            discovered_devices: Arc::new(DashMap::new()),
            server_running: Arc::new(AtomicBool::new(false)),
            consent_senders: Arc::new(DashMap::new()),
            file_tokens: Arc::new(DashMap::new()),
            device_info: DeviceInfo::new(fingerprint, port),
            bound_port: Arc::new(std::sync::Mutex::new(port)),
        }
    }

    /// Start the HTTP server and UDP discovery socket.
    ///
    /// This is idempotent — if already running it returns immediately.
    pub async fn start(self: Arc<Self>, app_handle: AppHandle, inbox_dir: PathBuf) -> Result<(), String> {
        if self.server_running.load(Ordering::Relaxed) {
            return Ok(());
        }

        // Start HTTP server
        let bound = server::start(self.clone(), app_handle.clone(), inbox_dir).await?;
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
