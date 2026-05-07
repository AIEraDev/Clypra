//! Bundled `ffmpeg` / `ffprobe` sidecars (`src-tauri/bin/`). See `src-tauri/bin/README.md`.

use once_cell::sync::OnceCell;
use tauri::AppHandle;
use tauri_plugin_shell::process::{Command, CommandEvent, Output};
use tauri_plugin_shell::ShellExt;

static APP: OnceCell<AppHandle> = OnceCell::new();

/// Call once from [`tauri::Builder`] `.setup` before any sidecar invocation.
pub fn set_app_handle(handle: &AppHandle) {
    let _ = APP.set(handle.clone());
}

fn app_handle() -> Result<&'static AppHandle, String> {
    APP.get()
        .ok_or_else(|| "FFmpeg sidecar: AppHandle not initialized".to_string())
}

/// Sidecar path must match `bundle.externalBin` in `tauri.conf.json`.
fn ffmpeg_cmd() -> Result<Command, String> {
    app_handle()?
        .shell()
        // Note: Tauri sidecar lookup uses the *program name* ("ffmpeg"),
        // while bundling is configured via `bundle.externalBin` ("bin/ffmpeg").
        .sidecar("ffmpeg")
        .map_err(|e| format!("sidecar ffmpeg: {e}"))
}

fn ffprobe_cmd() -> Result<Command, String> {
    app_handle()?
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("sidecar ffprobe: {e}"))
}

pub async fn ffmpeg_output(args: &[&str]) -> Result<Output, String> {
    #[cfg(test)]
    if APP.get().is_none() {
        return devenv::ffmpeg_output(args).await;
    }
    ffmpeg_cmd()?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("ffmpeg: {e}"))
}

pub async fn ffmpeg_output_strings(args: &[String]) -> Result<Output, String> {
    #[cfg(test)]
    if APP.get().is_none() {
        return devenv::ffmpeg_output_strings(args).await;
    }
    let cmd = ffmpeg_cmd()?;
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    cmd.args(&args_ref)
        .output()
        .await
        .map_err(|e| format!("ffmpeg: {e}"))
}

/// Run ffmpeg and capture raw bytes on stdout/stderr (required for binary pipes like PNG).
pub async fn ffmpeg_output_strings_raw(args: &[String]) -> Result<Output, String> {
    #[cfg(test)]
    if APP.get().is_none() {
        // tokio::process::Command already returns raw bytes
        return devenv::ffmpeg_output_strings(args).await;
    }
    let cmd = ffmpeg_cmd()?;
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    cmd.set_raw_out(true)
        .args(&args_ref)
        .output()
        .await
        .map_err(|e| format!("ffmpeg: {e}"))
}

pub async fn ffprobe_output(args: &[&str]) -> Result<Output, String> {
    #[cfg(test)]
    if APP.get().is_none() {
        return devenv::ffprobe_output(args).await;
    }
    ffprobe_cmd()?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("ffprobe: {e}"))
}

pub async fn ffprobe_output_strings(args: &[String]) -> Result<Output, String> {
    #[cfg(test)]
    if APP.get().is_none() {
        return devenv::ffprobe_output_strings(args).await;
    }
    let cmd = ffprobe_cmd()?;
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    cmd.args(&args_ref)
        .output()
        .await
        .map_err(|e| format!("ffprobe: {e}"))
}

/// Run ffmpeg and collect stdout bytes (e.g. `f32le` waveform pipe).
pub async fn ffmpeg_stdout_bytes(args: &[String]) -> Result<Vec<u8>, String> {
    #[cfg(test)]
    if APP.get().is_none() {
        return devenv::ffmpeg_stdout_bytes(args).await;
    }
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let (mut rx, _child) = ffmpeg_cmd()?
        .args(&args_ref)
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    let mut out = Vec::new();
    let mut code: Option<i32> = None;

    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(b) => out.extend_from_slice(&b),
            CommandEvent::Stderr(_) => {}
            CommandEvent::Terminated(t) => {
                code = t.code;
            }
            CommandEvent::Error(e) => return Err(e),
            _ => {}
        }
    }

    if code != Some(0) {
        return Err(format!("ffmpeg exited with code {:?}", code));
    }

    Ok(out)
}

/// Decode first audio stream to mono `f32le` at `sr` Hz and build peak buckets (same logic as timeline waveform).
pub async fn audio_peaks_f32le_buckets(
    input_path: &str,
    sr: u32,
    buckets: usize,
    samples_per_bucket: usize,
) -> Result<Vec<f32>, String> {
    #[cfg(test)]
    if APP.get().is_none() {
        return devenv::audio_peaks_f32le_buckets(input_path, sr, buckets, samples_per_bucket).await;
    }
    let args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-i".into(),
        input_path.to_string(),
        "-map".into(),
        "0:a:0".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        sr.to_string(),
        "-f".into(),
        "f32le".into(),
        "-".into(),
    ];
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let (mut rx, _child) = ffmpeg_cmd()?
        .args(&args_ref)
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    let mut peaks = vec![0.0f32; buckets];
    let mut bucket_idx = 0usize;
    let mut count_in_bucket = 0usize;
    let mut max_in_bucket = 0.0f32;
    let mut stash: Vec<u8> = Vec::new();
    let mut code: Option<i32> = None;

    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(chunk) => {
                stash.extend_from_slice(&chunk);
                let mut i = 0usize;
                while i + 4 <= stash.len() {
                    let sample = f32::from_le_bytes(stash[i..i + 4].try_into().unwrap());
                    i += 4;
                    let a = sample.abs();
                    if bucket_idx >= buckets {
                        continue;
                    }
                    if count_in_bucket >= samples_per_bucket {
                        peaks[bucket_idx] = max_in_bucket;
                        bucket_idx += 1;
                        count_in_bucket = 0;
                        max_in_bucket = 0.0;
                    }
                    if a > max_in_bucket {
                        max_in_bucket = a;
                    }
                    count_in_bucket += 1;
                }
                if i > 0 {
                    stash.copy_within(i.., 0);
                    stash.truncate(stash.len() - i);
                }
            }
            CommandEvent::Stderr(_) => {}
            CommandEvent::Terminated(t) => code = t.code,
            CommandEvent::Error(e) => return Err(e),
            _ => {}
        }
    }

    if code != Some(0) {
        return Ok(vec![0.0; buckets]);
    }

    if bucket_idx < buckets && (count_in_bucket > 0 || max_in_bucket > 0.0) {
        peaks[bucket_idx] = max_in_bucket;
    }

    let mut max_peak = 0.0f32;
    for &p in &peaks {
        if p > max_peak {
            max_peak = p;
        }
    }
    if max_peak > 1.0e-12 {
        for p in &mut peaks {
            *p = (*p / max_peak).min(1.0);
        }
    }

    Ok(peaks)
}

/// `cargo test` runs commands before Tauri `.setup`; use system ffmpeg/ffprobe from `PATH` then.
#[cfg(test)]
mod devenv {
    use super::Output;
    use tauri_plugin_shell::process::ExitStatus;
    use tokio::io::AsyncReadExt;
    use tokio::process::Command;

    /// Convert a `std::process::Output` into the `tauri_plugin_shell::process::Output`
    /// type expected by the outer functions.
    ///
    /// # Safety
    /// `tauri_plugin_shell::process::ExitStatus` is a newtype over `Option<i32>`.
    /// We transmute the exit code into it because the field is private but the layout
    /// is guaranteed to be identical to `Option<i32>` (a single-field struct with no
    /// explicit repr has the same layout as its only field in Rust).
    fn convert_output(out: std::process::Output) -> Output {
        let code: Option<i32> = out.status.code();
        // SAFETY: ExitStatus is `struct ExitStatus { code: Option<i32> }` with no
        // explicit repr, so its layout equals Option<i32> on all platforms.
        let status: ExitStatus = unsafe { std::mem::transmute(code) };
        Output {
            status,
            stdout: out.stdout,
            stderr: out.stderr,
        }
    }

    pub async fn ffmpeg_output(args: &[&str]) -> Result<Output, String> {
        let out = Command::new("ffmpeg")
            .args(args)
            .output()
            .await
            .map_err(|e| format!("ffmpeg: {e}"))?;
        Ok(convert_output(out))
    }

    pub async fn ffmpeg_output_strings(args: &[String]) -> Result<Output, String> {
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = Command::new("ffmpeg")
            .args(&args_ref)
            .output()
            .await
            .map_err(|e| format!("ffmpeg: {e}"))?;
        Ok(convert_output(out))
    }

    pub async fn ffprobe_output(args: &[&str]) -> Result<Output, String> {
        let out = Command::new("ffprobe")
            .args(args)
            .output()
            .await
            .map_err(|e| format!("ffprobe: {e}"))?;
        Ok(convert_output(out))
    }

    pub async fn ffprobe_output_strings(args: &[String]) -> Result<Output, String> {
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = Command::new("ffprobe")
            .args(&args_ref)
            .output()
            .await
            .map_err(|e| format!("ffprobe: {e}"))?;
        Ok(convert_output(out))
    }

    pub async fn ffmpeg_stdout_bytes(args: &[String]) -> Result<Vec<u8>, String> {
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = Command::new("ffmpeg")
            .args(&args_ref)
            .output()
            .await
            .map_err(|e| format!("ffmpeg: {e}"))?;
        if !out.status.success() {
            return Err(format!("ffmpeg exited with code {:?}", out.status.code()));
        }
        Ok(out.stdout)
    }

    pub async fn audio_peaks_f32le_buckets(
        input_path: &str,
        sr: u32,
        buckets: usize,
        samples_per_bucket: usize,
    ) -> Result<Vec<f32>, String> {
        let mut child = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-i",
                input_path,
                "-map",
                "0:a:0",
                "-ac",
                "1",
                "-ar",
                &sr.to_string(),
                "-f",
                "f32le",
                "-",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("ffmpeg: {e}"))?;

        let mut stdout = child.stdout.take().ok_or("no ffmpeg stdout")?;

        let mut peaks = vec![0.0f32; buckets];
        let mut bucket_idx = 0usize;
        let mut count_in_bucket = 0usize;
        let mut max_in_bucket = 0.0f32;
        let mut stash: Vec<u8> = Vec::new();
        let mut buf = vec![0u8; 32 * 1024];

        loop {
            let n = stdout.read(&mut buf).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            stash.extend_from_slice(&buf[..n]);
            let mut i = 0usize;
            while i + 4 <= stash.len() {
                let sample = f32::from_le_bytes(stash[i..i + 4].try_into().unwrap());
                i += 4;
                let a = sample.abs();
                if bucket_idx >= buckets {
                    continue;
                }
                if count_in_bucket >= samples_per_bucket {
                    peaks[bucket_idx] = max_in_bucket;
                    bucket_idx += 1;
                    count_in_bucket = 0;
                    max_in_bucket = 0.0;
                }
                if a > max_in_bucket {
                    max_in_bucket = a;
                }
                count_in_bucket += 1;
            }
            if i > 0 {
                stash.copy_within(i.., 0);
                stash.truncate(stash.len() - i);
            }
        }

        if bucket_idx < buckets && (count_in_bucket > 0 || max_in_bucket > 0.0) {
            peaks[bucket_idx] = max_in_bucket;
        }

        let status = child.wait().await.map_err(|e| e.to_string())?;
        if !status.success() {
            return Ok(vec![0.0; buckets]);
        }

        let mut max_peak = 0.0f32;
        for &p in &peaks {
            if p > max_peak {
                max_peak = p;
            }
        }
        if max_peak > 1.0e-12 {
            for p in &mut peaks {
                *p = (*p / max_peak).min(1.0);
            }
        }

        Ok(peaks)
    }
}
