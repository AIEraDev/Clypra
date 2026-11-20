use tauri::{AppHandle, Emitter, Manager};

use crate::disk_cache::{
    get_global_disk_cache, init_global_disk_cache, CompactionReport, IntegrityReport, PurgeFilter,
    PurgeResult, UnifiedCacheStats,
};

fn get_or_init_cache_manager(app: &AppHandle) -> Result<std::sync::Arc<crate::disk_cache::UnifiedDiskCacheManager>, String> {
    if let Some(m) = get_global_disk_cache() {
        return Ok(m);
    }
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve app cache dir: {e}"))?
        .join("clypra_cache");
    Ok(init_global_disk_cache(cache_dir))
}

/// Retrieve comprehensive statistics across all disk cache namespaces.
#[tauri::command]
pub async fn get_unified_cache_stats(app: AppHandle) -> Result<UnifiedCacheStats, String> {
    let mgr = get_or_init_cache_manager(&app)?;
    Ok(mgr.get_stats().await)
}

/// Configure the maximum global disk cache budget in bytes (0 = unlimited).
#[tauri::command]
pub async fn set_unified_cache_limit(app: AppHandle, limit_bytes: u64) -> Result<(), String> {
    let mgr = get_or_init_cache_manager(&app)?;
    mgr.set_limit(limit_bytes);
    crate::filmstrip_engine::atlas::set_disk_cache_limit(limit_bytes);
    if let Ok(freed) = mgr.prune_if_needed().await {
        if freed > 0 {
            let _ = app.emit("clypra://cache-eviction", serde_json::json!({ "freed_bytes": freed }));
        }
    }
    Ok(())
}

/// Purge cache entries across specified namespaces or by age threshold.
#[tauri::command]
pub async fn purge_unified_cache(
    app: AppHandle,
    filter: Option<PurgeFilter>,
) -> Result<PurgeResult, String> {
    let mgr = get_or_init_cache_manager(&app)?;
    let active_filter = filter.unwrap_or_default();

    // Check if thumbnails are targeted for purge; if so, clear in-memory caches as well
    let includes_thumbnails = match &active_filter.namespaces {
        Some(ns_list) => ns_list.contains(&crate::disk_cache::CacheNamespace::Thumbnails),
        None => true, // Default purges all namespaces
    };

    let result = mgr.purge(active_filter).await?;

    if includes_thumbnails {
        crate::filmstrip_engine::FRAME_CACHE.clear();
        crate::filmstrip_engine::TIER_CACHE.clear();
        crate::filmstrip_engine::GLOBAL_CACHE.clear().await;
    }

    if result.purged_files > 0 {
        let _ = app.emit(
            "clypra://cache-eviction",
            serde_json::json!({
                "freed_bytes": result.purged_bytes,
                "purged_files": result.purged_files,
            }),
        );
    }

    Ok(result)
}

/// Verify integrity of the cache directory, safely quarantining corrupted or orphaned files.
#[tauri::command]
pub async fn verify_cache_integrity(app: AppHandle) -> Result<IntegrityReport, String> {
    let mgr = get_or_init_cache_manager(&app)?;
    let report = mgr.verify_integrity().await?;

    if report.quarantined_files > 0 {
        let _ = app.emit(
            "clypra://cache-quarantine",
            serde_json::json!({
                "quarantined_files": report.quarantined_files,
                "quarantined_bytes": report.quarantined_bytes,
            }),
        );
    }

    Ok(report)
}

/// Compact and defragment cache namespaces, removing old temporary files and orphaned data.
#[tauri::command]
pub async fn compact_unified_cache(app: AppHandle) -> Result<CompactionReport, String> {
    let mgr = get_or_init_cache_manager(&app)?;
    let report = mgr.compact().await?;

    if report.removed_orphans > 0 {
        let _ = app.emit(
            "clypra://cache-eviction",
            serde_json::json!({
                "freed_bytes": report.reclaimed_bytes,
                "purged_files": report.removed_orphans,
            }),
        );
    }

    Ok(report)
}
