// sdf_drop_shadow.wgsl
//
// Primitive 4 — Drop Shadow
// Renders a soft directional shadow by sampling the SDF at a UV offset
// corresponding to the shadow direction and distance.
//
// The SDF is sampled at `uv - offset` (shifted in the opposite direction
// the shadow falls so the shadow appears below/behind the glyph).  A
// Gaussian soft falloff is then applied in the exterior region of the
// shifted sample.
//
// Uniforms (DropShadowUniforms):
//   offset_x     : f32      — horizontal shadow shift in normalised UV  [0..1]
//   offset_y     : f32      — vertical shadow shift in normalised UV    [0..1]
//   threshold    : f32      — SDF contour edge (≈ 0.502)
//   radius       : f32      — softness radius in normalised SDF units
//   intensity    : f32      — peak shadow opacity multiplier [0..1]
//   sdf_scale    : f32      — reciprocal of SDF radius (normalised→pixels)
//   _pad0        : f32      — alignment
//   _pad1        : f32      — alignment
//   color        : vec4<f32>— RGBA shadow colour (linear sRGB; usually dark)

struct DropShadowUniforms {
    offset_x    : f32,
    offset_y    : f32,
    threshold   : f32,
    radius      : f32,
    intensity   : f32,
    sdf_scale   : f32,
    _pad0       : f32,
    _pad1       : f32,
    color       : vec4<f32>,
};

@group(0) @binding(0) var<uniform> params : DropShadowUniforms;
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
    // Sample the SDF at the shadow-shifted UV to get the glyph shape at offset
    let shifted_uv  = in.uv - vec2<f32>(params.offset_x, params.offset_y);
    let sdf_shifted = textureSample(sdf_tex, sdf_sampler, shifted_uv).r;

    // Exterior distance in the shifted frame (positive = outside the offset glyph)
    let dist_from_edge = (params.threshold - sdf_shifted) * params.sdf_scale;

    if dist_from_edge <= 0.0 {
        // We are inside the shifted glyph — shadow is fully solid here
        // (but will be composited beneath the glyph fill in the pass chain)
        let solid_alpha = params.intensity * params.color.a;
        return vec4<f32>(params.color.rgb * solid_alpha, solid_alpha);
    }

    // Gaussian soft-shadow falloff matching sdf_glow.wgsl
    let sigma  = max(params.radius / 3.0, 0.0001);
    let sigma2 = sigma * sigma;
    let alpha  = exp(-(dist_from_edge * dist_from_edge) / (2.0 * sigma2));

    let in_range_alpha = select(0.0, alpha, dist_from_edge < params.radius);
    let final_alpha    = in_range_alpha * params.intensity * params.color.a;

    return vec4<f32>(params.color.rgb * final_alpha, final_alpha);
}
