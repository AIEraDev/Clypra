use super::preview_capabilities::PreviewCapabilities;
use serde::{Deserialize, Serialize};
use wgpu::{Adapter, Device, DeviceType, Instance, Queue};

/// Detailed metadata about the active GPU adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectedGpuInfo {
    pub name: String,
    pub backend: String,
    pub device_type: String,
    pub vendor_id: u32,
    pub device_id: u32,
    pub is_discrete: bool,
    /// Backend-reported driver name. This is essential when comparing older
    /// Intel devices, where driver behavior varies by backend.
    pub driver: String,
    /// Backend-reported driver version/details, when exposed by the backend.
    pub driver_info: String,
    /// A CPU adapter is a software rasterizer (for example WARP on Windows).
    pub is_software_adapter: bool,
}

#[cfg(target_os = "windows")]
static SELECTED_DXGI_ADAPTER_INDEX: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(-1);

/// Query the DXGI adapter index that matches the active discrete wgpu GPU.
/// Used by FFmpeg D3D11VA hardware initialization to bind to the same physical adapter.
#[cfg(target_os = "windows")]
pub fn get_selected_dxgi_adapter_index() -> Option<u32> {
    let idx = SELECTED_DXGI_ADAPTER_INDEX.load(std::sync::atomic::Ordering::Relaxed);
    if idx >= 0 {
        Some(idx as u32)
    } else {
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DxgiLatchReasonCode {
    EnvVarDisabled,
    CapabilityUnavailable,
    UnsupportedFeature,
    ImportFailed,
    InvalidTexture,
    FormatUnsupportedP010,
    WrongArraySlice,
    DeviceLost,
    SurfaceCreationFailed,
    DimensionMismatch,
    NonD3d11Surface,
    DxgiDecodeFailed,
    NoCpuPlanes,
    AdminPolicy,
}

impl std::fmt::Display for DxgiLatchReasonCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EnvVarDisabled => write!(f, "env-var-disabled"),
            Self::CapabilityUnavailable => write!(f, "capability-unavailable"),
            Self::UnsupportedFeature => write!(f, "unsupported-feature"),
            Self::ImportFailed => write!(f, "import-failed"),
            Self::InvalidTexture => write!(f, "invalid-texture"),
            Self::FormatUnsupportedP010 => write!(f, "format-unsupported-p010"),
            Self::WrongArraySlice => write!(f, "wrong-array-slice"),
            Self::DeviceLost => write!(f, "device-lost"),
            Self::SurfaceCreationFailed => write!(f, "surface-creation-failed"),
            Self::DimensionMismatch => write!(f, "dimension-mismatch"),
            Self::NonD3d11Surface => write!(f, "non-d3d11-surface"),
            Self::DxgiDecodeFailed => write!(f, "dxgi-decode-failed"),
            Self::NoCpuPlanes => write!(f, "no-cpu-planes"),
            Self::AdminPolicy => write!(f, "admin-policy"),
        }
    }
}

fn reason_to_u8(reason: DxgiLatchReasonCode) -> u8 {
    match reason {
        DxgiLatchReasonCode::EnvVarDisabled => 1,
        DxgiLatchReasonCode::CapabilityUnavailable => 2,
        DxgiLatchReasonCode::UnsupportedFeature => 3,
        DxgiLatchReasonCode::ImportFailed => 4,
        DxgiLatchReasonCode::InvalidTexture => 5,
        DxgiLatchReasonCode::FormatUnsupportedP010 => 6,
        DxgiLatchReasonCode::WrongArraySlice => 7,
        DxgiLatchReasonCode::DeviceLost => 8,
        DxgiLatchReasonCode::SurfaceCreationFailed => 9,
        DxgiLatchReasonCode::DimensionMismatch => 10,
        DxgiLatchReasonCode::NonD3d11Surface => 11,
        DxgiLatchReasonCode::DxgiDecodeFailed => 12,
        DxgiLatchReasonCode::NoCpuPlanes => 13,
        DxgiLatchReasonCode::AdminPolicy => 14,
    }
}

#[allow(dead_code)]
fn u8_to_reason(val: u8) -> Option<DxgiLatchReasonCode> {
    match val {
        1 => Some(DxgiLatchReasonCode::EnvVarDisabled),
        2 => Some(DxgiLatchReasonCode::CapabilityUnavailable),
        3 => Some(DxgiLatchReasonCode::UnsupportedFeature),
        4 => Some(DxgiLatchReasonCode::ImportFailed),
        5 => Some(DxgiLatchReasonCode::InvalidTexture),
        6 => Some(DxgiLatchReasonCode::FormatUnsupportedP010),
        7 => Some(DxgiLatchReasonCode::WrongArraySlice),
        8 => Some(DxgiLatchReasonCode::DeviceLost),
        9 => Some(DxgiLatchReasonCode::SurfaceCreationFailed),
        10 => Some(DxgiLatchReasonCode::DimensionMismatch),
        11 => Some(DxgiLatchReasonCode::NonD3d11Surface),
        12 => Some(DxgiLatchReasonCode::DxgiDecodeFailed),
        13 => Some(DxgiLatchReasonCode::NoCpuPlanes),
        14 => Some(DxgiLatchReasonCode::AdminPolicy),
        _ => None,
    }
}

static DXGI_RUNTIME_DISABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

static DXGI_LATCH_REASON: std::sync::atomic::AtomicU8 =
    std::sync::atomic::AtomicU8::new(0);

/// Context captured at the moment the latch fires.
/// Stored in a Mutex so it can hold variable-length strings.
/// Populated once; only the first latch context is retained.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DxgiLatchContext {
    /// Codec name at latch time (e.g. "h264", "hevc", "av1").
    pub codec: Option<String>,
    /// Source bit depth at latch time (8, 10, 12).
    pub bit_depth: Option<u8>,
    /// Source width at latch time in pixels.
    pub source_width: Option<u32>,
    /// Source height at latch time in pixels.
    pub source_height: Option<u32>,
    /// HW device type (e.g. "d3d11va", "software").
    pub hw_device_type: Option<String>,
    /// Wall-clock ms when the latch fired.
    pub latched_at_ms: u64,
    /// "policy" = intentional (env-var, admin); "failure" = unexpected decode error.
    pub latch_kind: String,
}

static DXGI_LATCH_CONTEXT: std::sync::OnceLock<std::sync::Mutex<Option<DxgiLatchContext>>> =
    std::sync::OnceLock::new();

fn latch_context_lock() -> &'static std::sync::Mutex<Option<DxgiLatchContext>> {
    DXGI_LATCH_CONTEXT.get_or_init(|| std::sync::Mutex::new(None))
}

pub fn mark_dxgi_runtime_disabled_with_reason(reason: DxgiLatchReasonCode) {
    DXGI_RUNTIME_DISABLED.store(true, std::sync::atomic::Ordering::Relaxed);
    DXGI_LATCH_REASON.store(reason_to_u8(reason), std::sync::atomic::Ordering::Relaxed);
}

/// "policy" for intentional disables; "failure" for unexpected decode errors.
pub fn latch_kind_for(reason: DxgiLatchReasonCode) -> String {
    match reason {
        DxgiLatchReasonCode::EnvVarDisabled | DxgiLatchReasonCode::AdminPolicy => {
            "policy".to_string()
        }
        _ => "failure".to_string(),
    }
}

/// Extended variant: also stores per-frame context at the latch site.
/// Call this from decode paths that have codec/format/resolution available.
pub fn mark_dxgi_runtime_disabled_with_context(
    reason: DxgiLatchReasonCode,
    context: DxgiLatchContext,
) {
    DXGI_RUNTIME_DISABLED.store(true, std::sync::atomic::Ordering::Relaxed);
    DXGI_LATCH_REASON.store(reason_to_u8(reason), std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut guard) = latch_context_lock().lock() {
        // First-write-wins: preserve the context from the triggering failure.
        if guard.is_none() {
            *guard = Some(context);
        }
    }
}

pub fn mark_dxgi_runtime_disabled() {
    mark_dxgi_runtime_disabled_with_reason(DxgiLatchReasonCode::UnsupportedFeature);
}

/// Returns `(latched: Option<bool>, reason: Option<DxgiLatchReasonCode>, context: Option<DxgiLatchContext>)`.
/// `latched` is `None` on non-Windows (unknown state), `Some(false)` = active,
/// `Some(true)` = disabled.
///
/// In debug builds on any OS: if the global latch atomics have been set via
/// `force_dxgi_latch` or `mark_dxgi_runtime_disabled_with_*`, they are
/// returned even on macOS/Linux.  This enables end-to-end chain verification
/// (Rust → IPC → TypeScript → Worker → Neon) on a Mac without a Windows CI
/// job, and is the only supported path for pre-release 1.6.1 verification.
/// In release builds the non-Windows path always returns `(None, None, None)`.
pub fn get_dxgi_latch_state() -> (Option<bool>, Option<DxgiLatchReasonCode>, Option<DxgiLatchContext>) {
    // ── Debug builds: expose the latch state on all platforms ─────────────
    // This block runs first on every OS when debug_assertions is on, so a
    // developer on macOS can call force_dxgi_latch via the Tauri DevTools and
    // prove the full chain end-to-end without a Windows machine.
    #[cfg(debug_assertions)]
    {
        if DXGI_RUNTIME_DISABLED.load(std::sync::atomic::Ordering::Relaxed) {
            let code = DXGI_LATCH_REASON.load(std::sync::atomic::Ordering::Relaxed);
            let ctx = latch_context_lock().lock().ok().and_then(|g| g.clone());
            return (
                Some(true),
                u8_to_reason(code).or(Some(DxgiLatchReasonCode::UnsupportedFeature)),
                ctx,
            );
        }
        // Return Some(false) in debug on all platforms when not latched,
        // so callers can distinguish "not latched" from "not Windows".
        (Some(false), None, None)
    }
    // ── Production: Windows only ───────────────────────────────────────────
    #[cfg(all(not(debug_assertions), target_os = "windows"))]
    {
        if std::env::var("CLYPRA_DISABLE_DXGI").as_deref() == Ok("1")
            || std::env::var("CLYPRA_DISABLE_DXGI_ZERO_COPY").as_deref() == Ok("1")
        {
            return (Some(true), Some(DxgiLatchReasonCode::EnvVarDisabled), None);
        }
        if DXGI_RUNTIME_DISABLED.load(std::sync::atomic::Ordering::Relaxed) {
            let code = DXGI_LATCH_REASON.load(std::sync::atomic::Ordering::Relaxed);
            let ctx = latch_context_lock().lock().ok().and_then(|g| g.clone());
            return (
                Some(true),
                u8_to_reason(code).or(Some(DxgiLatchReasonCode::UnsupportedFeature)),
                ctx,
            );
        }
        return (Some(false), None, None);
    }
    // ── Production non-Windows: state is unknown ──────────────────────────
    #[cfg(all(not(debug_assertions), not(target_os = "windows")))]
    {
        (None, None, None)
    }
}

pub fn reset_dxgi_latch_state_for_tests() {
    DXGI_RUNTIME_DISABLED.store(false, std::sync::atomic::Ordering::Relaxed);
    DXGI_LATCH_REASON.store(0, std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut guard) = latch_context_lock().lock() {
        *guard = None;
    }
}

/// Parse a kebab-case reason string back into the enum.
/// Returns `None` for any unrecognised string.
/// Used by the debug `force_dxgi_latch` command and round-trip tests.
pub fn parse_dxgi_latch_reason(s: &str) -> Option<DxgiLatchReasonCode> {
    match s {
        "env-var-disabled"       => Some(DxgiLatchReasonCode::EnvVarDisabled),
        "capability-unavailable" => Some(DxgiLatchReasonCode::CapabilityUnavailable),
        "unsupported-feature"    => Some(DxgiLatchReasonCode::UnsupportedFeature),
        "import-failed"          => Some(DxgiLatchReasonCode::ImportFailed),
        "invalid-texture"        => Some(DxgiLatchReasonCode::InvalidTexture),
        "format-unsupported-p010"=> Some(DxgiLatchReasonCode::FormatUnsupportedP010),
        "wrong-array-slice"      => Some(DxgiLatchReasonCode::WrongArraySlice),
        "device-lost"            => Some(DxgiLatchReasonCode::DeviceLost),
        "surface-creation-failed"=> Some(DxgiLatchReasonCode::SurfaceCreationFailed),
        "dimension-mismatch"     => Some(DxgiLatchReasonCode::DimensionMismatch),
        "non-d3d11-surface"      => Some(DxgiLatchReasonCode::NonD3d11Surface),
        "dxgi-decode-failed"     => Some(DxgiLatchReasonCode::DxgiDecodeFailed),
        "no-cpu-planes"          => Some(DxgiLatchReasonCode::NoCpuPlanes),
        "admin-policy"           => Some(DxgiLatchReasonCode::AdminPolicy),
        _                        => None,
    }
}

pub fn is_dxgi_runtime_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        if std::env::var("CLYPRA_DISABLE_DXGI").as_deref() == Ok("1")
            || std::env::var("CLYPRA_DISABLE_DXGI_ZERO_COPY").as_deref() == Ok("1")
        {
            return false;
        }
        !DXGI_RUNTIME_DISABLED.load(std::sync::atomic::Ordering::Relaxed)
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub struct GpuContext {
    pub instance: Instance,
    pub adapter: Adapter,
    pub info: SelectedGpuInfo,
    pub capabilities: PreviewCapabilities,
    pub device: Device,
    pub queue: Queue,
    pub nv12_supported: bool,
    pub dxgi_adapter_index: Option<u32>,
}

impl GpuContext {
    /// Enumerates and scores all available graphics adapters to select the
    /// optimal device, then initializes its Device and Queue.
    ///
    /// This deliberately does not accept a `Surface`. Adapter/device discovery
    /// may run on a worker, while a native surface must be created on the UI
    /// thread (notably, CAMetalLayer creation on macOS). Surface compatibility
    /// is negotiated later by `native_surface::configure_surface`, which is
    /// always dispatched with `run_on_main_thread`.
    pub async fn select_best_gpu(instance: &Instance) -> Result<Self, String> {
        // enumerate_adapters is not available on wasm32 (no enumeration API in
        // the browser sandbox). The WASM crate uses init_gpu() directly and
        // never calls select_best_gpu on that target, but the function must
        // still compile. Guard the native-only path.
        #[cfg(not(target_arch = "wasm32"))]
        let best_adapter = {
            let adapters = instance.enumerate_adapters(wgpu::Backends::all());
            if !adapters.is_empty() {
                // Score adapters: Prioritize Discrete GPUs (1000), then Integrated (200), penalize CPU/Virtual
                let mut scored_adapters: Vec<(u32, Adapter)> = adapters
                    .into_iter()
                    .map(|adapter| {
                        let info = adapter.get_info();
                        #[allow(unused_mut)]
                        let mut score = match info.device_type {
                            DeviceType::DiscreteGpu => 1000,
                            DeviceType::IntegratedGpu => 200,
                            DeviceType::VirtualGpu => 50,
                            DeviceType::Cpu => 10,
                            DeviceType::Other => 0,
                        };
                        #[cfg(target_os = "windows")]
                        if info.backend == wgpu::Backend::Dx12 {
                            // Boost DX12 backend on Windows so D3D11VA DXGI shared texture import succeeds
                            score += 500;
                        }
                        (score, adapter)
                    })
                    .collect();

                scored_adapters.sort_by_key(|b| std::cmp::Reverse(b.0));
                scored_adapters.remove(0).1
            } else {
                // Fallback to request_adapter if enumerate_adapters returns empty on some platforms
                if let Some(adapter) = instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::HighPerformance,
                        compatible_surface: None,
                        force_fallback_adapter: false,
                    })
                    .await
                {
                    adapter
                } else if let Some(adapter) = instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::LowPower,
                        compatible_surface: None,
                        force_fallback_adapter: false,
                    })
                    .await
                {
                    adapter
                } else if let Some(adapter) = instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::None,
                        compatible_surface: None,
                        force_fallback_adapter: true,
                    })
                    .await
                {
                    adapter
                } else {
                    instance
                        .enumerate_adapters(wgpu::Backends::all())
                        .into_iter()
                        .next()
                        .ok_or_else(|| {
                            "No compatible graphics adapters or software rasterizers found."
                                .to_string()
                        })?
                }
            }
        };

        // On wasm32 we fall back to a simple request_adapter — select_best_gpu
        // is not the primary path (init_gpu() in clypra-render-wasm is), but
        // we need this to compile.
        #[cfg(target_arch = "wasm32")]
        let best_adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| "No WebGPU adapter found".to_string())?;

        let info = best_adapter.get_info();
        let is_discrete = info.device_type == DeviceType::DiscreteGpu;

        let gpu_info = SelectedGpuInfo {
            name: info.name.clone(),
            backend: format!("{:?}", info.backend),
            device_type: format!("{:?}", info.device_type),
            vendor_id: info.vendor,
            device_id: info.device,
            is_discrete,
            driver: info.driver.clone(),
            driver_info: info.driver_info.clone(),
            is_software_adapter: info.device_type == DeviceType::Cpu,
        };

        log::info!(
            "🎮 Bound Clypra Media Engine to: {} ({:?}, Backend: {:?}, Driver: {} {}, Software: {})",
            gpu_info.name,
            gpu_info.device_type,
            gpu_info.backend,
            gpu_info.driver,
            gpu_info.driver_info,
            gpu_info.is_software_adapter,
        );

        let available_features = best_adapter.features();
        let mut required_features = wgpu::Features::empty();
        if available_features.contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM) {
            required_features |= wgpu::Features::TEXTURE_FORMAT_16BIT_NORM;
        }
        if available_features.contains(wgpu::Features::TEXTURE_FORMAT_NV12) {
            required_features |= wgpu::Features::TEXTURE_FORMAT_NV12;
        }

        let (device, queue) = best_adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Native Wgpu Device"),
                    required_features,
                    required_limits: best_adapter.limits(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| format!("Failed to request wgpu device: {}", e))?;

        let nv12_supported = device
            .features()
            .contains(wgpu::Features::TEXTURE_FORMAT_NV12);
        let capabilities = PreviewCapabilities::probe(&best_adapter, &device);

        log::info!(
            "🚀 Negotiated Preview Capabilities: NV12={}, DXGI ZeroCopy={}, HW Decode={}, Native Surface={}, HDR={}",
            capabilities.wgpu_nv12,
            capabilities.dxgi_import,
            capabilities.hw_decode,
            capabilities.native_surface,
            capabilities.hdr,
        );

        #[allow(unused_mut)]
        let mut dxgi_adapter_index = None;
        #[cfg(target_os = "windows")]
        if info.backend == wgpu::Backend::Dx12 {
            use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
            if let Ok(factory) = unsafe { CreateDXGIFactory1::<IDXGIFactory1>() } {
                let mut i = 0u32;
                while let Ok(dxgi_adapter) = unsafe { factory.EnumAdapters1(i) } {
                    if let Ok(desc) = unsafe { dxgi_adapter.GetDesc1() } {
                        if desc.VendorId == info.vendor && desc.DeviceId == info.device {
                            SELECTED_DXGI_ADAPTER_INDEX
                                .store(i as i32, std::sync::atomic::Ordering::Relaxed);
                            dxgi_adapter_index = Some(i);
                            log::info!(
                                "🔗 [adapter_selector] Matched wgpu DX12 adapter '{}' to DXGI adapter index {}",
                                info.name,
                                i
                            );
                            break;
                        }
                    }
                    i += 1;
                }
            }
        }

        Ok(Self {
            instance: instance.clone(),
            adapter: best_adapter,
            info: gpu_info,
            capabilities,
            device,
            queue,
            nv12_supported,
            dxgi_adapter_index,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Guard that serializes all tests that read/write the global DXGI latch atomics.
    /// Without this, parallel `cargo test` runs can see stale state from other tests.
    static LATCH_MUTEX: std::sync::OnceLock<std::sync::Mutex<()>> =
        std::sync::OnceLock::new();
    fn latch_lock<'a>() -> std::sync::MutexGuard<'a, ()> {
        LATCH_MUTEX
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn parse_dxgi_latch_reason_round_trips_all_14_codes() {
        let _guard = latch_lock();
        let variants = [
            DxgiLatchReasonCode::EnvVarDisabled,
            DxgiLatchReasonCode::CapabilityUnavailable,
            DxgiLatchReasonCode::UnsupportedFeature,
            DxgiLatchReasonCode::ImportFailed,
            DxgiLatchReasonCode::InvalidTexture,
            DxgiLatchReasonCode::FormatUnsupportedP010,
            DxgiLatchReasonCode::WrongArraySlice,
            DxgiLatchReasonCode::DeviceLost,
            DxgiLatchReasonCode::SurfaceCreationFailed,
            DxgiLatchReasonCode::DimensionMismatch,
            DxgiLatchReasonCode::NonD3d11Surface,
            DxgiLatchReasonCode::DxgiDecodeFailed,
            DxgiLatchReasonCode::NoCpuPlanes,
            DxgiLatchReasonCode::AdminPolicy,
        ];
        for variant in &variants {
            let s = variant.to_string();
            let parsed = parse_dxgi_latch_reason(&s)
                .unwrap_or_else(|| panic!("parse_dxgi_latch_reason failed for '{s}'"));
            assert_eq!(parsed, *variant, "round-trip failed for {s}");
        }
        // Unknown string should return None, not panic.
        assert!(parse_dxgi_latch_reason("unknown-future-code").is_none());
    }

    /// Sync-check: the Display strings of all 14 variants must exactly match
    /// the `rustVariants` array in `src/lib/platform/dxgi-latch-codes.json`.
    ///
    /// If this test fails, either the Rust enum's Display impl or the JSON
    /// file was updated without updating the other.  Fix both, then re-run.
    #[test]
    fn display_strings_match_json_source_of_truth() {
        let _guard = latch_lock();
        // The JSON lives at src/lib/platform/dxgi-latch-codes.json relative
        // to the workspace root.  include_str! resolves relative to this
        // source file, so we go up to the workspace root.
        const JSON_SRC: &str = include_str!(
            "../../../src/lib/platform/dxgi-latch-codes.json"
        );

        // Minimal JSON parsing — extract the rustVariants array.
        // We avoid pulling in a full JSON crate just for this test.
        // The format is known and stable (generated by us), so simple extraction
        // is safe here.
        let variants_section = JSON_SRC
            .split("\"rustVariants\"")
            .nth(1)
            .expect("rustVariants key not found in JSON");
        let array_content = variants_section
            .trim_start_matches(':')
            .trim()
            .trim_start_matches('[')
            .split(']')
            .next()
            .expect("rustVariants array not terminated");

        let json_codes: Vec<&str> = array_content
            .split(',')
            .map(|s| s.trim().trim_matches('"').trim())
            .filter(|s| !s.is_empty())
            .collect();

        let rust_codes = [
            DxgiLatchReasonCode::EnvVarDisabled,
            DxgiLatchReasonCode::CapabilityUnavailable,
            DxgiLatchReasonCode::UnsupportedFeature,
            DxgiLatchReasonCode::ImportFailed,
            DxgiLatchReasonCode::InvalidTexture,
            DxgiLatchReasonCode::FormatUnsupportedP010,
            DxgiLatchReasonCode::WrongArraySlice,
            DxgiLatchReasonCode::DeviceLost,
            DxgiLatchReasonCode::SurfaceCreationFailed,
            DxgiLatchReasonCode::DimensionMismatch,
            DxgiLatchReasonCode::NonD3d11Surface,
            DxgiLatchReasonCode::DxgiDecodeFailed,
            DxgiLatchReasonCode::NoCpuPlanes,
            DxgiLatchReasonCode::AdminPolicy,
        ];

        assert_eq!(
            rust_codes.len(),
            json_codes.len(),
            "Rust has {} variants but JSON has {} — update the JSON or the enum",
            rust_codes.len(),
            json_codes.len()
        );

        for (i, (variant, &json_code)) in rust_codes.iter().zip(json_codes.iter()).enumerate() {
            let display = variant.to_string();
            assert_eq!(
                display, json_code,
                "Variant #{i}: Rust Display '{display}' != JSON '{json_code}'"
            );
        }
    }

    /// In debug builds the latch state is visible on all platforms so the
    /// end-to-end chain can be verified on macOS.
    #[test]
    fn debug_latch_state_visible_on_all_platforms() {
        let _guard = latch_lock();
        reset_dxgi_latch_state_for_tests();

        // Before any latch: debug builds always return Some(false).
        let (latched, reason, ctx) = get_dxgi_latch_state();
        #[cfg(debug_assertions)]
        {
            assert_eq!(latched, Some(false), "debug: pre-latch should be Some(false) on all OS");
            assert!(reason.is_none(), "debug: no reason before latch");
            assert!(ctx.is_none());
        }

        // Force a latch.
        mark_dxgi_runtime_disabled_with_context(
            DxgiLatchReasonCode::DxgiDecodeFailed,
            DxgiLatchContext {
                codec: Some("h264".to_string()),
                bit_depth: Some(8),
                source_width: Some(1920),
                source_height: Some(1080),
                hw_device_type: Some("d3d11va".to_string()),
                latched_at_ms: 0,
                latch_kind: "failure".to_string(),
            },
        );

        let (latched2, reason2, ctx2) = get_dxgi_latch_state();
        #[cfg(debug_assertions)]
        {
            assert_eq!(latched2, Some(true), "debug: post-latch should be Some(true)");
            assert_eq!(
                reason2.map(|r| r.to_string()).as_deref(),
                Some("dxgi-decode-failed"),
            );
            let c = ctx2.expect("debug: context should be populated");
            assert_eq!(c.codec.as_deref(), Some("h264"));
            assert_eq!(c.latch_kind, "failure");
        }
        // In release builds on non-Windows the state remains None.
        #[cfg(all(not(debug_assertions), not(target_os = "windows")))]
        {
            assert_eq!(latched2, None);
        }

        reset_dxgi_latch_state_for_tests();
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[tokio::test]
    async fn test_adapter_selection_scoring() {
        let instance = Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });

        let result = GpuContext::select_best_gpu(&instance).await;
        if let Ok(gpu_ctx) = result {
            assert!(!gpu_ctx.info.name.is_empty(), "GPU name must not be empty");
            println!(
                "Selected GPU: {} | Backend: {} | Type: {}",
                gpu_ctx.info.name, gpu_ctx.info.backend, gpu_ctx.info.device_type
            );
        }
    }
}
