//! Minimal VideoToolbox negotiation probe.
//!
//! Run on macOS with:
//! `cargo run --manifest-path src-tauri/Cargo.toml --example vt-frame-probe -- <media>`

#[cfg(target_os = "macos")]
mod macos {
    use ffmpeg_next as ffmpeg;
    use std::{
        error::Error,
        ffi::{CStr, OsString},
        os::raw::c_void,
        path::Path,
        ptr,
    };

    type CVPixelBufferRef = *mut c_void;
    type IOSurfaceRef = *mut c_void;

    #[link(name = "CoreVideo", kind = "framework")]
    extern "C" {
        fn CVPixelBufferGetPixelFormatType(buffer: CVPixelBufferRef) -> u32;
        fn CVPixelBufferGetIOSurface(buffer: CVPixelBufferRef) -> IOSurfaceRef;
    }

    // Standalone Cargo examples do not inherit the app target's static-FFmpeg
    // system-library link directives from `build.rs`.
    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {}
    #[link(name = "z")]
    extern "C" {}
    #[link(name = "bz2")]
    extern "C" {}
    #[link(name = "iconv")]
    extern "C" {}

    fn pixel_name(format: ffmpeg::ffi::AVPixelFormat) -> String {
        unsafe {
            let name = ffmpeg::ffi::av_get_pix_fmt_name(format);
            if name.is_null() {
                format!("unknown({format:?})")
            } else {
                CStr::from_ptr(name).to_string_lossy().into_owned()
            }
        }
    }

    unsafe extern "C" fn get_format(
        _ctx: *mut ffmpeg::ffi::AVCodecContext,
        formats: *const ffmpeg::ffi::AVPixelFormat,
    ) -> ffmpeg::ffi::AVPixelFormat {
        if formats.is_null() {
            eprintln!("get_format offered=[] selected=none");
            return ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE;
        }

        let mut offered = Vec::new();
        let mut current = formats;
        while *current != ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE {
            offered.push(*current);
            current = current.add(1);
        }

        let selected = offered
            .iter()
            .copied()
            .find(|format| *format == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX)
            .or_else(|| offered.first().copied())
            .unwrap_or(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE);
        let offered_names = offered
            .iter()
            .map(|format| pixel_name(*format))
            .collect::<Vec<_>>()
            .join(",");
        eprintln!(
            "get_format offered=[{}] selected={}",
            offered_names,
            pixel_name(selected)
        );
        selected
    }

    fn fourcc(value: u32) -> String {
        let bytes = value.to_be_bytes();
        if bytes.iter().all(|byte| byte.is_ascii_graphic()) {
            format!("'{}'", String::from_utf8_lossy(&bytes))
        } else {
            format!("0x{value:08x}")
        }
    }

    fn first_frame(
        decoder: &mut ffmpeg::codec::decoder::Video,
        input: &mut ffmpeg::format::context::Input,
        stream_index: usize,
    ) -> Result<ffmpeg::frame::Video, Box<dyn Error>> {
        for (stream, packet) in input.packets() {
            if stream.index() != stream_index || decoder.send_packet(&packet).is_err() {
                continue;
            }
            let mut frame = ffmpeg::frame::Video::empty();
            if decoder.receive_frame(&mut frame).is_ok() {
                return Ok(frame);
            }
        }
        decoder.send_eof()?;
        let mut frame = ffmpeg::frame::Video::empty();
        decoder.receive_frame(&mut frame)?;
        Ok(frame)
    }

    fn run_production_sequence(path: &str) -> Result<(), Box<dyn Error>> {
        use tauri_app_lib::filmstrip_engine::decoder::{
            DecodeFrameOptions, VideoColorMetadata, VideoDecoder,
        };
        use tauri_app_lib::native_core::QualityTier;

        let mut decoder = VideoDecoder::open_hardware(path)?;
        println!(
            "production.hw_decoder_opened={}",
            decoder.is_hardware_accelerated()
        );
        println!(
            "production.hw_device_type={}",
            decoder.hw_device_type().unwrap_or("none")
        );
        let options = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Full,
            is_playback: true,
            skip_hw_download: false,
            target_dimensions: None,
        };
        let mut shared = 0usize;
        let mut none = 0usize;
        let mut errors = 0usize;
        for index in 0..30 {
            let mut color = VideoColorMetadata::default();
            let mut width = 0;
            let mut height = 0;
            match decoder.decode_frame_metal_macos(
                index as f64 / 30.0,
                options,
                || false,
                &mut color,
                &mut width,
                &mut height,
            ) {
                Ok(Some(_)) => shared += 1,
                Ok(None) => none += 1,
                Err(error) => {
                    errors += 1;
                    eprintln!("production.frame[{index}].error={error}");
                }
            }
        }
        println!("production.sequence_frames=30");
        println!("production.sequence_shared={shared}");
        println!("production.sequence_none={none}");
        println!("production.sequence_errors={errors}");
        Ok(())
    }

    fn run_production_import(path: &str) -> Result<(), Box<dyn Error>> {
        use tauri_app_lib::filmstrip_engine::decoder::{
            DecodeFrameOptions, VideoColorMetadata, VideoDecoder,
        };
        use tauri_app_lib::native_core::QualityTier;
        use tauri_app_lib::wgpu_compositor::{metal_import, GpuContext};

        let mut decoder = VideoDecoder::open_hardware(path)?;
        let mut color = VideoColorMetadata::default();
        let mut width = 0;
        let mut height = 0;
        let frame = decoder
            .decode_frame_metal_macos(
                0.0,
                DecodeFrameOptions {
                    allow_keyframe_approx: false,
                    quality: QualityTier::Full,
                    is_playback: true,
                    skip_hw_download: false,
                    target_dimensions: None,
                },
                || false,
                &mut color,
                &mut width,
                &mut height,
            )?
            .ok_or("production decoder returned no shared frame")?;
        println!("production.import_source={}x{}", width, height);

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let gpu = tauri::async_runtime::block_on(GpuContext::select_best_gpu(&instance))?;
        println!("production.gpu_backend={:?}", gpu.info.backend);
        println!(
            "production.gpu_metal_import={}",
            gpu.capabilities.metal_import
        );
        println!("production.gpu_16bit_norm={}", gpu.capabilities.hdr);
        match metal_import::import_into_wgpu(&gpu.device, frame) {
            Ok(imported) => {
                println!("production.import_result=ok");
                println!("production.import_format={:?}", imported.format);
            }
            Err(reason) => println!("production.import_result=error:{reason:?}"),
        }
        Ok(())
    }

    pub fn run(
        path: &str,
        production_sequence: bool,
        production_import: bool,
    ) -> Result<(), Box<dyn Error>> {
        let display_name = Path::new(path)
            .file_name()
            .map(OsString::from)
            .unwrap_or_else(|| OsString::from("<input>"));
        ffmpeg::init()?;
        ffmpeg::util::log::set_level(ffmpeg::util::log::Level::Debug);

        let configuration = unsafe { ffmpeg::ffi::avcodec_configuration() };
        let configuration = unsafe { CStr::from_ptr(configuration) }.to_string_lossy();
        println!("input={}", display_name.to_string_lossy());
        println!("avcodec_configuration={configuration}");

        let mut input = ffmpeg::format::input(path)?;
        let stream = input
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or("no video stream")?;
        let stream_index = stream.index();
        println!("stream_index={stream_index}");
        println!("codec={}", stream.parameters().id().name());

        if production_sequence {
            run_production_sequence(path)?;
            return Ok(());
        }
        if production_import {
            run_production_import(path)?;
            return Ok(());
        }

        let mut context = ffmpeg::codec::context::Context::from_parameters(stream.parameters())?;
        let mut hw_device = ptr::null_mut();
        let device_ret = unsafe {
            ffmpeg::ffi::av_hwdevice_ctx_create(
                &mut hw_device,
                ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX,
                ptr::null(),
                ptr::null_mut(),
                0,
            )
        };
        println!("av_hwdevice_ctx_create_ret={device_ret}");
        if device_ret < 0 || hw_device.is_null() {
            return Err(format!("VideoToolbox device creation failed: {device_ret}").into());
        }

        unsafe {
            (*context.as_mut_ptr()).hw_device_ctx = ffmpeg::ffi::av_buffer_ref(hw_device);
            ffmpeg::ffi::av_buffer_unref(&mut hw_device);
            (*context.as_mut_ptr()).get_format = Some(get_format);
        }
        let mut decoder = context.decoder().video()?;
        let frame = first_frame(&mut decoder, &mut input, stream_index)?;
        let raw = unsafe { &*frame.as_ptr() };
        let frame_format = raw.format;
        let frame_format =
            unsafe { std::mem::transmute::<i32, ffmpeg::ffi::AVPixelFormat>(frame_format) };
        let hw_frames_sw_format = unsafe {
            if raw.hw_frames_ctx.is_null() || (*raw.hw_frames_ctx).data.is_null() {
                None
            } else {
                Some(
                    (*((*raw.hw_frames_ctx).data as *const ffmpeg::ffi::AVHWFramesContext))
                        .sw_format,
                )
            }
        };
        println!("first_frame.format={}", pixel_name(frame_format));
        println!(
            "first_frame.hw_frames_ctx.sw_format={}",
            hw_frames_sw_format
                .map(pixel_name)
                .unwrap_or_else(|| "none".to_string())
        );
        println!("first_frame.data[3]={}", !raw.data[3].is_null());

        if frame_format == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX
            && !raw.data[3].is_null()
        {
            let pixel_buffer = raw.data[3] as CVPixelBufferRef;
            let cv_format = unsafe { CVPixelBufferGetPixelFormatType(pixel_buffer) };
            let iosurface = unsafe { CVPixelBufferGetIOSurface(pixel_buffer) };
            println!("cv_pixel_buffer.fourcc={}", fourcc(cv_format));
            println!("cv_pixel_buffer.iosurface={}", !iosurface.is_null());
            println!(
                "decode_path={}",
                if !iosurface.is_null() {
                    "VtZeroCopy"
                } else {
                    "VtDownload(iosurface_missing)"
                }
            );
        } else if frame_format == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX {
            println!("decode_path=VtDownload(pixel_buffer_missing)");
        } else {
            println!("decode_path=Software(format_not_videotoolbox)");
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: vt-frame-probe <media-path> [--production-sequence|--production-import]");
        std::process::exit(2);
    };
    let production_sequence = args.any(|arg| arg == "--production-sequence");
    let production_import = std::env::args().any(|arg| arg == "--production-import");
    if let Err(error) = macos::run(&path, production_sequence, production_import) {
        eprintln!("probe_error={error}");
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("vt-frame-probe requires macOS VideoToolbox");
    std::process::exit(2);
}
