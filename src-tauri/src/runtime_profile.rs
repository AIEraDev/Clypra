//! Process-level development and release flag resolution.
//!
//! This module is the single owner of profile selection and the defaults for
//! diagnostic/validation switches. Consumers should use the resolved values
//! instead of reading process environment variables in hot paths.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeProfile {
    Dev,
    Release,
}

impl RuntimeProfile {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Release => "release",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRuntimeFlag {
    pub enabled: bool,
    pub source: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFlagProfile {
    pub profile: RuntimeProfile,
    pub trace: ResolvedRuntimeFlag,
    pub validate_stages: ResolvedRuntimeFlag,
    pub require_zero_copy: ResolvedRuntimeFlag,
    pub decode_path: String,
    pub decode_path_source: &'static str,
    pub allow_unverified: ResolvedRuntimeFlag,
    pub disable_dirty_recovery: ResolvedRuntimeFlag,
    pub dxgi_scoped_latch: ResolvedRuntimeFlag,
}

impl RuntimeFlagProfile {
    pub fn is_dev(&self) -> bool {
        self.profile == RuntimeProfile::Dev
    }

    pub fn dirty_recovery_enabled(&self) -> bool {
        !self.disable_dirty_recovery.enabled
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RuntimeFlagInputs<'a> {
    pub clypra_dev: Option<&'a str>,
    pub trace: Option<&'a str>,
    pub validate_stages: Option<&'a str>,
    pub require_zero_copy: Option<&'a str>,
    pub decode_path: Option<&'a str>,
    pub allow_unverified: Option<&'a str>,
    pub disable_dirty_recovery: Option<&'a str>,
    pub dxgi_scoped_latch: Option<&'a str>,
}

pub fn resolve_runtime_flag_profile() -> RuntimeFlagProfile {
    let clypra_dev = env_value("CLYPRA_DEV");
    let trace = env_value("CLYPRA_TRACE");
    let validate_stages = env_value("CLYPRA_VALIDATE_STAGES");
    let require_zero_copy = env_value("CLYPRA_REQUIRE_ZERO_COPY");
    let decode_path = env_value("CLYPRA_DECODE_PATH");
    let allow_unverified = env_value("CLYPRA_ALLOW_UNVERIFIED");
    let disable_dirty_recovery = env_value("CLYPRA_DEBUG_DISABLE_DIRTY_RECOVERY");
    let dxgi_scoped_latch = env_value("CLYPRA_DXGI_SCOPED_LATCH");
    resolve_runtime_flag_profile_from_inputs(
        cfg!(debug_assertions),
        RuntimeFlagInputs {
            clypra_dev: clypra_dev.as_deref(),
            trace: trace.as_deref(),
            validate_stages: validate_stages.as_deref(),
            require_zero_copy: require_zero_copy.as_deref(),
            decode_path: decode_path.as_deref(),
            allow_unverified: allow_unverified.as_deref(),
            disable_dirty_recovery: disable_dirty_recovery.as_deref(),
            dxgi_scoped_latch: dxgi_scoped_latch.as_deref(),
        },
    )
}

pub fn resolve_runtime_flag_profile_from_inputs(
    debug_assertions: bool,
    inputs: RuntimeFlagInputs<'_>,
) -> RuntimeFlagProfile {
    let is_dev = debug_assertions || parse_bool(inputs.clypra_dev).unwrap_or(false);
    let profile = if is_dev {
        RuntimeProfile::Dev
    } else {
        RuntimeProfile::Release
    };
    let decode_path = resolve_decode_path(inputs.decode_path);
    let decode_path_source = match inputs.decode_path.map(str::trim) {
        Some(value) if !value.is_empty() => "env",
        Some(_) => "invalid-env-fallback",
        None if is_dev => "dev-default",
        None => "release-default",
    };

    RuntimeFlagProfile {
        profile,
        trace: resolve_bool(inputs.trace, is_dev),
        validate_stages: resolve_bool(inputs.validate_stages, false),
        require_zero_copy: resolve_bool(inputs.require_zero_copy, is_dev),
        decode_path,
        decode_path_source,
        allow_unverified: resolve_bool(inputs.allow_unverified, false),
        disable_dirty_recovery: resolve_bool(inputs.disable_dirty_recovery, false),
        dxgi_scoped_latch: resolve_bool(inputs.dxgi_scoped_latch, false),
    }
}

fn env_value(name: &str) -> Option<String> {
    // Keep environment reads centralized here. The owned values live for the
    // duration of profile resolution and are not retained after the result is
    // constructed.
    std::env::var(name).ok()
}

fn parse_bool(value: Option<&str>) -> Option<bool> {
    value?.trim().to_ascii_lowercase().parse::<bool>().ok().or_else(|| {
        match value?.trim().to_ascii_lowercase().as_str() {
            "1" | "yes" | "on" => Some(true),
            "0" | "no" | "off" => Some(false),
            _ => None,
        }
    })
}

fn resolve_bool(value: Option<&str>, default: bool) -> ResolvedRuntimeFlag {
    match parse_bool(value) {
        Some(enabled) => ResolvedRuntimeFlag {
            enabled,
            source: "env",
        },
        None if value.is_some() => ResolvedRuntimeFlag {
            enabled: default,
            source: "invalid-env-fallback",
        },
        None => ResolvedRuntimeFlag {
            enabled: default,
            source: if default {
                "dev-default"
            } else {
                "release-default"
            },
        },
    }
}

fn resolve_decode_path(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("auto")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_profile_enables_observability_and_zero_copy_assertion_only() {
        let profile = resolve_runtime_flag_profile_from_inputs(
            false,
            RuntimeFlagInputs {
                clypra_dev: Some("1"),
                ..RuntimeFlagInputs::default()
            },
        );

        assert_eq!(profile.profile, RuntimeProfile::Dev);
        assert!(profile.trace.enabled);
        assert_eq!(profile.trace.source, "dev-default");
        assert!(!profile.validate_stages.enabled);
        assert!(profile.require_zero_copy.enabled);
        assert_eq!(profile.require_zero_copy.source, "dev-default");
        assert_eq!(profile.decode_path, "auto");
        assert_eq!(profile.decode_path_source, "dev-default");
        assert!(!profile.allow_unverified.enabled);
        assert!(!profile.disable_dirty_recovery.enabled);
        assert!(!profile.dxgi_scoped_latch.enabled);
        assert!(profile.dirty_recovery_enabled());
    }

    #[test]
    fn release_profile_keeps_correctness_and_experiments_off() {
        let profile = resolve_runtime_flag_profile_from_inputs(
            false,
            RuntimeFlagInputs::default(),
        );

        assert_eq!(profile.profile, RuntimeProfile::Release);
        assert!(!profile.trace.enabled);
        assert!(!profile.require_zero_copy.enabled);
        assert_eq!(profile.decode_path, "auto");
        assert!(!profile.allow_unverified.enabled);
        assert!(!profile.disable_dirty_recovery.enabled);
        assert!(profile.dirty_recovery_enabled());
    }

    #[test]
    fn explicit_experiment_values_override_profile_defaults() {
        let profile = resolve_runtime_flag_profile_from_inputs(
            false,
            RuntimeFlagInputs {
                trace: Some("0"),
                require_zero_copy: Some("false"),
                decode_path: Some("metal"),
                allow_unverified: Some("1"),
                disable_dirty_recovery: Some("yes"),
                dxgi_scoped_latch: Some("1"),
                ..RuntimeFlagInputs::default()
            },
        );

        assert!(!profile.trace.enabled);
        assert_eq!(profile.trace.source, "env");
        assert!(!profile.require_zero_copy.enabled);
        assert_eq!(profile.decode_path, "metal");
        assert_eq!(profile.decode_path_source, "env");
        assert!(profile.allow_unverified.enabled);
        assert!(profile.disable_dirty_recovery.enabled);
        assert!(profile.dxgi_scoped_latch.enabled);
        assert!(!profile.dirty_recovery_enabled());
    }

    #[test]
    fn debug_assertions_activate_dev_profile_without_environment_override() {
        let profile = resolve_runtime_flag_profile_from_inputs(
            true,
            RuntimeFlagInputs::default(),
        );
        assert_eq!(profile.profile, RuntimeProfile::Dev);
        assert!(profile.trace.enabled);
        assert!(profile.require_zero_copy.enabled);
    }
}
