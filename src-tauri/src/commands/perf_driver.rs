//! Deterministic native-preview scenario driver used by performance experiments.
//!
//! The command is compiled into the development binary only when the
//! `perf-driver` feature is enabled.  It deliberately drives the existing
//! playback commands; it does not introduce a second clock or scheduler.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(feature = "perf-driver")]
use std::time::Duration;
use tauri::AppHandle;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfScenarioAction {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_index: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_frame: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_frame: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfScenario {
    pub schema_version: u32,
    pub scenario_id: String,
    pub scenario_hash: String,
    pub actions: Vec<PerfScenarioAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfScenarioResult {
    pub scenario_id: String,
    pub scenario_hash: String,
    pub action_count: usize,
    pub completed_actions: usize,
}

fn canonical_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(object) => {
            let mut entries: Vec<_> = object.iter().collect();
            entries.sort_by_key(|(left, _)| *left);
            let mut sorted = serde_json::Map::new();
            for (key, item) in entries {
                sorted.insert(key.clone(), canonical_value(item));
            }
            serde_json::Value::Object(sorted)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(canonical_value).collect())
        }
        _ => value.clone(),
    }
}

/// Hash the scenario without its supplied hash field.  The same algorithm is
/// implemented by `scripts/perf/run-preview-scenario.mjs` so a run can be
/// verified independently of the app process.
pub fn scenario_hash(scenario: &PerfScenario) -> Result<String, String> {
    let mut value = serde_json::to_value(scenario).map_err(|error| error.to_string())?;
    if let serde_json::Value::Object(object) = &mut value {
        object.remove("scenarioHash");
    }
    let canonical = canonical_value(&value);
    let bytes = serde_json::to_vec(&canonical).map_err(|error| error.to_string())?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

#[cfg(any(feature = "perf-driver", test))]
fn validate_action(action: &PerfScenarioAction) -> Result<(), String> {
    match action.kind.as_str() {
        "play" | "pause" => {
            if action.duration_ms.unwrap_or(1) == 0 {
                return Err(format!("{} durationMs must be positive", action.kind));
            }
        }
        "coldSeek" | "clipBoundary" => {
            if action.frame_index.is_none() {
                return Err(format!("{} requires frameIndex", action.kind));
            }
        }
        "scrubSweep" => {
            let start = action.start_frame.ok_or("scrubSweep requires startFrame")?;
            let end = action.end_frame.ok_or("scrubSweep requires endFrame")?;
            if start == end {
                return Err("scrubSweep startFrame and endFrame must differ".to_string());
            }
            if action.steps.unwrap_or(0) < 2 {
                return Err("scrubSweep steps must be at least 2".to_string());
            }
        }
        other => return Err(format!("unsupported scenario action: {other}")),
    }
    Ok(())
}

/// Execute a scenario against the active native playback runtime.
///
/// This function is intentionally unavailable unless the `perf-driver` Cargo
/// feature is enabled.  Production binaries therefore cannot be driven by a
/// scripted endpoint accidentally.
#[tauri::command]
pub async fn run_perf_scenario(
    app: AppHandle,
    scenario: PerfScenario,
) -> Result<PerfScenarioResult, String> {
    #[cfg(not(feature = "perf-driver"))]
    {
        let _ = (app, scenario);
        Err("run_perf_scenario requires the perf-driver feature".to_string())
    }

    #[cfg(feature = "perf-driver")]
    {
        if scenario.schema_version != 1 {
            return Err(format!(
                "unsupported scenario schemaVersion: {}",
                scenario.schema_version
            ));
        }
        if scenario.scenario_id.trim().is_empty() {
            return Err("scenarioId must be non-empty".to_string());
        }
        let expected_hash = scenario_hash(&scenario)?;
        if scenario.scenario_hash != expected_hash {
            return Err(format!(
                "scenarioHash mismatch: expected {expected_hash}, got {}",
                scenario.scenario_hash
            ));
        }
        for action in &scenario.actions {
            validate_action(action)?;
        }

        let mut completed_actions = 0;
        for action in &scenario.actions {
            match action.kind.as_str() {
                "play" => {
                    crate::commands::native_playback::native_play_from_audio(app.clone())?;
                    tokio::time::sleep(Duration::from_millis(action.duration_ms.unwrap_or(1)))
                        .await;
                }
                "pause" => {
                    crate::commands::native_playback::native_pause_from_audio(app.clone())?;
                }
                "coldSeek" | "clipBoundary" => {
                    crate::commands::native_playback::native_seek(
                        app.clone(),
                        action.frame_index.expect("validated frameIndex"),
                    )?;
                }
                "scrubSweep" => {
                    let start = action.start_frame.expect("validated startFrame");
                    let end = action.end_frame.expect("validated endFrame");
                    let steps = action.steps.expect("validated steps");
                    let interval = action.duration_ms.unwrap_or(1) / u64::from(steps - 1);
                    for step in 0..steps {
                        let progress = step as f64 / f64::from(steps - 1);
                        let frame =
                            (start as f64 + (end as f64 - start as f64) * progress).round() as u64;
                        crate::commands::native_playback::native_seek(app.clone(), frame)?;
                        if interval > 0 {
                            tokio::time::sleep(Duration::from_millis(interval)).await;
                        }
                    }
                }
                _ => unreachable!("validated action kind"),
            }
            completed_actions += 1;
        }

        Ok(PerfScenarioResult {
            scenario_id: scenario.scenario_id,
            scenario_hash: scenario.scenario_hash,
            action_count: completed_actions,
            completed_actions,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scenario() -> PerfScenario {
        PerfScenario {
            schema_version: 1,
            scenario_id: "preview-v1".to_string(),
            scenario_hash: String::new(),
            actions: vec![
                PerfScenarioAction {
                    kind: "play".to_string(),
                    duration_ms: Some(30_000),
                    frame_index: None,
                    start_frame: None,
                    end_frame: None,
                    steps: None,
                },
                PerfScenarioAction {
                    kind: "coldSeek".to_string(),
                    duration_ms: None,
                    frame_index: Some(900),
                    start_frame: None,
                    end_frame: None,
                    steps: None,
                },
            ],
        }
    }

    #[test]
    fn scenario_hash_is_stable_and_excludes_supplied_hash() {
        let mut value = scenario();
        let hash = scenario_hash(&value).expect("hash");
        value.scenario_hash = "different".to_string();
        assert_eq!(scenario_hash(&value).expect("hash"), hash);
    }

    #[test]
    fn scenario_hash_matches_node_driver_contract() {
        let value: PerfScenario = serde_json::from_str(
            r#"{"schemaVersion":1,"scenarioId":"preview-v1","scenarioHash":"","actions":[{"kind":"play","durationMs":1}]}"#,
        )
        .expect("scenario JSON");
        assert_eq!(
            scenario_hash(&value).expect("hash"),
            "363bce06674e8ff70eb4332cc6780e634668767183c93913439c70bdd5c04c3d"
        );
    }

    #[test]
    fn invalid_actions_are_rejected() {
        let action = PerfScenarioAction {
            kind: "scrubSweep".to_string(),
            duration_ms: Some(100),
            frame_index: None,
            start_frame: Some(1),
            end_frame: Some(1),
            steps: Some(1),
        };
        assert!(validate_action(&action).is_err());
    }
}
