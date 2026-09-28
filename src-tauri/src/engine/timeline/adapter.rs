use super::super::types::{BlendMode, CanvasSpec, LayerTransform, MediaTime};
use super::model::{
    Clip, MediaAssetRef, ProjectSettings, ProjectState, TimeMapping, Track, TrackKind,
};
use serde_json::Value;

/// Adapts serialized Clypra project models or frontend JSON into the native `ProjectState`.
pub struct ProjectModelAdapter;

impl ProjectModelAdapter {
    pub fn from_json_value(value: &Value) -> Result<ProjectState, String> {
        let width = value
            .get("canvasWidth")
            .or_else(|| value.get("canvas_width"))
            .and_then(|v| v.as_u64())
            .unwrap_or(1920) as u32;

        let height = value
            .get("canvasHeight")
            .or_else(|| value.get("canvas_height"))
            .and_then(|v| v.as_u64())
            .unwrap_or(1080) as u32;

        let fps = value
            .get("frameRate")
            .or_else(|| value.get("frame_rate"))
            .and_then(|v| v.as_f64())
            .unwrap_or(60.0);

        let canvas = CanvasSpec {
            width,
            height,
            fps,
            sample_rate: 48000,
        };

        let mut state = ProjectState::new(ProjectSettings {
            canvas: canvas.clone(),
            clear_color: [0.0, 0.0, 0.0, 1.0],
        });

        // 1. Parse Assets
        if let Some(assets) = value
            .get("mediaAssets")
            .or_else(|| value.get("media_assets"))
            .and_then(|v| v.as_array())
        {
            for a in assets {
                if let (Some(id), Some(path)) = (
                    a.get("id").and_then(|v| v.as_str()),
                    a.get("path").and_then(|v| v.as_str()),
                ) {
                    let dur_secs = a.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let is_missing = a
                        .get("isMissing")
                        .or_else(|| a.get("is_missing"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    state.assets.insert(
                        id.to_string(),
                        MediaAssetRef {
                            id: id.to_string(),
                            file_path: path.to_string(),
                            preview_path: a
                                .get("previewPath")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            duration: MediaTime::from_secs_f64(dur_secs),
                            width: a.get("width").and_then(|v| v.as_u64()).map(|w| w as u32),
                            height: a.get("height").and_then(|v| v.as_u64()).map(|h| h as u32),
                            is_missing,
                        },
                    );
                }
            }
        }

        // 2. Parse Tracks
        if let Some(tracks) = value.get("tracks").and_then(|v| v.as_array()) {
            for (idx, t) in tracks.iter().enumerate() {
                if let Some(id) = t.get("id").and_then(|v| v.as_str()) {
                    let name = t.get("name").and_then(|v| v.as_str()).unwrap_or("Track");
                    let kind_str = t.get("type").and_then(|v| v.as_str()).unwrap_or("video");
                    let kind = match kind_str {
                        "audio" => TrackKind::Audio,
                        "text" => TrackKind::Text,
                        "adjustment" => TrackKind::Adjustment,
                        _ => TrackKind::Video,
                    };
                    let visible = t.get("visible").and_then(|v| v.as_bool()).unwrap_or(true);
                    let muted = t.get("muted").and_then(|v| v.as_bool()).unwrap_or(false);
                    let volume = t.get("volume").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;

                    state.sequence.tracks.push(Track {
                        id: id.to_string(),
                        name: name.to_string(),
                        kind,
                        z_index: idx as i32 * 10,
                        visible,
                        muted,
                        volume,
                    });
                }
            }
        }

        // 3. Parse Clips
        if let Some(clips) = value.get("clips").and_then(|v| v.as_array()) {
            for c in clips {
                if let (Some(id), Some(track_id), Some(asset_id)) = (
                    c.get("id").and_then(|v| v.as_str()),
                    c.get("trackId")
                        .or_else(|| c.get("track_id"))
                        .and_then(|v| v.as_str()),
                    c.get("mediaId")
                        .or_else(|| c.get("asset_id"))
                        .and_then(|v| v.as_str()),
                ) {
                    let start_secs = c
                        .get("startTime")
                        .or_else(|| c.get("start_time"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    let dur_secs = c.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let trim_in = c
                        .get("trimIn")
                        .or_else(|| c.get("trim_in"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    let trim_out = c
                        .get("trimOut")
                        .or_else(|| c.get("trim_out"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(dur_secs);
                    let speed = c.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);

                    let timeline_start = MediaTime::from_secs_f64(start_secs);
                    let timeline_end = MediaTime::from_secs_f64(start_secs + dur_secs);
                    let source_start = MediaTime::from_secs_f64(trim_in);
                    let source_end = MediaTime::from_secs_f64(trim_out);

                    let x = c.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                    let y = c.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                    let width = c
                        .get("width")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(canvas.width as f64) as f32;
                    let height = c
                        .get("height")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(canvas.height as f64) as f32;
                    let rotation = c.get("rotation").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                    let opacity = c.get("opacity").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;

                    let blend_mode = match c.get("blendMode").and_then(|v| v.as_str()) {
                        Some("multiply") => BlendMode::Multiply,
                        Some("screen") => BlendMode::Screen,
                        Some("overlay") => BlendMode::Overlay,
                        _ => BlendMode::Normal,
                    };

                    state.sequence.clips.push(Clip {
                        id: id.to_string(),
                        track_id: track_id.to_string(),
                        asset_id: asset_id.to_string(),
                        name: c
                            .get("name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        timeline_start,
                        timeline_end,
                        source_start,
                        source_end,
                        time_mapping: TimeMapping::new(timeline_start, source_start, speed),
                        transform: LayerTransform {
                            x,
                            y,
                            width,
                            height,
                            scale_x: 1.0,
                            scale_y: 1.0,
                            rotation_deg: rotation,
                            anchor_x: 0.5,
                            anchor_y: 0.5,
                        },
                        opacity,
                        blend_mode,
                        z_index: 0,
                        effects: c
                            .get("effects")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default(),
                        color_grade: c.get("colorGrade").cloned(),
                        body_effect: c.get("bodyEffect").cloned(),
                    });
                }
            }
        }

        state.sequence.duration = state.sequence.calculate_duration();
        Ok(state)
    }
}
