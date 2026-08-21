// src-tauri/src/shaders/gpu_transitions.wgsl
// GPU Dual-Texture Transitions Shader Module

struct TransitionUniforms {
    progress: f32,          // Transition interpolation factor [0.0, 1.0]
    transition_type: u32,   // 0: Cross-Dissolve, 1: Directional Wipe, 2: Zoom Blur, 3: Iris, 4/5: Slide
    feather: f32,           // Edge softness [0.0, 1.0]
    angle_rad: f32,         // Wipe direction angle in radians
    blur_strength: f32,     // Blur radius for zoom/luma blurs
    aspect_ratio: f32,
    _pad1: f32,
    _pad2: f32,
    fade_color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u_trans: TransitionUniforms;
@group(1) @binding(0) var t_from: texture_2d<f32>;
@group(1) @binding(1) var s_from: sampler;
@group(1) @binding(2) var t_to: texture_2d<f32>;
@group(1) @binding(3) var s_to: sampler;

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
    out.clip_position = vec4<f32>(in.position, 0.0, 1.0);
    out.uv = in.uv;
    return out;
}

// 1. Equal-Power & Linear Cross-Dissolve
fn blend_cross_dissolve(uv: vec2<f32>, progress: f32) -> vec4<f32> {
    let col_from = textureSampleLevel(t_from, s_from, uv, 0.0);
    let col_to = textureSampleLevel(t_to, s_to, uv, 0.0);
    return mix(col_from, col_to, progress);
}

fn blend_fade_through_color(uv: vec2<f32>, progress: f32, fade_color: vec4<f32>) -> vec4<f32> {
    let col_from = textureSampleLevel(t_from, s_from, uv, 0.0);
    let col_to = textureSampleLevel(t_to, s_to, uv, 0.0);
    if (progress < 0.5) {
        return mix(col_from, fade_color, progress * 2.0);
    }
    return mix(fade_color, col_to, (progress - 0.5) * 2.0);
}

fn transition_hash(value: vec2<f32>) -> f32 {
    return fract(sin(dot(value, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn blend_blur_fade(uv: vec2<f32>, progress: f32, strength: f32) -> vec4<f32> {
    let radius = sin(progress * 3.14159265) * min(max(strength, 0.0) / 80.0, 0.12);
    var from_acc = vec4<f32>(0.0);
    var to_acc = vec4<f32>(0.0);
    for (var i = 0; i < 5; i++) {
        let offset = (f32(i) - 2.0) * radius;
        let sample_uv = clamp(uv + vec2<f32>(offset, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));
        from_acc += textureSampleLevel(t_from, s_from, sample_uv, 0.0);
        to_acc += textureSampleLevel(t_to, s_to, sample_uv, 0.0);
    }
    return mix(from_acc / 5.0, to_acc / 5.0, progress);
}

fn blend_glitch(uv: vec2<f32>, progress: f32) -> vec4<f32> {
    let band = floor(uv.y * 32.0);
    let amount = sin(progress * 3.14159265) * 0.08;
    let shift = (transition_hash(vec2<f32>(band, floor(progress * 12.0))) - 0.5) * amount;
    let from_color = textureSampleLevel(t_from, s_from, clamp(uv + vec2<f32>(shift, 0.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let to_color = textureSampleLevel(t_to, s_to, clamp(uv - vec2<f32>(shift, 0.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    return mix(from_color, to_color, progress);
}

fn blend_rgb_split(uv: vec2<f32>, progress: f32) -> vec4<f32> {
    let offset = sin(progress * 3.14159265) * 0.015;
    let left = clamp(uv - vec2<f32>(offset, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));
    let right = clamp(uv + vec2<f32>(offset, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));
    let from_left = textureSampleLevel(t_from, s_from, left, 0.0);
    let from_right = textureSampleLevel(t_from, s_from, right, 0.0);
    let to_left = textureSampleLevel(t_to, s_to, left, 0.0);
    let to_right = textureSampleLevel(t_to, s_to, right, 0.0);
    return vec4<f32>(mix(from_left.r, to_left.r, progress), mix(from_left.g, to_left.g, progress), mix(from_right.b, to_right.b, progress), 1.0);
}

fn blend_creative_overlay(uv: vec2<f32>, progress: f32, light: bool) -> vec4<f32> {
    let base = blend_cross_dissolve(uv, progress);
    let envelope = sin(progress * 3.14159265);
    let noise = transition_hash(uv * vec2<f32>(24.0, 12.0) + vec2<f32>(progress * 17.0, progress * 9.0));
    var warm = vec3<f32>(1.0, 0.38, 0.08);
    if (light) {
        warm = vec3<f32>(1.0, 0.78, 0.35);
    }
    let amount = envelope * (0.18 + noise * 0.32);
    return vec4<f32>(min(base.rgb + warm * amount, vec3<f32>(1.0)), base.a);
}

fn blend_whip_pan(uv: vec2<f32>, progress: f32) -> vec4<f32> {
    let offset = sin(progress * 3.14159265) * 0.22;
    let from_uv = clamp(uv + vec2<f32>(progress * offset, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));
    let to_uv = clamp(uv - vec2<f32>((1.0 - progress) * offset, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));
    return mix(textureSampleLevel(t_from, s_from, from_uv, 0.0), textureSampleLevel(t_to, s_to, to_uv, 0.0), progress);
}

fn blend_clock_wipe(uv: vec2<f32>, progress: f32, feather: f32) -> vec4<f32> {
    let centered = uv - vec2<f32>(0.5);
    let angle = atan2(centered.y, centered.x) + 1.5707963;
    let normalized = fract(angle / 6.2831853 + 1.0);
    let softness = max(feather, 1e-4);
    let to_factor = 1.0 - smoothstep(progress - softness, progress + softness, normalized);
    return mix(textureSampleLevel(t_from, s_from, uv, 0.0), textureSampleLevel(t_to, s_to, uv, 0.0), to_factor);
}

fn blend_shape_wipe(uv: vec2<f32>, progress: f32, shape: u32, aspect: f32, feather: f32) -> vec4<f32> {
    let centered = abs((uv - vec2<f32>(0.5)) * vec2<f32>(max(aspect, 1.0), 1.0));
    var distance = 0.0;
    if (shape == 1u) {
        distance = centered.x + centered.y;
    } else if (shape == 2u) {
        distance = max(centered.x, centered.y);
    } else {
        distance = length(centered);
    }
    let softness = max(feather, 1e-4);
    let threshold = progress * (0.5 * max(aspect, 1.0) + 0.5);
    let to_factor = 1.0 - smoothstep(threshold - softness, threshold + softness, distance);
    return mix(textureSampleLevel(t_from, s_from, uv, 0.0), textureSampleLevel(t_to, s_to, uv, 0.0), to_factor);
}

fn blend_zoom_transform(uv: vec2<f32>, progress: f32, direction: f32) -> vec4<f32> {
    var scale = 1.0 - progress * 0.3;
    if (direction > 0.0) {
        scale = 1.0 + progress * 0.3;
    }
    let from_uv = clamp((uv - vec2<f32>(0.5)) * scale + vec2<f32>(0.5), vec2<f32>(0.0), vec2<f32>(1.0));
    return mix(textureSampleLevel(t_from, s_from, from_uv, 0.0), textureSampleLevel(t_to, s_to, uv, 0.0), progress);
}

// 2. Directional Wipe with Continuous Angle & Anti-Aliased Feathering
fn blend_directional_wipe(uv: vec2<f32>, progress: f32, angle: f32, feather: f32) -> vec4<f32> {
    let dir = vec2<f32>(cos(angle), sin(angle));
    let centered_uv = uv - vec2<f32>(0.5);
    let projection = dot(centered_uv, dir) + 0.5;

    let f = max(feather, 1e-4);
    let edge_min = progress - f;
    let edge_max = progress + f;
    let factor = smoothstep(edge_min, edge_max, projection);

    let col_from = textureSampleLevel(t_from, s_from, uv, 0.0);
    let col_to = textureSampleLevel(t_to, s_to, uv, 0.0);
    return mix(col_to, col_from, factor);
}

// 3. Zoom / Luma Blur with Boundary Clamping
fn blend_zoom_blur(uv: vec2<f32>, progress: f32, strength: f32) -> vec4<f32> {
    let center = vec2<f32>(0.5, 0.5);
    var acc_from = vec4<f32>(0.0);
    var acc_to = vec4<f32>(0.0);
    let samples = 8;
    let blur_factor = sin(progress * 3.14159265) * strength;

    for (var i = 0; i < samples; i++) {
        let scale = 1.0 + f32(i) / f32(samples) * blur_factor;
        let sampled_uv = clamp((uv - center) * scale + center, vec2<f32>(0.0), vec2<f32>(1.0));
        acc_from += textureSampleLevel(t_from, s_from, sampled_uv, 0.0);
        acc_to += textureSampleLevel(t_to, s_to, sampled_uv, 0.0);
    }

    let col_from = acc_from / f32(samples);
    let col_to = acc_to / f32(samples);
    return mix(col_from, col_to, progress);
}

// 4. Centred radial reveal. Custom centre/shape parameters remain outside
// the native path until they are persisted in the timeline contract.
fn blend_iris_wipe(uv: vec2<f32>, progress: f32, feather: f32, aspect: f32) -> vec4<f32> {
    let centred = (uv - vec2<f32>(0.5)) * vec2<f32>(max(aspect, 1.0), 1.0);
    let distance = length(centred);
    let max_radius = length(vec2<f32>(0.5 * max(aspect, 1.0), 0.5));
    let softness = max(feather, 1e-4);
    let radius = progress * (max_radius + softness);
    let factor = smoothstep(radius - softness, radius, distance);
    let col_from = textureSampleLevel(t_from, s_from, uv, 0.0);
    let col_to = textureSampleLevel(t_to, s_to, uv, 0.0);
    return mix(col_to, col_from, factor);
}

fn blend_slide_push(uv: vec2<f32>, progress: f32, direction: f32) -> vec4<f32> {
    var from_uv = uv;
    var to_uv = uv;
    if (direction < 0.0) {
        from_uv.x = uv.x + progress;
        to_uv.x = uv.x - (1.0 - progress);
    } else {
        from_uv.x = uv.x - progress;
        to_uv.x = uv.x + (1.0 - progress);
    }
    if (uv.x < 0.0 || uv.x > 1.0) {
        // textureSampleLevel (explicit LOD=0) is required here because this
        // branch depends on uv.x which is a non-uniform per-fragment value.
        // WebGPU's validator rejects textureSample in non-uniform control flow.
        return textureSampleLevel(t_to, s_to, clamp(to_uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    }
    let from_color = textureSampleLevel(t_from, s_from, clamp(from_uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let to_color = textureSampleLevel(t_to, s_to, clamp(to_uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    return select(to_color, from_color, (direction < 0.0 && uv.x < 1.0 - progress) || (direction >= 0.0 && uv.x > progress));
}

fn blend_slide_push_vertical(uv: vec2<f32>, progress: f32, direction: f32) -> vec4<f32> {
    var from_uv = uv;
    var to_uv = uv;
    if (direction < 0.0) {
        from_uv.y = uv.y + progress;
        to_uv.y = uv.y - (1.0 - progress);
    } else {
        from_uv.y = uv.y - progress;
        to_uv.y = uv.y + (1.0 - progress);
    }
    let from_color = textureSampleLevel(t_from, s_from, clamp(from_uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let to_color = textureSampleLevel(t_to, s_to, clamp(to_uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    return select(to_color, from_color, (direction < 0.0 && uv.y < 1.0 - progress) || (direction >= 0.0 && uv.y > progress));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let t = clamp(u_trans.progress, 0.0, 1.0);
    if (u_trans.transition_type == 1u) {
        return blend_directional_wipe(in.uv, t, u_trans.angle_rad, u_trans.feather);
    } else if (u_trans.transition_type == 2u) {
        return blend_zoom_blur(in.uv, t, u_trans.blur_strength);
    } else if (u_trans.transition_type == 3u) {
        return blend_iris_wipe(in.uv, t, u_trans.feather, u_trans.aspect_ratio);
    } else if (u_trans.transition_type == 4u) {
        return blend_slide_push(in.uv, t, -1.0);
    } else if (u_trans.transition_type == 5u) {
        return blend_slide_push(in.uv, t, 1.0);
    } else if (u_trans.transition_type == 6u) {
        return blend_slide_push_vertical(in.uv, t, -1.0);
    } else if (u_trans.transition_type == 7u) {
        return blend_slide_push_vertical(in.uv, t, 1.0);
    } else if (u_trans.transition_type == 8u) {
        return blend_fade_through_color(in.uv, t, u_trans.fade_color);
    } else if (u_trans.transition_type == 9u) {
        return blend_blur_fade(in.uv, t, u_trans.blur_strength);
    } else if (u_trans.transition_type == 10u) {
        return blend_glitch(in.uv, t);
    } else if (u_trans.transition_type == 11u) {
        return blend_rgb_split(in.uv, t);
    } else if (u_trans.transition_type == 12u) {
        return blend_creative_overlay(in.uv, t, false);
    } else if (u_trans.transition_type == 13u) {
        return blend_creative_overlay(in.uv, t, true);
    } else if (u_trans.transition_type == 14u) {
        return blend_whip_pan(in.uv, t);
    } else if (u_trans.transition_type == 15u) {
        return blend_clock_wipe(in.uv, t, u_trans.feather);
    } else if (u_trans.transition_type == 16u) {
        return blend_shape_wipe(in.uv, t, 0u, u_trans.aspect_ratio, u_trans.feather);
    } else if (u_trans.transition_type == 17u) {
        return blend_shape_wipe(in.uv, t, 1u, u_trans.aspect_ratio, u_trans.feather);
    } else if (u_trans.transition_type == 18u) {
        return blend_shape_wipe(in.uv, t, 2u, u_trans.aspect_ratio, u_trans.feather);
    } else if (u_trans.transition_type == 19u) {
        return blend_zoom_transform(in.uv, t, 1.0);
    } else if (u_trans.transition_type == 20u) {
        return blend_zoom_transform(in.uv, t, -1.0);
    }
    return blend_cross_dissolve(in.uv, t);
}
