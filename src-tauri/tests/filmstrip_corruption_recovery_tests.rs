use tauri_app_lib::thumbnail_engine::atlas::{
    get_disk_cache_stats_from_dir, load_from_atlas_resilient, prune_disk_cache_if_needed,
    purge_all_disk_cache, set_disk_cache_limit, AtlasBuilder, AtlasLocation,
};

#[tokio::test]
async fn test_truncated_0byte_atlas_auto_quarantined() {
    let temp_dir = std::env::temp_dir().join(format!("clypra_test_trunc_{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&temp_dir).await.unwrap();

    let atlas_path = temp_dir.join("test_video_med_0000_1x.webp");
    // Write 0-byte truncated file
    tokio::fs::write(&atlas_path, &[]).await.unwrap();
    assert!(atlas_path.exists());

    let location = AtlasLocation {
        atlas_path: atlas_path.clone(),
        atlas_index: 0,
        col: 0,
        row: 0,
    };

    // Attempt load - must fail with error and auto-quarantine (delete) the corrupted file
    let result = load_from_atlas_resilient(&location, 80, 45).await;
    assert!(result.is_err());
    assert!(
        !atlas_path.exists(),
        "Corrupted 0-byte atlas should be deleted from disk"
    );

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
}

#[tokio::test]
async fn test_corrupt_garbage_webp_auto_quarantined() {
    let temp_dir =
        std::env::temp_dir().join(format!("clypra_test_corrupt_{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&temp_dir).await.unwrap();

    let atlas_path = temp_dir.join("test_video_med_0001_1x.webp");
    // Write random garbage bytes (corrupted image stream)
    tokio::fs::write(
        &atlas_path,
        &[0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x11, 0x22, 0x33],
    )
    .await
    .unwrap();
    assert!(atlas_path.exists());

    let location = AtlasLocation {
        atlas_path: atlas_path.clone(),
        atlas_index: 1,
        col: 0,
        row: 0,
    };

    let result = load_from_atlas_resilient(&location, 80, 45).await;
    assert!(result.is_err());
    assert!(
        !atlas_path.exists(),
        "Corrupted garbage atlas should be deleted from disk"
    );

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
}

#[tokio::test]
async fn test_atomic_atlas_save_and_resilient_load() {
    let temp_dir = std::env::temp_dir().join(format!("clypra_test_valid_{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&temp_dir).await.unwrap();

    let thumb_w = 40u32;
    let thumb_h = 30u32;
    let mut builder = AtlasBuilder::new(thumb_w, thumb_h);

    // Create a distinctive red thumbnail (40x30 RGBA = 4800 bytes)
    let red_pixel = [255u8, 0, 0, 255];
    let mut thumb_rgba = Vec::with_capacity((thumb_w * thumb_h * 4) as usize);
    for _ in 0..(thumb_w * thumb_h) {
        thumb_rgba.extend_from_slice(&red_pixel);
    }

    let (col, row) = builder
        .add_thumbnail(&thumb_rgba, thumb_w, thumb_h)
        .unwrap();
    assert_eq!(col, 0);
    assert_eq!(row, 0);

    let atlas_path = temp_dir.join("test_video_med_0000_1x.webp");
    builder.save(&atlas_path).await.unwrap();

    // Verify main atlas exists and no temporary files linger
    assert!(atlas_path.exists());
    let tmp_path = atlas_path.with_extension("tmp.webp");
    assert!(
        !tmp_path.exists(),
        "Temporary write file should be committed and removed"
    );

    let location = AtlasLocation {
        atlas_path: atlas_path.clone(),
        atlas_index: 0,
        col,
        row,
    };

    let loaded_rgba = load_from_atlas_resilient(&location, thumb_w, thumb_h)
        .await
        .unwrap();
    assert_eq!(loaded_rgba.len(), thumb_rgba.len());
    // Verify colors match
    assert_eq!(&loaded_rgba[0..4], &[255, 0, 0, 255]);

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
}

#[tokio::test]
async fn test_disk_cache_prunes_oldest_files_when_over_budget() {
    let temp_dir = std::env::temp_dir().join(format!("clypra_test_prune_{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&temp_dir).await.unwrap();

    let thumb_w = 20u32;
    let thumb_h = 20u32;
    let mut builder = AtlasBuilder::new(thumb_w, thumb_h);
    let raw_rgba = vec![128u8; (thumb_w * thumb_h * 4) as usize];
    builder.add_thumbnail(&raw_rgba, thumb_w, thumb_h).unwrap();

    // Create 5 atlas files
    let mut paths = Vec::new();
    for i in 0..5 {
        let p = temp_dir.join(format!("test_video_med_{:04}_1x.webp", i));
        builder.save(&p).await.unwrap();
        paths.push(p);
        tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;
    }

    let (initial_bytes, file_count) = get_disk_cache_stats_from_dir(&temp_dir).await;
    assert_eq!(file_count, 5);
    assert!(initial_bytes > 0);

    // Set limit lower than total bytes (e.g. limit to 2 files worth of bytes)
    let single_file_size = initial_bytes / 5;
    let tight_limit = single_file_size * 2;
    set_disk_cache_limit(tight_limit);

    prune_disk_cache_if_needed(&temp_dir).await;

    let (after_bytes, after_count) = get_disk_cache_stats_from_dir(&temp_dir).await;
    assert!(after_count < 5, "Oldest files should be pruned");
    assert!(
        after_bytes <= tight_limit,
        "Cache usage should be within budget"
    );

    // The oldest file (paths[0]) should have been deleted first
    assert!(!paths[0].exists(), "Oldest atlas must be evicted first");

    // Reset limit to 5GB default
    set_disk_cache_limit(5 * 1024 * 1024 * 1024);
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
}

#[tokio::test]
async fn test_purge_all_disk_cache_clears_directory() {
    let temp_dir = std::env::temp_dir().join(format!("clypra_test_purge_{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&temp_dir).await.unwrap();

    let thumb_w = 20u32;
    let thumb_h = 20u32;
    let mut builder = AtlasBuilder::new(thumb_w, thumb_h);
    let raw_rgba = vec![64u8; (thumb_w * thumb_h * 4) as usize];
    builder.add_thumbnail(&raw_rgba, thumb_w, thumb_h).unwrap();

    for i in 0..3 {
        let p = temp_dir.join(format!("test_video_med_{:04}_1x.webp", i));
        builder.save(&p).await.unwrap();
    }

    let (_, count_before) = get_disk_cache_stats_from_dir(&temp_dir).await;
    assert_eq!(count_before, 3);

    let purged = purge_all_disk_cache(&temp_dir).await.unwrap();
    assert_eq!(purged, 3);

    let (bytes_after, count_after) = get_disk_cache_stats_from_dir(&temp_dir).await;
    assert_eq!(bytes_after, 0);
    assert_eq!(count_after, 0);

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
}
