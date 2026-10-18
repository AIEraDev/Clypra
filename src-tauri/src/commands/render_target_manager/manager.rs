use crate::wgpu_compositor::GpuContext;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager, PhysicalSize};

use super::frame::{PresentFrame, PresentFrameInner};
use super::types::{
    MonitorId, PresentationTarget, RenderTarget, RenderTargetId, RenderTargetKind,
    RenderTargetState,
};

// ---------------------------------------------------------------------------
// RenderTargetManager
// ---------------------------------------------------------------------------

/// Manages the set of active presentation targets.
///
/// Creating, destroying, resizing, showing, hiding, and handing out
/// presentation handles is its entire remit.
pub struct RenderTargetManager {
    targets: HashMap<RenderTargetId, RenderTarget>,
    gpu: Arc<GpuContext>,
}

impl RenderTargetManager {
    pub fn new(gpu: Arc<GpuContext>) -> Self {
        Self {
            targets: HashMap::new(),
            gpu,
        }
    }

    // -----------------------------------------------------------------------
    // Target lifecycle
    // -----------------------------------------------------------------------

    /// Get an existing target or create a new native-window target.
    ///
    /// The created window is a native child window (no WebView2 backing),
    /// transparent, decoration-free, and parented to the app's main window.
    pub fn get_or_create_target(
        &mut self,
        id: RenderTargetId,
        kind: RenderTargetKind,
        size: PhysicalSize<u32>,
        app: &AppHandle,
    ) -> Result<&mut RenderTarget, String> {
        if !self.targets.contains_key(&id) {
            let target = Self::create_native_target(id, kind, size, app, &self.gpu)?;
            self.targets.insert(id, target);
        }
        Ok(self.targets.get_mut(&id).unwrap())
    }

    /// Permanently destroy a target and release its window + surface.
    pub fn destroy_target(&mut self, id: &RenderTargetId) {
        if let Some(target) = self.targets.remove(id) {
            Self::close_presentation(target.presentation);
        }
    }

    /// Resize a target. Sets `state.needs_resize = true`; the swapchain is
    /// reconfigured lazily on the next `acquire_for_present` call so the
    /// manager does not block the calling thread waiting for the GPU.
    pub fn resize_target(
        &mut self,
        id: &RenderTargetId,
        size: PhysicalSize<u32>,
    ) -> Result<(), String> {
        let target = self
            .targets
            .get_mut(id)
            .ok_or_else(|| format!("RenderTarget {id} not found"))?;
        target.size = size;
        target.state.needs_resize = true;
        if let Some(cfg) = target.configuration.as_mut() {
            cfg.width = size.width.max(1);
            cfg.height = size.height.max(1);
        }
        Ok(())
    }

    /// Show a target window.
    pub fn show_target(&mut self, id: &RenderTargetId) -> Result<(), String> {
        let target = self
            .targets
            .get_mut(id)
            .ok_or_else(|| format!("RenderTarget {id} not found"))?;
        if let PresentationTarget::NativeWindow { window, .. } = &target.presentation {
            window
                .show()
                .map_err(|e| format!("show_target {id}: {e}"))?;
        }
        target.state.visible = true;
        Ok(())
    }

    /// Hide a target window.
    pub fn hide_target(&mut self, id: &RenderTargetId) -> Result<(), String> {
        let target = self
            .targets
            .get_mut(id)
            .ok_or_else(|| format!("RenderTarget {id} not found"))?;
        if let PresentationTarget::NativeWindow { window, .. } = &target.presentation {
            window
                .hide()
                .map_err(|e| format!("hide_target {id}: {e}"))?;
        }
        target.state.visible = false;
        Ok(())
    }

    /// Reset a single target's presentation state (sequence counter, surface
    /// config, visible flag). Does not destroy or recreate the window.
    pub fn reset_target(&mut self, id: &RenderTargetId) {
        if let Some(target) = self.targets.get_mut(id) {
            target.state.last_presented_sequence = None;
            target.state.needs_resize = false;
            target.state.surface_lost = false;
            let _ = self.hide_target(id);
        }
    }

    /// Reset all targets (on project close or GPU device reset).
    pub fn reset_all(&mut self) {
        let ids: Vec<_> = self.targets.keys().copied().collect();
        for id in ids {
            self.reset_target(&id);
        }
    }

    // -----------------------------------------------------------------------
    // Presentation
    // -----------------------------------------------------------------------

    /// Returns an iterator over IDs of targets that are active (visible,
    /// not minimized, not surface-lost).
    pub fn active_targets(&self) -> impl Iterator<Item = RenderTargetId> + '_ {
        self.targets.iter().filter_map(|(id, t)| {
            if t.state.visible && !t.state.minimized && !t.state.surface_lost {
                Some(*id)
            } else {
                None
            }
        })
    }

    /// Acquire a [`PresentFrame`] for rendering into `id`.
    ///
    /// Reconfigures the swapchain if `state.needs_resize` is set.
    /// Returns `Err` if the surface is lost and recovery fails — the caller
    /// should skip this frame and try again next tick.
    pub fn acquire_for_present(&mut self, id: &RenderTargetId) -> Result<PresentFrame, String> {
        let target = self
            .targets
            .get_mut(id)
            .ok_or_else(|| format!("RenderTarget {id} not found"))?;

        match &mut target.presentation {
            PresentationTarget::NativeWindow { surface, .. } => {
                // Reconfigure if dimensions changed.
                if target.state.needs_resize {
                    if let Some(cfg) = &target.configuration {
                        surface.configure(&self.gpu.device, cfg);
                    }
                    target.state.needs_resize = false;
                    target.state.surface_lost = false;
                }

                let surface_texture = match surface.get_current_texture() {
                    Ok(st) => st,
                    Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                        // Attempt one recovery reconfigure.
                        if let Some(cfg) = &target.configuration {
                            surface.configure(&self.gpu.device, cfg);
                        }
                        surface
                            .get_current_texture()
                            .map_err(|e| format!("Surface recovery failed for {id}: {e}"))?
                    }
                    Err(wgpu::SurfaceError::Timeout) => {
                        return Err(format!("Surface timeout for {id}"))
                    }
                    Err(e) => return Err(format!("Surface error for {id}: {e}")),
                };

                target.state.surface_lost = false;

                let view = surface_texture
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());

                Ok(PresentFrame {
                    target_id: *id,
                    view,
                    size: target.size,
                    format: target.surface_format,
                    inner: PresentFrameInner::Surface(surface_texture),
                })
            }

            PresentationTarget::Texture { .. } => Err(format!(
                "Offscreen texture presentation not yet implemented for {id}"
            )),
        }
    }

    // -----------------------------------------------------------------------
    // Monitor association
    // -----------------------------------------------------------------------

    /// Called by the OS monitor listener when the display a target is on changes.
    pub fn on_monitor_changed(&mut self, id: &RenderTargetId, monitor: Option<MonitorId>) {
        if let Some(target) = self.targets.get_mut(id) {
            target.state.monitor_id = monitor;
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn create_native_target(
        id: RenderTargetId,
        kind: RenderTargetKind,
        size: PhysicalSize<u32>,
        app: &AppHandle,
        gpu: &GpuContext,
    ) -> Result<RenderTarget, String> {
        use tauri::window::WindowBuilder;

        let label = format!("render-target-{}", id.raw());

        let parent = app.get_window("main").ok_or("Main window not found")?;

        let window = WindowBuilder::new(app, &label)
            .parent(&parent)
            .map_err(|e| format!("WindowBuilder::parent failed: {e}"))?
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .skip_taskbar(true)
            .focusable(false)
            .visible(false)
            .resizable(false)
            .inner_size(size.width as f64, size.height as f64)
            .build()
            .map_err(|e| format!("WindowBuilder::build failed for {id}: {e}"))?;

        window
            .set_ignore_cursor_events(true)
            .map_err(|e| format!("set_ignore_cursor_events failed: {e}"))?;

        // macOS: float above full-screen spaces and follow active Space.
        #[cfg(target_os = "macos")]
        unsafe {
            if let Ok(ns_win) = window.ns_window() {
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

        // Create wgpu surface on the native HWND / NSView.
        let surface = gpu
            .instance
            .create_surface(window.clone())
            .map_err(|e| format!("create_surface failed for {id}: {e}"))?;

        // Select surface format.
        let capabilities = surface.get_capabilities(&gpu.adapter);
        let surface_format = capabilities
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or_else(|| capabilities.formats[0]);

        let configuration = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            desired_maximum_frame_latency: 2,
            alpha_mode: capabilities
                .alpha_modes
                .first()
                .copied()
                .unwrap_or(wgpu::CompositeAlphaMode::Auto),
            view_formats: vec![],
        };

        surface.configure(&gpu.device, &configuration);

        Ok(RenderTarget {
            id,
            kind,
            size,
            surface_format,
            state: RenderTargetState {
                visible: false,
                ..Default::default()
            },
            presentation: PresentationTarget::NativeWindow { surface, window },
            configuration: Some(configuration),
        })
    }

    fn close_presentation(presentation: PresentationTarget) {
        if let PresentationTarget::NativeWindow { window, .. } = presentation {
            let _ = window.hide();
            let _ = window.close();
        }
    }
}
