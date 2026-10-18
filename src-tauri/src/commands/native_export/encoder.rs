use super::models::{HwAccelType, SelectedEncoder};

#[allow(dead_code)]
pub fn test_encoder_available(encoder: &str) -> bool {
    let output = crate::commands::binary_resolver::create_std_command("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "nullsrc=s=64x64:d=0.04",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-",
        ])
        .output();
    if let Ok(out) = output {
        out.status.success()
    } else {
        false
    }
}

pub fn detect_best_encoder(codec: &str) -> SelectedEncoder {
    #[cfg(target_os = "macos")]
    {
        match codec {
            "h265" | "hevc" => SelectedEncoder {
                codec_name: "hevc_videotoolbox".into(),
                hw_type: HwAccelType::VideoToolbox,
                hwaccel_flag: Some("videotoolbox".into()),
            },
            "prores" => SelectedEncoder {
                codec_name: "prores_videotoolbox".into(),
                hw_type: HwAccelType::VideoToolbox,
                hwaccel_flag: Some("videotoolbox".into()),
            },
            _ => SelectedEncoder {
                codec_name: "h264_videotoolbox".into(),
                hw_type: HwAccelType::VideoToolbox,
                hwaccel_flag: Some("videotoolbox".into()),
            },
        }
    }
    #[cfg(target_os = "windows")]
    {
        let is_hevc = codec == "h265" || codec == "hevc";
        if test_encoder_available("h264_nvenc") {
            SelectedEncoder {
                codec_name: if is_hevc {
                    "hevc_nvenc".into()
                } else {
                    "h264_nvenc".into()
                },
                hw_type: HwAccelType::Nvenc,
                hwaccel_flag: Some("cuda".into()),
            }
        } else if test_encoder_available("h264_qsv") {
            SelectedEncoder {
                codec_name: if is_hevc {
                    "hevc_qsv".into()
                } else {
                    "h264_qsv".into()
                },
                hw_type: HwAccelType::Qsv,
                hwaccel_flag: Some("qsv".into()),
            }
        } else if test_encoder_available("h264_amf") {
            SelectedEncoder {
                codec_name: if is_hevc {
                    "hevc_amf".into()
                } else {
                    "h264_amf".into()
                },
                hw_type: HwAccelType::Amf,
                hwaccel_flag: Some("d3d11va".into()),
            }
        } else {
            software_fallback_encoder(codec)
        }
    }
    #[cfg(target_os = "linux")]
    {
        let is_hevc = codec == "h265" || codec == "hevc";
        let vaapi_nodes = ["/dev/dri/renderD128", "/dev/dri/renderD129"];
        let valid_vaapi_node = vaapi_nodes.iter().find(|node| {
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(node)
                .is_ok()
        });

        if let Some(node) = valid_vaapi_node {
            if test_encoder_available(if is_hevc { "hevc_vaapi" } else { "h264_vaapi" }) {
                return SelectedEncoder {
                    codec_name: if is_hevc {
                        "hevc_vaapi".into()
                    } else {
                        "h264_vaapi".into()
                    },
                    hw_type: HwAccelType::Vaapi,
                    hwaccel_flag: Some(node.to_string()),
                };
            }
        }

        if test_encoder_available("h264_nvenc") {
            SelectedEncoder {
                codec_name: if is_hevc {
                    "hevc_nvenc".into()
                } else {
                    "h264_nvenc".into()
                },
                hw_type: HwAccelType::Nvenc,
                hwaccel_flag: Some("cuda".into()),
            }
        } else {
            software_fallback_encoder(codec)
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        software_fallback_encoder(codec)
    }
}

pub fn software_fallback_encoder(codec: &str) -> SelectedEncoder {
    let is_hevc = codec == "h265" || codec == "hevc";
    SelectedEncoder {
        codec_name: if codec == "prores" {
            "prores_ks".into()
        } else if is_hevc {
            "libx265".into()
        } else {
            "libx264".into()
        },
        hw_type: HwAccelType::Software,
        hwaccel_flag: None,
    }
}
