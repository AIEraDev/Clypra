//! GPU pipeline manager for the SDF-based text effect primitive toolkit.
//!
//! Owns one compiled `wgpu::RenderPipeline` per primitive, a shared sampler,
//! and the uniform buffer layout shared by all four shaders.
//!
//! # Usage
//! ```ignore
//! let pipelines = TextEffectPipeline::new(&device, wgpu::TextureFormat::Rgba8Unorm);
//! // In a frame:
//! let cmd = pipelines.render_distance_threshold(
//!     &device, &queue, &sdf_texture_view,
//!     &DistanceThresholdParams { threshold: 0.502, smoothing: 0.02, sdf_scale: 1.0, _pad: 0.0 },
//!     output_width, output_height,
//! );
//! queue.submit([cmd]);
//! ```

use bytemuck::{Pod, Zeroable};
use std::borrow::Cow;
use wgpu::util::DeviceExt;

// ── Uniform structs (must mirror the WGSL struct layouts exactly) ────────────

/// Uniforms for `sdf_distance_threshold.wgsl`.
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct DistanceThresholdParams {
    /// SDF contour edge in normalised [0..1] space (0.502 ≈ 128/255).
    pub threshold : f32,
    /// AA feather half-width in SDF units. 0 → hard clip, 0.02 → soft AA.
    pub smoothing : f32,
    /// Reciprocal of the SDF radius (converts normalised SDF → signed pixels).
    pub sdf_scale : f32,
    pub _pad      : f32,
    /// Text fill colour (premultiplied linear RGBA).
    pub color     : [f32; 4],
}

impl Default for DistanceThresholdParams {
    fn default() -> Self {
        Self {
            threshold: 0.502,
            smoothing: 0.02,
            sdf_scale: 1.0,
            _pad:      0.0,
            color:     [1.0, 1.0, 1.0, 1.0],
        }
    }
}

/// Uniforms for `sdf_outline.wgsl`.
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct OutlineParams {
    pub threshold : f32,
    /// Outline band half-width in normalised SDF units.
    pub width     : f32,
    pub smoothing : f32,
    pub sdf_scale : f32,
    /// Premultiplied RGBA linear sRGB colour.
    pub color     : [f32; 4],
}

impl Default for OutlineParams {
    fn default() -> Self {
        Self {
            threshold: 0.502,
            width:     0.05,
            smoothing: 0.01,
            sdf_scale: 1.0,
            color:     [1.0, 1.0, 1.0, 1.0],
        }
    }
}

/// Uniforms for `sdf_glow.wgsl`.
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct GlowParams {
    pub threshold : f32,
    /// Glow radius in normalised SDF units (maps to the pad budget in the SDF).
    pub radius    : f32,
    /// Peak glow intensity multiplier [0..1].
    pub intensity : f32,
    pub sdf_scale : f32,
    pub color     : [f32; 4],
}

impl Default for GlowParams {
    fn default() -> Self {
        Self {
            threshold: 0.502,
            radius:    0.2,
            intensity: 0.8,
            sdf_scale: 1.0,
            color:     [0.5, 0.7, 1.0, 1.0],
        }
    }
}

/// Uniforms for `sdf_drop_shadow.wgsl`.
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct DropShadowParams {
    /// Horizontal UV shift for the shadow (positive = shadow to the right).
    pub offset_x   : f32,
    /// Vertical UV shift (positive = shadow downward in texture space).
    pub offset_y   : f32,
    pub threshold  : f32,
    pub radius     : f32,
    pub intensity  : f32,
    pub sdf_scale  : f32,
    pub _pad0      : f32,
    pub _pad1      : f32,
    pub color      : [f32; 4],
}

impl Default for DropShadowParams {
    fn default() -> Self {
        Self {
            offset_x:  0.01,
            offset_y:  0.01,
            threshold: 0.502,
            radius:    0.1,
            intensity: 0.7,
            sdf_scale: 1.0,
            _pad0:     0.0,
            _pad1:     0.0,
            color:     [0.0, 0.0, 0.0, 1.0],
        }
    }
}

// ── Pipeline owner ────────────────────────────────────────────────────────────

/// Compiled GPU pipelines for all four SDF primitive shaders.
pub struct TextEffectPipeline {
    pub pipeline_threshold   : wgpu::RenderPipeline,
    pub pipeline_outline     : wgpu::RenderPipeline,
    pub pipeline_glow        : wgpu::RenderPipeline,
    pub pipeline_drop_shadow : wgpu::RenderPipeline,

    /// Bind group layout shared by all four pipelines (uniform buf + SDF texture + sampler).
    pub bind_group_layout    : wgpu::BindGroupLayout,
    /// Linear clamp-to-edge sampler shared across all passes.
    pub sampler              : wgpu::Sampler,

    _target_format           : wgpu::TextureFormat,
}

impl TextEffectPipeline {
    pub fn new(device: &wgpu::Device, target_format: wgpu::TextureFormat) -> Self {
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label:            Some("SDF Primitive Sampler"),
            address_mode_u:   wgpu::AddressMode::ClampToEdge,
            address_mode_v:   wgpu::AddressMode::ClampToEdge,
            address_mode_w:   wgpu::AddressMode::ClampToEdge,
            mag_filter:       wgpu::FilterMode::Linear,
            min_filter:       wgpu::FilterMode::Linear,
            mipmap_filter:    wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        // All four shaders share the same bind-group layout:
        //   binding 0 — uniform buffer  (params)
        //   binding 1 — texture_2d<f32> (SDF texture)
        //   binding 2 — sampler
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("SDF Primitive BGL"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding:    0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty:                 wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size:   None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding:    1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type:    wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled:   false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding:    2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:                Some("SDF Primitive Pipeline Layout"),
            bind_group_layouts:   &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        // Alpha-premultiplied additive blend for all SDF primitive outputs.
        // Each pass composites over the previous using standard over-operator.
        let blend = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation:  wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation:  wgpu::BlendOperation::Add,
            },
        };

        let make_pipeline = |label: &str, wgsl: &str| -> wgpu::RenderPipeline {
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label:  Some(label),
                source: wgpu::ShaderSource::Wgsl(Cow::Owned(wgsl.to_string())),
            });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label:  Some(label),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module:      &shader,
                    entry_point: Some("vs_main"),
                    buffers:     &[], // full-screen quad via vertex_index
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module:      &shader,
                    entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format:     target_format,
                        blend:      Some(blend),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology:          wgpu::PrimitiveTopology::TriangleList,
                    strip_index_format: None,
                    front_face:        wgpu::FrontFace::Ccw,
                    cull_mode:         None,
                    ..Default::default()
                },
                depth_stencil:  None,
                multisample:    wgpu::MultisampleState::default(),
                multiview:      None,
                cache:          None,
            })
        };

        let pipeline_threshold = make_pipeline(
            "SDF Distance Threshold",
            include_str!("../shaders/sdf_distance_threshold.wgsl"),
        );
        let pipeline_outline = make_pipeline(
            "SDF Outline",
            include_str!("../shaders/sdf_outline.wgsl"),
        );
        let pipeline_glow = make_pipeline(
            "SDF Glow",
            include_str!("../shaders/sdf_glow.wgsl"),
        );
        let pipeline_drop_shadow = make_pipeline(
            "SDF Drop Shadow",
            include_str!("../shaders/sdf_drop_shadow.wgsl"),
        );

        Self {
            pipeline_threshold,
            pipeline_outline,
            pipeline_glow,
            pipeline_drop_shadow,
            bind_group_layout,
            sampler,
            _target_format: target_format,
        }
    }

    // ── Render helpers ──────────────────────────────────────────────────────

    /// Upload `params` to a per-draw uniform buffer and return it
    /// (caller uses it to build the bind group).
    fn upload_uniforms<T: Pod>(&self, device: &wgpu::Device, params: &T, label: &str) -> wgpu::Buffer {
        device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some(label),
            contents: bytemuck::bytes_of(params),
            usage:    wgpu::BufferUsages::UNIFORM,
        })
    }

    fn make_bind_group(
        &self,
        device:      &wgpu::Device,
        uniform_buf: &wgpu::Buffer,
        sdf_view:    &wgpu::TextureView,
        label:       &str,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some(label),
            layout:  &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniform_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(sdf_view) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.sampler) },
            ],
        })
    }

    fn render_pass(
        &self,
        device:      &wgpu::Device,
        pipeline:    &wgpu::RenderPipeline,
        bind_group:  &wgpu::BindGroup,
        target_view: &wgpu::TextureView,
        label:       &str,
    ) -> wgpu::CommandBuffer {
        let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some(label),
        });
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label:                    Some(label),
                color_attachments:        &[Some(wgpu::RenderPassColorAttachment {
                    view:           target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load:  wgpu::LoadOp::Load, // accumulate over previous pass output
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes:         None,
                occlusion_query_set:      None,
            });
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, bind_group, &[]);
            pass.draw(0..6, 0..1); // full-screen quad via vertex_index
        }
        enc.finish()
    }

    // ── Public per-primitive render methods ──────────────────────────────────

    pub fn render_distance_threshold(
        &self,
        device:      &wgpu::Device,
        sdf_view:    &wgpu::TextureView,
        target_view: &wgpu::TextureView,
        params:      &DistanceThresholdParams,
    ) -> wgpu::CommandBuffer {
        let ub = self.upload_uniforms(device, params, "ub:distance_threshold");
        let bg = self.make_bind_group(device, &ub, sdf_view, "bg:distance_threshold");
        self.render_pass(device, &self.pipeline_threshold, &bg, target_view, "pass:distance_threshold")
    }

    pub fn render_outline(
        &self,
        device:      &wgpu::Device,
        sdf_view:    &wgpu::TextureView,
        target_view: &wgpu::TextureView,
        params:      &OutlineParams,
    ) -> wgpu::CommandBuffer {
        let ub = self.upload_uniforms(device, params, "ub:outline");
        let bg = self.make_bind_group(device, &ub, sdf_view, "bg:outline");
        self.render_pass(device, &self.pipeline_outline, &bg, target_view, "pass:outline")
    }

    pub fn render_glow(
        &self,
        device:      &wgpu::Device,
        sdf_view:    &wgpu::TextureView,
        target_view: &wgpu::TextureView,
        params:      &GlowParams,
    ) -> wgpu::CommandBuffer {
        let ub = self.upload_uniforms(device, params, "ub:glow");
        let bg = self.make_bind_group(device, &ub, sdf_view, "bg:glow");
        self.render_pass(device, &self.pipeline_glow, &bg, target_view, "pass:glow")
    }

    pub fn render_drop_shadow(
        &self,
        device:      &wgpu::Device,
        sdf_view:    &wgpu::TextureView,
        target_view: &wgpu::TextureView,
        params:      &DropShadowParams,
    ) -> wgpu::CommandBuffer {
        let ub = self.upload_uniforms(device, params, "ub:drop_shadow");
        let bg = self.make_bind_group(device, &ub, sdf_view, "bg:drop_shadow");
        self.render_pass(device, &self.pipeline_drop_shadow, &bg, target_view, "pass:drop_shadow")
    }
}
