use crate::commands::filmstrip::cache_commands::prewarm_decoders;

#[tokio::test]
async fn prewarm_decoders_empty_returns_zero() {
    let result = prewarm_decoders(vec![]).await;
    assert_eq!(result, Ok(0));
}

#[tokio::test]
async fn prewarm_decoders_invalid_paths_degrades_gracefully() {
    let paths = vec![
        "/nonexistent/video1.mp4".to_string(),
        "/nonexistent/video2.mp4::stream::clip-99".to_string(),
    ];
    let result = prewarm_decoders(paths).await;
    assert_eq!(result, Ok(0));
}
