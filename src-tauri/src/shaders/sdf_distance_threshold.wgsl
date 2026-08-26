// sdf_distance_threshold.wgsl
//
// Primitive 1 — Distance Threshold
// Converts an 8-bit SDF texture into an anti-aliased binary coverage mask (alpha).
//
// Uniforms (DistanceThresholdUniforms):
//   threshold   : f32  — SDF value that defines the contour edge [0..1].
//                        0.502 maps to the 128/255 ≈ 0.502 edge in our encoding.
//   smoothing   : f32  — AA feather half-width in SDF units [0..0.1].
//                        Larger values soften the edge; 0 gives a hard clip.
//   sdf_scale   : f32  — Reciprocal of the SDF radius in normalised [0..1] space.
//                        Converts raw SDF units to signed distance in pixels.
//   _pad        : f32  — alignment padding (unused).

struct DistanceThresholdUniforms {
    threshold : f32,
    smoothing : f32,
    sdf_scale : f32,
    _pad      : f32,
    color     : vec4<f32>,
};

@group(0) @binding(0) var<uniform> params : DistanceThresholdUniforms;
@group(0) @binding(1) var sdf_tex         : texture_2d<f32>;
@group(0) @binding(2) var sdf_sampler     : sampler;

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0)       uv  : vec2<f32>,
};

// Full-screen triangle (3 vertices, no vertex buffer needed)
var<private> QUAD_POSITIONS : array<vec2<f32>, 6> = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VertexOut {
    let p = QUAD_POSITIONS[vi];
    var out : VertexOut;
    out.pos = vec4<f32>(p, 0.0, 1.0);
    out.uv  = p * 0.5 + 0.5;
    out.uv.y = 1.0 - out.uv.y; // flip Y: texture origin is top-left
    return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    // SDF value in [0..1]: 0.502 ≈ contour edge (128/255)
    let sdf_raw = textureSample(sdf_tex, sdf_sampler, in.uv).r;

    // Convert [0..1] SDF to signed distance in the same normalised units.
    // Values > threshold are interior (positive dist), < threshold are exterior.
    let dist = (sdf_raw - params.threshold) * params.sdf_scale;

    // Smooth-step AA: ramp from 0→1 over ±smoothing around the contour.
    let half_w = max(params.smoothing, 0.0001);
    let alpha   = smoothstep(-half_w, half_w, dist) * params.color.a;

    return vec4<f32>(params.color.rgb * alpha, alpha);
}
