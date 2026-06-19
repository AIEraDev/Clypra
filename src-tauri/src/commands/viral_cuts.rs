use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralCutAsset {
    pub id: String,
    pub name: String,
    pub path: String,
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralCutAnalysisRequest {
    pub assets: Vec<ViralCutAsset>,
    pub target_duration: Option<f64>,
    pub max_suggestions: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralCutMetrics {
    pub position_score: f64,
    pub duration_score: f64,
    pub bitrate_score: f64,
    pub structure_score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralCutSuggestion {
    pub id: String,
    pub asset_id: String,
    pub asset_name: String,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub score: f64,
    pub confidence: String,
    pub title: String,
    pub reasons: Vec<String>,
    pub source: String,
    pub metrics: ViralCutMetrics,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralCutAnalysisResult {
    pub suggestions: Vec<ViralCutSuggestion>,
    pub analyzed_asset_ids: Vec<String>,
    pub skipped_asset_ids: Vec<String>,
    pub generated_at: u64,
}

const MIN_CUT_DURATION_SECONDS: f64 = 6.0;
const MAX_CUT_DURATION_SECONDS: f64 = 60.0;
const DEFAULT_TARGET_DURATION_SECONDS: f64 = 24.0;
const DEFAULT_MAX_SUGGESTIONS: usize = 12;

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn round(value: f64, precision: i32) -> f64 {
    let factor = 10_f64.powi(precision);
    (value * factor).round() / factor
}

fn stable_noise(seed: &str) -> f64 {
    let mut hash: u32 = 2_166_136_261;
    for byte in seed.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    (hash % 1000) as f64 / 1000.0
}

fn score_position(start: f64, duration: f64) -> f64 {
    if duration <= 0.0 {
        return 0.0;
    }
    let progress = start / duration;
    let opening = (1.0 - progress / 0.18).max(0.0);
    let payoff = (1.0 - ((progress - 0.68).abs() / 0.22)).max(0.0);
    let middle = (1.0 - ((progress - 0.36).abs() / 0.24)).max(0.0);
    clamp(opening.max(payoff * 0.92).max(middle * 0.72), 0.0, 1.0)
}

fn score_duration(duration: f64, target_duration: f64) -> f64 {
    clamp(1.0 - ((duration - target_duration).abs() / target_duration), 0.0, 1.0)
}

fn score_bitrate(asset: &ViralCutAsset) -> f64 {
    let size = asset.size.or_else(|| fs::metadata(&asset.path).ok().map(|m| m.len()));
    let Some(size) = size else {
        return 0.45;
    };
    let bytes_per_second = size as f64 / asset.duration.max(1.0);
    let ten_mbps_bytes_per_second = 10_000_000.0 / 8.0;
    clamp(bytes_per_second / ten_mbps_bytes_per_second, 0.0, 1.0)
}

fn score_structure(asset: &ViralCutAsset, start: f64) -> f64 {
    let is_four_k = asset.width.unwrap_or(0) >= 3000 && asset.height.unwrap_or(0) >= 1600;
    let name_pulse = stable_noise(&format!("{}:{}", asset.name, (start * 10.0).round()));
    clamp(if is_four_k { 0.58 } else { 0.38 } + name_pulse * 0.34, 0.0, 1.0)
}

fn candidate_duration(asset_duration: f64, target_duration: f64) -> f64 {
    if asset_duration <= MIN_CUT_DURATION_SECONDS {
        return asset_duration.max(0.0);
    }
    if asset_duration < target_duration {
        return clamp(asset_duration, MIN_CUT_DURATION_SECONDS, target_duration);
    }
    if asset_duration >= 600.0 {
        return clamp(target_duration + 6.0, MIN_CUT_DURATION_SECONDS, MAX_CUT_DURATION_SECONDS);
    }
    target_duration
}

fn candidate_starts(asset_duration: f64, duration: f64) -> Vec<f64> {
    let max_start = (asset_duration - duration).max(0.0);
    if max_start <= 0.0 {
        return vec![0.0];
    }

    let mut starts: Vec<f64> = [0.0, 0.05, 0.12, 0.22, 0.36, 0.52, 0.68, 0.82, 0.93]
        .iter()
        .map(|ratio| (max_start * ratio).round())
        .collect();

    if asset_duration > 180.0 {
        let step = if asset_duration > 720.0 { 150.0 } else { 90.0 };
        let mut cursor = 60.0;
        while cursor < max_start {
            starts.push(cursor.round());
            cursor += step;
        }
    }

    starts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    starts.dedup_by(|a, b| (*a - *b).abs() < f64::EPSILON);
    starts.into_iter().take(16).collect()
}

fn title_for(start: f64, asset_duration: f64, score: f64) -> String {
    let progress = if asset_duration > 0.0 { start / asset_duration } else { 0.0 };
    if progress < 0.18 {
        "Opening hook candidate".to_string()
    } else if progress > 0.58 {
        if score >= 0.78 {
            "Payoff moment candidate".to_string()
        } else {
            "Late highlight candidate".to_string()
        }
    } else {
        "Mid-video lift candidate".to_string()
    }
}

fn confidence_for(score: f64) -> String {
    if score >= 0.78 {
        "high".to_string()
    } else if score >= 0.62 {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

fn reasons_for(start: f64, asset: &ViralCutAsset, duration_score: f64, bitrate_score: f64, structure_score: f64) -> Vec<String> {
    let progress = if asset.duration > 0.0 { start / asset.duration } else { 0.0 };
    let mut reasons = Vec::new();

    if progress < 0.18 {
        reasons.push("early hook".to_string());
    }
    if progress > 0.58 {
        reasons.push("late payoff".to_string());
    }
    if duration_score > 0.82 {
        reasons.push("short-form length".to_string());
    }
    if bitrate_score > 0.66 {
        reasons.push("high-detail source".to_string());
    }
    if structure_score > 0.68 {
        reasons.push("strong visual candidate".to_string());
    }

    reasons.truncate(3);
    reasons
}

#[tauri::command]
pub async fn analyze_viral_cuts(request: ViralCutAnalysisRequest) -> Result<ViralCutAnalysisResult, String> {
    if request.assets.len() > 200 {
        return Err("Too many assets for one analysis pass".to_string());
    }

    let target_duration = clamp(
        request.target_duration.unwrap_or(DEFAULT_TARGET_DURATION_SECONDS),
        MIN_CUT_DURATION_SECONDS,
        MAX_CUT_DURATION_SECONDS,
    );
    let max_suggestions = request.max_suggestions.unwrap_or(DEFAULT_MAX_SUGGESTIONS).clamp(1, 50);
    let mut suggestions = Vec::new();
    let mut analyzed_asset_ids = Vec::new();
    let mut skipped_asset_ids = Vec::new();

    for asset in &request.assets {
        if asset.path.len() > 4096 || !Path::new(&asset.path).exists() {
            skipped_asset_ids.push(asset.id.clone());
            continue;
        }
        if !asset.duration.is_finite() || asset.duration < 1.0 {
            skipped_asset_ids.push(asset.id.clone());
            continue;
        }

        analyzed_asset_ids.push(asset.id.clone());
        let cut_duration = candidate_duration(asset.duration, target_duration);

        for start in candidate_starts(asset.duration, cut_duration) {
            let end = clamp(start + cut_duration, start, asset.duration);
            let duration = end - start;
            if duration < MIN_CUT_DURATION_SECONDS.min(asset.duration) {
                continue;
            }

            let position_score = score_position(start, asset.duration);
            let duration_score = score_duration(duration, target_duration);
            let bitrate_score = score_bitrate(asset);
            let structure_score = score_structure(asset, start);
            let score = clamp(
                position_score * 0.36 + duration_score * 0.26 + bitrate_score * 0.18 + structure_score * 0.2,
                0.0,
                1.0,
            );

            suggestions.push(ViralCutSuggestion {
                id: format!("viral-{}-{}-{}", asset.id, (start * 100.0).round(), (end * 100.0).round()),
                asset_id: asset.id.clone(),
                asset_name: asset.name.clone(),
                start: round(start, 3),
                end: round(end, 3),
                duration: round(duration, 3),
                score: round(score, 4),
                confidence: confidence_for(score),
                title: title_for(start, asset.duration, score),
                reasons: reasons_for(start, asset, duration_score, bitrate_score, structure_score),
                source: "native".to_string(),
                metrics: ViralCutMetrics {
                    position_score: round(position_score, 4),
                    duration_score: round(duration_score, 4),
                    bitrate_score: round(bitrate_score, 4),
                    structure_score: round(structure_score, 4),
                },
            });
        }
    }

    suggestions.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.duration.partial_cmp(&a.duration).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut per_asset_count = std::collections::HashMap::<String, usize>::new();
    suggestions.retain(|suggestion| {
        let count = per_asset_count.entry(suggestion.asset_id.clone()).or_insert(0);
        if *count >= 3 {
            return false;
        }
        *count += 1;
        true
    });
    suggestions.truncate(max_suggestions);

    let generated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(ViralCutAnalysisResult {
        suggestions,
        analyzed_asset_ids,
        skipped_asset_ids,
        generated_at,
    })
}
