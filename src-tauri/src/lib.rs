use tauri::Manager;

pub mod commands;
pub mod models;
pub mod thumbnail_engine;

use commands::*;
use thumbnail_engine::init_thumbnail_engine;

#[cfg(test)]
mod thumbnail_engine_tests;

#[cfg(test)]
mod thumbnail_engine_proptest;

#[cfg(test)]
mod decoder_pool_stress_test;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            decode_frames_streaming,
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
            check_ffmpeg_available,
            get_ffmpeg_version,
            // Whisper model management commands
            download_whisper_model,
            delete_whisper_model,
            list_downloaded_models,
            cancel_whisper_download,
            verify_whisper_model_exists,
            // Screen recording commands
            trim_video,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
