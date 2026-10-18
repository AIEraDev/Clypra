use crate::native_core::NativeSurfaceProbe;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Window;

/// Owns the native surface for the lifetime of the preview session. The
/// surface must not be created, configured, and immediately dropped: doing so
/// only probes the platform and cannot support presentation or recovery.
pub struct NativeSurfaceRuntime {
    pub(super) surface: Option<wgpu::Surface<'static>>,
    pub(super) surface_window: Option<Window>,
    pub(super) parent_window: Option<Window>,
    pub(super) probe: Option<NativeSurfaceProbe>,
    pub(super) configuration: Option<wgpu::SurfaceConfiguration>,
    pub(super) configured_format: Option<wgpu::TextureFormat>,
    pub(super) last_presentation_sequence: u64,
    pub(super) runtime_epoch: u64,
    pub(super) is_shown: AtomicBool,
}

impl NativeSurfaceRuntime {
    pub fn new() -> Self {
        Self {
            surface: None,
            surface_window: None,
            parent_window: None,
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
        let surface_window = self
            .surface_window
            .as_ref()
            .ok_or_else(|| "Native preview surface window is not initialized".to_string())?;

        // ARCHITECTURE INVARIANT 16: All AppKit NSWindow operations and Win32 window
        // operations MUST execute on the main UI thread. This method is called from
        // Tokio render workers (native_preview, native_playback render loops). Dispatch
        // ALL window operations via run_on_main_thread. This is fire-and-forget
        // (non-blocking to the caller). `is_shown` is set optimistically after successful
        // dispatch to prevent duplicate dispatch on the next render frame.
        // If the closure fails (logged as warn), the next frame will not retry show —
        // a failed show indicates a window lifecycle problem that configure_surface should
        // resolve on the next session.
        let sw = surface_window.clone();

        #[cfg(target_os = "macos")]
        let parent_clone = self.parent_window.clone();

        surface_window
            .run_on_main_thread(move || {
                // Re-assert child-window stacking on every show to survive macOS
                // Spaces / full-screen transitions that can unparent the child.
                #[cfg(target_os = "macos")]
                unsafe {
                    if let Some(parent) = &parent_clone {
                        if let (Ok(ns_win), Ok(parent_ns_win)) =
                            (sw.ns_window(), parent.ns_window())
                        {
                            let _: () = objc2::msg_send![
                                parent_ns_win as *mut objc2::runtime::AnyObject,
                                addChildWindow: ns_win as *mut objc2::runtime::AnyObject,
                                ordered: 1isize // NSWindowAbove = 1
                            ];
                        }
                    }
                }

                if let Err(e) = sw.show() {
                    log::warn!("[NativeSurface] show_surface: window.show() failed: {e}");
                } else {
                    // On Windows, ensure the surface is at the top of its z-order tier
                    // after being revealed, in case DWM has reordered windows.
                    #[cfg(target_os = "windows")]
                    unsafe {
                        if let Ok(hwnd) = sw.hwnd() {
                            const HWND_TOP: *mut std::ffi::c_void = std::ptr::null_mut::<std::ffi::c_void>();
                            const SWP_NOSIZE: u32 = 0x0001;
                            const SWP_NOMOVE: u32 = 0x0002;
                            const SWP_NOACTIVATE: u32 = 0x0010;
                            const SWP_FRAMECHANGED: u32 = 0x0020;
                            extern "system" {
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
                            SetWindowPos(
                                hwnd.0,
                                HWND_TOP,
                                0,
                                0,
                                0,
                                0,
                                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                            );
                        }
                    }
                }
            })
            .map_err(|error| format!("Unable to dispatch show_surface to main thread: {error}"))?;

        // Mark as shown optimistically after successful dispatch. The main-thread
        // closure is queued but not yet executed; the flag prevents duplicate
        // dispatch on the next render frame.
        self.is_shown.store(true, Ordering::Release);
        Ok(())
    }

    pub(crate) fn hide_surface(&self) -> Result<(), String> {
        // Set is_shown to false immediately (before dispatch) so that concurrent
        // render frames see the surface as hidden and stop attempting to present.
        // window.hide() is dispatched to the main thread per Invariant 16.
        self.is_shown.store(false, Ordering::Release);
        if let Some(window) = &self.surface_window {
            let w = window.clone();
            #[cfg(target_os = "macos")]
            let parent_clone = self.parent_window.clone();
            // run_on_main_thread failure (e.g. event loop shut down) is non-fatal
            // for hide — the window will be destroyed with the session anyway.
            let _ = window.run_on_main_thread(move || {
                #[cfg(target_os = "macos")]
                unsafe {
                    if let Some(parent) = &parent_clone {
                        if let (Ok(ns_win), Ok(parent_ns_win)) =
                            (w.ns_window(), parent.ns_window())
                        {
                            let _: () = objc2::msg_send![
                                parent_ns_win as *mut objc2::runtime::AnyObject,
                                removeChildWindow: ns_win as *mut objc2::runtime::AnyObject
                            ];
                        }
                    }
                }
                if let Err(e) = w.hide() {
                    log::warn!("[NativeSurface] hide_surface: window.hide() failed: {e}");
                }
            });
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
        self.parent_window = None;
        self.probe = None;
        self.configuration = None;
        self.configured_format = None;
        self.last_presentation_sequence = 0;
        self.runtime_epoch = self.runtime_epoch.wrapping_add(1);
        if let Some(window) = surface_window {
            // window.close() is a main-thread-only AppKit/Win32 operation.
            // Dispatch to main thread per Invariant 16. Failure is non-fatal
            // because the window will be dropped along with this struct anyway.
            let w = window.clone();
            let _ = window.run_on_main_thread(move || {
                let _ = w.close();
            });
        }
    }
}
