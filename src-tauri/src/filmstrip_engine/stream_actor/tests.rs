use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::filmstrip_engine::decoder::{
    DecodeFrameOptions, VideoColorMetadata, VideoStreamMetadata,
};
use crate::filmstrip_engine::stream_actor::handle::{
    get_preview_decoder_actor_for_stream, release_preview_decoder_actor_for_stream,
    StreamDecoderActorHandle,
};
use crate::filmstrip_engine::stream_actor::types::{
    calculate_download_stride, producer_downloads_wasted, producer_lookahead_downloads_skipped,
    reset_producer_downloads_wasted, reset_producer_lookahead_downloads_skipped, DecodedActorFrame,
    DecodedVideoPlanes, PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED,
};
use clypra_native_core::QualityTier;

#[tokio::test]
async fn test_prime_cache_direct_hit() {
    let dummy_key = "test_stream::dummy".to_string();
    let (urgent_tx, _urgent_rx) = mpsc::channel(1);
    let (prefetch_tx, _prefetch_rx) = mpsc::channel(1);
    let current_generation = Arc::new(AtomicU64::new(0));
    let cancel_in_flight = Arc::new(AtomicBool::new(false));
    let prime_cache = Arc::new(Mutex::new(VecDeque::new()));

    let cached_frame = DecodedActorFrame {
        time_secs: 1.0,
        planes: DecodedVideoPlanes::Cpu {
            y: Arc::from(vec![0u8; 16]),
            uv: Arc::from(vec![0u8; 8]),
        },
        width: 4,
        height: 4,
        source_rotation: 0,
        color: VideoColorMetadata::default(),
        decode_us: 100,
        decoder_mutex_wait_us: 50,
        actor_wait_us: 0,
        from_prime_cache: false,
        quality: QualityTier::Full,
        is_approximate: false,
        demux_us: 10,
        container_format: "mp4".to_string(),
        is_hardware_accelerated: false,
        decoder_seek_time_us: 0,
        decoder_seek_count: 0,
        decoder_frames_decoded: 0,
        hardware_frame_download_us: None,
        scale_colorspace_us: 0,
        hardware_frames_downloaded: 0,
        source_metadata: VideoStreamMetadata::default(),
        served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
        hw_device_type: None,
        served_count: 0,
    };

    prime_cache.lock().await.push_back(cached_frame);

    let handle = StreamDecoderActorHandle {
        key: dummy_key,
        urgent_tx,
        prefetch_tx,
        current_generation,
        cancel_in_flight,
        prime_cache: prime_cache.clone(),
        frame_duration_secs: 1.0 / 30.0,
        last_accessed_ms: Arc::new(AtomicU64::new(0)),
    };

    let opts = DecodeFrameOptions {
        allow_keyframe_approx: false,
        quality: QualityTier::Full,
        is_playback: false,
        skip_hw_download: false,
        target_dimensions: None,
    };

    // Exact match
    let res = handle
        .decode_frame(1.0, opts, false, 0)
        .await
        .expect("should hit prime cache");
    assert!(res.from_prime_cache);
    assert_eq!(res.time_secs, 1.0);

    // Within tolerance match (frame duration is 0.0333s, diff 0.01s is within tolerance)
    let res_near = handle
        .decode_frame(1.01, opts, false, 0)
        .await
        .expect("should hit near match");
    assert!(res_near.from_prime_cache);

    // Insert an approximate frame into prime cache
    let approx_frame = DecodedActorFrame {
        time_secs: 2.0,
        planes: DecodedVideoPlanes::Cpu {
            y: Arc::from(vec![0u8; 16]),
            uv: Arc::from(vec![0u8; 8]),
        },
        width: 4,
        height: 4,
        source_rotation: 0,
        color: VideoColorMetadata::default(),
        decode_us: 10,
        decoder_mutex_wait_us: 5,
        actor_wait_us: 0,
        from_prime_cache: false,
        quality: QualityTier::Full,
        is_approximate: true,
        demux_us: 10,
        container_format: "mp4".to_string(),
        is_hardware_accelerated: false,
        decoder_seek_time_us: 0,
        decoder_seek_count: 0,
        decoder_frames_decoded: 0,
        hardware_frame_download_us: None,
        scale_colorspace_us: 0,
        hardware_frames_downloaded: 0,
        source_metadata: VideoStreamMetadata::default(),
        served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
        hw_device_type: None,
        served_count: 0,
    };
    prime_cache.lock().await.push_back(approx_frame);

    // Approximate request hits prime cache
    let opts_approx = DecodeFrameOptions {
        allow_keyframe_approx: true,
        quality: QualityTier::Full,
        is_playback: false,
        skip_hw_download: false,
        target_dimensions: None,
    };
    let res_approx = handle
        .decode_frame(2.0, opts_approx, false, 0)
        .await
        .expect("approx request should hit approx cached frame");
    assert!(res_approx.from_prime_cache);

    // Exact request (allow_keyframe_approx: false) must NOT hit approximate cached frame!
    // Because channel is empty/closed, this will fail or skip cache rather than returning approx
    drop(_urgent_rx);
    drop(_prefetch_rx);
    let opts_exact = DecodeFrameOptions {
        allow_keyframe_approx: false,
        quality: QualityTier::Full,
        is_playback: false,
        skip_hw_download: false,
        target_dimensions: None,
    };
    let err_exact = handle.decode_frame(2.0, opts_exact, false, 0).await;
    assert!(
        err_exact.is_err(),
        "Exact request must not return approximate cached frame"
    );

    let opts_half = DecodeFrameOptions {
        allow_keyframe_approx: false,
        quality: QualityTier::Half,
        is_playback: false,
        skip_hw_download: false,
        target_dimensions: None,
    };
    // Channel is closed, so decode_frame fails immediately
    let err = handle.decode_frame(1.0, opts_half, false, 0).await;
    assert!(err.is_err());
}

#[test]
fn test_handle_invalidation() {
    let dummy_key = "test_stream::dummy".to_string();
    let (urgent_tx, _urgent_rx) = mpsc::channel(1);
    let (prefetch_tx, _prefetch_rx) = mpsc::channel(1);
    let current_generation = Arc::new(AtomicU64::new(0));
    let cancel_in_flight = Arc::new(AtomicBool::new(false));
    let prime_cache = Arc::new(Mutex::new(VecDeque::new()));

    let handle = StreamDecoderActorHandle {
        key: dummy_key,
        urgent_tx,
        prefetch_tx,
        current_generation: current_generation.clone(),
        cancel_in_flight: cancel_in_flight.clone(),
        prime_cache,
        frame_duration_secs: 1.0 / 30.0,
        last_accessed_ms: Arc::new(AtomicU64::new(0)),
    };

    handle.invalidate(42);
    assert_eq!(current_generation.load(Ordering::Acquire), 42);
    assert!(cancel_in_flight.load(Ordering::Acquire));
}

#[tokio::test]
async fn playback_uses_newest_eligible_cached_frame_without_seeking_back() {
    let (urgent_tx, _urgent_rx) = mpsc::channel(1);
    let (prefetch_tx, _prefetch_rx) = mpsc::channel(1);
    let prime_cache = Arc::new(Mutex::new(VecDeque::new()));
    prime_cache.lock().await.push_back(DecodedActorFrame {
        time_secs: 2.0,
        planes: DecodedVideoPlanes::Cpu {
            y: Arc::from(vec![0u8; 16]),
            uv: Arc::from(vec![0u8; 8]),
        },
        width: 4,
        height: 4,
        source_rotation: 0,
        color: VideoColorMetadata::default(),
        decode_us: 99,
        decoder_mutex_wait_us: 0,
        actor_wait_us: 0,
        from_prime_cache: false,
        quality: QualityTier::Full,
        is_approximate: false,
        demux_us: 0,
        container_format: "mp4".to_string(),
        is_hardware_accelerated: false,
        decoder_seek_time_us: 0,
        decoder_seek_count: 1,
        decoder_frames_decoded: 99,
        hardware_frame_download_us: None,
        scale_colorspace_us: 0,
        hardware_frames_downloaded: 0,
        source_metadata: VideoStreamMetadata::default(),
        served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
        hw_device_type: None,
        served_count: 0,
    });
    let handle = StreamDecoderActorHandle {
        key: "playback-cache-test".to_string(),
        urgent_tx,
        prefetch_tx,
        current_generation: Arc::new(AtomicU64::new(0)),
        cancel_in_flight: Arc::new(AtomicBool::new(false)),
        prime_cache,
        frame_duration_secs: 1.0 / 30.0,
        last_accessed_ms: Arc::new(AtomicU64::new(0)),
    };

    // The requested clock time is older than the decoded cursor. Exact
    // seek would re-seek here; playback must show the current frame.
    let frame = handle
        .decode_playback_frame(
            1.8,
            DecodeFrameOptions {
                allow_keyframe_approx: false,
                quality: QualityTier::Full,
                is_playback: true,
                skip_hw_download: false,
                target_dimensions: None,
            },
            0,
        )
        .await
        .expect("latest playback cache frame should satisfy late request");

    assert_eq!(frame.time_secs, 2.0);
    assert!(frame.from_prime_cache);
    assert_eq!(frame.decode_us, 0);
    assert_eq!(frame.decoder_seek_count, 0);
    assert_eq!(frame.decoder_frames_decoded, 0);
}

#[tokio::test]
async fn test_cly_bug_011_playback_mode_uses_latest_frame_wins_policy() {
    let (urgent_tx, urgent_rx) = tokio::sync::mpsc::channel(1);
    drop(urgent_rx); // Dropped so channel send fails immediately if cache is missed
    let (prefetch_tx, _prefetch_rx) = tokio::sync::mpsc::channel(1);
    let prime_cache = Arc::new(Mutex::new(VecDeque::new()));
    prime_cache.lock().await.push_back(DecodedActorFrame {
        time_secs: 2.0,
        planes: DecodedVideoPlanes::Cpu {
            y: Arc::from(vec![0u8; 16]),
            uv: Arc::from(vec![0u8; 8]),
        },
        width: 4,
        height: 4,
        source_rotation: 0,
        color: VideoColorMetadata::default(),
        decode_us: 99,
        decoder_mutex_wait_us: 0,
        actor_wait_us: 0,
        from_prime_cache: false,
        quality: QualityTier::Full,
        is_approximate: false,
        demux_us: 0,
        container_format: "mp4".to_string(),
        is_hardware_accelerated: false,
        decoder_seek_time_us: 0,
        decoder_seek_count: 1,
        decoder_frames_decoded: 99,
        hardware_frame_download_us: None,
        scale_colorspace_us: 0,
        hardware_frames_downloaded: 0,
        source_metadata: VideoStreamMetadata::default(),
        served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
        hw_device_type: None,
        served_count: 0,
    });
    let handle = StreamDecoderActorHandle {
        key: "playback-policy-test".to_string(),
        urgent_tx,
        prefetch_tx,
        current_generation: Arc::new(AtomicU64::new(0)),
        cancel_in_flight: Arc::new(AtomicBool::new(false)),
        prime_cache,
        frame_duration_secs: 1.0 / 30.0,
        last_accessed_ms: Arc::new(AtomicU64::new(0)),
    };

    let opts = DecodeFrameOptions {
        allow_keyframe_approx: false,
        quality: QualityTier::Full,
        is_playback: false,
        skip_hw_download: false,
        target_dimensions: None,
    };

    // Standard decode_frame omits latest-frame-wins, attempts seeking on channel and fails
    let scrub_res = handle.decode_frame(1.8, opts, false, 0).await;
    assert!(scrub_res.is_err(), "Non-playback scrub requires exact seek");

    // decode_playback_frame activates latest_frame_wins and succeeds from cache
    let playback_res = handle.decode_playback_frame(1.8, opts, 0).await;
    assert!(playback_res.is_ok(), "Playback mode must serve latest cached frame");
    assert_eq!(playback_res.unwrap().time_secs, 2.0);
}

#[tokio::test]
async fn test_actor_with_real_video_asset_if_available() {
    let test_asset = "/Users/AIEraDev/Documents/clypra-testing-assets/Antler.mp4";
    if !Path::new(test_asset).exists() {
        eprintln!("[INFO] Skipping real asset test; {} not found", test_asset);
        return;
    }

    let actor = get_preview_decoder_actor_for_stream(test_asset, "test-stream-1")
        .await
        .expect("should create actor for stream");

    let opts = DecodeFrameOptions {
        allow_keyframe_approx: false,
        quality: QualityTier::Full,
        is_playback: false,
        skip_hw_download: false,
        target_dimensions: None,
    };

    // Frame 0 decode
    let f0 = actor
        .decode_frame(0.0, opts, false, 1)
        .await
        .expect("decode frame 0");
    assert!(!f0.from_prime_cache);
    assert!(f0.width > 0);
    assert!(f0.height > 0);

    // Give actor task a brief moment to prime forward
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Next sequential frame should ideally hit the prime cache
    let frame_duration = actor.frame_duration_secs();
    let f1 = actor
        .decode_frame(frame_duration, opts, false, 1)
        .await
        .expect("decode frame 1");
    assert_eq!(f1.width, f0.width);
    assert_eq!(f1.height, f0.height);

    // Invalidate and seek
    actor.invalidate(2);
    let f_seek = actor
        .decode_frame(1.5, opts, false, 2)
        .await
        .expect("seek decode");
    assert_eq!(f_seek.width, f0.width);

    release_preview_decoder_actor_for_stream(test_asset, "test-stream-1");
}

#[tokio::test]
async fn test_wasted_download_accounting_and_reset() {
    reset_producer_downloads_wasted();
    assert_eq!(producer_downloads_wasted(), 0);

    let prime_cache = Arc::new(Mutex::new(VecDeque::new()));
    let (urgent_tx, _) = mpsc::channel(1);
    let (prefetch_tx, _) = mpsc::channel(1);
    let handle = StreamDecoderActorHandle {
        key: "test_wasted".to_string(),
        urgent_tx,
        prefetch_tx,
        current_generation: Arc::new(AtomicU64::new(0)),
        cancel_in_flight: Arc::new(AtomicBool::new(false)),
        prime_cache: prime_cache.clone(),
        frame_duration_secs: 0.04,
        last_accessed_ms: Arc::new(AtomicU64::new(0)),
    };

    // Add 2 frames that were never served (served_count = 0)
    {
        let mut cache = prime_cache.lock().await;
        cache.push_back(DecodedActorFrame {
            time_secs: 0.0,
            decode_us: 1000,
            decoder_mutex_wait_us: 100,
            actor_wait_us: 50,
            demux_us: 200,
            container_format: "mp4".to_string(),
            is_hardware_accelerated: true,
            decoder_seek_count: 0,
            decoder_seek_time_us: 0,
            decoder_frames_decoded: 1,
            hardware_frame_download_us: Some(5000),
            hardware_frames_downloaded: 1,
            scale_colorspace_us: 100,
            source_metadata: VideoStreamMetadata::default(),
            planes: DecodedVideoPlanes::Cpu {
                y: Arc::from(vec![0u8; 16]),
                uv: Arc::from(vec![0u8; 8]),
            },
            width: 320,
            height: 180,
            color: VideoColorMetadata::default(),
            source_rotation: 0,
            served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
            from_prime_cache: false,
            quality: QualityTier::Full,
            is_approximate: false,
            hw_device_type: Some("d3d11va".to_string()),
            served_count: 0,
        });
        cache.push_back(DecodedActorFrame {
            time_secs: 0.04,
            decode_us: 1000,
            decoder_mutex_wait_us: 100,
            actor_wait_us: 50,
            demux_us: 200,
            container_format: "mp4".to_string(),
            is_hardware_accelerated: true,
            decoder_seek_count: 0,
            decoder_seek_time_us: 0,
            decoder_frames_decoded: 1,
            hardware_frame_download_us: Some(5000),
            hardware_frames_downloaded: 1,
            scale_colorspace_us: 100,
            source_metadata: VideoStreamMetadata::default(),
            planes: DecodedVideoPlanes::Cpu {
                y: Arc::from(vec![0u8; 16]),
                uv: Arc::from(vec![0u8; 8]),
            },
            width: 320,
            height: 180,
            color: VideoColorMetadata::default(),
            source_rotation: 0,
            served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
            from_prime_cache: false,
            quality: QualityTier::Full,
            is_approximate: false,
            hw_device_type: Some("d3d11va".to_string()),
            served_count: 0,
        });
    }

    // Clear cache should count both unserved frames as wasted downloads
    handle.clear_prime_cache().await;
    assert_eq!(producer_downloads_wasted(), 2);

    // Reset must return count to zero
    reset_producer_downloads_wasted();
    assert_eq!(producer_downloads_wasted(), 0);
}

#[test]
fn test_calculate_download_stride_rules() {
    // 1. Software decode always downloads every frame
    assert_eq!(calculate_download_stride(1.0 / 25.0, false, true), 1);
    assert_eq!(calculate_download_stride(1.0 / 60.0, false, true), 1);

    // 2. Non-playback modes (seek, scrub, frame-step) always download every frame
    assert_eq!(calculate_download_stride(1.0 / 25.0, true, false), 1);
    assert_eq!(calculate_download_stride(1.0 / 60.0, true, false), 1);

    // 3. Hardware-accelerated playback adapts based on stream frame rate
    // Standard film / broadcast (24, 25, 30 fps) -> stride 2 (~12-15 fps presentation)
    assert_eq!(calculate_download_stride(1.0 / 24.0, true, true), 2);
    assert_eq!(calculate_download_stride(1.0 / 25.0, true, true), 2);
    assert_eq!(calculate_download_stride(1.0 / 30.0, true, true), 2);

    // High frame rate (50, 60 fps) -> stride 3 (~16-20 fps presentation)
    assert_eq!(calculate_download_stride(1.0 / 50.0, true, true), 3);
    assert_eq!(calculate_download_stride(1.0 / 60.0, true, true), 3);

    // Low frame rate (<= 15 fps) -> stride 1
    assert_eq!(calculate_download_stride(1.0 / 12.0, true, true), 1);
    assert_eq!(calculate_download_stride(1.0 / 15.0, true, true), 1);
}

#[test]
fn test_producer_lookahead_downloads_skipped_accounting() {
    reset_producer_lookahead_downloads_skipped();
    assert_eq!(producer_lookahead_downloads_skipped(), 0);

    PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED.fetch_add(5, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(producer_lookahead_downloads_skipped(), 5);

    reset_producer_lookahead_downloads_skipped();
    assert_eq!(producer_lookahead_downloads_skipped(), 0);
}
