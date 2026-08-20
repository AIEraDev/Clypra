/*!
 * Native wgpu Compositor & Offscreen Renderer
 *
 * Real wgpu GPU pipeline initialization for Clypra Rust core.
 * Headless Instance -> Adapter (Metal/Vulkan/DirectX) -> Device/Queue -> Texture Render Pass -> Buffer Readback
 */

use std::borrow::Cow;
use std::sync::Arc;

pub mod texture_pool;
pub use texture_pool::{
    create_nv12_bind_group_layout, create_nv12_render_pipeline, create_nv12_sampler,
    render_scrub_frame, Nv12FrameSlot, Nv12TextureRingBuffer,
};

pub mod yuv_ring_buffer;
pub use yuv_ring_buffer::{
    create_yuv_hdr_bind_group_layout, create_yuv_hdr_render_pipeline, create_yuv_hdr_sampler,
    render_yuv_frame, ColorTransformUniforms, YuvFrameSlot, YuvPixelFormat, YuvTextureRingBuffer,
};

pub mod adapter_selector;
pub use adapter_selector::{GpuContext, SelectedGpuInfo};

pub mod lut_parser;
pub use lut_parser::ParsedLut3D;

pub mod lut_texture;
pub use lut_texture::GpuLut3D;

pub mod chroma_key;
pub use chroma_key::ChromaKeyUniforms;

pub mod multi_track_composer;
pub use multi_track_composer::{
    BlendMode, ColorGradeUniforms, CompositeLayer, CropMargins, LayerBlendMode, LayerTransform,
    LayerUniforms, MultiTrackCompositor,
};

pub mod transition_pipeline;
pub use transition_pipeline::{TransitionPipeline, TransitionType, TransitionUniforms};

pub mod bezier;
pub use bezier::{interpolate_keyframe, CubicBezier};

pub mod speed_ramp;
pub use speed_ramp::{SpeedKeyframe, SpeedRampProfile};

pub struct NativeWgpuRenderer {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub gpu_info: SelectedGpuInfo,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

/// Persistent YUV preview resources shared by native editing-preview calls.
///
/// The source-size ring buffer is recreated only when the decoded stream
/// changes resolution or pixel format. The output target remains per-frame for
/// now because the next phase will replace CPU readback with a native surface.
pub struct NativePreviewSession {
    pub gpu: Arc<GpuContext>,
    yuv_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    pipeline: wgpu::RenderPipeline,
    ring: Option<YuvTextureRingBuffer>,
}

impl NativePreviewSession {
    pub fn new(gpu: Arc<GpuContext>) -> Self {
        let yuv_layout = create_yuv_hdr_bind_group_layout(&gpu.device);
        let sampler = create_yuv_hdr_sampler(&gpu.device);
        let pipeline = create_yuv_hdr_render_pipeline(
            &gpu.device,
            &yuv_layout,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        );

        Self {
            gpu,
            yuv_layout,
            sampler,
            pipeline,
            ring: None,
        }
    }

    /// Convert one decoded NV12 frame into a GPU texture for timeline compositing.
    /// The texture is owned by the caller and remains valid until the compositor
    /// has submitted the project frame that samples it.
    #[allow(clippy::too_many_arguments)]
    pub fn render_nv12_frame_to_texture(
        &mut self,
        source_width: u32,
        source_height: u32,
        output_width: u32,
        output_height: u32,
        y_plane: &[u8],
        uv_plane: &[u8],
        params: &ColorTransformUniforms,
    ) -> Result<wgpu::Texture, String> {
        if source_width == 0 || source_height == 0 || output_width == 0 || output_height == 0 {
            return Err("Source and output dimensions must be non-zero".to_string());
        }

        let ring = self.ring.get_or_insert_with(|| {
            YuvTextureRingBuffer::new(
                &self.gpu.device,
                &self.yuv_layout,
                &self.sampler,
                &self.sampler,
                source_width,
                source_height,
                YuvPixelFormat::Nv12,
                3,
            )
        });
        ring.ensure_dimensions_and_format(
            &self.gpu.device,
            &self.yuv_layout,
            &self.sampler,
            &self.sampler,
            source_width,
            source_height,
            YuvPixelFormat::Nv12,
        );

        let target_texture = self.gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Native Project Video Layer"),
            size: wgpu::Extent3d {
                width: output_width,
                height: output_height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        render_yuv_frame(
            ring,
            &self.gpu.device,
            &self.gpu.queue,
            &self.pipeline,
            &target_view,
            y_plane,
            uv_plane,
            source_width,
            source_width.div_ceil(2) * 2,
            params,
        );

        Ok(target_texture)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn render_nv12_frame(
        &mut self,
        source_width: u32,
        source_height: u32,
        output_width: u32,
        output_height: u32,
        y_plane: &[u8],
        uv_plane: &[u8],
        params: &ColorTransformUniforms,
    ) -> Result<Vec<u8>, String> {
        if source_width == 0 || source_height == 0 || output_width == 0 || output_height == 0 {
            return Err("Source and output dimensions must be non-zero".to_string());
        }

        let ring = self.ring.get_or_insert_with(|| {
            YuvTextureRingBuffer::new(
                &self.gpu.device,
                &self.yuv_layout,
                &self.sampler,
                &self.sampler,
                source_width,
                source_height,
                YuvPixelFormat::Nv12,
                3,
            )
        });
        ring.ensure_dimensions_and_format(
            &self.gpu.device,
            &self.yuv_layout,
            &self.sampler,
            &self.sampler,
            source_width,
            source_height,
            YuvPixelFormat::Nv12,
        );

        let target_texture = self.gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Persistent Native Preview Output"),
            size: wgpu::Extent3d {
                width: output_width,
                height: output_height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        render_yuv_frame(
            ring,
            &self.gpu.device,
            &self.gpu.queue,
            &self.pipeline,
            &target_view,
            y_plane,
            uv_plane,
            source_width,
            source_width.div_ceil(2) * 2,
            params,
        );

        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = output_width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let output_buffer = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Persistent Native Preview Readback"),
            size: (padded_bytes_per_row * output_height) as wgpu::BufferAddress,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = self
            .gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Native Preview Readback Encoder"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(output_height),
                },
            },
            wgpu::Extent3d {
                width: output_width,
                height: output_height,
                depth_or_array_layers: 1,
            },
        );
        self.gpu.queue.submit(Some(encoder.finish()));

        let buffer_slice = output_buffer.slice(..);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        self.gpu.device.poll(wgpu::Maintain::Wait);
        receiver
            .await
            .map_err(|error| format!("Readback channel error: {}", error))?
            .map_err(|error| format!("Readback map error: {:?}", error))?;

        let mapped = buffer_slice.get_mapped_range();
        let mut rgba = vec![0u8; (output_width * output_height * 4) as usize];
        for row in 0..output_height as usize {
            let src_start = row * padded_bytes_per_row as usize;
            let dst_start = row * unpadded_bytes_per_row as usize;
            rgba[dst_start..dst_start + unpadded_bytes_per_row as usize]
                .copy_from_slice(&mapped[src_start..src_start + unpadded_bytes_per_row as usize]);
        }
        drop(mapped);
        output_buffer.unmap();

        Ok(rgba)
    }
}

impl NativeWgpuRenderer {
    pub async fn new() -> Result<Self, String> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            flags: wgpu::InstanceFlags::default(),
            backend_options: Default::default(),
        });

        let gpu_ctx = GpuContext::select_best_gpu(&instance, None).await?;

        Ok(Self {
            instance,
            adapter: gpu_ctx.adapter,
            gpu_info: gpu_ctx.info,
            device: gpu_ctx.device,
            queue: gpu_ctx.queue,
        })
    }

    /// Render an NV12 multi-planar frame (Y + UV planes) directly to RGBA on the GPU using WGSL shader.
    /// Eliminates host CPU sws_scale matrix transformation and reduces PCIe transfer overhead by ~50%.
    pub async fn render_nv12_frame(
        &self,
        width: u32,
        height: u32,
        y_plane: &[u8],
        uv_plane: &[u8],
    ) -> Result<Vec<u8>, String> {
        if width == 0 || height == 0 {
            return Err("Width and height must be non-zero".to_string());
        }

        // 1. Create Y plane texture (R8Unorm)
        let y_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("NV12 Y Texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &y_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            y_plane,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        let uv_width = width.div_ceil(2);
        let uv_height = height.div_ceil(2);

        // 2. Create UV plane texture (Rg8Unorm)
        let uv_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("NV12 UV Texture"),
            size: wgpu::Extent3d {
                width: uv_width,
                height: uv_height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rg8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &uv_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            uv_plane,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(uv_width * 2),
                rows_per_image: Some(uv_height),
            },
            wgpu::Extent3d {
                width: uv_width,
                height: uv_height,
                depth_or_array_layers: 1,
            },
        );

        let y_view = y_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let uv_view = uv_texture.create_view(&wgpu::TextureViewDescriptor::default());

        let sampler = self.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("NV12 Linear Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // 3. Render target texture (RGBA8Unorm)
        let target_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("NV12 Target RGBA Texture"),
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
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        let shader_source = include_str!("shaders/yuv_to_rgb.wgsl");
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("NV12 YUV to RGB Shader"),
                source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(shader_source)),
            });

        let bind_group_layout =
            self.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("NV12 Bind Group Layout"),
                    entries: &[
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
                        wgpu::BindGroupLayoutEntry {
                            binding: 1,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                            count: None,
                        },
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
                        wgpu::BindGroupLayoutEntry {
                            binding: 3,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                            count: None,
                        },
                    ],
                });

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("NV12 Bind Group"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&y_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&uv_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });

        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("NV12 Pipeline Layout"),
                bind_group_layouts: &[&bind_group_layout],
                push_constant_ranges: &[],
            });

        let render_pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("NV12 Render Pipeline"),
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
                        format: wgpu::TextureFormat::Rgba8UnormSrgb,
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
            });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("NV12 Render Encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("NV12 Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
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
            render_pass.set_pipeline(&render_pipeline);
            render_pass.set_bind_group(0, &bind_group, &[]);
            render_pass.draw(0..6, 0..1);
        }

        // Buffer readback with 256-byte alignment compliance
        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;

        let output_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("NV12 Readback Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));

        let buffer_slice = output_buffer.slice(..);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |res| {
            let _ = sender.send(res);
        });

        self.device.poll(wgpu::Maintain::Wait);
        receiver
            .await
            .map_err(|e| format!("Channel error: {}", e))?
            .map_err(|e| format!("Buffer map error: {:?}", e))?;

        let mapped_view = buffer_slice.get_mapped_range();
        let mut rgba_bytes = vec![0u8; (width * height * 4) as usize];

        for y in 0..height {
            let src_start = (y * padded_bytes_per_row) as usize;
            let src_end = src_start + unpadded_bytes_per_row as usize;
            let dst_start = (y * unpadded_bytes_per_row) as usize;
            let dst_end = dst_start + unpadded_bytes_per_row as usize;
            rgba_bytes[dst_start..dst_end].copy_from_slice(&mapped_view[src_start..src_end]);
        }

        drop(mapped_view);
        output_buffer.unmap();

        Ok(rgba_bytes)
    }

    /// Render NV12 using explicit color metadata through the reusable YUV
    /// pipeline. This is the correctness path for the native preview proof;
    /// persistent GPU resources will be introduced after the contract is
    /// validated across platforms.
    pub async fn render_nv12_frame_with_color(
        &self,
        width: u32,
        height: u32,
        y_plane: &[u8],
        uv_plane: &[u8],
        params: &ColorTransformUniforms,
    ) -> Result<Vec<u8>, String> {
        if width == 0 || height == 0 {
            return Err("Width and height must be non-zero".to_string());
        }

        let expected_y = (width * height) as usize;
        let expected_uv = width.div_ceil(2) as usize * height.div_ceil(2) as usize * 2;
        if y_plane.len() < expected_y || uv_plane.len() < expected_uv {
            return Err(format!(
                "Invalid NV12 plane sizes: expected at least Y={} UV={}, got Y={} UV={}",
                expected_y,
                expected_uv,
                y_plane.len(),
                uv_plane.len()
            ));
        }

        let layout = create_yuv_hdr_bind_group_layout(&self.device);
        let sampler = create_yuv_hdr_sampler(&self.device);
        let pipeline = create_yuv_hdr_render_pipeline(
            &self.device,
            &layout,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        );
        let mut ring = YuvTextureRingBuffer::new(
            &self.device,
            &layout,
            &sampler,
            &sampler,
            width,
            height,
            YuvPixelFormat::Nv12,
            1,
        );

        let target_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Native Preview RGBA Target"),
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
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        render_yuv_frame(
            &mut ring,
            &self.device,
            &self.queue,
            &pipeline,
            &target_view,
            y_plane,
            uv_plane,
            width,
            width.div_ceil(2) * 2,
            params,
        );

        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;
        let output_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Native Preview Readback Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Native Preview Readback Encoder"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit(Some(encoder.finish()));

        let buffer_slice = output_buffer.slice(..);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        self.device.poll(wgpu::Maintain::Wait);
        receiver
            .await
            .map_err(|error| format!("Readback channel error: {}", error))?
            .map_err(|error| format!("Readback map error: {:?}", error))?;

        let mapped = buffer_slice.get_mapped_range();
        let mut rgba = vec![0u8; (width * height * 4) as usize];
        for row in 0..height as usize {
            let src_start = row * padded_bytes_per_row as usize;
            let dst_start = row * unpadded_bytes_per_row as usize;
            rgba[dst_start..dst_start + unpadded_bytes_per_row as usize]
                .copy_from_slice(&mapped[src_start..src_start + unpadded_bytes_per_row as usize]);
        }
        drop(mapped);
        output_buffer.unmap();

        Ok(rgba)
    }

    /// Render an OverlayDocument fixture directly via wgpu
    pub async fn render_overlay_document(
        &self,
        doc: &crate::models::overlay::OverlayDocument,
        _t: f64,
    ) -> Result<Vec<u8>, String> {
        let width = doc.canvas.width;
        let height = doc.canvas.height;

        let default_node = crate::models::overlay::OverlayNode {
            id: "default".to_string(),
            name: "Default".to_string(),
            node_type: "shape".to_string(),
            x: 320.0,
            y: 180.0,
            width: 640.0,
            height: 360.0,
            rotation: 0.0,
            opacity: 1.0,
            style: None,
        };

        let node = doc.nodes.first().unwrap_or(&default_node);

        // Calculate normalized bounds
        let norm_x = node.x / width as f32;
        let norm_y = node.y / height as f32;
        let norm_w = node.width / width as f32;
        let norm_h = node.height / height as f32;

        let texture_desc = wgpu::TextureDescriptor {
            label: Some("OverlayDocument Target Texture"),
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
        };

        let texture = self.device.create_texture(&texture_desc);
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        let shader_source = format!(
            r#"
            struct VertexOutput {{
                @builtin(position) position: vec4<f32>,
                @location(0) uv: vec2<f32>,
            }};

            @vertex
            fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {{
                var pos = array<vec2<f32>, 6>(
                    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
                    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
                );
                var uv = array<vec2<f32>, 6>(
                    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
                    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0)
                );
                var out: VertexOutput;
                out.position = vec4<f32>(pos[vertex_index], 0.0, 1.0);
                out.uv = uv[vertex_index];
                return out;
            }}

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {{
                let min_x: f32 = {:.6};
                let max_x: f32 = {:.6};
                let min_y: f32 = {:.6};
                let max_y: f32 = {:.6};
                let opacity: f32 = {:.6};

                let in_x = in.uv.x >= min_x && in.uv.x <= max_x;
                let in_y = in.uv.y >= min_y && in.uv.y <= max_y;

                if (in_x && in_y) {{
                    let border = in.uv.x <= (min_x + 0.005) || in.uv.x >= (max_x - 0.005) ||
                                 in.uv.y <= (min_y + 0.005) || in.uv.y >= (max_y - 0.005);
                    if (border) {{
                        return vec4<f32>(0.27, 1.0, 0.44, opacity); // #45FF72
                    }}
                    return vec4<f32>(0.545, 0.36, 0.965, opacity); // #8B5CF6
                }}
                return vec4<f32>(0.058, 0.09, 0.164, 1.0); // #0F172A
            }}
            "#,
            norm_x,
            norm_x + norm_w,
            norm_y,
            norm_y + norm_h,
            node.opacity
        );

        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Document Node Shader"),
                source: wgpu::ShaderSource::Wgsl(Cow::Owned(shader_source)),
            });

        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Doc Pipeline Layout"),
                bind_group_layouts: &[],
                push_constant_ranges: &[],
            });

        let render_pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Doc Render Pipeline"),
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
                        format: wgpu::TextureFormat::Rgba8UnormSrgb,
                        blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview: None,
                cache: None,
            });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Doc Command Encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Doc Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.058,
                            g: 0.09,
                            b: 0.164,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            render_pass.set_pipeline(&render_pipeline);
            render_pass.draw(0..6, 0..1);
        }

        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;

        let output_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Doc Readback Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));

        let buffer_slice = output_buffer.slice(..);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |res| {
            let _ = sender.send(res);
        });

        self.device.poll(wgpu::Maintain::Wait);
        receiver
            .await
            .map_err(|e| format!("Channel error: {}", e))?
            .map_err(|e| format!("Buffer map error: {:?}", e))?;

        let mapped_view = buffer_slice.get_mapped_range();
        let mut rgba_bytes = vec![0u8; (width * height * 4) as usize];

        for y in 0..height {
            let src_start = (y * padded_bytes_per_row) as usize;
            let src_end = src_start + unpadded_bytes_per_row as usize;
            let dst_start = (y * unpadded_bytes_per_row) as usize;
            let dst_end = dst_start + unpadded_bytes_per_row as usize;
            rgba_bytes[dst_start..dst_end].copy_from_slice(&mapped_view[src_start..src_end]);
        }

        drop(mapped_view);
        output_buffer.unmap();

        Ok(rgba_bytes)
    }

    /// Render a single animated rectangle frame onto an offscreen texture
    pub async fn render_rectangle_frame(
        &self,
        width: u32,
        height: u32,
        t: f64,
    ) -> Result<Vec<u8>, String> {
        let texture_desc = wgpu::TextureDescriptor {
            label: Some("Offscreen Target Texture"),
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
        };

        let texture = self.device.create_texture(&texture_desc);
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        let shader_source = format!(
            r#"
            struct VertexOutput {{
                @builtin(position) position: vec4<f32>,
                @location(0) uv: vec2<f32>,
            }};

            @vertex
            fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {{
                var pos = array<vec2<f32>, 6>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>( 1.0, -1.0),
                    vec2<f32>(-1.0,  1.0),
                    vec2<f32>(-1.0,  1.0),
                    vec2<f32>( 1.0, -1.0),
                    vec2<f32>( 1.0,  1.0)
                );
                var uv = array<vec2<f32>, 6>(
                    vec2<f32>(0.0, 1.0),
                    vec2<f32>(1.0, 1.0),
                    vec2<f32>(0.0, 0.0),
                    vec2<f32>(0.0, 0.0),
                    vec2<f32>(1.0, 1.0),
                    vec2<f32>(1.0, 0.0)
                );

                var out: VertexOutput;
                out.position = vec4<f32>(pos[vertex_index], 0.0, 1.0);
                out.uv = uv[vertex_index];
                return out;
            }}

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {{
                let t_val: f32 = {:.6};
                let rect_min_x = 0.5 - (0.15 + 0.15 * sin(t_val * 3.14159 * 0.5));
                let rect_max_x = 0.5 + (0.15 + 0.15 * sin(t_val * 3.14159 * 0.5));
                let rect_min_y = 0.325;
                let rect_max_y = 0.675;

                let inside_x = in.uv.x >= rect_min_x && in.uv.x <= rect_max_x;
                let inside_y = in.uv.y >= rect_min_y && in.uv.y <= rect_max_y;

                if (inside_x && inside_y) {{
                    let border = in.uv.x <= (rect_min_x + 0.005) || in.uv.x >= (rect_max_x - 0.005) ||
                                 in.uv.y <= (rect_min_y + 0.005) || in.uv.y >= (rect_max_y - 0.005);
                    if (border) {{
                        return vec4<f32>(0.27, 1.0, 0.44, 1.0); // #45FF72
                    }}
                    return vec4<f32>(0.545, 0.36, 0.965, 1.0); // #8B5CF6
                }}

                return vec4<f32>(0.058, 0.09, 0.164, 1.0); // #0F172A
            }}
            "#,
            t
        );

        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Rectangle Shader"),
                source: wgpu::ShaderSource::Wgsl(Cow::Owned(shader_source)),
            });

        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Render Pipeline Layout"),
                bind_group_layouts: &[],
                push_constant_ranges: &[],
            });

        let render_pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Rectangle Render Pipeline"),
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
                        format: wgpu::TextureFormat::Rgba8UnormSrgb,
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
            });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Render Command Encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Wgpu Offscreen Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.058,
                            g: 0.09,
                            b: 0.164,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&render_pipeline);
            render_pass.draw(0..6, 0..1);
        }

        // Buffer readback configuration for CPU texture mapping
        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT; // 256
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;

        let output_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Readback Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));

        // Map buffer for reading
        let buffer_slice = output_buffer.slice(..);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |res| {
            let _ = sender.send(res);
        });

        self.device.poll(wgpu::Maintain::Wait);
        receiver
            .await
            .map_err(|e| format!("Channel error: {}", e))?
            .map_err(|e| format!("Buffer map error: {:?}", e))?;

        let mapped_view = buffer_slice.get_mapped_range();
        let mut rgba_bytes = vec![0u8; (width * height * 4) as usize];

        for y in 0..height {
            let src_start = (y * padded_bytes_per_row) as usize;
            let src_end = src_start + unpadded_bytes_per_row as usize;
            let dst_start = (y * unpadded_bytes_per_row) as usize;
            let dst_end = dst_start + unpadded_bytes_per_row as usize;
            rgba_bytes[dst_start..dst_end].copy_from_slice(&mapped_view[src_start..src_end]);
        }

        drop(mapped_view);
        output_buffer.unmap();

        Ok(rgba_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_wgpu_nv12_shader_render() {
        let renderer = NativeWgpuRenderer::new().await;
        if let Ok(renderer) = renderer {
            let width = 64u32;
            let height = 64u32;

            // Synthetic Rec. 709 neutral gray in NV12: Y=128, U=128, V=128
            let y_plane = vec![128u8; (width * height) as usize];
            let uv_plane = vec![128u8; (width * height / 2) as usize];

            let rgba = renderer
                .render_nv12_frame(width, height, &y_plane, &uv_plane)
                .await;
            assert!(rgba.is_ok(), "NV12 rendering failed: {:?}", rgba.err());
            let bytes = rgba.unwrap();
            assert_eq!(bytes.len(), (width * height * 4) as usize);

            // Neutral gray check: R, G, B should be approximately equal and non-zero
            let r = bytes[0];
            let g = bytes[1];
            let b = bytes[2];
            let a = bytes[3];
            assert_eq!(a, 255, "Alpha channel must be 255");
            let diff_rg = (r as i32 - g as i32).abs();
            let diff_gb = (g as i32 - b as i32).abs();
            assert!(
                diff_rg <= 10 && diff_gb <= 10,
                "Color should be neutral gray, got R={} G={} B={}",
                r,
                g,
                b
            );
        }
    }

    #[tokio::test]
    async fn test_wgpu_metadata_driven_nv12_shader_render() {
        let renderer = match NativeWgpuRenderer::new().await {
            Ok(renderer) => renderer,
            Err(error) => {
                eprintln!(
                    "Skipping metadata-driven YUV test (no GPU adapter): {}",
                    error
                );
                return;
            }
        };

        let width = 64u32;
        let height = 64u32;
        let y_plane = vec![128u8; (width * height) as usize];
        let uv_plane = vec![128u8; (width.div_ceil(2) * height.div_ceil(2) * 2) as usize];
        let params = ColorTransformUniforms {
            color_space: 0,
            range: 0,
            tonemap_operator: 0,
            target_peak_nits: 100.0,
        };

        let rgba = renderer
            .render_nv12_frame_with_color(width, height, &y_plane, &uv_plane, &params)
            .await
            .expect("metadata-driven NV12 rendering failed");

        assert_eq!(rgba.len(), (width * height * 4) as usize);
        let r = rgba[0];
        let g = rgba[1];
        let b = rgba[2];
        assert_eq!(rgba[3], 255, "Alpha channel must be opaque");
        assert!((r as i32 - g as i32).abs() <= 10);
        assert!((g as i32 - b as i32).abs() <= 10);
    }

    #[tokio::test]
    async fn test_native_preview_session_scales_source_to_output() {
        let renderer = match NativeWgpuRenderer::new().await {
            Ok(renderer) => renderer,
            Err(error) => {
                eprintln!(
                    "Skipping native preview session test (no GPU adapter): {}",
                    error
                );
                return;
            }
        };

        let gpu = Arc::new(GpuContext {
            instance: renderer.instance.clone(),
            adapter: renderer.adapter,
            info: renderer.gpu_info,
            device: renderer.device,
            queue: renderer.queue,
        });
        let mut session = NativePreviewSession::new(gpu);
        let source_width = 64u32;
        let source_height = 64u32;
        let output_width = 32u32;
        let output_height = 16u32;
        let y_plane = vec![128u8; (source_width * source_height) as usize];
        let uv_plane =
            vec![128u8; (source_width.div_ceil(2) * source_height.div_ceil(2) * 2) as usize];

        let rgba = session
            .render_nv12_frame(
                source_width,
                source_height,
                output_width,
                output_height,
                &y_plane,
                &uv_plane,
                &ColorTransformUniforms::default(),
            )
            .await
            .expect("scaled native preview render failed");

        assert_eq!(rgba.len(), (output_width * output_height * 4) as usize);
        assert_eq!(rgba[3], 255);
    }
}
