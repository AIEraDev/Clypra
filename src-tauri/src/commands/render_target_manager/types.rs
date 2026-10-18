use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::{PhysicalSize, Window};

// ---------------------------------------------------------------------------
// RenderTargetId — opaque, not semantic
// ---------------------------------------------------------------------------

static NEXT_TARGET_ID: AtomicU64 = AtomicU64::new(10); // 0-9 reserved for named constants

/// Opaque presentation destination identifier.
///
/// Semantic names are in the *calling code*, not encoded here. Named constants
/// (PROGRAM, SOURCE, EXTERNAL) are provided for convenience; they are just `u64`s.
///
/// Use [`RenderTargetId::new_unique()`] for dynamic targets (scopes, thumbnails).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RenderTargetId(pub(crate) u64);

impl RenderTargetId {
    /// The primary program monitor output.
    pub const PROGRAM: Self = Self(0);
    /// The source (clip) monitor output.
    pub const SOURCE: Self = Self(1);
    /// The external HDMI / display-port monitor output.
    pub const EXTERNAL: Self = Self(2);

    /// Allocate a new unique ID for a dynamic target (scope, thumbnail, etc.).
    pub fn new_unique() -> Self {
        Self(NEXT_TARGET_ID.fetch_add(1, Ordering::Relaxed))
    }

    pub fn raw(&self) -> u64 {
        self.0
    }
}

impl Default for RenderTargetId {
    fn default() -> Self {
        Self::PROGRAM
    }
}

impl std::fmt::Display for RenderTargetId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {
            Self::PROGRAM => write!(f, "Program"),
            Self::SOURCE => write!(f, "Source"),
            Self::EXTERNAL => write!(f, "External"),
            Self(n) => write!(f, "Target({n})"),
        }
    }
}

// ---------------------------------------------------------------------------
// RenderTargetKind — semantic metadata only
// ---------------------------------------------------------------------------

/// What kind of monitor or output this target represents.
///
/// Semantic annotation only — does not drive rendering behaviour.
/// The render engine uses [`RenderTargetId`], not this enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderTargetKind {
    ProgramMonitor,
    SourceMonitor,
    ExternalMonitor,
    Scope,
    Offscreen,
}

// ---------------------------------------------------------------------------
// MonitorId — OS display device (separate from RenderTargetId)
// ---------------------------------------------------------------------------

/// OS-level display device identifier.
///
/// Sourced from Tauri's monitor API. Separate from [`RenderTargetId`]
/// because a logical output can outlive the display it was last shown on.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MonitorId(pub String);

// ---------------------------------------------------------------------------
// PresentationTarget — where frames actually go
// ---------------------------------------------------------------------------

/// The underlying presentation mechanism for a render target.
#[allow(clippy::large_enum_variant)]
pub enum PresentationTarget {
    /// Native OS window (HWND on Windows, NSView on macOS).
    NativeWindow {
        surface: wgpu::Surface<'static>,
        window: Window,
    },
    /// Off-screen texture (export, thumbnail, test, scopes).
    Texture { texture: Arc<wgpu::Texture> },
}

impl std::fmt::Debug for PresentationTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NativeWindow { .. } => write!(f, "NativeWindow"),
            Self::Texture { .. } => write!(f, "OffscreenTexture"),
        }
    }
}

// ---------------------------------------------------------------------------
// RenderTargetState — presentation lifecycle
// ---------------------------------------------------------------------------

/// Dynamic health and presentation state for one render target.
///
/// Owns the state needed to handle external monitor unplug, window
/// minimisation, and surface loss mid-playback without crashing.
#[derive(Debug, Default)]
pub struct RenderTargetState {
    pub visible: bool,
    pub minimized: bool,
    /// `true` when the window/surface has been resized but `acquire_for_present`
    /// has not yet reconfigured the swapchain.
    pub needs_resize: bool,
    /// `true` when the wgpu surface is lost (monitor unplugged, device reset).
    /// `acquire_for_present` will attempt recovery; if it fails the frame is
    /// skipped rather than crashing.
    pub surface_lost: bool,
    /// The sequence number of the last successfully presented frame.
    pub last_presented_sequence: Option<u64>,
    /// Which OS monitor this target is currently on. `None` = unknown / headless.
    pub monitor_id: Option<MonitorId>,
}

// ---------------------------------------------------------------------------
// RenderTarget — a single presentation destination
// ---------------------------------------------------------------------------

/// A single presentation destination.
///
/// Does NOT contain rendering logic. The render engine writes a `FrameResource`
/// into a [`PresentFrame`] acquired from this target, then calls
/// `PresentFrame::present()`.
pub struct RenderTarget {
    pub id: RenderTargetId,
    pub kind: RenderTargetKind,
    pub size: PhysicalSize<u32>,
    pub surface_format: wgpu::TextureFormat,
    pub state: RenderTargetState,
    pub(crate) presentation: PresentationTarget,
    pub(crate) configuration: Option<wgpu::SurfaceConfiguration>,
}

impl std::fmt::Debug for RenderTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RenderTarget")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("size", &(self.size.width, self.size.height))
            .field("presentation", &self.presentation)
            .field("state", &self.state)
            .finish_non_exhaustive()
    }
}
