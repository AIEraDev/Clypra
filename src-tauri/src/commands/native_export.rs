use super::export::ExportProgress;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::ipc::Channel;
use tokio::process::Command;
use tokio::sync::{Mutex, Notify};
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;

const MAX_FFMPEG_RSS_BYTES: u64 = 2 * 1024 * 1024 * 1024;
static EXPORT_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTimelineClipPlan {
    pub path: String,
    pub trim_in: f64,
    pub duration: f64,
    pub frame_count: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub volume: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTimelineExportPlan {
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub codec: String,
    pub preset: String,
    pub crf: u32,
    pub pixel_format: String,
    pub total_duration: f64,
    pub clips: Vec<NativeTimelineClipPlan>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExportCompletion {
    pub total_frames: u32,
    pub total_time_ms: u64,
    pub peak_rss_bytes: u64,
}

struct NativeExportJob {
    cancellation: CancellationToken,
    result: Arc<Mutex<Option<Result<NativeExportCompletion, String>>>>,
    completed: Arc<Notify>,
}

static NATIVE_EXPORT_JOBS: once_cell::sync::Lazy<Arc<Mutex<HashMap<String, NativeExportJob>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

pub(crate) fn acquire_export_slot() -> Result<(), String> {
    EXPORT_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| ())
        .map_err(|_| "Another export is already running".to_string())
}

pub(crate) fn release_export_slot() {
    EXPORT_ACTIVE.store(false, Ordering::Release);
}

fn number(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        format!("{:.0}", value)
    } else {
        format!("{:.6}", value)
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

fn target_bitrate(plan: &NativeTimelineExportPlan) -> u64 {
    let pixels = u64::from(plan.width) * u64::from(plan.height);
    let base = if plan.codec == "h265" {
        35_000_000u64
    } else {
        50_000_000u64
    };
    ((base * pixels) / (3840 * 2160)).max(4_000_000)
}

fn build_segment_args(
    plan: &NativeTimelineExportPlan,
    clip: &NativeTimelineClipPlan,
    output_path: &Path,
    use_videotoolbox: bool,
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

    if use_videotoolbox {
        args.extend(["-hwaccel".into(), "videotoolbox".into()]);
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

    match plan.codec.as_str() {
        "h265" if use_videotoolbox => {
            let bitrate = target_bitrate(plan);
            args.extend([
                "-c:v".into(),
                "hevc_videotoolbox".into(),
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
        }
        "h264" if use_videotoolbox => {
            args.extend([
                "-c:v".into(),
                "h264_videotoolbox".into(),
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
        }
        "prores" if use_videotoolbox => {
            args.extend(["-c:v".into(), "prores_videotoolbox".into()]);
        }
        "h265" => {
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
        }
        "h264" => {
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
        }
        "prores" => {
            args.extend(["-c:v".into(), "prores_ks".into()]);
        }
        _ => {}
    }

    args.extend([
        "-pix_fmt".into(),
        plan.pixel_format.clone(),
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

fn validate_plan(plan: &NativeTimelineExportPlan) -> Result<(), String> {
    if plan.width == 0 || plan.height == 0 || plan.width > 7680 || plan.height > 4320 {
        return Err(format!(
            "Invalid native export dimensions: {}x{}",
            plan.width, plan.height
        ));
    }
    if !plan.frame_rate.is_finite() || plan.frame_rate <= 0.0 || plan.frame_rate > 240.0 {
        return Err(format!(
            "Invalid native export frame rate: {}",
            plan.frame_rate
        ));
    }
    if !plan.total_duration.is_finite() || plan.total_duration <= 0.0 {
        return Err("Native export duration must be positive".into());
    }
    if plan.clips.is_empty() {
        return Err("Native export requires at least one clip".into());
    }
    if !matches!(plan.codec.as_str(), "h264" | "h265" | "prores") {
        return Err(format!("Unsupported native export codec: {}", plan.codec));
    }
    for clip in &plan.clips {
        if clip.path.is_empty()
            || !clip.trim_in.is_finite()
            || clip.trim_in < 0.0
            || !clip.duration.is_finite()
            || clip.duration <= 0.0
            || clip.frame_count == 0
            || clip.width == 0
            || clip.height == 0
        {
            return Err(format!("Invalid native export clip: {}", clip.path));
        }
    }
    let planned_frames: u32 = plan.clips.iter().map(|clip| clip.frame_count).sum();
    let total_frames = (plan.total_duration * plan.frame_rate).round() as u32;
    if planned_frames != total_frames {
        return Err(format!(
            "Native export clips total {} frames but export requires {} frames",
            planned_frames, total_frames
        ));
    }
    Ok(())
}

async fn probe_has_audio(path: &str) -> bool {
    Command::new("ffprobe")
        .env("PATH", super::export::augmented_path())
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
        .await
        .map(|output| output.status.success() && !output.stdout.is_empty())
        .unwrap_or(false)
}

async fn process_rss_bytes(pid: u32) -> Option<u64> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let output = Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .await
            .ok()?;
        let kib = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u64>()
            .ok()?;
        Some(kib * 1024)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = pid;
        None
    }
}

async fn run_ffmpeg(args: &[String], cancellation: &CancellationToken) -> Result<u64, String> {
    let mut child = Command::new("ffmpeg")
        .env("PATH", super::export::augmented_path())
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to spawn FFmpeg: {error}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "FFmpeg did not expose a process ID".to_string())?;
    let mut peak_rss = 0u64;

    loop {
        if cancellation.is_cancelled() {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("Export cancelled".into());
        }

        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to inspect FFmpeg: {error}"))?
        {
            return if status.success() {
                Ok(peak_rss)
            } else {
                Err(format!("FFmpeg exited with status {status}"))
            };
        }

        if let Some(rss) = process_rss_bytes(pid).await {
            peak_rss = peak_rss.max(rss);
            if rss > MAX_FFMPEG_RSS_BYTES {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(format!(
                    "FFmpeg exceeded the {} MiB memory safety ceiling",
                    MAX_FFMPEG_RSS_BYTES / 1024 / 1024
                ));
            }
        }

        sleep(Duration::from_millis(500)).await;
    }
}

fn ffconcat_path(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "'\\''")
}

fn build_concat_args(list_path: &Path, output_path: &Path) -> Vec<String> {
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

fn build_mux_args(
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

async fn run_native_export(
    session_id: &str,
    plan: NativeTimelineExportPlan,
    on_progress: Channel<ExportProgress>,
    cancellation: CancellationToken,
) -> Result<NativeExportCompletion, String> {
    let started = Instant::now();
    let total_frames = (plan.total_duration * plan.frame_rate).round() as u32;
    let temp_dir = std::env::temp_dir().join(format!("clypra-export-{session_id}"));
    let output_path = PathBuf::from(&plan.output_path);
    let use_videotoolbox = cfg!(target_os = "macos");
    let segment_extension = if plan.codec == "prores" { "mov" } else { "mp4" };
    let result = async {
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|error| format!("Failed to create export workspace: {error}"))?;
        let mut segment_paths = Vec::with_capacity(plan.clips.len());
        let mut audio_streams = Vec::with_capacity(plan.clips.len());
        let mut completed_duration = 0.0f64;
        let mut peak_rss = 0u64;

        for (index, clip) in plan.clips.iter().enumerate() {
            if cancellation.is_cancelled() {
                return Err("Export cancelled".into());
            }
            let segment_path = temp_dir.join(format!("segment-{index:04}.{segment_extension}"));
            audio_streams.push(probe_has_audio(&clip.path).await);
            let args = build_segment_args(&plan, clip, &segment_path, use_videotoolbox);
            peak_rss = peak_rss.max(run_ffmpeg(&args, &cancellation).await?);
            segment_paths.push(segment_path);
            completed_duration += clip.duration;

            let current_frame = (completed_duration * plan.frame_rate).round() as u32;
            let elapsed = started.elapsed().as_secs_f64();
            let fps = if elapsed > 0.0 {
                current_frame as f64 / elapsed
            } else {
                0.0
            };
            let remaining_frames = total_frames.saturating_sub(current_frame);
            let _ = on_progress.send(ExportProgress {
                current_frame,
                total_frames,
                progress: (current_frame as f64 / total_frames as f64).min(0.98),
                eta_seconds: if fps > 0.0 {
                    remaining_frames as f64 / fps
                } else {
                    0.0
                },
                fps,
            });
        }

        let concat_path = temp_dir.join("segments.ffconcat");
        let mut concat = String::from("ffconcat version 1.0\n");
        for (path, clip) in segment_paths.iter().zip(&plan.clips) {
            concat.push_str(&format!(
                "file '{}'\nduration {}\n",
                ffconcat_path(path),
                number(clip.frame_count as f64 / plan.frame_rate),
            ));
        }
        tokio::fs::write(&concat_path, concat)
            .await
            .map_err(|error| format!("Failed to write concat plan: {error}"))?;
        let video_path = temp_dir.join(format!("video-only.{segment_extension}"));
        peak_rss = peak_rss
            .max(run_ffmpeg(&build_concat_args(&concat_path, &video_path), &cancellation).await?);
        peak_rss = peak_rss.max(
            run_ffmpeg(
                &build_mux_args(
                    &plan,
                    &video_path,
                    &output_path,
                    &audio_streams,
                    cfg!(target_os = "macos"),
                ),
                &cancellation,
            )
            .await?,
        );
        let elapsed = started.elapsed().as_secs_f64();
        let _ = on_progress.send(ExportProgress {
            current_frame: total_frames,
            total_frames,
            progress: 1.0,
            eta_seconds: 0.0,
            fps: if elapsed > 0.0 {
                total_frames as f64 / elapsed
            } else {
                0.0
            },
        });

        Ok(NativeExportCompletion {
            total_frames,
            total_time_ms: started.elapsed().as_millis() as u64,
            peak_rss_bytes: peak_rss,
        })
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&output_path).await;
    }
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    result
}

#[tauri::command]
pub async fn start_native_timeline_export(
    plan: NativeTimelineExportPlan,
    on_progress: Channel<ExportProgress>,
) -> Result<String, String> {
    validate_plan(&plan)?;
    acquire_export_slot()?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let cancellation = CancellationToken::new();
    let result = Arc::new(Mutex::new(None));
    let completed = Arc::new(Notify::new());
    NATIVE_EXPORT_JOBS.lock().await.insert(
        session_id.clone(),
        NativeExportJob {
            cancellation: cancellation.clone(),
            result: result.clone(),
            completed: completed.clone(),
        },
    );

    let task_cancellation = cancellation.clone();
    let task_session_id = session_id.clone();
    tokio::spawn(async move {
        let export_result =
            run_native_export(&task_session_id, plan, on_progress, task_cancellation).await;
        *result.lock().await = Some(export_result);
        completed.notify_waiters();
    });
    Ok(session_id)
}

async fn wait_for_native_job(
    result: Arc<Mutex<Option<Result<NativeExportCompletion, String>>>>,
    completed: Arc<Notify>,
) -> Result<NativeExportCompletion, String> {
    loop {
        let notified = completed.notified();
        if let Some(result) = result.lock().await.clone() {
            return result;
        }
        tokio::select! {
            _ = notified => {}
            _ = sleep(Duration::from_millis(100)) => {}
        }
    }
}

#[tauri::command]
pub async fn finalize_native_timeline_export(
    session_id: String,
) -> Result<NativeExportCompletion, String> {
    let (result, completed) = NATIVE_EXPORT_JOBS
        .lock()
        .await
        .get(&session_id)
        .map(|job| (job.result.clone(), job.completed.clone()))
        .ok_or_else(|| format!("Native export session not found: {session_id}"))?;
    let result = wait_for_native_job(result, completed).await;
    if NATIVE_EXPORT_JOBS
        .lock()
        .await
        .remove(&session_id)
        .is_some()
    {
        release_export_slot();
    }
    result
}

#[tauri::command]
pub async fn cancel_native_timeline_export(session_id: String) -> Result<(), String> {
    let (cancellation, result, completed) = NATIVE_EXPORT_JOBS
        .lock()
        .await
        .get(&session_id)
        .map(|job| {
            (
                job.cancellation.clone(),
                job.result.clone(),
                job.completed.clone(),
            )
        })
        .ok_or_else(|| format!("Native export session not found: {session_id}"))?;
    cancellation.cancel();
    let _ = wait_for_native_job(result, completed).await;
    if NATIVE_EXPORT_JOBS
        .lock()
        .await
        .remove(&session_id)
        .is_some()
    {
        release_export_slot();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> NativeTimelineExportPlan {
        NativeTimelineExportPlan {
            output_path: "/output/movie.mp4".into(),
            width: 3840,
            height: 2160,
            frame_rate: 30.0,
            codec: "h265".into(),
            preset: "medium".into(),
            crf: 20,
            pixel_format: "yuv420p".into(),
            total_duration: 9.0,
            clips: vec![],
        }
    }

    #[test]
    fn segment_arguments_normalize_mixed_source_formats_before_concat() {
        let output = Path::new("/tmp/segment-00.mp4");
        let main = NativeTimelineClipPlan {
            path: "/media/main-3024x1964-60fps.mov".into(),
            trim_in: 10.0,
            duration: 3.0,
            frame_count: 90,
            x: 0,
            y: -167,
            width: 3840,
            height: 2494,
            volume: 1.0,
        };
        let ident = NativeTimelineClipPlan {
            path: "/media/ident-1920x1080-30fps.mp4".into(),
            trim_in: 0.0,
            duration: 6.0,
            frame_count: 180,
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
            volume: 1.0,
        };

        let main_args = build_segment_args(&plan(), &main, output, true);
        let ident_args = build_segment_args(&plan(), &ident, output, true);

        for args in [main_args, ident_args] {
            let joined = args.join(" ");
            assert!(joined.contains("color=c=black:s=3840x2160:r=30"));
            assert!(joined.contains("fps=30"));
            assert!(joined.contains("setsar=1"));
            assert!(joined.contains("hevc_videotoolbox"));
            assert!(joined.contains("-tag:v hvc1"));
            assert!(joined.contains("-an"));
            assert!(joined.contains("-bf 0"));
        }

        let mux_args = build_mux_args(
            &NativeTimelineExportPlan {
                clips: vec![main, ident],
                ..plan()
            },
            Path::new("/tmp/video-only.mp4"),
            Path::new("/tmp/final.mp4"),
            &[true, true],
            true,
        );
        let mux = mux_args.join(" ");
        assert!(mux.contains("aresample=48000"));
        assert!(mux.contains("concat=n=2:v=0:a=1"));
        assert!(mux.contains("-c:v copy"));
        assert!(mux.contains("-c:a aac_at"));
    }

    #[test]
    fn export_slot_rejects_concurrent_jobs() {
        release_export_slot();
        assert!(acquire_export_slot().is_ok());
        assert_eq!(
            acquire_export_slot().unwrap_err(),
            "Another export is already running"
        );
        release_export_slot();
    }

    #[test]
    fn plan_validation_requires_frame_exact_clip_coverage() {
        let mut invalid = plan();
        invalid.clips = vec![NativeTimelineClipPlan {
            path: "/media/main.mov".into(),
            trim_in: 0.0,
            duration: 8.0,
            frame_count: 240,
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
            volume: 1.0,
        }];
        assert!(validate_plan(&invalid)
            .unwrap_err()
            .contains("clips total 240 frames"));
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn cancellation_terminates_the_active_ffmpeg_child() {
        let token = CancellationToken::new();
        let cancel = token.clone();
        tokio::spawn(async move {
            sleep(Duration::from_millis(150)).await;
            cancel.cancel();
        });
        let started = Instant::now();
        let args = vec![
            "-hide_banner".into(),
            "-loglevel".into(),
            "error".into(),
            "-nostdin".into(),
            "-re".into(),
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            "color=c=black:s=64x64:r=30:d=60".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ];

        assert_eq!(
            run_ffmpeg(&args, &token).await.unwrap_err(),
            "Export cancelled"
        );
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
