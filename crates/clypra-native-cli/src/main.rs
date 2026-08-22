use clypra_native_core::{compare_rgba8, compatibility::native_feature_manifest, FrameRequest};
use image::{ImageFormat, RgbaImage};
use std::{env, fs, io::Cursor, process::ExitCode};

// ── Inline the shared wgpu compositor — same source as the daemon, no copy ──
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

    pub use adapter_selector::GpuContext;
    pub use chroma_key::ChromaKeyUniforms;
    pub use multi_track_composer::{
        BlendMode, BodyEffectUniforms, ColorGradeUniforms, CompositeLayer, CropMargins,
        LayerTransform, MultiTrackCompositor, TransitionUniforms,
    };
}

use wgpu_compositor::{
    BlendMode, BodyEffectUniforms, ChromaKeyUniforms, ColorGradeUniforms, CompositeLayer,
    CropMargins, GpuContext, LayerTransform, MultiTrackCompositor, TransitionUniforms,
};

fn usage() {
    eprintln!(
        "Usage:
  clypra-native-cli validate <request.json>
  clypra-native-cli cache-key <request.json>
  clypra-native-cli render <request.json> <output.png>
  clypra-native-cli diff <actual.png> <expected.png> [tolerance]
  clypra-native-cli manifest"
    );
}

fn load_request(path: &str) -> Result<FrameRequest, String> {
    let contents =
        fs::read_to_string(path).map_err(|error| format!("Unable to read {path}: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse native frame request {path}: {error}"))
}

// ── GPU compositor helpers (identical to daemon/src/main.rs) ────────────────

fn parse_blend_mode(value: &str) -> Result<BlendMode, String> {
    match value.to_ascii_lowercase().as_str() {
        "normal" => Ok(BlendMode::Normal),
        "multiply" => Ok(BlendMode::Multiply),
        "screen" => Ok(BlendMode::Screen),
        "overlay" => Ok(BlendMode::Overlay),
        "additive" | "add" => Ok(BlendMode::Additive),
        "difference" => Ok(BlendMode::Difference),
        other => Err(format!("Unsupported native blend mode: {other}")),
    }
}

fn layer_transform(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    rotation: f32,
    canvas_width: f32,
    canvas_height: f32,
) -> LayerTransform {
    let center_x = x + width * 0.5;
    let center_y = y + height * 0.5;
    LayerTransform {
        translate_x: (center_x / canvas_width) * 2.0 - 1.0,
        translate_y: 1.0 - (center_y / canvas_height) * 2.0,
        scale_x: width / canvas_width,
        scale_y: height / canvas_height,
        rotation_rad: rotation.to_radians(),
    }
}

fn native_color_grade(snapshot: &clypra_native_core::ColorGradeSnapshot) -> ColorGradeUniforms {
    let mut grade = ColorGradeUniforms::default();
    grade.exposure = snapshot.exposure;
    grade.contrast = snapshot.contrast;
    grade.saturation = snapshot.saturation;
    grade.temperature = snapshot.temperature;
    grade.tint = snapshot.tint;
    grade.brightness = snapshot.brightness;
    grade.sepia = snapshot.sepia;
    grade.grayscale = snapshot.grayscale;
    grade.hue_rotate = snapshot.hue_rotate;
    grade.vignette = snapshot.vignette;
    grade.invert = snapshot.invert;
    grade.blur_strength = snapshot.blur_strength;
    grade.blur_radius = snapshot.blur_radius;
    grade.pixelate_size = snapshot.pixelate_size;
    grade.scanline_count = snapshot.scanline_count;
    grade.scanline_intensity = snapshot.scanline_intensity;
    grade.rgb_split_x = snapshot.rgb_split_x;
    grade.rgb_split_y = snapshot.rgb_split_y;
    grade.vibrance_amount = snapshot.vibrance_amount;
    grade.lift = snapshot.lift;
    grade.cross_process_amount = snapshot.cross_process_amount;
    grade.channel_mix = [
        snapshot.channel_mix_r,
        snapshot.channel_mix_g,
        snapshot.channel_mix_b,
        snapshot.channel_mix_enabled,
    ];
    grade.duotone_dark = [
        snapshot.duotone_dark_r,
        snapshot.duotone_dark_g,
        snapshot.duotone_dark_b,
        snapshot.duotone_enabled,
    ];
    grade.duotone_light = [
        snapshot.duotone_light_r,
        snapshot.duotone_light_g,
        snapshot.duotone_light_b,
        0.0,
    ];
    grade.shadow_tint = [
        snapshot.shadow_tint_r,
        snapshot.shadow_tint_g,
        snapshot.shadow_tint_b,
        snapshot.shadow_tint_strength,
    ];
    grade.highlight_tint = [
        snapshot.highlight_tint_r,
        snapshot.highlight_tint_g,
        snapshot.highlight_tint_b,
        snapshot.highlight_tint_strength,
    ];
    grade.split_params = [snapshot.split_balance, 0.0, 0.0, 0.0];
    grade.glow_color_strength = [
        snapshot.glow_color_r,
        snapshot.glow_color_g,
        snapshot.glow_color_b,
        snapshot.glow_strength,
    ];
    grade.glow_params = [snapshot.glow_radius, 0.0, 0.0, 0.0];
    grade.glitch_params = [
        snapshot.glitch_intensity,
        snapshot.glitch_time,
        snapshot.glitch_slice_count,
        snapshot.glitch_color_shift,
    ];
    grade.distortion_params = [
        snapshot.distortion_type,
        snapshot.distortion_strength,
        snapshot.distortion_time,
        snapshot.distortion_frequency,
    ];
    grade.fire_params = snapshot.fire_params;
    grade.fire_color_1 = snapshot.fire_color_1;
    grade.fire_color_2 = snapshot.fire_color_2;
    grade.fire_color_3 = snapshot.fire_color_3;
    grade.particle_params = snapshot.particle_params;
    grade.particle_color = snapshot.particle_color;
    grade.particle_time = [snapshot.particle_time, 0.0, 0.0, 0.0];
    grade
}

/// The canonical raster frame renderer. Called directly here (no HTTP wrapper)
/// and also by the daemon's `render_route` via the same `include!()` source.
/// Both targets must call this function — not separate implementations — so
/// that `clypra-native-cli render` produces pixel-identical output to the
/// daemon's `POST /v1/render/frame` endpoint.
async fn render_raster_frame(gpu: &GpuContext, request: &FrameRequest) -> Result<Vec<u8>, String> {
    if !request.project.video_layers.is_empty() {
        return Err(
            "Native raster renderer does not decode video layers — pass pre-decoded RGBA via rasterLayers".to_string(),
        );
    }

    let scale_x = request.output_width as f32 / request.project.canvas_width as f32;
    let scale_y = request.output_height as f32 / request.project.canvas_height as f32;
    let device = &gpu.device;
    let queue = &gpu.queue;

    let mut textures = Vec::with_capacity(request.project.raster_layers.len());
    let mut views = Vec::with_capacity(request.project.raster_layers.len());

    for (index, layer) in request.project.raster_layers.iter().enumerate() {
        let expected_bytes = (layer.width as usize)
            .checked_mul(layer.height as usize)
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or("Raster layer dimensions overflow")?;
        let rgba = layer.rgba.as_ref().ok_or_else(|| {
            format!("Raster layer {} is missing its RGBA payload", layer.asset_id)
        })?;
        if rgba.len() != expected_bytes {
            return Err(format!(
                "Raster layer {} RGBA payload length {} != expected {}",
                layer.asset_id,
                rgba.len(),
                expected_bytes
            ));
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("clypra-native-cli raster layer {index}")),
            size: wgpu::Extent3d {
                width: layer.width,
                height: layer.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(layer.width.saturating_mul(4)),
                rows_per_image: Some(layer.height),
            },
            wgpu::Extent3d {
                width: layer.width,
                height: layer.height,
                depth_or_array_layers: 1,
            },
        );
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }

    let compositor = MultiTrackCompositor::new_with_target_format(
        device,
        queue,
        request.output_width,
        request.output_height,
        wgpu::TextureFormat::Rgba8UnormSrgb,
    );

    if let Some(transition) = request.project.transition.as_ref() {
        let transition_type = match transition.transition_type.to_ascii_lowercase().as_str() {
            "cross-dissolve" | "cross_dissolve" | "crossfade" | "fade" => 0,
            "directional-wipe" | "directional_wipe" | "wipe" => 1,
            "zoom-blur" | "zoom_blur" => 2,
            other => return Err(format!("Unsupported native transition type: {other}")),
        };
        let from_index = request
            .project
            .raster_layers
            .iter()
            .position(|l| l.asset_id == transition.outgoing_layer)
            .ok_or_else(|| {
                format!(
                    "Transition outgoing layer not found: {}",
                    transition.outgoing_layer
                )
            })?;
        let to_index = request
            .project
            .raster_layers
            .iter()
            .position(|l| l.asset_id == transition.incoming_layer)
            .ok_or_else(|| {
                format!(
                    "Transition incoming layer not found: {}",
                    transition.incoming_layer
                )
            })?;
        let fade_color = transition.fade_color.unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let uniforms = TransitionUniforms {
            progress: transition.progress.clamp(0.0, 1.0),
            transition_type,
            feather: transition.feather.clamp(0.0, 1.0),
            angle_rad: 0.0,
            blur_strength: transition.intensity.clamp(0.0, 1.0),
            _pad0: 16.0 / 9.0,
            _pad1: 0.0,
            _pad2: 0.0,
            fade_color,
        };
        return compositor
            .render_transition_to_rgba_bytes(
                device,
                queue,
                request.output_width,
                request.output_height,
                &views[from_index],
                &views[to_index],
                &uniforms,
            )
            .await;
    }

    let layers: Result<Vec<CompositeLayer<'_>>, String> = request
        .project
        .raster_layers
        .iter()
        .zip(views.iter())
        .filter(|(layer, _)| !layer.is_mask)
        .map(|(layer, view)| {
            Ok(CompositeLayer {
                texture_view: view,
                lut: None,
                z_index: layer.z_index,
                opacity: layer.opacity.clamp(0.0, 1.0),
                blend_mode: parse_blend_mode(&layer.blend_mode)?,
                transform: layer_transform(
                    layer.x * scale_x,
                    layer.y * scale_y,
                    layer.width as f32 * scale_x,
                    layer.height as f32 * scale_y,
                    layer.rotation,
                    request.output_width as f32,
                    request.output_height as f32,
                ),
                crop: CropMargins::default(),
                color_grade: layer
                    .color_grade
                    .as_ref()
                    .map(native_color_grade)
                    .unwrap_or_default(),
                chroma_key: ChromaKeyUniforms::default(),
                mask_view: None,
                body_effect: BodyEffectUniforms::default(),
            })
        })
        .collect();
    let layers = layers?;

    compositor
        .render_to_rgba_bytes_with_size(
            device,
            queue,
            request.output_width,
            request.output_height,
            &layers,
            Some(wgpu::Color {
                r: request.project.clear_color[0].clamp(0.0, 1.0) as f64,
                g: request.project.clear_color[1].clamp(0.0, 1.0) as f64,
                b: request.project.clear_color[2].clamp(0.0, 1.0) as f64,
                a: request.project.clear_color[3].clamp(0.0, 1.0) as f64,
            }),
        )
        .await
}

fn encode_png(rgba: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let image = RgbaImage::from_raw(width, height, rgba)
        .ok_or("Native renderer returned an invalid RGBA buffer")?;
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| format!("PNG encoding failed: {error}"))?;
    Ok(output.into_inner())
}

// ── render subcommand ────────────────────────────────────────────────────────

fn run_render(args: &[String]) -> Result<(), String> {
    let request_path = args
        .get(2)
        .ok_or_else(|| "render requires a request JSON path".to_string())?;
    let output_path = args
        .get(3)
        .ok_or_else(|| "render requires an output PNG path".to_string())?;

    let request = load_request(request_path)?;
    request.validate().map_err(|e| e.to_string())?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("Failed to build tokio runtime: {e}"))?;

    let gpu = runtime.block_on(async {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            flags: wgpu::InstanceFlags::all(),
            ..Default::default()
        });
        GpuContext::select_best_gpu(&instance, None).await
    })?;

    eprintln!(
        "GPU: {} ({}, {})",
        gpu.info.name, gpu.info.backend, gpu.info.device_type
    );

    let rgba = runtime
        .block_on(render_raster_frame(&gpu, &request))
        .map_err(|e| format!("Render failed: {e}"))?;

    let png = encode_png(rgba, request.output_width, request.output_height)?;

    fs::write(output_path, &png)
        .map_err(|e| format!("Failed to write {output_path}: {e}"))?;

    eprintln!(
        "Rendered {}x{} → {}  ({} bytes)",
        request.output_width,
        request.output_height,
        output_path,
        png.len()
    );
    Ok(())
}

// ── diff subcommand ──────────────────────────────────────────────────────────

fn run_diff(args: &[String]) -> Result<(), String> {
    let actual_path = args
        .get(2)
        .ok_or_else(|| "diff requires an actual PNG path".to_string())?;
    let expected_path = args
        .get(3)
        .ok_or_else(|| "diff requires an expected PNG path".to_string())?;
    let tolerance = args
        .get(4)
        .map(|v| {
            v.parse::<u8>()
                .map_err(|_| format!("invalid channel tolerance: {v}"))
        })
        .transpose()?
        .unwrap_or(0);

    let actual = image::open(actual_path)
        .map_err(|e| format!("Unable to read actual PNG {actual_path}: {e}"))?
        .to_rgba8();
    let expected = image::open(expected_path)
        .map_err(|e| format!("Unable to read expected PNG {expected_path}: {e}"))?
        .to_rgba8();

    if actual.dimensions() != expected.dimensions() {
        return Err(format!(
            "PNG dimensions differ: actual {:?}, expected {:?}",
            actual.dimensions(),
            expected.dimensions()
        ));
    }

    let (width, height) = actual.dimensions();
    let diff = compare_rgba8(&actual, &expected, width, height)?;

    // Always print the full metrics — callers can parse this JSON even when
    // the comparison passes, giving CI the data it needs for tolerance tuning.
    println!(
        "{}",
        serde_json::to_string_pretty(&diff).map_err(|e| e.to_string())?
    );

    if diff.is_within_tolerance(tolerance) {
        Ok(())
    } else {
        Err(format!(
            "golden mismatch: max_channel_error={} exceeds tolerance={}  differing_pixels={}/{}  mean_error={:.4}",
            diff.max_channel_error,
            tolerance,
            diff.differing_pixels,
            diff.total_pixels,
            diff.mean_channel_error,
        ))
    }
}

// ── entry point ──────────────────────────────────────────────────────────────

fn run(args: &[String]) -> Result<(), String> {
    let command = args
        .get(1)
        .map(String::as_str)
        .ok_or_else(|| {
            usage();
            "Missing command".to_string()
        })?;

    match command {
        "validate" => {
            let path = args.get(2).ok_or_else(|| {
                usage();
                "validate requires a request JSON path".to_string()
            })?;
            let request = load_request(path)?;
            request.validate().map_err(|e| e.to_string())?;
            println!(
                "valid contractVersion={} requestId={} frame={} output={}x{}",
                request.contract_version,
                request.request_id,
                request.frame_time.frame_index,
                request.output_width,
                request.output_height,
            );
            Ok(())
        }
        "cache-key" => {
            let path = args.get(2).ok_or_else(|| {
                usage();
                "cache-key requires a request JSON path".to_string()
            })?;
            let request = load_request(path)?;
            println!("{}", request.cache_key().map_err(|e| e.to_string())?);
            Ok(())
        }
        "render" => run_render(args),
        "diff" => run_diff(args),
        "manifest" => {
            println!("featureId\tcategory\tstatus");
            for feature in native_feature_manifest() {
                println!(
                    "{}\t{}\t{:?}",
                    feature.feature_id, feature.category, feature.status
                );
            }
            Ok(())
        }
        "help" | "--help" | "-h" => {
            usage();
            Ok(())
        }
        _ => {
            usage();
            Err(format!("Unknown command: {command}"))
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("clypra-native-cli: {error}");
            ExitCode::from(2)
        }
    }
}
