use tauri::Manager;

pub mod thumbnail_engine;
pub mod commands;
pub mod models;

use thumbnail_engine::init_thumbnail_engine;
use commands::*;

#[cfg(test)]
mod thumbnail_engine_tests;

#[cfg(test)]
mod thumbnail_engine_proptest;

#[cfg(test)]
mod decoder_pool_stress_test;

#[tauri::command]
fn set_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    rebuild_app_menu(&app, &language).map_err(|error| error.to_string())?;
    Ok(())
}

/// (Re)build and install the application menu, localized for `language`.
///
/// Previously this only ran under `#[cfg(target_os = "macos")]`, mutating the labels of
/// Tauri's auto-generated default menu in place. That left the Windows/Linux invoke a
/// silent no-op, because those platforms do not create a native menu bar by default — so
/// menu localization silently did nothing there and the frontend's `set_menu_language`
/// call had no observable effect.
///
/// We now build the menu ourselves (parameterized by language) and install it through
/// `AppHandle::set_menu` on every desktop platform, so the top-level submenu labels track
/// the UI language everywhere. The individual standard items (Copy / Paste / Quit / ...)
/// keep their OS-provided localized text and keyboard shortcuts, matching the prior
/// macOS-only behavior.
#[cfg(desktop)]
fn rebuild_app_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    language: &str,
) -> Result<(), tauri::Error> {
    let menu = build_app_menu(app, language)?;
    // `set_menu` replaces the current app-wide menu and propagates it to windows that do
    // not have their own window-specific menu set.
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(not(desktop))]
fn rebuild_app_menu(_app: &tauri::AppHandle, _language: &str) -> Result<(), tauri::Error> {
    // Native menus are a desktop-only concept; nothing to do on mobile targets.
    Ok(())
}

/// Construct a localized app menu composed of standard predefined items.
///
/// The top-level submenu labels are localized; the predefined items inside each submenu
/// use the OS-default localized text. Extend the tuple below to add more languages.
#[cfg(desktop)]
fn build_app_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    language: &str,
) -> Result<tauri::menu::Menu<R>, tauri::Error> {
    // The app currently ships two UI languages (see src/i18n/I18nProvider.tsx: "en" | "zh-TW").
    // Anything other than "zh-TW" falls back to English.
    let zh = language == "zh-TW";

    let app_name = "Clypra";
    let about_label = if zh { "關於 Clypra" } else { "About Clypra" };
    let (file, edit, view, window, help) = if zh {
        ("檔案", "編輯", "顯示方式", "視窗", "輔助說明")
    } else {
        ("File", "Edit", "View", "Window", "Help")
    };

    let app_menu = tauri::menu::SubmenuBuilder::new(app, app_name)
        .about_with_text(about_label, None)
        .separator()
        .hide()
        .separator()
        .quit()
        .build()?;
    let file_menu = tauri::menu::SubmenuBuilder::new(app, file)
        .close_window()
        .build()?;
    let edit_menu = tauri::menu::SubmenuBuilder::new(app, edit)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = tauri::menu::SubmenuBuilder::new(app, view)
        .fullscreen()
        .build()?;
    let window_menu = tauri::menu::SubmenuBuilder::new(app, window)
        .minimize()
        .maximize()
        .build()?;
    let help_menu = tauri::menu::SubmenuBuilder::new(app, help).build()?;

    tauri::menu::MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

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
            decode_export_frame,
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
            start_native_timeline_export,
            finalize_native_timeline_export,
            cancel_native_timeline_export,
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
            set_menu_language,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
