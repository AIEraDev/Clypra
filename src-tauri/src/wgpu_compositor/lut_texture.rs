// src-tauri/src/wgpu_compositor/lut_texture.rs

use super::lut_parser::ParsedLut3D;

pub struct GpuLut3D {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub sampler: wgpu::Sampler,
    pub size: u32,
}

impl GpuLut3D {
    /// Uploads a parsed 3D LUT directly into a wgpu 3D Texture
    pub fn from_parsed(device: &wgpu::Device, queue: &wgpu::Queue, lut: &ParsedLut3D) -> Self {
        let size = lut.size;

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("3D LUT Texture: {}", lut.title)),
            size: wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: size,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // Upload entire 3D volume in one DMA call
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &lut.rgba8_data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(size * 4), // Row pitch in bytes (R dimension)
                rows_per_image: Some(size),    // Slice pitch in rows (G dimension)
            },
            wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: size,
            },
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("3D LUT View"),
            dimension: Some(wgpu::TextureViewDimension::D3),
            ..Default::default()
        });

        // Trilinear hardware filtering sampler for smooth color transitions
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("3D LUT Trilinear Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        Self {
            texture,
            view,
            sampler,
            size,
        }
    }

    /// Allocates an identity 3D LUT (33x33x33) for neutral grading
    pub fn default_identity(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let identity = ParsedLut3D::create_identity(33);
        Self::from_parsed(device, queue, &identity)
    }
}
