use super::config::configure_surface;
use super::runtime::NativeSurfaceRuntime;
use crate::native_core::{NativeGpuRuntimeStatus, NativeSurfaceGeometry, NativeSurfaceProbe};
use crate::wgpu_compositor::GpuContext;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Window};

/// Returns the last-known native GPU runtime status.
#[tauri::command]
pub fn get_native_gpu_status(app: AppHandle) -> Result<NativeGpuRuntimeStatus, String> {
    let status = app
        .try_state::<Arc<Mutex<NativeGpuRuntimeStatus>>>()
        .ok_or_else(|| "Native GPU runtime status is not initialized".to_string())?;

    status
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "Native GPU runtime status lock is poisoned".to_string())
}

/// Phase 0.5 surface setup: create/configure and retain the real native
/// surface on the UI main thread, but do not present into the editor window.
/// This validates handles, adapter compatibility, physical sizing, and
/// swapchain policy before the native surface owns the preview.
#[tauri::command]
pub async fn probe_native_surface(
    app: tauri::AppHandle,
    window: Window,
    geometry: NativeSurfaceGeometry,
) -> Result<NativeSurfaceProbe, String> {
    geometry.validate()?;
    let gpu = app
        .try_state::<Arc<GpuContext>>()
        .ok_or_else(|| "Native GPU context is not initialized".to_string())?
        .inner()
        .clone();
    let runtime = app
        .try_state::<Arc<Mutex<NativeSurfaceRuntime>>>()
        .ok_or_else(|| "Native surface runtime is not initialized".to_string())?
        .inner()
        .clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let surface_window = window.clone();
    let surface_app = app.clone();
    window
        .run_on_main_thread(move || {
            let result = configure_surface(surface_app, surface_window, gpu, geometry, runtime);
            let _ = sender.send(result);
        })
        .map_err(|error| format!("Unable to schedule native surface probe: {error}"))?;

    receiver
        .await
        .map_err(|_| "Native surface probe was cancelled".to_string())?
}

/// Reconfigure the retained native surface after a DPI or viewport resize.
/// The operation is serialized onto Tauri's UI thread because native window
/// handles and swapchain configuration are platform-owned resources.
#[tauri::command]
pub async fn resize_native_surface(
    app: tauri::AppHandle,
    window: Window,
    geometry: NativeSurfaceGeometry,
) -> Result<NativeSurfaceProbe, String> {
    geometry.validate()?;
    let gpu = app
        .try_state::<Arc<GpuContext>>()
        .ok_or_else(|| "Native GPU context is not initialized".to_string())?
        .inner()
        .clone();
    let runtime = app
        .try_state::<Arc<Mutex<NativeSurfaceRuntime>>>()
        .ok_or_else(|| "Native surface runtime is not initialized".to_string())?
        .inner()
        .clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let surface_window = window.clone();
    let surface_app = app.clone();
    window
        .run_on_main_thread(move || {
            let result = configure_surface(surface_app, surface_window, gpu, geometry, runtime);
            let _ = sender.send(result);
        })
        .map_err(|error| format!("Unable to schedule native surface resize: {error}"))?;

    receiver
        .await
        .map_err(|_| "Native surface resize was cancelled".to_string())?
}

/// Hide the child surface while the native compositor owns the preview.
/// This is a state transition, not destruction: the configured surface and
/// swapchain remain available for the next native playback frame.
#[tauri::command]
pub fn hide_native_surface(app: AppHandle) -> Result<(), String> {
    let runtime = app
        .try_state::<Arc<Mutex<NativeSurfaceRuntime>>>()
        .ok_or_else(|| "Native surface runtime is not initialized".to_string())?;
    let result = runtime
        .lock()
        .unwrap_or_else(|poisoned| {
            let mut state = poisoned.into_inner();
            state.handle_poison_recovery("hide_native_surface");
            state
        })
        .hide_surface();
    result
}

/// Return the last successfully configured native surface. Keeping this
/// separate from the GPU status lets callers distinguish device availability
/// from window-surface readiness.
#[tauri::command]
pub fn get_native_surface_status(app: AppHandle) -> Result<Option<NativeSurfaceProbe>, String> {
    let runtime = app
        .try_state::<Arc<Mutex<NativeSurfaceRuntime>>>()
        .ok_or_else(|| "Native surface runtime is not initialized".to_string())?;
    let probe = runtime
        .lock()
        .unwrap_or_else(|poisoned| {
            let mut state = poisoned.into_inner();
            state.handle_poison_recovery("get_native_surface_status");
            state
        })
        .probe();
    Ok(probe)
}
