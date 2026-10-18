use super::*;
use ffmpeg_next as ffmpeg;


#[cfg(test)]
mod decode_frame_options_tests {
    use super::{DecodeFrameOptions, QualityTier};

    /// The two fields added for benchmark arms must default to the safe values
    /// that preserve pre-phase-1b behaviour on every production call site.
    ///
    /// `skip_hw_download: false`  → hardware frames are always downloaded (no change)
    /// `target_dimensions: None`  → output resolution is unchanged from source/quality
    ///
    /// If this test fails, a call site was accidentally changed to benchmark
    /// mode in production code.
    #[test]
    fn production_defaults_are_safe() {
        let opts = DecodeFrameOptions::default();
        assert!(
            !opts.skip_hw_download,
            "skip_hw_download must default to false; \
             true bypasses av_hwframe_transfer_data and is only for arm-1 benchmarking"
        );
        assert_eq!(
            opts.target_dimensions, None,
            "target_dimensions must default to None; \
             Some(...) forces a fixed output size and is only for arm-0 benchmarking"
        );
        // Sanity-check the other fields haven't drifted from their zero values.
        assert!(!opts.allow_keyframe_approx);
        assert!(!opts.is_playback);
        assert_eq!(opts.quality, QualityTier::Full);
    }

    /// Benchmark arm-1 construction: skip_hw_download=true should compile and
    /// round-trip cleanly without affecting target_dimensions.
    #[test]
    fn arm1_options_skip_download_only() {
        let opts = DecodeFrameOptions {
            skip_hw_download: true,
            target_dimensions: None,
            ..DecodeFrameOptions::default()
        };
        assert!(opts.skip_hw_download);
        assert_eq!(opts.target_dimensions, None);
    }

    /// Benchmark arm-0 construction: target_dimensions=Some(320,180) should
    /// not accidentally enable skip_hw_download.
    #[test]
    fn arm0_options_target_dimensions_only() {
        let opts = DecodeFrameOptions {
            target_dimensions: Some((320, 180)),
            ..DecodeFrameOptions::default()
        };
        assert!(!opts.skip_hw_download);
        assert_eq!(opts.target_dimensions, Some((320, 180)));
    }
}

#[cfg(test)]
mod display_dimensions_tests {
    use super::ffmpeg;

    /// Helper to test display dimension calculation without full decoder
    fn calc_display_dims(width: u32, height: u32, sar: (i32, i32), rotation: u32) -> (u32, u32) {
        let geom = super::DisplayGeometry::from_encoded(width, height, sar, rotation);
        (geom.display_width, geom.display_height)
    }

    #[test]
    fn test_square_pixels_landscape() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_square_pixels_portrait() {
        let (w, h) = calc_display_dims(720, 1280, (1, 1), 0);
        assert_eq!((w, h), (720, 1280));
    }

    #[test]
    fn test_rotation_90_landscape_to_portrait() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 90);
        assert_eq!((w, h), (1080, 1920));
    }

    #[test]
    fn test_rotation_270_landscape_to_portrait() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 270);
        assert_eq!((w, h), (1080, 1920));
    }

    #[test]
    fn test_rotation_180_no_swap() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 180);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_anamorphic_handbrake_portrait() {
        // HandBrake anamorphic: 1920×1080 pixels, SAR 81:256 → 608×1080 display
        let (w, h) = calc_display_dims(1920, 1080, (81, 256), 0);
        assert_eq!((w, h), (608, 1080));
    }

    #[test]
    fn test_anamorphic_wide_screen() {
        let (w, h) = calc_display_dims(1440, 1080, (4, 3), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_invalid_sar_zero_numerator() {
        let (w, h) = calc_display_dims(4320, 7680, (0, 1), 0);
        assert_eq!((w, h), (4320, 7680));
    }

    #[test]
    fn test_invalid_sar_zero_denominator() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 0), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_invalid_sar_both_zero() {
        let (w, h) = calc_display_dims(1920, 1080, (0, 0), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_negative_sar() {
        let (w, h) = calc_display_dims(1920, 1080, (-1, 1), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_8k_portrait_capcut() {
        let (w, h) = calc_display_dims(4320, 7680, (0, 1), 0);
        assert_eq!((w, h), (4320, 7680));
    }

    #[test]
    fn test_iphone_portrait_rotation() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 90);
        assert_eq!((w, h), (1080, 1920));
    }

    #[test]
    fn test_combined_sar_and_rotation() {
        let (w, h) = calc_display_dims(1920, 1080, (81, 256), 90);
        assert_eq!((w, h), (1080, 608));
    }

    #[test]
    fn test_extreme_sar_wide() {
        let (w, h) = calc_display_dims(1920, 1080, (16, 9), 0);
        assert_eq!((w, h), (3413, 1080));
    }

    #[test]
    fn test_extreme_sar_narrow() {
        let (w, h) = calc_display_dims(1920, 1080, (9, 16), 0);
        assert_eq!((w, h), (1080, 1080));
    }

    #[test]
    fn test_tiktok_vertical() {
        let (w, h) = calc_display_dims(1080, 1920, (1, 1), 0);
        assert_eq!((w, h), (1080, 1920));
    }

    #[test]
    fn test_instagram_square() {
        let (w, h) = calc_display_dims(1080, 1080, (1, 1), 0);
        assert_eq!((w, h), (1080, 1080));
    }

    #[test]
    fn test_ultrawide_cinema() {
        let (w, h) = calc_display_dims(2560, 1080, (1, 1), 0);
        assert_eq!((w, h), (2560, 1080));
    }

    #[test]
    fn test_old_4_3_tv() {
        let (w, h) = calc_display_dims(640, 480, (1, 1), 0);
        assert_eq!((w, h), (640, 480));
    }

    #[test]
    fn test_dvd_anamorphic() {
        let (w, h) = calc_display_dims(720, 480, (32, 27), 0);
        assert_eq!((w, h), (853, 480));
    }

    #[test]
    fn test_pal_dvd_anamorphic() {
        let (w, h) = calc_display_dims(720, 576, (64, 45), 0);
        assert_eq!((w, h), (1024, 576));
    }

    #[test]
    fn test_zero_dimensions() {
        let (w, h) = calc_display_dims(0, 0, (1, 1), 0);
        assert_eq!((w, h), (0, 0));
    }

    #[test]
    fn test_single_pixel() {
        let (w, h) = calc_display_dims(1, 1, (1, 1), 0);
        assert_eq!((w, h), (1, 1));
    }

    #[test]
    fn test_very_large_sar() {
        // Clamped at 4:1 SAR ratio ceiling (1920 * 4.0 = 7680) to prevent OOM panics
        let (w, h) = calc_display_dims(1920, 1080, (1000, 1), 0);
        assert_eq!((w, h), (7680, 1080));
    }

    #[test]
    fn test_very_small_sar() {
        // Clamped at 1:4 SAR ratio floor (1920 * 0.25 = 480)
        let (w, h) = calc_display_dims(1920, 1080, (1, 1000), 0);
        assert_eq!((w, h), (480, 1080));
    }

    #[test]
    fn test_color_metadata_normalizes_common_sdr_values() {
        let metadata = super::color_metadata(
            ffmpeg::ffi::AVColorRange::AVCOL_RANGE_MPEG,
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_BT709,
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_BT709,
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_BT709,
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_LEFT,
        );

        assert_eq!(metadata.range, "limited");
        assert_eq!(metadata.matrix, "bt709");
        assert_eq!(metadata.primaries, "bt709");
        assert_eq!(metadata.transfer, "bt709");
        assert_eq!(metadata.chroma_location, "left");
        assert_eq!(metadata.range_code, 1);
        assert_eq!(metadata.matrix_code, 1);
    }

    #[test]
    fn test_color_metadata_preserves_unknown_codes() {
        let metadata = super::color_metadata(
            ffmpeg::ffi::AVColorRange::AVCOL_RANGE_UNSPECIFIED,
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_UNSPECIFIED,
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_UNSPECIFIED,
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_UNSPECIFIED,
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_UNSPECIFIED,
        );

        assert_eq!(metadata.range, "unspecified");
        assert_eq!(metadata.matrix, "unspecified");
        assert_eq!(metadata.primaries, "unspecified");
        assert_eq!(metadata.transfer, "unspecified");
        assert_eq!(metadata.chroma_location, "unspecified");

        let json = serde_json::to_value(&metadata).expect("metadata should serialize");
        assert_eq!(json["range"], "unspecified");
        assert_eq!(json["rangeCode"], 0);
    }
}

#[cfg(test)]
mod still_image_tests {
    use super::{
        decide_decoder_action, normalize_converted_nv12_color, DecoderSeekAction,
        VideoColorMetadata, VideoDecoder,
    };

    #[test]
    fn hardware_format_negotiation_falls_back_to_an_offered_software_format() {
        use ffmpeg_next as ffmpeg;

        let selected = VideoDecoder::select_decoder_pixel_format(
            &[
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_YUV420P,
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE,
            ],
            Some(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11),
        );

        assert_eq!(selected, ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_YUV420P);
    }

    #[test]
    fn hardware_format_negotiation_prefers_the_attached_device_format() {
        use ffmpeg_next as ffmpeg;

        let selected = VideoDecoder::select_decoder_pixel_format(
            &[
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_YUV420P,
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11,
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE,
            ],
            Some(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11),
        );

        assert_eq!(selected, ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_av1_hardware_detection_matches_platform_capability() {
        let is_hw_supported = VideoDecoder::macos_supports_hw_av1();
        // On M1/M2/Intel, VTIsHardwareDecodeSupported('av01') is false.
        // On M3/M4, it is true. Either is valid, but the query must run safely and return a bool.
        let _: bool = is_hw_supported;
    }

    #[test]
    fn rgb_still_image_metadata_becomes_native_sdr_nv12_metadata() {
        let rgb = VideoColorMetadata {
            matrix: "rgb".to_string(),
            ..VideoColorMetadata::default()
        };

        let normalized = normalize_converted_nv12_color(rgb);

        assert_eq!(normalized.matrix, "bt709");
        assert_eq!(normalized.transfer, "srgb");
        assert_eq!(normalized.primaries, "bt709");
        assert_eq!(normalized.range, "full");
    }

    #[test]
    fn already_supported_yuv_metadata_is_preserved() {
        let yuv = VideoColorMetadata {
            matrix: "bt601_625".to_string(),
            transfer: "bt709".to_string(),
            range: "limited".to_string(),
            ..VideoColorMetadata::default()
        };

        assert_eq!(normalize_converted_nv12_color(yuv.clone()), yuv);
    }

    #[test]
    fn durationless_png_decodes_at_zero_timestamp() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/clypra.png");
        let mut decoder = VideoDecoder::open(
            fixture
                .to_str()
                .expect("repository fixture path should be valid UTF-8"),
        )
        .expect("repository PNG fixture should open through FFmpeg");
        let (y_plane, uv_plane, width, height, _) = decoder
            .decode_frame_raw_nv12(0.0)
            .expect("durationless PNG should expose a decodable video packet");

        assert!(width > 0);
        assert!(height > 0);
        assert_eq!(y_plane.len(), (width * height) as usize);
        assert_eq!(uv_plane.len(), (width * height / 2) as usize);
    }

    #[test]
    fn raw_nv12_lru_cache_serves_repeated_queries_without_redecode() {
        use std::sync::Arc;

        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/clypra.png");
        let mut decoder = VideoDecoder::open(
            fixture
                .to_str()
                .expect("repository fixture path should be valid UTF-8"),
        )
        .expect("repository PNG fixture should open through FFmpeg");

        let opts = super::DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: crate::native_core::QualityTier::Full,
            is_playback: false,
            skip_hw_download: false,
            target_dimensions: None,
        };

        // First decode primes the cache
        let (y1, uv1, w1, h1, _) = decoder
            .decode_frame_raw_nv12_with_options(0.0, opts, || false)
            .expect("first decode should succeed");
        assert_eq!(decoder.raw_nv12_cache.len(), 1);

        // Second decode with exact same timestamp hits the LRU cache
        let (y2, uv2, w2, h2, _) = decoder
            .decode_frame_raw_nv12_with_options(0.0, opts, || false)
            .expect("cache hit decode should succeed");

        assert_eq!(w1, w2);
        assert_eq!(h1, h2);
        assert!(
            Arc::ptr_eq(&y1, &y2),
            "Y plane Arc should be shared from LRU cache"
        );
        assert!(
            Arc::ptr_eq(&uv1, &uv2),
            "UV plane Arc should be shared from LRU cache"
        );
    }

    #[test]
    fn raw_nv12_lru_cache_evicts_oldest_when_exceeding_capacity() {
        use super::{CachedNv12Frame, QualityTier, VideoColorMetadata, MAX_RAW_NV12_CACHE_ENTRIES};
        use std::collections::VecDeque;
        use std::sync::Arc;

        let mut cache: VecDeque<CachedNv12Frame> = VecDeque::new();
        for i in 0..25 {
            if cache.len() >= MAX_RAW_NV12_CACHE_ENTRIES {
                cache.pop_front();
            }
            cache.push_back(CachedNv12Frame {
                pts: i,
                y_plane: Arc::from(vec![i as u8]),
                uv_plane: Arc::from(vec![(i * 2) as u8]),
                width: 1920,
                height: 1080,
                color: VideoColorMetadata::default(),
                quality: QualityTier::Full,
                is_approximate: false,
            });
        }
        assert_eq!(cache.len(), MAX_RAW_NV12_CACHE_ENTRIES);
        assert_eq!(cache.front().unwrap().pts, 9); // 0..9 evicted, 9 is now front
        assert_eq!(cache.back().unwrap().pts, 24);
    }

    #[test]
    fn preview_quality_scales_nv12_planes_before_gpu_upload() {
        use super::{nv12_dimensions_for_quality, QualityTier};

        assert_eq!(
            nv12_dimensions_for_quality(3840, 2160, QualityTier::Full),
            (3840, 2160),
        );
        assert_eq!(
            nv12_dimensions_for_quality(3840, 2160, QualityTier::Half),
            (1920, 1080),
        );
        // Proxy and quarter quality intentionally share the 25% decode scale.
        // That turns a 12.4MB 4K NV12 upload into roughly 0.78MB.
        assert_eq!(
            nv12_dimensions_for_quality(3840, 2160, QualityTier::Proxy),
            (960, 540),
        );
        // NV12 must preserve even chroma-plane dimensions.
        assert_eq!(
            nv12_dimensions_for_quality(1919, 1079, QualityTier::Half),
            (958, 538),
        );
    }

    #[test]
    fn raw_nv12_cache_ignores_approximate_frame_for_exact_request() {
        use super::{CachedNv12Frame, QualityTier, VideoColorMetadata};
        use std::collections::VecDeque;
        use std::sync::Arc;

        let mut cache: VecDeque<CachedNv12Frame> = VecDeque::new();
        cache.push_back(CachedNv12Frame {
            pts: 1000,
            y_plane: Arc::from(vec![1u8]),
            uv_plane: Arc::from(vec![2u8]),
            width: 1920,
            height: 1080,
            color: VideoColorMetadata::default(),
            quality: QualityTier::Full,
            is_approximate: true,
        });

        let target_pts = 1000;
        let pts_tolerance = 5;

        // Exact request (allow_keyframe_approx == false): must NOT match
        let exact_match = cache.iter().position(|cached| {
            !cached.is_approximate && (cached.pts - target_pts).abs() <= pts_tolerance
        });
        assert_eq!(exact_match, None);

        // Approximate request (allow_keyframe_approx == true): matches
        let approx_match = cache
            .iter()
            .position(|cached| (cached.pts - target_pts).abs() <= pts_tolerance);
        assert_eq!(approx_match, Some(0));
    }

    #[test]
    fn test_mkv_video_decoder_integration() {
        let path = std::path::Path::new("/tmp/test_mkv.mkv");
        if !path.exists() {
            return;
        }

        let mut decoder = super::VideoDecoder::open(path.to_str().unwrap())
            .expect("failed to open mkv with VideoDecoder");
        assert!(
            decoder.container_format().contains("matroska"),
            "Container format should contain matroska, got: {}",
            decoder.container_format()
        );

        let res = decoder.decode_frame_raw_nv12(0.0);
        assert!(
            res.is_ok(),
            "Should successfully decode first frame: {:?}",
            res.err()
        );
        let (y, uv, w, h, _color) = res.unwrap();
        assert_eq!(w, 320);
        assert_eq!(h, 240);
        assert_eq!(y.len(), (w * h) as usize);
        assert_eq!(uv.len(), (w * h / 2) as usize);
    }

    #[tokio::test]
    async fn test_av1_video_thumbnail_and_poster_extraction() {
        let path = "/Users/AIEraDev/Documents/clypra-testing-assets/54M views · 868K reactions ｜ Guest arrivals at the Guinness World Record Attempt and Birthday Party of @djprettyplay last night ｜ Oga Yenne TV [974631751768961].mp4";
        if !std::path::Path::new(path).exists() {
            println!("Asset file does not exist, skipping");
            return;
        }

        println!("=== TEST: extract_poster_frame_command with CLI fallback ===");
        let poster_res =
            crate::commands::filmstrip::extract_poster_frame_command(path.to_string(), 17.8, 2.0)
                .await;
        println!(
            "extract_poster_frame_command result: is_ok={}, len={}",
            poster_res.is_ok(),
            poster_res.as_ref().map(|s| s.len()).unwrap_or(0)
        );
        if let Err(ref e) = poster_res {
            println!("extract_poster_frame_command error: {}", e);
        }
        assert!(
            poster_res.is_ok(),
            "extract_poster_frame_command failed: {:?}",
            poster_res.err()
        );
        let poster_data = poster_res.unwrap();
        assert!(poster_data.starts_with("data:image/webp;base64,"));
        println!(
            "Poster extraction succeeded! Data URL length: {} chars",
            poster_data.len()
        );

        // Also test legacy command fallback
        println!("=== TEST: legacy extract_poster_frame ===");
        let legacy_res = crate::commands::media::extract_poster_frame(path.to_string(), 2.0).await;
        assert!(
            legacy_res.is_ok(),
            "legacy extract_poster_frame failed: {:?}",
            legacy_res.err()
        );
        println!(
            "Legacy poster extraction succeeded! Data URL length: {} chars",
            legacy_res.unwrap().len()
        );
    }

    #[test]
    fn playback_mode_hits_newest_eligible_cached_frame_without_seek() {
        use super::{CachedNv12Frame, DecodeFrameOptions, QualityTier, VideoColorMetadata};
        use std::path::PathBuf;
        use std::sync::Arc;

        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/test_pattern.png");
        if !fixture.exists() {
            return;
        }

        let mut decoder = VideoDecoder::open(
            fixture
                .to_str()
                .expect("repository fixture path should be valid UTF-8"),
        )
        .expect("repository PNG fixture should open through FFmpeg");

        // Populate raw_nv12_cache with a frame at pts = 800
        decoder.raw_nv12_cache.push_back(CachedNv12Frame {
            pts: 800,
            y_plane: Arc::from(vec![42u8; 16]),
            uv_plane: Arc::from(vec![84u8; 8]),
            width: 4,
            height: 4,
            color: VideoColorMetadata::default(),
            quality: QualityTier::Full,
            is_approximate: false,
        });

        // Request a target timestamp whose pts is 820 (slightly ahead, within tolerance).
        // Playback mode must hit the newest eligible cached frame (at or before target)!
        let opts = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Full,
            is_playback: true,
            skip_hw_download: false,
            target_dimensions: None,
        };

        // Timestamp 820 in timebase
        let ts = 820.0 * decoder.time_base.0 as f64 / decoder.time_base.1 as f64;
        let (y, uv, w, h, _) = decoder
            .decode_frame_raw_nv12_with_options(ts, opts, || false)
            .expect("playback cache hit should succeed");

        assert_eq!(w, 4);
        assert_eq!(h, 4);
        assert_eq!(y[0], 42);
        assert_eq!(uv[0], 84);
        let activity = decoder.last_decode_activity();
        assert_eq!(activity.0, 0, "Seek count must be 0 for playback cache hit");
        assert_eq!(activity.1, 0, "Seek time must be 0 for playback cache hit");
        assert_eq!(
            activity.2, 0,
            "Decoded frames must be 0 for playback cache hit"
        );
    }

    #[test]
    fn test_decide_decoder_action_cold_start_seeks() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        assert_eq!(
            decide_decoder_action(
                true,
                -1,
                1000,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_decide_decoder_action_generation_bump_seeks() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                1040,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                true
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_decide_decoder_action_small_backward_delta_playback_reuses_current() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Small backward jitter within threshold reuses current frame without seeking
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                960,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent
        );
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                920,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent
        );
    }

    #[test]
    fn test_decide_decoder_action_large_backward_jump_loop_wrap_seeks() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Timeline drag back or loop wrap (5000 -> 1000)
        assert_eq!(
            decide_decoder_action(
                true,
                5000,
                1000,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
        // Jump exceeding backward jitter threshold
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                800,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_decide_decoder_action_sequential_forward_playback_decodes_forward() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Small forward delta within tolerance reuses current
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                1020,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent
        );

        // Forward progress decodes forward sequentially
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                1100,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::DecodeForward
        );
    }

    #[test]
    fn test_decide_decoder_action_large_forward_gap_seeks_to_keyframe() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Large forward gap beyond window seeks to avoid walking GOP
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                10000,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_decide_decoder_action_paused_seek_and_scrub_exact_frame_correctness() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Backward delta exceeding tolerance must seek (no backward jitter allowance)
        assert_eq!(
            decide_decoder_action(
                false,
                1000,
                900,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );

        // Small delta within tolerance reuses
        assert_eq!(
            decide_decoder_action(
                false,
                1000,
                1020,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent
        );

        // Forward delta within window decodes forward
        assert_eq!(
            decide_decoder_action(
                false,
                1000,
                1200,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::DecodeForward
        );

        // Forward delta beyond window seeks
        assert_eq!(
            decide_decoder_action(
                false,
                1000,
                5000,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_eligible_playback_frame_never_from_the_future() {
        let backward_jitter_threshold: i64 = 80;
        let target_pts: i64 = 1000;

        let candidate_pts: [i64; 5] = [920, 960, 1000, 1005, 1020];

        let eligible: Vec<i64> = candidate_pts
            .into_iter()
            .filter(|pts| {
                *pts <= target_pts && target_pts.saturating_sub(*pts) <= backward_jitter_threshold
            })
            .collect();

        assert_eq!(eligible, vec![920, 960, 1000]);
        let latest_eligible = eligible.into_iter().max().unwrap();
        assert_eq!(latest_eligible, 1000);
        assert!(latest_eligible <= target_pts);
    }

    /// Regression guard: a decoder in steady-state forward playback at ~2.5 frames
    /// per request must choose `DecodeForward`, not `Seek`, even when that delta is
    /// larger than `pts_tolerance`. The `forward_window` absorbs normal clock drift.
    /// Separately, a delta of exactly `forward_window + 1` must still choose `Seek`.
    #[test]
    fn test_decide_decoder_action_persistent_lag_does_not_thrash_seeks() {
        // Simulate 25 FPS source in a 12800 tick/second timebase:
        //   pts_tolerance ≈ 0.95 * (12800/25) ≈ 486 ticks
        //   forward_window (warm, 3+ sequential hits) = 2 s * 12800 = 25600 ticks
        let pts_tolerance: i64 = 486;
        let forward_window: i64 = 25600;
        let backward_jitter_threshold: i64 = pts_tolerance;

        // Steady playback at ~2.5 source frames per rendered frame = ~512 ticks.
        // 512 > pts_tolerance (486) so the action must be DecodeForward, not
        // ReuseCurrent or Seek.
        let steady_delta: i64 = 512;
        assert_eq!(
            decide_decoder_action(
                true,
                0,
                steady_delta,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::DecodeForward,
            "steady 2.5-frame delta must decode forward, not seek"
        );

        // delta == forward_window: last valid forward-decode step before seeking.
        assert_eq!(
            decide_decoder_action(
                true,
                0,
                forward_window,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::DecodeForward,
            "delta == forward_window must still decode forward"
        );

        // delta == forward_window + 1: first step beyond window, must seek.
        assert_eq!(
            decide_decoder_action(
                true,
                0,
                forward_window + 1,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek,
            "delta == forward_window + 1 must seek, not decode forward"
        );
    }

    /// Verify that the tightened backward_jitter_threshold (1× frame duration, not
    /// 2×) rejects a delta larger than one frame, which was previously accepted.
    #[test]
    fn test_backward_jitter_threshold_is_one_frame_not_two() {
        let pts_tolerance: i64 = 486;
        let forward_window: i64 = 25600;
        let backward_jitter_threshold: i64 = pts_tolerance; // 1× frame only

        // Backward delta within 1 frame (current=1000, target=520 → delta=-480).
        // -480 abs is within pts_tolerance 486, so should reuse.
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                520,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent,
            "backward delta within 1 frame must reuse current"
        );

        // Backward delta of exactly 2× pts_tolerance + 1 (was accepted before
        // tightening, must seek with 1× threshold).
        let target = 1000 - pts_tolerance * 2 - 1;
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                target,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek,
            "backward delta of 2× frame duration must seek with 1× threshold"
        );
    }
}
