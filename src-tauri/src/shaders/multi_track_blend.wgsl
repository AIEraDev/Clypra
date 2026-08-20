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

    // Clypra Studio ColorAdjustments controls
    brightness: f32,     // Additive offset [-1.0, 1.0]
    sepia: f32,          // Mix amount [0.0, 1.0]
    grayscale: f32,      // Mix amount [0.0, 1.0]
    hue_rotate: f32,     // Radians
    vignette: f32,       // Edge darkening [0.0, 1.0]
    invert: f32,         // Mix amount [0.0, 1.0]
    grain_intensity: f32,
    grain_size: f32,

    // 3D LUT Parameters
    lut_intensity: f32,  // Blend factor [0.0, 1.0], default 1.0
    lut_size: f32,       // e.g., 33.0
    has_lut: u32,        // 0: Disabled, 1: Enabled
    blur_strength: f32,  // 0: Disabled, 1: Enabled
    blur_radius: f32,    // Radius in source pixels
    pixelate_size: f32,  // Pixel block size in source pixels
    scanline_count: f32,
    scanline_intensity: f32,
    rgb_split_x: f32,    // Channel offset in source pixels
    rgb_split_y: f32,
    vibrance_amount: f32,
    vibrance_protected_hue_r: f32,
    vibrance_protected_hue_g: f32,
    vibrance_protected_hue_b: f32,
    lift: f32,
    cross_process_amount: f32,
    channel_mix: vec4<f32>, // RGB weights + enabled flag
    duotone_dark: vec4<f32>, // RGB + enabled flag
    duotone_light: vec4<f32>, // RGB + padding
    shadow_tint: vec4<f32>, // RGB + strength
    highlight_tint: vec4<f32>, // RGB + strength
    split_params: vec4<f32>, // balance + padding
    glow_color_strength: vec4<f32>, // RGB + strength
    glow_params: vec4<f32>, // radius + padding
    flash_color_strength: vec4<f32>, // RGB + strength
    temporal_effects: vec4<f32>, // flicker, strobe frequency/time/strength
    light_leak_color_strength: vec4<f32>, // RGB + strength
    light_leak_params: vec4<f32>, // angle, time + padding
    glitch_params: vec4<f32>, // intensity, time, slice count, color shift
    distortion_params: vec4<f32>, // type, strength, time, frequency
};

struct LayerUniforms {
    transform_matrix: mat4x4<f32>,
    crop_margins: vec4<f32>, // [Left, Top, Right, Bottom]
    opacity: f32,
    blend_mode: u32,
    is_premultiplied: u32,
    grain_seed: f32,
    color_grade: ColorGradeUniforms,
    chroma_key: ChromaKeyUniforms,
    body_effect: BodyEffectUniforms,
};

struct BodyEffectUniforms {
    color: vec4<f32>, // RGB + padding
    params: vec4<f32>, // renderer type, strength, radius, time
};

@group(0) @binding(0) var<uniform> layer: LayerUniforms;
@group(1) @binding(0) var t_diffuse: texture_2d<f32>;
@group(1) @binding(1) var s_diffuse: sampler;
@group(1) @binding(2) var t_lut_3d: texture_3d<f32>;
@group(1) @binding(3) var s_lut_3d: sampler;
@group(1) @binding(4) var t_mask: texture_2d<f32>;
@group(1) @binding(5) var s_mask: sampler;

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

fn hue_rotate_color(color: vec3<f32>, angle: f32) -> vec3<f32> {
    let axis = vec3<f32>(0.57735, 0.57735, 0.57735);
    let c = cos(angle);
    return color * c + cross(axis, color) * sin(angle) + axis * dot(axis, color) * (1.0 - c);
}

fn film_grain(uv: vec2<f32>, size: f32) -> f32 {
    return fract(sin(dot(uv * size, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn rgb_to_hsv(color: vec3<f32>) -> vec3<f32> {
    let k = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4<f32>(color.bg, k.wz), vec4<f32>(color.gb, k.xy), step(color.b, color.g));
    let q = mix(vec4<f32>(p.xyw, color.r), vec4<f32>(color.r, p.yzx), step(p.x, color.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv_to_rgb(color: vec3<f32>) -> vec3<f32> {
    let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(color.xxx + k.xyz) * 6.0 - k.www);
    return color.z * mix(k.xxx, clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), color.y);
}

fn sample_blurred_color(uv: vec2<f32>, radius: f32) -> vec4<f32> {
    let dimensions = vec2<f32>(textureDimensions(t_diffuse));
    let offset = vec2<f32>(radius) / max(dimensions, vec2<f32>(1.0));
    var color = textureSample(t_diffuse, s_diffuse, uv) * 0.227027;
    color += textureSample(t_diffuse, s_diffuse, uv + vec2<f32>(offset.x, 0.0)) * 0.1945946;
    color += textureSample(t_diffuse, s_diffuse, uv - vec2<f32>(offset.x, 0.0)) * 0.1945946;
    color += textureSample(t_diffuse, s_diffuse, uv + vec2<f32>(0.0, offset.y)) * 0.1945946;
    color += textureSample(t_diffuse, s_diffuse, uv - vec2<f32>(0.0, offset.y)) * 0.1945946;
    color += textureSample(t_diffuse, s_diffuse, uv + offset) * 0.024393;
    color += textureSample(t_diffuse, s_diffuse, uv - offset) * 0.024393;
    color += textureSample(t_diffuse, s_diffuse, uv + vec2<f32>(offset.x, -offset.y)) * 0.024393;
    color += textureSample(t_diffuse, s_diffuse, uv + vec2<f32>(-offset.x, offset.y)) * 0.024393;
    return color;
}

fn sample_body_mask(uv: vec2<f32>) -> f32 {
    return textureSample(t_mask, s_mask, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).a;
}

// Stable pseudo-random values keep body particles deterministic for a given
// cell/time without uploading a particle buffer from the frontend.
fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    p3 += vec3<f32>(dot(p3, p3.yzx + vec3<f32>(33.33)));
    return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // 1. Branch-Free Crop Margin Clipping
    let crop = layer.crop_margins;
    if (in.uv.x < crop.x || in.uv.x > (1.0 - crop.z) ||
        in.uv.y < crop.y || in.uv.y > (1.0 - crop.w)) {
        discard;
    }

    var sample_uv = in.uv;
    let source_dimensions = vec2<f32>(textureDimensions(t_diffuse));
    if (layer.color_grade.glitch_params.x > 0.0 && layer.color_grade.glitch_params.z > 0.0) {
        let slice_count = max(1.0, layer.color_grade.glitch_params.z);
        let slice = floor(in.uv.y * slice_count);
        let burst = hash12(vec2<f32>(slice, floor(layer.color_grade.glitch_params.y * 24.0)));
        let offset = (burst - 0.5) * 2.0 * layer.color_grade.glitch_params.x * layer.color_grade.glitch_params.w;
        sample_uv.x = clamp(sample_uv.x + offset / max(source_dimensions.x, 1.0), 0.0, 1.0);
    }
    if (layer.color_grade.distortion_params.x > 0.0 && layer.color_grade.distortion_params.y > 0.0) {
        let distortion_type = layer.color_grade.distortion_params.x;
        let amount = layer.color_grade.distortion_params.y;
        let time = layer.color_grade.distortion_params.z;
        let frequency = layer.color_grade.distortion_params.w;
        let center = vec2<f32>(0.5, 0.5);
        let delta = sample_uv - center;
        let radius = length(delta);
        let safe_direction = delta / max(radius, 0.001);
        if (distortion_type < 1.5) {
            sample_uv.y += sin((sample_uv.x + time * 0.35) * frequency * 6.2831853) * amount * (1.0 - radius);
        } else if (distortion_type < 2.5) {
            sample_uv += safe_direction * sin(radius * frequency * 6.2831853 - time * 4.0) * amount * (1.0 - radius);
        } else if (distortion_type < 3.5) {
            sample_uv = center + delta * (1.0 - amount * (1.0 - radius));
        } else if (distortion_type < 4.5) {
            let angle = amount * (1.0 - radius) * (1.0 - radius);
            let c = cos(angle);
            let s = sin(angle);
            sample_uv = center + vec2<f32>(delta.x * c - delta.y * s, delta.x * s + delta.y * c);
        } else {
            sample_uv = center + delta * (1.0 + amount * radius * radius);
        }
        sample_uv = clamp(sample_uv, vec2<f32>(0.0), vec2<f32>(1.0));
    }
    if (layer.color_grade.pixelate_size > 0.0) {
        let cell = vec2<f32>(layer.color_grade.pixelate_size) / max(source_dimensions, vec2<f32>(1.0));
        sample_uv = floor(in.uv / cell) * cell + cell * 0.5;
    }

    var sample_color = textureSample(t_diffuse, s_diffuse, sample_uv);
    if (layer.color_grade.blur_strength > 0.0 && layer.color_grade.blur_radius > 0.0) {
        sample_color = sample_blurred_color(sample_uv, layer.color_grade.blur_radius);
    }
    if (layer.color_grade.rgb_split_x > 0.0 || layer.color_grade.rgb_split_y > 0.0) {
        let split_offset = vec2<f32>(layer.color_grade.rgb_split_x, layer.color_grade.rgb_split_y) /
            max(source_dimensions, vec2<f32>(1.0));
        let center = textureSample(t_diffuse, s_diffuse, sample_uv);
        let red = textureSample(t_diffuse, s_diffuse, sample_uv - split_offset).r;
        let blue = textureSample(t_diffuse, s_diffuse, sample_uv + split_offset).b;
        sample_color = vec4<f32>(red, center.g, blue, center.a);
    }
    if (sample_color.a <= 0.0001) {
        discard;
    }

    // 2. Chroma Key & Despill Extraction
    let keyed_color = process_chroma_key(sample_color, layer.chroma_key);
    if (keyed_color.a <= 0.0001) {
        discard;
    }

    var rgb = keyed_color.rgb;

    // Body effects use the segmentation alpha channel as a native texture
    // binding. Type 1 is outline, type 2 is glow, and type 3 is particles;
    // zero means no mask node.
    let body_type = layer.body_effect.params.x;
    if (body_type > 0.0 && layer.body_effect.params.y > 0.0) {
        let body_dimensions = vec2<f32>(textureDimensions(t_mask));
        let body_offset = vec2<f32>(max(layer.body_effect.params.z, 1.0)) /
            max(body_dimensions, vec2<f32>(1.0));
        let center_mask = sample_body_mask(sample_uv);
        var neighbor_max = center_mask;
        neighbor_max = max(neighbor_max, sample_body_mask(sample_uv + vec2<f32>(body_offset.x, 0.0)));
        neighbor_max = max(neighbor_max, sample_body_mask(sample_uv - vec2<f32>(body_offset.x, 0.0)));
        neighbor_max = max(neighbor_max, sample_body_mask(sample_uv + vec2<f32>(0.0, body_offset.y)));
        neighbor_max = max(neighbor_max, sample_body_mask(sample_uv - vec2<f32>(0.0, body_offset.y)));
        if (body_type < 1.5) {
            let edge = max(neighbor_max - center_mask, 0.0) * layer.body_effect.params.y;
            rgb = clamp(rgb + layer.body_effect.color.xyz * edge, vec3<f32>(0.0), vec3<f32>(1.0));
        } else if (body_type < 2.5) {
            let halo = (neighbor_max + center_mask) * 0.5 * layer.body_effect.params.y;
            rgb = clamp(rgb + layer.body_effect.color.xyz * halo, vec3<f32>(0.0), vec3<f32>(1.0));
        } else {
            // One candidate particle per deterministic grid cell. The native
            // count is bounded to 40 by the frontend, keeping this pass cheap
            // while retaining animated, mask-constrained particles.
            let count = clamp(floor(layer.body_effect.params.z), 1.0, 40.0);
            let grid = max(2.0, ceil(sqrt(count)));
            let cell = floor(in.uv * grid);
            let cell_index = cell.y * grid + cell.x;
            if (cell_index < count) {
                let time = layer.body_effect.params.w;
                let jitter = vec2<f32>(
                    hash12(cell + vec2<f32>(17.0, time * 0.73)),
                    hash12(cell + vec2<f32>(41.0, time * 1.11))
                );
                let particle_uv = (cell + jitter) / grid;
                let particle_radius = 0.055 + hash12(cell + vec2<f32>(73.0, 5.0)) * 0.045;
                let cell_uv = fract(in.uv * grid);
                let distance_to_particle = distance(cell_uv, jitter);
                let particle_shape = 1.0 - smoothstep(0.0, particle_radius, distance_to_particle);
                let particle_mask = sample_body_mask(particle_uv);
                let particles = particle_shape * particle_mask * layer.body_effect.params.y;
                rgb = clamp(rgb + layer.body_effect.color.xyz * particles, vec3<f32>(0.0), vec3<f32>(1.0));
            }
        }
    }

    // Regular video glow: a bounded blur-plus-add pass. Body glow remains a
    // separate mask-driven path and is intentionally not represented here.
    if (layer.color_grade.glow_color_strength.w > 0.0 && layer.color_grade.glow_params.x > 0.0) {
        let glow_rgb = sample_blurred_color(sample_uv, layer.color_grade.glow_params.x).rgb;
        rgb = clamp(rgb + glow_rgb * layer.color_grade.glow_color_strength.xyz * layer.color_grade.glow_color_strength.w, vec3<f32>(0.0), vec3<f32>(1.0));
    }

    // 3. Clypra Studio ColorAdjustments order: invert, exposure, brightness,
    // contrast, saturation, grayscale, sepia, hue, white balance, grain, vignette.
    if (layer.color_grade.invert > 0.0) {
        rgb = mix(rgb, vec3<f32>(1.0) - rgb, layer.color_grade.invert);
    }

    // Exposure Adjustment (Linear light scaling in EV stops)
    if (layer.color_grade.exposure != 0.0) {
        rgb = rgb * pow(2.0, layer.color_grade.exposure);
    }

    if (layer.color_grade.brightness != 0.0) {
        rgb = rgb + vec3<f32>(layer.color_grade.brightness);
    }

    // Lift shifts the black point; keep it before contrast to match Clypra Studio.
    if (layer.color_grade.lift != 0.0) {
        rgb = rgb + layer.color_grade.lift * (vec3<f32>(1.0) - rgb);
    }

    // Contrast Adjustment around mid-gray (0.5)
    if (layer.color_grade.contrast != 1.0) {
        rgb = clamp((rgb - vec3<f32>(0.5)) * layer.color_grade.contrast + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
    }

    if (layer.color_grade.saturation != 1.0) {
        let luma = get_luminance(rgb);
        rgb = mix(vec3<f32>(luma), rgb, layer.color_grade.saturation);
    }

    if (layer.color_grade.channel_mix.w > 0.5) {
        let mono = dot(rgb, layer.color_grade.channel_mix.xyz);
        rgb = vec3<f32>(mono);
    }

    if (layer.color_grade.duotone_dark.w > 0.5) {
        let duo_luma = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
        rgb = mix(layer.color_grade.duotone_dark.xyz, layer.color_grade.duotone_light.xyz, duo_luma);
    }

    if (layer.color_grade.shadow_tint.w > 0.0 || layer.color_grade.highlight_tint.w > 0.0) {
        let split_luma = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
        let balance = clamp(layer.color_grade.split_params.x, 0.0, 1.0);
        let shadow_weight = 1.0 - smoothstep(0.0, max(balance, 0.001), split_luma);
        let highlight_weight = smoothstep(min(balance, 0.999), 1.0, split_luma);
        rgb = mix(rgb, rgb * layer.color_grade.shadow_tint.xyz, shadow_weight * layer.color_grade.shadow_tint.w);
        rgb = mix(rgb, rgb * layer.color_grade.highlight_tint.xyz, highlight_weight * layer.color_grade.highlight_tint.w);
    }

    if (layer.color_grade.vibrance_amount != 0.0 && layer.color_grade.channel_mix.w < 0.5 && layer.color_grade.duotone_dark.w < 0.5) {
        let hsv = rgb_to_hsv(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)));
        let protected_hsv = rgb_to_hsv(vec3<f32>(
            layer.color_grade.vibrance_protected_hue_r,
            layer.color_grade.vibrance_protected_hue_g,
            layer.color_grade.vibrance_protected_hue_b
        ));
        var hue_distance = abs(hsv.x - protected_hsv.x);
        hue_distance = min(hue_distance, 1.0 - hue_distance);
        let protection = smoothstep(0.0, 0.15, hue_distance);
        var adjusted_hsv = hsv;
        adjusted_hsv.y = clamp(hsv.y + layer.color_grade.vibrance_amount * protection, 0.0, 1.0);
        rgb = hsv_to_rgb(adjusted_hsv);
    }

    // Cross-process swaps red/blue response curves, matching the Studio shader.
    if (layer.color_grade.cross_process_amount > 0.0) {
        let original_red = rgb.r;
        let original_blue = rgb.b;
        rgb.r = mix(rgb.r, pow(max(original_blue, 0.001), 0.8), layer.color_grade.cross_process_amount);
        rgb.b = mix(rgb.b, pow(max(original_red, 0.001), 1.2), layer.color_grade.cross_process_amount);
    }

    if (layer.color_grade.grayscale > 0.0) {
        let luma = get_luminance(rgb);
        rgb = mix(rgb, vec3<f32>(luma), layer.color_grade.grayscale);
    }

    if (layer.color_grade.sepia > 0.0) {
        let sepia_rgb = vec3<f32>(
            dot(rgb, vec3<f32>(0.393, 0.769, 0.189)),
            dot(rgb, vec3<f32>(0.349, 0.686, 0.168)),
            dot(rgb, vec3<f32>(0.272, 0.534, 0.131))
        );
        rgb = mix(rgb, sepia_rgb, layer.color_grade.sepia);
    }

    if (layer.color_grade.hue_rotate != 0.0) {
        rgb = hue_rotate_color(rgb, layer.color_grade.hue_rotate);
    }

    // White Balance (Temperature & Tint)
    if (layer.color_grade.temperature != 0.0 || layer.color_grade.tint != 0.0) {
        rgb = apply_white_balance(rgb, layer.color_grade.temperature, layer.color_grade.tint);
    }

    if (layer.color_grade.grain_intensity > 0.0) {
        let grain = film_grain(
            in.uv + vec2<f32>(layer.grain_seed),
            max(layer.color_grade.grain_size, 0.1)
        );
        rgb = rgb + vec3<f32>((grain - 0.5) * layer.color_grade.grain_intensity);
    }

    // 4. 3D LUT Color Transformation
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

    if (layer.color_grade.vignette > 0.0) {
        let distance_from_center = length(in.uv - vec2<f32>(0.5));
        let edge = smoothstep(0.45, 1.0, distance_from_center);
        rgb = mix(rgb, vec3<f32>(0.0), edge * layer.color_grade.vignette);
    }

    if (layer.color_grade.scanline_intensity > 0.0 && layer.color_grade.scanline_count > 0.0) {
        let scanline = sin(in.uv.y * layer.color_grade.scanline_count * 3.14159) * 0.5 + 0.5;
        let dark = rgb * (1.0 - layer.color_grade.scanline_intensity * 0.5);
        rgb = mix(dark, rgb, scanline);
    }

    // Time-driven effects use the evaluated effect time from the request.
    // Flash follows the existing Pixi screen blend approximation.
    if (layer.color_grade.flash_color_strength.w > 0.0) {
        let flash = layer.color_grade.flash_color_strength.xyz * layer.color_grade.flash_color_strength.w;
        rgb = vec3<f32>(1.0) - (vec3<f32>(1.0) - rgb) * (vec3<f32>(1.0) - flash);
    }
    if (layer.color_grade.temporal_effects.w > 0.0 && layer.color_grade.temporal_effects.y > 0.0) {
        let strobe_on = sin(layer.color_grade.temporal_effects.z * layer.color_grade.temporal_effects.y * 3.14159265) > 0.0;
        if (strobe_on) {
            let flash = vec3<f32>(layer.color_grade.temporal_effects.w);
            rgb = vec3<f32>(1.0) - (vec3<f32>(1.0) - rgb) * (vec3<f32>(1.0) - flash);
        }
    }

    // 5. Layer Opacity & Premultiplied Alpha
    var alpha_multiplier = 1.0;
    if (layer.color_grade.temporal_effects.x > 0.0) {
        let flicker_noise = fract(sin(layer.grain_seed * 12.9898 + 17.0) * 43758.5453);
        alpha_multiplier = 1.0 - flicker_noise * layer.color_grade.temporal_effects.x * 0.5;
    }

    // Bounded animated diagonal screen blend. The evaluated effect time is
    // carried in the frame request, so this does not require a JS overlay.
    if (layer.color_grade.light_leak_color_strength.w > 0.0) {
        let angle = layer.color_grade.light_leak_params.x;
        let axis = vec2<f32>(cos(angle), sin(angle));
        let projected = dot(in.uv - vec2<f32>(0.5), axis);
        let drift = sin(layer.color_grade.light_leak_params.y * 0.7) * 0.22;
        let band = 1.0 - smoothstep(0.02, 0.62, abs(projected + drift));
        let leak = layer.color_grade.light_leak_color_strength.xyz *
            layer.color_grade.light_leak_color_strength.w * band;
        rgb = vec3<f32>(1.0) - (vec3<f32>(1.0) - rgb) * (vec3<f32>(1.0) - leak);
    }
    let final_alpha = keyed_color.a * layer.opacity * alpha_multiplier;
    let final_rgb = rgb * final_alpha;

    return vec4<f32>(final_rgb, final_alpha);
}
