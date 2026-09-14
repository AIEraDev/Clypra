# Clypra Windows Physical Machine Testing Runbook & Engineering Protocol

**Document Status**: Permanent Canonical Engineering Protocol  
**Target Scope**: Physical Windows 10/11 x86_64 Machine Testing, Dev-Mode Execution, Hardware Subsystem Auditing, and Bug Discovery.  
**Related Documents**:
- [Platform Surface Matrix](platform-surface-matrix.md)
- [Native Media Architecture](native-architecture.md)
- [Program Preview Performance Runbook](program-preview-performance-runbook.md)
- [Native Performance Contract](performance-contract.md)

---

## 1. Executive Summary & Purpose

While Clypra's cross-platform architecture is tested in macOS and Linux CI environments, **physical Windows hardware exposes unique platform invariants** that virtualization and synthetic mocks cannot replicate:

1. **Direct3D12 / DXGI Surface Coordination**: Coordination between Microsoft WebView2 (`HWND`) and `wgpu` DX12 child surfaces.
2. **GPU Driver Resets & Device Loss**: Handling `DXGI_ERROR_DEVICE_REMOVED` / `DXGI_ERROR_DEVICE_RESET` during driver updates, sleep/wake, or manual resets (`Win + Ctrl + Shift + B`).
3. **Windows Audio Session API (WASAPI)**: Exclusive vs. shared mode audio clock timing, sample rate translation (44.1 kHz vs 48 kHz vs 96 kHz), and dynamic device detachment.
4. **Fractional Display Scaling**: 125%, 150%, and 175% Per-Monitor V2 DPI scaling across mixed-resolution displays.
5. **Windows Filesystem Invariants**: Drive letter boundaries (`C:\`, `D:\`), backslash normalization (`\`), URI schemes (`asset://localhost/C:/...`), and strict OS file locking (`ERROR_SHARING_VIOLATION`).
6. **Discrete vs. Integrated GPU Switching**: Laptops with NVIDIA Optimus (Intel iGPU + NVIDIA dGPU) or AMD Enduro switching.
7. **Hardware Codecs**: Native NVENC, Intel QuickSync (QSV), and AMD AMF hardware encoder pipelines.

This runbook provides an end-to-end guide to provisioning your rented Windows machine, compiling Clypra in development mode, executing forensic test suites, and extracting debugging evidence.

---

## 2. Machine Hardware & Operating System Checklist

When selecting or inspecting the physical Windows machine to rent, verify the following specifications:

| Component | Minimum Specification | Recommended Test Setup |
|---|---|---|
| **Operating System** | Windows 10 (21H2+, 64-bit) | Windows 11 (22H2 or 23H2, 64-bit) |
| **CPU** | Intel Core i5 8th Gen / AMD Ryzen 3000 (AVX2 required) | Intel Core i7 12th+ Gen / AMD Ryzen 5000+ (8+ cores) |
| **RAM** | 16 GB DDR4 | 32 GB DDR4/DDR5 |
| **GPU** | Integrated Intel UHD 630 / AMD Radeon Vega | **Dual GPU**: Integrated (Intel/AMD) + Discrete (NVIDIA RTX 30/40 series or AMD Radeon RX 6000+) |
| **Storage** | 50 GB free SSD space (preferably NVMe) | NVMe SSD with 2 drive letters (e.g. `C:\` and `D:\`) to test cross-volume path handling |
| **Display** | Single 1080p 60Hz display | **Dual Monitor**: Primary 4K (set to 150% DPI) + Secondary 1080p (set to 100% DPI) |
| **Audio** | Realtek High Definition Audio or USB DAC | 3.5mm Headphone Jack + Bluetooth Headphones (to test dynamic device switching) |
| **Peripherals** | Built-in or USB Webcam + Microphone | To test CrabCamera DirectShow/MediaFoundation capture |

---

## 3. Machine Provisioning & Toolchain Setup (PowerShell)

Open an **Elevated PowerShell Prompt (Run as Administrator)** on the rented Windows machine and execute the following setup steps.

### Step 3.1: Enable Developer Mode & UTF-8 / Git Configuration

```powershell
# 1. Enable Developer Mode (allows symlinks without administrator prompts)
reg add "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"

# 2. Configure Git to preserve LF line endings (DO NOT let Git convert to CRLF)
git config --global core.autocrlf false
git config --global core.eol lf
git config --global core.longpaths true
```

### Step 3.2: Install Package Managers & Core Runtimes

```powershell
# Install winget packages (Node.js LTS, Git, CMake, Python, LLVM)
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
winget install --id Git.Git -e
winget install --id Kitware.CMake -e
winget install --id Python.Python.3.12 -e
winget install --id LLVM.LLVM -e --version 18.1.8
```

### Step 3.3: Install Visual Studio 2022 C++ Build Tools

Tauri and Rust require MSVC (`x86_64-pc-windows-msvc`). Install the build tools with the C++ desktop workload:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --add Microsoft.VisualStudio.Component.VC.CMake.Project"
```

### Step 3.4: Install Rust Toolchain

```powershell
# Install Rustup
winget install --id Rustlang.Rustup -e

# Restart PowerShell, then configure default MSVC toolchain
rustup default stable-x86_64-pc-windows-msvc
rustup update
```

### Step 3.5: Install vcpkg & Compile Static FFmpeg 8.0 for Windows

Clypra links `ffmpeg-next` and `ffmpeg-sys-next` statically against FFmpeg libraries with the `x64-windows-static-md` triplet (static C-libraries with dynamic CRT linking):

```powershell
# Clone vcpkg at C:\vcpkg
cd C:\
git clone https://github.com/microsoft/vcpkg.git
cd C:\vcpkg
.\bootstrap-vcpkg.bat

# Build static FFmpeg 8.0 with required codec/container/resample packages
# Note: This compilation takes approximately 10–18 minutes depending on CPU core count
.\vcpkg.exe install ffmpeg[core,avcodec,avdevice,avfilter,avformat,swresample,swscale]:x64-windows-static-md
```

### Step 3.6: Set Permanent Windows Environment Variables

Set the environment variables so Cargo and CMake can resolve LLVM, FFmpeg, and vcpkg:

```powershell
# Set permanent User environment variables
[Environment]::SetEnvironmentVariable("VCPKG_ROOT", "C:\vcpkg", "User")
[Environment]::SetEnvironmentVariable("VCPKGRS_TRIPLET", "x64-windows-static-md", "User")
[Environment]::SetEnvironmentVariable("FFMPEG_DIR", "C:\vcpkg\installed\x64-windows-static-md", "User")
[Environment]::SetEnvironmentVariable("PKG_CONFIG_PATH", "C:\vcpkg\installed\x64-windows-static-md\lib\pkgconfig", "User")
[Environment]::SetEnvironmentVariable("LIBCLANG_PATH", "C:\Program Files\LLVM\bin", "User")

# Verify current session paths
$env:VCPKG_ROOT = "C:\vcpkg"
$env:VCPKGRS_TRIPLET = "x64-windows-static-md"
$env:FFMPEG_DIR = "C:\vcpkg\installed\x64-windows-static-md"
$env:PKG_CONFIG_PATH = "C:\vcpkg\installed\x64-windows-static-md\lib\pkgconfig"
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"

Write-Host "✅ Toolchain and FFmpeg environment configured successfully." -ForegroundColor Green
```

### Step 3.7: Windows Defender Performance Exclusion

Windows Defender real-time scanning will intercept every intermediate `.obj`, `.lib`, and `.rlib` file generated by Rust, causing builds to take 5x–10x longer or error out with `Access is denied (os error 5)` or `ERROR_SHARING_VIOLATION (os error 32)`.

Add your development directory to the Windows Defender exclusion list:

```powershell
# Replace C:\Projects\clypra-family with your actual clone directory
Add-MpPreference -ExclusionPath "C:\Projects\clypra-family"
Add-MpPreference -ExclusionProcess "cargo.exe"
Add-MpPreference -ExclusionProcess "rustc.exe"
Add-MpPreference -ExclusionProcess "clypra.exe"
```

---

## 4. Repository Setup & Launching Dev Mode

### Step 4.1: Clone the Repository

```powershell
mkdir C:\Projects
cd C:\Projects
git clone https://github.com/AIEraDev/clypra.git
cd C:\Projects\clypra
```

### Step 4.2: Install Frontend Dependencies

```powershell
# Install node dependencies
npm ci
```

### Step 4.3: Validate Document Links & Types

```powershell
npm run docs:check
npm run typecheck
```

### Step 4.4: Launch Clypra in Desktop Development Mode

Run the app with verbose Rust logging for `clypra`, `wgpu`, and `crabcamera`:

```powershell
# In PowerShell:
$env:RUST_LOG = "clypra=debug,clypra_native_core=debug,wgpu=info,wgpu_core=warn,crabcamera=debug"
$env:RUST_BACKTRACE = "1"

# Launch Tauri dev server:
npm run tauri dev
```

> [!TIP]
> **First Build Time**: The initial compilation on Windows will compile `wgpu`, `tokio`, `ffmpeg-next`, `whisper-rs`, and `crabcamera`. On an 8-core CPU this typically takes 4 to 8 minutes. Subsequent incremental builds take 3 to 10 seconds.

---

## 5. High-Risk Windows Architectural Failure Vectors

When testing on a physical Windows machine, focus attention on these 10 failure vectors:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       HIGH-RISK WINDOWS VECTORS                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Direct3D12/DXGI Swapchain ───► WebView2 Z-order, HWND coordinate sync   │
│ 2. GPU Device Loss (Win+Ctrl+Shift+B) ──► Surface recovery without crash   │
│ 3. Fractional DPI Scaling (125%/150%) ──► Physical pixel rounding errors   │
│ 4. WASAPI Audio Clock ──────────► Sample rate conversion, device hot-swap   │
│ 5. Windows Drive Letters ───────► C:\ vs D:\ in asset:// & file:// paths   │
│ 6. OS File Handle Locking ──────► Inability to delete/rename cached clips  │
│ 7. Dual-GPU Laptops ────────────► High-perf dGPU vs energy-efficient iGPU   │
│ 8. Hardware Export Encoders ────► NVENC vs AMF vs QSV vs CPU fallback      │
│ 9. CrabCamera DirectShow ───────► Exclusive camera lock by other apps      │
│ 10. WebView2 WebGPU Backend ────► MediaPipe segmentation fallback stability │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Direct3D12 / WebView2 Surface Coordination
- **Mechanism**: The React UI runs inside Microsoft Edge WebView2 (`msedgewebview2.exe`). In Clypra, continuous native playback relies on `wgpu` presenting directly to the window or child surface.
- **Risk**: On Windows, WebView2 renders via DirectComposition. If child surface bounds, DPI scaling, or z-ordering desynchronize, the native preview can flicker, appear black, or clip behind the timeline.
- **Verification**: Drag panels, resize the window quickly, maximize/minimize, and verify preview remains rock-solid.

### 2. GPU Driver Resets (`Win + Ctrl + Shift + B`)
- **Mechanism**: Windows allows users and GPU drivers (TDR - Timeout Detection and Recovery) to restart the graphics driver without rebooting.
- **Risk**: A driver reset destroys all `ID3D12Device` and `IDXGISwapChain` handles. If `wgpu_compositor` panics on `SurfaceError::Lost` or `DeviceLost`, the app crashes.
- **Verification**: Press `Win + Ctrl + Shift + B` during 4K video playback. Clypra must pause, recreate its GPU device and swapchain, and resume playback cleanly.

### 3. Mixed DPI Fractional Scaling
- **Mechanism**: Windows uses Per-Monitor V2 DPI scaling. A 4K monitor at 150% has a `devicePixelRatio` of 1.5; a 1080p monitor has 1.0.
- **Risk**: Fractional DPR values (e.g. 1.25, 1.5, 1.75) cause off-by-one pixel rounding errors in `toPhysicalDimension()`, leading to border seams or sub-pixel blur.
- **Verification**: Move Clypra from a 150% scaled display to a 100% scaled display while playing video.

### 4. Audio Engine & WASAPI Device Routing
- **Mechanism**: Windows uses WASAPI via `cpal`. Many Windows setups have different sample rates for different outputs (e.g. Realtek speakers at 48 kHz, USB DAC at 96 kHz, Bluetooth headset at 44.1 kHz or 16 kHz in headset mode).
- **Risk**: If the native audio clock assumes fixed 48 kHz buffers or crashes when an audio endpoint disappears, playback freezes.
- **Verification**: Unplug 3.5mm jack or turn off Bluetooth headphones during playback.

### 5. Drive Letters & Path Separators
- **Mechanism**: Windows paths use backslashes and drive letters: `D:\Video Footage\Clip_01.mp4`.
- **Risk**: Webviews expect forward slashes: `file:///D:/Video%20Footage/Clip_01.mp4` or Tauri's `asset://localhost/D:/...` (or `asset:///D:/...`). If `toNativePath()` strips the drive letter or misinterprets `D:` as a URI scheme, the native decoder fails to open the file.
- **Verification**: Load media files from a secondary drive (`D:\` or external USB drive `E:\`).

### 6. File Handle Locking (`ERROR_SHARING_VIOLATION`)
- **Mechanism**: On Windows, opening a file without `FILE_SHARE_DELETE` or `FILE_SHARE_READ` locks the file so no other process can modify or delete it.
- **Risk**: If Clypra's thumbnail engine (`decoder.rs`) or audio reader leaves an open file handle, the user cannot rename, move, or delete the video in Windows Explorer.
- **Verification**: Import a video, then attempt to rename or delete the source video file in Windows Explorer while Clypra is open.

---

## 6. The 15-Scenario Windows Test Execution Protocol

Execute these 15 concrete test scenarios on your physical Windows machine. Record all findings in your testing session log.

---

### Scenario 1: Clean Launch & System Capabilities Probe
- **Goal**: Confirm Tauri, WebView2, and native engine initialize without errors.
- **Steps**:
  1. Launch via PowerShell: `$env:RUST_LOG="clypra=debug,wgpu=info"; npm run tauri dev`.
  2. Open DevTools console (`F12` or Right-Click $\rightarrow$ Inspect).
  3. Verify console logs report:
     - `[NativeGpuRuntime] Backend: Dx12` (or `Vulkan`).
     - `[NativeGpuRuntime] Adapter: NVIDIA GeForce...` (or `AMD Radeon...`).
     - `[NativeAudioStatus] Host: WASAPI, SampleRate: 48000 (or 44100)`.
- **Pass Criteria**: No crash, no red errors in terminal or DevTools console.

---

### Scenario 2: Multi-Drive Media Import & Path Conversion
- **Goal**: Verify media import from non-`C:` drives and paths with special characters.
- **Steps**:
  1. Create a folder on a secondary drive or USB: `D:\Test Media (#1) [4K] & Clips\`.
  2. Copy three test files into it:
     - `test video with spaces.mp4` (H.264, 1080p).
     - `clip#hash%percent.mp4` (H.264, 4K).
     - `audio_track_44k.wav` (WAV, 44.1 kHz stereo).
  3. Import these files into Clypra via:
     - File Picker dialog (`Import Media` button).
     - Drag & Drop directly from Windows File Explorer into the timeline.
- **Pass Criteria**:
  - Thumbnails generate immediately.
  - Waveforms generate without missing chunks.
  - Terminal logs show clean path decoding without truncated drive letters.

---

### Scenario 3: Continuous 4K 60fps Playback & A/V Drift Audit
- **Goal**: Verify native lookahead pre-decoder and audio clock sync under high-bitrate load.
- **Steps**:
  1. Place a 4K 60fps H.264 or HEVC clip on Track 1.
  2. Press `Space` to begin playback.
  3. Let it play continuously for 60 seconds.
  4. Open DevTools and observe `syncMetrics` telemetry:
     - Check A/V drift: target is within $\pm 16\text{ms}$.
     - Check dropped frames: target is 0 drops after initial priming.
     - Verify audio is not crackling or popping.
- **Pass Criteria**: Video playback is fluid (60fps), audio is in lockstep, lookahead hits `[QUEUE_HIT]` consistently in terminal logs.

---

### Scenario 4: Fast Scrubbing & Boundary Seeking
- **Goal**: Verify the "Backward Seek Trap" fix and sub-millisecond timeline seeking on Windows.
- **Steps**:
  1. Click rapidly back and forth across the timeline ruler (scrubbing forward and backward).
  2. Drag the playhead rapidly using the mouse jog-wheel / timeline trough.
  3. Press `J`, `K`, `L` keys for shuttle playback (2x forward, pause, 2x backward).
- **Pass Criteria**:
  - The preview updates instantly on seek without freezing.
  - Terminal does not report repetitive backward keyframe seeks or decoder mutex deadlocks.

---

### Scenario 5: Direct3D12 Device Loss Recovery (`Win + Ctrl + Shift + B`)
- **Goal**: Validate graphics driver reset recovery without app crash.
- **Steps**:
  1. Start playback of a video clip in Clypra.
  2. While video is playing, press **`Win + Ctrl + Shift + B`** on the physical keyboard.
  3. The display will flash black for 1–2 seconds and a beep will sound from Windows.
  4. Observe Clypra's behavior:
     - Did the app crash with `DXGI_ERROR_DEVICE_REMOVED`?
     - Did the video canvas turn permanently black?
     - Did the preview swapchain recreate itself and resume playback?
- **Pass Criteria**: App survives driver reset, re-acquires the `wgpu` surface, and resumes rendering within 1.5 seconds.

---

### Scenario 6: System Sleep & Hibernate Lifecycle
- **Goal**: Confirm state preservation across power transitions.
- **Steps**:
  1. Open a multi-clip project with audio and text overlays.
  2. Put the machine to sleep: Start Menu $\rightarrow$ Power $\rightarrow$ Sleep (or close laptop lid).
  3. Wait 30 seconds.
  4. Wake the machine, log in, and immediately interact with Clypra.
  5. Press `Space` to play.
- **Pass Criteria**: Audio resumes immediately without silence, timeline remains responsive, no crash or frozen UI.

---

### Scenario 7: Mixed-DPI Display Transitions & Fractional Scaling
- **Goal**: Test Per-Monitor V2 DPI scaling and window coordinate precision.
- **Steps**:
  1. In Windows Settings $\rightarrow$ Display, set Primary Monitor scaling to **150%** (or 125%).
  2. If a second monitor is available, set it to **100%**.
  3. Launch Clypra and observe:
     - Are fonts crisp without blurry text?
     - Are icons and timeline markers sharp?
     - Does dragging the split panes between timeline and preview feel responsive?
  4. Drag the Clypra window across the boundary between the 150% monitor and the 100% monitor.
- **Pass Criteria**: Window scales smoothly across monitors without preview viewport misalignment or canvas clipping.

---

### Scenario 8: Dynamic Audio Endpoint Switching (WASAPI)
- **Goal**: Test WASAPI default output redirection.
- **Steps**:
  1. Start video playback with audio playing through the laptop/PC speakers.
  2. While audio is actively playing, plug in a 3.5mm headphone cable or connect Bluetooth earbuds.
  3. Wait 3 seconds, then unplug the headphones / disconnect Bluetooth.
- **Pass Criteria**:
  - Audio switches smoothly to the new endpoint without app hang.
  - Audio clock (`cpal` stream) does not stop or cause video playback to stall.

---

### Scenario 9: Hardware Codec Video Export (NVENC / AMF / QSV)
- **Goal**: Test native export with Windows hardware video encoding.
- **Steps**:
  1. Prepare a 1-minute timeline sequence with cuts and transitions.
  2. Click `Export` in the top right.
  3. Select **4K (3840x2160)** or **1080p (1920x1080)** at 60fps.
  4. Choose H.264 codec.
  5. Check terminal logs to verify encoder selection:
     - On NVIDIA: `h264_nvenc`
     - On AMD: `h264_amf`
     - On Intel: `h264_qsv`
     - Fallback: `libx264`
  6. Export the file to `D:\Exports\test_render.mp4`.
  7. Open and play the exported MP4 in Windows Media Player.
- **Pass Criteria**: Export finishes with speed factor $> 1.5x$, output file plays with correct audio/video sync.

---

### Scenario 10: File Locking & Workspace Cleanup Audit
- **Goal**: Ensure Clypra does not leave zombie file handles open on user media.
- **Steps**:
  1. Import `clip_test.mp4` into Clypra.
  2. Delete the clip from the Clypra timeline and project media bin.
  3. Switch to Windows File Explorer, select `clip_test.mp4`, and press `Shift + Delete`.
  4. Does Windows show: *"The action can't be completed because the file is open in Clypra"*?
- **Pass Criteria**: File can be deleted/renamed immediately after removal from project; no locked handles remain.

---

### Scenario 11: Body Effects VFX & Cutout Tools (Live Video & WebGPU)
- **Goal**: Test MediaPipe body segmentation and new Body VFX in Windows WebView2.
- **Steps**:
  1. Open Clypra Studio Body Effect Lab (`PRJ_03_BODY`).
  2. Import a video containing a human subject (`testing.mp4`).
  3. Test each effect in both categories:
     - **Body VFX**: `NEON_OUTLINE`, `CYBER_NEON_GLOW`, `ELECTRO_CONTOUR`, `ANGEL_WINGS`, `PARTICLE_AURA`, `BODY_GHOST_CLONE`.
     - **Cutout Tools**: `SUBJECT_CUTOUT` (Text Behind Subject), `BACKGROUND_BLUR`, `COLOR_ISOLATION`.
  4. Check GPU telemetry in the right panel:
     - Verify segment latency is $< 35\text{ms}$.
     - Check memory usage does not steadily climb over 5 minutes.
- **Pass Criteria**: Real-time segmentation renders without black frames; lightning arcs and ghost clones composite at smooth frame rates.

---

### Scenario 12: Long-Haul Marathon Memory & Leak Test
- **Goal**: Catch cumulative memory leaks in `wgpu`, WebView2, or FFmpeg frame buffers.
- **Steps**:
  1. Open Windows Task Manager (`Ctrl + Shift + Esc`).
  2. Locate `clypra.exe` and its child processes (`msedgewebview2.exe`).
  3. Note initial Private Working Set memory (typically 250 MB – 450 MB).
  4. Set a 2-minute video to Loop Playback (`Loop` toggle enabled).
  5. Let it play continuously for **30 minutes**.
  6. Record memory at 5 min, 15 min, and 30 min.
- **Pass Criteria**: Memory plateaus and stabilizes under 800 MB; no continuous upward memory climb.

---

### Scenario 13: Native Camera & Screen Recording (CrabCamera)
- **Goal**: Verify DirectShow / MediaFoundation camera recording on Windows.
- **Steps**:
  1. Open the Recording Screen / Camera Panel.
  2. Verify webcam preview appears with correct aspect ratio and frame rate.
  3. Start a 15-second camera recording.
  4. Stop recording. Verify the recorded file is automatically imported into the media bin and timeline.
- **Pass Criteria**: Video and audio are recorded synchronously without dropped frames or microphone distortion.

---

### Scenario 14: Keyboard Shortcuts & Focus Trapping
- **Goal**: Verify Windows keyboard accelerators and focus handling.
- **Steps**:
  1. Test common editing shortcuts:
     - `Space`: Play / Pause.
     - `Ctrl + Z` / `Ctrl + Y`: Undo / Redo.
     - `Ctrl + B`: Split clip at playhead.
     - `Delete` / `Backspace`: Delete selected clip.
     - `F`: Fullscreen toggle.
  2. Press `Alt + Tab` to switch to another app, then `Alt + Tab` back.
- **Pass Criteria**: Shortcuts execute reliably; keyboard focus is not lost after dialogs close.

---

### Scenario 15: Offline / Air-Gapped Mode Verification
- **Goal**: Ensure the app functions without an active internet connection.
- **Steps**:
  1. Disconnect Wi-Fi and unplug Ethernet on the Windows machine.
  2. Close Clypra completely, then relaunch via `npm run tauri dev`.
  3. Edit a project, add text with bundled fonts, apply effects, and export.
- **Pass Criteria**: App starts up without indefinite network timeouts; fonts and UI render normally.

---

## 7. Forensic Evidence & Diagnostics Collection

When you discover an anomaly or bug during testing, extract the following diagnostic evidence:

### 7.1 Location of Windows Log Files
- **Tauri Application Data**: `%APPDATA%\com.clypra.app\` (e.g. `C:\Users\<Username>\AppData\Roaming\com.clypra.app\`)
- **WebView2 User Data & Cache**: `%LOCALAPPDATA%\com.clypra.app\EBWebView\`
- **Crash Dumps**: `%LOCALAPPDATA%\CrashDumps\`

### 7.2 Capturing Verbose Console & Terminal Logs
In PowerShell, redirect the dev output to a session log file while watching it live:

```powershell
$env:RUST_LOG="clypra=trace,wgpu=debug,crabcamera=trace"
$env:RUST_BACKTRACE="1"
npm run tauri dev 2>&1 | Tee-Object -FilePath "C:\Projects\clypra\windows_test_session.log"
```

### 7.3 Inspecting GPU State via DirectX Diagnostic Tool
Run `dxdiag` from the Windows Run prompt (`Win + R`) and click **Save All Information...** to export `DxDiag.txt`. This provides the exact GPU driver branch, WDDM version, and audio driver details.

---

## 8. Standardized Windows Bug Report Template

When reporting bugs discovered during your testing session, use this markdown format:

```markdown
### [WIN-BUG] Brief Descriptive Title

**Environment Details:**
- **Windows OS**: Windows 11 Pro 23H2 (Build 22631.3880)
- **CPU**: Intel Core i7-13700H (14 cores)
- **GPU**: NVIDIA RTX 4060 Laptop (Driver 555.99) + Intel Iris Xe
- **Display Scaling**: Primary: 3840x2160 @ 150%, Secondary: 1920x1080 @ 100%
- **Audio Device**: Realtek High Definition Audio (48000 Hz, 24-bit)

**Test Scenario**: Scenario # (e.g. Scenario 5: Direct3D12 Device Loss Recovery)

**Reproduction Steps**:
1. Open Clypra in dev mode (`npm run tauri dev`).
2. Import 4K 60fps clip from D:\Media\sample.mp4.
3. Start playback and press `Win + Ctrl + Shift + B`.

**Observed Behavior**:
Video preview permanently froze on frame 142 while audio continued playing. Terminal logged `SurfaceError::Lost` without swapchain recreation.

**Expected Behavior**:
Swapchain should reconfigure within 1.5s and resume rendering the active frame.

**Relevant Terminal / Console Logs**:
```
[ERROR] wgpu_compositor: Surface lost: SurfaceError::Lost
[WARN] native_preview: Swapchain dropped, unable to present frame #143
```
```

---

## 9. Verification & Pre-Return Clean-up Checklist

Before returning the rented Windows machine to your friend:

- [ ] Stop all running dev servers and background processes.
- [ ] Export your `windows_test_session.log` and bug reports to your personal storage / GitHub repo.
- [ ] Remove any personal credentials, API keys, or private media files from `C:\` and `D:\`.
- [ ] Run `cargo clean` and delete `node_modules` if disk space needs to be reclaimed.
- [ ] Remove Windows Defender exclusions if requested by the owner:
  ```powershell
  Remove-MpPreference -ExclusionPath "C:\Projects\clypra-family"
  ```
