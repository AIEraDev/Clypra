#![allow(
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::new_without_default
)]

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub mod ai;
pub mod audio;
pub mod clymatte;
pub mod commands;
pub mod diagnostics;
pub mod golden_harness;
pub mod media_runtime;
pub mod models;
pub mod native_audio;
pub mod native_core;
pub mod preview_golden;
pub mod sync_metrics;
pub mod thumbnail_engine;
pub mod transfer;
pub mod wgpu_compositor;

use commands::*;
use diagnostics::crash_handler::{
    get_unreported_crashes, mark_crash_reported, purge_crash_reports,
};
use diagnostics::{
    append_perf_log_entries, close_perf_log_session, list_perf_log_files, mark_perf_log_uploaded,
    open_perf_log_session, purge_perf_logs, read_perf_log_file, upload_pending_perf_logs,
    upload_perf_log_session,
};
use thumbnail_engine::init_thumbnail_engine;

/// Returns the current process resident set size (RSS) in megabytes.
///
/// Used by the TS telemetry layer to replace hard-coded `peakRamMb` placeholders
/// with real measurements. Called at most once per flush interval (~30 s) so the
/// syscall overhead is negligible.
///
/// Returns `0` on platforms where the measurement is unavailable.
#[tauri::command]
fn get_process_memory_mb() -> u64 {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        // rusage is a plain C struct; zero-initialising it is correct
        // before passing to getrusage. The kernel fills it in atomically.
        let mut usage = unsafe { std::mem::zeroed::<libc::rusage>() };
        let rc = unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) };
        if rc != 0 {
            return 0;
        }
        // macOS reports ru_maxrss in bytes; Linux reports it in kilobytes.
        #[cfg(target_os = "macos")]
        let bytes = usage.ru_maxrss as u64;
        #[cfg(target_os = "linux")]
        let bytes = usage.ru_maxrss as u64 * 1024;
        bytes / (1024 * 1024)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        0
    }
}

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

#[tauri::command]
fn exit_app(app: tauri::AppHandle, code: Option<i32>) {
    app.exit(code.unwrap_or(0));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_err() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--enable-gpu-rasterization --allow-file-access-from-files",
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
            diagnostics::initialize(app.handle());
            // Use the operating system's window chrome everywhere. Besides
            // restoring native close/minimize/maximize behavior, this keeps
            // title-bar controls outside the editor layout so they cannot
            // displace toolbar actions when a window changes state.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                window
                    .set_title_bar_style(tauri::TitleBarStyle::Overlay)
                    .map_err(|error| {
                        format!("failed to enable macOS title bar overlay: {error}")
                    })?;
            }

            // macOS owns its application menus in the system menu bar, so keep
            // the native menu there. On Windows/Linux the same menu is rendered
            // as a separate row beneath the title bar; it duplicates editor
            // commands and wastes vertical space. Do not install it there: the
            // WebView keyboard shortcuts remain available and native window
            // controls stay in the real title bar.
            //
            // On macOS, custom Undo/Redo menu items are also necessary because
            // predefined items swallow Cmd+Z / Shift+Cmd+Z before forwarding
            // them to WKWebView unless an HTML input is active.
            // Using custom menu items ensures Cmd+Z and Shift+Cmd+Z reach both
            // editor timeline and text inputs.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

                let undo_item = MenuItemBuilder::new("Undo")
                    .id("menu-undo")
                    .accelerator("CmdOrCtrl+Z")
                    .build(app)?;

                let redo_item = MenuItemBuilder::new("Redo")
                    .id("menu-redo")
                    .accelerator("CmdOrCtrl+Shift+Z")
                    .build(app)?;

                let app_menu = SubmenuBuilder::new(app, "Clypra")
                    .about(None)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let file_menu = SubmenuBuilder::new(app, "File").close_window().build()?;

                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .item(&undo_item)
                    .item(&redo_item)
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

                let window_menu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .separator()
                    .build()?;

                let help_menu = SubmenuBuilder::new(app, "Help").build()?;

                let menu = MenuBuilder::new(app)
                    .items(&[
                        &app_menu,
                        &file_menu,
                        &edit_menu,
                        &view_menu,
                        &window_menu,
                        &help_menu,
                    ])
                    .build()?;

                app.set_menu(menu)?;

                app.on_menu_event(move |app_handle, event| match event.id().as_ref() {
                    "menu-undo" => {
                        let _ = app_handle.emit("menu-undo", ());
                    }
                    "menu-redo" => {
                        let _ = app_handle.emit("menu-redo", ());
                    }
                    _ => {}
                });
            }

            // Initialize thumbnail engine
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(dir) = handle.path().app_cache_dir() {
                    let _ = init_thumbnail_engine(dir).await;
                }
            });
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
                commands::native_preview::NativePreviewFrameQueue::new(24),
            )));
            app.manage(Arc::new(Mutex::new(
                commands::native_playback::NativePlaybackRuntime::new(),
            )));
            app.manage(Arc::new(Mutex::new(native_audio::NativeAudioClock::new())));

            // Phase 5: Session-scoped rendering performance telemetry.
            // Registered early so it's accessible from all commands, including
            // those that run before the GPU context is initialized.
            app.manage(Arc::new(wgpu_compositor::SessionTelemetryCollector::new()));

            // Initialize MediaPipe AI tracking state
            app.manage(commands::ai::init_ai_state());

            // Initialize the device-only GPU context and 3D LUT cache in a
            // background task so the Tauri event loop (and webview IPC channel)
            // are never blocked. Do not create a wgpu surface here: a surface
            // touches the platform window (CAMetalLayer on macOS) and must be
            // created on Tauri's UI thread. `probe_native_surface` owns that
            // UI-thread-only transition once the preview viewport has geometry.
            // Commands use try_state::<Arc<NativePreviewSession>>() /
            // try_state::<Arc<LutCache>>() and gracefully handle the transient
            // window where GPU init is still in flight.
            {
                let gpu_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Use PRIMARY backends only — avoids scanning Vulkan/OpenGL drivers
                    // that can stall for seconds on some Windows GPU configurations.
                    #[cfg(target_os = "windows")]
                    let backends = wgpu::Backends::DX12;
                    #[cfg(not(target_os = "windows"))]
                    let backends = wgpu::Backends::PRIMARY;

                    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
                        backends,
                        ..Default::default()
                    });
                    let gpu_result =
                        crate::wgpu_compositor::GpuContext::select_best_gpu(&instance).await;

                    let status_arc = gpu_handle
                        .try_state::<Arc<Mutex<native_core::NativeGpuRuntimeStatus>>>()
                        .map(|s| Arc::clone(&s));

                    match gpu_result {
                        Ok(gpu_ctx) => {
                            if let Some(status) = &status_arc {
                                if let Ok(mut s) = status.lock() {
                                    *s = native_core::NativeGpuRuntimeStatus::ready(
                                        gpu_ctx.info.name.clone(),
                                        gpu_ctx.info.backend.clone(),
                                        gpu_ctx.info.device_type.clone(),
                                        false,
                                    );
                                }
                            }
                            let identity =
                                crate::wgpu_compositor::lut_texture::GpuLut3D::default_identity(
                                    &gpu_ctx.device,
                                    &gpu_ctx.queue,
                                );
                            let lut_cache = Arc::new(crate::commands::lut::LutCache {
                                luts: dashmap::DashMap::new(),
                                default_identity: Arc::new(identity),
                            });
                            let gpu_ctx = Arc::new(gpu_ctx);
                            let preview_session = Arc::new(tokio::sync::Mutex::new(
                                crate::wgpu_compositor::NativePreviewSession::new(gpu_ctx.clone()),
                            ));
                            gpu_handle.manage(gpu_ctx);
                            gpu_handle.manage(preview_session);
                            gpu_handle.manage(lut_cache);
                            log::info!("🖥️ GPU context initialized and registered.");
                            // Notify the webview that the GPU is ready so the native
                            // preview surface can be configured without polling. Both
                            // app-level and window-level emission ensure global listeners
                            // receive the event in Tauri v2.
                            let _ = gpu_handle.emit("clypra://gpu-ready", ());
                            if let Some(win) = gpu_handle.get_webview_window("main") {
                                let _ = win.emit("clypra://gpu-ready", ());
                            }
                        }
                        Err(ref error) => {
                            log::error!("Native GPU initialization failed: {error}");
                            if let Some(status) = &status_arc {
                                if let Ok(mut s) = status.lock() {
                                    *s = native_core::NativeGpuRuntimeStatus::failed(
                                        error.clone(),
                                        false,
                                    );
                                }
                            }
                            // Notify the webview of the failure so it can surface
                            // a diagnostic instead of spinning forever.
                            let _ = gpu_handle.emit("clypra://gpu-failed", error.clone());
                            if let Some(win) = gpu_handle.get_webview_window("main") {
                                let _ = win.emit("clypra://gpu-failed", error.clone());
                            }
                        }
                    }
                });
            }

            // Initialize LocalSend-compatible phone transfer service
            let transfer_svc = Arc::new(transfer::TransferService::new());
            app.manage(transfer_svc.clone());
            {
                let transfer_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(data_dir) = transfer_app.path().app_data_dir() {
                        let inbox = data_dir.join("transfer_inbox");
                        let _ = std::fs::create_dir_all(&inbox);
                        if let Err(e) = transfer_svc.start(transfer_app, inbox).await {
                            log::warn!("[Transfer] Failed to start: {e}");
                        }
                    }
                });
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
            get_or_create_preview_video,
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
            get_video_scopes,
            render_native_frame,
            register_native_font,
            register_native_font_bytes,
            list_native_fonts,
            get_native_font_warnings,
            clear_native_font_warnings,
            queue_native_frame,
            cancel_native_preview_requests,
            register_native_raster_asset,
            register_native_raster_asset_raw,
            register_native_image_asset,
            present_native_frame,
            get_native_frame_service_stats,
            get_native_frame_service_samples,
            reset_native_preview_runtime,
            get_native_gpu_status,
            probe_native_surface,
            resize_native_surface,
            // ── Phase 5: Session performance telemetry ──────────────────────
            get_session_telemetry,
            reset_session_telemetry,
            hide_native_surface,
            get_native_surface_status,
            configure_native_playback,
            configure_native_playback_render,
            update_native_playback_render,
            submit_native_playback_demand,
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
            cancel_render_artifacts_batch,
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
            render_and_write_export_frame,
            render_and_write_export_frames_batch,
            finalize_video_export,
            cancel_video_export,
            start_native_timeline_export,
            finalize_native_timeline_export,
            cancel_native_timeline_export,
            check_ffmpeg_available,
            get_ffmpeg_version,
            get_media_runtime_status,
            export_creator_thumbnail,
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
            // Clymatte container & background baking commands
            clymatte_check_status,
            clymatte_register_active_matte,
            clymatte_unregister_active_matte,
            clymatte_write_frames,
            clymatte_bake_clip,
            clymatte_cancel_bake,
            // Screen recording & native smoke test commands
            trim_video,
            set_menu_language,
            exit_app,
            run_wgpu_smoke_test,
            run_native_document_wgpu_export,
            // Native crash diagnostic commands
            get_unreported_crashes,
            mark_crash_reported,
            purge_crash_reports,
            // ── Session performance log (file-based, one upload per session) ─────
            open_perf_log_session,
            append_perf_log_entries,
            close_perf_log_session,
            upload_perf_log_session,
            upload_pending_perf_logs,
            list_perf_log_files,
            purge_perf_logs,
            read_perf_log_file,
            mark_perf_log_uploaded,
            // Phone ↔ laptop file transfer (LocalSend protocol)
            get_transfer_service_status,
            get_discovered_devices,
            accept_transfer_session,
            reject_transfer_session,
            cancel_transfer_session,
            get_transfer_sessions,
            get_transfer_server_url,
            start_transfer_service,
            stop_transfer_service,
            get_transfer_qr_code,
            get_network_interfaces,
            stage_files_for_transfer,
            unstage_file,
            clear_staged_files,
            get_staged_files,
            scan_local_network,
            send_files_to_peer,
            get_transfer_save_directory,
            set_transfer_save_directory,
            open_transfer_save_directory,
            open_file_path,
            show_item_in_folder,
            update_transfer_theme,
            // ── Permissions & Diagnostics ────────────────────────────────────
            check_camera_permission,
            check_microphone_permission,
            open_camera_privacy_settings,
            open_microphone_privacy_settings,
            log_system_media_diagnostics,
            // ── Camera Recording Processing ──────────────────────────────────
            process_camera_recording,
            // ── Process memory telemetry ────────────────────────────────────
            get_process_memory_mb,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Prevent immediate OS destruction so the webview can perform
                    // unsaved-changes dirty checks, user prompt, and clean shutdown.
                    api.prevent_close();
                    let _ = window.emit("clypra://close-requested", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
