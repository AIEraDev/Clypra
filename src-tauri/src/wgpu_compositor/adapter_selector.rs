use serde::{Deserialize, Serialize};
use wgpu::{Adapter, Device, DeviceType, Instance, Queue, Surface};

/// Detailed metadata about the active GPU adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectedGpuInfo {
    pub name: String,
    pub backend: String,
    pub device_type: String,
    pub vendor_id: u32,
    pub device_id: u32,
    pub is_discrete: bool,
}

pub struct GpuContext {
    pub instance: Instance,
    pub adapter: Adapter,
    pub info: SelectedGpuInfo,
    pub device: Device,
    pub queue: Queue,
}

impl GpuContext {
    /// Enumerates and scores all available graphics adapters to select the optimal discrete GPU
    /// and initializes the associated Device and Queue.
    pub async fn select_best_gpu(
        instance: &Instance,
        compatible_surface: Option<&Surface<'_>>,
    ) -> Result<Self, String> {
        // enumerate_adapters is not available on wasm32 (no enumeration API in
        // the browser sandbox). The WASM crate uses init_gpu() directly and
        // never calls select_best_gpu on that target, but the function must
        // still compile. Guard the native-only path.
        #[cfg(not(target_arch = "wasm32"))]
        let best_adapter = {
            let mut adapters = instance.enumerate_adapters(wgpu::Backends::all());
            if let Some(surface) = compatible_surface {
                adapters.retain(|adapter| !surface.get_capabilities(adapter).formats.is_empty());
            }

            if !adapters.is_empty() {
                // Score adapters: Prioritize Discrete GPUs (1000), then Integrated (200), penalize CPU/Virtual
                let mut scored_adapters: Vec<(u32, Adapter)> = adapters
                    .into_iter()
                    .map(|adapter| {
                        let info = adapter.get_info();
                        let score = match info.device_type {
                            DeviceType::DiscreteGpu => 1000,
                            DeviceType::IntegratedGpu => 200,
                            DeviceType::VirtualGpu => 50,
                            DeviceType::Cpu => 10,
                            DeviceType::Other => 0,
                        };
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
                        compatible_surface,
                        force_fallback_adapter: false,
                    })
                    .await
                {
                    adapter
                } else if let Some(adapter) = instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::LowPower,
                        compatible_surface,
                        force_fallback_adapter: false,
                    })
                    .await
                {
                    adapter
                } else if let Some(adapter) = instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::None,
                        compatible_surface,
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
        };

        log::info!(
            "🎮 Bound Clypra Media Engine to: {} ({:?}, Backend: {:?})",
            gpu_info.name,
            gpu_info.device_type,
            gpu_info.backend
        );

        let available_features = best_adapter.features();
        let mut required_features = wgpu::Features::empty();
        if available_features.contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM) {
            required_features |= wgpu::Features::TEXTURE_FORMAT_16BIT_NORM;
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

        Ok(Self {
            instance: instance.clone(),
            adapter: best_adapter,
            info: gpu_info,
            device,
            queue,
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

        let result = GpuContext::select_best_gpu(&instance, None).await;
        if let Ok(gpu_ctx) = result {
            assert!(!gpu_ctx.info.name.is_empty(), "GPU name must not be empty");
            println!(
                "Selected GPU: {} | Backend: {} | Type: {}",
                gpu_ctx.info.name, gpu_ctx.info.backend, gpu_ctx.info.device_type
            );
        }
    }
}
