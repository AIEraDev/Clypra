fn main() {
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

    tauri_build::build()
}
