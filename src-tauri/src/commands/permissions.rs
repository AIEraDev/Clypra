/// permissions.rs — macOS media permission helpers.
///
/// These commands read (and optionally request) AVFoundation / AVAudioSession
/// permissions without going through the browser's getUserMedia path, so they
/// work even when the Tauri WKWebView camera path is not available.
///
/// All commands are `#[cfg(target_os = "macos")]`-guarded; on other platforms
/// they return `"authorized"` immediately so the JS layer stays cross-platform.

use serde::Serialize;
use tauri::command;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPermissionStatus {
    /// "notDetermined" | "restricted" | "denied" | "authorized"
    pub status: String,
    /// true if we can still show the OS dialog (status == "notDetermined")
    pub can_request: bool,
    /// human-readable message for the UI
    pub message: String,
}

// ── macOS implementation ───────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
#[allow(dead_code)]
mod macos {
    use super::MediaPermissionStatus;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send, msg_send_id};

    // AVAuthorizationStatus integer values (matches AVFoundation headers)
    const _NOT_DETERMINED: i64 = 0;
    const RESTRICTED: i64 = 1;
    const DENIED: i64 = 2;
    const AUTHORIZED: i64 = 3;

    /// Builds an NSString from a &str without linking to Foundation explicitly —
    /// NSString is always available inside a Tauri/Cocoa process.
    unsafe fn nsstring(s: &str) -> Retained<AnyObject> {
        let cls = class!(NSString);
        // stringWithUTF8String: — the pointer must be null-terminated
        let mut owned = s.to_owned();
        owned.push('\0');
        let ptr = owned.as_ptr() as *const i8;
        msg_send_id![cls, stringWithUTF8String: ptr]
    }

    /// Read `AVCaptureDevice.authorizationStatus(for:)` WITHOUT triggering the
    /// permission dialog.  Returns the raw AVAuthorizationStatus integer.
    pub fn av_capture_auth_status(media_type: &str) -> i64 {
        unsafe {
            let cls = class!(AVCaptureDevice);
            let mt = nsstring(media_type);
            msg_send![cls, authorizationStatusForMediaType: &*mt]
        }
    }

    pub fn status_from_raw(raw: i64, device: &str) -> MediaPermissionStatus {
        match raw {
            AUTHORIZED => MediaPermissionStatus {
                status: "authorized".into(),
                can_request: false,
                message: format!("{device} access is granted."),
            },
            DENIED => MediaPermissionStatus {
                status: "denied".into(),
                can_request: false,
                message: format!(
                    "{device} access was denied. Open System Settings → Privacy & Security → {device} and enable Clypra."
                ),
            },
            RESTRICTED => MediaPermissionStatus {
                status: "restricted".into(),
                can_request: false,
                message: format!(
                    "{device} access is restricted by a device policy and cannot be changed."
                ),
            },
            _ => MediaPermissionStatus {
                // NOT_DETERMINED or any unknown value — dialog can be shown
                status: "notDetermined".into(),
                can_request: true,
                message: format!("{device} permission has not been requested yet."),
            },
        }
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// Check camera permission status without triggering any dialog.
/// Returns immediately on all platforms.
#[command]
pub fn check_camera_permission() -> MediaPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        // "vide" is AVMediaTypeVideo
        let raw = macos::av_capture_auth_status("vide");
        macos::status_from_raw(raw, "Camera")
    }
    #[cfg(not(target_os = "macos"))]
    {
        MediaPermissionStatus {
            status: "authorized".into(),
            can_request: false,
            message: "Camera access is assumed on non-macOS platforms.".into(),
        }
    }
}

/// Check microphone permission status without triggering any dialog.
#[command]
pub fn check_microphone_permission() -> MediaPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        // "soun" is AVMediaTypeAudio
        let raw = macos::av_capture_auth_status("soun");
        macos::status_from_raw(raw, "Microphone")
    }
    #[cfg(not(target_os = "macos"))]
    {
        MediaPermissionStatus {
            status: "authorized".into(),
            can_request: false,
            message: "Microphone access is assumed on non-macOS platforms.".into(),
        }
    }
}

/// Open System Settings to the Camera privacy pane on macOS.
/// Uses NSWorkspace so it works regardless of browser sandbox restrictions.
#[command]
pub async fn open_camera_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // x-apple.systempreferences deep link — works on macOS 13+
        // Falls back to the general Privacy pane on older versions.
        let url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera";
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Open System Settings to the Microphone privacy pane on macOS.
#[command]
pub async fn open_microphone_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}
