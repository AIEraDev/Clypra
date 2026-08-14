// src-tauri/src/shaders/gpu_transitions.wgsl
// GPU Dual-Texture Transitions Shader Module

struct TransitionUniforms {
    progress: f32,          // Transition interpolation factor [0.0, 1.0]
    transition_type: u32,   // 0: Cross-Dissolve, 1: Directional Wipe, 2: Zoom Blur
    feather: f32,           // Edge softness [0.0, 1.0]
    angle_rad: f32,         // Wipe direction angle in radians
    blur_strength: f32,     // Blur radius for zoom/luma blurs
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
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
    let col_from = textureSample(t_from, s_from, uv);
    let col_to = textureSample(t_to, s_to, uv);
    return mix(col_from, col_to, progress);
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

    let col_from = textureSample(t_from, s_from, uv);
    let col_to = textureSample(t_to, s_to, uv);
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
        acc_from += textureSample(t_from, s_from, sampled_uv);
        acc_to += textureSample(t_to, s_to, sampled_uv);
    }

    let col_from = acc_from / f32(samples);
    let col_to = acc_to / f32(samples);
    return mix(col_from, col_to, progress);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let t = clamp(u_trans.progress, 0.0, 1.0);
    if (u_trans.transition_type == 1u) {
        return blend_directional_wipe(in.uv, t, u_trans.angle_rad, u_trans.feather);
    } else if (u_trans.transition_type == 2u) {
        return blend_zoom_blur(in.uv, t, u_trans.blur_strength);
    }
    return blend_cross_dissolve(in.uv, t);
}
