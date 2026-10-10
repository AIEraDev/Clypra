---
name: tauri-native-thread-safety
description: >-
  Govern cross-platform native thread safety, operating-system window management,
  and asynchronous platform UI dispatch in Clypra's Tauri v2 desktop application.
  Enforces Architecture Invariant 16 across macOS (AppKit/NSWindow), Windows (Win32/HWND),
  and Linux (GTK/WebKitGTK). Activate when touching native windows, views, graphics surfaces,
  Tao/Wry window APIs, SetWindowPos, addChildWindow, GTK widgets, msg_send!, or investigating
  SIGTRAP, main-thread assertions, HWND queue deadlocks, or cross-platform UI crashes.
---

# Clypra Cross-Platform Tauri Native Thread Safety Engineering

## 1. Mission & Architectural Invariant (Invariant 16)

Clypra is a high-performance native desktop NLE targeting macOS, Windows, and Linux.
The native preview pipeline involves custom window creation, layering above/below WebViews,
transparent child surfaces, and direct GPU presentation (`wgpu`).

**Architecture Invariant 16**:
> **All native window, view, and OS-level UI hierarchy operations across macOS (AppKit/NSWindow),
> Windows (Win32/HWND), and Linux (GTK/GtkWidget) must execute exclusively on the thread
> owning the native window/event loop via `window.run_on_main_thread()` or `app.run_on_main_thread()`.**
>
> Background tasks — Tokio async workers, render loops, audio threads, background Tauri command
> threads, and worker pools — must **never** invoke restricted platform UI APIs directly.
> Background tasks must request operations via approved main-thread dispatch boundaries.

---

## 2. Platform-Specific Threading Contracts

Native operating-system windowing models do not share a single generic threading implementation.
Engineers must understand the distinct OS-level constraints for every platform Clypra supports:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Background Execution                                   │
│                  (Tokio Workers, Render Loops, Audio WSOLA, File I/O)                  │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼  window.run_on_main_thread()
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Main UI Thread Boundary                                │
├──────────────────────────┬─────────────────────────────┬───────────────────────────────┤
│          macOS           │           Windows           │             Linux             │
│   (AppKit / Cocoa)       │       (Win32 / Tao)         │      (GTK / WebKitGTK)        │
├──────────────────────────┼─────────────────────────────┼───────────────────────────────┤
│ • NSWindow is main-actor │ • HWND owned by creator     │ • GTK objects not thread-safe │
│   isolated.              │   thread message loop.      │ • Must run on default         │
│ • addChildWindow, show,  │ • SetWindowPos, ShowWindow, │   GMainContext event loop.    │
│   hide, close, orderFront│   SetWindowLongPtrW must run│ • Direct calls trigger GLib   │
│   assert main thread.    │   on message loop thread.   │   assertion warnings or aborts│
│ • SIGTRAP on violation.  │ • Stalls/races if cross-thd.│ • Wayland/X11 race crashes.   │
└──────────────────────────┴─────────────────────────────┴───────────────────────────────┘
```

### 2.1 macOS (AppKit / Cocoa)
- **Constraint**: `NSWindow` and its associated views are main-actor-isolated in AppKit. Operations mutating window hierarchy, visibility, ordering, or style must execute on the macOS main Cocoa run loop.
- **Enforcement in OS**: macOS 26+ and modern Cocoa frameworks (`WindowManagement.framework`) enforce this with active assertions. Calling APIs such as `-[NSWindow addChildWindow:ordered:]`, `-[NSWindow orderOut:]`, `-[NSWindow makeKeyAndOrderFront:]`, or modifying collection behaviors from a Tokio background thread triggers an immediate `EXC_BREAKPOINT (SIGTRAP)` with:
  ```
  Application Specific Information:
  Must only be used from the main thread
  ```
- **Historical Case Study (Clypra Bug 13)**:
  During cold playback startup, a Tokio worker thread called `surface.show_surface()`, which invoked `objc2::msg_send![parent, addChildWindow: child, ordered: 1isize]`. This crashed the process with `SIGTRAP` on Thread 12 (`tokio-rt-worker`). The fix requires scheduling the call via `surface_window.run_on_main_thread()`.

### 2.2 Windows (Win32 / Tao)
- **Constraint**: A Win32 window (`HWND`) has thread affinity with the thread that called `CreateWindowExW` and runs its `GetMessage`/`DispatchMessage` loop. In Tauri v2, this is the main thread managed by Tao.
- **Enforcement in OS**: Win32 window APIs such as `SetWindowPos`, `ShowWindow`, `SetWindowLongPtrW`, and `DestroyWindow` must execute on the thread owning the HWND. Cross-thread window operations can result in synchronous message deadlocks, dropped messages, failure of DWM composition synchronization (e.g. `WS_EX_LAYERED` child window layering behind WebView2), or `ERROR_ACCESS_DENIED`.
- **Requirements in Clypra**:
  - `SetWindowPos(HWND_TOP, ...)` used to keep the transparent child surface above WebView2 must run on the main UI thread.
  - Window style updates (`GWL_EXSTYLE` with `WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE`) must be dispatched to the main UI thread during configuration.

### 2.3 Linux (GTK 3/4 / WebKitGTK)
- **Constraint**: GTK is not thread-safe. The GTK toolkit documentation explicitly states that all GTK objects must only be accessed and manipulated from the thread running the default `GMainContext` (the thread calling `gtk_main` or running Tauri's main loop).
- **Enforcement in OS**: Accessing `GtkWindow` or `GtkWidget` from Tokio worker threads leads to memory corruption, GLib assertion failures (`G_IS_WIDGET(widget)` failing), or X11/Wayland event loop race crashes.
- **Requirements in Clypra**:
  - Any child window positioning, window reparenting, showing/hiding, or WebKitGTK inspector hooks must be routed via `window.run_on_main_thread()`.

---

## 3. Five Core Disciplines of Native Thread Safety

Every change touching native windowing or platform integration must strictly adhere to these 5 disciplines:

### Discipline 1: Thread-Affinity Inventory
Before modifying or introducing native platform code, audit the threading requirements of every affected API:
| API / Object | Thread Required | Safe on Background Thread? | Notes |
|---|---|---|---|
| `window.show()` / `window.hide()` | **Main Thread** | ❌ NO | Triggers AppKit/Win32/GTK window visibility calls |
| `window.close()` | **Main Thread** | ❌ NO | Destroys OS window resources |
| `addChildWindow:ordered:` (macOS) | **Main Thread** | ❌ NO | AppKit hierarchy mutation |
| `SetWindowPos` / `SetWindowLongPtrW` (Win32) | **Main Thread** | ❌ NO | Win32 message loop thread affinity |
| `set_ignore_cursor_events` | **Main Thread** | ❌ NO | Modifies OS hit-testing flags |
| `window.inner_size()` / `position()` | Any Thread (read) | ⚠️ Conditional | Safe if cached; prefer querying during main-thread setup |
| `wgpu::Surface::get_current_texture()` | Any Thread | ✅ YES | GPU/Metal/DXGI surface acquisition is thread-agnostic |
| `wgpu::Queue::submit()` | Any Thread | ✅ YES | wgpu command submission handles internal locking |
| `SurfaceTexture::present()` | Any Thread | ✅ YES | Direct swapchain presentation |

### Discipline 2: Safe Dispatch Boundaries
All background operations requesting native UI modifications must use the approved Tauri dispatch abstractions:

#### Pattern A: Fire-and-Forget (No result needed by caller)
Used for presentation show/hide transitions where the background worker does not block:
```rust
// Clone the window handle before moving into the closure
let sw = surface_window.clone();
#[cfg(target_os = "macos")]
let parent_clone = self.parent_window.clone();

surface_window
    .run_on_main_thread(move || {
        if let Err(e) = sw.show() {
            log::warn!("[NativeSurface] show failed: {e}");
            return;
        }

        #[cfg(target_os = "macos")]
        unsafe {
            if let Some(parent) = &parent_clone {
                if let (Ok(ns_win), Ok(parent_ns_win)) = (sw.ns_window(), parent.ns_window()) {
                    let _: () = objc2::msg_send![
                        parent_ns_win as *mut objc2::runtime::AnyObject,
                        addChildWindow: ns_win as *mut objc2::runtime::AnyObject,
                        ordered: 1isize // NSWindowAbove = 1
                    ];
                }
            }
        }
    })
    .map_err(|e| format!("Unable to dispatch show to main thread: {e}"))?;
```

#### Pattern B: Asynchronous Completion (Caller needs operation result)
Used for setup, configuration, and resizing where the caller must await the outcome:
```rust
let (sender, receiver) = tokio::sync::oneshot::channel();
let surface_window = window.clone();
let surface_app = app.clone();

window
    .run_on_main_thread(move || {
        let result = configure_surface(surface_app, surface_window, gpu, geometry, runtime);
        let _ = sender.send(result);
    })
    .map_err(|error| format!("Unable to schedule configuration: {error}"))?;

receiver
    .await
    .map_err(|_| "Configuration was cancelled".to_string())?
```

### Discipline 3: Lifecycle Correctness & State Transitions
Because `run_on_main_thread` enqueues work onto the main loop asynchronously, state flags must account for the queueing delay:
- **Optimistic Show Guarding**: When requesting a show, check `is_shown` first (atomic acquire). If false, enqueue the main-thread task and set `is_shown = true` (atomic release). This prevents every subsequent 60fps render frame from queueing redundant main-thread closures.
- **Pessimistic Hide Guarding**: When requesting a hide, set `is_shown = false` (atomic release) *immediately before* enqueueing `window.hide()`. Concurrent render workers immediately see the surface as hidden and cease trying to acquire or present swapchain textures.
- **Session Reset Invariant**: On project close or reset, advance `runtime_epoch`, drop GPU surfaces, take the window handle, and enqueue `window.close()` on the main thread. In-flight presentations from stale sessions discard their work when observing an epoch mismatch.

### Discipline 4: Static Architecture Enforcement
The repository harness automatically inspects native code to ensure direct window mutations do not bypass `run_on_main_thread`:
- **Enforcement Script**: `scripts/harness/check-architecture.mjs` (Check 7: Native UI Thread Safety).
- **Verified Files**: `src-tauri/src/commands/native_surface.rs` and related native modules.
- **Verification Command**: `npm run verify:architecture` (part of `npm run verify:fast` and CI).

### Discipline 5: Platform-Specific Runtime Verification
Mocked unit tests and compilation passes are not sufficient proof that native thread safety is maintained on real operating systems.
- **macOS**:
  - Run under Apple's Main Thread Checker:
    ```bash
    DYLD_INSERT_LIBRARIES=/Applications/Xcode.app/Contents/Developer/usr/lib/libMainThreadChecker.dylib \
      MTC_RESET_INSERT_LIBRARIES=0 \
      ./src-tauri/target/debug/clypra
    ```
- **Windows**:
  - Verify with Application Verifier / WinDbg: Inspect that thread creating HWND handles matches thread executing `SetWindowPos`.
- **Linux**:
  - Run with `G_DEBUG=fatal-warnings` or `G_ENABLE_DIAGNOSTIC=1` to ensure no GLib or GTK threading warnings are emitted during window operations.

---

## 4. Mandatory Completion Checklist

Before declaring any native UI or windowing task complete:
1. **Thread-Affinity Audit**: Listed all native APIs touched and verified their OS thread requirements.
2. **Dispatch Boundary Verified**: Confirmed no bare `show()`, `hide()`, `close()`, `addChildWindow`, or `SetWindowPos` calls exist in Tokio async contexts or render workers.
3. **State Machine Checked**: Atomic visibility flags (`is_shown`) prevent redundant queueing and race conditions.
4. **Rust Compilation Passed**: `cargo check --manifest-path src-tauri/Cargo.toml` passed with 0 errors.
5. **Lifecycle Unit Tests Passed**: `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::native_surface::tests` passed.
6. **Architecture Invariant Check Passed**: `npm run verify:architecture` passed with 100% check parity.
7. **Documentation Parity**: Links in `docs/engineering/` and `AGENTS.md` updated and validated via `npm run docs:check`.
