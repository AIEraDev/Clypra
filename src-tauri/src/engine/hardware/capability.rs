//! Hardware Capability Profiling
//!
//! This module classifies the host machine into a [`CapabilityTier`] at startup
//! and produces a [`HardwareCapabilityProfile`] that the engine uses to select
//! appropriate initial QoS thresholds, decode budgets, and fallback policies —
//! all *without* requiring a live benchmark run.
//!
//! # Tier classification heuristics
//!
//! | Tier         | Criteria                                                        |
//! |------------- |-----------------------------------------------------------------|
//! | `Constrained`| VRAM < 1 GiB, **or** Intel HD/UHD (legacy) with VRAM < 2 GiB  |
//! | `Moderate`   | VRAM in [1 GiB, 4 GiB)                                         |
//! | `HighEnd`    | VRAM ≥ 4 GiB                                                    |
//!
//! The thresholds are conservative on purpose: it is always safer to start at a
//! lower quality tier and ramp up than to over-commit and drop frames on launch.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Capability tier
// ---------------------------------------------------------------------------

/// Capability tier assigned to this machine at startup.
///
/// The tier influences the initial QoS configuration, pre-roll buffer sizes,
/// and effect-graph evaluation policy before the first real benchmark window
/// has been collected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapabilityTier {
    /// Integrated GPU with < 1 GiB VRAM, or a known-slow Intel HD/UHD model
    /// (e.g. HD 5xx, HD 6xx, UHD 617/620/630) with VRAM < 2 GiB. These
    /// adapters typically cannot sustain 60 fps HEVC Main10 4 K decode in
    /// hardware without stutter.
    Constrained,
    /// Discrete or mid-range integrated GPU with 1–4 GiB VRAM. Capable of
    /// hardware HEVC/H.264 decode at 1080p–4 K but may need headroom for
    /// complex effect graphs.
    Moderate,
    /// Dedicated GPU with ≥ 4 GiB VRAM. Expected to handle 4 K 60 fps
    /// HEVC Main10 and AV1 decode without quality degradation under typical
    /// editor workloads.
    HighEnd,
}

// ---------------------------------------------------------------------------
// Recommended QoS configuration
// ---------------------------------------------------------------------------

/// QoS window thresholds tuned per hardware capability tier.
///
/// These values seed the [`QoSController`] before any live window data is
/// available.  Once the first benchmark window completes the controller may
/// adapt further.
///
/// [`QoSController`]: crate::engine::qos::QoSController
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendedQoSConfig {
    /// Number of consecutive *unhealthy* windows required to trigger a quality
    /// downgrade.  Lower values react faster; higher values avoid thrashing on
    /// brief spikes.
    pub degrade_window_threshold: usize,

    /// Number of consecutive *healthy* windows required before the controller
    /// attempts a quality upgrade.  Should be larger than
    /// `degrade_window_threshold` to bias toward stability.
    pub recover_window_threshold: usize,

    /// Target frame interval in microseconds used by the bottleneck detector
    /// when classifying decode vs render pressure.  16 667 µs corresponds to
    /// the 60 fps deadline.
    pub target_frame_interval_us: u64,
}

// ---------------------------------------------------------------------------
// Hardware capability profile
// ---------------------------------------------------------------------------

/// Full machine capability profile computed **once at startup** from GPU
/// enumeration data.
///
/// This struct is cheap to clone and is intended to be stored inside the
/// engine's shared state so that any subsystem can consult it without
/// re-probing hardware.
///
/// # Example
///
/// ```rust,ignore
/// let profile = probe_hardware_capability(
///     4 * 1024 * 1024 * 1024,
///     "NVIDIA",
///     "GeForce RTX 3070",
///     true,
///     true,
/// );
/// assert_eq!(profile.tier, CapabilityTier::HighEnd);
/// assert_eq!(profile.hevc10_decode_budget_us, Some(16_667));
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareCapabilityProfile {
    /// Broad capability tier used for policy selection.
    pub tier: CapabilityTier,

    /// Dedicated video RAM reported by the adapter driver, in bytes.
    /// Shared-system-memory adapters typically report 0 or a small value.
    pub vram_bytes: u64,

    /// GPU vendor string as reported by the driver (e.g. `"Intel"`, `"NVIDIA"`,
    /// `"AMD"`).
    pub gpu_vendor: String,

    /// GPU model/marketing name (e.g. `"UHD Graphics 630"`, `"RTX 3070"`).
    pub gpu_model: String,

    /// Estimated single-frame HEVC Main10 decode budget at 60 fps, in
    /// microseconds.  Derived from aggregate telemetry across real devices;
    /// `None` only when the tier cannot be determined.
    ///
    /// | Tier         | Budget (µs) | Reasoning                            |
    /// |--------------|-------------|--------------------------------------|
    /// | `HighEnd`    | 16 667      | Full 60 fps frame deadline           |
    /// | `Moderate`   | 25 000      | ~40 fps equivalent headroom          |
    /// | `Constrained`| 55 000      | ~18 fps headroom for proxy fallback  |
    pub hevc10_decode_budget_us: Option<u64>,

    /// Whether hardware H.265/HEVC decode is available on this adapter.
    pub has_hw_hevc: bool,

    /// Whether hardware AV1 decode is available on this adapter.
    pub has_hw_av1: bool,

    /// Recommended initial QoS thresholds for this tier.
    pub recommended_qos_config: RecommendedQoSConfig,
}

// ---------------------------------------------------------------------------
// Probe function
// ---------------------------------------------------------------------------

/// Classifies the host GPU into a [`CapabilityTier`] and returns a fully
/// populated [`HardwareCapabilityProfile`] ready for use by the engine.
///
/// This function is **pure** (no I/O, no system calls) — all inputs come from
/// the caller's earlier hardware enumeration step (e.g. via
/// [`GpuAdapterIdentity::probe`]).  That separation keeps the capability logic
/// trivially testable.
///
/// # Arguments
///
/// * `vram_bytes` – Dedicated video memory in bytes as reported by the driver.
/// * `gpu_vendor` – Vendor string from the driver (case-insensitive matching
///   used internally).
/// * `gpu_model`  – Model/marketing name from the driver.
/// * `has_hw_hevc`– Whether the adapter exposes a hardware HEVC decoder.
/// * `has_hw_av1` – Whether the adapter exposes a hardware AV1 decoder.
///
/// # Tier assignment rules
///
/// 1. **`Constrained`** if any of:
///    - `vram_bytes < 1 GiB` (1 073 741 824 bytes), or
///    - vendor contains `"Intel"` **and** the model contains one of the known
///      legacy suffixes (`"HD Graphics"`, `"HD 5"`, `"HD 6"`, `"UHD 617"`,
///      `"UHD 620"`, `"UHD 630"`) **and** `vram_bytes < 2 GiB`.
/// 2. **`Moderate`** if `vram_bytes < 4 GiB` (4 294 967 296 bytes).
/// 3. **`HighEnd`** otherwise.
///
/// [`GpuAdapterIdentity::probe`]: crate::engine::hardware::GpuAdapterIdentity::probe
pub fn probe_hardware_capability(
    vram_bytes: u64,
    gpu_vendor: &str,
    gpu_model: &str,
    has_hw_hevc: bool,
    has_hw_av1: bool,
) -> HardwareCapabilityProfile {
    const ONE_GIB: u64 = 1_073_741_824;
    const TWO_GIB: u64 = 2_147_483_648;
    const FOUR_GIB: u64 = 4_294_967_296;

    /// Model name substrings that identify known-slow Intel integrated GPUs
    /// whose hardware decode pipeline struggles with HEVC Main10 at high
    /// frame rates.
    const CONSTRAINED_INTEL_MODELS: &[&str] = &[
        "HD Graphics",
        "HD 5",
        "HD 6",
        "UHD 617",
        "UHD 620",
        "UHD 630",
    ];

    // Adapter APIs do not normalize vendor/model casing consistently across
    // DXGI, Vulkan, Metal, and software fallbacks. Classifying case
    // sensitively promoted some lower-end Windows Intel adapters to a more
    // expensive policy simply because their driver reported `intel`.
    let normalized_vendor = gpu_vendor.to_ascii_lowercase();
    let normalized_model = gpu_model.to_ascii_lowercase();
    let is_constrained_intel = normalized_vendor.contains("intel")
        && CONSTRAINED_INTEL_MODELS
            .iter()
            .any(|model| normalized_model.contains(&model.to_ascii_lowercase()))
        && vram_bytes < TWO_GIB;

    // Apple Silicon uses unified memory, so `dedicated_video_memory` is
    // commonly reported as zero. Treating that as a sub-1 GiB discrete GPU
    // incorrectly selects the constrained QoS policy on capable M-series
    // machines. Hardware HEVC support is the reliable capability signal here.
    let is_apple_silicon = normalized_vendor.contains("apple") && has_hw_hevc;

    let tier = if is_apple_silicon {
        // Unified memory is not a tiny dedicated-VRAM budget. M-series
        // VideoToolbox + Metal starts at full quality; measured QoS remains
        // free to reduce quality when the actual project needs it.
        CapabilityTier::HighEnd
    } else if vram_bytes < ONE_GIB || is_constrained_intel {
        CapabilityTier::Constrained
    } else if vram_bytes < FOUR_GIB {
        CapabilityTier::Moderate
    } else {
        CapabilityTier::HighEnd
    };

    let hevc10_decode_budget_us = Some(match tier {
        CapabilityTier::HighEnd => 16_667,
        CapabilityTier::Moderate => 25_000,
        CapabilityTier::Constrained => 55_000,
    });

    let recommended_qos_config = match tier {
        CapabilityTier::Constrained => RecommendedQoSConfig {
            degrade_window_threshold: 2,
            recover_window_threshold: 12,
            target_frame_interval_us: 16_667,
        },
        CapabilityTier::Moderate => RecommendedQoSConfig {
            degrade_window_threshold: 3,
            recover_window_threshold: 8,
            target_frame_interval_us: 16_667,
        },
        CapabilityTier::HighEnd => RecommendedQoSConfig {
            degrade_window_threshold: 5,
            recover_window_threshold: 6,
            target_frame_interval_us: 16_667,
        },
    };

    HardwareCapabilityProfile {
        tier,
        vram_bytes,
        gpu_vendor: gpu_vendor.to_string(),
        gpu_model: gpu_model.to_string(),
        hevc10_decode_budget_us,
        has_hw_hevc,
        has_hw_av1,
        recommended_qos_config,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Constrained tier — Intel HD / UHD legacy detection
    // -----------------------------------------------------------------------

    #[test]
    fn constrained_intel_hd_graphics_below_2gib() {
        // Classic "Intel HD Graphics" iGPU shipped on 6th-gen Core processors.
        // 512 MiB VRAM, no HW codecs — must be Constrained.
        let profile = probe_hardware_capability(
            512 * 1024 * 1024,
            "Intel",
            "Intel HD Graphics 520",
            false,
            false,
        );
        assert_eq!(profile.tier, CapabilityTier::Constrained);
        assert_eq!(profile.hevc10_decode_budget_us, Some(55_000));
        assert_eq!(profile.recommended_qos_config.degrade_window_threshold, 2);
        assert_eq!(profile.recommended_qos_config.recover_window_threshold, 12);
    }

    #[test]
    fn constrained_intel_uhd_620_below_2gib() {
        // UHD 620 is explicitly listed as a constrained Intel model.
        let profile = probe_hardware_capability(
            1 * 1024 * 1024 * 1024, // 1 GiB — above the generic <1GiB threshold
            "Intel Corporation",
            "Intel UHD Graphics 620",
            true,
            false,
        );
        // Even with 1 GiB VRAM it should be Constrained due to Intel UHD 620 match.
        assert_eq!(profile.tier, CapabilityTier::Constrained);
        assert_eq!(profile.hevc10_decode_budget_us, Some(55_000));
    }

    #[test]
    fn constrained_uhd_630_exactly_at_2gib_boundary_is_moderate() {
        // At exactly 2 GiB the constrained-Intel guard no longer fires,
        // so the GPU falls into Moderate (VRAM in [1 GiB, 4 GiB)).
        let profile = probe_hardware_capability(
            2 * 1024 * 1024 * 1024,
            "Intel",
            "Intel UHD Graphics 630",
            true,
            false,
        );
        assert_eq!(profile.tier, CapabilityTier::Moderate);
    }

    #[test]
    fn constrained_intel_detection_is_case_insensitive_for_windows_drivers() {
        let profile = probe_hardware_capability(
            1 * 1024 * 1024 * 1024,
            "intel",
            "intel(r) uhd graphics 620",
            true,
            false,
        );
        assert_eq!(profile.tier, CapabilityTier::Constrained);
    }

    #[test]
    fn constrained_vram_below_1gib_any_vendor() {
        // Any GPU with < 1 GiB dedicated VRAM is Constrained regardless of vendor.
        let profile =
            probe_hardware_capability(256 * 1024 * 1024, "AMD", "Radeon Vega 3", false, false);
        assert_eq!(profile.tier, CapabilityTier::Constrained);
        assert!(!profile.has_hw_hevc);
        assert!(!profile.has_hw_av1);
    }

    // -----------------------------------------------------------------------
    // Moderate tier
    // -----------------------------------------------------------------------

    #[test]
    fn moderate_tier_2gib_nvidia() {
        let profile = probe_hardware_capability(
            2 * 1024 * 1024 * 1024,
            "NVIDIA",
            "GeForce GTX 1050",
            true,
            false,
        );
        assert_eq!(profile.tier, CapabilityTier::Moderate);
        assert_eq!(profile.hevc10_decode_budget_us, Some(25_000));
        assert_eq!(profile.recommended_qos_config.degrade_window_threshold, 3);
        assert_eq!(profile.recommended_qos_config.recover_window_threshold, 8);
    }

    #[test]
    fn moderate_tier_just_below_4gib() {
        // 4 GiB − 1 byte: still Moderate.
        let profile =
            probe_hardware_capability(4_294_967_295, "AMD", "Radeon RX 580 4G", true, false);
        assert_eq!(profile.tier, CapabilityTier::Moderate);
    }

    // -----------------------------------------------------------------------
    // HighEnd tier
    // -----------------------------------------------------------------------

    #[test]
    fn high_end_tier_rtx_3070_8gib() {
        let profile = probe_hardware_capability(
            8 * 1024 * 1024 * 1024,
            "NVIDIA",
            "GeForce RTX 3070",
            true,
            true,
        );
        assert_eq!(profile.tier, CapabilityTier::HighEnd);
        assert_eq!(profile.hevc10_decode_budget_us, Some(16_667));
        assert_eq!(profile.recommended_qos_config.degrade_window_threshold, 5);
        assert_eq!(profile.recommended_qos_config.recover_window_threshold, 6);
        assert!(profile.has_hw_hevc);
        assert!(profile.has_hw_av1);
    }

    #[test]
    fn high_end_tier_exactly_4gib() {
        // The boundary: exactly 4 GiB → HighEnd.
        let profile =
            probe_hardware_capability(4_294_967_296, "AMD", "Radeon RX 6700 XT", true, false);
        assert_eq!(profile.tier, CapabilityTier::HighEnd);
        assert_eq!(profile.hevc10_decode_budget_us, Some(16_667));
    }

    #[test]
    fn apple_silicon_with_unified_memory_is_not_constrained() {
        let profile = probe_hardware_capability(0, "Apple", "Apple M1", true, false);
        assert_eq!(profile.tier, CapabilityTier::HighEnd);
    }

    // -----------------------------------------------------------------------
    // Field passthrough correctness
    // -----------------------------------------------------------------------

    #[test]
    fn profile_fields_are_passed_through_correctly() {
        let profile = probe_hardware_capability(
            6 * 1024 * 1024 * 1024,
            "NVIDIA",
            "GeForce RTX 4060",
            true,
            true,
        );
        assert_eq!(profile.gpu_vendor, "NVIDIA");
        assert_eq!(profile.gpu_model, "GeForce RTX 4060");
        assert_eq!(profile.vram_bytes, 6 * 1024 * 1024 * 1024);
        assert_eq!(
            profile.recommended_qos_config.target_frame_interval_us,
            16_667
        );
    }

    // -----------------------------------------------------------------------
    // target_frame_interval_us is always 16_667
    // -----------------------------------------------------------------------

    #[test]
    fn target_frame_interval_is_consistent_across_all_tiers() {
        for (vram, vendor, model) in [
            (256u64 * 1024 * 1024, "AMD", "Vega 3"),
            (2u64 * 1024 * 1024 * 1024, "NVIDIA", "GTX 1050"),
            (8u64 * 1024 * 1024 * 1024, "NVIDIA", "RTX 3070"),
        ] {
            let p = probe_hardware_capability(vram, vendor, model, false, false);
            assert_eq!(
                p.recommended_qos_config.target_frame_interval_us, 16_667,
                "Expected 16_667 µs for tier {:?}",
                p.tier
            );
        }
    }
}
