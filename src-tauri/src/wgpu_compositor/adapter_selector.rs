use serde::{Deserialize, Serialize};
use wgpu::{Adapter, DeviceType, Instance};

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
    pub adapter: Adapter,
    pub info: SelectedGpuInfo,
}

impl GpuContext {
    /// Enumerates and scores all available graphics adapters to select the optimal discrete GPU.
    /// Eliminates dual-GPU hybrid performance drops where systems silently bind to low-power iGPUs.
    pub async fn select_best_gpu(instance: &Instance) -> Result<Self, String> {
        let adapters = instance.enumerate_adapters(wgpu::Backends::PRIMARY);
        
        let best_adapter = if !adapters.is_empty() {
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

            // Sort descending by score
            scored_adapters.sort_by(|a, b| b.0.cmp(&a.0));
            scored_adapters.remove(0).1
        } else {
            // Fallback to request_adapter if enumerate_adapters returns empty on some platforms
            instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    compatible_surface: None,
                    force_fallback_adapter: false,
                })
                .await
                .ok_or_else(|| "No compatible graphics adapters found on this system.".to_string())?
        };

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

        Ok(Self {
            adapter: best_adapter,
            info: gpu_info,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
