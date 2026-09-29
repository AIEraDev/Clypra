use super::preview_capabilities::PreviewCapabilities;
use serde::{Deserialize, Serialize};
use wgpu::{Adapter, Device, DeviceType, Instance, Queue};

/// Detailed metadata about the active GPU adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectedGpuInfo {
    pub name: String,
    pub backend: String,
    pub device_type: String,
    pub vendor_id: u32,
    pub device_id: u32,
    pub is_discrete: bool,
    /// Backend-reported driver name. This is essential when comparing older
    /// Intel devices, where driver behavior varies by backend.
    pub driver: String,
    /// Backend-reported driver version/details, when exposed by the backend.
    pub driver_info: String,
    /// A CPU adapter is a software rasterizer (for example WARP on Windows).
    pub is_software_adapter: bool,
}

#[cfg(target_os = "windows")]
static SELECTED_DXGI_ADAPTER_INDEX: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(-1);

/// Query the DXGI adapter index that matches the active discrete wgpu GPU.
/// Used by FFmpeg D3D11VA hardware initialization to bind to the same physical adapter.
#[cfg(target_os = "windows")]
pub fn get_selected_dxgi_adapter_index() -> Option<u32> {
    let idx = SELECTED_DXGI_ADAPTER_INDEX.load(std::sync::atomic::Ordering::Relaxed);
    if idx >= 0 {
        Some(idx as u32)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
static DXGI_RUNTIME_DISABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn mark_dxgi_runtime_disabled() {
    #[cfg(target_os = "windows")]
    DXGI_RUNTIME_DISABLED.store(true, std::sync::atomic::Ordering::Relaxed);
}

pub fn is_dxgi_runtime_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        if std::env::var("CLYPRA_DISABLE_DXGI").as_deref() == Ok("1")
            || std::env::var("CLYPRA_DISABLE_DXGI_ZERO_COPY").as_deref() == Ok("1")
        {
            return false;
        }
        !DXGI_RUNTIME_DISABLED.load(std::sync::atomic::Ordering::Relaxed)
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub struct GpuContext {
    pub instance: Instance,
    pub adapter: Adapter,
    pub info: SelectedGpuInfo,
    pub capabilities: PreviewCapabilities,
    pub device: Device,
    pub queue: Queue,
    pub nv12_supported: bool,
    pub dxgi_adapter_index: Option<u32>,
}

impl GpuContext {
    /// Enumerates and scores all available graphics adapters to select the
    /// optimal device, then initializes its Device and Queue.
    ///
    /// This deliberately does not accept a `Surface`. Adapter/device discovery
    /// may run on a worker, while a native surface must be created on the UI
    /// thread (notably, CAMetalLayer creation on macOS). Surface compatibility
    /// is negotiated later by `native_surface::configure_surface`, which is
    /// always dispatched with `run_on_main_thread`.
    pub async fn select_best_gpu(instance: &Instance) -> Result<Self, String> {
        // enumerate_adapters is not available on wasm32 (no enumeration API in
        // the browser sandbox). The WASM crate uses init_gpu() directly and
        // never calls select_best_gpu on that target, but the function must
        // still compile. Guard the native-only path.
        #[cfg(not(target_arch = "wasm32"))]
        let best_adapter = {
            let adapters = instance.enumerate_adapters(wgpu::Backends::all());
            if !adapters.is_empty() {
                // Score adapters: Prioritize Discrete GPUs (1000), then Integrated (200), penalize CPU/Virtual
                let mut scored_adapters: Vec<(u32, Adapter)> = adapters
                    .into_iter()
                    .map(|adapter| {
                        let info = adapter.get_info();
                        #[allow(unused_mut)]
                        let mut score = match info.device_type {
                            DeviceType::DiscreteGpu => 1000,
                            DeviceType::IntegratedGpu => 200,
                            DeviceType::VirtualGpu => 50,
                            DeviceType::Cpu => 10,
                            DeviceType::Other => 0,
                        };
                        #[cfg(target_os = "windows")]
                        if info.backend == wgpu::Backend::Dx12 {
                            // Boost DX12 backend on Windows so D3D11VA DXGI shared texture import succeeds
                            score += 500;
                        }
                        (score, adapter)
                    })
                    .collect();

                scored_adapters.sort_by_key(|b| std::cmp::Reverse(b.0));
                scored_adapters.remove(0).1
            } else {
                // Fallback to request_adapter if enumerate_adapters returns empty on some platforms
                if let Some(adapter) = instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::HighPerformance,
                        compatible_surface: None,
                        force_fallback_adapter: false,
                    })
                    .await
                {
                    adapter
                } else if let Some(adapter) = instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::LowPower,
                        compatible_surface: None,
                        force_fallback_adapter: false,
                    })
                    .await
                {
                    adapter
                } else if let Some(adapter) = instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::None,
                        compatible_surface: None,
                        force_fallback_adapter: true,
                    })
                    .await
                {
                    adapter
                } else {
                    instance
                        .enumerate_adapters(wgpu::Backends::all())
                        .into_iter()
                        .next()
                        .ok_or_else(|| {
                            "No compatible graphics adapters or software rasterizers found."
                                .to_string()
                        })?
                }
            }
        };

        // On wasm32 we fall back to a simple request_adapter — select_best_gpu
        // is not the primary path (init_gpu() in clypra-render-wasm is), but
        // we need this to compile.
        #[cfg(target_arch = "wasm32")]
        let best_adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| "No WebGPU adapter found".to_string())?;

        let info = best_adapter.get_info();
        let is_discrete = info.device_type == DeviceType::DiscreteGpu;

        let gpu_info = SelectedGpuInfo {
            name: info.name.clone(),
            backend: format!("{:?}", info.backend),
            device_type: format!("{:?}", info.device_type),
            vendor_id: info.vendor,
            device_id: info.device,
            is_discrete,
            driver: info.driver.clone(),
            driver_info: info.driver_info.clone(),
            is_software_adapter: info.device_type == DeviceType::Cpu,
        };

        log::info!(
            "🎮 Bound Clypra Media Engine to: {} ({:?}, Backend: {:?}, Driver: {} {}, Software: {})",
            gpu_info.name,
            gpu_info.device_type,
            gpu_info.backend,
            gpu_info.driver,
            gpu_info.driver_info,
            gpu_info.is_software_adapter,
        );

        let available_features = best_adapter.features();
        let mut required_features = wgpu::Features::empty();
        if available_features.contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM) {
            required_features |= wgpu::Features::TEXTURE_FORMAT_16BIT_NORM;
        }
        if available_features.contains(wgpu::Features::TEXTURE_FORMAT_NV12) {
            required_features |= wgpu::Features::TEXTURE_FORMAT_NV12;
        }

        let (device, queue) = best_adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Native Wgpu Device"),
                    required_features,
                    required_limits: best_adapter.limits(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| format!("Failed to request wgpu device: {}", e))?;

        let nv12_supported = device
            .features()
            .contains(wgpu::Features::TEXTURE_FORMAT_NV12);
        let capabilities = PreviewCapabilities::probe(&best_adapter, &device);

        log::info!(
            "🚀 Negotiated Preview Capabilities: NV12={}, DXGI ZeroCopy={}, HW Decode={}, Native Surface={}, HDR={}",
            capabilities.wgpu_nv12,
            capabilities.dxgi_import,
            capabilities.hw_decode,
            capabilities.native_surface,
            capabilities.hdr,
        );

        #[allow(unused_mut)]
        let mut dxgi_adapter_index = None;
        #[cfg(target_os = "windows")]
        if info.backend == wgpu::Backend::Dx12 {
            use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
            if let Ok(factory) = unsafe { CreateDXGIFactory1::<IDXGIFactory1>() } {
                let mut i = 0u32;
                while let Ok(dxgi_adapter) = unsafe { factory.EnumAdapters1(i) } {
                    if let Ok(desc) = unsafe { dxgi_adapter.GetDesc1() } {
                        if desc.VendorId == info.vendor && desc.DeviceId == info.device {
                            SELECTED_DXGI_ADAPTER_INDEX
                                .store(i as i32, std::sync::atomic::Ordering::Relaxed);
                            dxgi_adapter_index = Some(i);
                            log::info!(
                                "🔗 [adapter_selector] Matched wgpu DX12 adapter '{}' to DXGI adapter index {}",
                                info.name,
                                i
                            );
                            break;
                        }
                    }
                    i += 1;
                }
            }
        }

        Ok(Self {
            instance: instance.clone(),
            adapter: best_adapter,
            info: gpu_info,
            capabilities,
            device,
            queue,
            nv12_supported,
            dxgi_adapter_index,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_arch = "wasm32"))]
    #[tokio::test]
    async fn test_adapter_selection_scoring() {
        let instance = Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });

        let result = GpuContext::select_best_gpu(&instance).await;
        if let Ok(gpu_ctx) = result {
            assert!(!gpu_ctx.info.name.is_empty(), "GPU name must not be empty");
            println!(
                "Selected GPU: {} | Backend: {} | Type: {}",
                gpu_ctx.info.name, gpu_ctx.info.backend, gpu_ctx.info.device_type
            );
        }
    }
}
