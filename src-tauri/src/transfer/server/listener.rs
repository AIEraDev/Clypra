use std::net::SocketAddr;
use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use tauri::AppHandle;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

use crate::transfer::TransferService;

use super::routes::*;
use super::types::AppState;

/// Build and start the Axum HTTP server. Tries ports 53317, 53318, 53319
/// before giving up. Returns the bound port on success.
pub async fn start(service: Arc<TransferService>, app_handle: AppHandle) -> Result<u16, String> {
    // Restrict CORS origins to local/Tauri origins only. Wildcard (*) is intentionally
    // forbidden to prevent browser-based cross-origin data exfiltration from external websites.
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost".parse().unwrap(),
            "http://127.0.0.1".parse().unwrap(),
            "tauri://localhost".parse().unwrap(),
            "http://tauri.localhost".parse().unwrap(),
        ])
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
        ]);

    let state = AppState {
        service: service.clone(),
        app_handle,
    };

    let router = Router::new()
        .route("/", get(get_upload_page))
        // Dynamic theme endpoint for mobile hub
        .route("/api/transfer/theme", get(get_theme))
        // LocalSend v2 endpoints
        .route("/api/localsend/v2/info", get(get_localsend_info))
        .route("/api/localsend/v2/register", post(post_register))
        .route(
            "/api/localsend/v2/prepare-upload",
            post(post_prepare_upload),
        )
        .route("/api/localsend/v2/upload", post(post_upload))
        .route("/api/localsend/v2/cancel", post(post_cancel))
        // Web Hub file download endpoints (Laptop -> Phone)
        .route("/api/transfer/files", get(get_staged_files))
        .route("/api/transfer/download/:file_id", get(download_staged_file))
        .route("/api/transfer/view/:file_id", get(view_staged_file))
        .layer(cors)
        .with_state(state);

    let base_port = service.server_port;
    for attempt in 0u16..3 {
        let port = base_port + attempt;
        let addr = format!("0.0.0.0:{}", port);
        match TcpListener::bind(&addr).await {
            Ok(listener) => {
                log::info!("[Transfer] HTTP server listening on {}", addr);
                let svc_running = service.server_running.clone();
                tokio::spawn(async move {
                    axum::serve(
                        listener,
                        router.into_make_service_with_connect_info::<SocketAddr>(),
                    )
                    .await
                    .unwrap_or_else(|e| log::error!("[Transfer] Server error: {e}"));
                    svc_running.store(false, std::sync::atomic::Ordering::Relaxed);
                });
                return Ok(port);
            }
            Err(e) => {
                log::warn!("[Transfer] Port {port} unavailable: {e}");
            }
        }
    }

    Err(format!(
        "Could not bind to ports {base_port}–{}",
        base_port + 2
    ))
}
