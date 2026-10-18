use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use super::VideoDecoder;



pub(crate) fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// Wrapper to track last access time for LRU eviction without async mutex overhead
pub(crate) struct DecoderEntry {
    pub(crate) decoder: Arc<Mutex<VideoDecoder>>,
    pub(crate) last_accessed_ms: AtomicU64,
    /// Persistent playback leases pin the entry while the preview owns it.
    /// Filmstrip activity may evict only entries with a zero lease count.
    pub(crate) lease_count: AtomicU64,
}

impl DecoderEntry {
    pub(crate) fn touch(&self) {
        self.last_accessed_ms
            .store(current_timestamp_ms(), Ordering::Relaxed);
    }
}

/// An active-preview pin for one decoder pool entry.
///
/// The decoder mutex is still acquired only by the decode operation. Holding
/// this lease does not hold the mutex; it only prevents LRU eviction while a
/// persistent Native playback session is using the decoder.
pub struct PreviewDecoderLease {
    path: String,
    entry: Arc<DecoderEntry>,
}

impl PreviewDecoderLease {
    pub fn decoder(&self) -> Arc<Mutex<VideoDecoder>> {
        self.entry.touch();
        self.entry.decoder.clone()
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

impl Drop for PreviewDecoderLease {
    fn drop(&mut self) {
        self.entry.lease_count.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(crate) static THUMBNAIL_DECODER_POOL: Lazy<DashMap<String, Arc<DecoderEntry>>> =
    Lazy::new(DashMap::new);
pub(crate) static PREVIEW_DECODER_POOL: Lazy<DashMap<String, Arc<DecoderEntry>>> =
    Lazy::new(DashMap::new);

// Symmetric pool size limits with lock-free atomic LRU eviction
const MAX_THUMBNAIL_DECODER_POOL_SIZE: usize = 10;
const MAX_PREVIEW_DECODER_POOL_SIZE: usize = 8;
/// Keep one additional bounded decoder available for a large settled viewport.
/// Preview owns an entirely separate pool and is never counted here.
pub const MAX_FILMSTRIP_DECODER_SHARDS: usize = 2;

#[inline]
pub fn preview_pool_key(path: &str, stream_id: &str) -> String {
    if stream_id.trim().is_empty() {
        path.to_string()
    } else {
        format!("{path}::stream::{stream_id}")
    }
}

async fn get_or_create_decoder_entry_in_pool(
    pool: &DashMap<String, Arc<DecoderEntry>>,
    key: &str,
    path: &str,
    max_pool_size: usize,
    prefer_hardware: bool,
    purpose: &'static str,
) -> Result<Arc<DecoderEntry>, String> {
    // 1. Fast Path: Check if decoder exists in pool without holding shard lock across await
    if let Some(entry) = pool.get(key) {
        entry.touch();
        return Ok(entry.clone());
    }

    // 2. LRU Eviction: Collect candidates snapshot without holding locks across await
    if pool.len() >= max_pool_size {
        let oldest = pool
            .iter()
            .map(|kv| {
                (
                    kv.key().clone(),
                    kv.value().last_accessed_ms.load(Ordering::Relaxed),
                    kv.value().lease_count.load(Ordering::Acquire),
                )
            })
            .filter(|(_, _, leases)| *leases == 0)
            .min_by_key(|(_, ts, _)| *ts);

        if let Some((oldest_key, _, _)) = oldest {
            pool.remove(&oldest_key);
        }
    }

    // 3. Create new decoder with explicit purpose tag — performed outside any DashMap lock
    let decoder = VideoDecoder::open_with_purpose(path, prefer_hardware, Some(purpose))
        .map_err(|e| format!("Failed to open {}: {}", path, e))?;

    let arc_decoder = Arc::new(Mutex::new(decoder));
    let entry = Arc::new(DecoderEntry {
        decoder: arc_decoder.clone(),
        last_accessed_ms: AtomicU64::new(current_timestamp_ms()),
        lease_count: AtomicU64::new(0),
    });

    use dashmap::mapref::entry::Entry;
    let final_entry = match pool.entry(key.to_string()) {
        Entry::Occupied(occ) => {
            let existing = occ.get().clone();
            existing.touch();
            existing
        }
        Entry::Vacant(vac) => {
            vac.insert(entry.clone());
            entry
        }
    };

    Ok(final_entry)
}

async fn get_or_create_decoder_in_pool(
    pool: &DashMap<String, Arc<DecoderEntry>>,
    key: &str,
    path: &str,
    max_pool_size: usize,
    prefer_hardware: bool,
    purpose: &'static str,
) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    let entry = get_or_create_decoder_entry_in_pool(
        pool,
        key,
        path,
        max_pool_size,
        prefer_hardware,
        purpose,
    )
    .await?;
    Ok(entry.decoder.clone())
}

/// Thumbnail/Filmstrip background decoder pool (used for timeline thumbnail caching)
pub async fn get_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    get_filmstrip_decoder_shard(path, 0).await
}

/// A filmstrip shard gets an isolated decode cursor for the same source. This
/// is used only by a bounded P2 viewport batch; independent cursors prevent
/// distant timestamps from serially seeking one shared decoder.
pub async fn get_filmstrip_decoder_shard(
    path: &str,
    shard: usize,
) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    let shard = shard.min(MAX_FILMSTRIP_DECODER_SHARDS.saturating_sub(1));
    let key = format!("{path}::filmstrip-shard:{shard}");
    get_or_create_decoder_in_pool(
        &THUMBNAIL_DECODER_POOL,
        &key,
        path,
        MAX_THUMBNAIL_DECODER_POOL_SIZE,
        false,
        "filmstrip",
    )
    .await
}

/// Dedicated Interactive Preview & Playback decoder pool.
/// Completely decoupled from background filmstrip decoding so playback/playhead scrubbing
/// is NEVER blocked by background batch generation locks.
pub async fn get_preview_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    get_preview_decoder_for_stream(path, "").await
}

/// Dedicated stream-isolated Interactive Preview & Playback decoder.
/// Stacking multiple clips or tracks referencing the same or different video files
/// assigns each track/layer its own stream reader to prevent sequential GOP seek thrashing.
pub async fn get_preview_decoder_for_stream(
    path: &str,
    stream_id: &str,
) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    let key = preview_pool_key(path, stream_id);
    get_or_create_decoder_in_pool(
        &PREVIEW_DECODER_POOL,
        &key,
        path,
        MAX_PREVIEW_DECODER_POOL_SIZE,
        true,
        "preview",
    )
    .await
}

/// Acquire a persistent pin for a Native playback decoder.
pub async fn acquire_preview_decoder_lease(path: &str) -> Result<PreviewDecoderLease, String> {
    acquire_preview_decoder_lease_for_stream(path, "").await
}

/// Acquire a persistent stream-isolated pin for a Native playback decoder.
pub async fn acquire_preview_decoder_lease_for_stream(
    path: &str,
    stream_id: &str,
) -> Result<PreviewDecoderLease, String> {
    let key = preview_pool_key(path, stream_id);
    let entry = get_or_create_decoder_entry_in_pool(
        &PREVIEW_DECODER_POOL,
        &key,
        path,
        MAX_PREVIEW_DECODER_POOL_SIZE,
        true,
        "preview",
    )
    .await?;
    entry.lease_count.fetch_add(1, Ordering::AcqRel);
    entry.touch();
    Ok(PreviewDecoderLease {
        path: path.to_string(),
        entry,
    })
}

/// Call this when a clip is removed from the project to free memory
pub fn release_decoder(path: &str) {
    THUMBNAIL_DECODER_POOL.remove(path);
    let keys_to_remove: Vec<String> = PREVIEW_DECODER_POOL
        .iter()
        .filter(|kv| {
            (kv.key() == path || kv.key().starts_with(&format!("{path}::stream::")))
                && kv.value().lease_count.load(Ordering::Acquire) == 0
        })
        .map(|kv| kv.key().clone())
        .collect();
    for key in keys_to_remove {
        PREVIEW_DECODER_POOL.remove(&key);
    }
    crate::filmstrip_engine::stream_actor::release_all_preview_decoder_actors_for_path(path);
}

/// Release a specific stream-isolated decoder
pub fn release_decoder_stream(path: &str, stream_id: &str) {
    let key = preview_pool_key(path, stream_id);
    if PREVIEW_DECODER_POOL
        .get(&key)
        .map(|entry| entry.lease_count.load(Ordering::Acquire) == 0)
        .unwrap_or(false)
    {
        PREVIEW_DECODER_POOL.remove(&key);
    }
    crate::filmstrip_engine::stream_actor::release_preview_decoder_actor_for_stream(
        path, stream_id,
    );
}

