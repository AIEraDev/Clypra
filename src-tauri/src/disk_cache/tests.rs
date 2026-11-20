#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use uuid::Uuid;

    use crate::disk_cache::atomic_io::{atomic_write_file, validate_or_quarantine};
    use crate::disk_cache::manager::UnifiedDiskCacheManager;
    use crate::disk_cache::types::{CacheNamespace, PurgeFilter};

    fn make_test_cache_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("clypra_test_cache_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn test_atomic_write_and_quarantine() {
        let temp_dir = make_test_cache_dir();
        let target_file = temp_dir.join("sample.bin");

        let payload = b"CLYPRA_ATOMIC_CACHE_PAYLOAD";
        let written = atomic_write_file(&target_file, payload).await.unwrap();
        assert_eq!(written, payload.len() as u64);
        assert!(target_file.exists());

        let read_back = tokio::fs::read(&target_file).await.unwrap();
        assert_eq!(read_back, payload);

        // Validation of healthy file
        let valid_len = validate_or_quarantine(&target_file, 10).await.unwrap();
        assert_eq!(valid_len, payload.len() as u64);

        // Corrupt file by truncating to 0 bytes
        tokio::fs::write(&target_file, b"").await.unwrap();
        assert!(target_file.exists());

        // Validation should fail and quarantine (delete) the file
        let quarantined = validate_or_quarantine(&target_file, 1).await;
        assert!(quarantined.is_err());
        assert!(!target_file.exists(), "0-byte file must be deleted");

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_resolve_path_and_stats() {
        let temp_dir = make_test_cache_dir();
        let manager = UnifiedDiskCacheManager::new(temp_dir.clone());

        let thumb_path = manager.resolve_path(CacheNamespace::Thumbnails, "atlas_001.webp");
        assert!(thumb_path.parent().unwrap().exists());
        assert!(thumb_path.to_string_lossy().contains("thumbnails"));

        atomic_write_file(&thumb_path, &[1, 2, 3, 4, 5, 6, 7, 8]).await.unwrap();

        let proxy_path = manager.resolve_path(CacheNamespace::PreviewProxies, "proxy_001.mp4");
        atomic_write_file(&proxy_path, &[10, 20, 30, 40]).await.unwrap();

        manager.record_hit();
        manager.record_hit();
        manager.record_miss();

        let stats = manager.get_stats().await;
        assert_eq!(stats.total_bytes, 12);
        assert_eq!(stats.hit_count, 2);
        assert_eq!(stats.miss_count, 1);
        assert!((stats.hit_rate_pct - 66.66).abs() < 1.0);
        assert_eq!(*stats.namespace_bytes.get("thumbnails").unwrap(), 8);
        assert_eq!(*stats.namespace_bytes.get("proxies").unwrap(), 4);
        assert_eq!(*stats.namespace_counts.get("thumbnails").unwrap(), 1);
        assert_eq!(*stats.namespace_counts.get("proxies").unwrap(), 1);

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_prune_exceeding_budget() {
        let temp_dir = make_test_cache_dir();
        let manager = UnifiedDiskCacheManager::new(temp_dir.clone());

        // Set budget to 100 bytes
        manager.set_limit(100);

        // Write 3 files in proxies (weight 1.0) and 1 file in assets (weight 0.2)
        let p1 = manager.resolve_path(CacheNamespace::PreviewProxies, "p1.mp4");
        let p2 = manager.resolve_path(CacheNamespace::PreviewProxies, "p2.mp4");
        let a1 = manager.resolve_path(CacheNamespace::RemoteAssets, "lut1.cube");

        let chunk = vec![0u8; 50]; // 50 bytes each
        atomic_write_file(&p1, &chunk).await.unwrap();
        atomic_write_file(&p2, &chunk).await.unwrap();
        atomic_write_file(&a1, &chunk).await.unwrap();

        let stats_before = manager.get_stats().await;
        assert_eq!(stats_before.total_bytes, 150); // 150 bytes > 100 limit

        // Pruning should kick in and trim until <= 90 bytes (90% target)
        let freed = manager.prune_if_needed().await.unwrap();
        assert!(freed >= 60);

        let stats_after = manager.get_stats().await;
        assert!(stats_after.total_bytes <= 90);
        assert!(manager.get_stats().await.eviction_count > 0);

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_targeted_purge_and_integrity_audit() {
        let temp_dir = make_test_cache_dir();
        let manager = UnifiedDiskCacheManager::new(temp_dir.clone());

        let t1 = manager.resolve_path(CacheNamespace::Thumbnails, "t1.webp");
        let a1 = manager.resolve_path(CacheNamespace::AudioStems, "a1.wav");
        atomic_write_file(&t1, b"thumb_bytes").await.unwrap();
        atomic_write_file(&a1, b"audio_bytes").await.unwrap();

        // Inject orphaned temp file and zero-byte file
        let orphan_tmp = manager.resolve_path(CacheNamespace::Thumbnails, "temp.tmp.uuid123");
        tokio::fs::write(&orphan_tmp, b"orphan").await.unwrap();
        let zero_byte = manager.resolve_path(CacheNamespace::AudioStems, "empty.wav");
        tokio::fs::write(&zero_byte, b"").await.unwrap();

        let integrity = manager.verify_integrity().await.unwrap();
        assert_eq!(integrity.quarantined_files, 2);
        assert!(!orphan_tmp.exists());
        assert!(!zero_byte.exists());

        // Targeted purge: only Thumbnails
        let purge_result = manager
            .purge(PurgeFilter {
                namespaces: Some(vec![CacheNamespace::Thumbnails]),
                older_than_secs: None,
            })
            .await
            .unwrap();

        assert_eq!(purge_result.purged_files, 1);
        assert!(!t1.exists());
        assert!(a1.exists(), "Audio stem must remain untouched");

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_legacy_folder_migration() {
        let legacy_root = make_test_cache_dir();
        let unified_root = make_test_cache_dir().join("clypra_cache");
        let manager = UnifiedDiskCacheManager::new(unified_root.clone());

        // Setup legacy structure
        let old_audio = legacy_root.join("media-cache").join("audio");
        let old_preview = legacy_root.join("preview_video");
        tokio::fs::create_dir_all(&old_audio).await.unwrap();
        tokio::fs::create_dir_all(&old_preview).await.unwrap();

        let old_audio_file = old_audio.join("hash123.wav");
        let old_preview_file = old_preview.join("hash456.mp4");
        tokio::fs::write(&old_audio_file, b"OLD_AUDIO").await.unwrap();
        tokio::fs::write(&old_preview_file, b"OLD_PREVIEW").await.unwrap();

        let migrated = manager.migrate_legacy_folders(&legacy_root).await.unwrap();
        assert_eq!(migrated, 2);

        // Verify moved files exist in unified structure
        let new_audio = manager.resolve_path(CacheNamespace::AudioStems, "hash123.wav");
        let new_preview = manager.resolve_path(CacheNamespace::PreviewProxies, "hash456.mp4");
        assert!(new_audio.exists());
        assert!(new_preview.exists());
        assert_eq!(tokio::fs::read(&new_audio).await.unwrap(), b"OLD_AUDIO");
        assert_eq!(tokio::fs::read(&new_preview).await.unwrap(), b"OLD_PREVIEW");

        let _ = tokio::fs::remove_dir_all(&legacy_root).await;
        let _ = tokio::fs::remove_dir_all(&unified_root).await;
    }

    #[tokio::test]
    async fn test_nested_namespace_stats() {
        let temp_dir = make_test_cache_dir();
        let manager = UnifiedDiskCacheManager::new(temp_dir.clone());

        // Create nested asset subdirectories: assets/stickers and assets/smart-overlays
        let stickers_dir = temp_dir.join(CacheNamespace::RemoteAssets.as_str()).join("stickers");
        tokio::fs::create_dir_all(&stickers_dir).await.unwrap();
        let s1 = stickers_dir.join("sticker1.png");
        atomic_write_file(&s1, &[1, 2, 3, 4, 5]).await.unwrap();

        let overlays_dir = temp_dir.join(CacheNamespace::RemoteAssets.as_str()).join("smart-overlays");
        tokio::fs::create_dir_all(&overlays_dir).await.unwrap();
        let o1 = overlays_dir.join("overlay1.json");
        atomic_write_file(&o1, &[6, 7, 8, 9, 10, 11, 12]).await.unwrap();

        let stats = manager.get_stats().await;
        assert_eq!(*stats.namespace_bytes.get("assets").unwrap(), 12);
        assert_eq!(*stats.namespace_counts.get("assets").unwrap(), 2);

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_compaction_and_defragmentation() {
        let temp_dir = make_test_cache_dir();
        let manager = UnifiedDiskCacheManager::new(temp_dir.clone());

        // 1. Healthy file
        let good_file = manager.resolve_path(CacheNamespace::Thumbnails, "good.webp");
        atomic_write_file(&good_file, b"valid_frame_data").await.unwrap();

        // 2. Corrupted 0-byte file
        let zero_file = manager.resolve_path(CacheNamespace::Thumbnails, "corrupt.webp");
        tokio::fs::write(&zero_file, b"").await.unwrap();

        // 3. 0-byte temp file
        let orphan_file = manager.resolve_path(CacheNamespace::Thumbnails, "file.tmp.uuid999");
        tokio::fs::write(&orphan_file, b"").await.unwrap();

        let report = manager.compact().await.unwrap();
        assert!(report.scanned_files >= 3);
        assert_eq!(report.removed_orphans, 2);
        assert!(!zero_file.exists());
        assert!(!orphan_file.exists());
        assert!(good_file.exists());

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }
}
