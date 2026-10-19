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

/// Native control record for one filmstrip batch. Priority is native-owned:
/// JavaScript expresses demand, while Rust arbitrates decoder access.
pub struct ThumbnailBatchControl {
    pub cancelled: Arc<AtomicBool>,
    pub video_path: String,
    pub priority: u8,
}

/// Registry of active batch cancellation flags and priorities. A visible
/// viewport request can preempt same-source background work across JS lanes.
pub static ACTIVE_THUMBNAIL_BATCHES: Lazy<DashMap<String, Arc<ThumbnailBatchControl>>> =
    Lazy::new(DashMap::new);

pub fn register_thumbnail_batch(
    request_id: String,
    video_path: String,
    priority: u8,
    cancelled: Arc<AtomicBool>,
) {
    ACTIVE_THUMBNAIL_BATCHES.insert(
        request_id,
        Arc::new(ThumbnailBatchControl {
            cancelled,
            video_path,
            priority,
        }),
    );
}

/// Cancel active same-source batches below `priority`, returning the number
/// that transitioned from active to cancelled.
pub fn preempt_lower_priority_batches(video_path: &str, priority: u8) -> u64 {
    let mut preempted = 0;
    for entry in ACTIVE_THUMBNAIL_BATCHES.iter() {
        let batch = entry.value();
        if batch.video_path == video_path
            && batch.priority < priority
            && !batch.cancelled.swap(true, Ordering::Relaxed)
        {
            preempted += 1;
        }
    }
    preempted
}

/// P0 preview/scrub work wins over all preemptible filmstrip extraction for a
/// source. Preview owns a separate decoder pool, but this still releases
/// thumbnail CPU/IPC work that otherwise delays its response path.
pub fn preempt_filmstrip_for_preview(video_path: &str) -> u64 {
    preempt_lower_priority_batches(video_path, u8::MAX)
}

/// Cancel an in-flight thumbnail batch request by requestId.
#[tauri::command]
pub fn cancel_render_artifacts_batch(request_id: String) {
    if let Some(flag) = ACTIVE_THUMBNAIL_BATCHES.get(&request_id) {
        flag.cancelled.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_work_preempts_lower_priority_same_source_work() {
        let low_id = "filmstrip-governor-low".to_string();
        let other_id = "filmstrip-governor-other".to_string();
        let low_cancelled = Arc::new(AtomicBool::new(false));
        let other_cancelled = Arc::new(AtomicBool::new(false));

        register_thumbnail_batch(
            low_id.clone(),
            "source-a".to_string(),
            1,
            low_cancelled.clone(),
        );
        register_thumbnail_batch(
            other_id.clone(),
            "source-b".to_string(),
            1,
            other_cancelled.clone(),
        );

        preempt_lower_priority_batches("source-a", 10);

        assert!(low_cancelled.load(Ordering::Relaxed));
        assert!(!other_cancelled.load(Ordering::Relaxed));
        ACTIVE_THUMBNAIL_BATCHES.remove(&low_id);
        ACTIVE_THUMBNAIL_BATCHES.remove(&other_id);
    }

    #[test]
    fn preview_preempts_visible_filmstrip_work_for_the_same_source() {
        let id = "filmstrip-governor-preview".to_string();
        let cancelled = Arc::new(AtomicBool::new(false));
        register_thumbnail_batch(
            id.clone(),
            "preview-source".to_string(),
            10,
            cancelled.clone(),
        );

        assert_eq!(preempt_filmstrip_for_preview("preview-source"), 1);
        assert!(cancelled.load(Ordering::Relaxed));
        ACTIVE_THUMBNAIL_BATCHES.remove(&id);
    }
}
