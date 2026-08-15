use std::borrow::Cow;

/// Represents a pre-allocated NV12 slot holding Y and UV textures, views, and a pre-baked BindGroup.
pub struct Nv12FrameSlot {
    pub y_texture: wgpu::Texture,
    pub uv_texture: wgpu::Texture,
    pub y_view: wgpu::TextureView,
    pub uv_view: wgpu::TextureView,
    pub bind_group: wgpu::BindGroup,
}

/// A pre-allocated ring buffer of NV12 texture pairs and pre-baked bind groups.
/// Eliminates continuous GPU driver reallocation, VRAM fragmentation, and CPU GC pauses
/// during high-frequency timeline scrubbing.
pub struct Nv12TextureRingBuffer {
    slots: Vec<Nv12FrameSlot>,
    capacity: usize,
    write_index: usize,
    active_index: usize,
    pub width: u32,
    pub height: u32,
}

impl Nv12TextureRingBuffer {
    /// Create a new pre-allocated NV12 texture ring buffer with pre-baked bind groups.
    pub fn new(
        device: &wgpu::Device,
        bind_group_layout: &wgpu::BindGroupLayout,
        sampler_y: &wgpu::Sampler,
        sampler_uv: &wgpu::Sampler,
        width: u32,
        height: u32,
        capacity: usize,
    ) -> Self {
        assert!(capacity > 0, "Ring buffer capacity must be > 0");

        let mut slots = Vec::with_capacity(capacity);

        for _ in 0..capacity {
            let slot = Self::create_slot(
                device,
                bind_group_layout,
                sampler_y,
                sampler_uv,
                width,
                height,
            );
            slots.push(slot);
        }

        Self {
            slots,
            capacity,
            write_index: 0,
            active_index: 0,
            width,
            height,
        }
    }

    /// Internal helper to create and pre-bake a single Nv12FrameSlot
    pub fn create_slot(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        sampler_y: &wgpu::Sampler,
        sampler_uv: &wgpu::Sampler,
        width: u32,
        height: u32,
    ) -> Nv12FrameSlot {
        // 1. Y-Plane: Full resolution R8Unorm (1 byte per pixel)
        let y_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Pool Y Texture"),
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

        let uv_width = (width + 1) / 2;
        let uv_height = (height + 1) / 2;

        // 2. UV-Plane: Half resolution Rg8Unorm (interleaved U and V, 2 bytes per texel)
        let uv_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Pool UV Texture"),
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

        let y_view = y_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let uv_view = uv_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // 3. Pre-bake the BindGroup directly with the views & samplers
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Pool NV12 BindGroup"),
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
            ],
        });

        Nv12FrameSlot {
            y_texture,
            uv_texture,
            y_view,
            uv_view,
            bind_group,
        }
    }

    /// Uploads an uncompressed NV12 frame to the next available ring buffer slot.
    /// Direct DMA texture transfer without intermediate CPU heap allocations.
    pub fn upload_frame(
        &mut self,
        queue: &wgpu::Queue,
        y_plane: &[u8],
        uv_plane: &[u8],
        linesize_y: u32,
        linesize_uv: u32,
    ) {
        let slot_idx = self.write_index;
        let slot = &self.slots[slot_idx];

        let uv_width = (self.width + 1) / 2;
        let uv_height = (self.height + 1) / 2;

        let actual_linesize_y = linesize_y.max(self.width);
        let actual_linesize_uv = linesize_uv.max(uv_width * 2);

        // 1. Upload Y-Plane (R8Unorm: 1 byte per pixel)
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

        // 2. Upload UV-Plane (Rg8Unorm: 2 bytes per texel)
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

        // Mark this slot as the latest ready frame and advance ring pointer
        self.active_index = slot_idx;
        self.write_index = (self.write_index + 1) % self.capacity;
    }


    /// Retrieves the active pre-baked BindGroup for immediate O(1) rendering.
    #[inline(always)]
    pub fn active_bind_group(&self) -> &wgpu::BindGroup {
        &self.slots[self.active_index].bind_group
    }

    /// Retrieves the active slot.
    #[inline(always)]
    pub fn active_slot(&self) -> &Nv12FrameSlot {
        &self.slots[self.active_index]
    }

    /// Returns the current active slot index.
    #[inline(always)]
    pub fn active_index(&self) -> usize {
        self.active_index
    }

    /// Returns the current write slot index.
    #[inline(always)]
    pub fn write_index(&self) -> usize {
        self.write_index
    }

    /// Returns the capacity of the ring buffer.
    #[inline(always)]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Get slot at specific index
    #[inline(always)]
    pub fn slot(&self, idx: usize) -> Option<&Nv12FrameSlot> {
        self.slots.get(idx)
    }

    /// Dynamic resize if the media resolution changes during scrubbing.
    pub fn ensure_dimensions(
        &mut self,
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        sampler_y: &wgpu::Sampler,
        sampler_uv: &wgpu::Sampler,
        width: u32,
        height: u32,
    ) {
        if self.width == width && self.height == height {
            return;
        }

        self.width = width;

        self.height = height;
        self.write_index = 0;
        self.active_index = 0;

        self.slots.clear();
        for _ in 0..self.capacity {
            self.slots.push(Self::create_slot(
                device,
                layout,
                sampler_y,
                sampler_uv,
                width,
                height,
            ));
        }
    }
}

/// Helper function to create standard NV12 BindGroupLayout
pub fn create_nv12_bind_group_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("NV12 Ring Buffer Bind Group Layout"),
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
    })
}

/// Helper function to create standard NV12 linear filtering sampler
pub fn create_nv12_sampler(device: &wgpu::Device) -> wgpu::Sampler {
    device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("NV12 Linear Sampler"),
        address_mode_u: wgpu::AddressMode::ClampToEdge,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    })
}

/// Helper function to create standard NV12 render pipeline
pub fn create_nv12_render_pipeline(
    device: &wgpu::Device,
    bind_group_layout: &wgpu::BindGroupLayout,
    target_format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let shader_source = include_str!("../shaders/yuv_to_rgb.wgsl");
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("NV12 Ring Buffer Shader"),
        source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(shader_source)),
    });

    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("NV12 Ring Buffer Pipeline Layout"),
        bind_group_layouts: &[bind_group_layout],
        push_constant_ranges: &[],
    });

    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("NV12 Ring Buffer Render Pipeline"),
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

/// Renders a scrub frame using the pre-allocated ring buffer and a render pipeline.
/// Direct O(1) execution with zero descriptor / texture reallocations.
pub fn render_scrub_frame(
    ring_buffer: &mut Nv12TextureRingBuffer,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pipeline: &wgpu::RenderPipeline,
    target_view: &wgpu::TextureView,
    raw_y: &[u8],
    raw_uv: &[u8],
    stride_y: u32,
    stride_uv: u32,
) {
    // 1. Zero-alloc DMA texture write to next slot in ring
    ring_buffer.upload_frame(queue, raw_y, raw_uv, stride_y, stride_uv);

    // 2. Encode Render Pass using the pre-baked BindGroup
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("Timeline Scrub Encoder"),
    });

    {
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("NV12 Render Pass"),
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
        // Instant O(1) BindGroup assignment
        rpass.set_bind_group(0, ring_buffer.active_bind_group(), &[]);
        rpass.draw(0..6, 0..1); // Fullscreen quad
    }

    queue.submit(std::iter::once(encoder.finish()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ring_buffer_initialization_and_cycling() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await;

        if let Some(adapter) = adapter {
            if let Ok((device, queue)) = adapter
                .request_device(&wgpu::DeviceDescriptor::default(), None)
                .await
            {
                let layout = create_nv12_bind_group_layout(&device);
                let sampler = create_nv12_sampler(&device);

                let width = 64u32;
                let height = 64u32;
                let capacity = 4usize;

                let mut ring = Nv12TextureRingBuffer::new(
                    &device,
                    &layout,
                    &sampler,
                    &sampler,
                    width,
                    height,
                    capacity,
                );

                assert_eq!(ring.capacity(), 4);
                assert_eq!(ring.write_index(), 0);
                assert_eq!(ring.active_index(), 0);

                let y_frame = vec![128u8; (width * height) as usize];
                let uv_frame = vec![128u8; (width * height / 2) as usize];

                // Frame 0 upload
                ring.upload_frame(&queue, &y_frame, &uv_frame, width, width);
                assert_eq!(ring.active_index(), 0);
                assert_eq!(ring.write_index(), 1);

                // Frame 1 upload
                ring.upload_frame(&queue, &y_frame, &uv_frame, width, width);
                assert_eq!(ring.active_index(), 1);
                assert_eq!(ring.write_index(), 2);

                // Frame 2 upload
                ring.upload_frame(&queue, &y_frame, &uv_frame, width, width);
                assert_eq!(ring.active_index(), 2);
                assert_eq!(ring.write_index(), 3);

                // Frame 3 upload
                ring.upload_frame(&queue, &y_frame, &uv_frame, width, width);
                assert_eq!(ring.active_index(), 3);
                assert_eq!(ring.write_index(), 0); // Wraps around

                // Frame 4 upload (recycles slot 0)
                ring.upload_frame(&queue, &y_frame, &uv_frame, width, width);
                assert_eq!(ring.active_index(), 0);
                assert_eq!(ring.write_index(), 1);
            }
        }
    }

    #[tokio::test]
    async fn test_ring_buffer_ensure_dimensions() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await;

        if let Some(adapter) = adapter {
            if let Ok((device, _queue)) = adapter
                .request_device(&wgpu::DeviceDescriptor::default(), None)
                .await
            {
                let layout = create_nv12_bind_group_layout(&device);
                let sampler = create_nv12_sampler(&device);

                let mut ring = Nv12TextureRingBuffer::new(
                    &device,
                    &layout,
                    &sampler,
                    &sampler,
                    64,
                    64,
                    3,
                );

                assert_eq!(ring.width, 64);
                assert_eq!(ring.height, 64);

                // Resize to 128x128
                ring.ensure_dimensions(&device, &layout, &sampler, &sampler, 128, 128);
                assert_eq!(ring.width, 128);
                assert_eq!(ring.height, 128);
                assert_eq!(ring.capacity(), 3);
                assert_eq!(ring.write_index(), 0);
                assert_eq!(ring.active_index(), 0);
            }
        }
    }

    #[tokio::test]
    async fn test_ring_buffer_render_scrub_frame() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await;

        if let Some(adapter) = adapter {
            if let Ok((device, queue)) = adapter
                .request_device(&wgpu::DeviceDescriptor::default(), None)
                .await
            {
                let layout = create_nv12_bind_group_layout(&device);
                let sampler = create_nv12_sampler(&device);
                let pipeline = create_nv12_render_pipeline(
                    &device,
                    &layout,
                    wgpu::TextureFormat::Rgba8UnormSrgb,
                );

                let width = 64u32;
                let height = 64u32;

                let mut ring = Nv12TextureRingBuffer::new(
                    &device,
                    &layout,
                    &sampler,
                    &sampler,
                    width,
                    height,
                    4,
                );

                let target_texture = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Target Test Texture"),
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

                let y_frame = vec![128u8; (width * height) as usize];
                let uv_frame = vec![128u8; (width * height / 2) as usize];

                render_scrub_frame(
                    &mut ring,
                    &device,
                    &queue,
                    &pipeline,
                    &target_view,
                    &y_frame,
                    &uv_frame,
                    width,
                    width,
                );

                assert_eq!(ring.active_index(), 0);
                assert_eq!(ring.write_index(), 1);
            }
        }
    }

    #[tokio::test]
    async fn test_ring_buffer_odd_and_non_standard_dimensions() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await;

        if let Some(adapter) = adapter {
            if let Ok((device, queue)) = adapter
                .request_device(&wgpu::DeviceDescriptor::default(), None)
                .await
            {
                let layout = create_nv12_bind_group_layout(&device);
                let sampler = create_nv12_sampler(&device);

                // Test odd/non-standard resolutions
                let odd_resolutions = [(854u32, 480u32), (720, 1280), (1080, 1920)];

                for (w, h) in odd_resolutions {
                    let mut ring = Nv12TextureRingBuffer::new(
                        &device,
                        &layout,
                        &sampler,
                        &sampler,
                        w,
                        h,
                        2,
                    );

                    let uv_w = (w + 1) / 2;
                    let uv_h = (h + 1) / 2;

                    let y_frame = vec![128u8; (w * h) as usize];
                    let uv_frame = vec![128u8; (uv_w * 2 * uv_h) as usize];

                    ring.upload_frame(&queue, &y_frame, &uv_frame, w, uv_w * 2);
                    let _bg = ring.active_bind_group();
                }
            }
        }
    }
}

