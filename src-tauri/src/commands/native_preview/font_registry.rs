use std::path::Path;
use crate::diagnostics;

/// Register an editor font before a frame request references it. The native
/// renderer never substitutes a different family for an unregistered font.
#[tauri::command]
pub fn register_native_font(font_id: String, path: String) -> Result<u64, String> {
    if font_id.trim().is_empty() {
        return Err("Native font id must not be empty".to_string());
    }
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err("Native font registration requires an absolute filesystem path".to_string());
    }
    let bytes = std::fs::read(path).map_err(|error| {
        let message = format!("Unable to read native font '{}': {error}", path.display());
        diagnostics::error("native-font", "register-read-failed", message.clone());
        message
    })?;
    if bytes.len() > 32 * 1024 * 1024 {
        let message = "Native font exceeds the 32 MiB registration limit".to_string();
        diagnostics::error("native-font", "register-size-limit", message.clone());
        return Err(message);
    }
    register_native_font_bytes(font_id, bytes)
}

/// Register bundled/editor font bytes without requiring the WebView to expose
/// a filesystem path. This is the normal path for Vite-bundled WOFF2 assets.
#[tauri::command]
pub fn register_native_font_bytes(font_id: String, bytes: Vec<u8>) -> Result<u64, String> {
    let mut span = crate::cold_start::SpanGuard::start("c0_font_registration");
    span.set_interactive_blocking();
    if font_id.trim().is_empty() {
        span.set_ok(false);
        return Err("Native font id must not be empty".to_string());
    }
    if bytes.is_empty() {
        span.set_ok(false);
        return Err(format!("Native font '{}' has no bytes", font_id));
    }
    if bytes.len() > 32 * 1024 * 1024 {
        span.set_ok(false);
        return Err(format!(
            "Native font '{}' exceeds the 32 MiB registration limit",
            font_id
        ));
    }

    let result =
        clypra_native_core::font_registry::global_font_registry().register_font(&font_id, &bytes);
    match &result {
        Ok(_) => {
            span.finish_ok();
        }
        Err(error) => {
            diagnostics::error(
                "native-font",
                "register-failed",
                format!("{font_id}: {error}"),
            );
        }
    }
    result
}

#[tauri::command]
pub fn list_native_fonts() -> Result<Vec<String>, String> {
    Ok(clypra_native_core::font_registry::global_font_registry().list_fonts())
}

#[tauri::command]
pub fn get_native_font_warnings() -> Result<Vec<String>, String> {
    Ok(clypra_native_core::font_registry::global_font_registry().get_missing_font_warnings())
}

#[tauri::command]
pub fn clear_native_font_warnings() -> Result<(), String> {
    clypra_native_core::font_registry::global_font_registry().clear_missing_font_warnings();
    Ok(())
}

