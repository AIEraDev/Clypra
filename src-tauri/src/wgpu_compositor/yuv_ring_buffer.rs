use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

/// Pixel format enum distinguishing 8-bit standard YUV from 10-bit HDR YUV.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum YuvPixelFormat {
    /// 8-bit NV12 (Y in R8Unorm: 1 byte/px, UV in Rg8Unorm: 2 bytes/texel)
    Nv12,
    /// 10-bit in 16-bit P010 (Y in R16Unorm: 2 bytes/px, UV in Rg16Unorm: 4 bytes/texel)
    P010,
}

/// Color transformation and tonemapping parameters passed via uniform buffer to the shader.
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable, PartialEq, Serialize, Deserialize)]
pub struct ColorTransformUniforms {
    /// 0 = BT.709 (SDR), 1 = BT.2020 PQ (HDR10), 2 = BT.2020 HLG, 3 = BT.601
    pub color_space: u32,
    /// 0 = Limited Range (Standard broadcast), 1 = Full Range
    pub range: u32,
    /// 0 = Passthrough / None, 1 = ACES Film, 2 = Reinhard
    pub tonemap_operator: u32,
    /// Target display peak brightness in nits (standard SDR = 100.0)
    pub target_peak_nits: f32,
}

impl Default for ColorTransformUniforms {
    fn default() -> Self {
        Self {
            color_space: 0,
            range: 0,
            tonemap_operator: 1,
            target_peak_nits: 100.0,
        }
    }
}

/// Pre-allocated frame slot holding textures, views, uniform buffer, and pre-baked BindGroup.
pub struct YuvFrameSlot {
    pub y_texture: wgpu::Texture,
    pub uv_texture: wgpu::Texture,
    pub y_view: wgpu::TextureView,
    pub uv_view: wgpu::TextureView,
    pub uniform_buffer: wgpu::Buffer,
    pub bind_group: wgpu::BindGroup,
}

/// High-performance pre-allocated Ring Buffer for 8-bit (NV12) and 10-bit HDR (P010) video playback.
pub struct YuvTextureRingBuffer {
    slots: Vec<YuvFrameSlot>,
    capacity: usize,
    write_index: usize,
    active_index: usize,
    pub width: u32,
    pub height: u32,
    pub format: YuvPixelFormat,
}

impl YuvTextureRingBuffer {
    /// Create a new pre-allocated YUV / HDR texture ring buffer.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        sampler_y: &wgpu::Sampler,
        sampler_uv: &wgpu::Sampler,
        width: u32,
        height: u32,
        format: YuvPixelFormat,
        capacity: usize,
    ) -> Self {
        assert!(capacity > 0, "Ring buffer capacity must be > 0");

        let mut slots = Vec::with_capacity(capacity);

        for _ in 0..capacity {
            slots.push(Self::create_slot(
                device, layout, sampler_y, sampler_uv, width, height, format,
            ));
        }

        Self {
            slots,
            capacity,
            write_index: 0,
            active_index: 0,
            width,
            height,
            format,
        }
    }

    /// Internal slot factory with pre-baked bind group.
    pub fn create_slot(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        sampler_y: &wgpu::Sampler,
        sampler_uv: &wgpu::Sampler,
        width: u32,
        height: u32,
        format: YuvPixelFormat,
    ) -> YuvFrameSlot {
        let (y_format, uv_format) = match format {
            YuvPixelFormat::Nv12 => (wgpu::TextureFormat::R8Unorm, wgpu::TextureFormat::Rg8Unorm),
            YuvPixelFormat::P010 => (
                wgpu::TextureFormat::R16Unorm,
                wgpu::TextureFormat::Rg16Unorm,
            ),
        };

        let y_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Y Plane Texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: y_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        let uv_width = width.div_ceil(2);
        let uv_height = height.div_ceil(2);

        let uv_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("UV Plane Texture"),
            size: wgpu::Extent3d {
                width: uv_width,
                height: uv_height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: uv_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        let y_view = y_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let uv_view = uv_texture.create_view(&wgpu::TextureViewDescriptor::default());

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Color Params Uniform Buffer"),
            size: std::mem::size_of::<ColorTransformUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("YUV + HDR BindGroup"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&y_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(sampler_y),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&uv_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(sampler_uv),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: uniform_buffer.as_entire_binding(),
                },
            ],
        });

        YuvFrameSlot {
            y_texture,
            uv_texture,
            y_view,
            uv_view,
            uniform_buffer,
            bind_group,
        }
    }

    /// Uploads decoded frame memory directly using hardware stride without dynamic allocation.
    pub fn upload_frame(
        &mut self,
        queue: &wgpu::Queue,
        y_plane: &[u8],
        uv_plane: &[u8],
        linesize_y: u32,
        linesize_uv: u32,
        params: &ColorTransformUniforms,
    ) {
        let slot_idx = self.write_index;
        let slot = &self.slots[slot_idx];

        let uv_width = self.width.div_ceil(2);
        let uv_height = self.height.div_ceil(2);

        let bytes_per_y_sample = match self.format {
            YuvPixelFormat::Nv12 => 1u32,
            YuvPixelFormat::P010 => 2u32,
        };
        let bytes_per_uv_sample = match self.format {
            YuvPixelFormat::Nv12 => 2u32,
            YuvPixelFormat::P010 => 4u32,
        };

        let actual_linesize_y = linesize_y.max(self.width * bytes_per_y_sample);
        let actual_linesize_uv = linesize_uv.max(uv_width * bytes_per_uv_sample);

        // 1. Update Color Uniforms
        queue.write_buffer(&slot.uniform_buffer, 0, bytemuck::bytes_of(params));

        // 2. Upload Y-Plane
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &slot.y_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            y_plane,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(actual_linesize_y),
                rows_per_image: Some(self.height),
            },
            wgpu::Extent3d {
                width: self.width,
                height: self.height,
                depth_or_array_layers: 1,
            },
        );

        // 3. Upload UV-Plane
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &slot.uv_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            uv_plane,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(actual_linesize_uv),
                rows_per_image: Some(uv_height),
            },
            wgpu::Extent3d {
                width: uv_width,
                height: uv_height,
                depth_or_array_layers: 1,
            },
        );

        self.active_index = slot_idx;
        self.write_index = (self.write_index + 1) % self.capacity;
    }

    /// Retrieves the active pre-baked BindGroup for immediate rendering.
    #[inline(always)]
    pub fn active_bind_group(&self) -> &wgpu::BindGroup {
        &self.slots[self.active_index].bind_group
    }

    /// Retrieves the active slot.
    #[inline(always)]
    pub fn active_slot(&self) -> &YuvFrameSlot {
        &self.slots[self.active_index]
    }

    /// Current active slot index.
    #[inline(always)]
    pub fn active_index(&self) -> usize {
        self.active_index
    }

    /// Current write slot index.
    #[inline(always)]
    pub fn write_index(&self) -> usize {
        self.write_index
    }

    /// Capacity of the ring buffer.
    #[inline(always)]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Adapt to changes in resolution or pixel format.
    #[allow(clippy::too_many_arguments)]
    pub fn ensure_dimensions_and_format(
        &mut self,
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        sampler_y: &wgpu::Sampler,
        sampler_uv: &wgpu::Sampler,
        width: u32,
        height: u32,
        format: YuvPixelFormat,
    ) {
        if self.width == width && self.height == height && self.format == format {
            return;
        }

        self.width = width;

        self.height = height;
        self.format = format;
        self.write_index = 0;
        self.active_index = 0;

        self.slots.clear();
        for _ in 0..self.capacity {
            self.slots.push(Self::create_slot(
                device, layout, sampler_y, sampler_uv, width, height, format,
            ));
        }
    }
}

/// Creates BindGroupLayout for the HDR/SDR YUV pipeline.
pub fn create_yuv_hdr_bind_group_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("YUV HDR Bind Group Layout"),
        entries: &[
            // 0: Y Texture
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            // 1: Y Sampler
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            // 2: UV Texture
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            // 3: UV Sampler
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            // 4: Uniform Buffer (ColorTransformUniforms)
            wgpu::BindGroupLayoutEntry {
                binding: 4,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ],
    })
}

/// Creates linear filtering sampler.
pub fn create_yuv_hdr_sampler(device: &wgpu::Device) -> wgpu::Sampler {
    device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("YUV HDR Linear Sampler"),
        address_mode_u: wgpu::AddressMode::ClampToEdge,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    })
}

/// Creates render pipeline with the HDR/SDR tonemapping shader.
pub fn create_yuv_hdr_render_pipeline(
    device: &wgpu::Device,
    bind_group_layout: &wgpu::BindGroupLayout,
    target_format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let shader_source = include_str!("../shaders/yuv_hdr_to_sdr.wgsl");
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("YUV HDR to SDR Shader"),
        source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(shader_source)),
    });

    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("YUV HDR Pipeline Layout"),
        bind_group_layouts: &[bind_group_layout],
        push_constant_ranges: &[],
    });

    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("YUV HDR Render Pipeline"),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            buffers: &[],
            compilation_options: Default::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            targets: &[Some(wgpu::ColorTargetState {
                format: target_format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview: None,
        cache: None,
    })
}

/// Renders a frame using the YUV HDR ring buffer directly to a target texture view.
#[allow(clippy::too_many_arguments)]
pub fn render_yuv_frame(
    ring_buffer: &mut YuvTextureRingBuffer,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pipeline: &wgpu::RenderPipeline,
    target_view: &wgpu::TextureView,
    raw_y: &[u8],
    raw_uv: &[u8],
    stride_y: u32,
    stride_uv: u32,
    params: &ColorTransformUniforms,
) {
    // 1. Direct DMA upload
    ring_buffer.upload_frame(queue, raw_y, raw_uv, stride_y, stride_uv, params);

    // 2. Render Pass with O(1) pre-baked bind group
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("YUV HDR Frame Encoder"),
    });

    {
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("YUV HDR Render Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });

        rpass.set_pipeline(pipeline);
        rpass.set_bind_group(0, ring_buffer.active_bind_group(), &[]);
        rpass.draw(0..6, 0..1);
    }

    queue.submit(std::iter::once(encoder.finish()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_yuv_hdr_ring_buffer_nv12_and_p010() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::None,
                compatible_surface: None,
                force_fallback_adapter: true,
            })
            .await;

        if let Some(adapter) = adapter {
            let available_features = adapter.features();
            let mut required_features = wgpu::Features::empty();
            if available_features.contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM) {
                required_features |= wgpu::Features::TEXTURE_FORMAT_16BIT_NORM;
            }

            if let Ok((device, queue)) = adapter
                .request_device(
                    &wgpu::DeviceDescriptor {
                        label: Some("Test YUV HDR Device"),
                        required_features,
                        required_limits: adapter.limits(),
                        memory_hints: wgpu::MemoryHints::Performance,
                    },
                    None,
                )
                .await
            {
                let layout = create_yuv_hdr_bind_group_layout(&device);
                let sampler = create_yuv_hdr_sampler(&device);
                let pipeline = create_yuv_hdr_render_pipeline(
                    &device,
                    &layout,
                    wgpu::TextureFormat::Rgba8UnormSrgb,
                );

                let width = 64u32;
                let height = 64u32;

                // 1. Test NV12 (8-bit)
                let mut ring_nv12 = YuvTextureRingBuffer::new(
                    &device,
                    &layout,
                    &sampler,
                    &sampler,
                    width,
                    height,
                    YuvPixelFormat::Nv12,
                    3,
                );

                let target_texture = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Target Texture"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                    view_formats: &[],
                });
                let target_view =
                    target_texture.create_view(&wgpu::TextureViewDescriptor::default());

                let y_nv12 = vec![128u8; (width * height) as usize];
                let uv_nv12 = vec![128u8; (width * height / 2) as usize];
                let sdr_params = ColorTransformUniforms {
                    color_space: 0, // BT.709
                    range: 0,       // Limited
                    tonemap_operator: 0,
                    target_peak_nits: 100.0,
                };

                render_yuv_frame(
                    &mut ring_nv12,
                    &device,
                    &queue,
                    &pipeline,
                    &target_view,
                    &y_nv12,
                    &uv_nv12,
                    width,
                    width,
                    &sdr_params,
                );
                assert_eq!(ring_nv12.active_index(), 0);

                // 2. Test P010 (10-bit HDR) with ACES Tonemapping
                let mut ring_p010 = YuvTextureRingBuffer::new(
                    &device,
                    &layout,
                    &sampler,
                    &sampler,
                    width,
                    height,
                    YuvPixelFormat::P010,
                    3,
                );

                // In P010, each sample is 2 bytes (u16)
                let y_p010 = vec![128u8; (width * height * 2) as usize];
                let uv_p010 = vec![128u8; (width * height * 2) as usize]; // (width/2 * height/2 * 4) = width*height
                let hdr_params = ColorTransformUniforms {
                    color_space: 1, // BT.2020 PQ
                    range: 0,
                    tonemap_operator: 1, // ACES Film
                    target_peak_nits: 100.0,
                };

                render_yuv_frame(
                    &mut ring_p010,
                    &device,
                    &queue,
                    &pipeline,
                    &target_view,
                    &y_p010,
                    &uv_p010,
                    width * 2,
                    width * 2,
                    &hdr_params,
                );
                assert_eq!(ring_p010.active_index(), 0);

                // 3. Test dynamic format & resolution switch (P010 -> NV12 @ 128x128)
                ring_p010.ensure_dimensions_and_format(
                    &device,
                    &layout,
                    &sampler,
                    &sampler,
                    128,
                    128,
                    YuvPixelFormat::Nv12,
                );
                assert_eq!(ring_p010.width, 128);
                assert_eq!(ring_p010.height, 128);
                assert_eq!(ring_p010.format, YuvPixelFormat::Nv12);
            }
        }
    }
}
