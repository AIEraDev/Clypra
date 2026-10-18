use super::types::{ExportAudioClip, ExportAudioKeyframe};

/// Probe whether a media file has an audio stream.
///
/// FIX (BUG-H4): This is now async using tokio::process::Command.
/// Previously it used std::process::Command (blocking), which stalled the
/// Tokio async runtime for the entire duration of each ffprobe call —
/// starving other concurrent async tasks (progress updates, IPC responses).
pub(crate) async fn has_audio_stream(path: &str) -> bool {
    let output = crate::commands::binary_resolver::create_async_command("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            path,
        ])
        .output()
        .await;

    match output {
        Ok(out) => {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let has_audio = stdout.contains("audio");
                log::debug!("[has_audio_stream] {} → has_audio={}", path, has_audio);
                has_audio
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                log::debug!(
                    "[has_audio_stream] ffprobe non-zero exit for {}: {}",
                    path,
                    stderr.trim()
                );
                false
            }
        }
        Err(e) => {
            log::debug!("[has_audio_stream] Could not spawn ffprobe: {}", e);
            false
        }
    }
}



pub(crate) fn build_export_audio_filter_complex(
    valid_audio_clips: &[ExportAudioClip],
    total_duration: f64,
) -> String {
    let mut filter_complex = String::new();

    // Native compositor readback is already top-to-bottom RGBA. Do not
    // apply the legacy WebGL readPixels vertical flip here; doing so
    // turns every compositor export upside down.
    filter_complex.push_str("[0:v]null[v];");

    // Generate a silent audio track matching the exact video duration.
    // This serves as a duration anchor. When mixed with duration=longest,
    // it ensures that the mixed audio stream has the exact same duration
    // as the video, preventing early audio cut-off from other clips ending.
    filter_complex.push_str(&format!(
        "anullsrc=channel_layout=stereo:sample_rate=48000:duration={:.3}[asilence];",
        total_duration
    ));

    for (idx, clip) in valid_audio_clips.iter().enumerate() {
        let input_idx = idx + 1; // input 0 is pipe:0 (video)
        let delay_ms = (clip.start_time * 1000.0) as i64;
        let end_time = clip.trim_in + clip.duration;

        let fade_in = clip.fade_in.unwrap_or(0.0).max(0.0).min(clip.duration);
        let fade_out = clip.fade_out.unwrap_or(0.0).max(0.0).min(clip.duration);

        // Ensure audio timebase alignment with video to prevent A/V drift
        // Resample to consistent 48kHz before processing to match video timebase
        let mut chain = format!(
            "[{}:a]aresample=48000,atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS",
            input_idx, clip.trim_in, end_time
        );

        let in_curve = match clip.fade_in_curve.as_deref() {
            Some("exponential") => ":curve=exp",
            Some("logarithmic") => ":curve=log",
            Some("s-curve") => ":curve=qsin",
            _ => ":curve=tri",
        };
        let out_curve = match clip.fade_out_curve.as_deref() {
            Some("exponential") => ":curve=exp",
            Some("logarithmic") => ":curve=log",
            Some("s-curve") => ":curve=qsin",
            _ => ":curve=tri",
        };

        if fade_in > 0.001 {
            chain.push_str(&format!(",afade=t=in:st=0:d={:.3}{}", fade_in, in_curve));
        }
        if fade_out > 0.001 {
            let fade_start = (clip.duration - fade_out).max(0.0);
            chain.push_str(&format!(
                ",afade=t=out:st={:.3}:d={:.3}{}",
                fade_start, fade_out, out_curve
            ));
        }

        // Apply 3-Band Equalizer if configured
        if let (Some(low), Some(mid), Some(high)) = (clip.eq_low, clip.eq_mid, clip.eq_high) {
            if low.abs() > 0.1 || mid.abs() > 0.1 || high.abs() > 0.1 {
                chain.push_str(&format!(
                    ",equalizer=f=100:t=q:w=1:g={:.1},equalizer=f=1000:t=q:w=1:g={:.1},equalizer=f=8000:t=q:w=1:g={:.1}",
                    low, mid, high
                ));
            }
        }

        // Route channels before pan so the pan control always operates on
        // the audible left/right pair. `aformat` uses FFmpeg's layout-aware
        // downmix coefficients instead of assuming every source is stereo.
        if let Some(map) = clip.channel_map.as_ref().filter(|map| !map.is_empty()) {
            let left = map[0];
            let right = *map.get(1).unwrap_or(&left);
            chain.push_str(&format!(",pan=stereo|c0=c{}|c1=c{}", left, right));
        } else if clip.channel_mode.as_deref() == Some("mono")
            || clip.downmix.as_deref() == Some("mono")
        {
            chain.push_str(",aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0");
        } else if clip.channel_mode.as_deref() == Some("stereo")
            || clip.downmix.as_deref() == Some("stereo")
        {
            chain.push_str(",aformat=channel_layouts=stereo");
        }

        // Apply Stereo Panning if configured
        if let Some(pan_val) = clip.pan {
            if pan_val.abs() > 0.01 {
                let left_gain = (1.0 - pan_val).clamp(0.0, 1.0);
                let right_gain = (1.0 + pan_val).clamp(0.0, 1.0);
                chain.push_str(&format!(
                    ",pan=stereo|c0={:.2}*c0|c1={:.2}*c1",
                    left_gain, right_gain
                ));
            }
        }

        // Apply Noise Suppression if configured
        if let Some(ns) = clip.noise_suppression {
            if ns > 0.05 {
                chain.push_str(&format!(",highpass=f=80,afftdn=nr={:.0}", ns * 30.0));
            }
        }

        if let Some(points) = &clip.volume_keyframes {
            if let Some(expression) = build_automation_volume_expression(points) {
                chain.push_str(&format!(",volume='{}':eval=frame", expression));
            }
        }

        chain.push_str(&format!(
            ",adelay={}:all=1,volume={:.3}[a{}];",
            delay_ms, clip.volume, input_idx
        ));
        filter_complex.push_str(&chain);
    }

    // Map all processed streams (including silence) into amix
    filter_complex.push_str("[asilence]");
    for idx in 0..valid_audio_clips.len() {
        filter_complex.push_str(&format!("[a{}]", idx + 1));
    }

    // Mix with duration=longest. The silence stream guarantees the audio
    // output has exactly the same duration as the video, preventing both
    // early cut-off (BUG-shortest) and trailing audio bloat.
    // normalize=0 prevents FFmpeg from scaling each stream by 1/inputs.
    filter_complex.push_str(&format!(
        "amix=inputs={}:duration=longest:normalize=0[a]",
        valid_audio_clips.len() + 1
    ));

    filter_complex
}


/// Build a safe FFmpeg expression for rebased volume automation. Commas are
/// escaped because this is embedded inside a filter_complex chain.
pub(crate) fn build_automation_volume_expression(points: &[ExportAudioKeyframe]) -> Option<String> {
    if points.is_empty() {
        return None;
    }
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.time.total_cmp(&b.time));
    let expression_for = |from: &ExportAudioKeyframe, to: &ExportAudioKeyframe| {
        let duration = (to.time - from.time).max(0.000_001);
        let t = format!("((t-{:.6})/{:.6})", from.time, duration);
        match to.easing.as_deref() {
            Some("exponential") if from.gain > 0.0001 && to.gain > 0.0001 => {
                format!("{:.6}*pow({:.6}\\,{})", from.gain, to.gain / from.gain, t)
            }
            Some("bezier") => format!(
                "{:.6}+({:.6})*(3*pow({}\\,2)-2*pow({}\\,3))",
                from.gain,
                to.gain - from.gain,
                t,
                t
            ),
            _ => format!("{:.6}+({:.6})*{}", from.gain, to.gain - from.gain, t),
        }
    };
    let mut expression = format!("{:.6}", sorted.last()?.gain);
    for pair in sorted.windows(2).rev() {
        let from = &pair[0];
        let to = &pair[1];
        expression = format!(
            "if(lt(t\\,{:.6})\\,{}\\,{})",
            to.time,
            expression_for(from, to),
            expression
        );
    }
    Some(expression)
}
