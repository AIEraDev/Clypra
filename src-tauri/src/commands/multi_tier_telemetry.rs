//! multi_tier_telemetry.rs — Consolidated Tauri IPC command for multi-tier performance telemetry.
//!
//! Phase 4 of Clypra Multi-Tier Optimization: Multi-Tier Telemetry.
//!
//! Bundles:
//! - Tier 3 Audio: `AudioMixGraph` snapshot (contiguous fast-path vs fallback, culling, stack overflows)
//! - Tier 3 Native CPAL: `NativeAudioClock` production mixer metrics (culling, overflows, lock misses)
//! - Tier 3 Compositor: `FrameResourceCache` decoded and composed LRU cache statistics

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

use crate::audio::mixer::{AudioMixerTelemetrySnapshot, GLOBAL_AUDIO_MIXER_METRICS};
use crate::native_audio::{NativeAudioClock, NativeMixerTelemetrySnapshot};
use crate::wgpu_compositor::frame_cache::{get_global_frame_cache_stats, FrameCacheStats};

/// Consolidated report returned to the frontend IPC and session logger.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiTierNativeTelemetryReport {
    /// Utility / batch mix-graph performance metrics.
    pub audio_mix_graph: AudioMixerTelemetrySnapshot,
    /// Production CPAL real-time audio callback mixer metrics.
    pub native_mixer: NativeMixerTelemetrySnapshot,
    /// Decoded video frame LRU cache statistics.
    pub frame_cache_decoded: FrameCacheStats,
    /// Composed video frame LRU cache statistics.
    pub frame_cache_composed: FrameCacheStats,
}

/// Retrieve unified multi-tier native performance telemetry snapshot.
#[tauri::command]
pub fn get_multi_tier_native_telemetry(
    app: AppHandle,
) -> Result<MultiTierNativeTelemetryReport, String> {
    let audio_mix_graph = GLOBAL_AUDIO_MIXER_METRICS.snapshot();

    let native_mixer = if let Some(clock_state) = app.try_state::<Arc<Mutex<NativeAudioClock>>>() {
        if let Ok(clock) = clock_state.lock() {
            clock.mixer_telemetry_snapshot()
        } else {
            NativeMixerTelemetrySnapshot::default()
        }
    } else {
        NativeMixerTelemetrySnapshot::default()
    };

    let (frame_cache_decoded, frame_cache_composed) = get_global_frame_cache_stats();

    Ok(MultiTierNativeTelemetryReport {
        audio_mix_graph,
        native_mixer,
        frame_cache_decoded,
        frame_cache_composed,
    })
}
