//! Frame memory domain and transfer operation metadata.
//!
//! # Design
//!
//! Every rendered frame crosses at least one memory boundary.  This module
//! provides a compact, fixed-size description of those crossings so the
//! telemetry pipeline can distinguish:
//!
//! - CPU-only paths (software decoder → CPU upload → GPU composition)
//! - Zero-copy paths (GPU decode → DXGI shared handle → wgpu import)
//! - GPU readback paths (GPU decode → PCIe → CPU → GPU upload)
//!
//! # Fixed-size `transfer_ops`
//!
//! [`FrameMemoryTelemetry::transfer_ops`] is a fixed array of two optional
//! operations rather than a `Vec`.  This bounds memory usage to 2 × pointer
//! size per frame sample and prevents unbounded allocation in the telemetry
//! hot path.  Real frames rarely cross more than two memory boundaries in a
//! single render operation (e.g. DXGI import then GPU→surface present).

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// MemoryDomain
// ---------------------------------------------------------------------------

/// The memory address space a frame resides in at a point in time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MemoryDomain {
    /// System RAM, accessible by the CPU.
    CpuSystem,
    /// GPU VRAM managed by Direct3D 11.
    GpuD3D11,
    /// GPU VRAM managed by Direct3D 12.
    GpuD3D12,
    /// GPU VRAM managed by Vulkan.
    GpuVulkan,
    /// GPU VRAM managed by Metal (macOS).
    GpuMetal,
    /// Domain could not be determined at runtime.
    Unknown,
}

// ---------------------------------------------------------------------------
// FrameTransferOperation
// ---------------------------------------------------------------------------

/// A single memory transfer step in the per-frame rendering pipeline.
///
/// # Classifier
///
/// `GpuToCpuReadback` requires the GPU to stall and copy pixel data back to
/// system RAM.  This is the expensive path.  It must NOT be inferred from
/// `FrameSource::CpuRgba` alone — the source of that CPU data must be
/// confirmed (decoded-to-CPU directly vs. GPU readback).
///
/// `DxgiSharedTextureImport` is the zero-copy Windows path: the D3D11
/// texture is re-wrapped as a D3D12 / wgpu texture without a PCIe transfer.
///
/// `None` means no inter-domain copy was required (e.g. intra-GPU blit only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrameTransferOperation {
    /// GPU decoded frame was read back to CPU RAM (expensive; involves PCIe stall).
    GpuToCpuReadback,
    /// CPU frame data (decoded directly to CPU) was uploaded to GPU texture.
    CpuToGpuUpload,
    /// D3D11 NT shared handle opened as D3D12/wgpu texture (zero PCIe copy).
    DxgiSharedTextureImport,
    /// No cross-domain transfer; frame stayed in the same memory domain.
    None,
}

// ---------------------------------------------------------------------------
// FrameMemoryTelemetry
// ---------------------------------------------------------------------------

/// Memory domain and transfer metadata for one rendered frame.
///
/// `transfer_ops` records up to two memory transfers in pipeline order
/// (first = earliest in the frame production chain).
///
/// Both slots default to `None`.  A frame that only uploads CPU data to the
/// GPU will fill slot 0 with `Some(CpuToGpuUpload)` and leave slot 1 as
/// `None`.  A frame that imports a DXGI texture and then blits within the
/// GPU fills slot 0 with `Some(DxgiSharedTextureImport)` and slot 1 as
/// `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameMemoryTelemetry {
    /// Where the frame data originated.
    pub source_domain: MemoryDomain,
    /// Where the frame data was consumed for rendering.
    pub dest_domain: MemoryDomain,
    /// Up to two ordered transfer steps in the pipeline.
    ///
    /// Fixed array — not `Vec` — to bound memory usage per frame sample.
    /// Slot 0 = first transfer; slot 1 = second transfer if any.
    pub transfer_ops: [Option<FrameTransferOperation>; 2],
}

impl FrameMemoryTelemetry {
    /// Construct a CPU-decode → GPU-upload memory path (the common CPU NV12 path).
    pub fn cpu_upload() -> Self {
        Self {
            source_domain: MemoryDomain::CpuSystem,
            dest_domain: MemoryDomain::GpuD3D12,
            transfer_ops: [Some(FrameTransferOperation::CpuToGpuUpload), None],
        }
    }

    /// Construct a DXGI zero-copy import path.
    pub fn dxgi_import() -> Self {
        Self {
            source_domain: MemoryDomain::GpuD3D11,
            dest_domain: MemoryDomain::GpuD3D12,
            transfer_ops: [Some(FrameTransferOperation::DxgiSharedTextureImport), None],
        }
    }

    /// Returns true if any transfer step is a GPU-to-CPU readback.
    ///
    /// A `true` result indicates a potentially expensive PCIe stall.
    /// This cannot be inferred from `FrameSource` alone — it must be
    /// recorded explicitly by the decoder/upload path.
    pub fn has_gpu_to_cpu_readback(&self) -> bool {
        self.transfer_ops
            .iter()
            .any(|op| matches!(op, Some(FrameTransferOperation::GpuToCpuReadback)))
    }

    /// Returns true if the frame used DXGI zero-copy import.
    pub fn has_dxgi_import(&self) -> bool {
        self.transfer_ops
            .iter()
            .any(|op| matches!(op, Some(FrameTransferOperation::DxgiSharedTextureImport)))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_ops_is_exactly_two_slots() {
        // Compile-time size invariant documented here as a runtime assertion.
        let mem = FrameMemoryTelemetry::cpu_upload();
        assert_eq!(mem.transfer_ops.len(), 2, "transfer_ops must have exactly 2 slots");
    }

    #[test]
    fn cpu_upload_path_is_not_readback() {
        let mem = FrameMemoryTelemetry::cpu_upload();
        assert!(!mem.has_gpu_to_cpu_readback());
        assert!(!mem.has_dxgi_import());
        assert_eq!(mem.source_domain, MemoryDomain::CpuSystem);
    }

    #[test]
    fn dxgi_import_path_is_zero_copy() {
        let mem = FrameMemoryTelemetry::dxgi_import();
        assert!(mem.has_dxgi_import());
        assert!(!mem.has_gpu_to_cpu_readback());
        assert_eq!(mem.source_domain, MemoryDomain::GpuD3D11);
        assert_eq!(mem.dest_domain, MemoryDomain::GpuD3D12);
    }

    #[test]
    fn both_slots_none_is_valid() {
        let mem = FrameMemoryTelemetry {
            source_domain: MemoryDomain::GpuMetal,
            dest_domain: MemoryDomain::GpuMetal,
            transfer_ops: [None, None],
        };
        assert!(!mem.has_gpu_to_cpu_readback());
        assert!(!mem.has_dxgi_import());
    }

    #[test]
    fn gpu_to_cpu_readback_detected() {
        let mem = FrameMemoryTelemetry {
            source_domain: MemoryDomain::GpuD3D11,
            dest_domain: MemoryDomain::CpuSystem,
            transfer_ops: [Some(FrameTransferOperation::GpuToCpuReadback), None],
        };
        assert!(mem.has_gpu_to_cpu_readback());
    }

    #[test]
    fn memory_domain_serializes() {
        let d = MemoryDomain::GpuD3D12;
        let json = serde_json::to_string(&d).expect("serialize");
        let back: MemoryDomain = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(d, back);
    }
}
