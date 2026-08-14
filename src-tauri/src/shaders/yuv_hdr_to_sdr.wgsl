// YUV (NV12 / P010 HDR) to Linear RGB & Tonemapping Fragment Shader (WGSL)
// Optimized for zero-copy GPU video rendering & HDR10/HLG color management in Clypra.
// Features:
// - Direct 2-plane sampling: Y (R8Unorm / R16Unorm) + interleaved UV (Rg8Unorm / Rg16Unorm)
// - BT.709, BT.2020 PQ (HDR10), BT.2020 HLG, BT.601 color spaces
// - Full range & Limited range YUV normalization
// - SMPTE ST 2084 (PQ) EOTF linearization (0..10,000 Nits)
// - BT.2020 to BT.709 linear gamut transformation
// - ACES Film & Reinhard Tonemapping operators
// - Rec. 709 OETF display gamma encoding

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
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
    out.tex_coords = uv[vertex_index];
    return out;
}

struct ColorUniforms {
    color_space: u32,       // 0: BT.709, 1: BT.2020 PQ, 2: BT.2020 HLG, 3: BT.601
    range: u32,             // 0: Limited, 1: Full
    tonemap_operator: u32,  // 0: None, 1: ACES Film, 2: Reinhard
    target_peak_nits: f32,  // Typically 100.0 for standard SDR
};

@group(0) @binding(0) var t_y: texture_2d<f32>;
@group(0) @binding(1) var s_y: sampler;
@group(0) @binding(2) var t_uv: texture_2d<f32>;
@group(0) @binding(3) var s_uv: sampler;
@group(0) @binding(4) var<uniform> config: ColorUniforms;

// --- EOTF & Transfer Functions ---

// SMPTE ST 2084 (PQ) EOTF: Normalized Signal [0..1] -> Absolute Luminance in Nits [0..10000]
fn pq_eotf(n: vec3<f32>) -> vec3<f32> {
    let m1 = 0.1593017578125;        // 2610 / 16384
    let m2 = 78.84375;              // (2523 / 4096) * 128
    let c1 = 0.8359375;             // 3424 / 4096
    let c2 = 18.8515625;            // (2413 / 4096) * 32
    let c3 = 18.6875;               // (2392 / 4096) * 32

    let np = pow(max(n, vec3<f32>(0.0)), vec3<f32>(1.0 / m2));
    let num = max(np - vec3<f32>(c1), vec3<f32>(0.0));
    let den = c2 - c3 * np;
    let linear = pow(num / max(den, vec3<f32>(1e-6)), vec3<f32>(1.0 / m1));
    return linear * 10000.0; // Scale to absolute nits
}

// BT.2020 Linear -> BT.709 Linear Gamut Conversion Matrix
fn bt2020_to_bt709_linear(c: vec3<f32>) -> vec3<f32> {
    let m = mat3x3<f32>(
         1.6605, -0.1246, -0.0182,
        -0.5876,  1.1329, -0.1006,
        -0.0728, -0.0083,  1.1187
    );
    return m * c;
}

// Narkowicz 2015 ACES Tone Mapping Fit
fn aces_film(x: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Inverse HLG (ARIB STD-B67) OETF: Non-linear signal [0..1] -> Scene linear light [0..12]
fn hlg_inverse_oetf(e: vec3<f32>) -> vec3<f32> {
    let a = 0.17883277;
    let b = 0.28466892; // 1.0 - 4.0 * a
    let c = 0.55991073; // 0.5 - a * ln(4.0 * a)

    var linear: vec3<f32>;
    for (var i = 0; i < 3; i++) {
        let val = e[i];
        if (val <= 0.5) {
            linear[i] = (val * val) / 3.0;
        } else {
            linear[i] = (exp((val - c) / a) + b) / 12.0;
        }
    }
    return linear;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let y_raw = textureSample(t_y, s_y, in.tex_coords).r;
    let uv_raw = textureSample(t_uv, s_uv, in.tex_coords).rg;

    // 1. Range Normalization
    var y: f32;
    var u: f32;
    var v: f32;

    if (config.range == 0u) {
        // Standard Limited Range (Y in [16..235], Cb/Cr in [16..240])
        y = (y_raw - (16.0 / 255.0)) * (255.0 / 219.0);
        u = (uv_raw.r - (128.0 / 255.0)) * (255.0 / 224.0);
        v = (uv_raw.g - (128.0 / 255.0)) * (255.0 / 224.0);
    } else {
        // Full Range
        y = y_raw;
        u = uv_raw.r - (128.0 / 255.0);
        v = uv_raw.g - (128.0 / 255.0);
    }

    var rgb_non_linear: vec3<f32>;

    // 2. YUV to Non-Linear RGB Matrix Conversion
    if (config.color_space == 1u || config.color_space == 2u) {
        // Rec. 2020 Matrix
        let r = y + 1.4746 * v;
        let g = y - 0.16455 * u - 0.57135 * v;
        let b = y + 1.8814 * u;
        rgb_non_linear = vec3<f32>(r, g, b);
    } else if (config.color_space == 3u) {
        // Rec. 601 Matrix (SD video)
        let r = y + 1.402 * v;
        let g = y - 0.344136 * u - 0.714136 * v;
        let b = y + 1.772 * u;
        rgb_non_linear = vec3<f32>(r, g, b);
    } else {
        // Rec. 709 Matrix (Default HD/SDR)
        let r = y + 1.5748 * v;
        let g = y - 0.1873 * u - 0.4681 * v;
        let b = y + 1.8556 * u;
        rgb_non_linear = vec3<f32>(r, g, b);
    }

    // 3. HDR Decoding & Tonemapping Pipeline
    var final_sdr_linear: vec3<f32>;

    if (config.color_space == 1u) {
        // --- BT.2020 PQ HDR Pipeline ---
        let linear_nits = pq_eotf(rgb_non_linear);
        let linear_709_nits = bt2020_to_bt709_linear(linear_nits);
        let peak_nits = max(config.target_peak_nits, 100.0);
        let normalized_hdr = max(linear_709_nits / peak_nits, vec3<f32>(0.0));

        if (config.tonemap_operator == 1u) {
            final_sdr_linear = aces_film(normalized_hdr);
        } else if (config.tonemap_operator == 2u) {
            final_sdr_linear = normalized_hdr / (vec3<f32>(1.0) + normalized_hdr);
        } else {
            final_sdr_linear = clamp(normalized_hdr, vec3<f32>(0.0), vec3<f32>(1.0));
        }
    } else if (config.color_space == 2u) {
        // --- BT.2020 HLG HDR Pipeline ---
        let linear_hlg = hlg_inverse_oetf(clamp(rgb_non_linear, vec3<f32>(0.0), vec3<f32>(1.0)));
        let linear_709_nits = bt2020_to_bt709_linear(linear_hlg * 1000.0);
        let peak_nits = max(config.target_peak_nits, 100.0);
        let normalized_hdr = max(linear_709_nits / peak_nits, vec3<f32>(0.0));
        final_sdr_linear = aces_film(normalized_hdr);
    } else {
        // --- Standard SDR Pipeline ---
        // Convert gamma-encoded signal to linear light so Rgba8UnormSrgb target converts it back cleanly
        let clamped = clamp(rgb_non_linear, vec3<f32>(0.0), vec3<f32>(1.0));
        final_sdr_linear = pow(clamped, vec3<f32>(2.2));
    }

    return vec4<f32>(final_sdr_linear, 1.0);
}

