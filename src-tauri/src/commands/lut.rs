// src-tauri/src/commands/lut.rs

use dashmap::DashMap;
use std::sync::Arc;
use tauri::State;
use crate::wgpu_compositor::adapter_selector::GpuContext;
use crate::wgpu_compositor::lut_parser::ParsedLut3D;
use crate::wgpu_compositor::lut_texture::GpuLut3D;

pub struct LutCache {
    pub luts: DashMap<String, Arc<GpuLut3D>>,
    pub default_identity: Arc<GpuLut3D>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct LutInfo {
    pub id: String,
    pub title: String,
    pub size: u32,
}

#[tauri::command]
pub async fn load_lut_cube(
    lut_id: String,
    file_path: String,
    gpu_ctx: State<'_, Arc<GpuContext>>,
    lut_cache: State<'_, Arc<LutCache>>,
) -> Result<LutInfo, String> {
    if let Some(existing) = lut_cache.luts.get(&lut_id) {
        return Ok(LutInfo {
            id: lut_id,
            title: "Cached LUT".into(),
            size: existing.size,
        });
    }

    // 1. Parse .cube file from disk on background thread
    let parsed = tokio::task::spawn_blocking(move || {
        ParsedLut3D::parse_cube_file(&file_path)
    })
    .await
    .map_err(|e| e.to_string())??;

    let title = parsed.title.clone();
    let size = parsed.size;

    // 2. Upload to GPU 3D Texture
    let gpu_lut = GpuLut3D::from_parsed(&gpu_ctx.device, &gpu_ctx.queue, &parsed);
    lut_cache.luts.insert(lut_id.clone(), Arc::new(gpu_lut));

    Ok(LutInfo { id: lut_id, title, size })
}
