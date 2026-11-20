pub mod atomic_io;
pub mod manager;
pub mod types;

#[cfg(test)]
mod tests;

pub use atomic_io::{atomic_write_file, safe_delete_file, validate_or_quarantine};
pub use manager::{
    get_global_disk_cache, init_global_disk_cache, UnifiedDiskCacheManager,
    DEFAULT_DISK_CACHE_LIMIT_BYTES,
};
pub use types::{
    CacheNamespace, CompactionReport, DiskCacheEntry, IntegrityReport, PurgeFilter, PurgeResult,
    UnifiedCacheStats,
};
