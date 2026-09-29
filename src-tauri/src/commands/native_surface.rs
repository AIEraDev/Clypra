use crate::native_core::{
    NativeGpuRuntimeStatus, NativeSurfaceGeometry, NativeSurfaceProbe, NativeSurfaceStatus,
    NATIVE_CORE_CONTRACT_VERSION,
};
use crate::wgpu_compositor::GpuContext;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::window::WindowBuilder;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, Window};

const NATIVE_PREVIEW_SURFACE_LABEL: &str = "native-preview-surface";

/// Owns the native surface for the lifetime of the preview session. The
/// surface must not be created, configured, and immediately dropped: doing so
/// only probes the platform and cannot support presentation or recovery.
pub struct NativeSurfaceRuntime {
    surface: Option<wgpu::Surface<'static>>,
    surface_window: Option<Window>,
    probe: Option<NativeSurfaceProbe>,
    configuration: Option<wgpu::SurfaceConfiguration>,
    configured_format: Option<wgpu::TextureFormat>,
    last_presentation_sequence: u64,
    runtime_epoch: u64,
    is_shown: AtomicBool,
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
            is_shown: AtomicBool::new(false),
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
            Err(
                wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated | wgpu::SurfaceError::Other,
            ) => {
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

    #[cfg(test)]
    pub(crate) fn is_shown(&self) -> bool {
        self.is_shown.load(Ordering::Acquire)
    }

    pub(crate) fn show_surface(&self) -> Result<(), String> {
        if self.is_shown.load(Ordering::Acquire) {
            return Ok(());
        }
        self.surface_window
            .as_ref()
            .ok_or_else(|| "Native preview surface window is not initialized".to_string())?
            .show()
            .map_err(|error| format!("Unable to show native preview surface: {error}"))?;
        self.is_shown.store(true, Ordering::Release);
        Ok(())
    }

    pub(crate) fn hide_surface(&self) -> Result<(), String> {
        self.is_shown.store(false, Ordering::Release);
        if let Some(window) = &self.surface_window {
            window
                .hide()
                .map_err(|error| format!("Unable to hide native preview surface: {error}"))?;
        }
        Ok(())
    }

    pub(crate) fn handle_poison_recovery(&mut self, context: &'static str) {
        log::error!(
            "[NativeSurface] Mutex was poisoned! Recovering state safely in context: {}",
            context
        );
        crate::diagnostics::warning(
            "native_surface",
            "MUTEX_POISON_RECOVERED",
            format!(
                "Recovered from poisoned NativeSurfaceRuntime mutex in {}",
                context
            ),
        );
        // Increment runtime epoch so that any in-flight presentation requests from before the panic
        // are recognized as stale and discarded safely rather than committing half-finished work.
        self.runtime_epoch = self.runtime_epoch.wrapping_add(1);
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
    // 1. Mailbox: Triple-buffering with lowest latency, no tearing, and no cross-adapter DWM stalls
    if let Some(mode) = modes
        .iter()
        .copied()
        .find(|m| *m == wgpu::PresentMode::Mailbox)
    {
        return Some(mode);
    }
    // 2. FifoRelaxed: Avoids the 60fps -> 30fps stutter cliff on hybrid laptops if late by < 1ms
    if let Some(mode) = modes
        .iter()
        .copied()
        .find(|m| *m == wgpu::PresentMode::FifoRelaxed)
    {
        return Some(mode);
    }
    // 3. AutoVsync: Modern wgpu adaptive VSync mode
    if let Some(mode) = modes
        .iter()
        .copied()
        .find(|m| *m == wgpu::PresentMode::AutoVsync)
    {
        return Some(mode);
    }
    // 4. Fifo: Strict VSync baseline fallback
    if let Some(mode) = modes
        .iter()
        .copied()
        .find(|m| *m == wgpu::PresentMode::Fifo)
    {
        return Some(mode);
    }
    modes.first().copied()
}

fn configure_surface(
    app: AppHandle,
    window: Window,
    gpu: Arc<GpuContext>,
    geometry: NativeSurfaceGeometry,
    runtime: Arc<Mutex<NativeSurfaceRuntime>>,
) -> Result<NativeSurfaceProbe, String> {
    geometry.validate()?;

    let mut runtime_state = runtime.lock().unwrap_or_else(|poisoned| {
        let mut state = poisoned.into_inner();
        state.handle_poison_recovery("configure_surface");
        state
    });
    let surface_window = if let Some(surface_window) = runtime_state.surface_window.clone() {
        #[cfg(target_os = "macos")]
        unsafe {
            let parent = app.get_window("main").unwrap_or(window);
            if let (Ok(ns_win), Ok(parent_ns_win)) =
                (surface_window.ns_window(), parent.ns_window())
            {
                let _: () = objc2::msg_send![
                    parent_ns_win as *mut objc2::runtime::AnyObject,
                    addChildWindow: ns_win as *mut objc2::runtime::AnyObject,
                    ordered: 1isize
                ];
            }
        }
        surface_window
    } else {
        let parent = app.get_window("main").unwrap_or(window);
        let dpr = if geometry.device_pixel_ratio > 0.0 {
            geometry.device_pixel_ratio as f64
        } else {
            1.0
        };
        let surface_window = WindowBuilder::new(&app, NATIVE_PREVIEW_SURFACE_LABEL)
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
            // The preview is a retained child surface parented to the main window.
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

                if let Ok(parent_ns_win) = parent.ns_window() {
                    let _: () = objc2::msg_send![
                        parent_ns_win as *mut objc2::runtime::AnyObject,
                        addChildWindow: ns_win as *mut objc2::runtime::AnyObject,
                        ordered: 1isize // NSWindowAbove = 1
                    ];
                }
            }
        }

        // On Windows, the child window must be explicitly configured so the
        // DWM compositor layers it above the WebView2 HWND with correct
        // per-pixel alpha. Without these styles the transparent child surface
        // either disappears behind the WebView2 layer or shows as a solid black
        // rectangle because DWM ignores the swapchain alpha channel.
        //
        // We declare the Win32 functions directly instead of using the `windows`
        // crate to avoid HWND type-version mismatch: Tauri itself pulls in a
        // different version of windows-core whose HWND is incompatible with ours.
        //
        // WS_EX_LAYERED  (0x0008_0000) — enables per-pixel alpha compositing
        // WS_EX_TRANSPARENT (0x0000_0020) — hit-testing falls through to WebView2
        // WS_EX_NOACTIVATE  (0x0800_0000) — focus never moves to the surface window
        #[cfg(target_os = "windows")]
        unsafe {
            const GWL_EXSTYLE: i32 = -20;
            const WS_EX_LAYERED: isize = 0x0008_0000;
            const WS_EX_TRANSPARENT: isize = 0x0000_0020;
            const WS_EX_NOACTIVATE: isize = 0x0800_0000;
            const SWP_NOSIZE: u32 = 0x0001;
            const SWP_NOMOVE: u32 = 0x0002;
            const SWP_NOZORDER: u32 = 0x0004;
            const SWP_NOACTIVATE: u32 = 0x0010;
            const SWP_FRAMECHANGED: u32 = 0x0020;
            // HWND_TOP = 0 as a pseudo-handle — keeps the window at the top of
            // its z-order tier without making it system-wide always-on-top.
            const HWND_TOP: *mut std::ffi::c_void = 0isize as *mut std::ffi::c_void;

            extern "system" {
                fn GetWindowLongPtrW(hwnd: *mut std::ffi::c_void, n_index: i32) -> isize;
                fn SetWindowLongPtrW(
                    hwnd: *mut std::ffi::c_void,
                    n_index: i32,
                    dw_new_long: isize,
                ) -> isize;
                fn SetWindowPos(
                    hwnd: *mut std::ffi::c_void,
                    hwnd_insert_after: *mut std::ffi::c_void,
                    x: i32,
                    y: i32,
                    cx: i32,
                    cy: i32,
                    u_flags: u32,
                ) -> i32;
            }

            if let Ok(hwnd) = surface_window.hwnd() {
                // hwnd() returns windows::Win32::Foundation::HWND whose inner
                // field is *mut c_void — extract it without importing the type.
                let raw: *mut std::ffi::c_void = hwnd.0;
                let ex_style = GetWindowLongPtrW(raw, GWL_EXSTYLE);
                SetWindowLongPtrW(
                    raw,
                    GWL_EXSTYLE,
                    ex_style | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
                );
                // Flush the style change to DWM immediately.
                SetWindowPos(
                    raw,
                    HWND_TOP,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
            }
        }

        runtime_state.surface_window = Some(surface_window.clone());
        runtime_state.is_shown.store(false, Ordering::Release);
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

    // Prewarm CAMetalLayer / DXGI swapchain allocation during configuration so the
    // initial backbuffer lock latency (~200-300ms on first mount) is absorbed
    // during setup rather than blocking the first frame tick.
    if let Ok(surface_texture) = surface.get_current_texture() {
        let view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("surface_prewarm_encoder"),
            });
        {
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("surface_prewarm_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
        }
        gpu.queue.submit(std::iter::once(encoder.finish()));
        surface_texture.present();
    }

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

    // Device discovery deliberately happens before a viewport is available,
    // while surface creation happens here on Tauri's UI thread. Keep their
    // status separate so callers never mistake a ready device for a ready
    // presentation target.
    if let Some(status) = app.try_state::<Arc<Mutex<NativeGpuRuntimeStatus>>>() {
        if let Ok(mut status) = status.lock() {
            status.set_surface_available(true);
        }
    }

    // The native surface window was configured and prewarmed on the UI thread.
    // Ensure it is explicitly hidden until active native playback calls show_surface();
    // otherwise the OS child window sits on top of the WebView and blocks the
    // HTML5 canvas readback preview during paused inspection.
    let _ = surface_window.hide();
    runtime_state.is_shown.store(false, Ordering::Release);

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
    fn prefers_mailbox_and_relaxed_over_fifo() {
        let modes_mailbox = [
            wgpu::PresentMode::Immediate,
            wgpu::PresentMode::Fifo,
            wgpu::PresentMode::Mailbox,
        ];
        assert_eq!(
            choose_present_mode(&modes_mailbox),
            Some(wgpu::PresentMode::Mailbox)
        );

        let modes_relaxed = [
            wgpu::PresentMode::Immediate,
            wgpu::PresentMode::Fifo,
            wgpu::PresentMode::FifoRelaxed,
        ];
        assert_eq!(
            choose_present_mode(&modes_relaxed),
            Some(wgpu::PresentMode::FifoRelaxed)
        );
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

    #[test]
    fn poison_recovery_advances_runtime_epoch() {
        let mut runtime = NativeSurfaceRuntime::new();
        let initial_epoch = runtime.runtime_epoch();

        runtime.handle_poison_recovery("test_context");

        assert_eq!(runtime.runtime_epoch(), initial_epoch.wrapping_add(1));
    }

    #[test]
    fn surface_visibility_starts_hidden_and_resets() {
        let mut runtime = NativeSurfaceRuntime::new();
        assert!(!runtime.is_shown());

        let _ = runtime.hide_surface();
        assert!(!runtime.is_shown());

        runtime.reset();
        assert!(!runtime.is_shown());
    }
}
