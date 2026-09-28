//! Pure Timeline Evaluator
//!
//! Architectural Invariant:
//! ------------------------
//! RenderPlan is an evaluation result.
//! It is NOT editor state.
//! It is NOT playback state.
//! It is NOT a transport protocol.
//! It is NOT owned by React.
//!
//! The TimelineEvaluator is a pure function:
//! (&ProjectState, MediaTime, generation) -> RenderPlan.
//! It performs NO GPU operations, NO decoding, NO disk I/O, NO IPC, and NO state mutation.

use super::super::render_plan::{AudioPlan, AudioTrackPlan, RenderLayer, RenderPlan};
use super::super::types::{LayerVisibility, MediaTime};
use super::model::{ProjectState, TrackKind};

/// Trait implemented by pure timeline evaluators.
pub trait TimelineEvaluator: Send + Sync {
    /// Purely evaluates the authoritative project state at timeline timestamp T.
    fn evaluate(&self, project: &ProjectState, time: MediaTime, generation: u64) -> RenderPlan;
}

/// The canonical deterministic timeline evaluator for Clypra.
#[derive(Debug, Default, Clone)]
pub struct PureTimelineEvaluator;

impl PureTimelineEvaluator {
    pub fn new() -> Self {
        Self
    }
}

impl TimelineEvaluator for PureTimelineEvaluator {
    fn evaluate(&self, project: &ProjectState, time: MediaTime, generation: u64) -> RenderPlan {
        let mut visual_layers: Vec<RenderLayer> = Vec::new();
        let mut audio_tracks: Vec<AudioTrackPlan> = Vec::new();

        // Storing active visual tracks in a map for fast lookup
        let tracks_by_id: std::collections::HashMap<&str, &super::model::Track> = project
            .sequence
            .tracks
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();

        for clip in &project.sequence.clips {
            // 1. Time boundary check: clip must cover the query time T
            if !clip.is_active_at(time) {
                continue;
            }

            // 2. Track resolution and visibility check
            let track = match tracks_by_id.get(clip.track_id.as_str()) {
                Some(t) => *t,
                None => continue,
            };

            // 3. Skip missing or offline assets if recorded in the asset registry
            if let Some(asset) = project.assets.get(&clip.asset_id) {
                if asset.is_missing {
                    continue;
                }
            }

            // 4. Map source time deterministically from timeline time
            let source_time = clip.time_mapping.source_time_at(time);

            // 5. Visual track processing (Video, Text, Adjustment)
            if track.kind != TrackKind::Audio {
                // If track is hidden or clip is fully transparent, skip visual emission
                if !track.visible || clip.opacity <= 0.001 {
                    continue;
                }

                let effective_z_index = track.z_index + clip.z_index;

                visual_layers.push(RenderLayer {
                    layer_id: clip.id.clone(),
                    clip_id: clip.id.clone(),
                    asset_id: clip.asset_id.clone(),
                    source_time,
                    transform: clip.transform.clone(),
                    opacity: clip.opacity,
                    blend_mode: clip.blend_mode,
                    z_index: effective_z_index,
                    visibility: LayerVisibility::Visible,
                    color_grade: clip.color_grade.clone(),
                    body_effect: clip.body_effect.clone(),
                    effects: clip.effects.clone(),
                });
            }

            // 6. Audio track processing
            if (track.kind == TrackKind::Audio || track.kind == TrackKind::Video) && !track.muted {
                audio_tracks.push(AudioTrackPlan {
                    track_id: track.id.clone(),
                    asset_id: clip.asset_id.clone(),
                    source_time,
                    gain: track.volume,
                    pan: 0.0,
                    is_muted: false,
                });
            }
        }

        // Sort visual layers by stacking order (lower z_index rendered first)
        visual_layers.sort_by_key(|layer| layer.z_index);

        RenderPlan {
            generation,
            project_revision: project.revision,
            time,
            canvas: project.settings.canvas.clone(),
            clear_color: project.settings.clear_color,
            layers: visual_layers,
            audio: AudioPlan {
                tracks: audio_tracks,
                master_gain: 1.0,
            },
        }
    }
}
