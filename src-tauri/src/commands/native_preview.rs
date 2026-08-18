use crate::thumbnail_engine::decoder::{get_decoder, VideoColorMetadata};
use crate::wgpu_compositor::{
    BlendMode, ChromaKeyUniforms, ColorGradeUniforms, ColorTransformUniforms, CompositeLayer,
    CropMargins, LayerTransform, MultiTrackCompositor, NativePreviewSession, NativeWgpuRenderer,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;

fn default_clear_color() -> [f32; 4] {
    [0.0, 0.0, 0.0, 1.0]
}

fn default_opacity() -> f32 {
    1.0
}

fn default_blend_mode() -> String {
    "normal".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProjectSolidLayer {
    pub color: [f32; 4],
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default = "default_blend_mode")]
    pub blend_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProjectVideoLayer {
    pub video_path: String,
    pub time_secs: f64,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default = "default_blend_mode")]
    pub blend_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVideoProjectFrameRequest {
    pub canvas_width: u32,
    pub canvas_height: u32,
    #[serde(default = "default_clear_color")]
    pub clear_color: [f32; 4],
    #[serde(default)]
    pub layers: Vec<NativeProjectVideoLayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProjectFrameRequest {
    pub canvas_width: u32,
    pub canvas_height: u32,
    #[serde(default = "default_clear_color")]
    pub clear_color: [f32; 4],
    #[serde(default)]
    pub layers: Vec<NativeProjectSolidLayer>,
}

fn parse_blend_mode(value: &str) -> Result<BlendMode, String> {
    match value.to_ascii_lowercase().as_str() {
        "normal" => Ok(BlendMode::Normal),
        "multiply" => Ok(BlendMode::Multiply),
        "screen" => Ok(BlendMode::Screen),
        "overlay" => Ok(BlendMode::Overlay),
        "additive" | "add" => Ok(BlendMode::Additive),
        "difference" => Ok(BlendMode::Difference),
        other => Err(format!("Unsupported native blend mode: {}", other)),
    }
}

fn validate_project_request(request: &NativeProjectFrameRequest) -> Result<(), String> {
    if request.canvas_width == 0 || request.canvas_height == 0 {
        return Err("Project canvas dimensions must be non-zero".to_string());
    }
    if request.canvas_width > 8192 || request.canvas_height > 8192 {
        return Err("Project canvas dimensions exceed the native preview limit".to_string());
    }
    if request.layers.len() > 256 {
        return Err("Native preview supports at most 256 layers per frame".to_string());
    }
    if request.clear_color.iter().any(|value| !value.is_finite()) {
        return Err("Native project clear color contains invalid color data".to_string());
    }
    for layer in &request.layers {
        if !layer.x.is_finite()
            || !layer.y.is_finite()
            || !layer.width.is_finite()
            || !layer.height.is_finite()
            || !layer.rotation.is_finite()
            || !layer.opacity.is_finite()
            || layer.width < 0.0
            || layer.height < 0.0
        {
            return Err("Native project layer contains invalid geometry".to_string());
        }
        if layer.color.iter().any(|value| !value.is_finite()) {
            return Err("Native project layer contains invalid color data".to_string());
        }
    }
    Ok(())
}

fn validate_video_project_request(
    request: &NativeVideoProjectFrameRequest,
) -> Result<(), String> {
    if request.canvas_width == 0 || request.canvas_height == 0 {
        return Err("Project canvas dimensions must be non-zero".to_string());
    }
    if request.canvas_width > 8192 || request.canvas_height > 8192 {
        return Err("Project canvas dimensions exceed the native preview limit".to_string());
    }
    if request.layers.len() > 256 {
        return Err("Native preview supports at most 256 layers per frame".to_string());
    }
    if request.clear_color.iter().any(|value| !value.is_finite()) {
        return Err("Native project clear color contains invalid color data".to_string());
    }
    for layer in &request.layers {
        if layer.video_path.trim().is_empty()
            || !layer.time_secs.is_finite()
            || layer.time_secs < 0.0
            || !layer.x.is_finite()
            || !layer.y.is_finite()
            || !layer.width.is_finite()
            || !layer.height.is_finite()
            || !layer.rotation.is_finite()
            || !layer.opacity.is_finite()
            || layer.width <= 0.0
            || layer.height <= 0.0
        {
            return Err("Native project video layer contains invalid data".to_string());
        }
        parse_blend_mode(&layer.blend_mode)?;
    }
    Ok(())
}

fn project_layer_transform(
    layer: &NativeProjectSolidLayer,
    canvas_width: f32,
    canvas_height: f32,
) -> LayerTransform {
    project_layer_transform_values(
        layer.x,
        layer.y,
        layer.width,
        layer.height,
        layer.rotation,
        canvas_width,
        canvas_height,
    )
}

fn project_layer_transform_values(
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

/// Convert stream metadata into the explicit shader contract.
///
/// Completely unspecified metadata is common in older SDR files, so it uses
/// the established SDR default: limited-range Rec.709. Partially specified
/// unsupported metadata is rejected rather than silently guessed.
fn color_params(color: &VideoColorMetadata) -> Result<ColorTransformUniforms, String> {
    let color_space = match (color.matrix.as_str(), color.transfer.as_str()) {
        ("bt709", "bt709" | "srgb" | "unspecified") => 0,
        ("bt601_625" | "bt601_525", "bt709" | "srgb" | "unspecified") => 3,
        ("bt2020_ncl", "pq") => 1,
        ("bt2020_ncl", "hlg") => 2,
        ("unspecified", "unspecified") => 0,
        (matrix, transfer) => {
            return Err(format!(
                "Unsupported preview color metadata: matrix={} transfer={}",
                matrix, transfer
            ));
        }
    };

    Ok(ColorTransformUniforms {
        color_space,
        range: if color.range == "full" { 1 } else { 0 },
        // The HDR shader uses ACES for PQ/HLG and ignores this field for SDR.
        tonemap_operator: if color_space == 0 || color_space == 3 { 0 } else { 1 },
        target_peak_nits: 100.0,
    })
}

/// Decode and GPU-convert one source frame.
///
/// This is the first native preview proof. It returns the decoded source
/// dimensions and tightly packed RGBA8 bytes. Timeline compositing and a
/// persistent GPU surface are intentionally separate follow-up phases.
#[tauri::command]
pub async fn render_native_preview_frame(
    app: tauri::AppHandle,
    video_path: String,
    time_secs: f64,
    output_width: Option<u32>,
    output_height: Option<u32>,
) -> Result<tauri::ipc::Response, String> {
    if !time_secs.is_finite() || time_secs < 0.0 {
        return Err("time_secs must be a finite non-negative number".to_string());
    }

    let decoder = get_decoder(&video_path).await?;
    let (y_plane, uv_plane, width, height, color) = {
        let mut guard = decoder.lock().await;
        let color = guard.metadata().color;
        let (y_plane, uv_plane, width, height) = guard.decode_frame_raw_nv12(time_secs)?;
        (y_plane, uv_plane, width, height, color)
    };

    let params = color_params(&color)?;
    let target_width = output_width.unwrap_or(width);
    let target_height = output_height.unwrap_or(height);
    let rgba = if let Some(state) = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
    {
        let mut session = state.lock().await;
        session
            .render_nv12_frame(
                width,
                height,
                target_width,
                target_height,
                &y_plane,
                &uv_plane,
                &params,
            )
            .await?
    } else {
        if target_width != width || target_height != height {
            return Err(
                "Native preview GPU session is unavailable for scaled output".to_string(),
            );
        }
        let renderer = NativeWgpuRenderer::new().await?;
        renderer
            .render_nv12_frame_with_color(width, height, &y_plane, &uv_plane, &params)
            .await?
    };

    Ok(tauri::ipc::Response::new(rgba))
}

/// Render a project-sized frame from deterministic solid layers.
///
/// This establishes the native timeline compositor contract independently of
/// media decoding. Video and image textures will use the same layer geometry
/// and ordering in the next migration step.
#[tauri::command]
pub async fn render_native_project_frame(
    app: tauri::AppHandle,
    request: NativeProjectFrameRequest,
) -> Result<tauri::ipc::Response, String> {
    validate_project_request(&request)?;

    let state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let session = state.lock().await;
    let device = &session.gpu.device;
    let queue = &session.gpu.queue;
    let compositor = MultiTrackCompositor::new(
        device,
        queue,
        request.canvas_width,
        request.canvas_height,
    );

    let mut textures = Vec::with_capacity(request.layers.len());
    let mut views = Vec::with_capacity(request.layers.len());
    for (index, layer) in request.layers.iter().enumerate() {
        let rgba = [
            (layer.color[0].clamp(0.0, 1.0) * 255.0).round() as u8,
            (layer.color[1].clamp(0.0, 1.0) * 255.0).round() as u8,
            (layer.color[2].clamp(0.0, 1.0) * 255.0).round() as u8,
            (layer.color[3].clamp(0.0, 1.0) * 255.0).round() as u8,
        ];
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("Native Solid Layer {}", index)),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
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
            &rgba,
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
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }

    let canvas_width = request.canvas_width as f32;
    let canvas_height = request.canvas_height as f32;
    let layers: Result<Vec<CompositeLayer<'_>>, String> = request
        .layers
        .iter()
        .zip(views.iter())
        .map(|(layer, view)| {
            Ok(CompositeLayer {
                texture_view: view,
                lut: None,
                z_index: layer.z_index,
                opacity: layer.opacity.clamp(0.0, 1.0),
                blend_mode: parse_blend_mode(&layer.blend_mode)?,
                transform: project_layer_transform(layer, canvas_width, canvas_height),
                crop: CropMargins::default(),
                color_grade: ColorGradeUniforms::default(),
                chroma_key: ChromaKeyUniforms::default(),
            })
        })
        .collect();
    let layers = layers?;

    // Keep texture ownership alive until the compositor has completed readback.
    let _textures = textures;
    let rgba = compositor
        .render_to_rgba_bytes_with_size(
            device,
            queue,
            request.canvas_width,
            request.canvas_height,
            &layers,
            Some(wgpu::Color {
                r: request.clear_color[0].clamp(0.0, 1.0) as f64,
                g: request.clear_color[1].clamp(0.0, 1.0) as f64,
                b: request.clear_color[2].clamp(0.0, 1.0) as f64,
                a: request.clear_color[3].clamp(0.0, 1.0) as f64,
            }),
        )
        .await?;

    Ok(tauri::ipc::Response::new(rgba))
}

/// Decode, color-convert, and composite real video layers in native Rust/wgpu.
/// This is the first project path that no longer exposes decoded RGB pixels to
/// the WebView; readback remains only at the command boundary for now.
#[tauri::command]
pub async fn render_native_video_project_frame(
    app: tauri::AppHandle,
    request: NativeVideoProjectFrameRequest,
) -> Result<tauri::ipc::Response, String> {
    validate_video_project_request(&request)?;

    let state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let canvas_width = request.canvas_width as f32;
    let canvas_height = request.canvas_height as f32;

    // Decode before taking the GPU session lock so a slow seek cannot block
    // another already-decoded preview frame from submitting work.
    let mut decoded_frames = Vec::with_capacity(request.layers.len());
    for layer in &request.layers {
        let decoder = get_decoder(&layer.video_path).await?;
        let (y_plane, uv_plane, width, height, color) = {
            let mut guard = decoder.lock().await;
            let color = guard.metadata().color;
            let (y_plane, uv_plane, width, height) = guard.decode_frame_raw_nv12(layer.time_secs)?;
            (y_plane, uv_plane, width, height, color)
        };
        decoded_frames.push((y_plane, uv_plane, width, height, color));
    }

    let mut session = state.lock().await;
    let mut textures = Vec::with_capacity(request.layers.len());
    let mut views = Vec::with_capacity(request.layers.len());
    for (layer, (y_plane, uv_plane, width, height, color)) in
        request.layers.iter().zip(decoded_frames.iter())
    {
        let params = color_params(&color)?;
        let texture = session.render_nv12_frame_to_texture(
            *width,
            *height,
            layer.width.max(1.0).round() as u32,
            layer.height.max(1.0).round() as u32,
            y_plane,
            uv_plane,
            &params,
        )?;
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }

    let compositor = MultiTrackCompositor::new(
        &session.gpu.device,
        &session.gpu.queue,
        request.canvas_width,
        request.canvas_height,
    );
    let layers: Vec<CompositeLayer<'_>> = request
        .layers
        .iter()
        .zip(views.iter())
        .map(|(layer, view)| CompositeLayer {
            texture_view: view,
            lut: None,
            z_index: layer.z_index,
            opacity: layer.opacity.clamp(0.0, 1.0),
            blend_mode: parse_blend_mode(&layer.blend_mode).expect("validated blend mode"),
            transform: project_layer_transform_values(
                layer.x,
                layer.y,
                layer.width,
                layer.height,
                layer.rotation,
                canvas_width,
                canvas_height,
            ),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        })
        .collect();

    // Keep both decoded textures and their views alive through GPU readback.
    let _textures = textures;
    let rgba = compositor
        .render_to_rgba_bytes_with_size(
            &session.gpu.device,
            &session.gpu.queue,
            request.canvas_width,
            request.canvas_height,
            &layers,
            Some(wgpu::Color {
                r: request.clear_color[0].clamp(0.0, 1.0) as f64,
                g: request.clear_color[1].clamp(0.0, 1.0) as f64,
                b: request.clear_color[2].clamp(0.0, 1.0) as f64,
                a: request.clear_color[3].clamp(0.0, 1.0) as f64,
            }),
        )
        .await?;

    Ok(tauri::ipc::Response::new(rgba))
}

#[cfg(test)]
mod tests {
    use super::{
        color_params, parse_blend_mode, project_layer_transform, validate_project_request,
        validate_video_project_request, NativeProjectFrameRequest, NativeVideoProjectFrameRequest,
    };
    use crate::thumbnail_engine::decoder::VideoColorMetadata;

    #[test]
    fn unspecified_sdr_metadata_uses_limited_rec709_defaults() {
        let params = color_params(&VideoColorMetadata::default()).expect("default should be supported");
        assert_eq!(params.color_space, 0);
        assert_eq!(params.range, 0);
        assert_eq!(params.tonemap_operator, 0);
    }

    #[test]
    fn full_range_rec601_selects_the_explicit_matrix() {
        let mut color = VideoColorMetadata::default();
        color.range = "full".to_string();
        color.matrix = "bt601_625".to_string();
        color.transfer = "bt709".to_string();

        let params = color_params(&color).expect("Rec.601 SDR should be supported");
        assert_eq!(params.color_space, 3);
        assert_eq!(params.range, 1);
    }

    #[test]
    fn unsupported_partial_metadata_is_rejected() {
        let mut color = VideoColorMetadata::default();
        color.matrix = "bt2020_ncl".to_string();
        color.transfer = "unspecified".to_string();

        assert!(color_params(&color).is_err());
    }

    #[test]
    fn project_request_defaults_are_stable() {
        let request: NativeProjectFrameRequest = serde_json::from_str(
            r#"{"canvasWidth":320,"canvasHeight":180,"layers":[{"color":[1,0,0,1],"x":0,"y":0,"width":100,"height":50}]}"#,
        )
        .expect("project request should deserialize");

        assert_eq!(request.clear_color, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(request.layers[0].opacity, 1.0);
        assert_eq!(request.layers[0].blend_mode, "normal");
        validate_project_request(&request).expect("default request should validate");
    }

    #[test]
    fn project_request_rejects_invalid_geometry_and_blend_modes() {
        let mut request = NativeProjectFrameRequest {
            canvas_width: 320,
            canvas_height: 180,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            layers: Vec::new(),
        };
        request.layers.push(super::NativeProjectSolidLayer {
            color: [1.0, 0.0, 0.0, 1.0],
            x: 0.0,
            y: 0.0,
            width: -1.0,
            height: 10.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
        });

        assert!(validate_project_request(&request).is_err());
        assert!(parse_blend_mode("unsupported").is_err());
    }

    #[test]
    fn project_pixels_map_to_top_left_ndc() {
        let layer = super::NativeProjectSolidLayer {
            color: [1.0, 0.0, 0.0, 1.0],
            x: 0.0,
            y: 0.0,
            width: 160.0,
            height: 90.0,
            rotation: 90.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
        };

        let transform = project_layer_transform(&layer, 320.0, 180.0);

        assert!((transform.translate_x + 0.5).abs() < f32::EPSILON);
        assert!((transform.translate_y - 0.5).abs() < f32::EPSILON);
        assert!((transform.scale_x - 0.5).abs() < f32::EPSILON);
        assert!((transform.scale_y - 0.5).abs() < f32::EPSILON);
        assert!((transform.rotation_rad + std::f32::consts::FRAC_PI_2).abs() < 1e-6);
    }

    #[test]
    fn video_project_request_defaults_are_stable() {
        let request: NativeVideoProjectFrameRequest = serde_json::from_str(
            r#"{"canvasWidth":320,"canvasHeight":180,"layers":[{"videoPath":"/tmp/clip.mp4","timeSecs":1.0,"x":0,"y":0,"width":320,"height":180}]}"#,
        )
        .expect("video project request should deserialize");

        assert_eq!(request.clear_color, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(request.layers[0].opacity, 1.0);
        assert_eq!(request.layers[0].blend_mode, "normal");
        validate_video_project_request(&request).expect("default request should validate");
    }
}
