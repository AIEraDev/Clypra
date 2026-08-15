// multi_track_blend.wgsl — GPU Multi-Track Compositor Shader
// Handles layer transform, crop boundaries, opacity, chroma key (UltraKey), color grading, and 3D LUT sampling.

struct ChromaKeyUniforms {
    key_color: vec3<f32>,       // Target key color in linear sRGB (e.g., [0.0, 1.0, 0.0])
    tolerance: f32,             // Inner core radius [0.0, 1.0]
    smoothness: f32,            // Edge softness / feather width [0.0, 1.0]
    despill_amount: f32,        // Spill suppression strength [0.0, 1.0]
    despill_balance: f32,       // 0.0 (bias Red) to 1.0 (bias Blue), default 0.5
    matte_pedestal: f32,        // Black-point clip [0.0, 0.5]
    matte_highlight: f32,       // White-point clip [0.5, 1.0]
    enabled: u32,               // 0: Disabled, 1: Enabled
    _pad0: f32,
    _pad1: f32,
};

struct ColorGradeUniforms {
    // Basic Adjustments
    exposure: f32,       // EV stops [-3.0, 3.0], default 0.0
    contrast: f32,       // [0.0, 2.0], default 1.0
    saturation: f32,     // [0.0, 2.0], default 1.0
    temperature: f32,    // Kelvin shift [-1.0, 1.0], default 0.0
    tint: f32,           // Green-Magenta shift [-1.0, 1.0], default 0.0

    // 3D LUT Parameters
    lut_intensity: f32,  // Blend factor [0.0, 1.0], default 1.0
    lut_size: f32,       // e.g., 33.0
    has_lut: u32,        // 0: Disabled, 1: Enabled
};

struct LayerUniforms {
    transform_matrix: mat4x4<f32>,
    crop_margins: vec4<f32>, // [Left, Top, Right, Bottom]
    opacity: f32,
    blend_mode: u32,
    is_premultiplied: u32,
    _padding: f32,
    color_grade: ColorGradeUniforms,
    chroma_key: ChromaKeyUniforms,
};

@group(0) @binding(0) var<uniform> layer: LayerUniforms;
@group(1) @binding(0) var t_diffuse: texture_2d<f32>;
@group(1) @binding(1) var s_diffuse: sampler;
@group(1) @binding(2) var t_lut_3d: texture_3d<f32>;
@group(1) @binding(3) var s_lut_3d: sampler;

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = layer.transform_matrix * vec4<f32>(in.position, 0.0, 1.0);
    out.uv = in.uv;
    return out;
}

// Converts standard RGB to ITU-R BT.709 YCbCr space
fn rgb_to_ycbcr(rgb: vec3<f32>) -> vec3<f32> {
    let y  =  0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    let cb = -0.1146 * rgb.r - 0.3854 * rgb.g + 0.5000 * rgb.b;
    let cr =  0.5000 * rgb.r - 0.4542 * rgb.g - 0.0458 * rgb.b;
    return vec3<f32>(y, cb, cr);
}

// Suppresses green/blue spill on semi-transparent and foreground edge pixels
fn apply_despill(rgb: vec3<f32>, key_color: vec3<f32>, amount: f32, balance: f32) -> vec3<f32> {
    if (amount <= 0.0) {
        return rgb;
    }

    var despilled = rgb;

    // Green Screen Despill
    if (key_color.g > max(key_color.r, key_color.b)) {
        let limit = mix(rgb.r, rgb.b, balance);
        if (rgb.g > limit) {
            let excess = (rgb.g - limit) * amount;
            despilled.g = rgb.g - excess;
        }
    } 
    // Blue Screen Despill
    else if (key_color.b > max(key_color.r, key_color.b)) {
        let limit = mix(rgb.r, rgb.b, balance);
        if (rgb.b > limit) {
            let excess = (rgb.b - limit) * amount;
            despilled.b = rgb.b - excess;
        }
    }

    return clamp(despilled, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Executes the complete UltraKey extraction pipeline
fn process_chroma_key(
    raw_color: vec4<f32>,
    config: ChromaKeyUniforms
) -> vec4<f32> {
    if (config.enabled == 0u || raw_color.a <= 0.0) {
        return raw_color;
    }

    let input_rgb = raw_color.rgb;

    // 1. Convert sample and key target to chrominance coordinates
    let pixel_ycbcr = rgb_to_ycbcr(input_rgb);
    let key_ycbcr   = rgb_to_ycbcr(config.key_color);

    // 2. Measure Euclidean distance in Cb-Cr chromatic plane
    let chroma_dist = distance(pixel_ycbcr.yz, key_ycbcr.yz);

    // 3. Analytical Softness / Feathering (Smoothstep transition)
    let lower_bound = config.tolerance;
    let upper_bound = config.tolerance + max(config.smoothness, 1e-4);
    var raw_alpha = smoothstep(lower_bound, upper_bound, chroma_dist);

    // 4. Matte Cleanup (Levels / Black & White Clips)
    let pedestal  = config.matte_pedestal;
    let highlight = max(config.matte_highlight, pedestal + 1e-4);
    let clean_alpha = clamp((raw_alpha - pedestal) / (highlight - pedestal), 0.0, 1.0);

    let final_alpha = raw_color.a * clean_alpha;

    if (final_alpha <= 0.0001) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    // 5. Background Color Despill Suppression
    let despilled_rgb = apply_despill(
        input_rgb,
        config.key_color,
        config.despill_amount,
        config.despill_balance
    );

    return vec4<f32>(despilled_rgb, final_alpha);
}

// Applies White Balance (Color Temperature & Tint)
fn apply_white_balance(color: vec3<f32>, temp: f32, tint: f32) -> vec3<f32> {
    // Temperature: Shifts Blue to Orange/Amber
    let temp_shift = vec3<f32>(1.0 + temp * 0.2, 1.0, 1.0 - temp * 0.2);
    // Tint: Shifts Green to Magenta
    let tint_shift = vec3<f32>(1.0 + tint * 0.1, 1.0 - tint * 0.1, 1.0 + tint * 0.1);
    return clamp(color * temp_shift * tint_shift, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Standard ITU-R BT.709 Rec.709 Luma
fn get_luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // 1. Branch-Free Crop Margin Clipping
    let crop = layer.crop_margins;
    if (in.uv.x < crop.x || in.uv.x > (1.0 - crop.z) ||
        in.uv.y < crop.y || in.uv.y > (1.0 - crop.w)) {
        discard;
    }

    var sample_color = textureSample(t_diffuse, s_diffuse, in.uv);
    if (sample_color.a <= 0.0001) {
        discard;
    }

    // 2. Chroma Key & Despill Extraction
    let keyed_color = process_chroma_key(sample_color, layer.chroma_key);
    if (keyed_color.a <= 0.0001) {
        discard;
    }

    var rgb = keyed_color.rgb;

    // 3. Exposure Adjustment (Linear light scaling in EV stops)
    if (layer.color_grade.exposure != 0.0) {
        rgb = rgb * pow(2.0, layer.color_grade.exposure);
    }

    // 4. White Balance (Temperature & Tint)
    if (layer.color_grade.temperature != 0.0 || layer.color_grade.tint != 0.0) {
        rgb = apply_white_balance(rgb, layer.color_grade.temperature, layer.color_grade.tint);
    }

    // 5. Contrast Adjustment around mid-gray (0.5)
    if (layer.color_grade.contrast != 1.0) {
        rgb = clamp((rgb - vec3<f32>(0.5)) * layer.color_grade.contrast + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
    }

    // 6. 3D LUT Color Transformation
    if (layer.color_grade.has_lut == 1u) {
        let n = layer.color_grade.lut_size;
        let scale = (n - 1.0) / n;
        let offset = 1.0 / (2.0 * n);

        // Map [0.0, 1.0] to texel center volume coords
        let lut_coord = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * scale + offset;
        let lut_graded = textureSample(t_lut_3d, s_lut_3d, lut_coord).rgb;

        // Blend graded result by lut_intensity slider
        rgb = mix(rgb, lut_graded, layer.color_grade.lut_intensity);
    }

    // 7. Saturation Adjustment
    if (layer.color_grade.saturation != 1.0) {
        let luma = get_luminance(rgb);
        rgb = clamp(mix(vec3<f32>(luma), rgb, layer.color_grade.saturation), vec3<f32>(0.0), vec3<f32>(1.0));
    }

    // 8. Layer Opacity & Premultiplied Alpha
    let final_alpha = keyed_color.a * layer.opacity;
    let final_rgb = rgb * final_alpha;

    return vec4<f32>(final_rgb, final_alpha);
}
