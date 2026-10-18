use super::asset::{
    can_stream_copy_video, is_browser_playable_audio, is_browser_playable_video,
    probe_video_codec,
};
use super::probe::decode_image_rgba_bytes;

#[test]
fn native_still_image_decode_preserves_alpha_and_exact_dimensions() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/clypra.png");
    let rgba = decode_image_rgba_bytes(
        fixture
            .to_str()
            .expect("repository fixture path should be valid UTF-8"),
        37,
        23,
    )
    .expect("RGBA PNG should decode natively");

    assert_eq!(rgba.len(), 37 * 23 * 4);
    assert!(rgba.chunks_exact(4).any(|pixel| pixel[3] < 255));
}

#[test]
fn test_browser_video_playability_rules() {
    assert!(is_browser_playable_video(Some("h264"), "mp4"));
    assert!(is_browser_playable_video(Some("avc1"), "mp4"));

    #[cfg(target_os = "macos")]
    {
        assert!(is_browser_playable_video(Some("hevc"), "mov"));
        assert!(is_browser_playable_video(Some("prores"), "mov"));
        assert!(can_stream_copy_video(Some("hevc")));
        assert!(is_browser_playable_audio(Some("eac3")));
        assert!(is_browser_playable_audio(Some("ac3")));
    }
    #[cfg(not(target_os = "macos"))]
    {
        assert!(!is_browser_playable_video(Some("hevc"), "mov"));
        assert!(!is_browser_playable_video(Some("prores"), "mov"));
        assert!(!can_stream_copy_video(Some("hevc")));
        assert!(!is_browser_playable_audio(Some("eac3")));
        assert!(!is_browser_playable_audio(Some("ac3")));
    }

    assert!(is_browser_playable_video(Some("vp9"), "webm"));
    assert!(is_browser_playable_audio(Some("aac")));
    assert!(is_browser_playable_audio(Some("mp3")));

    // Non-web codecs
    assert!(!is_browser_playable_video(Some("mpeg4"), "mp4"));
    assert!(!is_browser_playable_video(Some("wmv3"), "wmv"));
    assert!(!is_browser_playable_video(Some("flv1"), "flv"));

    #[cfg(target_os = "macos")]
    {
        if !crate::filmstrip_engine::decoder::VideoDecoder::macos_supports_hw_av1() {
            assert!(!is_browser_playable_video(Some("av1"), "mp4"));
            assert!(!can_stream_copy_video(Some("av1")));
        }
    }
    assert!(can_stream_copy_video(Some("h264")));
    assert!(!can_stream_copy_video(Some("mpeg4")));
}

#[tokio::test]
async fn test_probe_video_codec_on_av1_asset() {
    let path = "/Users/AIEraDev/Documents/clypra-testing-assets/54M views · 868K reactions ｜ Guest arrivals at the Guinness World Record Attempt and Birthday Party of @djprettyplay last night ｜ Oga Yenne TV [974631751768961].mp4";
    if std::path::Path::new(path).exists() {
        let codec = probe_video_codec(path).await;
        assert_eq!(codec.as_deref(), Some("av1"));
        #[cfg(target_os = "macos")]
        if !crate::filmstrip_engine::decoder::VideoDecoder::macos_supports_hw_av1() {
            assert!(!is_browser_playable_video(codec.as_deref(), "mp4"));
            assert!(!can_stream_copy_video(codec.as_deref()));
        }
    }
}
