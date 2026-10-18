use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) fn load_opt_u64(val: &AtomicU64) -> Option<u64> {
    let v = val.load(Ordering::Relaxed);
    if v == 0 {
        None
    } else {
        Some(v)
    }
}

// ── Platform Utilities: Process Creation, Uptime, Media Location ─────────────

#[cfg(target_os = "macos")]
pub(crate) fn get_process_creation_epoch_ms() -> Option<u64> {
    unsafe {
        let mut proc_info: libc::proc_bsdinfo = std::mem::zeroed();
        let pid = std::process::id() as i32;
        let st = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut proc_info as *mut _ as *mut libc::c_void,
            std::mem::size_of::<libc::proc_bsdinfo>() as i32,
        );
        if st as usize == std::mem::size_of::<libc::proc_bsdinfo>() {
            let start_sec = proc_info.pbi_start_tvsec;
            let start_usec = proc_info.pbi_start_tvusec;
            Some((start_sec as u64 * 1000) + (start_usec as u64 / 1000))
        } else {
            None
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn get_system_uptime_secs() -> Option<u64> {
    unsafe {
        let mut boottime: libc::timeval = std::mem::zeroed();
        let mut size = std::mem::size_of::<libc::timeval>();
        let mut mib = [libc::CTL_KERN, libc::KERN_BOOTTIME];
        if libc::sysctl(
            mib.as_mut_ptr(),
            2,
            &mut boottime as *mut _ as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        ) == 0
        {
            let mut now: libc::timeval = std::mem::zeroed();
            libc::gettimeofday(&mut now, std::ptr::null_mut());
            Some(now.tv_sec.saturating_sub(boottime.tv_sec) as u64)
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
#[allow(clippy::upper_case_acronyms)]
pub(crate) fn get_process_creation_epoch_ms() -> Option<u64> {
    type HANDLE = *mut std::ffi::c_void;
    type BOOL = i32;
    #[repr(C)]
    #[allow(non_snake_case)]
    struct FILETIME {
        dwLowDateTime: u32,
        dwHighDateTime: u32,
    }
    extern "system" {
        fn GetCurrentProcess() -> HANDLE;
        fn GetProcessTimes(
            hProcess: HANDLE,
            lpCreationTime: *mut FILETIME,
            lpExitTime: *mut FILETIME,
            lpKernelTime: *mut FILETIME,
            lpUserTime: *mut FILETIME,
        ) -> BOOL;
    }
    unsafe {
        let handle = GetCurrentProcess();
        let mut creation: FILETIME = std::mem::zeroed();
        let mut exit: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        if GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0 {
            let ft_intervals =
                ((creation.dwHighDateTime as u64) << 32) | (creation.dwLowDateTime as u64);
            // 116444736000000000 is 100ns intervals between 1601 and 1970 UTC
            if ft_intervals >= 116444736000000000 {
                let unix_intervals = ft_intervals - 116444736000000000;
                Some(unix_intervals / 10000)
            } else {
                None
            }
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn get_system_uptime_secs() -> Option<u64> {
    extern "system" {
        fn GetTickCount64() -> u64;
    }
    unsafe { Some(GetTickCount64() / 1000) }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn get_process_creation_epoch_ms() -> Option<u64> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn get_system_uptime_secs() -> Option<u64> {
    std::fs::read_to_string("/proc/uptime").ok().and_then(|s| {
        s.split_whitespace()
            .next()
            .and_then(|v| v.parse::<f64>().ok())
            .map(|u| u as u64)
    })
}

/// Classify a filesystem path as `"fixed"`, `"removable"`, or `"network"` drive.
/// Never logs, stores, or transmits the path.
#[cfg(target_os = "windows")]
#[allow(clippy::upper_case_acronyms)]
pub fn classify_media_location(path: &std::path::Path) -> &'static str {
    type UINT = u32;
    type LPCWSTR = *const u16;
    extern "system" {
        fn GetDriveTypeW(lpRootPathName: LPCWSTR) -> UINT;
    }
    let mut root = match path.components().next() {
        Some(c) => c.as_os_str().to_string_lossy().to_string(),
        None => return "unknown",
    };
    if !root.ends_with('\\') && !root.ends_with('/') {
        root.push('\\');
    }
    let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    let drive_type = unsafe { GetDriveTypeW(wide.as_ptr()) };
    match drive_type {
        3 => "fixed",         // DRIVE_FIXED
        2 | 5 => "removable", // DRIVE_REMOVABLE | DRIVE_CDROM
        4 => "network",       // DRIVE_REMOTE
        6 => "ramdisk",       // DRIVE_RAMDISK
        _ => "unknown",
    }
}

#[cfg(not(target_os = "windows"))]
pub fn classify_media_location(path: &std::path::Path) -> &'static str {
    use std::os::unix::ffi::OsStrExt;
    let c_path = match std::ffi::CString::new(path.as_os_str().as_bytes()) {
        Ok(c) => c,
        Err(_) => return "unknown",
    };
    unsafe {
        #[cfg(target_os = "macos")]
        {
            let mut stat: libc::statfs = std::mem::zeroed();
            if libc::statfs(c_path.as_ptr(), &mut stat) == 0 {
                let flags = stat.f_flags;
                // MNT_LOCAL is 0x00001000 on macOS
                let is_local = (flags & (libc::MNT_LOCAL as u32)) != 0;
                if !is_local {
                    "network"
                } else if path.starts_with("/Volumes") {
                    "removable"
                } else {
                    "fixed"
                }
            } else {
                "unknown"
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let mut stat: libc::statfs = std::mem::zeroed();
            if libc::statfs(c_path.as_ptr(), &mut stat) == 0 {
                // Common network filesystem types on Linux:
                // NFS (0x6969), SMB/CIFS (0x517B, 0xFE534D42), AFS (0x5346414F)
                let f_type = stat.f_type as u64;
                let is_network = f_type == 0x6969
                    || f_type == 0x517B
                    || f_type == 0xFE534D42
                    || f_type == 0x5346414F;
                if is_network {
                    "network"
                } else if path.starts_with("/media")
                    || path.starts_with("/mnt")
                    || path.starts_with("/run/media")
                {
                    "removable"
                } else {
                    "fixed"
                }
            } else {
                "unknown"
            }
        }
    }
}
