# Deliverable 03.10: Flow 10: Native Surface Device Loss or Window Resize or Move During Playback (`10-surface-loss-resize-move.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User resizes application window or moves between monitors | `useNativeSurfaceController ResizeObserver (`src/components/editor/preview/useNativeSurfaceController.ts:145`)` | containerEl.getBoundingClientRect(), window.devicePixelRatio | resize_native_surface(geometry) | Invokes Tauri IPC resize_native_surface with physical pixel dimensions | [CODE] |
| 2 | Rust native surface handler updates OS window child geometry | `resize_native_surface (`src-tauri/src/commands/native_surface.rs:669`)` | app.get_webview_window('main') | window.run_on_main_thread() -> SetWindowPos / setFrame | Enforces UI thread safety (Invariant 16) during native NSView / HWND repositioning | [CODE] |
| 3 | GPU device loss detected (e.g. sleep/wake or driver reset) | `wgpu Surface Present (`src-tauri/src/wgpu_compositor/surface_presenter.rs:180`)` | wgpu::SurfaceError::Lost | Outdated | recreate_surface() | Re-creates swapchain configuration on main UI thread | [CODE] |
| 4 | Preview render loop recovers presentation | `NativeProgramPreview render loop (`src/components/editor/preview/NativeProgramPreview.tsx:1425`)` | presentResult.status | forceRepaintNativeProgramPreview() | Resumes normal hardware presentation without application crash | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `window-resized`, `surface-geometry-synced`, and `swapchain-recreated` records.
