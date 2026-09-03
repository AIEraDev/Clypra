use crate::native_core::{
    NativeGpuRuntimeStatus, NativeSurfaceGeometry, NativeSurfaceProbe, NativeSurfaceStatus,
    NATIVE_CORE_CONTRACT_VERSION,
};
use crate::wgpu_compositor::GpuContext;
use std::sync::{Arc, Mutex};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window,
};

const NATIVE_PREVIEW_SURFACE_LABEL: &str = "native-preview-surface";

/// Owns the native surface for the lifetime of the preview session. The
/// surface must not be created, configured, and immediately dropped: doing so
/// only probes the platform and cannot support presentation or recovery.
pub struct NativeSurfaceRuntime {
    surface: Option<wgpu::Surface<'static>>,
    surface_window: Option<WebviewWindow>,
    probe: Option<NativeSurfaceProbe>,
    configuration: Option<wgpu::SurfaceConfiguration>,
    configured_format: Option<wgpu::TextureFormat>,
    last_presentation_sequence: u64,
    runtime_epoch: u64,
}

impl NativeSurfaceRuntime {
    pub fn new() -> Self {
        Self {
            surface: None,
            surface_window: None,
            probe: None,
            configuration: None,
            configured_format: None,
            last_presentation_sequence: 0,
            runtime_epoch: 0,
        }
    }

    pub(crate) fn probe(&self) -> Option<NativeSurfaceProbe> {
        self.probe.clone()
    }

    pub(crate) fn acquire_current_texture(
        &mut self,
        device: &wgpu::Device,
    ) -> Result<wgpu::SurfaceTexture, String> {
        let surface = self
            .surface
            .as_ref()
            .ok_or_else(|| "Native surface has not been configured".to_string())?;

        match surface.get_current_texture() {
            Ok(texture) => Ok(texture),
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                let configuration = self
                    .configuration
                    .as_ref()
                    .ok_or_else(|| "Native surface has no recovery configuration".to_string())?
                    .clone();
                surface.configure(device, &configuration);
                surface
                    .get_current_texture()
                    .map_err(|error| format!("Native surface recovery failed: {error}"))
            }
            Err(wgpu::SurfaceError::Timeout) => {
                Err("Native surface acquisition timed out".to_string())
            }
            Err(wgpu::SurfaceError::OutOfMemory) => {
                Err("Native surface ran out of memory".to_string())
            }
            Err(wgpu::SurfaceError::Other) => Err("Native surface acquisition failed".to_string()),
        }
    }

    pub(crate) fn configured_format(&self) -> Option<wgpu::TextureFormat> {
        self.configured_format
    }

    pub(crate) fn accept_presentation(&mut self, sequence: u64) -> bool {
        if sequence < self.last_presentation_sequence {
            return false;
        }
        self.last_presentation_sequence = sequence;
        true
    }

    pub(crate) fn runtime_epoch(&self) -> u64 {
        self.runtime_epoch
    }

    pub(crate) fn show_surface(&self) -> Result<(), String> {
        self.surface_window
            .as_ref()
            .ok_or_else(|| "Native preview surface window is not initialized".to_string())?
            .show()
            .map_err(|error| format!("Unable to show native preview surface: {error}"))
    }

    pub(crate) fn hide_surface(&self) -> Result<(), String> {
        if let Some(window) = &self.surface_window {
            window
                .hide()
                .map_err(|error| format!("Unable to hide native preview surface: {error}"))?;
        }
        Ok(())
    }

    pub(crate) fn reset(&mut self) {
        let _ = self.hide_surface();
        // The child window and wgpu surface belong to one preview session. Do
        // not retain either across project close: a hidden child window can
        // keep platform-specific parent/coordinate state, and an in-flight
        // presentation from the old session must never be able to show it
        // after the next session has started.
        self.surface = None;
        let surface_window = self.surface_window.take();
        self.probe = None;
        self.configuration = None;
        self.configured_format = None;
        self.last_presentation_sequence = 0;
        self.runtime_epoch = self.runtime_epoch.wrapping_add(1);
        if let Some(window) = surface_window {
            let _ = window.close();
        }
    }
}

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

fn choose_surface_format(formats: &[wgpu::TextureFormat]) -> Option<wgpu::TextureFormat> {
    formats
        .iter()
        .copied()
        .find(|format| *format == wgpu::TextureFormat::Bgra8UnormSrgb)
        .or_else(|| {
            formats
                .iter()
                .copied()
                .find(|format| *format == wgpu::TextureFormat::Rgba8UnormSrgb)
        })
        .or_else(|| formats.first().copied())
}

fn choose_present_mode(modes: &[wgpu::PresentMode]) -> Option<wgpu::PresentMode> {
    modes
        .iter()
        .copied()
        .find(|mode| *mode == wgpu::PresentMode::Fifo)
        .or_else(|| modes.first().copied())
}

fn configure_surface(
    app: AppHandle,
    _window: Window,
    gpu: Arc<GpuContext>,
    geometry: NativeSurfaceGeometry,
    runtime: Arc<Mutex<NativeSurfaceRuntime>>,
) -> Result<NativeSurfaceProbe, String> {
    geometry.validate()?;

    let mut runtime_state = runtime
        .lock()
        .map_err(|_| "Native surface runtime lock is poisoned".to_string())?;
    let surface_window = if let Some(surface_window) = runtime_state.surface_window.clone() {
        surface_window
    } else {
        let parent = app
            .get_webview_window("main")
            .ok_or_else(|| "Main WebView window is unavailable".to_string())?;
        let dpr = if geometry.device_pixel_ratio > 0.0 {
            geometry.device_pixel_ratio as f64
        } else {
            1.0
        };
        let surface_window = WebviewWindowBuilder::new(
            &app,
            NATIVE_PREVIEW_SURFACE_LABEL,
            WebviewUrl::External(
                "about:blank"
                    .parse::<Url>()
                    .map_err(|error| error.to_string())?,
            ),
        )
        .parent(&parent)
        .map_err(|error| format!("Unable to parent native preview surface: {error}"))?
        .inner_size(
            geometry.width_physical as f64 / dpr,
            geometry.height_physical as f64 / dpr,
        )
        .decorations(false)
        .transparent(true)
        .shadow(false)
        // The preview is a retained child surface parented to the main WebView window.
        // It must NOT use always_on_top so it does not float over modals, dialogs,
        // or other application windows.
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|error| format!("Unable to create native preview surface window: {error}"))?;
        surface_window
            .set_ignore_cursor_events(true)
            .map_err(|error| format!("Unable to disable native surface pointer events: {error}"))?;

        #[cfg(target_os = "macos")]
        unsafe {
            if let Ok(ns_win) = surface_window.ns_window() {
                // NSWindowCollectionBehaviorFullScreenAuxiliary (1 << 8) | NSWindowCollectionBehaviorMoveToActiveSpace (1 << 1)
                let behavior: usize = (1 << 8) | (1 << 1);
                let current_behavior: usize =
                    objc2::msg_send![ns_win as *mut objc2::runtime::AnyObject, collectionBehavior];
                let _: () = objc2::msg_send![
                    ns_win as *mut objc2::runtime::AnyObject,
                    setCollectionBehavior: current_behavior | behavior
                ];
            }
        }

        runtime_state.surface_window = Some(surface_window.clone());
        surface_window
    };

    // On macOS Cocoa, window origins are anchored at the bottom-left. Setting
    // the size BEFORE position ensures Tao calculates the top-left screen
    // position using the target window height rather than an uninitialized
    // or stale height.
    surface_window
        .set_size(Size::Physical(PhysicalSize::new(
            geometry.width_physical,
            geometry.height_physical,
        )))
        .map_err(|error| format!("Unable to resize native preview surface: {error}"))?;
    surface_window
        .set_position(Position::Physical(PhysicalPosition::new(
            geometry.x_physical,
            geometry.y_physical,
        )))
        .map_err(|error| format!("Unable to position native preview surface: {error}"))?;

    let window_size = surface_window
        .inner_size()
        .map_err(|error| error.to_string())?;
    if window_size.width == 0 || window_size.height == 0 {
        return Err("Native preview surface has zero physical dimensions".to_string());
    }

    if runtime_state.surface.is_none() {
        let surface = gpu
            .instance
            .create_surface(surface_window.clone())
            .map_err(|error| format!("Unable to create native wgpu surface: {error}"))?;
        runtime_state.surface = Some(surface);
    }
    let surface = runtime_state
        .surface
        .as_ref()
        .ok_or_else(|| "Native surface was not retained after creation".to_string())?;
    let capabilities = surface.get_capabilities(&gpu.adapter);
    let format = choose_surface_format(&capabilities.formats)
        .ok_or_else(|| "Native surface has no supported texture formats".to_string())?;
    let present_mode = choose_present_mode(&capabilities.present_modes)
        .ok_or_else(|| "Native surface has no supported present modes".to_string())?;
    let alpha_mode = capabilities
        .alpha_modes
        .first()
        .copied()
        .ok_or_else(|| "Native surface has no supported alpha modes".to_string())?;

    let configuration = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        width: window_size.width,
        height: window_size.height,
        desired_maximum_frame_latency: 2,
        present_mode,
        alpha_mode,
        view_formats: vec![],
    };
    surface.configure(&gpu.device, &configuration);

    let probe = NativeSurfaceProbe {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        status: NativeSurfaceStatus::Ready,
        geometry,
        window_width_physical: window_size.width,
        window_height_physical: window_size.height,
        adapter_name: gpu.info.name.clone(),
        backend: gpu.info.backend.clone(),
        format: format!("{format:?}"),
        present_mode: format!("{present_mode:?}"),
        alpha_mode: format!("{alpha_mode:?}"),
        supported_formats: capabilities
            .formats
            .iter()
            .map(|value| format!("{value:?}"))
            .collect(),
    };

    runtime_state.configuration = Some(configuration);
    runtime_state.configured_format = Some(format);
    runtime_state.probe = Some(probe.clone());
    Ok(probe)
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
        .map_err(|_| "Native surface runtime lock is poisoned".to_string())?
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
    runtime
        .lock()
        .map_err(|_| "Native surface runtime lock is poisoned".to_string())
        .map(|runtime| runtime.probe())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_srgb_surface_formats() {
        let formats = [
            wgpu::TextureFormat::Rgba16Float,
            wgpu::TextureFormat::Bgra8UnormSrgb,
            wgpu::TextureFormat::Rgba8Unorm,
        ];
        assert_eq!(
            choose_surface_format(&formats),
            Some(wgpu::TextureFormat::Bgra8UnormSrgb)
        );
    }

    #[test]
    fn prefers_fifo_presentation() {
        let modes = [wgpu::PresentMode::Immediate, wgpu::PresentMode::Fifo];
        assert_eq!(choose_present_mode(&modes), Some(wgpu::PresentMode::Fifo));
    }

    #[test]
    fn runtime_starts_without_a_surface() {
        assert!(NativeSurfaceRuntime::new().probe().is_none());
    }

    #[test]
    fn reset_advances_runtime_epoch() {
        let mut runtime = NativeSurfaceRuntime::new();
        let initial_epoch = runtime.runtime_epoch();

        runtime.reset();

        assert_ne!(runtime.runtime_epoch(), initial_epoch);
    }

    #[test]
    fn rejects_out_of_order_surface_presentations() {
        let mut runtime = NativeSurfaceRuntime::new();
        assert!(runtime.accept_presentation(2));
        assert!(!runtime.accept_presentation(1));
        assert!(runtime.accept_presentation(3));
    }
}
