// sdf_outline.wgsl
//
// Primitive 2 — Outline From Distance
// Renders a coloured outline band in the SDF exterior, just beyond the glyph edge.
//
// The outline occupies the SDF range [threshold - width, threshold].
// Anti-aliased feathering is applied on both the inner and outer edges.
//
// Uniforms (OutlineUniforms):
//   threshold   : f32     — contour edge in normalised SDF [0..1]  (≈ 0.502)
//   width       : f32     — outline half-width in normalised SDF units
//   smoothing   : f32     — AA feather half-width
//   sdf_scale   : f32     — reciprocal of SDF radius (normalised→pixels)
//   color       : vec4<f32> — RGBA outline colour (linear sRGB, premultiplied)

struct OutlineUniforms {
    threshold : f32,
    width     : f32,
    smoothing : f32,
    sdf_scale : f32,
    color     : vec4<f32>,
};

@group(0) @binding(0) var<uniform> params : OutlineUniforms;
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

    // Signed distance in normalised SDF units (positive = interior)
    let dist = (sdf_raw - params.threshold) * params.sdf_scale;

    let half_w    = max(params.smoothing, 0.0001);
    let outer_sdf = params.threshold - params.width; // outer edge of the outline band

    // Inner edge: alpha 1 at the glyph contour, fade out into the glyph interior
    let inner_alpha = smoothstep(half_w, -half_w, dist);

    // Outer edge: alpha 1 at outer_sdf, fade out away from the glyph
    let outer_dist  = (sdf_raw - outer_sdf) * params.sdf_scale;
    let outer_alpha = smoothstep(-half_w, half_w, outer_dist);

    // Outline occupies the band between the two edges
    let outline_alpha = inner_alpha * outer_alpha * params.color.a;

    return vec4<f32>(params.color.rgb * outline_alpha, outline_alpha);
}
