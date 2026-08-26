// EffectInterpreter — validates and executes ordered SDF primitive pass-chains.
//
// An `EffectDefinition` is a pure JSON description of an ordered list of
// primitive passes (the "composition"), fetched from the Clypra API and never
// bundled with the binary. The interpreter here is compiled code and sits
// strictly on the trusted side of the code/data boundary.
//
// Pass-chain invariants enforced at validation time:
// - Max 16 passes total.
// - Max 2 tier transitions (Tight → QuarterRes → WideFullRes). Any chain
//   that requires a third transition is rejected.
// - All parameter values are sanitized: NaN/Inf rejected, floats clamped to
//   declared [min, max] ranges, unexpected keys discarded.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use clypra_native_core::contracts::{TextParamValue};

// ── Effect Definition (pure data, never ship with the binary) ─────────────────

/// Which resolution tier a pass operates at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolutionTier {
    /// Tight Core ROI — full-res local passes (e.g. outline, fill).
    Tight,
    /// Quarter-res downsampled ROI — wide blur passes (R > 64px).
    QuarterRes,
    /// Full-res Wide ROI — upstream wide-blur resampled for downstream spatial post-FX.
    WideFullRes,
}

/// The four primitive operations the interpreter can dispatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrimitiveKind {
    DistanceThreshold,
    Outline,
    Glow,
    DropShadow,
}

/// Type tag for a parameter slot in an effect definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParamType {
    Float,
    Color,  // [r, g, b, a] f32 linear sRGB
    Vec2,   // [x, y] f32
}

/// Declares a single parameter slot with its name, type, and allowed range.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamSpec {
    pub name:     String,
    pub ty:       ParamType,
    pub default:  TextParamValue,
    /// Inclusive min/max for Float and per-channel for Color/Vec2.
    pub min:      Option<f32>,
    pub max:      Option<f32>,
}

/// A single pass in the ordered pass-chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimitivePass {
    pub primitive: PrimitiveKind,
    pub tier:      ResolutionTier,
    /// Parameter values for this pass (before override application).
    pub params:    HashMap<String, TextParamValue>,
}

/// Complete effect definition — the data document fetched from the API.
/// This is the only thing that crosses the API boundary; no WGSL is transmitted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectDefinition {
    pub effect_id:   String,
    pub version:     u32,
    pub display_name: String,
    /// Ordered parameter schema (used for zero-trust validation of overrides).
    pub param_specs: Vec<ParamSpec>,
    /// Ordered pass-chain.
    pub passes:      Vec<PrimitivePass>,
}

// ── Zero-Trust Parameter Sanitization ─────────────────────────────────────────

/// Error type for validation/sanitization failures.
#[derive(Debug, Clone, PartialEq)]
pub struct EffectValidationError(pub String);

impl std::fmt::Display for EffectValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "EffectValidationError: {}", self.0)
    }
}

/// Sanitize a map of parameter overrides from an untrusted project file against
/// the declared `ParamSpec` schema.
///
/// Rules:
/// 1. Keys not present in `param_specs` are **silently discarded**.
/// 2. Type mismatches are **silently replaced** with the spec default.
/// 3. Float values that are NaN or ±Inf are **replaced** with the spec default.
/// 4. Float values outside `[min, max]` are **clamped**.
/// 5. Color/Vec2 values are sanitized component-by-component.
pub fn sanitize_parameter_overrides(
    overrides: &HashMap<String, TextParamValue>,
    specs: &[ParamSpec],
) -> HashMap<String, TextParamValue> {
    let mut sanitized = HashMap::new();

    for spec in specs {
        // Start with the spec default
        let raw = overrides.get(&spec.name).unwrap_or(&spec.default);

        let value = match spec.ty {
            ParamType::Float => {
                if let TextParamValue::Float(v) = raw {
                    let v = sanitize_f32(*v, spec.min, spec.max).unwrap_or_else(|| {
                        if let TextParamValue::Float(d) = &spec.default { *d } else { 0.0 }
                    });
                    TextParamValue::Float(v)
                } else {
                    spec.default.clone()
                }
            }
            ParamType::Color => {
                if let TextParamValue::Color(channels) = raw {
                    let d = if let TextParamValue::Color(dc) = &spec.default { *dc } else { [0.0; 4] };
                    TextParamValue::Color([
                        sanitize_f32(channels[0], Some(0.0), Some(1.0)).unwrap_or(d[0]),
                        sanitize_f32(channels[1], Some(0.0), Some(1.0)).unwrap_or(d[1]),
                        sanitize_f32(channels[2], Some(0.0), Some(1.0)).unwrap_or(d[2]),
                        sanitize_f32(channels[3], Some(0.0), Some(1.0)).unwrap_or(d[3]),
                    ])
                } else {
                    spec.default.clone()
                }
            }
            ParamType::Vec2 => {
                if let TextParamValue::Vec2(v) = raw {
                    let d = if let TextParamValue::Vec2(dv) = &spec.default { *dv } else { [0.0; 2] };
                    TextParamValue::Vec2([
                        sanitize_f32(v[0], spec.min, spec.max).unwrap_or(d[0]),
                        sanitize_f32(v[1], spec.min, spec.max).unwrap_or(d[1]),
                    ])
                } else {
                    spec.default.clone()
                }
            }
        };

        sanitized.insert(spec.name.clone(), value);
    }

    sanitized
}

/// Sanitize a single f32: reject NaN/Inf, clamp to [min, max].
/// Returns `None` if the value is not finite (caller should use default).
fn sanitize_f32(v: f32, min: Option<f32>, max: Option<f32>) -> Option<f32> {
    if !v.is_finite() {
        return None;
    }
    let v = match (min, max) {
        (Some(lo), Some(hi)) => v.clamp(lo, hi),
        (Some(lo), None)     => v.max(lo),
        (None, Some(hi))     => v.min(hi),
        (None, None)         => v,
    };
    Some(v)
}

// ── Pass-Chain Validation ──────────────────────────────────────────────────────

/// Validates the structural rules of an effect's pass-chain.
/// Does not execute any GPU work.
pub fn validate_effect_definition(def: &EffectDefinition) -> Result<(), EffectValidationError> {
    // Rule 1: Max 16 passes.
    if def.passes.len() > 16 {
        return Err(EffectValidationError(format!(
            "Effect '{}' has {} passes; maximum is 16",
            def.effect_id, def.passes.len()
        )));
    }

    // Rule 2: Max 2 tier transitions (one contiguous wide-tier excursion).
    let mut transitions = 0u32;
    let mut prev_tier = def.passes.first().map(|p| p.tier);

    for pass in &def.passes {
        if let Some(prev) = prev_tier {
            if pass.tier != prev {
                transitions += 1;
            }
        }
        prev_tier = Some(pass.tier);
    }

    if transitions > 2 {
        return Err(EffectValidationError(format!(
            "Effect '{}' has {} tier transitions; maximum is 2 (one contiguous WideQuarterRes excursion)",
            def.effect_id, transitions
        )));
    }

    // Rule 3: All parameter names in passes must be declared in param_specs.
    let spec_names: std::collections::HashSet<&str> =
        def.param_specs.iter().map(|s| s.name.as_str()).collect();

    for (i, pass) in def.passes.iter().enumerate() {
        for key in pass.params.keys() {
            if !spec_names.contains(key.as_str()) {
                return Err(EffectValidationError(format!(
                    "Effect '{}' pass {} references undeclared parameter '{}'",
                    def.effect_id, i, key
                )));
            }
        }
    }

    Ok(())
}

// ── Resolved Pass — ready to hand to TextEffectPipeline ───────────────────────

/// A fully-resolved, sanitized pass ready for GPU execution.
/// All parameter values have been validated and clamped.
#[derive(Debug, Clone)]
pub struct ResolvedPass {
    pub primitive: PrimitiveKind,
    pub tier:      ResolutionTier,
    pub params:    HashMap<String, TextParamValue>,
}

/// Resolve an `EffectDefinition` against a set of project-file parameter
/// overrides, returning an ordered list of `ResolvedPass`es ready for
/// `TextEffectPipeline` execution.
pub fn resolve_passes(
    def: &EffectDefinition,
    overrides: &HashMap<String, TextParamValue>,
) -> Result<Vec<ResolvedPass>, EffectValidationError> {
    validate_effect_definition(def)?;

    // Sanitize all overrides up-front against the declared spec.
    let safe_overrides = sanitize_parameter_overrides(overrides, &def.param_specs);

    let resolved = def
        .passes
        .iter()
        .map(|pass| {
            // Start from pass defaults, then apply sanitized overrides.
            let mut params = pass.params.clone();
            for (k, v) in &safe_overrides {
                params.insert(k.clone(), v.clone());
            }
            // Re-sanitize the merged map to guard against bad pass defaults.
            let params = sanitize_parameter_overrides(&params, &def.param_specs);
            ResolvedPass {
                primitive: pass.primitive,
                tier:      pass.tier,
                params,
            }
        })
        .collect();

    Ok(resolved)
}

// ── Helper: extract typed uniforms from a ResolvedPass ────────────────────────

/// Extract a float parameter by name, returning a fallback if absent or invalid.
pub fn param_f32(params: &HashMap<String, TextParamValue>, name: &str, fallback: f32) -> f32 {
    match params.get(name) {
        Some(TextParamValue::Float(v)) if v.is_finite() => *v,
        _ => fallback,
    }
}

/// Extract a vec4 colour parameter [r, g, b, a], returning white opaque on error.
pub fn param_color(params: &HashMap<String, TextParamValue>, name: &str) -> [f32; 4] {
    match params.get(name) {
        Some(TextParamValue::Color(c)) if c.iter().all(|v| v.is_finite()) => *c,
        _ => [1.0, 1.0, 1.0, 1.0],
    }
}

/// Extract a vec2 parameter, returning [0.0, 0.0] on error.
pub fn param_vec2(params: &HashMap<String, TextParamValue>, name: &str) -> [f32; 2] {
    match params.get(name) {
        Some(TextParamValue::Vec2(v)) if v.iter().all(|x| x.is_finite()) => *v,
        _ => [0.0, 0.0],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_effect_definition() -> EffectDefinition {
        EffectDefinition {
            effect_id: "neon-glow".to_string(),
            version: 1,
            display_name: "Neon Glow".to_string(),
            param_specs: vec![
                ParamSpec {
                    name: "threshold".to_string(),
                    ty: ParamType::Float,
                    default: TextParamValue::Float(0.502),
                    min: Some(0.0),
                    max: Some(1.0),
                },
                ParamSpec {
                    name: "glow_radius".to_string(),
                    ty: ParamType::Float,
                    default: TextParamValue::Float(0.2),
                    min: Some(0.0),
                    max: Some(1.0),
                },
                ParamSpec {
                    name: "glow_color".to_string(),
                    ty: ParamType::Color,
                    default: TextParamValue::Color([0.2, 0.6, 1.0, 1.0]),
                    min: Some(0.0),
                    max: Some(1.0),
                },
            ],
            passes: vec![
                PrimitivePass {
                    primitive: PrimitiveKind::Glow,
                    tier: ResolutionTier::Tight,
                    params: {
                        let mut m = HashMap::new();
                        m.insert("threshold".to_string(), TextParamValue::Float(0.502));
                        m.insert("glow_radius".to_string(), TextParamValue::Float(0.2));
                        m.insert("glow_color".to_string(), TextParamValue::Color([0.2, 0.6, 1.0, 1.0]));
                        m
                    },
                },
                PrimitivePass {
                    primitive: PrimitiveKind::DistanceThreshold,
                    tier: ResolutionTier::Tight,
                    params: {
                        let mut m = HashMap::new();
                        m.insert("threshold".to_string(), TextParamValue::Float(0.502));
                        m
                    },
                },
            ],
        }
    }

    #[test]
    fn valid_effect_definition_passes() {
        let def = sample_effect_definition();
        assert!(validate_effect_definition(&def).is_ok());
    }

    #[test]
    fn effect_definition_rejects_more_than_16_passes() {
        let mut def = sample_effect_definition();
        let pass = def.passes[0].clone();
        def.passes = (0..17).map(|_| pass.clone()).collect();
        let err = validate_effect_definition(&def).unwrap_err();
        assert!(err.0.contains("maximum is 16"));
    }

    #[test]
    fn effect_definition_rejects_more_than_2_tier_transitions() {
        let mut def = sample_effect_definition();
        let pass_tight = PrimitivePass {
            primitive: PrimitiveKind::DistanceThreshold,
            tier: ResolutionTier::Tight,
            params: HashMap::new(),
        };
        let pass_quarter = PrimitivePass {
            primitive: PrimitiveKind::Glow,
            tier: ResolutionTier::QuarterRes,
            params: HashMap::new(),
        };
        let _pass_wide = PrimitivePass {
            primitive: PrimitiveKind::Outline,
            tier: ResolutionTier::WideFullRes,
            params: HashMap::new(),
        };
        // Tight -> QuarterRes (1) -> Tight (2) -> QuarterRes (3) = 3 transitions -> rejected!
        def.passes = vec![
            pass_tight.clone(),
            pass_quarter.clone(),
            pass_tight.clone(),
            pass_quarter.clone(),
        ];
        let err = validate_effect_definition(&def).unwrap_err();
        assert!(err.0.contains("tier transitions"));
    }

    #[test]
    fn parameter_sanitizer_clamps_floats_and_discards_unknown_keys() {
        let def = sample_effect_definition();
        let mut overrides = HashMap::new();
        overrides.insert("glow_radius".to_string(), TextParamValue::Float(50.0)); // > max(1.0) -> clamps to 1.0
        overrides.insert("threshold".to_string(), TextParamValue::Float(-5.0)); // < min(0.0) -> clamps to 0.0
        overrides.insert("injected_malicious_key".to_string(), TextParamValue::Float(999.0)); // unknown -> discarded

        let sanitized = sanitize_parameter_overrides(&overrides, &def.param_specs);
        assert_eq!(sanitized.get("glow_radius"), Some(&TextParamValue::Float(1.0)));
        assert_eq!(sanitized.get("threshold"), Some(&TextParamValue::Float(0.0)));
        assert_eq!(sanitized.get("injected_malicious_key"), None);
        // Default filled for missing spec:
        assert_eq!(sanitized.get("glow_color"), Some(&TextParamValue::Color([0.2, 0.6, 1.0, 1.0])));
    }

    #[test]
    fn parameter_sanitizer_rejects_nan_and_inf() {
        let def = sample_effect_definition();
        let mut overrides = HashMap::new();
        overrides.insert("glow_radius".to_string(), TextParamValue::Float(f32::NAN));
        overrides.insert("threshold".to_string(), TextParamValue::Float(f32::INFINITY));

        let sanitized = sanitize_parameter_overrides(&overrides, &def.param_specs);
        assert_eq!(sanitized.get("glow_radius"), Some(&TextParamValue::Float(0.2))); // spec default
        assert_eq!(sanitized.get("threshold"), Some(&TextParamValue::Float(0.502))); // spec default
    }

    #[test]
    fn resolve_passes_merges_sanitized_overrides_cleanly() {
        let def = sample_effect_definition();
        let mut overrides = HashMap::new();
        overrides.insert("glow_radius".to_string(), TextParamValue::Float(0.8));

        let resolved = resolve_passes(&def, &overrides).unwrap();
        assert_eq!(resolved.len(), 2);
        assert_eq!(resolved[0].params.get("glow_radius"), Some(&TextParamValue::Float(0.8)));
    }

    #[test]
    fn effect_definition_rejects_unknown_primitive_string() {
        let malformed_json = r#"{
            "effectId": "test-malformed",
            "version": 1,
            "displayName": "Malformed",
            "paramSpecs": [],
            "passes": [
                {
                    "primitive": "outlin",
                    "tier": "tight",
                    "params": {}
                }
            ]
        }"#;

        let result: Result<EffectDefinition, _> = serde_json::from_str(malformed_json);
        assert!(result.is_err(), "unknown primitive 'outlin' must be rejected during deserialization");
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("unknown variant") || err_msg.contains("outlin"));
    }
}
