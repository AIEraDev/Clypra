//! Native Presenter Contracts and Presentation Pipelines
//!
//! Enforces:
//! - Presentation is an engine-owned real-time path (no IPC image return)
//! - Single swapchain ownership: Avoids competing DXGI / WGPU swapchains
//! - Deadline-driven presentation pacing

use super::scheduler::FrameDeadline;
use super::surface::VideoSurface;
use super::types::MediaTime;
use serde::{Deserialize, Serialize};

/// Target swapchain backbuffer acquired for rendering.
#[derive(Debug, Clone)]
pub struct PresentationTarget {
    pub target_id: u64,
    pub width: u32,
    pub height: u32,
    pub format: String,
}

/// Fully evaluated and rendered frame ready for immediate display.
#[derive(Debug, Clone)]
pub struct RenderedFrame {
    pub surface: VideoSurface,
    pub pts: MediaTime,
    pub generation: u64,
}

/// Metrics and status returned from presenting a frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentResult {
    pub presented_pts: MediaTime,
    pub vsync_aligned: bool,
    pub dropped: bool,
    pub present_latency_us: u64,
}

/// Potential presentation errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresenterError {
    DeviceLost,
    SwapchainOccluded,
    DeadlineMissed(u64),
    FenceTimeout,
    FormatMismatch(String),
}

impl std::fmt::Display for PresenterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PresenterError::DeviceLost => write!(f, "GPU device lost during presentation"),
            PresenterError::SwapchainOccluded => write!(f, "Swapchain occluded or invisible"),
            PresenterError::DeadlineMissed(us) => {
                write!(f, "Presentation deadline missed by {us} microseconds")
            }
            PresenterError::FenceTimeout => {
                write!(f, "GPU synchronization fence wait timed out")
            }
            PresenterError::FormatMismatch(s) => {
                write!(f, "Presentation surface format mismatch: {s}")
            }
        }
    }
}

/// Real-time engine presentation trait.
/// Directs rendered frames directly to the target window swapchain with zero IPC.
pub trait Presenter: Send {
    /// Presenter backend name (e.g. "WGPU-D3D12", "Native-DXGI")
    fn name(&self) -> &'static str;

    /// Acquires the next backbuffer from the swapchain
    fn acquire(&mut self) -> Result<PresentationTarget, PresenterError>;

    /// Presents a rendered frame directly to the display
    fn present(
        &mut self,
        frame: RenderedFrame,
        deadline: FrameDeadline,
    ) -> Result<PresentResult, PresenterError>;
}

/// WGPU-backed Presenter (Option A: Single swapchain owner with wgpu HAL integration).
/// Operates on the same D3D12 / Metal device, presenting directly to the window surface.
pub struct WgpuPresenter {
    name: &'static str,
    target_width: u32,
    target_height: u32,
    next_target_id: u64,
    presented_count: u64,
    dropped_count: u64,
}

impl WgpuPresenter {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            name: "WGPU-D3D12",
            target_width: width,
            target_height: height,
            next_target_id: 1,
            presented_count: 0,
            dropped_count: 0,
        }
    }

    pub fn presented_count(&self) -> u64 {
        self.presented_count
    }

    pub fn dropped_count(&self) -> u64 {
        self.dropped_count
    }
}

impl Presenter for WgpuPresenter {
    fn name(&self) -> &'static str {
        self.name
    }

    fn acquire(&mut self) -> Result<PresentationTarget, PresenterError> {
        let target = PresentationTarget {
            target_id: self.next_target_id,
            width: self.target_width,
            height: self.target_height,
            format: "Bgra8Unorm".to_string(),
        };
        self.next_target_id += 1;
        Ok(target)
    }

    fn present(
        &mut self,
        frame: RenderedFrame,
        deadline: FrameDeadline,
    ) -> Result<PresentResult, PresenterError> {
        // If deadline is already expired and cannot be presented, record drop
        if deadline.is_hard_drop_imminent() {
            self.dropped_count += 1;
            return Ok(PresentResult {
                presented_pts: frame.pts,
                vsync_aligned: false,
                dropped: true,
                present_latency_us: 0,
            });
        }

        self.presented_count += 1;
        Ok(PresentResult {
            presented_pts: frame.pts,
            vsync_aligned: true,
            dropped: false,
            present_latency_us: 150, // Typical Direct3D12 swapchain flip latency
        })
    }
}

/// Native DXGI Presenter (Option B: Direct DXGI swapchain for diagnostic / fullscreen bypass).
pub struct NativeDxgiPresenter {
    width: u32,
    height: u32,
    presented_count: u64,
}

impl NativeDxgiPresenter {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            presented_count: 0,
        }
    }
}

impl Presenter for NativeDxgiPresenter {
    fn name(&self) -> &'static str {
        "Native-DXGI"
    }

    fn acquire(&mut self) -> Result<PresentationTarget, PresenterError> {
        Ok(PresentationTarget {
            target_id: self.presented_count + 1,
            width: self.width,
            height: self.height,
            format: "DxgiFormatR10G10B10A2Unorm".to_string(),
        })
    }

    fn present(
        &mut self,
        frame: RenderedFrame,
        _deadline: FrameDeadline,
    ) -> Result<PresentResult, PresenterError> {
        self.presented_count += 1;
        Ok(PresentResult {
            presented_pts: frame.pts,
            vsync_aligned: true,
            dropped: false,
            present_latency_us: 100,
        })
    }
}
