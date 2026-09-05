fn main() {
    // Tell Cargo to re-run this if these env vars change
    println!("cargo:rerun-if-env-changed=FFMPEG_DIR");
    println!("cargo:rerun-if-env-changed=FFMPEG_STATIC");

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
