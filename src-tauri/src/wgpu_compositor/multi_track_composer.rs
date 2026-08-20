use bytemuck::{Pod, Zeroable};
use std::borrow::Cow;
use wgpu::util::DeviceExt;

use crate::wgpu_compositor::chroma_key::ChromaKeyUniforms;
use crate::wgpu_compositor::lut_texture::GpuLut3D;

/// Blend mode for multi-track layer compositing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u32)]
pub enum BlendMode {
    #[default]
    Normal = 0,
    Multiply = 1,
    Screen = 2,
    Overlay = 3,
    Additive = 4,
    Difference = 5,
}

pub type LayerBlendMode = BlendMode;

/// Normalized crop margins [left, top, right, bottom] in range [0.0..1.0].
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CropMargins {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

impl CropMargins {
    pub fn to_vec4(&self) -> [f32; 4] {
        [self.left, self.top, self.right, self.bottom]
    }
}

/// 2D Transform properties for a video layer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayerTransform {
    /// Normalized canvas X translation [-1.0..1.0] (0.0 = center)
    pub translate_x: f32,
    /// Normalized canvas Y translation [-1.0..1.0] (0.0 = center)
    pub translate_y: f32,
    /// Horizontal scale multiplier (1.0 = 100% canvas fit)
    pub scale_x: f32,
    /// Vertical scale multiplier (1.0 = 100% canvas fit)
    pub scale_y: f32,
    /// Rotation angle in radians
    pub rotation_rad: f32,
}

impl Default for LayerTransform {
    fn default() -> Self {
        Self {
            translate_x: 0.0,
            translate_y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_rad: 0.0,
        }
    }
}

impl LayerTransform {
    /// Generates the $4\times 4$ affine transformation matrix for vertex transformation.
    pub fn to_matrix(&self) -> [[f32; 4]; 4] {
        let cos_r = self.rotation_rad.cos();
        let sin_r = self.rotation_rad.sin();

        let sx = self.scale_x;
        let sy = self.scale_y;

        // Combined 2D Scale * Rotation * Translation
        [
            [sx * cos_r, sx * sin_r, 0.0, 0.0],
            [-sy * sin_r, sy * cos_r, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [self.translate_x, self.translate_y, 0.0, 1.0],
        ]
    }
}

/// Color grading uniforms matching multi_track_blend.wgsl (112 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable, PartialEq)]
pub struct ColorGradeUniforms {
    pub exposure: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub brightness: f32,
    pub sepia: f32,
    pub grayscale: f32,
    pub hue_rotate: f32,
    pub vignette: f32,
    pub invert: f32,
    pub grain_intensity: f32,
    pub grain_size: f32,
    pub lut_intensity: f32,
    pub lut_size: f32,
    pub has_lut: u32,
    pub blur_strength: f32,
    pub blur_radius: f32,
    pub pixelate_size: f32,
    pub scanline_count: f32,
    pub scanline_intensity: f32,
    pub rgb_split_x: f32,
    pub rgb_split_y: f32,
    pub vibrance_amount: f32,
    pub vibrance_protected_hue_r: f32,
    pub vibrance_protected_hue_g: f32,
    pub vibrance_protected_hue_b: f32,
    pub _padding0: f32,
}

impl Default for ColorGradeUniforms {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            contrast: 1.0,
            saturation: 1.0,
            temperature: 0.0,
            tint: 0.0,
            brightness: 0.0,
            sepia: 0.0,
            grayscale: 0.0,
            hue_rotate: 0.0,
            vignette: 0.0,
            invert: 0.0,
            grain_intensity: 0.0,
            grain_size: 1.0,
            lut_intensity: 1.0,
            lut_size: 33.0,
            has_lut: 0,
            blur_strength: 0.0,
            blur_radius: 0.0,
            pixelate_size: 0.0,
            scanline_count: 0.0,
            scanline_intensity: 0.0,
            rgb_split_x: 0.0,
            rgb_split_y: 0.0,
            vibrance_amount: 0.0,
            vibrance_protected_hue_r: 0.91,
            vibrance_protected_hue_g: 0.69,
            vibrance_protected_hue_b: 0.55,
            _padding0: 0.0,
        }
    }
}

/// GPU Uniform layout matching multi_track_blend.wgsl (224 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct LayerUniforms {
    pub transform_matrix: [[f32; 4]; 4], // 64 bytes
    pub crop_margins: [f32; 4],          // 16 bytes
    pub opacity: f32,                    // 4 bytes
    pub blend_mode: u32,                 // 4 bytes
    pub is_premultiplied: u32,           // 4 bytes
    pub grain_seed: f32,                 // 4 bytes; deterministic per-source-frame grain seed
    pub color_grade: ColorGradeUniforms, // 112 bytes
    pub chroma_key: ChromaKeyUniforms,   // 48 bytes
}

/// A single renderable layer on the timeline.
pub struct CompositeLayer<'a> {
    pub texture_view: &'a wgpu::TextureView,
    pub lut: Option<&'a GpuLut3D>,
    pub z_index: i32,
    pub opacity: f32,
    pub blend_mode: BlendMode,
    pub transform: LayerTransform,
    pub crop: CropMargins,
    pub color_grade: ColorGradeUniforms,
    pub chroma_key: ChromaKeyUniforms,
}

impl<'a> CompositeLayer<'a> {
    pub fn new(texture_view: &'a wgpu::TextureView) -> Self {
        Self {
            texture_view,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct QuadVertex {
    position: [f32; 2],
    uv: [f32; 2],
}

/// Uniforms for dual-texture GPU transitions matching gpu_transitions.wgsl (32 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable, PartialEq)]
pub struct TransitionUniforms {
    pub progress: f32,        // [0.0..1.0]
    pub transition_type: u32, // 0: Cross-Dissolve, 1: Directional Wipe, 2: Zoom Blur
    pub feather: f32,         // [0.0..1.0]
    pub angle_rad: f32,       // Angle in radians
    pub blur_strength: f32,   // Blur intensity
    pub _pad0: f32,
    pub _pad1: f32,
    pub _pad2: f32,
}

impl Default for TransitionUniforms {
    fn default() -> Self {
        Self {
            progress: 0.0,
            transition_type: 0,
            feather: 0.1,
            angle_rad: 0.0,
            blur_strength: 0.25,
            _pad0: 0.0,
            _pad1: 0.0,
            _pad2: 0.0,
        }
    }
}

/// Dynamic Uniform Buffer Pool for zero-allocation per-frame uniform updates.
pub struct LayerUniformPool {
    pub buffer: wgpu::Buffer,
    pub max_layers: usize,
    pub aligned_stride: u64,
}

impl LayerUniformPool {
    pub fn new(device: &wgpu::Device, max_layers: usize) -> Self {
        let layer_size = std::mem::size_of::<LayerUniforms>() as u64;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as u64; // 256 bytes
        let aligned_stride = (layer_size + align - 1) & !(align - 1);
        let total_size = aligned_stride * max_layers.max(1) as u64;

        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Compositor Layer Uniform Dynamic Pool"),
            size: total_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            buffer,
            max_layers,
            aligned_stride,
        }
    }

    pub fn write_uniforms(
        &self,
        queue: &wgpu::Queue,
        layer_index: usize,
        uniforms: &LayerUniforms,
    ) {
        if layer_index < self.max_layers {
            let offset = (layer_index as u64) * self.aligned_stride;
            queue.write_buffer(&self.buffer, offset, bytemuck::bytes_of(uniforms));
        }
    }
}

/// High-performance GPU multi-track compositor supporting infinite layers, PIP, transforms, opacity, 3D LUT grading, Chroma Key, and Transitions.
pub struct MultiTrackCompositor {
    pub width: u32,
    pub height: u32,
    pub pipeline_normal: wgpu::RenderPipeline,
    pub pipeline_additive: wgpu::RenderPipeline,
    pub pipeline_transition: wgpu::RenderPipeline,
    pub uniform_bind_group_layout: wgpu::BindGroupLayout,
    pub texture_bind_group_layout: wgpu::BindGroupLayout,
    pub transition_uniform_bind_group_layout: wgpu::BindGroupLayout,
    pub transition_texture_bind_group_layout: wgpu::BindGroupLayout,
    pub sampler: wgpu::Sampler,
    pub default_identity_lut: GpuLut3D,
    target_format: wgpu::TextureFormat,
    quad_vertex_buffer: wgpu::Buffer,
}

impl MultiTrackCompositor {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, width: u32, height: u32) -> Self {
        Self::new_with_target_format(
            device,
            queue,
            width,
            height,
            wgpu::TextureFormat::Rgba8Unorm,
        )
    }

    /// Create a compositor whose render target matches the color encoding of
    /// the input layers. Native video layers use sRGB textures and therefore
    /// must use the sRGB target variant for display-ready readback bytes.
    pub fn new_with_target_format(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        target_format: wgpu::TextureFormat,
    ) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Multi-Track Blend Shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(include_str!(
                "../shaders/multi_track_blend.wgsl"
            ))),
        });

        let transition_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Dual-Texture Transition Shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(include_str!(
                "../shaders/gpu_transitions.wgsl"
            ))),
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Compositor Linear Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        let default_identity_lut = GpuLut3D::default_identity(device, queue);

        // Group 0: Uniform buffer for layer transforms, color grading, and chroma key
        let uniform_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("MultiTrack Layer Uniform Bind Group Layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });

        // Group 1: Diffuse Texture (2D) + Sampler + 3D LUT Texture + 3D LUT Sampler
        let texture_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("MultiTrack Layer Texture + 3D LUT Bind Group Layout"),
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
                            view_dimension: wgpu::TextureViewDimension::D3,
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

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Compositor Pipeline Layout"),
            bind_group_layouts: &[&uniform_bind_group_layout, &texture_bind_group_layout],
            push_constant_ranges: &[],
        });

        // Transition Layouts
        let transition_uniform_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Transition Uniform Bind Group Layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });

        let transition_texture_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Transition Dual Texture Bind Group Layout"),
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

        let transition_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Transition Pipeline Layout"),
                bind_group_layouts: &[
                    &transition_uniform_bind_group_layout,
                    &transition_texture_bind_group_layout,
                ],
                push_constant_ranges: &[],
            });

        let vertex_buffer_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<QuadVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x2,
                    offset: 0,
                    shader_location: 0,
                },
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x2,
                    offset: 8,
                    shader_location: 1,
                },
            ],
        };

        // Normal alpha blending pipeline (premultiplied alpha over)
        let pipeline_normal = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Compositor Normal Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: std::slice::from_ref(&vertex_buffer_layout),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Additive blending pipeline
        let pipeline_additive = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Compositor Additive Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: std::slice::from_ref(&vertex_buffer_layout),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::One,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::One,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Dual-texture transition pipeline
        let pipeline_transition = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Compositor Transition Render Pipeline"),
            layout: Some(&transition_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &transition_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[vertex_buffer_layout],
            },
            fragment: Some(wgpu::FragmentState {
                module: &transition_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Fullscreen quad [-1..1] with texture UVs [0..1]
        let vertices = &[
            QuadVertex {
                position: [-1.0, 1.0],
                uv: [0.0, 0.0],
            },
            QuadVertex {
                position: [-1.0, -1.0],
                uv: [0.0, 1.0],
            },
            QuadVertex {
                position: [1.0, -1.0],
                uv: [1.0, 1.0],
            },
            QuadVertex {
                position: [-1.0, 1.0],
                uv: [0.0, 0.0],
            },
            QuadVertex {
                position: [1.0, -1.0],
                uv: [1.0, 1.0],
            },
            QuadVertex {
                position: [1.0, 1.0],
                uv: [1.0, 0.0],
            },
        ];

        let quad_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Compositor Quad Vertex Buffer"),
            contents: bytemuck::cast_slice(vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });

        Self {
            width,
            height,
            pipeline_normal,
            pipeline_additive,
            pipeline_transition,
            uniform_bind_group_layout,
            texture_bind_group_layout,
            transition_uniform_bind_group_layout,
            transition_texture_bind_group_layout,
            sampler,
            default_identity_lut,
            target_format,
            quad_vertex_buffer,
        }
    }

    /// Bind group layout helper for diffuse texture + 3D LUT (Group 1)
    pub fn create_layer_texture_bind_group(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        sampler_2d: &wgpu::Sampler,
        diffuse_view: &wgpu::TextureView,
        lut: &GpuLut3D,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Layer Texture + 3D LUT BindGroup"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(diffuse_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(sampler_2d),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&lut.view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&lut.sampler),
                },
            ],
        })
    }

    /// Composites multiple timeline layers onto the target texture view in back-to-front Z-order.
    pub fn composite_layers(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target_view: &wgpu::TextureView,
        layers: &[CompositeLayer],
        clear_color: Option<wgpu::Color>,
    ) -> Result<(), String> {
        // Sort layer references ascending by z_index (back to front)
        let mut sorted_layers: Vec<&CompositeLayer> = layers.iter().collect();
        sorted_layers.sort_by_key(|l| l.z_index);

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("MultiTrack Composite Encoder"),
        });

        let mut uniform_buffers = Vec::with_capacity(sorted_layers.len());
        let mut uniform_bind_groups = Vec::with_capacity(sorted_layers.len());
        let mut texture_bind_groups = Vec::with_capacity(sorted_layers.len());

        for layer in sorted_layers.iter() {
            let lut = layer.lut.unwrap_or(&self.default_identity_lut);

            let mut color_grade = layer.color_grade;
            if layer.lut.is_some() {
                color_grade.has_lut = 1;
                color_grade.lut_size = lut.size as f32;
            }

            let uniforms = LayerUniforms {
                transform_matrix: layer.transform.to_matrix(),
                crop_margins: layer.crop.to_vec4(),
                opacity: layer.opacity.clamp(0.0, 1.0),
                blend_mode: layer.blend_mode as u32,
                is_premultiplied: 0,
                grain_seed: layer.chroma_key._pad0,
                color_grade,
                chroma_key: layer.chroma_key,
            };

            let uniform_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Layer Uniform Buffer"),
                contents: bytemuck::bytes_of(&uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });

            let uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Layer Uniform Bind Group"),
                layout: &self.uniform_bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buf.as_entire_binding(),
                }],
            });

            let texture_bind_group = Self::create_layer_texture_bind_group(
                device,
                &self.texture_bind_group_layout,
                &self.sampler,
                layer.texture_view,
                lut,
            );

            uniform_buffers.push(uniform_buf);
            uniform_bind_groups.push(uniform_bind_group);
            texture_bind_groups.push(texture_bind_group);
        }

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("MultiTrack Composite Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if let Some(color) = clear_color {
                            wgpu::LoadOp::Clear(color)
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));

            for (idx, layer) in sorted_layers.iter().enumerate() {
                let pipeline = match layer.blend_mode {
                    BlendMode::Additive => &self.pipeline_additive,
                    _ => &self.pipeline_normal,
                };

                render_pass.set_pipeline(pipeline);
                render_pass.set_bind_group(0, &uniform_bind_groups[idx], &[]);
                render_pass.set_bind_group(1, &texture_bind_groups[idx], &[]);
                render_pass.draw(0..6, 0..1);
            }
        }

        queue.submit(Some(encoder.finish()));
        Ok(())
    }

    /// Primary render helper using default compositor dimensions.
    pub async fn render_to_rgba_bytes(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        layers: &[CompositeLayer<'_>],
    ) -> Result<Vec<u8>, String> {
        self.render_to_rgba_bytes_with_size(
            device,
            queue,
            self.width,
            self.height,
            layers,
            Some(wgpu::Color::BLACK),
        )
        .await
    }

    /// Render to RGBA byte buffer with explicit dimensions and custom clear color.
    pub async fn render_to_rgba_bytes_with_size(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        layers: &[CompositeLayer<'_>],
        clear_color: Option<wgpu::Color>,
    ) -> Result<Vec<u8>, String> {
        let texture_desc = wgpu::TextureDescriptor {
            label: Some("Compositor Render Target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.target_format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        };

        let target_texture = device.create_texture(&texture_desc);
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        self.composite_layers(device, queue, &target_view, layers, clear_color)?;

        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let output_buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;

        let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Compositor Output Readback Buffer"),
            size: output_buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Readback Copy Encoder"),
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
            texture_desc.size,
        );

        queue.submit(Some(encoder.finish()));

        let buffer_slice = output_buffer.slice(..);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });

        device.poll(wgpu::Maintain::Wait);
        receiver
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

        let mapped_range = buffer_slice.get_mapped_range();
        let mut unpadded_rgba = Vec::with_capacity((width * height * bytes_per_pixel) as usize);

        for row in 0..height {
            let start = (row * padded_bytes_per_row) as usize;
            let end = start + unpadded_bytes_per_row as usize;
            unpadded_rgba.extend_from_slice(&mapped_range[start..end]);
        }

        drop(mapped_range);
        output_buffer.unmap();

        Ok(unpadded_rgba)
    }

    /// Composites a dual-texture transition (from -> to) onto the target view.
    #[allow(clippy::too_many_arguments)]
    pub fn composite_transition(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target_view: &wgpu::TextureView,
        from_view: &wgpu::TextureView,
        to_view: &wgpu::TextureView,
        uniforms: &TransitionUniforms,
        clear_color: Option<wgpu::Color>,
    ) -> Result<(), String> {
        let uniform_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Transition Uniform Buffer"),
            contents: bytemuck::bytes_of(uniforms),
            usage: wgpu::BufferUsages::UNIFORM,
        });

        let uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Transition Uniform Bind Group"),
            layout: &self.transition_uniform_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buf.as_entire_binding(),
            }],
        });

        let texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Transition Dual Texture Bind Group"),
            layout: &self.transition_texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(from_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(to_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Transition Composite Encoder"),
        });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Transition Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if let Some(color) = clear_color {
                            wgpu::LoadOp::Clear(color)
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
            render_pass.set_pipeline(&self.pipeline_transition);
            render_pass.set_bind_group(0, &uniform_bind_group, &[]);
            render_pass.set_bind_group(1, &texture_bind_group, &[]);
            render_pass.draw(0..6, 0..1);
        }

        queue.submit(Some(encoder.finish()));
        Ok(())
    }

    /// Render a dual-texture transition to RGBA bytes.
    #[allow(clippy::too_many_arguments)]
    pub async fn render_transition_to_rgba_bytes(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        from_view: &wgpu::TextureView,
        to_view: &wgpu::TextureView,
        uniforms: &TransitionUniforms,
    ) -> Result<Vec<u8>, String> {
        let texture_desc = wgpu::TextureDescriptor {
            label: Some("Transition Render Target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.target_format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        };

        let target_texture = device.create_texture(&texture_desc);
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        self.composite_transition(
            device,
            queue,
            &target_view,
            from_view,
            to_view,
            uniforms,
            Some(wgpu::Color::BLACK),
        )?;

        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let output_buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;

        let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Transition Output Readback Buffer"),
            size: output_buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Transition Readback Encoder"),
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
            texture_desc.size,
        );

        queue.submit(Some(encoder.finish()));

        let buffer_slice = output_buffer.slice(..);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });

        device.poll(wgpu::Maintain::Wait);
        receiver
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

        let mapped_range = buffer_slice.get_mapped_range();
        let mut unpadded_rgba = Vec::with_capacity((width * height * bytes_per_pixel) as usize);

        for row in 0..height {
            let start = (row * padded_bytes_per_row) as usize;
            let end = start + unpadded_bytes_per_row as usize;
            unpadded_rgba.extend_from_slice(&mapped_range[start..end]);
        }

        drop(mapped_range);
        output_buffer.unmap();

        Ok(unpadded_rgba)
    }
}
