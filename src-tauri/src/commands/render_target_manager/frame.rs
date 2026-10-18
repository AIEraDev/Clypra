use super::types::RenderTargetId;
use tauri::PhysicalSize;

// ---------------------------------------------------------------------------
// PresentFrame — abstraction over SurfaceTexture
// ---------------------------------------------------------------------------

/// Acquired from [`RenderTargetManager::acquire_for_present`].
///
/// The renderer writes into [`PresentFrame::view`], then calls
/// [`PresentFrame::present()`]. `wgpu::SurfaceTexture` is never exposed
/// outside this module — `PresentFrame` is the abstraction boundary.
///
/// When [`PresentationTarget::Texture`] (offscreen) support is added, the
/// renderer call site remains unchanged: it always receives a `PresentFrame`.
pub struct PresentFrame {
    pub target_id: RenderTargetId,
    /// Texture view to render into.
    pub view: wgpu::TextureView,
    /// Logical size of the target in pixels.
    pub size: PhysicalSize<u32>,
    /// Surface format (for render pass colour attachment).
    pub format: wgpu::TextureFormat,
    pub(crate) inner: PresentFrameInner,
}

#[allow(dead_code)]
pub(crate) enum PresentFrameInner {
    Surface(wgpu::SurfaceTexture),
    Offscreen, // future: Arc<wgpu::Texture>
}

impl PresentFrame {
    /// Consume this frame and present it to the OS compositor / swapchain.
    pub fn present(self) {
        match self.inner {
            PresentFrameInner::Surface(st) => st.present(),
            PresentFrameInner::Offscreen => { /* off-screen targets need explicit readback */ }
        }
    }
}
