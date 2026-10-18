use std::path::Path;
use std::time::Instant;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;

use super::builder::{build_mux_args, build_segment_args};
use super::executor::run_ffmpeg;
use super::models::{
    acquire_export_slot, release_export_slot, validate_plan, HwAccelType, NativeTimelineClipPlan,
    NativeTimelineExportPlan, SelectedEncoder,
};

fn plan() -> NativeTimelineExportPlan {
    NativeTimelineExportPlan {
        output_path: "/output/movie.mp4".into(),
        width: 3840,
        height: 2160,
        frame_rate: 30.0,
        codec: "h265".into(),
        preset: "medium".into(),
        crf: 20,
        pixel_format: "yuv420p".into(),
        total_duration: 9.0,
        clips: vec![],
    }
}

#[test]
fn segment_arguments_normalize_mixed_source_formats_before_concat() {
    let output = Path::new("/tmp/segment-00.mp4");
    let main = NativeTimelineClipPlan {
        path: "/media/main-3024x1964-60fps.mov".into(),
        trim_in: 10.0,
        duration: 3.0,
        frame_count: 90,
        x: 0,
        y: -167,
        width: 3840,
        height: 2494,
        volume: 1.0,
    };
    let ident = NativeTimelineClipPlan {
        path: "/media/ident-1920x1080-30fps.mp4".into(),
        trim_in: 0.0,
        duration: 6.0,
        frame_count: 180,
        x: 0,
        y: 0,
        width: 3840,
        height: 2160,
        volume: 1.0,
    };

    let encoder = SelectedEncoder {
        codec_name: "hevc_videotoolbox".into(),
        hw_type: HwAccelType::VideoToolbox,
        hwaccel_flag: Some("videotoolbox".into()),
    };

    let main_args = build_segment_args(&plan(), &main, output, &encoder);
    let ident_args = build_segment_args(&plan(), &ident, output, &encoder);

    for args in [main_args, ident_args] {
        let joined = args.join(" ");
        assert!(joined.contains("color=c=black:s=3840x2160:r=30"));
        assert!(joined.contains("fps=30"));
        assert!(joined.contains("setsar=1"));
        assert!(joined.contains("hevc_videotoolbox"));
        assert!(joined.contains("-tag:v hvc1"));
        assert!(joined.contains("-an"));
        assert!(joined.contains("-bf 0"));
    }

    let mux_args = build_mux_args(
        &NativeTimelineExportPlan {
            clips: vec![main, ident],
            ..plan()
        },
        Path::new("/tmp/video-only.mp4"),
        Path::new("/tmp/final.mp4"),
        &[true, true],
        true,
    );
    let mux = mux_args.join(" ");
    assert!(mux.contains("aresample=48000"));
    assert!(mux.contains("concat=n=2:v=0:a=1"));
    assert!(mux.contains("-c:v copy"));
    assert!(mux.contains("-c:a aac_at"));
}

#[test]
fn export_slot_rejects_concurrent_jobs() {
    release_export_slot();
    assert!(acquire_export_slot().is_ok());
    assert_eq!(
        acquire_export_slot().unwrap_err(),
        "Another export is already running"
    );
    release_export_slot();
}

#[test]
fn plan_validation_requires_frame_exact_clip_coverage() {
    let mut invalid = plan();
    invalid.clips = vec![NativeTimelineClipPlan {
        path: "/media/main.mov".into(),
        trim_in: 0.0,
        duration: 8.0,
        frame_count: 240,
        x: 0,
        y: 0,
        width: 3840,
        height: 2160,
        volume: 1.0,
    }];
    assert!(validate_plan(&invalid)
        .unwrap_err()
        .contains("clips total 240 frames"));
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn cancellation_terminates_the_active_ffmpeg_child() {
    let token = CancellationToken::new();
    let cancel = token.clone();
    tokio::spawn(async move {
        sleep(Duration::from_millis(150)).await;
        cancel.cancel();
    });
    let started = Instant::now();
    let args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-nostdin".into(),
        "-re".into(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        "color=c=black:s=64x64:r=30:d=60".into(),
        "-f".into(),
        "null".into(),
        "-".into(),
    ];

    assert_eq!(
        run_ffmpeg(&args, &token).await.unwrap_err(),
        "Export cancelled"
    );
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn run_ffmpeg_captures_detailed_stderr_on_failure() {
    let token = CancellationToken::new();
    let args = vec![
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        "an_invalid_lavfi_filter_source_name".into(),
        "-f".into(),
        "null".into(),
        "-".into(),
    ];
    let result = run_ffmpeg(&args, &token).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("FFmpeg exited with status"));
    assert!(
        err.contains("No such filter")
            || err.contains("Error")
            || err.contains("an_invalid_lavfi")
    );
}
