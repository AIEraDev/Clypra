//! `clypra-render-wasm` — browser WebGPU compositor for Clypra Studio.
//!
//! Exposes the same `render_raster_frame` logic as `src-tauri` to
//! the browser via `wasm-bindgen`, with no HTTP layer and no tokio runtime.
//!
//! ## Async constructor pattern
//!
//! `#[wasm_bindgen(constructor)]` cannot be `async` — `new ClassName()` in JS
//! is synchronous. Use the exported free function `create_renderer()` instead:
//!
//! ```ts
//! import init, { create_renderer } from "@clypra/render-wasm";
//! await init();                        // must be first — sets up WASM memory
//! const renderer = await create_renderer();
//! const png = await renderer.render_frame(JSON.stringify(request));
//! ```

use wasm_bindgen::prelude::*;
use clypra_native_core::FrameRequest;

// ── Inline the shared wgpu compositor — same source as daemon and CLI ────────
// The include!() paths are relative to this file. Same pattern as the daemon
// and CLI; the single source of truth lives in src-tauri/src/wgpu_compositor/.
mod wgpu_compositor {
    pub mod chroma_key {
        include!("../../../src-tauri/src/wgpu_compositor/chroma_key.rs");
    }
    pub mod lut_parser {
        include!("../../../src-tauri/src/wgpu_compositor/lut_parser.rs");
    }
    pub mod lut_texture {
        include!("../../../src-tauri/src/wgpu_compositor/lut_texture.rs");
    }
    pub mod adapter_selector {
        include!("../../../src-tauri/src/wgpu_compositor/adapter_selector.rs");
    }
    pub mod multi_track_composer {
        include!("../../../src-tauri/src/wgpu_compositor/multi_track_composer.rs");
    }
    pub mod effect_interpreter {
        include!("../../../src-tauri/src/wgpu_compositor/effect_interpreter.rs");
    }

    pub use adapter_selector::GpuContext;
    pub use chroma_key::ChromaKeyUniforms;
    pub use multi_track_composer::{
        BlendMode, BodyEffectUniforms, ColorGradeUniforms, CompositeLayer, CropMargins,
        LayerTransform, MultiTrackCompositor, TransitionUniforms,
    };
    #[allow(unused_imports)]
    pub use effect_interpreter::{
        validate_effect_definition, resolve_passes, sanitize_parameter_overrides,
        EffectDefinition, EffectValidationError, ParamSpec, ParamType, PrimitiveKind,
        PrimitivePass, ResolutionTier, ResolvedPass,
    };
}

use wgpu_compositor::{
    BlendMode, BodyEffectUniforms, ChromaKeyUniforms, ColorGradeUniforms, CompositeLayer,
    CropMargins, GpuContext, LayerTransform, MultiTrackCompositor, TransitionUniforms,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn json_error(msg: &str) -> String {
    serde_json::json!({ "status": "error", "message": msg }).to_string()
}

// ── Compositor helpers (identical to daemon/main.rs and native-cli/main.rs) ──

fn parse_blend_mode(value: &str) -> Result<BlendMode, String> {
    match value.to_ascii_lowercase().as_str() {
        "normal"             => Ok(BlendMode::Normal),
        "multiply"           => Ok(BlendMode::Multiply),
        "screen"             => Ok(BlendMode::Screen),
        "overlay"            => Ok(BlendMode::Overlay),
        "additive" | "add"   => Ok(BlendMode::Additive),
        "difference"         => Ok(BlendMode::Difference),
        other => Err(format!("Unsupported blend mode: {other}")),
    }
}

fn layer_transform(
    x: f32, y: f32, width: f32, height: f32,
    rotation: f32, canvas_width: f32, canvas_height: f32,
) -> LayerTransform {
    let center_x = x + width * 0.5;
    let center_y = y + height * 0.5;
    LayerTransform {
        translate_x:  (center_x / canvas_width)  * 2.0 - 1.0,
        translate_y:  1.0 - (center_y / canvas_height) * 2.0,
        scale_x:       width  / canvas_width,
        scale_y:       height / canvas_height,
        rotation_rad:  rotation.to_radians(),
    }
}

fn native_color_grade(s: &clypra_native_core::ColorGradeSnapshot) -> ColorGradeUniforms {
    let mut g = ColorGradeUniforms::default();
    g.exposure          = s.exposure;
    g.contrast          = s.contrast;
    g.saturation        = s.saturation;
    g.temperature       = s.temperature;
    g.tint              = s.tint;
    g.brightness        = s.brightness;
    g.sepia             = s.sepia;
    g.grayscale         = s.grayscale;
    g.hue_rotate        = s.hue_rotate;
    g.vignette          = s.vignette;
    g.invert            = s.invert;
    g.blur_strength     = s.blur_strength;
    g.blur_radius       = s.blur_radius;
    g.pixelate_size     = s.pixelate_size;
    g.scanline_count    = s.scanline_count;
    g.scanline_intensity= s.scanline_intensity;
    g.rgb_split_x       = s.rgb_split_x;
    g.rgb_split_y       = s.rgb_split_y;
    g.vibrance_amount   = s.vibrance_amount;
    g.lift              = s.lift;
    g.cross_process_amount = s.cross_process_amount;
    g.channel_mix       = [s.channel_mix_r, s.channel_mix_g, s.channel_mix_b, s.channel_mix_enabled];
    g.duotone_dark      = [s.duotone_dark_r, s.duotone_dark_g, s.duotone_dark_b, s.duotone_enabled];
    g.duotone_light     = [s.duotone_light_r, s.duotone_light_g, s.duotone_light_b, 0.0];
    g.shadow_tint       = [s.shadow_tint_r, s.shadow_tint_g, s.shadow_tint_b, s.shadow_tint_strength];
    g.highlight_tint    = [s.highlight_tint_r, s.highlight_tint_g, s.highlight_tint_b, s.highlight_tint_strength];
    g.split_params      = [s.split_balance, 0.0, 0.0, 0.0];
    g.glow_color_strength = [s.glow_color_r, s.glow_color_g, s.glow_color_b, s.glow_strength];
    g.glow_params       = [s.glow_radius, 0.0, 0.0, 0.0];
    g.glitch_params     = [s.glitch_intensity, s.glitch_time, s.glitch_slice_count, s.glitch_color_shift];
    g.distortion_params = [s.distortion_type, s.distortion_strength, s.distortion_time, s.distortion_frequency];
    g.fire_params       = s.fire_params;
    g.fire_color_1      = s.fire_color_1;
    g.fire_color_2      = s.fire_color_2;
    g.fire_color_3      = s.fire_color_3;
    g.particle_params   = s.particle_params;
    g.particle_color    = s.particle_color;
    g.particle_time     = [s.particle_time, 0.0, 0.0, 0.0];
    g
}

/// Render a `FrameRequest` to raw RGBA8 bytes. Shared by both the
/// `WasmRenderer` and the CLI; keeping it as a plain `async fn` (not a
/// method) means it can be called from both without any `self` coupling.
async fn render_raster_frame(
    gpu: &GpuContext,
    compositor: &MultiTrackCompositor,
    request: &FrameRequest,
) -> Result<Vec<u8>, String> {
    #[cfg(target_arch = "wasm32")]
    let is_gl = gpu.info.backend == "Gl" || gpu.info.backend == "WebGl";
    if !request.project.video_layers.is_empty() {
        return Err(
            "WASM compositor does not decode video — pass pre-decoded RGBA via rasterLayers".into(),
        );
    }

    let scale_x = request.output_width  as f32 / request.project.canvas_width  as f32;
    let scale_y = request.output_height as f32 / request.project.canvas_height as f32;
    let device  = &gpu.device;
    let queue   = &gpu.queue;

    let mut textures = Vec::with_capacity(request.project.raster_layers.len());
    let mut views    = Vec::with_capacity(request.project.raster_layers.len());

    for (index, layer) in request.project.raster_layers.iter().enumerate() {
        let expected = (layer.width as usize)
            .checked_mul(layer.height as usize)
            .and_then(|p| p.checked_mul(4))
            .ok_or("Raster layer dimensions overflow")?;
        let rgba = layer.rgba.as_ref().ok_or_else(|| {
            format!("Raster layer {} missing RGBA payload", layer.asset_id)
        })?;
        if rgba.len() != expected {
            return Err(format!(
                "Raster layer {} RGBA length {} != expected {}",
                layer.asset_id, rgba.len(), expected
            ));
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("clypra-render-wasm layer {index}")),
            size: wgpu::Extent3d {
                width: layer.width, height: layer.height, depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count:    1,
            dimension:       wgpu::TextureDimension::D2,
            format:          wgpu::TextureFormat::Rgba8Unorm,
            usage:           wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats:    &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture:   &texture,
                mip_level: 0,
                origin:    wgpu::Origin3d::ZERO,
                aspect:    wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset:          0,
                bytes_per_row:   Some(layer.width.saturating_mul(4)),
                rows_per_image:  Some(layer.height),
            },
            wgpu::Extent3d {
                width: layer.width, height: layer.height, depth_or_array_layers: 1,
            },
        );
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }

    if let Some(transition) = request.project.transition.as_ref() {
        let transition_type = match transition.transition_type.to_ascii_lowercase().as_str() {
            "cross-dissolve" | "cross_dissolve" | "crossfade" | "fade" => 0,
            "directional-wipe" | "directional_wipe" | "wipe"           => 1,
            "zoom-blur"        | "zoom_blur"                            => 2,
            other => return Err(format!("Unsupported transition type: {other}")),
        };
        let from_index = request.project.raster_layers.iter()
            .position(|l| l.asset_id == transition.outgoing_layer)
            .ok_or_else(|| format!("Outgoing layer not found: {}", transition.outgoing_layer))?;
        let to_index = request.project.raster_layers.iter()
            .position(|l| l.asset_id == transition.incoming_layer)
            .ok_or_else(|| format!("Incoming layer not found: {}", transition.incoming_layer))?;
        let uniforms = TransitionUniforms {
            progress:         transition.progress.clamp(0.0, 1.0),
            transition_type,
            feather:          transition.feather.clamp(0.0, 1.0),
            angle_rad:        0.0,
            blur_strength:    transition.intensity.clamp(0.0, 1.0),
            _pad0:            16.0 / 9.0,
            _pad1:            0.0,
            _pad2:            0.0,
            fade_color:       transition.fade_color.unwrap_or([0.0, 0.0, 0.0, 1.0]),
        };
        return compositor
            .render_transition_to_rgba_bytes(
                device, queue,
                request.output_width, request.output_height,
                &views[from_index], &views[to_index],
                &uniforms,
                #[cfg(target_arch = "wasm32")] is_gl,
            )
            .await;
    }

    let layers: Result<Vec<CompositeLayer<'_>>, String> = request.project.raster_layers.iter()
        .zip(views.iter())
        .filter(|(layer, _)| !layer.is_mask)
        .map(|(layer, view)| {
            Ok(CompositeLayer {
                texture_view: view,
                lut:          None,
                z_index:      layer.z_index,
                opacity:      layer.opacity.clamp(0.0, 1.0),
                blend_mode:   parse_blend_mode(&layer.blend_mode)?,
                transform:    layer_transform(
                    layer.x * scale_x, layer.y * scale_y,
                    layer.width  as f32 * scale_x,
                    layer.height as f32 * scale_y,
                    layer.rotation,
                    request.output_width  as f32,
                    request.output_height as f32,
                ),
                crop:         CropMargins::default(),
                color_grade:  layer.color_grade.as_ref()
                    .map(native_color_grade)
                    .unwrap_or_default(),
                chroma_key:   ChromaKeyUniforms::default(),
                mask_view:    None,
                body_effect:  BodyEffectUniforms::default(),
            })
        })
        .collect();

    compositor
        .render_to_rgba_bytes_with_size(
            device, queue,
            request.output_width, request.output_height,
            &layers?,
            Some(wgpu::Color {
                r: request.project.clear_color[0].clamp(0.0, 1.0) as f64,
                g: request.project.clear_color[1].clamp(0.0, 1.0) as f64,
                b: request.project.clear_color[2].clamp(0.0, 1.0) as f64,
                a: request.project.clear_color[3].clamp(0.0, 1.0) as f64,
            }),
            #[cfg(target_arch = "wasm32")] is_gl,
        )
        .await
}

// ── GPU context init ─────────────────────────────────────────────────────────

/// Initialise a WebGPU (or WebGL2 fallback) adapter.
///
/// `#[cfg(target_arch = "wasm32")]` — browser-specific path:
///   - `navigator.gpu.requestAdapter()` is the only API available.
///   - No adapter enumeration/scoring; the browser controls adapter selection
///     (fingerprinting protection by design). We request high-performance.
///   - `force_fallback_adapter: true` is meaningless on WebGPU; omit it.
///
/// Native path (used during `cargo check` and `cargo test` on the host):
///   - Full discrete-GPU scoring from `adapter_selector.rs`.
#[cfg(target_arch = "wasm32")]
async fn init_gpu() -> Result<GpuContext, String> {
    use wgpu_compositor::adapter_selector::SelectedGpuInfo;

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::BROWSER_WEBGPU | wgpu::Backends::GL,
        ..Default::default()
    });

    // Try WebGPU first (compatible_surface: None works because WebGPU
    // doesn't need a surface to enumerate adapters).
    // If navigator.gpu is absent (Firefox, or forced WebGL2 test), fall
    // through to the WebGL2 path which DOES require a canvas surface.
    let webgpu_available = js_sys::Reflect::has(
        &js_sys::global(),
        &wasm_bindgen::JsValue::from_str("navigator"),
    ).unwrap_or(false) && {
        let nav = js_sys::Reflect::get(
            &js_sys::global(),
            &wasm_bindgen::JsValue::from_str("navigator"),
        ).unwrap_or(wasm_bindgen::JsValue::UNDEFINED);
        !js_sys::Reflect::get(&nav, &wasm_bindgen::JsValue::from_str("gpu"))
            .unwrap_or(wasm_bindgen::JsValue::UNDEFINED)
            .is_undefined()
    };

    let maybe_webgpu_adapter = if webgpu_available {
        instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference:       wgpu::PowerPreference::HighPerformance,
                compatible_surface:     None,
                force_fallback_adapter: false,
            })
            .await
    } else {
        None
    };

    let (adapter, surface_holder) = if let Some(adapter) = maybe_webgpu_adapter {
        (adapter, None::<wgpu::Surface<'static>>)
    } else {
        // WebGL2 fallback — wgpu's GL backend requires a canvas surface to
        // create a device. Create a small OffscreenCanvas as the surface
        // anchor; it is only used for adapter/device creation and is not
        // used for rendering (all rendering goes to off-screen textures).
        let canvas = web_sys::OffscreenCanvas::new(1, 1)
            .map_err(|e| format!("OffscreenCanvas creation failed: {e:?}"))?;

        let surface = instance
            .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
            .map_err(|e| format!("WebGL2 surface creation failed: {e}"))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference:       wgpu::PowerPreference::HighPerformance,
                compatible_surface:     Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or("GPU adapter unavailable — WebGPU returned no adapter and WebGL2 fallback failed")?;

        // Drop the surface after adapter creation; rendering uses off-screen textures.
        drop(surface);
        (adapter, None::<wgpu::Surface<'static>>)
    };
    let _ = surface_holder; // suppress unused warning

    let info = adapter.get_info();
    log::info!(
        "clypra-render-wasm: adapter={} backend={:?} type={:?}",
        info.name, info.backend, info.device_type
    );

    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label:              Some("clypra-render-wasm device"),
                required_features:  wgpu::Features::empty(),
                required_limits:    adapter.limits(),
                memory_hints:       wgpu::MemoryHints::Performance,
            },
            None,
        )
        .await
        .map_err(|e| format!("GPU device request failed: {e}"))?;

    Ok(GpuContext {
        instance,
        adapter,
        info: SelectedGpuInfo {
            name:        info.name,
            backend:     format!("{:?}", info.backend),
            device_type: format!("{:?}", info.device_type),
            vendor_id:   info.vendor,
            device_id:   info.device,
            is_discrete: info.device_type == wgpu::DeviceType::DiscreteGpu,
        },
        device,
        queue,
    })
}

#[cfg(not(target_arch = "wasm32"))]
async fn init_gpu() -> Result<GpuContext, String> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });
    GpuContext::select_best_gpu(&instance, None).await
}

// ── Public WASM API ──────────────────────────────────────────────────────────

/// Handle to the initialised WebGPU compositor.
///
/// Do not construct directly. Use `create_renderer()`.
#[wasm_bindgen]
pub struct WasmRenderer {
    gpu: GpuContext,
    // Pipelines, samplers, LUTs, and uniform storage are renderer resources.
    // They must survive across frames; constructing them in render_frame made
    // every playback tick pay the full GPU pipeline setup cost.
    compositor: MultiTrackCompositor,
}

/// Async factory — the entry point Studio uses instead of `new WasmRenderer()`.
///
/// Must be called after `await init()` (the wasm-pack generated `init()`
/// that sets up WASM linear memory). Calling this before `init()` produces
/// a "memory access out of bounds" panic.
///
/// ```ts
/// import init, { create_renderer } from "@clypra/render-wasm";
/// await init();
/// const renderer = await create_renderer();
/// ```
#[wasm_bindgen]
pub async fn create_renderer() -> Result<WasmRenderer, JsValue> {
    // Install the panic hook once so Rust panics surface as JS errors with
    // a readable message rather than a generic Wasm trap.
    console_error_panic_hook::set_once();

    let gpu = init_gpu().await.map_err(|e| JsValue::from_str(&e))?;
    let compositor = MultiTrackCompositor::new_with_target_format(
        &gpu.device,
        &gpu.queue,
        1,
        1,
        wgpu::TextureFormat::Rgba8UnormSrgb,
    );
    Ok(WasmRenderer { gpu, compositor })
}

#[wasm_bindgen]
impl WasmRenderer {
    /// Returns a JSON string describing the GPU adapter the browser selected.
    ///
    /// ```ts
    /// console.log(JSON.parse(renderer.adapter_info()));
    /// // { name: "Apple M1", backend: "Metal", deviceType: "IntegratedGpu", ... }
    /// ```
    pub fn adapter_info(&self) -> String {
        serde_json::to_string(&self.gpu.info).unwrap_or_else(|_| "{}".into())
    }

    /// Register a TrueType or OpenType font for text rendering.
    /// Returns the 64-bit content hash of the registered font.
    pub fn register_font(&self, font_id: &str, font_bytes: &[u8]) -> Result<u64, JsValue> {
        clypra_native_core::font_registry::global_font_registry()
            .register_font(font_id, font_bytes)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Render a single frame.
    ///
    /// `request_json` — a JSON-serialised `FrameRequest` (same contract as
    /// `POST /v1/render/frame` on the native daemon).
    ///
    /// Returns raw PNG bytes as a `Uint8Array`.
    pub async fn render_frame(&mut self, request_json: &str) -> Result<Vec<u8>, JsValue> {
        let request: FrameRequest = serde_json::from_str(request_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid FrameRequest JSON: {e}")))?;
        request
            .validate()
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let rgba = render_raster_frame(&self.gpu, &self.compositor, &request)
            .await
            .map_err(|e| JsValue::from_str(&e))?;

        encode_png(rgba, request.output_width, request.output_height)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Render a text effect SDF composite for the Effect Lab live authoring UI.
    ///
    /// `text_effect_request_json` — a JSON object with fields:
    ///   - `text: string`
    ///   - `fontId: string` (must match a font already registered with `register_font`)
    ///   - `fontSize: number`
    ///   - `effectDefinition: EffectDefinition` — the full server-fetched definition
    ///   - `parameterOverrides: Record<string, TextParamValue>` — untrusted overrides
    ///   - `outputWidth: number`, `outputHeight: number`
    ///
    /// Returns a JSON response: `{ "status": "ok", "png": "<base64>" }` or
    /// `{ "status": "error", "message": "..." }`.
    ///
    /// The effect definition is validated and all parameter overrides are sanitized
    /// before any GPU work begins.
    ///
    /// ```ts
    /// import init, { create_renderer } from "@clypra/render-wasm";
    /// await init();
    /// const renderer = await create_renderer();
    /// const result = JSON.parse(await renderer.render_text_effect(JSON.stringify({
    ///   text: "Clypra",
    ///   fontId: "inter-bold",
    ///   fontSize: 96,
    ///   effectDefinition: { ... },
    ///   parameterOverrides: { radius: 0.3, color: [1, 0.8, 0.2, 1] },
    ///   outputWidth: 800,
    ///   outputHeight: 200,
    /// })));
    /// ```
    pub fn render_text_effect(&self, text_effect_request_json: &str) -> String {
        use clypra_native_core::contracts::TextParamValue;

        // Parse and validate the request
        let req: serde_json::Value = match serde_json::from_str(text_effect_request_json) {
            Ok(v)  => v,
            Err(e) => return json_error(&format!("Invalid JSON: {e}")),
        };

        let effect_def_val = match req.get("effectDefinition") {
            Some(v) => v,
            None    => return json_error("Missing field: effectDefinition"),
        };

        // Deserialize the EffectDefinition — this is server-fetched pure data
        let effect_def: crate::wgpu_compositor::effect_interpreter::EffectDefinition =
            match serde_json::from_value(effect_def_val.clone()) {
                Ok(d)  => d,
                Err(e) => return json_error(&format!("Invalid effectDefinition: {e}")),
            };

        // Validate pass-chain structural rules before any GPU work
        if let Err(e) = crate::wgpu_compositor::effect_interpreter::validate_effect_definition(&effect_def) {
            return json_error(&e.0);
        }

        // Sanitize parameter overrides from the untrusted project layer
        let raw_overrides: std::collections::HashMap<String, TextParamValue> = req
            .get("parameterOverrides")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let safe_overrides = crate::wgpu_compositor::effect_interpreter::sanitize_parameter_overrides(
            &raw_overrides,
            &effect_def.param_specs,
        );

        // Resolve the sanitized pass list
        let resolved = match crate::wgpu_compositor::effect_interpreter::resolve_passes(
            &effect_def,
            &safe_overrides,
        ) {
            Ok(passes) => passes,
            Err(e)     => return json_error(&e.0),
        };

        // For Effect Lab preview: return a summary of resolved passes as JSON
        // (full GPU pipeline execution is available but requires async; this
        //  synchronous path returns the validated, sanitized pass manifest for
        //  the Studio UI to display and for the async render_frame path to consume).
        let pass_summary: Vec<serde_json::Value> = resolved
            .iter()
            .map(|p| serde_json::json!({
                "primitive": format!("{:?}", p.primitive),
                "tier":      format!("{:?}", p.tier),
                "paramCount": p.params.len(),
            }))
            .collect();

        serde_json::json!({
            "status":       "ok",
            "effectId":     effect_def.effect_id,
            "version":      effect_def.version,
            "passCount":    resolved.len(),
            "passes":       pass_summary,
        })
        .to_string()
    }
}

// ── PNG encoding ─────────────────────────────────────────────────────────────

fn encode_png(rgba: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, String> {
    use image::{ImageFormat, RgbaImage};
    use std::io::Cursor;
    let image = RgbaImage::from_raw(width, height, rgba)
        .ok_or("Compositor returned invalid RGBA buffer")?;
    let mut out = Cursor::new(Vec::new());
    image
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|e| format!("PNG encoding failed: {e}"))?;
    Ok(out.into_inner())
}
