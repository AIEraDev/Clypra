//! Deterministic split-clip audio reproduction coverage.
//!
//! The fixture contains three two-second tone regions with distinct
//! frequencies and amplitudes. Keeping it generated at test time avoids
//! adding binary media to the repository while still exercising FFmpeg's
//! container seek and native PCM mixing paths.

use super::TICKS_PER_SECOND;
use crate::commands::media::extract_waveform_data;
use crate::native_audio::{decode_native_audio_clip, NativeAudioMixer, NativePcmClip};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const SAMPLE_RATE: u32 = 48_000;
const SEGMENT_SECONDS: i64 = 2;
const TONE_FREQUENCIES: [f32; 3] = [440.0, 880.0, 1760.0];
const TONE_AMPLITUDES: [f32; 3] = [0.2, 0.5, 0.9];

#[tokio::test]
async fn split_clip_matrix_preserves_source_segments_and_scopes_waveforms() {
    let fixture = create_fixture().expect("ffmpeg should create the deterministic A/V fixture");

    let result = async {
        // 1. One split, continuous boundary playback. Both clips are decoded
        // independently and then mixed together by timeline position.
        let split_once = decode_segments(&fixture, &[("left", 0, 0), ("right", 2, 2)]).await;
        assert_segment(&split_once[0], 0);
        assert_segment(&split_once[1], 1);
        assert_mixed_boundary(&split_once, 2);

        // 2. Two splits, three pieces, one continuous pass.
        let split_twice = decode_segments(
            &fixture,
            &[("piece-a", 0, 0), ("piece-b", 2, 2), ("piece-c", 4, 4)],
        )
        .await;
        for (index, clip) in split_twice.iter().enumerate() {
            assert_segment(clip, index);
        }
        assert_mixed_boundary(&split_twice, 2);
        assert_mixed_boundary(&split_twice, 4);

        // 3. Independent placements of the same source file use their own
        // clip IDs and source starts; no shared decoder position is involved.
        let independent = decode_segments(
            &fixture,
            &[("independent-a", 0, 4), ("independent-b", 2, 0)],
        )
        .await;
        assert_segment(&independent[0], 2);
        assert_segment(&independent[1], 0);

        // 4. Immediate seek into the second half is represented by decoding
        // the requested source offset directly.
        let immediate_seek = decode_one(&fixture, "seek-right", 2, 2).await;
        assert_segment(&immediate_seek, 1);
        assert_mixed_boundary(std::slice::from_ref(&immediate_seek), 2);

        // 5. Detached audio retains the source path explicitly and therefore
        // follows the same source-offset behavior as a normal audio clip.
        let detached = decode_one(&fixture, "detached-right", 2, 2).await;
        assert_segment(&detached, 1);
        assert_mixed_boundary(std::slice::from_ref(&detached), 2);

        // This is intentionally audio-content-only. It does not exercise the
        // evaluator/compositor path for detached audio; any visual-layer
        // failure there belongs to the separately tracked evaluator issue.

        // 6. Rapid scrubbing is a timeline seek over already-installed PCM;
        // repeatedly querying the same graph must never expose the other half.
        assert_mixed_boundary(&split_once, 0);
        assert_mixed_boundary(&split_once, 2);

        // 7. Native audio has no separate lookahead decoder path. The native
        // equivalent is a future clip already installed before the playhead
        // reaches it; it must remain silent before its boundary and begin with
        // its own source segment exactly at the boundary.
        assert_tone_at(&split_once, 1, 0);
        assert_tone_at(&split_once, 2, 1);
        assert_mixed_boundary(&split_once, 0);
        assert_mixed_boundary(&split_once, 2);

        // The native waveform command is passed the trimmed source range. The
        // amplitude-coded fixture makes the scoped result observable.
        let scoped = extract_waveform_data(
            fixture.to_string_lossy().to_string(),
            8,
            Some(2.0),
            Some(2.0),
        )
        .await
        .expect("scoped waveform extraction should succeed");
        assert_eq!(scoped.len(), 8);
        let scoped_peak = scoped
            .iter()
            .map(|bucket| bucket.peak)
            .fold(0.0_f32, f32::max);
        assert!(
            scoped_peak > 0.02 && scoped_peak < 0.15,
            "middle segment peak was {scoped_peak}"
        );

        Ok::<(), String>(())
    }
    .await;

    let _ = std::fs::remove_file(&fixture);
    result.expect("split-clip reproduction matrix failed");
}

async fn decode_segments(path: &Path, specs: &[(&str, i64, i64)]) -> Vec<NativePcmClip> {
    let mut clips = Vec::with_capacity(specs.len());
    for (id, timeline_start, source_start) in specs {
        clips.push(decode_one(path, id, *timeline_start, *source_start).await);
    }
    clips
}

async fn decode_one(
    path: &Path,
    id: &str,
    timeline_start: i64,
    source_start: i64,
) -> NativePcmClip {
    decode_native_audio_clip(
        path,
        id.to_string(),
        timeline_start * TICKS_PER_SECOND,
        source_start * TICKS_PER_SECOND,
        SEGMENT_SECONDS * TICKS_PER_SECOND,
        1.0,
        0,
        0,
        SAMPLE_RATE,
        1,
    )
    .await
    .expect("fixture audio should decode")
}

fn assert_segment(clip: &NativePcmClip, segment: usize) {
    let expected_frequency = TONE_FREQUENCIES[segment];
    let expected_amplitude = TONE_AMPLITUDES[segment];
    assert_eq!(
        clip.samples.len(),
        (SEGMENT_SECONDS as usize) * SAMPLE_RATE as usize * usize::from(clip.channels),
        "decoded sample count must match the requested split duration"
    );
    let energy = tone_energy(&clip.samples, clip.sample_rate, expected_frequency);
    let competing = TONE_FREQUENCIES
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != segment)
        .map(|(_, frequency)| tone_energy(&clip.samples, clip.sample_rate, *frequency))
        .fold(0.0_f32, f32::max);
    assert!(
        energy > competing * 2.0,
        "expected {expected_frequency}Hz energy {energy} to dominate {competing}"
    );

    let rms = clip
        .samples
        .chunks(clip.channels as usize)
        .map(|frame| frame[0] * frame[0])
        .sum::<f32>()
        / (clip.samples.len() / clip.channels as usize) as f32;
    let rms = rms.sqrt();
    // FFmpeg's sine source has a conservative default amplitude; the fixture
    // volume factors still make the three regions distinguishable.
    assert!(
        rms > expected_amplitude * 0.05,
        "expected segment amplitude near {expected_amplitude}, got rms {rms}"
    );
}

fn assert_mixed_boundary(clips: &[NativePcmClip], boundary_seconds: i64) {
    assert_tone_at(
        clips,
        boundary_seconds,
        (boundary_seconds / SEGMENT_SECONDS) as usize,
    );
}

fn assert_tone_at(clips: &[NativePcmClip], timeline_seconds: i64, expected_segment: usize) {
    let mut mixer = NativeAudioMixer::default();
    for clip in clips {
        mixer
            .install_clip(clip.clone())
            .expect("decoded split clip should install in the native mixer");
    }

    let mut output = vec![0.0_f32; 4_800];
    assert!(mixer.mix_into(
        &mut output,
        1,
        SAMPLE_RATE,
        timeline_seconds * TICKS_PER_SECOND,
        1.0,
    ));
    let observed = tone_energy_slice(&output, SAMPLE_RATE, TONE_FREQUENCIES[expected_segment]);
    let competing = TONE_FREQUENCIES
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != expected_segment)
        .map(|(_, frequency)| tone_energy_slice(&output, SAMPLE_RATE, *frequency))
        .fold(0.0_f32, f32::max);
    assert!(
        observed > competing * 1.5,
        "timeline {timeline_seconds}s selected the wrong tone"
    );
}

fn tone_energy(samples: &[f32], sample_rate: u32, frequency: f32) -> f32 {
    tone_energy_slice(
        &samples[..samples.len().min(sample_rate as usize)],
        sample_rate,
        frequency,
    )
}

fn tone_energy_slice(samples: &[f32], sample_rate: u32, frequency: f32) -> f32 {
    let angular = 2.0 * std::f32::consts::PI * frequency / sample_rate as f32;
    let (sin_sum, cos_sum) =
        samples
            .iter()
            .enumerate()
            .fold((0.0, 0.0), |(sin_sum, cos_sum), (index, sample)| {
                let phase = angular * index as f32;
                (
                    sin_sum + sample * phase.sin(),
                    cos_sum + sample * phase.cos(),
                )
            });
    (sin_sum * sin_sum + cos_sum * cos_sum).sqrt()
}

fn create_fixture() -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let path = std::env::temp_dir().join(format!("clypra-split-audio-{nonce}.mp4"));
    let filter = "[1:a]volume=0.2[a1];[2:a]volume=0.5[a2];[3:a]volume=0.9[a3];[a1][a2][a3]concat=n=3:v=0:a=1[a]";
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=16x16:r=30:d=6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2:sample_rate=48000",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=2:sample_rate=48000",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1760:duration=2:sample_rate=48000",
            "-filter_complex",
            filter,
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-t",
            "6",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "1",
            path.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|error| format!("failed to launch ffmpeg: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(path)
}
