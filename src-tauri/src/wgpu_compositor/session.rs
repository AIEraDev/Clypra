use clypra_native_core::contracts::TextLayerSnapshot;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use wgpu::util::DeviceExt;

use super::adapter_selector::GpuContext;
use super::multi_track_composer::MultiTrackCompositor;
use super::render_path::{DisableReason, DxgiFailureReason, DxgiImportState};
use super::rgba_layer_cache::{RgbaLayerTextureCache, TEXT_LAYER_CACHE_BYTES};
use super::text_effect_pipeline::{
    DistanceThresholdParams, DropShadowParams, GlowParams, OutlineParams, TextEffectPipeline,
};
use super::text_layer_cache::{text_layer_cache_key, TextLayerCache};
use super::yuv_ring_buffer::{
    create_yuv_hdr_bind_group_layout, create_yuv_hdr_render_pipeline, create_yuv_hdr_sampler,
    render_yuv_frame, ColorTransformUniforms, YuvPixelFormat, YuvTextureRingBuffer,
};

/// Persistent YUV preview resources shared by native editing-preview calls.
///
/// The source-size ring buffer is recreated only when the decoded stream
/// changes resolution or pixel format. The output target remains per-frame for
/// now because the next phase will replace CPU readback with a native surface.
pub struct NativePreviewSession {
    pub gpu: Arc<GpuContext>,
    pub dxgi_state: DxgiImportState,
    pub(crate) yuv_layout: wgpu::BindGroupLayout,
    pub(crate) sampler: wgpu::Sampler,
    pub(crate) pipeline: wgpu::RenderPipeline,
    pub(crate) rings: HashMap<String, YuvTextureRingBuffer>,
    pub(crate) layer_textures: HashMap<String, Arc<wgpu::Texture>>,
    pub(crate) rgba_layers: RgbaLayerTextureCache,
    pub(crate) transparent_mask_placeholder: Arc<wgpu::Texture>,
    pub(crate) mask_registration_history: HashSet<String>,
    pub text_cache: TextLayerCache,
    pub text_pipeline: TextEffectPipeline,
    pub(crate) matte_prefetchers: HashMap<String, Arc<crate::clymatte::MattePrefetcher>>,
    pub(crate) compositors: Vec<CachedCompositor>,
    /// Set once by `probe_decode_capability` during session configuration.
    /// Kept for the lifetime of the session so sampling cannot lose the
    /// decision when the first present attempt is dropped or unsampled.
    pub(crate) capability_policy: Option<crate::native_core::DecodeCapabilityPolicy>,
    pub(crate) capability_probe_us: Option<u64>,
}

pub(crate) struct CachedCompositor {
    width: u32,
    height: u32,
    target_format: wgpu::TextureFormat,
    compositor: MultiTrackCompositor,
}


impl NativePreviewSession {
    pub fn new(gpu: Arc<GpuContext>) -> Self {
        let mut _span = crate::cold_start::SpanGuard::start("c0_pipeline_compile");
        let yuv_layout = create_yuv_hdr_bind_group_layout(&gpu.device);
        let sampler = create_yuv_hdr_sampler(&gpu.device);
        let pipeline = create_yuv_hdr_render_pipeline(
            &gpu.device,
            &yuv_layout,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        );
        let text_pipeline =
            TextEffectPipeline::new(&gpu.device, wgpu::TextureFormat::Rgba8UnormSrgb);
        let text_cache = TextLayerCache::new(TEXT_LAYER_CACHE_BYTES);
        let dxgi_state = if gpu.capabilities.zero_copy_available() {
            DxgiImportState::Unknown
        } else {
            crate::wgpu_compositor::adapter_selector::mark_dxgi_runtime_disabled();
            DxgiImportState::Disabled {
                reason: DisableReason::UnsupportedFeature,
            }
        };
        let transparent_mask_placeholder = Self::create_transparent_mask_placeholder(&gpu);
        _span.finish_ok();

        Self {
            gpu,
            dxgi_state,
            yuv_layout,
            sampler,
            pipeline,
            rings: HashMap::new(),
            layer_textures: HashMap::new(),
            rgba_layers: RgbaLayerTextureCache::new(),
            transparent_mask_placeholder,
            mask_registration_history: HashSet::new(),
            text_cache,
            text_pipeline,
            matte_prefetchers: HashMap::new(),
            compositors: Vec::new(),
            capability_policy: None,
            capability_probe_us: None,
        }
    }

    pub fn mark_dxgi_failed(&mut self, reason: DxgiFailureReason) {
        self.dxgi_state = DxgiImportState::Failed { reason };
        log::warn!("[NativePreviewSession] DXGI zero-copy import marked Failed ({reason}) for this session");
    }

    pub fn mark_dxgi_disabled(&mut self, reason: DisableReason) {
        self.dxgi_state = DxgiImportState::Disabled { reason };
        log::info!(
            "[NativePreviewSession] DXGI zero-copy import administratively Disabled ({reason})"
        );
    }

    pub fn mark_dxgi_supported(&mut self) {
        self.dxgi_state = DxgiImportState::Supported;
    }

    /// Store the capability probe result. Called once by
    /// `configure_native_playback_render` after `probe_decode_capability`.
    pub fn set_capability_probe(
        &mut self,
        policy: crate::native_core::DecodeCapabilityPolicy,
        probe_us: Option<u64>,
    ) {
        self.capability_policy = Some(policy);
        self.capability_probe_us = probe_us;
    }

    /// Return the session's capability decision without consuming it. Native
    /// telemetry is sampled adaptively, so keeping this on every sample is the
    /// only reliable way to preserve the policy in durable session archives.
    pub fn capability_probe(
        &self,
    ) -> (
        Option<crate::native_core::DecodeCapabilityPolicy>,
        Option<u64>,
    ) {
        (self.capability_policy, self.capability_probe_us)
    }

    pub fn reset_dxgi_state(&mut self) {
        self.dxgi_state = DxgiImportState::Unknown;
    }

    /// Return the persistent compositor for a render target configuration.
    ///
    /// Pipeline creation is expensive on Metal and must not happen on the
    /// playback critical path. A session can use more than one output size
    /// (for example, the monitor and a diagnostic/readback target), so retain
    /// a small keyed set instead of rebuilding the graph for every request.
    pub fn get_or_create_compositor(
        &mut self,
        width: u32,
        height: u32,
        target_format: wgpu::TextureFormat,
    ) -> &MultiTrackCompositor {
        if let Some(index) = self.compositors.iter().position(|entry| {
            entry.width == width && entry.height == height && entry.target_format == target_format
        }) {
            return &self.compositors[index].compositor;
        }

        let mut span = crate::cold_start::SpanGuard::start("c0_compositor_pipelines_compile");
        span.set_purpose("preview");
        let compositor = MultiTrackCompositor::new_with_target_format(
            &self.gpu.device,
            &self.gpu.queue,
            width,
            height,
            target_format,
        );
        span.finish_ok();

        self.compositors.push(CachedCompositor {
            width,
            height,
            target_format,
            compositor,
        });

        // Keep the session bounded when a window is resized repeatedly or a
        // diagnostic target changes dimensions. The newest entry is the one
        // currently used by the caller; old GPU graphs can be released.
        const MAX_CACHED_COMPOSITORS: usize = 4;
        if self.compositors.len() > MAX_CACHED_COMPOSITORS {
            self.compositors.remove(0);
        }
        &self.compositors[self.compositors.len().saturating_sub(1)].compositor
    }

    pub fn has_compositor(
        &self,
        width: u32,
        height: u32,
        target_format: wgpu::TextureFormat,
    ) -> bool {
        self.compositors.iter().any(|entry| {
            entry.width == width && entry.height == height && entry.target_format == target_format
        })
    }

    /// Pre-compile and prime Metal/wgpu render pipelines for the project canvas
    /// dimensions and surface target format. Calling this during session opening
    /// or surface configuration completely eliminates the ~70ms first-frame
    /// compilation spike from the playback presentation path.
    ///
    /// On Windows, DXGI swapchains always negotiate to `Bgra8UnormSrgb` (the
    /// first preference in `choose_surface_format`). If this function is called
    /// before the surface has stored its negotiated format — which happens when
    /// `configure_native_playback_render`'s readiness gate runs before the
    /// swapchain is configured — the caller passes `Rgba8UnormSrgb` as a safe
    /// default. Frame 2 then finds no compositor for `Bgra8UnormSrgb` and is
    /// forced to compile all five D3D12 pipelines synchronously inside the
    /// presentation thread, producing the ~5s `coldStartInitUs` spike observed
    /// on Intel HD 520. Warming both formats here removes the race regardless
    /// of call order.
    pub fn warmup_gpu_pipelines(
        &mut self,
        width: u32,
        height: u32,
        target_format: wgpu::TextureFormat,
    ) {
        if width == 0 || height == 0 {
            return;
        }
        // Pre-compile the surface presentation compositor (5 pipelines: normal, additive, multiply, screen, transition)
        let _ = self.get_or_create_compositor(width, height, target_format);
        // Pre-compile the offscreen/readback compositor if distinct from the surface format.
        if target_format != wgpu::TextureFormat::Rgba8UnormSrgb {
            let _ =
                self.get_or_create_compositor(width, height, wgpu::TextureFormat::Rgba8UnormSrgb);
        }
        // On Windows, DXGI always prefers Bgra8UnormSrgb for the swapchain
        // surface. Pre-compiling it here ensures that a Bgra8UnormSrgb surface
        // presentation never pays a first-compile cost even when the readiness
        // gate ran before the swapchain was fully negotiated.
        #[cfg(target_os = "windows")]
        if target_format != wgpu::TextureFormat::Bgra8UnormSrgb {
            let _ =
                self.get_or_create_compositor(width, height, wgpu::TextureFormat::Bgra8UnormSrgb);
        }
    }

    /// Warm only the graph used by a native presentation surface. This keeps
    /// the first preview bounded on older Windows D3D12 drivers: the RGBA
    /// readback graph is not part of a native-surface frame and must not make
    /// startup wait for a second full set of blend pipelines.
    pub fn warmup_native_surface_pipelines(
        &mut self,
        width: u32,
        height: u32,
        target_format: wgpu::TextureFormat,
    ) {
        if width == 0 || height == 0 {
            return;
        }
        let _ = self.get_or_create_compositor(width, height, target_format);
    }

    /// Convert one decoded NV12 frame into a GPU texture for timeline compositing.
    /// The texture is owned by the caller and remains valid until the compositor
    /// has submitted the project frame that samples it.
    #[allow(clippy::too_many_arguments)]
    pub fn render_nv12_frame_to_texture(
        &mut self,
        layer_key: &str,
        source_width: u32,
        source_height: u32,
        output_width: u32,
        output_height: u32,
        y_plane: &[u8],
        uv_plane: &[u8],
        params: &ColorTransformUniforms,
    ) -> Result<Arc<wgpu::Texture>, String> {
        if source_width == 0 || source_height == 0 || output_width == 0 || output_height == 0 {
            return Err("Source and output dimensions must be non-zero".to_string());
        }

        let yuv_layout = &self.yuv_layout;
        let sampler = &self.sampler;
        let device = &self.gpu.device;

        let ring = self.rings.entry(layer_key.to_string()).or_insert_with(|| {
            YuvTextureRingBuffer::new(
                device,
                yuv_layout,
                sampler,
                sampler,
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

        let target_texture = if let Some(existing) = self.layer_textures.get(layer_key) {
            if existing.width() == source_width && existing.height() == source_height {
                Arc::clone(existing)
            } else {
                let new_tex = Arc::new(self.gpu.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Native Project Video Layer"),
                    size: wgpu::Extent3d {
                        width: source_width,
                        height: source_height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                }));
                self.layer_textures
                    .insert(layer_key.to_string(), Arc::clone(&new_tex));
                new_tex
            }
        } else {
            let new_tex = Arc::new(self.gpu.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Native Project Video Layer"),
                size: wgpu::Extent3d {
                    width: source_width,
                    height: source_height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            }));
            self.layer_textures
                .insert(layer_key.to_string(), Arc::clone(&new_tex));
            new_tex
        };

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

    /// Render an NV12 frame that was imported zero-copy from a D3D11VA shared
    /// DXGI texture — **no PCIe transfer, no `queue.write_texture` call**.
    ///
    /// The `imported` texture views are the NV12 biplanar views created by
    /// [`crate::wgpu_compositor::dxgi_import::import_into_wgpu`].  They are
    /// bound directly into the existing YUV→RGBA pipeline, which expects the
    /// same `(R8Unorm Y, Rg8Unorm UV)` layout that the CPU-upload path also
    /// produces.
    ///
    /// Windows-only; the CPU path remains the canonical path on all platforms.
    #[cfg(target_os = "windows")]
    pub fn render_nv12_from_imported_texture(
        &mut self,
        layer_key: &str,
        source_width: u32,
        source_height: u32,
        imported: &crate::wgpu_compositor::dxgi_import::ImportedNv12Texture,
        params: &ColorTransformUniforms,
    ) -> Result<Arc<wgpu::Texture>, super::render_path::PreviewRenderError> {
        if !self.gpu.capabilities.wgpu_nv12 {
            return Err(super::render_path::PreviewRenderError::UnsupportedFeature(
                "TEXTURE_FORMAT_NV12 is not supported on this adapter".to_string(),
            ));
        }
        if source_width == 0 || source_height == 0 {
            return Err(super::render_path::PreviewRenderError::DimensionMismatch {
                expected: (1, 1),
                got: (source_width, source_height),
            });
        }

        // Retrieve or create the output RGBA target texture.
        let target_texture = if let Some(existing) = self.layer_textures.get(layer_key) {
            if existing.width() == source_width && existing.height() == source_height {
                Arc::clone(existing)
            } else {
                let t = Arc::new(self.gpu.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Native Project Video Layer (DXGI)"),
                    size: wgpu::Extent3d {
                        width: source_width,
                        height: source_height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                }));
                self.layer_textures
                    .insert(layer_key.to_string(), Arc::clone(&t));
                t
            }
        } else {
            let t = Arc::new(self.gpu.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Native Project Video Layer (DXGI)"),
                size: wgpu::Extent3d {
                    width: source_width,
                    height: source_height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            }));
            self.layer_textures
                .insert(layer_key.to_string(), Arc::clone(&t));
            t
        };

        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Build a one-shot bind group using the imported biplanar views.
        // We do not use the ring buffer here — the texture lifetime is tied to
        // the AVFrame reference (managed by the decoder pool), so it must be
        // consumed entirely before this function returns and the frame is freed.
        let uniform_buffer = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("DXGI Color Params Uniform"),
            size: std::mem::size_of::<ColorTransformUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.gpu
            .queue
            .write_buffer(&uniform_buffer, 0, bytemuck::bytes_of(params));

        let bind_group = self
            .gpu
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("DXGI YUV BindGroup"),
                layout: &self.yuv_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&imported.y_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::TextureView(&imported.uv_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: uniform_buffer.as_entire_binding(),
                    },
                ],
            });

        // Encode a single-pass YUV→RGBA render using the existing pipeline.
        let mut encoder = self
            .gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("DXGI YUV→RGBA"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("DXGI YUV Render Pass"),
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
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..6, 0..1);
        }
        self.gpu.queue.submit(std::iter::once(encoder.finish()));

        Ok(target_texture)
    }

    /// Upload a small RGBA layer produced by a canonical browser-side
    /// renderer (currently Clypra Studio text effects).
    fn create_rgba_layer_texture(
        &self,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<Arc<wgpu::Texture>, String> {
        if width == 0 || height == 0 {
            return Err("RGBA layer dimensions must be non-zero".to_string());
        }
        let expected_bytes = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "RGBA layer dimensions overflow".to_string())?;
        if rgba.len() != expected_bytes {
            return Err(format!(
                "RGBA layer byte length mismatch: expected {}, got {}",
                expected_bytes,
                rgba.len()
            ));
        }

        let texture = Arc::new(self.gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Native RGBA Raster Layer"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        }));
        self.gpu.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width.saturating_mul(4)),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        Ok(texture)
    }

    /// Return a resident RGBA asset when possible, uploading it once on a
    /// cache miss. Empty asset ids intentionally bypass caching for legacy
    /// callers that do not provide stable identity.
    pub fn get_or_upload_rgba_layer_to_texture(
        &mut self,
        asset_id: &str,
        width: u32,
        height: u32,
        rgba: Option<&[u8]>,
    ) -> Result<Arc<wgpu::Texture>, String> {
        if !asset_id.trim().is_empty() {
            if let Some(texture) = self.rgba_layers.get(asset_id, width, height) {
                return Ok(texture);
            }
        }

        let rgba =
            rgba.ok_or_else(|| format!("Native RGBA raster asset is not registered: {asset_id}"))?;
        let texture = self.create_rgba_layer_texture(width, height, rgba)?;
        if !asset_id.trim().is_empty() {
            self.rgba_layers
                .insert(asset_id.to_string(), Arc::clone(&texture), width, height);
            self.mask_registration_history.insert(asset_id.to_string());
        }
        Ok(texture)
    }

    pub fn has_rgba_layer(&mut self, asset_id: &str, width: u32, height: u32) -> bool {
        if asset_id.trim().is_empty() {
            return false;
        }
        self.rgba_layers.get(asset_id, width, height).is_some()
    }

    fn create_transparent_mask_placeholder(gpu: &GpuContext) -> Arc<wgpu::Texture> {
        let texture = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("transparent-mask-placeholder"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        gpu.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &[0, 0, 0, 0],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        Arc::new(texture)
    }

    /// Checks residency WITHOUT triggering an upload attempt — this is the
    /// call that lets the render loop tell "evicted" apart from "never sent"
    /// before it ever calls get_or_upload_rgba_layer_to_texture.
    pub fn is_rgba_layer_resident(&self, asset_id: &str) -> bool {
        self.rgba_layers.contains_key(asset_id)
    }

    pub fn was_mask_ever_registered(&self, asset_id: &str) -> bool {
        self.mask_registration_history.contains(asset_id)
    }

    pub fn forget_mask_registration(&mut self, asset_id: &str) {
        self.mask_registration_history.remove(asset_id);
    }

    pub fn remove_rgba_layer(&mut self, asset_id: &str) {
        self.rgba_layers.remove(asset_id);
        self.mask_registration_history.remove(asset_id);
    }

    pub fn transparent_mask_placeholder(&self) -> Arc<wgpu::Texture> {
        Arc::clone(&self.transparent_mask_placeholder)
    }

    pub fn register_matte_prefetcher(
        &mut self,
        clip_id: String,
        prefetcher: Arc<crate::clymatte::MattePrefetcher>,
    ) {
        self.matte_prefetchers.insert(clip_id, prefetcher);
    }

    pub fn unregister_matte_prefetcher(&mut self, clip_id: &str) {
        self.matte_prefetchers.remove(clip_id);
    }

    pub fn get_matte_prefetcher(
        &self,
        clip_id: &str,
    ) -> Option<Arc<crate::clymatte::MattePrefetcher>> {
        self.matte_prefetchers.get(clip_id).cloned()
    }

    /// Retrieve a cached text layer GPU texture or render it via the SDF pipeline.
    /// Returns (texture, view, width, height).
    pub fn get_or_render_text_layer(
        &mut self,
        layer: &TextLayerSnapshot,
    ) -> Result<(Arc<wgpu::Texture>, Arc<wgpu::TextureView>, u32, u32), String> {
        if let Some(definition) = layer
            .effect
            .as_ref()
            .and_then(|effect| effect.definition.as_ref())
        {
            for pass in &definition.passes {
                let primitive = pass.primitive.to_ascii_lowercase();
                if !matches!(
                    primitive.as_str(),
                    "distance_threshold"
                        | "distance-threshold"
                        | "fill"
                        | "outline"
                        | "stroke"
                        | "glow"
                        | "drop_shadow"
                        | "drop-shadow"
                        | "shadow"
                ) {
                    return Err(format!(
                        "Native text effect primitive '{}' is not implemented by this renderer",
                        pass.primitive
                    ));
                }
            }
        }
        let params_json = serde_json::to_string(&layer.effect).unwrap_or_else(|_| "{}".to_string());
        let color_hash = u64::from_le_bytes([
            (layer.color[0] * 255.0) as u8,
            (layer.color[1] * 255.0) as u8,
            (layer.color[2] * 255.0) as u8,
            (layer.color[3] * 255.0) as u8,
            layer.text_align.as_bytes().first().copied().unwrap_or(0),
            (layer.letter_spacing * 10.0) as u8,
            (layer.line_height * 10.0) as u8,
            0,
        ]);
        let effect_id = layer
            .effect
            .as_ref()
            .map(|e| e.effect_id.as_str())
            .unwrap_or("raw_text");
        let effect_version = layer.effect.as_ref().map(|e| e.effect_version).unwrap_or(1);
        let bg_repr = layer
            .background
            .as_ref()
            .map(|b| format!("{:?}:{}:{}", b.color, b.padding, b.border_radius))
            .unwrap_or_default();
        let key = text_layer_cache_key(
            &layer.text,
            &layer.font_id,
            layer.font_size,
            effect_id,
            effect_version,
            &format!(
                "{params_json}:{color_hash}:{}:{}:{}:{bg_repr}:{:?}",
                layer.font_weight,
                layer.font_style,
                layer.vertical_align,
                layer.runs,
            ),
        );

        if let Some((tex, view)) = self.text_cache.get(key) {
            return Ok((Arc::clone(tex), Arc::clone(view), tex.width(), tex.height()));
        }

        // Cache miss: Shape text & generate SDF. If font is not registered,
        // log a diagnostic warning and gracefully substitute contextual fallback.
        let font_registry = clypra_native_core::font_registry::global_font_registry();
        let (font, font_hash) = match font_registry.require_font(&layer.font_id) {
            Ok(font) => font,
            Err(error) => {
                let (fallback_font, fallback_hash, _) =
                    font_registry.get_font_with_status(&layer.font_id);
                crate::diagnostics::warn(
                    "native-preview",
                    "text-font-missing",
                    format!(
                        "font_id={} reason={error}; substituted with contextual fallback",
                        layer.font_id
                    ),
                );
                (fallback_font, fallback_hash)
            }
        };
        let emoji_fallback = font_registry
            .require_font(clypra_native_core::font_registry::EMOJI_FALLBACK_FONT_ID)
            .ok();
        let align = clypra_native_core::glyph_cache::TextAlign::from_str_loose(&layer.text_align);
        let font_weight = match layer.font_weight.trim().to_ascii_lowercase().as_str() {
            "thin" => 100,
            "extralight" | "extra-light" => 200,
            "light" => 300,
            "medium" => 500,
            "semibold" | "semi-bold" => 600,
            "bold" => 700,
            "extrabold" | "extra-bold" => 800,
            "black" => 900,
            value => value.parse::<u16>().unwrap_or(400).clamp(100, 900),
        };
        let italic = layer.font_style.eq_ignore_ascii_case("italic");
        let shaped = clypra_native_core::glyph_cache::global_glyph_cache()
            .render_text_sdf_aligned_with_fallback_styled(
                &font,
                font_hash,
                emoji_fallback
                    .as_ref()
                    .map(|(font, hash)| (font.as_ref(), *hash)),
                &layer.text,
                layer.font_size,
                font_weight,
                italic,
                layer.letter_spacing,
                layer.line_height,
                align,
                8.0,
                4,
            );

        if shaped.width == 0 || shaped.height == 0 {
            // Empty text — 1x1 transparent dummy texture
            let texture = Arc::new(self.gpu.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Empty Text Layer"),
                size: wgpu::Extent3d {
                    width: 1,
                    height: 1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            }));
            let view = Arc::new(texture.create_view(&wgpu::TextureViewDescriptor::default()));
            return Ok((texture, view, 1, 1));
        }

        // Upload SDF buffer (R8Unorm)
        let sdf_texture = self.gpu.device.create_texture_with_data(
            &self.gpu.queue,
            &wgpu::TextureDescriptor {
                label: Some("Text Layer SDF Atlas"),
                size: wgpu::Extent3d {
                    width: shaped.width,
                    height: shaped.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            &shaped.sdf_buffer,
        );
        let sdf_view = sdf_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Create target RGBA8 texture
        let target_texture = Arc::new(self.gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Composited Text Layer"),
            size: wgpu::Extent3d {
                width: shaped.width,
                height: shaped.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        }));
        let target_view =
            Arc::new(target_texture.create_view(&wgpu::TextureViewDescriptor::default()));

        // The text effect passes use LoadOp::Load to accumulate shadow, glow,
        // outline, and fill. Explicitly initialize the first pass target so a
        // newly activated text layer cannot inherit undefined GPU contents.
        let mut clear_encoder =
            self.gpu
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Clear Text Layer Target"),
                });
        {
            let _clear_pass = clear_encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Clear Text Layer Target Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
        }
        self.gpu.queue.submit([clear_encoder.finish()]);

        if shaped.is_truncated {
            crate::diagnostics::warning(
                "native-preview",
                "text-canvas-truncated",
                format!(
                    "Text layer exceeded max canvas dimension and was truncated to ({}x{})",
                    shaped.width, shaped.height
                ),
            );
        }

        // Execute pass-chain based on layer.effect definition/overrides
        let mut commands = Vec::new();

        if layer.effect.is_some() || layer.stroke_color.is_some() || layer.shadow_color.is_some() {
            let effect = layer.effect.as_ref();
            let mut effect_id = effect
                .map(|effect| effect.effect_id.to_lowercase())
                .unwrap_or_else(|| "raw_text".to_string());
            let mut resolved_overrides = effect
                .map(|effect| effect.parameter_overrides.clone())
                .unwrap_or_default();
            if let Some(definition) = effect.and_then(|effect| effect.definition.as_ref()) {
                for pass in &definition.passes {
                    effect_id.push(' ');
                    effect_id.push_str(&pass.primitive.to_ascii_lowercase());
                    resolved_overrides.extend(pass.params.clone());
                }
            }
            let overrides = &resolved_overrides;

            // 1. Drop shadow pass (if applicable)
            if layer.shadow_color.is_some()
                || effect_id.contains("shadow")
                || effect_id.contains("3d")
                || effect_id.contains("glitch")
                || overrides.contains_key("shadow_color")
                || overrides.contains_key("shadowColor")
            {
                let mut shadow_params = DropShadowParams::default();
                if let Some(color) = layer.shadow_color {
                    shadow_params.color = color;
                }
                if let Some(blur) = layer.shadow_blur {
                    shadow_params.radius = blur.max(0.0) / 64.0;
                }
                if let Some(offset) = layer.shadow_offset {
                    shadow_params.offset_x = offset[0] / 256.0;
                    shadow_params.offset_y = offset[1] / 256.0;
                }
                if let Some(clypra_native_core::contracts::TextParamValue::Color(c)) = overrides
                    .get("shadow_color")
                    .or_else(|| overrides.get("shadowColor"))
                {
                    shadow_params.color = *c;
                }
                if let Some(clypra_native_core::contracts::TextParamValue::Float(r)) = overrides
                    .get("shadow_radius")
                    .or_else(|| overrides.get("shadowBlur"))
                    .or_else(|| overrides.get("radius"))
                {
                    shadow_params.radius = *r;
                }
                if let Some(clypra_native_core::contracts::TextParamValue::Vec2(off)) = overrides
                    .get("shadow_offset")
                    .or_else(|| overrides.get("offset"))
                {
                    shadow_params.offset_x = off[0];
                    shadow_params.offset_y = off[1];
                }
                commands.push(self.text_pipeline.render_drop_shadow(
                    &self.gpu.device,
                    &sdf_view,
                    &target_view,
                    &shadow_params,
                ));
            }

            // 2. Glow pass (if applicable)
            if effect_id.contains("glow")
                || effect_id.contains("neon")
                || overrides.contains_key("glow_color")
                || overrides.contains_key("glowColor")
            {
                let mut glow_params = GlowParams::default();
                if let Some(clypra_native_core::contracts::TextParamValue::Color(c)) = overrides
                    .get("glow_color")
                    .or_else(|| overrides.get("glowColor"))
                {
                    glow_params.color = *c;
                }
                if let Some(clypra_native_core::contracts::TextParamValue::Float(r)) = overrides
                    .get("glow_radius")
                    .or_else(|| overrides.get("glowRadius"))
                    .or_else(|| overrides.get("radius"))
                {
                    glow_params.radius = *r;
                }
                if let Some(clypra_native_core::contracts::TextParamValue::Float(i)) = overrides
                    .get("glow_intensity")
                    .or_else(|| overrides.get("intensity"))
                {
                    glow_params.intensity = *i;
                }
                commands.push(self.text_pipeline.render_glow(
                    &self.gpu.device,
                    &sdf_view,
                    &target_view,
                    &glow_params,
                ));
            }

            // 3. Outline pass (if applicable)
            if layer.stroke_color.is_some()
                || effect_id.contains("outline")
                || effect_id.contains("stroke")
                || overrides.contains_key("outline_color")
                || overrides.contains_key("outlineColor")
            {
                let mut outline_params = OutlineParams::default();
                if let Some(color) = layer.stroke_color {
                    outline_params.color = color;
                }
                if let Some(width) = layer.stroke_width {
                    outline_params.width = width / 64.0;
                }
                if let Some(clypra_native_core::contracts::TextParamValue::Color(c)) = overrides
                    .get("outline_color")
                    .or_else(|| overrides.get("outlineColor"))
                {
                    outline_params.color = *c;
                }
                if let Some(clypra_native_core::contracts::TextParamValue::Float(w)) = overrides
                    .get("outline_width")
                    .or_else(|| overrides.get("strokeWidth"))
                    .or_else(|| overrides.get("width"))
                {
                    outline_params.width = *w;
                }
                commands.push(self.text_pipeline.render_outline(
                    &self.gpu.device,
                    &sdf_view,
                    &target_view,
                    &outline_params,
                ));
            }
        }

        // Always execute core fill pass (DistanceThreshold)
        let fill_color = if let Some(effect) = &layer.effect {
            if let Some(clypra_native_core::contracts::TextParamValue::Color(c)) = effect
                .parameter_overrides
                .get("text_color")
                .or_else(|| effect.parameter_overrides.get("fillColor"))
                .or_else(|| effect.parameter_overrides.get("color"))
            {
                *c
            } else {
                layer.color
            }
        } else {
            layer.color
        };
        // A resolved karaoke run is part of the native snapshot. The current
        // SDF atlas is shaped as one paragraph, so a highlighted run uses the
        // run color for the paragraph while mixed-run shaping is promoted to
        // the next glyph-atlas revision. This keeps highlight state native and
        // deterministic instead of reintroducing a browser caption canvas.
        let fill_color = layer
            .runs
            .iter()
            .find(|run| run.highlighted)
            .and_then(|run| run.color)
            .unwrap_or(fill_color);

        let params = DistanceThresholdParams {
            threshold: 0.502,
            smoothing: 0.02,
            sdf_scale: 1.0,
            _pad: 0.0,
            color: fill_color,
        };
        commands.push(self.text_pipeline.render_distance_threshold(
            &self.gpu.device,
            &sdf_view,
            &target_view,
            &params,
        ));

        self.gpu.queue.submit(commands);

        self.text_cache.insert(
            key,
            Arc::clone(&target_texture),
            Arc::clone(&target_view),
            shaped.width,
            shaped.height,
        );

        Ok((target_texture, target_view, shaped.width, shaped.height))
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

        let yuv_layout = &self.yuv_layout;
        let sampler = &self.sampler;
        let device = &self.gpu.device;

        let ring = self
            .rings
            .entry("__single_frame__".to_string())
            .or_insert_with(|| {
                YuvTextureRingBuffer::new(
                    device,
                    yuv_layout,
                    sampler,
                    sampler,
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

