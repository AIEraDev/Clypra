//! Deterministic native-preview scenario driver used by performance experiments.
//!
//! The command is compiled into the development binary only when the
//! `perf-driver` feature is enabled.  It deliberately drives the existing
//! playback commands; it does not introduce a second clock or scheduler.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(feature = "perf-driver")]
use std::sync::{Arc, Mutex};
#[cfg(feature = "perf-driver")]
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

fn is_false(value: &bool) -> bool {
    !*value
}

static ACTIVE_PHASE_ID: std::sync::OnceLock<std::sync::Mutex<Option<String>>> =
    std::sync::OnceLock::new();
const STARTUP_PHASE_DURATION_MS: u64 = 2_000;

pub(crate) fn active_phase_id() -> Option<String> {
    ACTIVE_PHASE_ID
        .get_or_init(|| std::sync::Mutex::new(None))
        .lock()
        .ok()
        .and_then(|phase_id| phase_id.clone())
}

fn set_active_phase_id(phase_id: Option<&str>) {
    if let Ok(mut active) = ACTIVE_PHASE_ID
        .get_or_init(|| std::sync::Mutex::new(None))
        .lock()
    {
        *active = phase_id.map(str::to_string);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfScenarioAction {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_id: Option<String>,
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

fn default_phase_id(kind: &str) -> &'static str {
    match kind {
        "play" => "steady_playback",
        "coldSeek" => "cold_seek",
        "scrubSweep" => "scrub",
        "clipBoundary" => "clip_boundary",
        "pause" => "pause",
        _ => "unknown",
    }
}

fn phase_id_for_action(action: &PerfScenarioAction) -> &str {
    action
        .phase_id
        .as_deref()
        .filter(|phase_id| !phase_id.trim().is_empty())
        .unwrap_or_else(|| default_phase_id(&action.kind))
}

fn action_has_startup_phase(action: &PerfScenarioAction) -> bool {
    action.kind == "play"
        && phase_id_for_action(action) == "steady_playback"
        && action.duration_ms.unwrap_or(1) > STARTUP_PHASE_DURATION_MS
}

fn emit_phase_marker(
    app: &AppHandle,
    action: &PerfScenarioAction,
    action_index: usize,
    event: &'static str,
) {
    emit_phase_marker_with_attempts(
        app,
        action,
        action_index,
        phase_id_for_action(action),
        action.kind.as_str(),
        event,
        None,
    );
}

fn emit_phase_marker_for_phase(
    app: &AppHandle,
    action: &PerfScenarioAction,
    action_index: usize,
    phase_id: &str,
    phase_kind: &str,
    event: &'static str,
) {
    emit_phase_marker_with_attempts(
        app,
        action,
        action_index,
        phase_id,
        phase_kind,
        event,
        None,
    );
}

fn emit_phase_marker_with_attempts(
    app: &AppHandle,
    action: &PerfScenarioAction,
    action_index: usize,
    phase_id: &str,
    phase_kind: &str,
    event: &'static str,
    play_start_attempts: Option<u32>,
) {
    let mut payload = serde_json::json!({
        "marker": "perf-phase",
        "phaseId": phase_id,
        "phaseKind": phase_kind,
        "phaseEvent": event,
        "actionIndex": action_index,
        "frameIndex": action.frame_index,
        "startFrame": action.start_frame,
        "endFrame": action.end_frame,
        "steps": action.steps,
    });
    if let Some(attempts) = play_start_attempts {
        payload["playStartAttempts"] = serde_json::json!(attempts);
    }
    if event == "start" {
        set_active_phase_id(Some(phase_id));
    }
    let _ = app.emit("clypra://native-diagnostic", payload);
    let _ = app.emit(
        "clypra://engine-telemetry",
        crate::engine::ENGINE_TELEMETRY.snapshot(),
    );
    if matches!(event, "end" | "error") {
        set_active_phase_id(None);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfScenario {
    pub schema_version: u32,
    pub scenario_id: String,
    pub scenario_hash: String,
    pub actions: Vec<PerfScenarioAction>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub close_after_run: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfScenarioResult {
    pub scenario_id: String,
    pub scenario_hash: String,
    pub action_count: usize,
    pub completed_actions: usize,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport_start_ticks: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport_end_ticks: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub play_start_attempts: Option<u32>,
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

#[cfg(feature = "perf-driver")]
async fn wait_for_audio_clock_start(app: &AppHandle) -> Result<(i64, u32), String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut attempts = 1u32;
    while Instant::now() < deadline {
        let is_playing = if let Some(audio) =
            app.try_state::<std::sync::Arc<std::sync::Mutex<crate::native_audio::NativeAudioClock>>>()
        {
            if let Ok(clock) = audio.lock() {
                let status = clock.status();
                status.running && status.playing
            } else {
                false
            }
        } else {
            false
        };
        if is_playing {
            if let Ok(clock) = crate::commands::native_playback::audio_clock_time(app, true, false) {
                if clock.ticks >= 0 {
                    return Ok((clock.ticks, attempts));
                }
            }
        }
        attempts += 1;
        let _ = app.emit(
            "clypra://perf-driver-transport",
            serde_json::json!({ "action": "play" }),
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("transport-start-failed".to_string())
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
        let mut invalid_reason = None;
        let mut transport_start_ticks = None;
        let mut transport_end_ticks = None;
        let mut play_start_attempts = None;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        // Settle until the native surface is configured or timeout after 5s
        let surface_wait_deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < surface_wait_deadline {
            let is_configured = app
                .try_state::<Arc<Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>()
                .and_then(|surface| surface.lock().ok().map(|s| s.diagnostic_state().configured))
                .unwrap_or(false);
            if is_configured {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let _ = app.emit(
            "clypra://perf-driver-probe",
            serde_json::json!({
                "probeId": scenario.scenario_id,
                "durationMs": 1_000,
            }),
        );
        for (action_index, action) in scenario.actions.iter().enumerate() {
            let startup_phase = action_has_startup_phase(action);
            if startup_phase {
                emit_phase_marker_for_phase(
                    &app,
                    action,
                    action_index,
                    "startup",
                    "startup",
                    "start",
                );
            } else {
                emit_phase_marker(&app, action, action_index, "start");
            }
            let action_result: Result<(), String> = async {
                match action.kind.as_str() {
                    "play" => {
                        let _ = app.emit(
                            "clypra://perf-driver-transport",
                            serde_json::json!({ "action": "play" }),
                        );
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        let (start_ticks, attempts) = wait_for_audio_clock_start(&app).await?;
                        transport_start_ticks = Some(start_ticks);
                        play_start_attempts = Some(attempts);
                        let duration_ms = action.duration_ms.unwrap_or(1);
                        if startup_phase {
                            let startup_start = tokio::time::Instant::now();
                            while startup_start.elapsed() < Duration::from_millis(STARTUP_PHASE_DURATION_MS) {
                                let is_presented = app
                                    .try_state::<Arc<Mutex<crate::commands::native_playback::NativePlaybackRuntime>>>()
                                    .and_then(|rt| rt.lock().ok().map(|r| r.is_first_frame_presented()))
                                    .unwrap_or(false);
                                if is_presented {
                                    break;
                                }
                                tokio::time::sleep(Duration::from_millis(50)).await;
                            }
                            let elapsed = startup_start.elapsed();
                            if elapsed < Duration::from_millis(STARTUP_PHASE_DURATION_MS) {
                                tokio::time::sleep(Duration::from_millis(STARTUP_PHASE_DURATION_MS) - elapsed).await;
                            }
                            emit_phase_marker_for_phase(
                                &app,
                                action,
                                action_index,
                                "startup",
                                "startup",
                                "end",
                            );
                            emit_phase_marker_with_attempts(
                                &app,
                                action,
                                action_index,
                                phase_id_for_action(action),
                                action.kind.as_str(),
                                "start",
                                Some(attempts),
                            );
                            tokio::time::sleep(
                                Duration::from_millis(duration_ms.saturating_sub(STARTUP_PHASE_DURATION_MS)),
                            )
                            .await;
                        } else {
                            tokio::time::sleep(Duration::from_millis(duration_ms)).await;
                        }
                        let end_ticks = crate::commands::native_playback::audio_clock_time(
                            &app, true, false,
                        )
                        .map_err(|_| "native-audio-position-unavailable".to_string())?
                        .ticks;
                        transport_end_ticks = Some(end_ticks);
                        let expected_ticks = i64::try_from(duration_ms)
                            .unwrap_or(i64::MAX / 1_000)
                            .saturating_mul(1_000);
                        let minimum_ticks = expected_ticks.saturating_mul(95) / 100;
                        if end_ticks.saturating_sub(start_ticks) < minimum_ticks {
                            return Err("playhead-did-not-advance".to_string());
                        }
                        Ok(())
                    }
                    "pause" => {
                        let _ = app.emit(
                            "clypra://perf-driver-transport",
                            serde_json::json!({ "action": "pause" }),
                        );
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        Ok(())
                    }
                    "coldSeek" | "clipBoundary" => {
                        crate::commands::native_playback::native_seek(
                            app.clone(),
                            action.frame_index.expect("validated frameIndex"),
                        )?;
                        Ok(())
                    }
                    "scrubSweep" => {
                        let start = action.start_frame.expect("validated startFrame");
                        let end = action.end_frame.expect("validated endFrame");
                        let steps = action.steps.expect("validated steps");
                        let interval = action.duration_ms.unwrap_or(1) / u64::from(steps - 1);
                        for step in 0..steps {
                            let progress = step as f64 / f64::from(steps - 1);
                            let frame = (start as f64 + (end as f64 - start as f64) * progress)
                                .round() as u64;
                            crate::commands::native_playback::native_seek(app.clone(), frame)?;
                            if interval > 0 {
                                tokio::time::sleep(Duration::from_millis(interval)).await;
                            }
                        }
                        Ok(())
                    }
                    _ => unreachable!("validated action kind"),
                }
            }
            .await;
            if let Err(error) = action_result {
                if startup_phase {
                    emit_phase_marker_for_phase(
                        &app,
                        action,
                        action_index,
                        "startup",
                        "startup",
                        "error",
                    );
                } else {
                    emit_phase_marker(&app, action, action_index, "error");
                }
                invalid_reason = Some(error);
                break;
            }
            emit_phase_marker(&app, action, action_index, "end");
            completed_actions += 1;
        }
        if scenario.close_after_run {
            // Reuse the normal application close lifecycle so the frontend
            // flushes telemetry and writes the session footer before exit.
            let _ = app.emit("clypra://close-requested", serde_json::json!({ "force": true }));
        }

        Ok(PerfScenarioResult {
            scenario_id: scenario.scenario_id,
            scenario_hash: scenario.scenario_hash,
            action_count: completed_actions,
            completed_actions,
            valid: invalid_reason.is_none(),
            invalid_reason,
            transport_start_ticks,
            transport_end_ticks,
            play_start_attempts,
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
                    phase_id: Some("steady_playback".to_string()),
                    duration_ms: Some(30_000),
                    frame_index: None,
                    start_frame: None,
                    end_frame: None,
                    steps: None,
                },
                PerfScenarioAction {
                    kind: "coldSeek".to_string(),
                    phase_id: Some("cold_seek".to_string()),
                    duration_ms: None,
                    frame_index: Some(900),
                    start_frame: None,
                    end_frame: None,
                    steps: None,
                },
            ],
            close_after_run: false,
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
            phase_id: Some("scrub".to_string()),
            duration_ms: Some(100),
            frame_index: None,
            start_frame: Some(1),
            end_frame: Some(1),
            steps: Some(1),
        };
        assert!(validate_action(&action).is_err());
    }

    #[test]
    fn steady_playback_is_split_into_startup_and_steady_phases() {
        let value = scenario();
        assert!(action_has_startup_phase(&value.actions[0]));
        assert!(!action_has_startup_phase(&value.actions[1]));
    }
}
