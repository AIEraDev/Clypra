use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::atomic_io::safe_delete_file;
use super::types::{
    CacheNamespace, DiskCacheEntry, IntegrityReport, PurgeFilter, PurgeResult, UnifiedCacheStats,
};

/// Default disk cache budget: 5 Gigabytes
pub const DEFAULT_DISK_CACHE_LIMIT_BYTES: u64 = 5 * 1024 * 1024 * 1024;

/// Global singleton instance for disk cache coordination across all Tauri commands
static GLOBAL_DISK_CACHE: Lazy<RwLock<Option<Arc<UnifiedDiskCacheManager>>>> =
    Lazy::new(|| RwLock::new(None));

pub struct UnifiedDiskCacheManager {
    root_dir: PathBuf,
    limit_bytes: AtomicU64,
    hit_count: AtomicU64,
    miss_count: AtomicU64,
    eviction_count: AtomicU64,
}

impl UnifiedDiskCacheManager {
    /// Create a new disk cache manager rooted at `root_dir` (typically `<AppCache>/clypra_cache`).
    pub fn new(root_dir: PathBuf) -> Self {
        Self {
            root_dir,
            limit_bytes: AtomicU64::new(DEFAULT_DISK_CACHE_LIMIT_BYTES),
            hit_count: AtomicU64::new(0),
            miss_count: AtomicU64::new(0),
            eviction_count: AtomicU64::new(0),
        }
    }

    /// Root directory of the unified disk cache.
    pub fn root_dir(&self) -> &Path {
        &self.root_dir
    }

    /// Set global disk cache limit in bytes (0 = unlimited).
    pub fn set_limit(&self, limit_bytes: u64) {
        self.limit_bytes.store(limit_bytes, Ordering::Relaxed);
    }

    /// Get current global disk cache limit in bytes.
    pub fn get_limit(&self) -> u64 {
        self.limit_bytes.load(Ordering::Relaxed)
    }

    /// Record a cache hit.
    pub fn record_hit(&self) {
        self.hit_count.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a cache miss.
    pub fn record_miss(&self) {
        self.miss_count.fetch_add(1, Ordering::Relaxed);
    }

    /// Resolve absolute path for an artifact in a specific namespace.
    /// Creates the namespace directory synchronously if missing.
    pub fn resolve_path(&self, namespace: CacheNamespace, filename: &str) -> PathBuf {
        let ns_dir = self.root_dir.join(namespace.as_str());
        if !ns_dir.exists() {
            let _ = std::fs::create_dir_all(&ns_dir);
        }
        ns_dir.join(filename)
    }

    /// Retrieve comprehensive live statistics across all namespaces.
    pub async fn get_stats(&self) -> UnifiedCacheStats {
        let limit_bytes = self.get_limit();
        let hit_count = self.hit_count.load(Ordering::Relaxed);
        let miss_count = self.miss_count.load(Ordering::Relaxed);
        let eviction_count = self.eviction_count.load(Ordering::Relaxed);

        let total_requests = hit_count + miss_count;
        let hit_rate_pct = if total_requests > 0 {
            (hit_count as f64 / total_requests as f64) * 100.0
        } else {
            0.0
        };

        let mut total_bytes: u64 = 0;
        let mut namespace_bytes: HashMap<String, u64> = HashMap::new();
        let mut namespace_counts: HashMap<String, usize> = HashMap::new();

        for &ns in CacheNamespace::all() {
            let ns_key = ns.as_str().to_string();
            let ns_dir = self.root_dir.join(ns.as_str());
            let mut ns_total: u64 = 0;
            let mut ns_count: usize = 0;

            if let Ok(mut entries) = tokio::fs::read_dir(&ns_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if let Ok(meta) = entry.metadata().await {
                        if meta.is_file() {
                            let len = meta.len();
                            ns_total += len;
                            ns_count += 1;
                        }
                    }
                }
            }

            total_bytes += ns_total;
            namespace_bytes.insert(ns_key.clone(), ns_total);
            namespace_counts.insert(ns_key, ns_count);
        }

        UnifiedCacheStats {
            total_bytes,
            limit_bytes,
            namespace_bytes,
            namespace_counts,
            hit_count,
            miss_count,
            hit_rate_pct,
            eviction_count,
            root_dir: self.root_dir.to_string_lossy().to_string(),
        }
    }

    /// Prune disk cache if current usage exceeds the configured limit.
    /// Employs priority-weighted LRU eviction to prune low-priority/old artifacts first.
    pub async fn prune_if_needed(&self) -> Result<u64, String> {
        let limit = self.get_limit();
        if limit == 0 {
            return Ok(0); // Unlimited
        }

        let stats = self.get_stats().await;
        if stats.total_bytes <= limit {
            return Ok(0);
        }

        // Target 90% of limit to provide hysteresis and avoid thrashing on successive writes
        let target_bytes = (limit as f64 * 0.90) as u64;
        let bytes_to_free = stats.total_bytes.saturating_sub(target_bytes);

        log::info!(
            "[UnifiedDiskCache] Pruning cache: total {} bytes exceeds limit {} bytes. Target free: {} bytes",
            stats.total_bytes,
            limit,
            bytes_to_free
        );

        let mut files: Vec<(DiskCacheEntry, f64)> = Vec::new();
        let now = std::time::SystemTime::now();

        for &ns in CacheNamespace::all() {
            let ns_dir = self.root_dir.join(ns.as_str());
            if let Ok(mut entries) = tokio::fs::read_dir(&ns_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if let Ok(meta) = entry.metadata().await {
                        if meta.is_file() {
                            let path = entry.path();
                            let size_bytes = meta.len();
                            let modified = meta.modified().unwrap_or(now);
                            let age_secs = now
                                .duration_since(modified)
                                .map(|d| d.as_secs_f64())
                                .unwrap_or(0.0);

                            // Score: higher score = higher priority to evict
                            // Age amplified by namespace eviction weight
                            let eviction_score = age_secs * ns.eviction_weight();

                            files.push((
                                DiskCacheEntry {
                                    path,
                                    namespace: ns,
                                    size_bytes,
                                    last_accessed_secs: age_secs as u64,
                                    created_secs: 0,
                                },
                                eviction_score,
                            ));
                        }
                    }
                }
            }
        }

        // Sort descending: highest eviction score first
        files.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut freed_bytes: u64 = 0;
        let mut evicted_files: u64 = 0;

        for (entry, _) in files {
            if freed_bytes >= bytes_to_free {
                break;
            }

            if let Ok(bytes) = safe_delete_file(&entry.path).await {
                freed_bytes += bytes;
                evicted_files += 1;
            }
        }

        self.eviction_count
            .fetch_add(evicted_files, Ordering::Relaxed);

        log::info!(
            "[UnifiedDiskCache] Pruned {} files, freed {} bytes",
            evicted_files,
            freed_bytes
        );

        Ok(freed_bytes)
    }

    /// Purge cache entries matching an optional namespace filter and age threshold.
    pub async fn purge(&self, filter: PurgeFilter) -> Result<PurgeResult, String> {
        let target_namespaces: Vec<CacheNamespace> = filter
            .namespaces
            .unwrap_or_else(|| CacheNamespace::all().to_vec());

        let now = std::time::SystemTime::now();
        let mut purged_files: usize = 0;
        let mut purged_bytes: u64 = 0;

        for ns in target_namespaces {
            let ns_dir = self.root_dir.join(ns.as_str());
            if let Ok(mut entries) = tokio::fs::read_dir(&ns_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if let Ok(meta) = entry.metadata().await {
                        if meta.is_file() {
                            let should_delete = if let Some(min_age) = filter.older_than_secs {
                                let modified = meta.modified().unwrap_or(now);
                                let age = now
                                    .duration_since(modified)
                                    .map(|d| d.as_secs())
                                    .unwrap_or(0);
                                age >= min_age
                            } else {
                                true
                            };

                            if should_delete {
                                if let Ok(bytes) = safe_delete_file(&path).await {
                                    purged_files += 1;
                                    purged_bytes += bytes;
                                }
                            }
                        }
                    }
                }
            }
        }

        let stats = self.get_stats().await;

        Ok(PurgeResult {
            purged_files,
            purged_bytes,
            remaining_bytes: stats.total_bytes,
        })
    }

    /// Scans cache directories for orphaned temporary files (`.tmp.*`) or truncated 0-byte files,
    /// removing them safely to restore cache integrity.
    pub async fn verify_integrity(&self) -> Result<IntegrityReport, String> {
        let mut scanned_files: usize = 0;
        let mut quarantined_files: usize = 0;
        let mut quarantined_bytes: u64 = 0;
        let mut errors: Vec<String> = Vec::new();

        for &ns in CacheNamespace::all() {
            let ns_dir = self.root_dir.join(ns.as_str());
            if let Ok(mut entries) = tokio::fs::read_dir(&ns_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    scanned_files += 1;

                    let file_name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default();

                    let is_temp = file_name.contains(".tmp.");
                    let is_zero_byte = entry
                        .metadata()
                        .await
                        .map(|m| m.len() == 0)
                        .unwrap_or(false);

                    if is_temp || is_zero_byte {
                        match safe_delete_file(&path).await {
                            Ok(bytes) => {
                                quarantined_files += 1;
                                quarantined_bytes += bytes;
                            }
                            Err(e) => {
                                errors.push(format!("Failed to quarantine {:?}: {}", path, e));
                            }
                        }
                    }
                }
            }
        }

        Ok(IntegrityReport {
            scanned_files,
            quarantined_files,
            quarantined_bytes,
            errors,
        })
    }

    /// Migrate legacy uncoordinated cache directories into the unified namespace hierarchy.
    /// Reclaims unmanaged space from older Clypra versions.
    pub async fn migrate_legacy_folders(&self, app_cache_dir: &Path) -> Result<usize, String> {
        let mut migrated_count: usize = 0;

        let mappings = [
            (app_cache_dir.join("thumbnails"), CacheNamespace::Thumbnails),
            (
                app_cache_dir.join("media-cache").join("audio"),
                CacheNamespace::AudioStems,
            ),
            (
                app_cache_dir.join("preview_video"),
                CacheNamespace::PreviewProxies,
            ),
            (app_cache_dir.join("mattes"), CacheNamespace::RotoscopeMattes),
        ];

        for (legacy_dir, ns) in mappings {
            if !legacy_dir.exists() {
                continue;
            }

            // Ensure destination namespace directory exists
            let target_dir = self.root_dir.join(ns.as_str());
            if legacy_dir == target_dir {
                continue; // Already points to the unified path
            }

            let _ = tokio::fs::create_dir_all(&target_dir).await;

            if let Ok(mut entries) = tokio::fs::read_dir(&legacy_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let src = entry.path();
                    if let Ok(meta) = entry.metadata().await {
                        if meta.is_file() {
                            if let Some(file_name) = src.file_name() {
                                let dst = target_dir.join(file_name);
                                if !dst.exists() {
                                    if tokio::fs::rename(&src, &dst).await.is_ok() {
                                        migrated_count += 1;
                                    }
                                } else {
                                    // Remove redundant duplicate in legacy folder
                                    let _ = tokio::fs::remove_file(&src).await;
                                }
                            }
                        }
                    }
                }
            }

            // Attempt to remove empty legacy directory
            let _ = tokio::fs::remove_dir_all(&legacy_dir).await;
        }

        if migrated_count > 0 {
            log::info!(
                "[UnifiedDiskCache] Migrated {} legacy cache files into {:?}",
                migrated_count,
                self.root_dir
            );
        }

        Ok(migrated_count)
    }
}

/// Initialize the global disk cache singleton.
pub fn init_global_disk_cache(root_dir: PathBuf) -> Arc<UnifiedDiskCacheManager> {
    let mut lock = GLOBAL_DISK_CACHE.write();
    let manager = Arc::new(UnifiedDiskCacheManager::new(root_dir));
    *lock = Some(manager.clone());
    manager
}

/// Retrieve the global disk cache singleton (if initialized).
pub fn get_global_disk_cache() -> Option<Arc<UnifiedDiskCacheManager>> {
    let lock = GLOBAL_DISK_CACHE.read();
    lock.as_ref().cloned()
}
