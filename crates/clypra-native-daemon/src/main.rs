use clypra_native_core::{compatibility::native_feature_manifest, FrameRequest};
use image::{ImageFormat, RgbaImage};
use serde_json::{json, Value};
use std::{
    env,
    io::Cursor,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::ExitCode,
};

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

const DEFAULT_BIND: &str = "127.0.0.1:8788";
// Raster lab frames are intentionally sent as JSON RGBA during this adapter
// phase. Keep the limit high enough for a 1280x720 frame while retaining a
// bounded request size for the local HTTP surface.
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

enum RouteResponse {
    Json {
        status: String,
        body: Value,
    },
    Png {
        request_id: String,
        frame_index: u64,
        bytes: Vec<u8>,
    },
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn usage() {
    eprintln!(
        "Usage:\n  clypra-native-daemon [--bind 127.0.0.1:8788]\n\n\
        The daemon exposes native contract validation to Studio. Frame rendering\n\
        remains disabled until the shared GPU compositor is attached."
    );
}

fn parse_bind(args: &[String]) -> Result<String, String> {
    let mut bind = DEFAULT_BIND.to_string();
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--bind" => {
                index += 1;
                bind = args
                    .get(index)
                    .ok_or_else(|| "--bind requires an address".to_string())?
                    .clone();
            }
            "help" | "--help" | "-h" => {
                usage();
                return Err(String::new());
            }
            argument => return Err(format!("unknown argument: {argument}")),
        }
        index += 1;
    }
    Ok(bind)
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 4096];
    let header_end;
    loop {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("failed to read request: {error}"))?;
        if read == 0 {
            return Err("client closed the request before headers completed".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_BODY_BYTES {
            return Err("request exceeds the native daemon body limit".to_string());
        }
        if let Some(end) = find_header_end(&buffer) {
            header_end = end;
            break;
        }
    }

    let header_text = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| "request headers are not valid UTF-8".to_string())?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "request line is missing".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "request method is missing".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "request path is missing".to_string())?
        .to_string();

    let mut content_length = 0_usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value
                    .trim()
                    .parse()
                    .map_err(|_| "content-length is invalid".to_string())?;
            }
        }
    }
    if content_length > MAX_BODY_BYTES {
        return Err("request exceeds the native daemon body limit".to_string());
    }

    let body_start = header_end + 4;
    while buffer.len() - body_start < content_length {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("failed to read request body: {error}"))?;
        if read == 0 {
            return Err("client closed the request before its body completed".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    Ok(HttpRequest {
        method,
        path,
        body: buffer[body_start..body_start + content_length].to_vec(),
    })
}

fn json_response(status: &str, value: Value) -> Vec<u8> {
    let body =
        serde_json::to_vec(&value).unwrap_or_else(|_| b"{\"error\":\"encoding failure\"}".to_vec());
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type, X-Clypra-Native-Protocol\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes()
    .into_iter()
    .chain(body)
    .collect()
}

fn handshake(gpu: Option<&GpuContext>, gpu_error: Option<&str>) -> Value {
    let native_count = native_feature_manifest()
        .iter()
        .filter(|entry| format!("{:?}", entry.status) == "Native")
        .count();
    let gpu_info = gpu
        .map(|gpu| {
            json!({
                "state": "ready",
                "available": true,
                "adapterName": gpu.info.name,
                "backend": gpu.info.backend,
                "failureReason": null
            })
        })
        .unwrap_or_else(|| {
            json!({
                "state": "failed",
                "available": false,
                "adapterName": null,
                "backend": null,
                "failureReason": gpu_error.unwrap_or("Native GPU initialization failed")
            })
        });
    json!({
        "protocolVersion": 1,
        "contractVersion": 1,
        "coreVersion": "0.1.0",
        "renderGraphVersion": 1,
        "colorPolicyVersion": 1,
        "nativeFeatureCount": native_count,
        "gpu": gpu_info
    })
}

fn validate(body: &[u8]) -> (String, Value) {
    let request: FrameRequest = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(error) => {
            return (
                "400 Bad Request".to_string(),
                json!({ "valid": false, "error": error.to_string() }),
            )
        }
    };
    if let Err(error) = request.validate() {
        return (
            "422 Unprocessable Entity".to_string(),
            json!({ "valid": false, "error": error.to_string() }),
        );
    }
    let cache_key = match request.cache_key() {
        Ok(key) => key,
        Err(error) => {
            return (
                "422 Unprocessable Entity".to_string(),
                json!({ "valid": false, "error": error.to_string() }),
            )
        }
    };
    (
        "200 OK".to_string(),
        json!({ "valid": true, "cacheKey": cache_key }),
    )
}

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
        rotation_rad: -rotation.to_radians(),
    }
}

async fn render_raster_frame(gpu: &GpuContext, request: &FrameRequest) -> Result<Vec<u8>, String> {
    if !request.project.video_layers.is_empty() {
        return Err("Native daemon raster renderer does not decode video layers yet".to_string());
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
            .ok_or_else(|| "Raster layer dimensions overflow".to_string())?;
        let rgba = layer.rgba.as_ref().ok_or_else(|| {
            format!(
                "Raster layer {} is missing its RGBA payload",
                layer.asset_id
            )
        })?;
        if rgba.len() != expected_bytes {
            return Err(format!(
                "Raster layer {} has an invalid RGBA payload",
                layer.asset_id
            ));
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("Native Daemon Raster Layer {index}")),
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
            .position(|layer| layer.asset_id == transition.outgoing_layer)
            .ok_or_else(|| format!("Transition outgoing layer is missing: {}", transition.outgoing_layer))?;
        let to_index = request
            .project
            .raster_layers
            .iter()
            .position(|layer| layer.asset_id == transition.incoming_layer)
            .ok_or_else(|| format!("Transition incoming layer is missing: {}", transition.incoming_layer))?;
        let fade_color = transition.fade_color.unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let uniforms = TransitionUniforms {
            progress: transition.progress.clamp(0.0, 1.0),
            transition_type,
            feather: transition.feather.clamp(0.0, 1.0),
            angle_rad: 0.0,
            blur_strength: transition.intensity.clamp(0.0, 1.0),
            _pad0: 0.0,
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
    let rgba = compositor
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
        .await?;
    drop(views);
    drop(textures);
    Ok(rgba)
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

fn encode_png(rgba: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let image = RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "Native renderer returned an invalid RGBA buffer".to_string())?;
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| format!("Unable to encode native PNG response: {error}"))?;
    Ok(output.into_inner())
}

fn render_route(
    request: HttpRequest,
    gpu: Option<&GpuContext>,
    runtime: &tokio::runtime::Runtime,
) -> RouteResponse {
    let request: FrameRequest = match serde_json::from_slice(&request.body) {
        Ok(request) => request,
        Err(error) => {
            return RouteResponse::Json {
                status: "400 Bad Request".to_string(),
                body: json!({ "error": error.to_string() }),
            }
        }
    };
    if let Err(error) = request.validate() {
        return RouteResponse::Json {
            status: "422 Unprocessable Entity".to_string(),
            body: json!({ "error": error.to_string() }),
        };
    }
    let Some(gpu) = gpu else {
        return RouteResponse::Json {
            status: "503 Service Unavailable".to_string(),
            body: json!({ "error": "Native GPU compositor is unavailable", "code": "native_gpu_unavailable" }),
        };
    };
    match runtime.block_on(render_raster_frame(gpu, &request)) {
        Ok(rgba) => match encode_png(rgba, request.output_width, request.output_height) {
            Ok(bytes) => RouteResponse::Png {
                request_id: request.request_id,
                frame_index: request.frame_time.frame_index,
                bytes,
            },
            Err(error) => RouteResponse::Json {
                status: "500 Internal Server Error".to_string(),
                body: json!({ "error": error }),
            },
        },
        Err(error) => RouteResponse::Json {
            status: "422 Unprocessable Entity".to_string(),
            body: json!({ "error": error, "code": "native_render_rejected" }),
        },
    }
}

fn route(
    request: HttpRequest,
    gpu: Option<&GpuContext>,
    gpu_error: Option<&str>,
    runtime: &tokio::runtime::Runtime,
) -> RouteResponse {
    if request.method == "OPTIONS" {
        return RouteResponse::Json {
            status: "200 OK".to_string(),
            body: json!({}),
        };
    }
    if request.method == "GET" && request.path == "/health" {
        return RouteResponse::Json {
            status: "200 OK".to_string(),
            body: json!({ "ok": true, "service": "clypra-native-daemon", "gpuAvailable": gpu.is_some() }),
        };
    }
    if request.method == "GET" && request.path == "/v1/handshake" {
        return RouteResponse::Json {
            status: "200 OK".to_string(),
            body: handshake(gpu, gpu_error),
        };
    }
    if request.method == "POST" && request.path == "/v1/validate" {
        let (status, body) = validate(&request.body);
        return RouteResponse::Json { status, body };
    }
    if request.method == "POST" && request.path == "/v1/render/frame" {
        return render_route(request, gpu, runtime);
    }
    RouteResponse::Json {
        status: "404 Not Found".to_string(),
        body: json!({ "error": "route not found" }),
    }
}

fn png_response(request_id: &str, frame_index: u64, body: &[u8]) -> Vec<u8> {
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nX-Clypra-Request-Id: {}\r\nX-Clypra-Frame-Index: {}\r\nX-Clypra-Decode-Time-Us: 0\r\nX-Clypra-Compose-Time-Us: 0\r\nX-Clypra-Readback-Time-Us: 0\r\nX-Clypra-Total-Time-Us: 0\r\nX-Clypra-Cache-Hit: false\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len(), request_id, frame_index
    );
    header
        .into_bytes()
        .into_iter()
        .chain(body.iter().copied())
        .collect()
}

fn handle_connection(
    stream: &mut TcpStream,
    gpu: Option<&GpuContext>,
    gpu_error: Option<&str>,
    runtime: &tokio::runtime::Runtime,
) -> Result<(), String> {
    let request = parse_request(stream)?;
    let response = match route(request, gpu, gpu_error, runtime) {
        RouteResponse::Json { status, body } => json_response(&status, body),
        RouteResponse::Png {
            request_id,
            frame_index,
            bytes,
        } => png_response(&request_id, frame_index, &bytes),
    };
    stream
        .write_all(&response)
        .map_err(|error| format!("failed to write response: {error}"))
}

fn run(bind: &str) -> Result<(), String> {
    let listener =
        TcpListener::bind(bind).map_err(|error| format!("unable to bind {bind}: {error}"))?;
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|error| format!("unable to start async runtime: {error}"))?;
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });
    let gpu_result = runtime.block_on(GpuContext::select_best_gpu(&instance, None));
    let (gpu, gpu_error) = match gpu_result {
        Ok(gpu) => (Some(gpu), None),
        Err(error) => (None, Some(error)),
    };
    eprintln!("clypra-native-daemon listening on http://{bind}");
    if let Some(gpu) = gpu.as_ref() {
        eprintln!(
            "clypra-native-daemon GPU ready: {} ({})",
            gpu.info.name, gpu.info.backend
        );
    } else if let Some(error) = gpu_error.as_deref() {
        eprintln!("clypra-native-daemon GPU unavailable: {error}");
    }
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(error) =
                    handle_connection(&mut stream, gpu.as_ref(), gpu_error.as_deref(), &runtime)
                {
                    eprintln!("clypra-native-daemon request error: {error}");
                }
            }
            Err(error) => eprintln!("clypra-native-daemon connection error: {error}"),
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    match parse_bind(&args).and_then(|bind| run(&bind)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) if error.is_empty() => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("clypra-native-daemon: {error}");
            ExitCode::from(2)
        }
    }
}
