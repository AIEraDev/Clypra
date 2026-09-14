//! Canonical GPU hardware limits baseline for Clypra WebGPU & wgpu pipelines.
//! Embedded from build.rs which reads canonical gpu-limits.json.

use serde::Deserialize;

include!(concat!(env!("OUT_DIR"), "/canonical_limits.rs"));

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalGpuLimitsJson {
    pub max_bind_groups: u32,
    #[serde(alias = "maxTextureDimension2D")]
    pub max_texture_dimension_2d: u32,
    pub max_sampled_textures_per_shader_stage: u32,
    pub max_samplers_per_shader_stage: u32,
    pub max_storage_buffers_per_shader_stage: u32,
    pub max_storage_buffer_binding_size: u64,
    pub max_uniform_buffers_per_shader_stage: u32,
    pub max_uniform_buffer_binding_size: u64,
}

pub fn get_canonical_wgpu_limits() -> wgpu::Limits {
    let raw: CanonicalGpuLimitsJson = serde_json::from_str(CANONICAL_LIMITS_JSON)
        .expect("Failed to deserialize canonical limits JSON");

    wgpu::Limits {
        max_bind_groups: raw.max_bind_groups,
        max_texture_dimension_2d: raw.max_texture_dimension_2d,
        max_sampled_textures_per_shader_stage: raw.max_sampled_textures_per_shader_stage,
        max_samplers_per_shader_stage: raw.max_samplers_per_shader_stage,
        max_storage_buffers_per_shader_stage: raw.max_storage_buffers_per_shader_stage,
        max_storage_buffer_binding_size: raw.max_storage_buffer_binding_size as u32,
        max_uniform_buffers_per_shader_stage: raw.max_uniform_buffers_per_shader_stage,
        max_uniform_buffer_binding_size: raw.max_uniform_buffer_binding_size as u32,
        ..wgpu::Limits::downlevel_webgl2_defaults()
    }
}

pub fn validate_adapter_limits(adapter: &wgpu::Adapter) -> Result<(), String> {
    let limits = adapter.limits();
    let required = get_canonical_wgpu_limits();

    if limits.max_bind_groups < required.max_bind_groups {
        return Err(format!(
            "Adapter max_bind_groups ({}) below required ({})",
            limits.max_bind_groups, required.max_bind_groups
        ));
    }
    if limits.max_texture_dimension_2d < required.max_texture_dimension_2d {
        return Err(format!(
            "Adapter max_texture_dimension_2d ({}) below required ({})",
            limits.max_texture_dimension_2d, required.max_texture_dimension_2d
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonical_wgpu_limits_deserialization() {
        let limits = get_canonical_wgpu_limits();
        assert_eq!(limits.max_bind_groups, 4);
        assert_eq!(limits.max_texture_dimension_2d, 4096);
        assert_eq!(limits.max_sampled_textures_per_shader_stage, 16);
        assert_eq!(limits.max_samplers_per_shader_stage, 8);
        assert_eq!(limits.max_storage_buffers_per_shader_stage, 4);
        assert_eq!(limits.max_storage_buffer_binding_size, 134217728);
        assert_eq!(limits.max_uniform_buffers_per_shader_stage, 8);
        assert_eq!(limits.max_uniform_buffer_binding_size, 65536);

        // Test using_resolution merges with larger adapter limit
        let mut adapter_mock = limits.clone();
        adapter_mock.max_texture_dimension_2d = 8192;
        let resolved = limits.using_resolution(adapter_mock);
        assert_eq!(resolved.max_texture_dimension_2d, 8192);
        assert_eq!(resolved.max_bind_groups, 4);
    }
}
