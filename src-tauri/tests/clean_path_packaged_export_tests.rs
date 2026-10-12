use std::env;
use tauri_app_lib::commands::binary_resolver::{is_real_executable, resolve_binary_path};
use tauri_app_lib::commands::export::run_wgpu_smoke_test;

struct EnvGuard {
    original_path: String,
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        env::set_var("PATH", &self.original_path);
        env::remove_var("CLYPRA_REQUIRE_BUNDLED_MEDIA");
    }
}

#[tokio::test]
async fn test_in_app_sidecar_resolution_and_clean_path_wgpu_export() {
    let _guard = EnvGuard {
        original_path: env::var("PATH").unwrap_or_default(),
    };

    // 1. Force strict bundled sidecar requirement and strip system package manager paths
    env::set_var("CLYPRA_REQUIRE_BUNDLED_MEDIA", "1");

    let clean_path = if cfg!(target_os = "windows") {
        "C:\\Windows\\system32;C:\\Windows"
    } else {
        "/usr/bin:/bin"
    };
    env::set_var("PATH", clean_path);

    // 2. Test app's binary resolver Tier 1 & Tier 2 lookup
    let ffmpeg_resolved = resolve_binary_path("ffmpeg");
    let Some(ffmpeg_path) = ffmpeg_resolved else {
        eprintln!(
            "  ⚠️ Skipping bundled export test: No packaged FFmpeg sidecar present in this test environment (packaged desktop releases only)."
        );
        return;
    };

    assert!(
        is_real_executable(&ffmpeg_path),
        "Resolved ffmpeg at {:?} is not a real native binary",
        ffmpeg_path
    );
    println!("  ✅ App resolved bundled FFmpeg -> {:?}", ffmpeg_path);

    let ffprobe_resolved = resolve_binary_path("ffprobe");
    let Some(ffprobe_path) = ffprobe_resolved else {
        eprintln!(
            "  ⚠️ Skipping bundled export test: No packaged FFprobe sidecar present in this test environment (packaged desktop releases only)."
        );
        return;
    };

    assert!(
        is_real_executable(&ffprobe_path),
        "Resolved ffprobe at {:?} is not a real native binary",
        ffprobe_path
    );
    println!("  ✅ App resolved bundled FFprobe -> {:?}", ffprobe_path);

    // 3. Execute Clypra's actual native export engine (wgpu rendering + stdin pipe to resolved ffmpeg)
    let temp_dir = std::env::temp_dir();
    let export_output = temp_dir.join(format!(
        "clypra_clean_path_export_{}.mp4",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    let export_str = export_output.to_string_lossy().to_string();

    println!("  Executing Clypra's run_wgpu_smoke_test export pipeline...");
    let export_result = run_wgpu_smoke_test(export_str.clone()).await;
    assert!(
        export_result.is_ok(),
        "App's run_wgpu_smoke_test failed under clean PATH: {:?}",
        export_result.err()
    );
    println!("  ✅ Export completed: {}", export_result.unwrap());

    // 4. Validate output file with the resolved ffprobe
    assert!(export_output.exists(), "Exported MP4 file does not exist");
    let meta = std::fs::metadata(&export_output).expect("Failed to read export metadata");
    assert!(
        meta.len() > 10_000,
        "Exported MP4 is too small ({} bytes)",
        meta.len()
    );

    let probe_output = std::process::Command::new(&ffprobe_path)
        .arg("-v")
        .arg("quiet")
        .arg("-print_format")
        .arg("json")
        .arg("-show_streams")
        .arg(&export_str)
        .output()
        .expect("Failed to run resolved ffprobe");

    assert!(probe_output.status.success(), "ffprobe failed on exported MP4");
    let probe_json: serde_json::Value =
        serde_json::from_slice(&probe_output.stdout).expect("Failed to parse ffprobe JSON");
    let video_stream = probe_json["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"))
        .expect("No video stream found in exported MP4");

    assert_eq!(video_stream["codec_name"], "h264");
    assert_eq!(video_stream["width"], 1280);
    assert_eq!(video_stream["height"], 720);
    println!(
        "  ✅ Probed stream verified: {} {}x{} @ 30fps",
        video_stream["codec_name"], video_stream["width"], video_stream["height"]
    );

    // Clean up
    let _ = std::fs::remove_file(&export_output);
}
