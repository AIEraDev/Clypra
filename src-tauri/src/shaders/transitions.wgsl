// transitions.wgsl — Real-Time GPU Transition Shader Suite
// Handles cross-dissolve, directional wipes with edge feathering, zoom blur, and radial iris wipes.

struct TransitionUniforms {
    progress: f32,       // Normalized transition progress [0.0, 1.0]
    transition_type: u32,// 0: CrossDissolve, 1: WipeLeft, 2: WipeRight, 3: WipeUp, 4: WipeDown, 5: WipeDiagonal, 6: IrisWipe, 7: ZoomBlur, 8: SlidePush
    feather: f32,        // Wipe edge softness [0.0, 1.0], default 0.1
    intensity: f32,      // Zoom blur or displacement intensity, default 1.0
    aspect_ratio: f32,   // Canvas width / height (e.g. 1.7777 for 16:9)
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> config: TransitionUniforms;
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

// 1. Cross-Dissolve: Linear or S-Curve opacity blend
fn transition_cross_dissolve(uv: vec2<f32>, p: f32) -> vec4<f32> {
    let col_from = textureSample(t_from, s_from, uv);
    let col_to = textureSample(t_to, s_to, uv);
    return mix(col_from, col_to, p);
}

// 2-5. Directional Wipes with smooth feathering
fn transition_wipe(uv: vec2<f32>, p: f32, mode: u32, feather: f32) -> vec4<f32> {
    let col_from = textureSample(t_from, s_from, uv);
    let col_to = textureSample(t_to, s_to, uv);

    var coord: f32 = 0.0;
    if (mode == 1u) {
        // Wipe Left (Right-to-Left reveal)
        coord = 1.0 - uv.x;
    } else if (mode == 2u) {
        // Wipe Right (Left-to-Right reveal)
        coord = uv.x;
    } else if (mode == 3u) {
        // Wipe Up (Bottom-to-Top reveal)
        coord = 1.0 - uv.y;
    } else if (mode == 4u) {
        // Wipe Down (Top-to-Bottom reveal)
        coord = uv.y;
    } else if (mode == 5u) {
        // Diagonal Wipe (Top-Left to Bottom-Right)
        coord = (uv.x + uv.y) * 0.5;
    }

    let softness = max(feather, 1e-4);
    // Expand progress range so feathering is completely hidden at p=0 and fully revealed at p=1
    let adjusted_p = p * (1.0 + softness);
    let mask = smoothstep(adjusted_p - softness, adjusted_p, coord);

    return mix(col_to, col_from, mask);
}

// 6. Iris / Radial Circle Wipe
fn transition_iris_wipe(uv: vec2<f32>, p: f32, feather: f32, aspect: f32) -> vec4<f32> {
    let col_from = textureSample(t_from, s_from, uv);
    let col_to = textureSample(t_to, s_to, uv);

    let centered = vec2<f32>((uv.x - 0.5) * aspect, uv.y - 0.5);
    let dist = length(centered);
    let max_radius = length(vec2<f32>(0.5 * aspect, 0.5));

    let softness = max(feather, 1e-4);
    let current_radius = p * (max_radius + softness);
    let mask = smoothstep(current_radius - softness, current_radius, dist);

    return mix(col_to, col_from, mask);
}

// 7. Zoom Blur: Radial distortion and blur accumulation
fn transition_zoom_blur(uv: vec2<f32>, p: f32, intensity: f32) -> vec4<f32> {
    let center = vec2<f32>(0.5, 0.5);
    let to_center = uv - center;

    // Zoom intensity peaks at mid-transition
    let factor = sin(p * 3.14159265) * 0.15 * intensity;
    var acc_from = vec4<f32>(0.0);
    var acc_to = vec4<f32>(0.0);

    let samples: i32 = 8;
    for (var i: i32 = 0; i < samples; i = i + 1) {
        let offset = f32(i) / f32(samples - 1) * factor;
        let sample_uv_from = center + to_center * (1.0 - offset * (1.0 - p));
        let sample_uv_to = center + to_center * (1.0 + offset * p);

        acc_from = acc_from + textureSample(t_from, s_from, clamp(sample_uv_from, vec2<f32>(0.0), vec2<f32>(1.0)));
        acc_to = acc_to + textureSample(t_to, s_to, clamp(sample_uv_to, vec2<f32>(0.0), vec2<f32>(1.0)));
    }

    let avg_from = acc_from / f32(samples);
    let avg_to = acc_to / f32(samples);

    return mix(avg_from, avg_to, p);
}

// 8. Slide / Push Transition
fn transition_slide_push(uv: vec2<f32>, p: f32) -> vec4<f32> {
    let offset_x = p;
    let uv_from = uv + vec2<f32>(offset_x, 0.0);
    let uv_to = uv - vec2<f32>(1.0 - offset_x, 0.0);

    if (uv.x < 1.0 - p) {
        return textureSample(t_from, s_from, clamp(uv_from, vec2<f32>(0.0), vec2<f32>(1.0)));
    } else {
        return textureSample(t_to, s_to, clamp(uv_to, vec2<f32>(0.0), vec2<f32>(1.0)));
    }
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let p = clamp(config.progress, 0.0, 1.0);
    let mode = config.transition_type;

    if (mode == 0u) {
        return transition_cross_dissolve(in.uv, p);
    } else if (mode >= 1u && mode <= 5u) {
        return transition_wipe(in.uv, p, mode, config.feather);
    } else if (mode == 6u) {
        return transition_iris_wipe(in.uv, p, config.feather, config.aspect_ratio);
    } else if (mode == 7u) {
        return transition_zoom_blur(in.uv, p, config.intensity);
    } else if (mode == 8u) {
        return transition_slide_push(in.uv, p);
    }

    return transition_cross_dissolve(in.uv, p);
}
