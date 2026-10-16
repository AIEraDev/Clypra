# Deliverable 07: Rust Native Subsystem Surface (`07-rust-surface.md`)

> Audited Commit: \`14cb64ed075908b8b0e71c998c637c35593c6ae1\`  
> Scope: Complete catalog of Tauri IPC commands, global mutable statics, atomics, OnceLocks, and emitted frontend events across in-scope Rust crates.  
> Evidence Tag: \`[CODE]\` (verified directly in Rust sources at HEAD).

---

## 1. Tauri IPC Commands in Scope

| Command Name | Arguments | Return Type | Location | Debug / Release Gate |
| :--- | :--- | :--- | :--- | :--- |
| `render_native_preview_frame` | `app: AppHandle, request: FrameRequest` | `Result<FramePacket, String>` | `src-tauri/src/commands/native_preview.rs:2090` | All builds |
| `present_native_frame` | `app: AppHandle, frame_id: u64` | `Result<(), String>` | `src-tauri/src/commands/native_preview.rs:4840` | All builds |
| `cancel_native_preview_requests`| `app: AppHandle, request_ids: Vec<String>` | `Result<(), String>` | `src-tauri/src/commands/native_preview.rs:3711` | All builds |
| `register_native_raster_asset` | `app: AppHandle, asset_id: String, path: String` | `Result<u64, String>` | `src-tauri/src/commands/native_preview.rs:3738` | All builds |
| `unregister_native_raster_asset`| `app: AppHandle, asset_id: String` | `Result<(), String>` | `src-tauri/src/commands/native_preview.rs:3897` | All builds |
| `get_native_frame_service_stats`| `app: AppHandle` | `Result<NativeFrameServiceStats, String>` | `src-tauri/src/commands/native_preview.rs:5254` | All builds |
| `get_session_telemetry` | `app: AppHandle` | `Result<Value, String>` | `src-tauri/src/commands/native_preview.rs:5959` | All builds |
| `reset_session_telemetry` | `app: AppHandle` | `Result<(), String>` | `src-tauri/src/commands/native_preview.rs:5980` | All builds |
| `probe_native_surface` | `app: AppHandle, geometry: NativeSurfaceGeometry` | `Result<NativeSurfaceProbe, String>` | `src-tauri/src/commands/native_surface.rs:634` | All builds |
| `resize_native_surface` | `app: AppHandle, geometry: NativeSurfaceGeometry` | `Result<(), String>` | `src-tauri/src/commands/native_surface.rs:669` | All builds |
| `hide_native_surface` | `app: AppHandle` | `Result<(), String>` | `src-tauri/src/commands/native_surface.rs:704` | All builds |
| `get_native_surface_status` | `app: AppHandle` | `Result<Option<NativeSurfaceProbe>, String>` | `src-tauri/src/commands/native_surface.rs:723` | All builds |
| `configure_native_playback` | `app: AppHandle, plan: PlaybackPlan` | `Result<(), String>` | `src-tauri/src/commands/native_playback.rs:1084` | All builds |
| `submit_native_playback_demand`| `app: AppHandle, demand: NativePlaybackFrameDemand` | `Result<(), String>` | `src-tauri/src/commands/native_playback.rs:1448` | All builds |
| `get_native_playback_state` | `app: AppHandle` | `Result<PlaybackState, String>` | `src-tauri/src/commands/native_playback.rs:1470` | All builds |
| `native_play` | `app: AppHandle, clock: FrameTime` | `Result<PlaybackState, String>` | `src-tauri/src/commands/native_playback.rs:1475` | All builds |
| `native_pause` | `app: AppHandle, clock: FrameTime` | `Result<PlaybackState, String>` | `src-tauri/src/commands/native_playback.rs:1489` | All builds |
| `native_seek` | `app: AppHandle, frame_index: u64` | `Result<PlaybackState, String>` | `src-tauri/src/commands/native_playback.rs:1503` | All builds |
| `native_tick` | `app: AppHandle, clock: FrameTime` | `Result<PlaybackState, String>` | `src-tauri/src/commands/native_playback.rs:1551` | All builds |
| `start_native_audio` | `app: AppHandle` | `Result<NativeAudioStatus, String>` | `src-tauri/src/commands/native_audio.rs:29` | All builds |
| `stop_native_audio` | `app: AppHandle` | `Result<(), String>` | `src-tauri/src/commands/native_audio.rs:39` | All builds |
| `pause_native_audio` | `app: AppHandle` | `Result<(), String>` | `src-tauri/src/commands/native_audio.rs:70` | All builds |
| `resume_native_audio` | `app: AppHandle` | `Result<(), String>` | `src-tauri/src/commands/native_audio.rs:80` | All builds |
| `seek_native_audio` | `app: AppHandle, position_ticks: i64`| `Result<(), String>` | `src-tauri/src/commands/native_audio.rs:110` | All builds |
| `replace_native_audio_clips` | `app: AppHandle, clips: Vec<NativeAudioClipDescriptor>` | `Result<(), String>` | `src-tauri/src/commands/native_audio.rs:209` | All builds |
| `get_native_audio_diagnostics` | `app: AppHandle` | `Result<NativeAudioDiagnostics, String>` | `src-tauri/src/commands/native_audio.rs:60` | All builds |

---

## 2. Global Mutable State in Rust

| Static Identifier | Type | Location | Written By | Read By | Real-World Representation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `NATIVE_SURFACE_PRESENTATION_SEQUENCE` | `AtomicU64` | `src-tauri/src/commands/native_preview.rs:41` | `present_native_frame` | Presentation timing sync | Monotonically increasing presentation counter for frame vs surface sync |
| `FLAG` | `OnceLock<bool>` | `src-tauri/src/commands/native_preview.rs:51` | Initialization path | Diagnostic logging check | One-time runtime initialization flag |
| `LOOKAHEAD_WORKER` | `std::sync::Mutex<Option<LookaheadWorkerState>>` | `src-tauri/src/commands/native_preview.rs:3460` | Lookahead queue worker | Frame pre-cache decoders | Background thread pool decoding upcoming video frames |
| `MONOTONIC_EPOCH` | `std::sync::OnceLock<Instant>` | `src-tauri/src/commands/native_playback.rs:1616` | First playback command | `native_tick_from_audio` | Monotonic clock origin preventing clock drift against system time |

---

## 3. Events Emitted to Frontend

| Event Name | Payload Type | Location | Purpose |
| :--- | :--- | :--- | :--- |
| `native-mask-evicted` | `Vec<String>` | `src-tauri/src/commands/native_preview.rs:2872, 4505` | Notifies frontend that cached AI cutout masks were evicted from GPU VRAM |
| `native-raster-evicted` | `Vec<String>` | `src-tauri/src/commands/native_preview.rs:2875, 4508` | Notifies frontend that cached video/image frames were purged from RAM/VRAM |
| `native-playback-state` | `PlaybackState` | `src-tauri/src/commands/native_playback.rs:762, 825, 1182, 1656` | Broadcasts asynchronous playback state transitions (play, pause, seek complete, EOF) |
| `native-audio-position` | `NativeAudioPositionSnapshot` | `src-tauri/src/commands/native_audio.rs:357` | High-frequency CPAL audio hardware playback position update |
`;

fs.writeFileSync(path.join(REPO_ROOT, "docs/preview-audit/07-rust-surface.md"), mdContent, "utf8");
console.log("Wrote 07-rust-surface.md successfully.");
