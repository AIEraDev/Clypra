#![allow(
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::new_without_default
)]

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub mod ai;
pub mod audio;
pub mod commands;
pub mod models;
pub mod native_audio;
pub mod native_core;
pub mod preview_golden;
pub mod sync_metrics;
pub mod thumbnail_engine;
pub mod wgpu_compositor;

use commands::*;
use thumbnail_engine::init_thumbnail_engine;

#[tauri::command]
fn set_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    if let Some(menu) = app.menu() {
        let labels: [&str; 6] = if language == "zh-TW" {
            ["Clypra", "檔案", "編輯", "顯示方式", "視窗", "輔助說明"]
        } else if language == "zh-CN" {
            ["Clypra", "文件", "编辑", "显示", "窗口", "帮助"]
        } else {
            ["Clypra", "File", "Edit", "View", "Window", "Help"]
        };

        for (item, label) in menu
            .items()
            .map_err(|error| error.to_string())?
            .into_iter()
            .zip(labels)
        {
            if let tauri::menu::MenuItemKind::Submenu(submenu) = item {
                submenu.set_text(label).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_err() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--enable-gpu-rasterization --ignore-gpu-blocklist --enable-zero-copy --allow-file-access-from-files",
            );
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // macOS uses the real traffic lights and native window corner
            // treatment with an overlay title bar. Windows/Linux switch to
            // borderless mode so the shared custom controls stay integrated
            // with the app bar.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                window
                    .set_title_bar_style(tauri::TitleBarStyle::Overlay)
                    .map_err(|error| format!("failed to enable macOS title bar overlay: {error}"))?;
            }

            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                window
                    .set_decorations(false)
                    .map_err(|error| format!("failed to enable custom title bar: {error}"))?;
            }

            // Initialize thumbnail engine
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(dir) = handle.path().app_cache_dir() {
                    let _ = init_thumbnail_engine(dir).await;
                }
            });
            sync_metrics::ensure_metrics_flush_loop();

            // Initialize Whisper download state
            app.manage(whisper::init_download_state());

            // Native frame contracts/cache are session-independent runtime
            // infrastructure. Project sessions provide the snapshot identity.
            app.manage(tokio::sync::Mutex::new(
                native_core::NativeFrameService::new(1_073_741_824)
                    .expect("native frame cache budget must be valid"),
            ));

            // Keep GPU initialization observable. Native preview callers can
            // choose a supported fallback and surface diagnostics can explain
            // why a device-backed path is unavailable on a given OS/driver.
            let native_gpu_status = Arc::new(Mutex::new(
                native_core::NativeGpuRuntimeStatus::initializing(),
            ));
            app.manage(native_gpu_status.clone());
            app.manage(Arc::new(Mutex::new(
                commands::native_surface::NativeSurfaceRuntime::new(),
            )));
            app.manage(Arc::new(tokio::sync::Mutex::new(
                commands::native_preview::NativePreviewFrameQueue::new(6),
            )));
            app.manage(Arc::new(Mutex::new(
                commands::native_playback::NativePlaybackRuntime::new(),
            )));
            app.manage(Arc::new(Mutex::new(native_audio::NativeAudioClock::new())));

            // Initialize MediaPipe AI tracking state
            app.manage(commands::ai::init_ai_state());

            // Initialize GPU context and 3D LUT cache
            let (gpu_ctx_res, surface_available) = tauri::async_runtime::block_on(async {
                let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
                    backends: wgpu::Backends::all(),
                    ..Default::default()
                });
                let surface = app
                    .get_webview_window("main")
                    .and_then(|window| instance.create_surface(window).ok());
                let surface_available = surface.is_some();
                let gpu_result =
                    crate::wgpu_compositor::GpuContext::select_best_gpu(&instance, surface.as_ref())
                        .await;
                (gpu_result, surface_available)
            });

            match gpu_ctx_res {
                Ok(gpu_ctx) => {
                    if let Ok(mut status) = native_gpu_status.lock() {
                        *status = native_core::NativeGpuRuntimeStatus::ready(
                            gpu_ctx.info.name.clone(),
                            gpu_ctx.info.backend.clone(),
                            gpu_ctx.info.device_type.clone(),
                            surface_available,
                        );
                    }

                    let identity = crate::wgpu_compositor::lut_texture::GpuLut3D::default_identity(
                        &gpu_ctx.device,
                        &gpu_ctx.queue,
                    );
                    let lut_cache = std::sync::Arc::new(crate::commands::lut::LutCache {
                        luts: dashmap::DashMap::new(),
                        default_identity: std::sync::Arc::new(identity),
                    });
                    let gpu_ctx = Arc::new(gpu_ctx);
                    let preview_session = Arc::new(tokio::sync::Mutex::new(
                        crate::wgpu_compositor::NativePreviewSession::new(gpu_ctx.clone()),
                    ));
                    app.manage(gpu_ctx);
                    app.manage(preview_session);
                    app.manage(lut_cache);
                }
                Err(error) => {
                    log::error!("Native GPU initialization failed: {error}");
                    if let Ok(mut status) = native_gpu_status.lock() {
                        *status = native_core::NativeGpuRuntimeStatus::failed(error, surface_available);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_thumbnail_cache,
            get_thumbnail_cache_stats,
            get_render_cache_stats,
            clear_thumbnail_cache,
            extract_poster_frame_command,
            get_media_metadata,
            decode_image_rgba,
            get_video_render_metadata,
            #[allow(deprecated)]
            get_video_metadata,
            extract_poster_frame,
            extract_audio_artwork,
            extract_audio_track,
            probe_media_streams,
            start_audio_extraction,
            cancel_media_job,
            get_media_job_result,
            extract_waveform_data,
            transcribe_audio_local,
            save_project,
            load_project,
            get_recent_projects,
            delete_project,
            rename_project,
            // Native FFmpeg decoder commands (fast path for thumbnails)
            decode_frame,
            decode_frame_gpu,
            decode_export_frame,
            render_native_preview_frame,
            render_native_project_frame,
            render_native_video_project_frame,
            render_native_frame,
            register_native_font,
            register_native_font_bytes,
            list_native_fonts,
            queue_native_frame,
            cancel_native_preview_requests,
            register_native_raster_asset,
            register_native_image_asset,
            present_native_frame,
            get_native_frame_service_stats,
            get_native_gpu_status,
            probe_native_surface,
            resize_native_surface,
            hide_native_surface,
            get_native_surface_status,
            configure_native_playback,
            get_native_playback_state,
            native_play,
            native_pause,
            native_seek,
            native_seek_from_audio,
            native_tick,
            native_play_from_audio,
            native_pause_from_audio,
            native_tick_from_audio,
            start_native_audio,
            stop_native_audio,
            get_native_audio_status,
            get_native_audio_diagnostics,
            pause_native_audio,
            resume_native_audio,
            set_native_audio_speed,
            set_native_audio_output,
            seek_native_audio,
            load_native_audio_clip,
            replace_native_audio_clips,
            update_native_audio_clip_parameters,
            clear_native_audio_clip,
            get_native_audio_clip,
            get_native_audio_clips,
            decode_frames_streaming,
            stream_timeline_frames_binary,
            release_video_decoder,
            prewarm_decoders,
            get_render_artifact,
            get_render_artifacts_batch,
            check_coarse_baseline_cache,
            get_decode_metrics_snapshot,
            get_sync_metrics_snapshot,
            get_disk_cache_stats,
            clear_disk_cache,
            set_cache_size_limit,
            get_cache_size_limit,
            // Video export commands
            start_video_export,
            write_export_frame,
            write_export_frames_batch,
            finalize_video_export,
            cancel_video_export,
            start_native_timeline_export,
            finalize_native_timeline_export,
            cancel_native_timeline_export,
            check_ffmpeg_available,
            get_ffmpeg_version,
            // Whisper model management & local AI caption commands
            download_whisper_model,
            delete_whisper_model,
            list_downloaded_models,
            cancel_whisper_download,
            verify_whisper_model_exists,
            generate_auto_captions,
            // Color grading and 3D LUT commands
            load_lut_cube,
            // On-device AI Engine (Silence Detection, Smart Auto-Reframe, MediaPipe Tracking)
            detect_silence_ranges,
            calculate_auto_reframe,
            run_face_tracking,
            cancel_face_tracking,
            download_mediapipe_model,
            verify_mediapipe_model,
            delete_mediapipe_model,
            // Screen recording & native smoke test commands
            trim_video,
            set_menu_language,
            run_wgpu_smoke_test,
            run_native_document_wgpu_export,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent immediate OS destruction so the webview can perform
                // unsaved-changes dirty checks, user prompt, and clean shutdown.
                api.prevent_close();
                let _ = window.emit("clypra://close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
