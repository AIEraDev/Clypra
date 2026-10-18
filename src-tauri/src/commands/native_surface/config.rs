use super::runtime::NativeSurfaceRuntime;
use crate::native_core::{
    NativeGpuRuntimeStatus, NativeSurfaceGeometry, NativeSurfaceProbe, NativeSurfaceStatus,
    NATIVE_CORE_CONTRACT_VERSION,
};
use crate::wgpu_compositor::GpuContext;
use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;
use tauri::window::WindowBuilder;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, Window};

pub(super) const NATIVE_PREVIEW_SURFACE_LABEL: &str = "native-preview-surface";

pub(super) fn choose_surface_format(formats: &[wgpu::TextureFormat]) -> Option<wgpu::TextureFormat> {
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

pub(super) fn choose_present_mode(modes: &[wgpu::PresentMode]) -> Option<wgpu::PresentMode> {
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

pub(super) fn configure_surface(
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
    let parent = app.get_window("main").unwrap_or(window);
    runtime_state.parent_window = Some(parent.clone());
    let surface_window = if let Some(surface_window) = runtime_state.surface_window.clone() {
        #[cfg(target_os = "macos")]
        unsafe {
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
            const HWND_TOP: *mut std::ffi::c_void = std::ptr::null_mut::<std::ffi::c_void>();

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
    #[cfg(target_os = "macos")]
    unsafe {
        if let (Ok(ns_win), Ok(parent_ns_win)) =
            (surface_window.ns_window(), parent.ns_window())
        {
            let _: () = objc2::msg_send![
                parent_ns_win as *mut objc2::runtime::AnyObject,
                removeChildWindow: ns_win as *mut objc2::runtime::AnyObject
            ];
        }
    }
    let _ = surface_window.hide();
    runtime_state.is_shown.store(false, Ordering::Release);

    Ok(probe)
}
