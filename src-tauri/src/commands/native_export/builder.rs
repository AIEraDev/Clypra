use std::path::Path;

use super::models::{
    number, target_bitrate, HwAccelType, NativeTimelineClipPlan, NativeTimelineExportPlan,
    SelectedEncoder,
};

pub fn build_segment_args(
    plan: &NativeTimelineExportPlan,
    clip: &NativeTimelineClipPlan,
    output_path: &Path,
    encoder: &SelectedEncoder,
) -> Vec<String> {
    let source_duration = number(clip.duration);
    let output_duration = number(clip.frame_count as f64 / plan.frame_rate);
    let frame_rate = number(plan.frame_rate);
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-nostdin".into(),
        "-threads".into(),
        "4".into(),
        "-filter_threads".into(),
        "2".into(),
    ];

    if let Some(ref hwaccel) = encoder.hwaccel_flag {
        if encoder.hw_type == HwAccelType::Vaapi {
            args.extend([
                "-hwaccel".into(),
                "vaapi".into(),
                "-vaapi_device".into(),
                hwaccel.clone(),
            ]);
        } else {
            args.extend(["-hwaccel".into(), hwaccel.clone()]);
        }
    }

    args.extend([
        "-ss".into(),
        number(clip.trim_in),
        "-t".into(),
        source_duration,
        "-i".into(),
        clip.path.clone(),
    ]);

    let filter = format!(
        "color=c=black:s={}x{}:r={}:d={}[base];\
         [0:v]scale={}:{}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS,\
         tpad=stop_mode=clone:stop_duration={},trim=duration={},fps={}[fg];\
         [base][fg]overlay=x={}:y={}:shortest=1,format={}[v]",
        plan.width,
        plan.height,
        frame_rate,
        output_duration,
        clip.width,
        clip.height,
        output_duration,
        output_duration,
        frame_rate,
        clip.x,
        clip.y,
        plan.pixel_format,
    );
    args.extend([
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[v]".into(),
        "-an".into(),
    ]);

    match encoder.hw_type {
        HwAccelType::VideoToolbox => {
            if plan.codec == "h265" {
                let bitrate = target_bitrate(plan);
                args.extend([
                    "-c:v".into(),
                    encoder.codec_name.clone(),
                    "-tag:v".into(),
                    "hvc1".into(),
                    "-b:v".into(),
                    bitrate.to_string(),
                    "-maxrate".into(),
                    (bitrate * 10 / 7).to_string(),
                    "-bufsize".into(),
                    (bitrate * 2).to_string(),
                    "-allow_sw".into(),
                    "1".into(),
                    "-realtime".into(),
                    "1".into(),
                    "-prio_speed".into(),
                    "1".into(),
                    "-bf".into(),
                    "0".into(),
                    "-g".into(),
                    number(plan.frame_rate * 2.0),
                ]);
            } else if plan.codec == "h264" {
                args.extend([
                    "-c:v".into(),
                    encoder.codec_name.clone(),
                    "-b:v".into(),
                    target_bitrate(plan).to_string(),
                    "-allow_sw".into(),
                    "1".into(),
                    "-realtime".into(),
                    "1".into(),
                    "-bf".into(),
                    "0".into(),
                    "-g".into(),
                    number(plan.frame_rate * 2.0),
                ]);
            } else if plan.codec == "prores" {
                args.extend([
                    "-c:v".into(),
                    encoder.codec_name.clone(),
                    "-allow_sw".into(),
                    "1".into(),
                ]);
            }
        }
        HwAccelType::Nvenc => {
            let bitrate = target_bitrate(plan);
            args.extend([
                "-c:v".into(),
                encoder.codec_name.clone(),
                "-preset".into(),
                "p4".into(),
                "-b:v".into(),
                bitrate.to_string(),
                "-maxrate".into(),
                (bitrate * 10 / 7).to_string(),
                "-bufsize".into(),
                (bitrate * 2).to_string(),
                "-bf".into(),
                "0".into(),
                "-g".into(),
                number(plan.frame_rate * 2.0),
            ]);
            if plan.codec == "h265" {
                args.extend(["-tag:v".into(), "hvc1".into()]);
            }
        }
        HwAccelType::Qsv => {
            let bitrate = target_bitrate(plan);
            args.extend([
                "-c:v".into(),
                encoder.codec_name.clone(),
                "-b:v".into(),
                bitrate.to_string(),
                "-bf".into(),
                "0".into(),
                "-g".into(),
                number(plan.frame_rate * 2.0),
            ]);
            if plan.codec == "h265" {
                args.extend(["-tag:v".into(), "hvc1".into()]);
            }
        }
        HwAccelType::Amf => {
            let bitrate = target_bitrate(plan);
            args.extend([
                "-c:v".into(),
                encoder.codec_name.clone(),
                "-b:v".into(),
                bitrate.to_string(),
                "-bf".into(),
                "0".into(),
                "-g".into(),
                number(plan.frame_rate * 2.0),
            ]);
            if plan.codec == "h265" {
                args.extend(["-tag:v".into(), "hvc1".into()]);
            }
        }
        HwAccelType::Vaapi => {
            let bitrate = target_bitrate(plan);
            args.extend([
                "-c:v".into(),
                encoder.codec_name.clone(),
                "-b:v".into(),
                bitrate.to_string(),
                "-bf".into(),
                "0".into(),
                "-g".into(),
                number(plan.frame_rate * 2.0),
            ]);
            if plan.codec == "h265" {
                args.extend(["-tag:v".into(), "hvc1".into()]);
            }
        }
        HwAccelType::Software => {
            if plan.codec == "h265" {
                args.extend([
                    "-c:v".into(),
                    "libx265".into(),
                    "-preset".into(),
                    plan.preset.clone(),
                    "-crf".into(),
                    plan.crf.to_string(),
                    "-tag:v".into(),
                    "hvc1".into(),
                    "-bf".into(),
                    "0".into(),
                    "-g".into(),
                    number(plan.frame_rate * 2.0),
                ]);
            } else if plan.codec == "h264" {
                args.extend([
                    "-c:v".into(),
                    "libx264".into(),
                    "-preset".into(),
                    plan.preset.clone(),
                    "-crf".into(),
                    plan.crf.to_string(),
                    "-bf".into(),
                    "0".into(),
                    "-g".into(),
                    number(plan.frame_rate * 2.0),
                ]);
            } else if plan.codec == "prores" {
                args.extend(["-c:v".into(), "prores_ks".into()]);
            }
        }
    }

    let segment_pix_fmt = if encoder.codec_name == "prores_videotoolbox" {
        if plan.pixel_format.contains("444") {
            "p410le".to_string()
        } else {
            "p210le".to_string()
        }
    } else {
        plan.pixel_format.clone()
    };

    args.extend([
        "-color_range".into(),
        "tv".into(),
        "-colorspace".into(),
        "bt709".into(),
        "-color_primaries".into(),
        "bt709".into(),
        "-color_trc".into(),
        "bt709".into(),
        "-pix_fmt".into(),
        segment_pix_fmt,
        "-video_track_timescale".into(),
        "90000".into(),
        "-t".into(),
        output_duration,
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
}

pub fn ffconcat_path(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "'\\''")
}

pub fn build_concat_args(list_path: &Path, output_path: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-nostdin".into(),
        "-safe".into(),
        "0".into(),
        "-f".into(),
        "concat".into(),
        "-i".into(),
        list_path.to_string_lossy().into_owned(),
        "-c".into(),
        "copy".into(),
        "-an".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
        output_path.to_string_lossy().into_owned(),
    ]
}

pub fn build_mux_args(
    plan: &NativeTimelineExportPlan,
    video_path: &Path,
    output_path: &Path,
    audio_streams: &[bool],
    use_audiotoolbox: bool,
) -> Vec<String> {
    let total_frames = (plan.total_duration * plan.frame_rate).round() as u32;
    let total_duration = number(total_frames as f64 / plan.frame_rate);
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-nostdin".into(),
        "-i".into(),
        video_path.to_string_lossy().into_owned(),
    ];
    for (clip, has_audio) in plan.clips.iter().zip(audio_streams) {
        let output_duration = number(clip.frame_count as f64 / plan.frame_rate);
        if *has_audio {
            args.extend([
                "-ss".into(),
                number(clip.trim_in),
                "-t".into(),
                clip.duration.to_string(),
                "-i".into(),
                clip.path.clone(),
            ]);
        } else {
            args.extend([
                "-f".into(),
                "lavfi".into(),
                "-t".into(),
                output_duration,
                "-i".into(),
                "anullsrc=channel_layout=stereo:sample_rate=48000".into(),
            ]);
        }
    }

    let mut filter = String::new();
    for (index, (clip, has_audio)) in plan.clips.iter().zip(audio_streams).enumerate() {
        let input_index = index + 1;
        let output_duration = number(clip.frame_count as f64 / plan.frame_rate);
        if *has_audio {
            filter.push_str(&format!(
                "[{input_index}:a]aresample=48000:async=1:first_pts=0,volume={},\
                 apad=whole_dur={output_duration},atrim=duration={output_duration},\
                 asetpts=PTS-STARTPTS[a{index}];",
                number(clip.volume),
            ));
        } else {
            filter.push_str(&format!(
                "[{input_index}:a]atrim=duration={output_duration},\
                 asetpts=PTS-STARTPTS[a{index}];"
            ));
        }
    }
    for index in 0..plan.clips.len() {
        filter.push_str(&format!("[a{index}]"));
    }
    filter.push_str(&format!(
        "concat=n={}:v=0:a=1,atrim=duration={},asetpts=N/SR/TB[a]",
        plan.clips.len(),
        total_duration,
    ));

    args.extend([
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "[a]".into(),
        "-c:v".into(),
        "copy".into(),
        "-c:a".into(),
        if use_audiotoolbox {
            "aac_at".into()
        } else {
            "aac".into()
        },
        "-ar".into(),
        "48000".into(),
        "-ac".into(),
        "2".into(),
        "-b:a".into(),
        "192k".into(),
        "-t".into(),
        total_duration,
        "-shortest".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
}
