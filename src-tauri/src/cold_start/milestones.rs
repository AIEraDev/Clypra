use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::cold_start::models::{AudioColdMetrics, LaunchMilestones};
use crate::cold_start::os::load_opt_u64;
use crate::cold_start::recorder::{COLD_REPORT, PROCESS_START};

// ── Audio Cold-Path Safety Counters ──────────────────────────────────────────
pub(crate) static AUDIO_PCM_BYTES: AtomicU64 = AtomicU64::new(0);
pub(crate) static AUDIO_CAP_TRUNCATIONS: AtomicU64 = AtomicU64::new(0);
pub(crate) static AUDIO_CLI_FALLBACKS: AtomicU64 = AtomicU64::new(0);
pub(crate) static AUDIO_FALLBACK_REASONS: Lazy<Mutex<Vec<String>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

// ── Launch Milestones (One-time atomics) ──────────────────────────────────────
pub(crate) static FIRST_SOUND_AT_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static FIRST_SOUND_LATENCY_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static FIRST_SOUND_LATENCY_SET: AtomicBool = AtomicBool::new(false);
pub(crate) static WINDOW_CREATED_AT_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static WINDOW_SHOWN_AT_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static TAURI_READY_AT_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static NAVIGATION_START_MS: AtomicU64 = AtomicU64::new(0);
pub(crate) static DOM_CONTENT_LOADED_MS: AtomicU64 = AtomicU64::new(0);
pub(crate) static APP_MOUNTED_MS: AtomicU64 = AtomicU64::new(0);
pub(crate) static SHELL_PAINTED_MS: AtomicU64 = AtomicU64::new(0);
pub(crate) static INTERACTIVE_AT_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static PROJECT_OPEN_REQUESTED_AT_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static FIRST_FRAME_AT_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static FIRST_FRAME_PAINTED_MS: AtomicU64 = AtomicU64::new(0);
pub(crate) static FIRST_FRAME_PAINTED_FROM_OPEN_MS: AtomicU64 = AtomicU64::new(0);
pub(crate) static SMOOTH_PLAYBACK_AT_US: AtomicU64 = AtomicU64::new(0);
pub(crate) static SMOOTH_PLAYBACK_TARGET_FPS: AtomicU32 = AtomicU32::new(0);

// ── Interactive wait tracking ────────────────────────────────────────────────
pub(crate) static GPU_AWAITED_AT_US: AtomicU64 = AtomicU64::new(0);

// ── Focus & Window State Tracking ───────────────────────────────────────────
pub(crate) static DOCUMENT_VISIBILITY_STATE: Lazy<Mutex<Option<String>>> =
    Lazy::new(|| Mutex::new(None));
pub(crate) static DOCUMENT_HAS_FOCUS: AtomicBool = AtomicBool::new(true);
pub(crate) static WINDOW_IS_FOCUSED: AtomicBool = AtomicBool::new(true);
pub(crate) static WINDOW_IS_VISIBLE: AtomicBool = AtomicBool::new(true);
pub(crate) static QUIESCENCE_WAIT_MS: AtomicU64 = AtomicU64::new(0);
pub(crate) static APP_NAP_DISABLED: AtomicBool = AtomicBool::new(false);
pub(crate) static IS_VALID_RUN: AtomicBool = AtomicBool::new(true);
pub(crate) static INVALID_REASON: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

// ── Clip Ordinal (Never leak file paths into telemetry) ───────────────────────
pub(crate) static CLIP_ORDINAL: AtomicU64 = AtomicU64::new(0);

// ── Milestone Recording ───────────────────────────────────────────────────────

pub fn record_window_created() {
    if WINDOW_CREATED_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ =
            WINDOW_CREATED_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_window_shown() {
    if WINDOW_SHOWN_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ =
            WINDOW_SHOWN_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_tauri_ready() {
    if TAURI_READY_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ =
            TAURI_READY_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_first_sound(latency_us: u64) {
    if FIRST_SOUND_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        if FIRST_SOUND_AT_US
            .compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            FIRST_SOUND_LATENCY_US.store(latency_us, Ordering::Relaxed);
            FIRST_SOUND_LATENCY_SET.store(true, Ordering::Release);
        }
    }
}

pub fn mark_gpu_awaited() {
    if GPU_AWAITED_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ = GPU_AWAITED_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn get_gpu_awaited_at_us() -> u64 {
    GPU_AWAITED_AT_US.load(Ordering::Relaxed)
}

pub fn record_first_frame() {
    if FIRST_FRAME_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ = FIRST_FRAME_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_window_state(is_visible: bool, is_focused: bool) {
    WINDOW_IS_VISIBLE.store(is_visible, Ordering::Relaxed);
    WINDOW_IS_FOCUSED.store(is_focused, Ordering::Relaxed);
}

pub fn record_first_frame_painted(ms: Option<u64>) {
    let elapsed_us = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
    let ms_val = ms.unwrap_or(elapsed_us / 1000);
    if FIRST_FRAME_PAINTED_MS.load(Ordering::Relaxed) == 0 {
        let _ = FIRST_FRAME_PAINTED_MS.compare_exchange(0, ms_val, Ordering::AcqRel, Ordering::Relaxed);
    }
    let open_us = PROJECT_OPEN_REQUESTED_AT_US.load(Ordering::Relaxed);
    if open_us > 0 && FIRST_FRAME_PAINTED_FROM_OPEN_MS.load(Ordering::Relaxed) == 0 {
        let diff_ms = elapsed_us.saturating_sub(open_us) / 1000;
        let _ = FIRST_FRAME_PAINTED_FROM_OPEN_MS.compare_exchange(0, diff_ms, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_interactive() {
    if INTERACTIVE_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ = INTERACTIVE_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_smooth_playback(us: u64, target_fps: Option<u32>) {
    if SMOOTH_PLAYBACK_AT_US.load(Ordering::Relaxed) == 0
        && SMOOTH_PLAYBACK_AT_US
            .compare_exchange(0, us, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
    {
        if let Some(fps) = target_fps {
            SMOOTH_PLAYBACK_TARGET_FPS.store(fps, Ordering::Relaxed);
        }
    }
}

pub fn record_project_open_requested() {
    if PROJECT_OPEN_REQUESTED_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ = PROJECT_OPEN_REQUESTED_AT_US.compare_exchange(
            0,
            elapsed,
            Ordering::AcqRel,
            Ordering::Relaxed,
        );
    }
}

pub fn get_project_open_requested_at_us() -> u64 {
    PROJECT_OPEN_REQUESTED_AT_US.load(Ordering::Relaxed)
}

/// Returns the presentation timestamp of the first frame (native or canvas painted) in microseconds since process start.
pub fn get_first_frame_painted_at_us() -> u64 {
    let native_us = FIRST_FRAME_AT_US.load(Ordering::Relaxed);
    if native_us > 0 {
        return native_us;
    }
    FIRST_FRAME_PAINTED_MS.load(Ordering::Relaxed).saturating_mul(1000)
}

pub fn record_frontend_launch_milestones(
    navigation_start_wall_ms: Option<u64>,
    dom_content_loaded_wall_ms: Option<u64>,
    app_mounted_wall_ms: Option<u64>,
    shell_painted_wall_ms: Option<u64>,
    interactive_wall_ms: Option<u64>,
    project_open_requested_wall_ms: Option<u64>,
    first_frame_painted_wall_ms: Option<u64>,
    first_frame_painted_from_open_ms: Option<u64>,
    smooth_playback_wall_ms: Option<u64>,
    smooth_playback_target_fps: Option<u32>,
    document_visibility_state: Option<String>,
    document_has_focus: Option<bool>,
    window_is_focused: Option<bool>,
    window_is_visible: Option<bool>,
    quiescence_wait_ms: Option<u64>,
    app_nap_disabled: Option<bool>,
) {
    if let Some(ref vis) = document_visibility_state {
        if let Ok(mut lock) = DOCUMENT_VISIBILITY_STATE.lock() {
            *lock = Some(vis.clone());
        }
        if vis != "visible" {
            IS_VALID_RUN.store(false, Ordering::Relaxed);
            if let Ok(mut lock) = INVALID_REASON.lock() {
                if lock.is_none() {
                    *lock = Some("window not visible".to_string());
                }
            }
        }
    }
    if let Some(focus) = document_has_focus {
        DOCUMENT_HAS_FOCUS.store(focus, Ordering::Relaxed);
    }
    if let Some(foc) = window_is_focused {
        WINDOW_IS_FOCUSED.store(foc, Ordering::Relaxed);
    }
    let has_focus = document_has_focus.unwrap_or(false) || window_is_focused.unwrap_or(false);
    if !has_focus {
        IS_VALID_RUN.store(false, Ordering::Relaxed);
        if let Ok(mut lock) = INVALID_REASON.lock() {
            if lock.is_none() {
                *lock = Some("window not focused".to_string());
            }
        }
    }
    if let Some(vis) = window_is_visible {
        WINDOW_IS_VISIBLE.store(vis, Ordering::Relaxed);
        if !vis {
            IS_VALID_RUN.store(false, Ordering::Relaxed);
            if let Ok(mut lock) = INVALID_REASON.lock() {
                if lock.is_none() {
                    *lock = Some("window not visible".to_string());
                }
            }
        }
    }
    if let Some(q_ms) = quiescence_wait_ms {
        QUIESCENCE_WAIT_MS.store(q_ms, Ordering::Relaxed);
    }
    if let Some(nap) = app_nap_disabled {
        APP_NAP_DISABLED.store(nap, Ordering::Relaxed);
    }

    let epoch_ms = COLD_REPORT.lock().map(|s| s.process_epoch_ms).unwrap_or(0);

    let to_elapsed_ms = |wall_ms: u64| -> u64 {
        if wall_ms >= epoch_ms && epoch_ms > 0 {
            wall_ms.saturating_sub(epoch_ms)
        } else {
            wall_ms
        }
    };

    if let Some(wall_ms) = navigation_start_wall_ms {
        NAVIGATION_START_MS.store(to_elapsed_ms(wall_ms), Ordering::Relaxed);
    }
    if let Some(wall_ms) = dom_content_loaded_wall_ms {
        DOM_CONTENT_LOADED_MS.store(to_elapsed_ms(wall_ms), Ordering::Relaxed);
    }
    if let Some(wall_ms) = app_mounted_wall_ms {
        APP_MOUNTED_MS.store(to_elapsed_ms(wall_ms), Ordering::Relaxed);
    }
    if let Some(wall_ms) = shell_painted_wall_ms {
        SHELL_PAINTED_MS.store(to_elapsed_ms(wall_ms), Ordering::Relaxed);
    }
    if let Some(wall_ms) = interactive_wall_ms {
        let elapsed_us = to_elapsed_ms(wall_ms).saturating_mul(1000);
        if INTERACTIVE_AT_US.load(Ordering::Relaxed) == 0 {
            let _ = INTERACTIVE_AT_US.compare_exchange(
                0,
                elapsed_us,
                Ordering::AcqRel,
                Ordering::Relaxed,
            );
        }
    }
    if let Some(wall_ms) = project_open_requested_wall_ms {
        let elapsed_us = to_elapsed_ms(wall_ms).saturating_mul(1000);
        if PROJECT_OPEN_REQUESTED_AT_US.load(Ordering::Relaxed) == 0 {
            let _ = PROJECT_OPEN_REQUESTED_AT_US.compare_exchange(
                0,
                elapsed_us,
                Ordering::AcqRel,
                Ordering::Relaxed,
            );
        }
    }
    if let Some(wall_ms) = first_frame_painted_wall_ms {
        record_first_frame_painted(Some(to_elapsed_ms(wall_ms)));
    }
    if let Some(ms) = first_frame_painted_from_open_ms {
        if FIRST_FRAME_PAINTED_FROM_OPEN_MS.load(Ordering::Relaxed) == 0 {
            let _ = FIRST_FRAME_PAINTED_FROM_OPEN_MS.compare_exchange(
                0,
                ms,
                Ordering::AcqRel,
                Ordering::Relaxed,
            );
        }
    }
    if let Some(wall_ms) = smooth_playback_wall_ms {
        let elapsed_us = to_elapsed_ms(wall_ms).saturating_mul(1000);
        record_smooth_playback(elapsed_us, smooth_playback_target_fps);
    }
}

pub fn next_clip_index() -> u64 {
    CLIP_ORDINAL.fetch_add(1, Ordering::Relaxed) + 1
}

pub fn add_audio_pcm_bytes(bytes: u64) {
    AUDIO_PCM_BYTES.fetch_add(bytes, Ordering::Relaxed);
}

pub fn record_audio_cap_truncation() {
    AUDIO_CAP_TRUNCATIONS.fetch_add(1, Ordering::Relaxed);
}

pub fn record_audio_cli_fallback(reason: impl Into<String>) {
    AUDIO_CLI_FALLBACKS.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut reasons) = AUDIO_FALLBACK_REASONS.lock() {
        reasons.push(reason.into());
    }
}

pub(crate) fn collect_launch_milestones(pre_main_ms: Option<u64>) -> LaunchMilestones {
    LaunchMilestones {
        pre_main_ms,
        window_created_at_us: load_opt_u64(&WINDOW_CREATED_AT_US),
        window_shown_at_us: load_opt_u64(&WINDOW_SHOWN_AT_US),
        tauri_ready_at_us: load_opt_u64(&TAURI_READY_AT_US),
        navigation_start_ms: load_opt_u64(&NAVIGATION_START_MS),
        dom_content_loaded_ms: load_opt_u64(&DOM_CONTENT_LOADED_MS),
        app_mounted_ms: load_opt_u64(&APP_MOUNTED_MS),
        shell_painted_ms: load_opt_u64(&SHELL_PAINTED_MS),
        first_sound_at_us: load_opt_u64(&FIRST_SOUND_AT_US),
        first_sound_latency_us: if FIRST_SOUND_LATENCY_SET.load(Ordering::Acquire) {
            Some(FIRST_SOUND_LATENCY_US.load(Ordering::Relaxed))
        } else {
            None
        },
        interactive_at_us: load_opt_u64(&INTERACTIVE_AT_US),
        project_open_requested_at_us: load_opt_u64(&PROJECT_OPEN_REQUESTED_AT_US),
        first_frame_at_us: load_opt_u64(&FIRST_FRAME_AT_US),
        first_frame_painted_ms: load_opt_u64(&FIRST_FRAME_PAINTED_MS),
        first_frame_painted_from_open_ms: load_opt_u64(&FIRST_FRAME_PAINTED_FROM_OPEN_MS),
        smooth_playback_at_us: load_opt_u64(&SMOOTH_PLAYBACK_AT_US),
        smooth_playback_target_fps: {
            let fps = SMOOTH_PLAYBACK_TARGET_FPS.load(Ordering::Relaxed);
            if fps == 0 {
                None
            } else {
                Some(fps)
            }
        },
        document_visibility_state: DOCUMENT_VISIBILITY_STATE.lock().map(|g| g.clone()).unwrap_or(None),
        document_has_focus: Some(DOCUMENT_HAS_FOCUS.load(Ordering::Relaxed)),
        window_is_focused: Some(WINDOW_IS_FOCUSED.load(Ordering::Relaxed)),
        window_is_visible: Some(WINDOW_IS_VISIBLE.load(Ordering::Relaxed)),
        quiescence_wait_ms: {
            let q = QUIESCENCE_WAIT_MS.load(Ordering::Relaxed);
            if q == 0 { None } else { Some(q) }
        },
        app_nap_disabled: Some(APP_NAP_DISABLED.load(Ordering::Relaxed)),
        valid: IS_VALID_RUN.load(Ordering::Relaxed),
        invalid_reason: INVALID_REASON.lock().map(|g| g.clone()).unwrap_or(None),
    }
}

pub(crate) fn collect_audio_metrics() -> AudioColdMetrics {
    AudioColdMetrics {
        pcm_bytes: AUDIO_PCM_BYTES.load(Ordering::Relaxed),
        cap_truncations: AUDIO_CAP_TRUNCATIONS.load(Ordering::Relaxed),
        cli_fallbacks: AUDIO_CLI_FALLBACKS.load(Ordering::Relaxed),
        fallback_reasons: AUDIO_FALLBACK_REASONS.lock().map(|r| r.clone()).unwrap_or_default(),
    }
}
