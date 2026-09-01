fn main() {
    // Watch the frontend build output so changes to ../dist trigger a rebuild.
    // Without this, editing src/ alone won't invalidate the cargo fingerprint
    // (cargo hashes file *contents*, not mtimes), and the old frontend stays
    // embedded in the exe.
    // NOTE(2026-09-01): cargo's directory-level rerun-if-changed was observed to
    // MISS ../dist changes in practice, leaving stale frontend embedded. Bumping
    // this file (or running `cargo clean -p clypra`) forces tauri-build to
    // re-copy ../dist into OUT_DIR. Keep this comment unique.
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../dist/index.html");
    println!("cargo:rerun-if-changed=../dist/assets");

    // Tell Cargo to re-run this if these env vars change
    println!("cargo:rerun-if-env-changed=FFMPEG_DIR");
    println!("cargo:rerun-if-env-changed=FFMPEG_STATIC");

    // On macOS, tell the binary where to find bundled dylibs at runtime
    // This sets the rpath so the app works when distributed
    #[cfg(target_os = "macos")]
    {
        // Frameworks directory inside the .app bundle
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../lib");
    }

    // On Linux AppImage, libs sit next to the binary
    #[cfg(target_os = "linux")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib");
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
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
