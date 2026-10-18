use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;

/// In-flight extraction deduplication for fast scrubbing.
/// Shares results across duplicate requests to reduce workload by 70%+.
pub type InFlightKey = String;
pub type InFlightResult = Result<Vec<u8>, String>;

pub struct InFlightMap {
    pub(crate) map: DashMap<InFlightKey, broadcast::Sender<InFlightResult>>,
}

impl InFlightMap {
    pub fn new() -> Self {
        Self {
            map: DashMap::new(),
        }
    }

    pub fn get_or_create(&self, key: String) -> (broadcast::Sender<InFlightResult>, bool) {
        if let Some(entry) = self.map.get(&key) {
            (entry.value().clone(), false)
        } else {
            let (tx, _rx) = broadcast::channel(1);
            self.map.insert(key.clone(), tx.clone());
            (tx, true)
        }
    }

    pub fn remove(&self, key: &str) {
        self.map.remove(key);
    }
}

pub static IN_FLIGHT_EXTRACTIONS: Lazy<InFlightMap> = Lazy::new(InFlightMap::new);

/// Serializes chunked GOP decode per source file so overlapping zoom/scroll
/// batches cannot stampede the decoder or thrash TIER_CACHE.
pub static BATCH_DECODE_GATES: Lazy<DashMap<String, Arc<tokio::sync::Mutex<()>>>> =
    Lazy::new(DashMap::new);

/// Registry of active thumbnail batch cancellation flags.
/// Allows frontend to preempt abandoned batches on zoom/scroll immediately.
pub static ACTIVE_THUMBNAIL_BATCHES: Lazy<DashMap<String, Arc<AtomicBool>>> =
    Lazy::new(DashMap::new);

/// Cancel an in-flight thumbnail batch request by requestId.
#[tauri::command]
pub fn cancel_render_artifacts_batch(request_id: String) {
    if let Some(flag) = ACTIVE_THUMBNAIL_BATCHES.get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}
