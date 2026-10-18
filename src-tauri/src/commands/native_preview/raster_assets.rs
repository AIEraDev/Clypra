use std::sync::Arc;
use tauri::Manager;
use crate::wgpu_compositor::NativePreviewSession;
use super::layer_models::NativeRasterAssetRegistration;

/// Register immutable browser-rendered pixels in the native GPU asset cache.
/// Subsequent versioned frame requests may reference the asset by id without
/// retransmitting its RGBA payload over IPC.
#[tauri::command]
pub async fn register_native_raster_asset(
    app: tauri::AppHandle,
    asset: NativeRasterAssetRegistration,
) -> Result<(), String> {
    if asset.asset_id.trim().is_empty() {
        return Err("Native raster asset id must be non-empty".to_string());
    }
    let raw_rgba = if let Some(b64) = &asset.rgba_base64 {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        BASE64
            .decode(b64)
            .map_err(|e| format!("Failed to decode base64 rgba: {e}"))?
    } else {
        asset.rgba
    };
    let expected_bytes = (asset.width as usize)
        .checked_mul(asset.height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Native raster asset dimensions overflow".to_string())?;
    if asset.width == 0
        || asset.height == 0
        || asset.width > 8192
        || asset.height > 8192
        || raw_rgba.len() != expected_bytes
        || raw_rgba.len() > 64 * 1024 * 1024
    {
        return Err("Native raster asset payload is invalid".to_string());
    }

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let mut session = preview_state.lock().await;
    session
        .get_or_upload_rgba_layer_to_texture(
            &asset.asset_id,
            asset.width,
            asset.height,
            Some(&raw_rgba),
        )
        .map(|_| ())
}

/// High-performance raw binary raster asset registration.
/// Accepts raw RGBA bytes directly from the IPC request body, avoiding base64
/// expansion and JSON array serialization. Headers:
/// - asset-id: string
/// - width: u32
/// - height: u32
#[tauri::command]
pub async fn register_native_raster_asset_raw(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let headers = request.headers();
    let asset_id = headers
        .get("asset-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing asset-id header".to_string())?
        .to_string();

    if asset_id.trim().is_empty() {
        return Err("Native raster asset id must be non-empty".to_string());
    }

    let width: u32 = headers
        .get("width")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "Missing or invalid width header".to_string())?;

    let height: u32 = headers
        .get("height")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "Missing or invalid height header".to_string())?;

    let tauri::ipc::InvokeBody::Raw(raw_rgba) = request.body() else {
        return Err("Expected raw binary payload for raster asset".to_string());
    };

    let expected_bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Native raster asset dimensions overflow".to_string())?;

    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || raw_rgba.len() != expected_bytes
        || raw_rgba.len() > 64 * 1024 * 1024
    {
        return Err("Native raster asset payload is invalid".to_string());
    }

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let mut session = preview_state.lock().await;
    session
        .get_or_upload_rgba_layer_to_texture(&asset_id, width, height, Some(raw_rgba))
        .map(|_| ())
}

/// Decode and upload a still-image asset without returning its pixels through
/// the WebView. This keeps first-use image activation off the JS main thread
/// and makes the native GPU cache the sole owner of the decoded raster.
#[tauri::command]
pub async fn register_native_image_asset(
    app: tauri::AppHandle,
    asset_id: String,
    path: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if asset_id.trim().is_empty() {
        return Err("Native image asset id must be non-empty".to_string());
    }
    let expected_bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Native image dimensions overflow".to_string())?;
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || expected_bytes > 64 * 1024 * 1024
    {
        return Err("Native image dimensions are outside the native limit".to_string());
    }

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;

    {
        let mut session = preview_state.lock().await;
        if session.has_rgba_layer(&asset_id, width, height) {
            return Ok(());
        }
    }

    let rgba = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::media::decode_image_rgba_bytes(&path, width, height)
    })
    .await
    .map_err(|error| format!("Native image decode task failed: {}", error))??;

    let mut session = preview_state.lock().await;
    session
        .get_or_upload_rgba_layer_to_texture(&asset_id, width, height, Some(&rgba))
        .map(|_| ())
}

/// Evict and purge a raster/image asset from the native GPU texture cache.
///
/// Immediately reclaims VRAM when media goes offline or is relinked.
#[tauri::command]
pub async fn unregister_native_raster_asset(
    app: tauri::AppHandle,
    asset_id: String,
) -> Result<(), String> {
    if asset_id.trim().is_empty() {
        return Ok(());
    }
    if let Some(preview_state) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>() {
        let mut session = preview_state.lock().await;
        session.remove_rgba_layer(&asset_id);
    }
    Ok(())
}
