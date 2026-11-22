//! Runtime decode-path policy resolution.
//!
//! This answers what the process is allowed to try. Stream capability probing
//! still decides whether the candidate succeeds and frame telemetry records
//! the actual path used.

use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodePathPreference {
    Auto,
    Cpu,
    Metal,
    Dxgi,
}

impl DecodePathPreference {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Cpu => "cpu",
            Self::Metal => "metal",
            Self::Dxgi => "dxgi",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodePolicySource {
    Default,
    DecodePathEnv,
    LegacyMetalEnv,
    InvalidDecodePathEnv,
}

impl DecodePolicySource {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::DecodePathEnv => "CLYPRA_DECODE_PATH",
            Self::LegacyMetalEnv => "CLYPRA_METAL_DECODE",
            Self::InvalidDecodePathEnv => "invalid-env-fallback",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DecodePolicy {
    pub preference: DecodePathPreference,
    pub source: DecodePolicySource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DecodePolicyResolution {
    pub requested: DecodePathPreference,
    pub source: DecodePolicySource,
    pub effective: DecodePathPreference,
    pub rejection_reason: Option<&'static str>,
}

/// Sticky health for a candidate hardware path. Cancellation is normal
/// control flow during scrubbing and deliberately does not affect this state.
/// Only consecutive, typed failures can demote a stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DecodePathHealth {
    consecutive_failures: u8,
    demoted: bool,
}

impl DecodePathHealth {
    pub const FAILURE_THRESHOLD: u8 = 3;

    pub const fn new() -> Self {
        Self {
            consecutive_failures: 0,
            demoted: false,
        }
    }

    pub const fn should_attempt(self) -> bool {
        !self.demoted
    }

    pub fn observe_success(&mut self) {
        self.consecutive_failures = 0;
    }

    pub fn observe_cancelled(&mut self) {
        // Cancellation is expected during scrubbing; it is never evidence that
        // the decoder or interop path is unavailable.
    }

    pub fn observe_failure(&mut self) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        if self.consecutive_failures >= Self::FAILURE_THRESHOLD {
            self.demoted = true;
        }
    }

    pub const fn consecutive_failures(self) -> u8 {
        self.consecutive_failures
    }
}

impl Default for DecodePathHealth {
    fn default() -> Self {
        Self::new()
    }
}

pub fn resolve_decode_policy() -> DecodePolicy {
    resolve_decode_policy_from_values(
        std::env::var("CLYPRA_DECODE_PATH").ok(),
        std::env::var("CLYPRA_METAL_DECODE").ok(),
    )
}

pub fn resolve_decode_resolution() -> DecodePolicyResolution {
    static RESOLUTION: OnceLock<DecodePolicyResolution> = OnceLock::new();
    *RESOLUTION.get_or_init(|| resolve_decode_resolution_for_platform(std::env::consts::OS))
}

/// Allows a validation run to exercise a capability that is intentionally not
/// enabled by `auto`. Explicit `CLYPRA_DECODE_PATH=metal` is also treated as a
/// deliberate validation override on macOS; both cases are recorded in the
/// session header so their results cannot be mistaken for production evidence.
pub fn unverified_capability_override() -> bool {
    static OVERRIDE: OnceLock<bool> = OnceLock::new();
    *OVERRIDE.get_or_init(|| {
        let env_override = matches!(
            std::env::var("CLYPRA_ALLOW_UNVERIFIED").ok().as_deref(),
            Some("1") | Some("true") | Some("yes")
        );
        env_override
            || (std::env::consts::OS == "macos"
                && resolve_decode_resolution().requested == DecodePathPreference::Metal)
    })
}

pub fn resolve_decode_resolution_for_platform(platform: &str) -> DecodePolicyResolution {
    let policy = resolve_decode_policy();
    resolve_decode_resolution_for_policy_with_source(platform, policy.preference, policy.source)
}

pub fn resolve_decode_resolution_for_policy(
    platform: &str,
    preference: DecodePathPreference,
) -> DecodePolicyResolution {
    resolve_decode_resolution_for_policy_with_source(
        platform,
        preference,
        DecodePolicySource::Default,
    )
}

fn resolve_decode_resolution_for_policy_with_source(
    platform: &str,
    preference: DecodePathPreference,
    source: DecodePolicySource,
) -> DecodePolicyResolution {
    let supported = match (platform, preference) {
        (_, DecodePathPreference::Auto | DecodePathPreference::Cpu) => true,
        ("macos", DecodePathPreference::Metal) => true,
        ("windows", DecodePathPreference::Dxgi) => true,
        // Linux and other platforms retain their existing backend discovery
        // chain under auto; explicit foreign backends are rejected visibly.
        _ => false,
    };
    DecodePolicyResolution {
        requested: preference,
        source,
        effective: if supported {
            preference
        } else {
            DecodePathPreference::Auto
        },
        rejection_reason: (!supported).then_some("platform-unsupported"),
    }
}

pub fn resolve_decode_policy_from_values(
    decode_path: Option<String>,
    legacy_metal: Option<String>,
) -> DecodePolicy {
    if let Some(value) = decode_path {
        let preference = match value.trim().to_ascii_lowercase().as_str() {
            "auto" => Some(DecodePathPreference::Auto),
            "cpu" => Some(DecodePathPreference::Cpu),
            "metal" => Some(DecodePathPreference::Metal),
            "dxgi" => Some(DecodePathPreference::Dxgi),
            _ => None,
        };
        return DecodePolicy {
            preference: preference.unwrap_or(DecodePathPreference::Auto),
            source: if preference.is_some() {
                DecodePolicySource::DecodePathEnv
            } else {
                DecodePolicySource::InvalidDecodePathEnv
            },
        };
    }

    match legacy_metal.as_deref() {
        Some("0") | Some("false") | Some("no") => DecodePolicy {
            preference: DecodePathPreference::Cpu,
            source: DecodePolicySource::LegacyMetalEnv,
        },
        Some("1") | Some("true") | Some("yes") => DecodePolicy {
            preference: DecodePathPreference::Metal,
            source: DecodePolicySource::LegacyMetalEnv,
        },
        _ => DecodePolicy {
            preference: DecodePathPreference::Auto,
            source: DecodePolicySource::Default,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_environment_defaults_to_auto() {
        assert_eq!(
            resolve_decode_policy_from_values(None, None),
            DecodePolicy {
                preference: DecodePathPreference::Auto,
                source: DecodePolicySource::Default,
            }
        );
    }

    #[test]
    fn explicit_path_wins_over_legacy_flag() {
        let policy =
            resolve_decode_policy_from_values(Some("cpu".to_string()), Some("1".to_string()));
        assert_eq!(policy.preference, DecodePathPreference::Cpu);
        assert_eq!(policy.source, DecodePolicySource::DecodePathEnv);
    }

    #[test]
    fn legacy_flag_remains_compatible() {
        assert_eq!(
            resolve_decode_policy_from_values(None, Some("1".to_string())).preference,
            DecodePathPreference::Metal
        );
        assert_eq!(
            resolve_decode_policy_from_values(None, Some("0".to_string())).preference,
            DecodePathPreference::Cpu
        );
    }

    #[test]
    fn invalid_path_falls_back_to_auto_with_reason() {
        let policy = resolve_decode_policy_from_values(Some("bogus".to_string()), None);
        assert_eq!(policy.preference, DecodePathPreference::Auto);
        assert_eq!(policy.source, DecodePolicySource::InvalidDecodePathEnv);
    }

    #[test]
    fn foreign_explicit_backend_falls_back_with_typed_reason() {
        // This test is platform-independent because the resolver accepts the
        // platform identity as an input for deterministic policy validation.
        let macos = resolve_decode_resolution_for_policy("macos", DecodePathPreference::Dxgi);
        assert_eq!(macos.requested, DecodePathPreference::Dxgi);
        assert_eq!(macos.effective, DecodePathPreference::Auto);
        assert_eq!(macos.rejection_reason, Some("platform-unsupported"));
    }

    #[test]
    fn legacy_explicit_off_remains_cpu() {
        assert_eq!(
            resolve_decode_policy_from_values(None, Some("0".to_string())).preference,
            DecodePathPreference::Cpu
        );
    }

    #[test]
    fn cancellation_storm_never_demotes_metal_path() {
        let mut health = DecodePathHealth::new();
        for _ in 0..100 {
            health.observe_cancelled();
        }
        assert!(health.should_attempt());
        assert_eq!(health.consecutive_failures(), 0);
    }

    #[test]
    fn only_consecutive_typed_failures_demote_path() {
        let mut health = DecodePathHealth::new();
        health.observe_failure();
        health.observe_failure();
        assert!(health.should_attempt());
        health.observe_success();
        assert_eq!(health.consecutive_failures(), 0);
        health.observe_failure();
        health.observe_failure();
        health.observe_failure();
        assert!(!health.should_attempt());
    }
}
