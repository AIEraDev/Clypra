# Deliverable 03.07: Flow 7: Open a Source Preview (Asset Preview) from Program Preview and Return (`07-source-preview-switch.md`)

> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  
> Evidence Tag: All code paths verified via `[CODE]`; runtime session logs `[INFERRED from code]`.  

## Numbered Step Table

| Step | Trigger | Function & Location | State Read | State Written | External Effect | Evidence Tag |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | User double-clicks an asset in the media bin | `uiStore previewAsset (`src/store/uiStore.ts:305`)` | previewMode ('program') | previewMode = 'source', sourceAsset = asset | Switches preview monitor context to SourcePreview component | [CODE] |
| 2 | Native program preview unmounts / idles | `NativeProgramPreview cleanup (`src/components/editor/preview/NativeProgramPreview.tsx:1460`)` | nativeSurfaceShown | hide_native_surface(), pendingHandoverSurfaceHide = false | Releases native hardware surface ownership | [CODE] |
| 3 | SourcePreview mounts dedicated HTMLMediaElement | `SourcePreview.tsx (`src/components/editor/preview/SourcePreview.tsx:40`)` | sourceAsset.path | SourcePlaybackContext active in TransportAuthority | Source preview plays isolated media element without touching program timeline | [CODE] |
| 4 | User closes source monitor or selects timeline clip | `uiStore exitSourceMode (`src/store/uiStore.ts:315`)` | previewMode ('source') | previewMode = 'program', sourceAsset = null | Re-mounts NativeProgramPreview and restores timeline playhead authority | [CODE] |

## Session Log Diagnostic Status

> [!NOTE] Log Status: **[INFERRED from code]**  
> Requires NDJSON session trace capturing `source-mode-entered`, `program-surface-released`, and `source-mode-exited` records.
