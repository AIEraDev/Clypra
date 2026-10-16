# Flow 05: The UNCH Sentinel Optimization Protocol

This document details the design, binary specification, and runtime handling of the `UNCH` (Unchanged Frame) sentinel protocol used to eliminate redundant memory allocations and canvas blits during static editing.

---

## 1. Problem Statement

In non-linear video editing, users spend substantial time in paused states: typing titles, adjusting audio levels, modifying inspector sliders, or positioning overlay handles. In these scenarios, the underlying video frame content is unchanged from the previous render tick. 

Without an unchanged frame optimization, every animation frame tick would:
1. Re-render the identical video frame in Rust offscreen.
2. Allocate an 8.29 MB RGBA byte buffer (at 1080p).
3. Serialize and transfer 8.29 MB over Tauri IPC.
4. Execute `ctx.putImageData` on the browser main thread, incurring garbage collection overhead.

---

## 2. Binary Sentinel Specification

When Rust detects that an incoming frame request matches the previously delivered frame for the active generation:
- Instead of returning a multi-megabyte image payload, Rust returns a 12-byte binary sentinel:

```
0                   4                   8                  12 (Bytes)
├───────────────────┼───────────────────────────────────────┤
│    ASCII "UNCH"   │      frame_index (u64 Little-Endian)  │
│  [0x55,0x4E,0x43, │      (64-bit unsigned integer)        │
│   0x48]           │                                       │
├───────────────────┼───────────────────────────────────────┤
```

- **Magic Bytes** (Bytes 0–3): ASCII string `"UNCH"` (`0x55, 0x4E, 0x43, 0x48`).
- **Frame Index** (Bytes 4–11): 64-bit unsigned integer in little-endian format encoding the verified frame index.

---

## 3. Backend Detection & Delivery (`src-tauri/src/commands/native_preview.rs`)

1. **Short-Circuit Verification**:
   - In `native_preview.rs#L4906-L4915`, `NativeFrameService::should_skip_unchanged()` inspects the request mode, generation token, and frame index:
     ```rust
     if cache.should_skip_unchanged(request.mode.as_deref(), request.generation, frame_index, &key) {
         let mut sentinel = [0u8; 12];
         sentinel[0..4].copy_from_slice(b"UNCH");
         sentinel[4..12].copy_from_slice(&frame_index.to_le_bytes());
         return Ok(tauri::ipc::Response::new(sentinel.to_vec()));
     }
     ```
2. **Telemetry Attribution**:
   - Deliveries using the sentinel record `strategy: "UNCH"` and `transfer_path: "unchanged-skip"` with `bytes_transferred: 12` (`[CODE:src-tauri/src/commands/native_preview.rs#L4933-L4939]`).

---

## 4. Frontend Interception (`NativeProgramPreview.tsx`)

1. **Sentinel Recognition**:
   - `NativeProgramPreview.tsx#L2140` intercepts the payload via `isUnchangedFramePayload(rgba)`:
     ```ts
     if (isUnchangedFramePayload(rgba)) {
       const existing = nativeDisplayedFrameRef.current;
       if (existing) {
         return existing;
       }
       throw new Error("Native preview returned UNCH but no frame has been displayed yet");
     }
     ```
2. **Repaint Elimination**:
   - Because `nativeDisplayedFrameRef.current` reference is preserved, `drawNativeFrameToCanvas` detects that the frame pointer is unchanged and skips `ctx.putImageData` entirely (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2134-L2150]`).
3. **Memory Savings**:
   - Reduces paused render loop memory bandwidth from ~500 MB/s to <1 KB/s, eliminating garbage collection pauses during timeline inspector adjustments.
