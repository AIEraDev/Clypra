use super::models::{AudioExtractionRequest, MediaStreamInfo};
use super::probe::{fingerprint, parse_streams, plan_output};

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(codec: &str) -> MediaStreamInfo {
        MediaStreamInfo {
            index: 2,
            stream_type: "audio".to_string(),
            codec: codec.to_string(),
            codec_long_name: None,
            duration: Some(4.0),
            time_base_num: Some(1),
            time_base_den: Some(48_000),
            sample_rate: Some(48_000),
            channels: Some(2),
            channel_layout: Some("stereo".to_string()),
            bitrate: None,
            language: None,
            label: None,
            ..Default::default()
        }
    }

    #[test]
    fn plans_copy_containers_for_editor_codecs() {
        let request = AudioExtractionRequest {
            source_asset_id: "asset".into(),
            source_path: "source.mp4".into(),
            source_stream_index: 2,
            mode: "auto".into(),
            output_codec: None,
            output_container: None,
        };
        assert_eq!(
            plan_output(&stream("aac"), &request).unwrap().0,
            "streamCopy"
        );
        assert_eq!(plan_output(&stream("aac"), &request).unwrap().1, "m4a");
        assert_eq!(plan_output(&stream("mp3"), &request).unwrap().1, "mp3");
        assert_eq!(plan_output(&stream("opus"), &request).unwrap().1, "webm");
        assert_eq!(plan_output(&stream("flac"), &request).unwrap().1, "flac");
    }

    #[test]
    fn unsupported_auto_codec_falls_back_to_transcode() {
        let request = AudioExtractionRequest {
            source_asset_id: "asset".into(),
            source_path: "source.mp4".into(),
            source_stream_index: 2,
            mode: "auto".into(),
            output_codec: None,
            output_container: None,
        };
        let (method, container, encoder) = plan_output(&stream("ac3"), &request).unwrap();
        assert_eq!(method, "transcode");
        assert_eq!(container, "m4a");
        assert_eq!(encoder, "aac");
    }

    #[test]
    fn fingerprint_is_deterministic_and_stream_specific() {
        let request = AudioExtractionRequest {
            source_asset_id: "asset".into(),
            source_path: "source.mp4".into(),
            source_stream_index: 2,
            mode: "auto".into(),
            output_codec: None,
            output_container: None,
        };
        let first = fingerprint(&request, "streamCopy", "m4a", "copy");
        let second = fingerprint(&request, "streamCopy", "m4a", "copy");
        assert_eq!(first, second);
        let mut other = request.clone();
        other.source_stream_index = 3;
        assert_ne!(first, fingerprint(&other, "streamCopy", "m4a", "copy"));
    }

    #[test]
    fn parse_streams_detects_google_pixel_vfr_and_high_risk() {
        let json_str = r#"{
            "format": {
                "tags": {
                    "com.android.manufacturer": "Google",
                    "com.android.model": "Pixel 7 Pro"
                }
            },
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "hevc",
                    "width": 3840,
                    "height": 2160,
                    "r_frame_rate": "60/1",
                    "avg_frame_rate": "58.42/1",
                    "pix_fmt": "yuv420p10le",
                    "color_space": "bt2020nc",
                    "color_transfer": "arib-std-b67"
                }
            ]
        }"#;
        let v: serde_json::Value = serde_json::from_str(json_str).unwrap();
        let streams = parse_streams(&v);
        assert_eq!(streams.len(), 1);
        let s = &streams[0];
        assert_eq!(s.device_origin.as_deref(), Some("google-pixel"));
        assert_eq!(s.device_model.as_deref(), Some("Pixel 7 Pro"));
        assert_eq!(s.is_vfr, Some(true));
        assert_eq!(s.is_high_risk, Some(true));
        let risks = s.risk_factors.as_ref().unwrap();
        assert!(risks.contains(&"google-pixel-camera-source".to_string()));
        assert!(risks.contains(&"google-pixel-vfr-timing-instability".to_string()));
        assert!(risks.contains(&"google-pixel-10bit-hevc-seek-stall".to_string()));
    }

    #[test]
    fn parse_streams_detects_vfr_jitter_fixture() {
        let json_str = r#"{
            "format": {
                "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
                "duration": "0.800000"
            },
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 640,
                    "height": 360,
                    "r_frame_rate": "60/1",
                    "avg_frame_rate": "75/4"
                }
            ]
        }"#;
        let v: serde_json::Value = serde_json::from_str(json_str).unwrap();
        let streams = parse_streams(&v);
        assert_eq!(streams.len(), 1);
        let s = &streams[0];
        assert_eq!(s.is_vfr, Some(true), "60fps r_frame_rate vs 18.75fps avg_frame_rate must be flagged as VFR");
        let risks = s.risk_factors.as_ref().expect("Risk factors must be populated for VFR");
        assert!(risks.contains(&"variable-frame-rate".to_string()), "Must flag variable-frame-rate risk factor");
    }
}
