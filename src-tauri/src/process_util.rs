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
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
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
