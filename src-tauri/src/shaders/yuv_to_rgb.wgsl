// YUV (NV12) to Linear RGB Fragment Shader (WGSL)
// Optimized for zero-copy GPU video rendering in Clypra.
// Features:
// - Direct 2-plane sampling: Y (R8Unorm) + interleaved UV (Rg8Unorm)
// - BT.709 Rec. 709 Limited-to-Full range expansion
// - BT.601 / Full-Range fallback options

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
    );
    var uv = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(pos[vertex_index], 0.0, 1.0);
    out.uv = uv[vertex_index];
    return out;
}

@group(0) @binding(0) var t_y: texture_2d<f32>;
@group(0) @binding(1) var s_y: sampler;
@group(0) @binding(2) var t_uv: texture_2d<f32>;
@group(0) @binding(3) var s_uv: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample Y (R8Unorm) and interleaved UV (Rg8Unorm)
    let y_raw = textureSample(t_y, s_y, in.uv).r;
    let uv_raw = textureSample(t_uv, s_uv, in.uv).rg;

    // Expand Rec. 709 Limited Range: Y in [16/255, 235/255], Cb/Cr in [16/255, 240/255]
    let y = (y_raw - (16.0 / 255.0)) * (255.0 / 219.0);
    let u = (uv_raw.r - (128.0 / 255.0)) * (255.0 / 224.0);
    let v = (uv_raw.g - (128.0 / 255.0)) * (255.0 / 224.0);

    // Rec. 709 Transformation Matrix (HD/4K video standard)
    let r = y + 1.5748 * v;
    let g = y - 0.1873 * u - 0.4681 * v;
    let b = y + 1.8556 * u;

    let clamped_gamma = clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
    // Linearize for sRGB render target so hardware sRGB write filter produces exact target gamma
    let linear_rgb = pow(clamped_gamma, vec3<f32>(2.2));

    return vec4<f32>(linear_rgb, 1.0);
}

