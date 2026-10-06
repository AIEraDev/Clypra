use std::ffi::OsStr;
use std::process::Stdio;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Creates a standard synchronous `std::process::Command` configured with `CREATE_NO_WINDOW`
/// on Windows so child processes (such as FFmpeg, FFprobe, and system shells) do not spawn an
/// unwanted console window over the GUI.
///
/// Sets `stdin` to `Stdio::null()` by default to avoid hanging or interactive console stdin
/// handling in GUI processes. Callers may override this via `.stdin(...)`.
#[allow(clippy::disallowed_methods)]
pub fn hidden_command<S: AsRef<OsStr>>(program: S) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    cmd.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Creates a tokio asynchronous `tokio::process::Command` configured with `CREATE_NO_WINDOW`
/// on Windows so child processes (such as FFmpeg, FFprobe, and helper scripts) do not spawn an
/// unwanted console window over the GUI.
///
/// Sets `stdin` to `Stdio::null()` by default to avoid hanging or interactive console stdin
/// handling in GUI processes. Callers may override this via `.stdin(...)`.
#[allow(clippy::disallowed_methods)]
pub fn hidden_tokio_command<S: AsRef<OsStr>>(program: S) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(program);
    cmd.stdin(Stdio::null());
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Runs a synchronous `std::process::Command` with a strict timeout and kill-on-drop behavior.
/// Concurrent reader threads prevent deadlocks on full stdout/stderr pipe buffers.
pub fn run_command_with_timeout(
    mut cmd: std::process::Command,
    timeout: std::time::Duration,
) -> Result<std::process::Output, String> {
    use std::io::Read;

    cmd.stdin(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn command: {e}"))?;

    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let stdout_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut stream) = stdout_handle {
            let _ = stream.read_to_end(&mut buf);
        }
        buf
    });

    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut stream) = stderr_handle {
            let _ = stream.read_to_end(&mut buf);
        }
        buf
    });

    let start = std::time::Instant::now();
    let poll_interval = std::time::Duration::from_millis(20);

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_thread.join();
                    let _ = stderr_thread.join();
                    return Err(format!(
                        "Command timed out after {} seconds",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(poll_interval);
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err(format!("Error waiting for command: {e}"));
            }
        }
    };

    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();

    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hidden_command_instantiation() {
        let cmd = hidden_command("echo");
        let program = cmd.get_program();
        assert_eq!(program, "echo");
    }

    #[test]
    fn test_hidden_tokio_command_instantiation() {
        let cmd = hidden_tokio_command("echo");
        let std_cmd = cmd.as_std();
        assert_eq!(std_cmd.get_program(), "echo");
    }
}
