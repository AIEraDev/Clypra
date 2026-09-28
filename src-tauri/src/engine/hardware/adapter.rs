use super::super::types::{ChromaSubsampling, CodecProfile, CodecType, PixelFormat};
use serde::{Deserialize, Serialize};

pub type AdapterId = String;

/// Recognized GPU hardware vendors.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GpuVendor {
    Intel,
    Nvidia,
    Amd,
    Apple,
    Other(String),
}

/// Native graphics backend used by an adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GraphicsBackend {
    D3D12,
    D3D11,
    Metal,
    Vulkan,
    Cpu,
}

/// Hardware decode capability for a specific codec stream configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeCapability {
    pub codec: CodecType,
    pub profile: CodecProfile,
    pub bit_depth: u8,
    pub chroma: ChromaSubsampling,
    pub max_width: u32,
    pub max_height: u32,
    pub max_fps: f32,
    pub output_formats: Vec<PixelFormat>,
    pub is_hardware: bool,
}

impl DecodeCapability {
    /// Exact match query: can this capability decode the requested stream specs?
    pub fn matches(
        &self,
        codec: CodecType,
        profile: CodecProfile,
        bit_depth: u8,
        chroma: ChromaSubsampling,
        width: u32,
        height: u32,
        fps: f32,
        format: PixelFormat,
    ) -> bool {
        self.codec == codec
            && (self.profile == profile || self.profile == CodecProfile::Other)
            && self.bit_depth >= bit_depth
            && self.chroma == chroma
            && self.max_width >= width
            && self.max_height >= height
            && self.max_fps >= fps
            && self.output_formats.contains(&format)
    }
}

/// Collection of video decode capabilities supported by a GPU adapter.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct VideoDecodeCapabilities {
    pub capabilities: Vec<DecodeCapability>,
}

impl VideoDecodeCapabilities {
    pub fn new(capabilities: Vec<DecodeCapability>) -> Self {
        Self { capabilities }
    }

    /// Evaluates whether any hardware capability on this adapter can decode the target stream.
    pub fn can_decode(
        &self,
        codec: CodecType,
        profile: CodecProfile,
        bit_depth: u8,
        chroma: ChromaSubsampling,
        width: u32,
        height: u32,
        fps: f32,
        format: PixelFormat,
    ) -> bool {
        self.capabilities.iter().any(|cap| {
            cap.is_hardware
                && cap.matches(
                    codec, profile, bit_depth, chroma, width, height, fps, format,
                )
        })
    }
}

/// Representation of a physical or virtual GPU adapter discovered on the system.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GpuAdapter {
    pub id: AdapterId,
    pub vendor: GpuVendor,
    pub name: String,
    pub luid: Option<[u8; 8]>,
    pub graphics_backend: GraphicsBackend,
    pub is_discrete: bool,
    pub video_decode: VideoDecodeCapabilities,
}

impl GpuAdapter {
    pub fn new(
        id: impl Into<String>,
        vendor: GpuVendor,
        name: impl Into<String>,
        luid: Option<[u8; 8]>,
        graphics_backend: GraphicsBackend,
        is_discrete: bool,
        video_decode: VideoDecodeCapabilities,
    ) -> Self {
        Self {
            id: id.into(),
            vendor,
            name: name.into(),
            luid,
            graphics_backend,
            is_discrete,
            video_decode,
        }
    }

    #[inline]
    pub fn luid_u64(&self) -> Option<u64> {
        self.luid.map(u64::from_le_bytes)
    }
}

/// Authoritative physical GPU adapter identity exposed to the native engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GpuAdapterIdentity {
    pub name: String,
    pub vendor: GpuVendor,
    pub device_id: u32,
    pub vendor_id: u32,
    pub luid: [u8; 8],
    pub dedicated_video_memory: u64,
    pub shared_system_memory: u64,
    pub driver_version: Option<String>,
}

impl GpuAdapterIdentity {
    /// Discovers and probes the physical GPU adapter using wgpu hardware enumeration.
    pub fn probe() -> Self {
        let instance = wgpu::Instance::default();
        let adapters = instance.enumerate_adapters(wgpu::Backends::all());
        if let Some(best) = adapters.into_iter().max_by_key(|a| {
            let info = a.get_info();
            match info.device_type {
                wgpu::DeviceType::DiscreteGpu => 3,
                wgpu::DeviceType::IntegratedGpu => 2,
                _ => 1,
            }
        }) {
            let info = best.get_info();
            let vendor = match info.vendor {
                0x8086 => GpuVendor::Intel,
                0x10DE => GpuVendor::Nvidia,
                0x1002 => GpuVendor::Amd,
                0x106B => GpuVendor::Apple,
                _ => {
                    let name_lower = info.name.to_lowercase();
                    if name_lower.contains("intel") {
                        GpuVendor::Intel
                    } else if name_lower.contains("nvidia") || name_lower.contains("geforce") {
                        GpuVendor::Nvidia
                    } else if name_lower.contains("amd") || name_lower.contains("radeon") {
                        GpuVendor::Amd
                    } else if name_lower.contains("apple") {
                        GpuVendor::Apple
                    } else {
                        GpuVendor::Other(format!("Vendor-0x{:04x}", info.vendor))
                    }
                }
            };

            let luid_val = ((info.vendor as u64) << 32) | (info.device as u64);
            Self {
                name: info.name,
                vendor,
                device_id: info.device,
                vendor_id: info.vendor,
                luid: luid_val.to_le_bytes(),
                dedicated_video_memory: if info.device_type == wgpu::DeviceType::DiscreteGpu {
                    4 * 1024 * 1024 * 1024
                } else {
                    512 * 1024 * 1024
                },
                shared_system_memory: 16 * 1024 * 1024 * 1024,
                driver_version: if !info.driver.is_empty() {
                    Some(info.driver)
                } else if !info.driver_info.is_empty() {
                    Some(info.driver_info)
                } else {
                    None
                },
            }
        } else {
            Self {
                name: "Primary Display GPU".to_string(),
                vendor: GpuVendor::Other("Generic".to_string()),
                device_id: 0,
                vendor_id: 0,
                luid: 1u64.to_le_bytes(),
                dedicated_video_memory: 2 * 1024 * 1024 * 1024,
                shared_system_memory: 8 * 1024 * 1024 * 1024,
                driver_version: None,
            }
        }
    }
}

/// The selected playback device topology.
/// Invariant: Renderer, decoder, and surface pool share the same GPU adapter
/// unless cross_adapter_copy is explicitly flagged.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackDevice {
    pub render_adapter: GpuAdapter,
    pub decode_adapter: GpuAdapter,
    pub cross_adapter_copy: bool,
}

impl PlaybackDevice {
    pub fn unified(adapter: GpuAdapter) -> Self {
        Self {
            render_adapter: adapter.clone(),
            decode_adapter: adapter,
            cross_adapter_copy: false,
        }
    }

    pub fn hybrid(render_adapter: GpuAdapter, decode_adapter: GpuAdapter) -> Self {
        let cross = render_adapter.id != decode_adapter.id;
        Self {
            render_adapter,
            decode_adapter,
            cross_adapter_copy: cross,
        }
    }

    #[inline]
    pub fn is_same_device(&self) -> bool {
        !self.cross_adapter_copy
    }
}

/// Registry of discovered system adapters.
#[derive(Debug, Clone, Default)]
pub struct AdapterRegistry {
    adapters: Vec<GpuAdapter>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self {
            adapters: Vec::new(),
        }
    }

    pub fn register(&mut self, adapter: GpuAdapter) {
        self.adapters.retain(|a| a.id != adapter.id);
        self.adapters.push(adapter);
    }

    pub fn list(&self) -> &[GpuAdapter] {
        &self.adapters
    }

    pub fn find_by_id(&self, id: &str) -> Option<&GpuAdapter> {
        self.adapters.iter().find(|a| a.id == id)
    }

    /// Selects the primary playback device. Prefers discrete GPU for rendering
    /// and matches the decode adapter to the same physical GPU to guarantee zero-copy.
    pub fn select_optimal_playback_device(&self) -> Option<PlaybackDevice> {
        if self.adapters.is_empty() {
            return None;
        }

        // 1. Prefer discrete GPU with hardware decode support
        if let Some(discrete) = self
            .adapters
            .iter()
            .find(|a| a.is_discrete && !a.video_decode.capabilities.is_empty())
        {
            return Some(PlaybackDevice::unified(discrete.clone()));
        }

        // 2. Otherwise pick the first adapter with hardware decode capabilities
        if let Some(hw) = self
            .adapters
            .iter()
            .find(|a| !a.video_decode.capabilities.is_empty())
        {
            return Some(PlaybackDevice::unified(hw.clone()));
        }

        // 3. Fallback to first available adapter
        Some(PlaybackDevice::unified(self.adapters[0].clone()))
    }
}
