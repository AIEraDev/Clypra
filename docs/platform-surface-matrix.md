# Native Surface Matrix

The native surface is the required path for continuous native playback. The
RGBA bridge remains valid for paused frames and migration diagnostics only.

| Platform | wgpu backend | Surface strategy | Main risks | Gate |
| --- | --- | --- | --- | --- |
| macOS | Metal | Native view coordinated with WKWebView bounds | NSView stacking, Retina DPR, sleep/wake | Resize, click-through, recovery |
| Windows | DX12/DX11 | Native child/sibling surface coordinated with WebView2 | Z-order, DPI, device removal, focus | Resize, device loss, focus |
| Linux X11 | Vulkan/OpenGL | Native surface or controlled overlay | Window-manager stacking, DPR | Resize, input isolation |
| Linux Wayland | Vulkan/OpenGL | Native surface where compositor permits; dedicated native monitor fallback | Overlay restrictions, fractional scale | Fallback window, recovery |

## Required geometry contract

React reports physical-pixel `x`, `y`, `width`, `height`, and device pixel
ratio. Rust validates non-zero dimensions and positive finite DPR. The native
surface renders at physical dimensions; CSS pixels are never used as GPU
texture dimensions.

## Recovery contract

On resize, sleep/wake, or device loss: pause presentation, preserve the last
valid frame, recreate the device/surface resources, render the last requested
frame, then resume only after the surface is ready. Project reload is not an
acceptable recovery mechanism.

## Spike status

The current branch contains the geometry/status contract, wgpu adapter
selection, and `probe_native_surface`. The probe creates and configures a real
surface against the Tauri window on the UI main thread without presenting over
the editor. Run it on each target OS before enabling native presentation. The
final embedded surface still requires a dedicated child/overlay implementation
and resize/recovery tests. A dedicated native monitor window is the supported
fallback if WebView stacking cannot meet the input, resize, and latency
requirements on a platform.
