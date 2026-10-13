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
/// `reason` — optional kebab-case code (e.g. "dxgi-decode-failed").
/// Unrecognised or absent values default to "unsupported-feature".
#[tauri::command]
pub fn force_dxgi_latch(reason: Option<String>) -> Result<String, String> {
    use crate::wgpu_compositor::adapter_selector::{
        mark_dxgi_runtime_disabled_with_reason, parse_dxgi_latch_reason, DxgiLatchReasonCode,
    };
    let code = reason
        .as_deref()
        .and_then(parse_dxgi_latch_reason)
        .unwrap_or(DxgiLatchReasonCode::UnsupportedFeature);
    mark_dxgi_runtime_disabled_with_reason(code);
    Ok(code.to_string())
}

/// Clears the DXGI latch state atomics so subsequent stats() calls return the
/// unlatched state.  Useful for resetting between chain-test assertions.
#[tauri::command]
pub fn reset_dxgi_latch() -> Result<(), String> {
    crate::wgpu_compositor::adapter_selector::reset_dxgi_latch_state_for_tests();
    Ok(())
}
