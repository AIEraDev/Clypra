/// Debug / test commands that help verify the end-to-end telemetry chain.
///
/// These commands are registered in all builds so the Tauri IPC layer
/// recognises them, but they only modify in-process state (atomics); they
/// have no side-effects on the render pipeline or production data.
///
/// Usage from DevTools console (tauri dev):
///   await window.__TAURI__.core.invoke("force_dxgi_latch", { reason: "dxgi-decode-failed" })
///   await window.__TAURI__.core.invoke("reset_dxgi_latch")

/// Forces the DXGI runtime latch to the given reason code so the full
/// Rust→IPC→TypeScript→Worker→Neon chain can be verified without a real
/// D3D11 failure.  Returns the canonical kebab-case string that was stored.
///
/// Available only in debug builds (`debug_assertions`). Returns an error in
/// release so the command is safe to register in the shared handler list.
///
/// `reason` — optional kebab-case code (e.g. "dxgi-decode-failed").
/// Unrecognised or absent values default to "unsupported-feature".
#[tauri::command]
pub fn force_dxgi_latch(reason: Option<String>) -> Result<String, String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = reason;
        return Err("force_dxgi_latch is only available in debug builds".to_string());
    }
    #[cfg(debug_assertions)]
    {
        use crate::wgpu_compositor::adapter_selector::{
            latch_kind_for, mark_dxgi_runtime_disabled_with_context, parse_dxgi_latch_reason,
            DxgiLatchContext, DxgiLatchReasonCode,
        };
        let code = reason
            .as_deref()
            .and_then(parse_dxgi_latch_reason)
            .unwrap_or(DxgiLatchReasonCode::UnsupportedFeature);
        mark_dxgi_runtime_disabled_with_context(
            code,
            DxgiLatchContext {
                codec: None,
                bit_depth: None,
                source_width: None,
                source_height: None,
                hw_device_type: None,
                latched_at_ms: crate::native_core::performance::now_ms(),
                latch_kind: latch_kind_for(code),
            },
        );
        Ok(code.to_string())
    }
}

/// Clears the DXGI latch state atomics.  Available only in debug builds.
#[tauri::command]
pub fn reset_dxgi_latch() -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    return Err("reset_dxgi_latch is only available in debug builds".to_string());
    #[cfg(debug_assertions)]
    {
        crate::wgpu_compositor::adapter_selector::reset_dxgi_latch_state_for_tests();
        Ok(())
    }
}

/// Debug-only preview frame capture for Layer C end-to-end verification.
///
/// Returns raw RGBA8 pixels rendered by the native wgpu compositor.
/// Available ONLY in debug builds (`debug_assertions`).
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn capture_preview_frame(
    app: tauri::AppHandle,
    time: Option<f64>,
    request: Option<crate::native_core::FrameRequest>,
) -> Result<tauri::ipc::Response, String> {
    if let Some(req) = request {
        crate::commands::native_preview::render_native_frame(app, req).await
    } else {
        use crate::native_core::{
            ColorPolicy, FrameRequest, FrameTime, ProjectSnapshot, QualityTier, DEFAULT_TIME_SCALE,
            NATIVE_CORE_CONTRACT_VERSION,
        };
        let t = time.unwrap_or(0.0);
        let frame_index = (t * 30.0).round() as u64;
        let ticks = (t * DEFAULT_TIME_SCALE as f64).round() as i64;
        let req = FrameRequest {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: format!("debug-capture-{}", frame_index),
            frame_time: FrameTime::new(frame_index, ticks, DEFAULT_TIME_SCALE)
                .map_err(|e| e.to_string())?,
            project: ProjectSnapshot {
                schema_version: 1,
                project_revision: "debug-capture".to_string(),
                frame_rate: 30,
                canvas_width: 1920,
                canvas_height: 1080,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                video_layers: vec![],
                raster_layers: vec![],
                text_layers: vec![],
                transition: None,
            },
            output_width: 1920,
            output_height: 1080,
            quality: QualityTier::Full,
            color_policy: ColorPolicy::default(),
            render_graph_version: 1,
            mode: Some("frameStep".to_string()),
            generation: None,
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
        };
        crate::commands::native_preview::render_native_frame(app, req).await
    }
}

