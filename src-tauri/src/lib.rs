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
pub mod cold_start;
pub mod commands;
pub mod diagnostics;
pub mod engine;
pub mod golden_harness;
pub mod media_runtime;
pub mod models;
pub mod native_audio;
pub mod native_core;
pub mod preview_golden;
pub mod process_util;
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

/// Returns the cold-start span report collected since process start.
///
/// Call once at the end of frontend initialisation to surface C0–C4 timing
/// data in the session telemetry report. The call is cheap: it clones a small
/// Vec that was written only during startup.
#[tauri::command]
fn get_cold_start_report() -> cold_start::ColdStartReport {
    cold_start::get_report()
}

#[tauri::command]
fn mark_gpu_awaited() {
    cold_start::mark_gpu_awaited();
}

#[tauri::command]
fn record_frontend_launch_milestones(
    app: tauri::AppHandle,
    navigation_start_ms: Option<u64>,
    dom_content_loaded_ms: Option<u64>,
    app_mounted_ms: Option<u64>,
    shell_painted_ms: Option<u64>,
    interactive_us: Option<u64>,
    project_open_requested_wall_ms: Option<u64>,
    first_frame_painted_ms: Option<u64>,
    first_frame_painted_from_open_ms: Option<u64>,
    smooth_playback_at_us: Option<u64>,
    smooth_playback_target_fps: Option<u32>,
    document_visibility_state: Option<String>,
    document_has_focus: Option<bool>,
    window_is_focused: Option<bool>,
    window_is_visible: Option<bool>,
    quiescence_wait_ms: Option<u64>,
    app_nap_disabled: Option<bool>,
) {
    let (actual_win_foc, actual_win_vis) = if let Some(win) = app.get_webview_window("main") {
        (win.is_focused().ok(), win.is_visible().ok())
    } else {
        (None, None)
    };
    let win_foc = window_is_focused.or(actual_win_foc);
    let win_vis = window_is_visible.or(actual_win_vis);

    eprintln!("[Rust] record_frontend_launch_milestones: nav={:?}, dom={:?}, shell={:?}, interactive={:?}, doc_focus={:?}, doc_vis={:?}, win_foc={:?}, win_vis={:?}",
        navigation_start_ms, dom_content_loaded_ms, shell_painted_ms, interactive_us, document_has_focus, document_visibility_state, win_foc, win_vis);
    cold_start::record_frontend_launch_milestones(
        navigation_start_ms,
        dom_content_loaded_ms,
        app_mounted_ms,
        shell_painted_ms,
        interactive_us,
        project_open_requested_wall_ms,
        first_frame_painted_ms,
        first_frame_painted_from_open_ms,
        smooth_playback_at_us,
        smooth_playback_target_fps,
        document_visibility_state,
        document_has_focus,
        win_foc,
        win_vis,
        quiescence_wait_ms,
        app_nap_disabled,
    );
}

#[tauri::command]
fn mark_interactive() {
    cold_start::record_interactive();
}

#[tauri::command]
fn mark_project_open_requested() {
    cold_start::record_project_open_requested();
}

#[tauri::command]
fn mark_first_frame_painted() {
    cold_start::record_first_frame_painted(None);
}

#[tauri::command]
fn record_cold_start_span(
    stage: String,
    started_at_us: u64,
    work_us: u64,
    waited_us: u64,
    cached: bool,
    ok: bool,
    purpose: Option<String>,
) {
    cold_start::record_custom_span(
        stage,
        started_at_us,
        work_us,
        waited_us,
        cached,
        ok,
        purpose,
    );
}

#[tauri::command]
fn get_bench_run_config() -> cold_start::BenchRunConfig {
    let cfg = cold_start::get_bench_run_config();
    eprintln!("[Rust] get_bench_run_config called: enabled={}, report={:?}, exit={}",
        cfg.enabled, cfg.report_output_path, cfg.auto_exit);
    cfg
}

#[tauri::command]
fn write_bench_report(file_path: String, json_content: String) -> Result<(), String> {
    if !cold_start::is_bench_mode_active() {
        return Err("Benchmark report writing is only permitted when running in benchmark mode".to_string());
    }
    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp_path = format!("{file_path}.tmp.{}", std::process::id());
    std::fs::write(&tmp_path, &json_content)
        .map_err(|e| format!("Failed to write tmp report to {tmp_path}: {e}"))?;
    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to atomically rename {tmp_path} to {file_path}: {e}"))?;
    eprintln!("[Rust] write_bench_report atomically written to {}", file_path);
    Ok(())
}

#[tauri::command]
fn set_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    if let Some(menu) = app.menu() {
        let labels: [&str; 6] = match language.as_str() {
            "zh-TW" => ["Clypra", "檔案", "編輯", "顯示方式", "視窗", "輔助說明"],
            "zh-CN" => ["Clypra", "文件", "编辑", "显示", "窗口", "帮助"],
            "ru" => ["Clypra", "Файл", "Правка", "Вид", "Окно", "Справка"],
            "es" => ["Clypra", "Archivo", "Edición", "Ver", "Ventana", "Ayuda"],
            "ja" => ["Clypra", "ファイル", "編集", "表示", "ウィンドウ", "ヘルプ"],
            "de" => ["Clypra", "Datei", "Bearbeiten", "Ansicht", "Fenster", "Hilfe"],
            "fr" => ["Clypra", "Fichier", "Édition", "Affichage", "Fenêtre", "Aide"],
            "ko" => ["Clypra", "파일", "편집", "보기", "윈도우", "도움말"],
            _ => ["Clypra", "File", "Edit", "View", "Window", "Help"],
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
fn exit_app(app: tauri::AppHandle, code: Option<i32>) -> Result<(), String> {
    if !cold_start::is_bench_mode_active() {
        return Err("exit_app is only permitted when running in benchmark mode".to_string());
    }
    let exit_code = code.unwrap_or(0);
    eprintln!("[Rust] exit_app called with code {}", exit_code);
    app.exit(exit_code);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Force the process-start epoch before any background work begins so that
    // cold-start span timestamps are anchored to the real process start, not
    // the first lazy site that happens to touch PROCESS_START.
    cold_start::force_process_start();

    #[cfg(target_os = "windows")]
    {
        if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_err() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--enable-gpu-rasterization --allow-file-access-from-files",
            );
        }
    }

    let t_builder = std::time::Instant::now();
    let mut builder = tauri::Builder::default();
    crate::cold_start::record_span("c0_builder_default", t_builder, 0, false);

    let t_plugin_shell = std::time::Instant::now();
    builder = builder.plugin(tauri_plugin_shell::init());
    crate::cold_start::record_span("c0_plugin_shell", t_plugin_shell, 0, false);

    let t_plugin_opener = std::time::Instant::now();
    builder = builder.plugin(tauri_plugin_opener::init());
    crate::cold_start::record_span("c0_plugin_opener", t_plugin_opener, 0, false);

    let t_plugin_dialog = std::time::Instant::now();
    builder = builder.plugin(tauri_plugin_dialog::init());
    crate::cold_start::record_span("c0_plugin_dialog", t_plugin_dialog, 0, false);

    let t_plugin_fs = std::time::Instant::now();
    builder = builder.plugin(tauri_plugin_fs::init());
    crate::cold_start::record_span("c0_plugin_fs", t_plugin_fs, 0, false);

    let t_plugin_persisted = std::time::Instant::now();
    builder = builder.plugin(tauri_plugin_persisted_scope::init());
    crate::cold_start::record_span("c0_plugin_persisted_scope", t_plugin_persisted, 0, false);

    let t_plugin_updater = std::time::Instant::now();
    builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    crate::cold_start::record_span("c0_plugin_updater", t_plugin_updater, 0, false);

    let t_plugin_process = std::time::Instant::now();
    builder = builder.plugin(tauri_plugin_process::init());
    crate::cold_start::record_span("c0_plugin_process", t_plugin_process, 0, false);

    let builder = builder
        .setup(|app| {
            let setup_start = std::time::Instant::now();
            diagnostics::initialize(app.handle());
            let win_init_start = std::time::Instant::now();
            if let Some(window) = app.get_webview_window("main") {
                crate::cold_start::record_window_created();
                let is_vis = window.is_visible().unwrap_or(false);
                let is_foc = window.is_focused().unwrap_or(false);
                if is_vis {
                    crate::cold_start::record_window_shown();
                }
                crate::cold_start::record_window_state(is_vis, is_foc);
            }
            crate::cold_start::record_span("c0_window_init", win_init_start, 0, false);
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
                // CPU RGBA bridge frames are intentionally bounded. A 1 GiB
                // cache retained hundreds of unique M1 frames in one session.
                native_core::NativeFrameService::new(268_435_456)
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
                commands::native_preview::NativePreviewFrameQueue::new(
                    commands::native_preview::NATIVE_PREVIEW_QUEUE_CAPACITY,
                ),
            )));
            app.manage(Arc::new(
                commands::native_preview::NativePlaybackPushRuntime::default(),
            ));
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
                    // Capture start here — the span covers adapter selection,
                    // device creation, session construction, and shader compile.
                    let gpu_init_started = std::time::Instant::now();

                    // Production defaults to DX12 on Windows, but Phase 0
                    // baseline runs must be able to select Vulkan without a
                    // source change. Set either `CLYPRA_WGPU_BACKEND` or the
                    // conventional `WGPU_BACKEND` to `dx12` or `vulkan` before
                    // launching the app. The chosen request is included in
                    // the copied performance report alongside the actual
                    // adapter backend.
                    #[cfg(target_os = "windows")]
                    let (backends, requested_backend) = {
                        let requested = std::env::var("CLYPRA_WGPU_BACKEND")
                            .ok()
                            .or_else(|| std::env::var("WGPU_BACKEND").ok())
                            .map(|value| value.trim().to_ascii_lowercase())
                            .filter(|value| !value.is_empty());
                        let backends = match requested.as_deref() {
                            Some("dx12") => wgpu::Backends::DX12,
                            Some("vulkan") => wgpu::Backends::VULKAN,
                            Some(value) => {
                                log::warn!(
                                    "Ignoring unsupported Windows backend request '{value}'; use dx12 or vulkan"
                                );
                                wgpu::Backends::DX12
                            }
                            None => wgpu::Backends::DX12,
                        };
                        (backends, requested)
                    };
                    #[cfg(not(target_os = "windows"))]
                    let (backends, requested_backend) = (wgpu::Backends::PRIMARY, None);

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
                                    let mut ready = native_core::NativeGpuRuntimeStatus::ready(
                                        gpu_ctx.info.name.clone(),
                                        gpu_ctx.info.backend.clone(),
                                        gpu_ctx.info.device_type.clone(),
                                        false,
                                    );
                                    ready.set_adapter_details(
                                        gpu_ctx.info.vendor_id,
                                        gpu_ctx.info.device_id,
                                        gpu_ctx.info.driver.clone(),
                                        gpu_ctx.info.driver_info.clone(),
                                        gpu_ctx.info.is_software_adapter,
                                    );
                                    ready.set_requested_backend(requested_backend.clone());
                                    *s = ready;
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
                            // Record cold-start span: covers adapter selection,
                            // device creation, pipeline compile, and LUT init.
                            let ready_at_us = crate::cold_start::PROCESS_START
                                .elapsed()
                                .as_micros()
                                .min(u64::MAX as u128) as u64;
                            let awaited_at_us = crate::cold_start::get_gpu_awaited_at_us();
                            let waited_us = if awaited_at_us > 0 {
                                ready_at_us.saturating_sub(awaited_at_us)
                            } else {
                                0
                            };
                            crate::cold_start::record_span(
                                "c0_gpu_init",
                                gpu_init_started,
                                waited_us,
                                false,
                            );
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
                                    let mut failed = native_core::NativeGpuRuntimeStatus::failed(
                                        error.clone(),
                                        false,
                                    );
                                    failed.set_requested_backend(requested_backend.clone());
                                    *s = failed;
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

            crate::cold_start::record_span("c0_setup_hook", setup_start, 0, false);
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
            render_native_preview_transport_probe,
            stream_native_playback_frames,
            open_native_playback_push_stream,
            submit_native_playback_push_frame,
            acknowledge_native_playback_push_frame,
            close_native_playback_push_stream,
            get_native_push_transport_capabilities,
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
            unregister_native_raster_asset,
            present_native_frame,
            get_native_frame_service_stats,
            get_native_frame_service_samples,
            get_native_preview_performance_report,
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
            get_engine_telemetry,
            get_playback_policy,
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
            // ── Cold-start span report & milestones ────────────────────────
            get_cold_start_report,
            mark_gpu_awaited,
            mark_interactive,
            mark_project_open_requested,
            mark_first_frame_painted,
            record_frontend_launch_milestones,
            record_cold_start_span,
            get_bench_run_config,
            write_bench_report,
            exit_app,
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
        });

    let build_start = std::time::Instant::now();
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    crate::cold_start::record_span("c0_app_build", build_start, 0, false);

    let run_start = std::time::Instant::now();
    let mut ready_recorded = false;
    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::Ready = event {
            if !ready_recorded {
                ready_recorded = true;
                crate::cold_start::record_span("c0_tauri_ready", run_start, 0, false);
                crate::cold_start::record_tauri_ready();
            }
        }
    });
}
