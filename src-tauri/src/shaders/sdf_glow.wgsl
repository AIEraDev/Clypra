// sdf_glow.wgsl
//
// Primitive 3 — Glow From Distance
// Renders a soft Gaussian-falloff glow in the SDF exterior.
//
// The glow intensity follows an exponential decay from the glyph contour
// outward:  alpha(d) = exp(-d² / (2σ²))  where d is the signed distance
// beyond the threshold and σ = radius / sqrt(-2 * ln(cutoff_floor)).
//
// Uniforms (GlowUniforms):
//   threshold    : f32      — contour edge in normalised SDF [0..1]  (≈ 0.502)
//   radius       : f32      — glow half-radius in normalised SDF units
//   intensity    : f32      — peak glow opacity multiplier [0..1]
//   sdf_scale    : f32      — reciprocal of SDF radius (normalised→pixels)
//   color        : vec4<f32>— RGBA glow colour (linear sRGB)

struct GlowUniforms {
    threshold : f32,
    radius    : f32,
    intensity : f32,
    sdf_scale : f32,
    color     : vec4<f32>,
};

@group(0) @binding(0) var<uniform> params : GlowUniforms;
@group(0) @binding(1) var sdf_tex         : texture_2d<f32>;
@group(0) @binding(2) var sdf_sampler     : sampler;

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0)       uv  : vec2<f32>,
};

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
    out.uv.y = 1.0 - out.uv.y;
    return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    let sdf_raw = textureSample(sdf_tex, sdf_sampler, in.uv).r;

    // Exterior signed distance in normalised SDF units (positive = outside glyph)
    let dist_from_edge = (params.threshold - sdf_raw) * params.sdf_scale;

    // Only emit glow in the exterior region (dist_from_edge > 0)
    if dist_from_edge <= 0.0 {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    // Gaussian falloff: σ chosen so that alpha(radius) ≈ 0.007 (1/e³)
    // sigma = radius / sqrt(2 * ln(1 / 0.007)) ≈ radius / 3.0
    let sigma   = max(params.radius / 3.0, 0.0001);
    let sigma2  = sigma * sigma;
    let alpha   = exp(-(dist_from_edge * dist_from_edge) / (2.0 * sigma2));

    // Clamp to [0..radius] so the glow doesn't bleed past the SDF padding budget.
    let in_range_alpha = select(0.0, alpha, dist_from_edge < params.radius);

    let final_alpha = in_range_alpha * params.intensity * params.color.a;
    return vec4<f32>(params.color.rgb * final_alpha, final_alpha);
}
