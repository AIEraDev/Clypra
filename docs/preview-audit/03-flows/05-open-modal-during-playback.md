# Deliverable 03.05: Flow 5: Open a Menu, Dropdown, or Modal During Playback and Close It Again (`05-open-modal-during-playback.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User clicks Settings menu icon or shortcut while playing | `uiStore openSettingsModal (`src/store/uiStore.ts:275`)` | showSettingsModal (false) | showSettingsModal = true | Calls hideNativeSurfaceWhenIdle() to drop native OS child window beneath modal dialog | [CODE] |
| 2 | Surface coordinator forces surface hide | `hideNativeSurfaceWhenIdle (`src/core/runtime/nativeSurfaceLifecycle.ts:133`)` | _isSurfaceReady, isPlaying | IPC hide_native_surface() | OS child window drops, preventing window occlusion of React modal HTML DOM elements | [CODE] |
| 3 | User closes modal | `uiStore toggleSettingsModal (`src/store/uiStore.ts:279`)` | showSettingsModal (true) | showSettingsModal = false | Triggers forceRepaintNativeProgramPreview() | [CODE] |
| 4 | Global repaint wake initiates surface restoration | `forceRepaintNativeProgramPreview (`src/components/editor/preview/NativeProgramPreview.tsx:341`)` | _globalPreviewForceRepaintFn | renderLoopEpoch++ | Re-probes native surface and repaints active paused frame or resumes native swapchain | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `modal-opened`, `surface-hide-dispatched`, `modal-closed`, and `surface-restored` records.
