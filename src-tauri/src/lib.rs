use tauri::Manager;

pub mod thumbnail_engine;
pub mod commands;
pub mod models;
pub mod wgpu_compositor;
pub mod ai;

use thumbnail_engine::init_thumbnail_engine;
use commands::*;



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

        for (item, label) in menu.items().map_err(|error| error.to_string())?.into_iter().zip(labels) {
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
            // Initialize thumbnail engine
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(dir) = handle.path().app_cache_dir() {
                    let _ = init_thumbnail_engine(dir).await;
                }
            });
            
            // Initialize Whisper download state
            app.manage(whisper::init_download_state());

            // Initialize MediaPipe AI tracking state
            app.manage(commands::ai::init_ai_state());

            // Initialize GPU context and 3D LUT cache
            let gpu_ctx_res = tauri::async_runtime::block_on(async {
                let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
                    backends: wgpu::Backends::PRIMARY,
                    ..Default::default()
                });
                crate::wgpu_compositor::GpuContext::select_best_gpu(&instance).await
            });

            if let Ok(gpu_ctx) = gpu_ctx_res {
                let identity = crate::wgpu_compositor::lut_texture::GpuLut3D::default_identity(
                    &gpu_ctx.device,
                    &gpu_ctx.queue,
                );
                let lut_cache = std::sync::Arc::new(crate::commands::lut::LutCache {
                    luts: dashmap::DashMap::new(),
                    default_identity: std::sync::Arc::new(identity),
                });
                app.manage(std::sync::Arc::new(gpu_ctx));
                app.manage(lut_cache);
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
            #[allow(deprecated)]
            get_video_metadata,
            extract_poster_frame,
            extract_audio_artwork,
            extract_audio_track,
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
            decode_frames_streaming,
            stream_timeline_frames_binary,
            release_video_decoder,
            prewarm_decoders,
            get_render_artifact,
            get_render_artifacts_batch,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
