//! Hardware Discovery & GPU Adapter Management
//!
//! Architectural Invariant:
//! ------------------------
//! - The engine discovers adapter decode and graphics capabilities upfront.
//! - The PlaybackDevice binds the render adapter and decoder adapter to the same
//!   physical GPU topology to guarantee zero CPU readback and zero cross-adapter copies.
//! - If a hybrid laptop must separate decode and render, `cross_adapter_copy` is explicitly flagged.

pub mod adapter;
pub mod capability;

pub use adapter::{
    AdapterId, AdapterRegistry, DecodeCapability, GpuAdapter, GpuAdapterIdentity, GpuVendor,
    GraphicsBackend, PlaybackDevice, VideoDecodeCapabilities,
};
pub use capability::{
    probe_hardware_capability, CapabilityTier, HardwareCapabilityProfile, RecommendedQoSConfig,
};
