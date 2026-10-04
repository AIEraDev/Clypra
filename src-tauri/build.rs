#![allow(clippy::disallowed_methods)]

fn main() {
    // Tell Cargo to re-run this if these env vars change
    println!("cargo:rerun-if-env-changed=FFMPEG_DIR");
    println!("cargo:rerun-if-env-changed=FFMPEG_STATIC");

    // Re-run if git HEAD, active branch ref, packed-refs, or index changes
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    println!("cargo:rerun-if-changed=../.git/packed-refs");
    if let Ok(head) = std::fs::read_to_string("../.git/HEAD") {
        if let Some(ref_path) = head.strip_prefix("ref: ") {
            let path = format!("../.git/{}", ref_path.trim());
            println!("cargo:rerun-if-changed={path}");
        }
    }

    let git_sha = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
        .or_else(|| std::env::var("GITHUB_SHA").ok())
        .or_else(|| std::env::var("CI_COMMIT_SHA").ok())
        .unwrap_or_else(|| "unknown".to_string());

    let git_dirty = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .map(|output| output.status.success() && !output.stdout.is_empty())
        .unwrap_or(false);

    println!("cargo:rustc-env=CLYPRA_GIT_COMMIT={git_sha}");
    println!("cargo:rustc-env=CLYPRA_GIT_DIRTY={git_dirty}");

    // On macOS, link required system libraries for static FFmpeg and set bundle rpath
    #[cfg(target_os = "macos")]
    {
        // Frameworks directory inside the .app bundle
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../lib");

        // System libraries required by static FFmpeg
        println!("cargo:rustc-link-lib=z");
        println!("cargo:rustc-link-lib=bz2");
        println!("cargo:rustc-link-lib=iconv");
    }

    // On Linux AppImage, libs sit next to the binary and link system libraries
    #[cfg(target_os = "linux")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib");
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");

        println!("cargo:rustc-link-lib=z");
        println!("cargo:rustc-link-lib=m");
    }

    // FFmpeg static on Windows requires system libraries that vcpkg doesn't automatically pass downstream
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-lib=strmiids");
        println!("cargo:rustc-link-lib=ole32");
        println!("cargo:rustc-link-lib=oleaut32");
        println!("cargo:rustc-link-lib=uuid");
        println!("cargo:rustc-link-lib=mfplat");
        println!("cargo:rustc-link-lib=mfuuid");
        println!("cargo:rustc-link-lib=secur32");
        println!("cargo:rustc-link-lib=ws2_32");
        println!("cargo:rustc-link-lib=bcrypt");
        println!("cargo:rustc-link-lib=shlwapi");
        println!("cargo:rustc-link-lib=advapi32");
        println!("cargo:rustc-link-lib=mfreadwrite");
    }

    tauri_build::build()
}
