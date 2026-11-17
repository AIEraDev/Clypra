# Review: RenderLifecycleContext Threading Implementation

**Reviewer:** Kiro AI  
**Date:** 2024  
**Commit:** 832d4f9f  
**Verdict:** CHANGES_REQUESTED

---

## Summary

The implementation successfully introduces `RenderLifecycleContext` as a typed metadata envelope and threads it through the majority of the async rendering pipeline. However, **one critical propagation gap** breaks the chain in the synchronous decode fallback path within `present_native_frame_internal`.

Additionally, the overlapping-requests test does not exercise the actual async decode → queue → present pipeline as required by the task acceptance criteria.

---

## Findings

### 🔴 BLOCKER 1: Context Lost in Queue-Miss Fallback Path

**Location:** `src-tauri/src/commands/native_preview/mod.rs:2857`

**Issue:**  
When `present_native_frame_internal` encounters a queue miss (no precomputed frame available), it falls back to synchronous decode. This fallback path calls `decode_native_video_layers` with `RenderLifecycleContext::empty()` instead of forwarding the `lifecycle_context` parameter it received.

**Evidence:**
```rust
pub(crate) async fn present_native_frame_internal(
    app: tauri::AppHandle,
    request: FrameRequest,
    _lifecycle_context: RenderLifecycleContext,  // ❌ Received but never used
) -> Result<NativeSurfacePresentation, String> {
    // ... queue lookup logic ...
    
    let (..., _lifecycle_context) = match queued_frame {
        Some(frame) => (
            // ... queue hit path extracts frame.lifecycle_context ...
            frame.lifecycle_context,
        ),
        None => {
            // ❌ BLOCKER: Creates new empty context instead of using parameter
            let (decoded_frames, decode_timings, lifecycle_context) =
                decode_native_video_layers(&legacy_request, None, RenderLifecycleContext::empty()).await?;
            // ...
            (/*...*/ lifecycle_context)
        }
    };
    // Context is extracted but never consumed (marked with underscore prefix)
}
```

**Consequence:**  
Explicit paused/scrub demands (which often miss the lookahead queue) and any other queue-miss scenarios lose their request identity. The lifecycle registry will never record these frames as relating to their originating requests.

**Required Fix:**  
Pass the received `lifecycle_context` parameter through to `decode_native_video_layers` in the queue-miss branch:

```rust
None => {
    let (decoded_frames, decode_timings, returned_context) =
        decode_native_video_layers(&legacy_request, None, lifecycle_context).await?;
    // ...
    (/*...*/ returned_context)
}
```

Remove the underscore prefix from the parameter name once it's actually used.

---

### 🔴 BLOCKER 2: Test Does Not Exercise Async Pipeline

**Location:** `src-tauri/src/commands/native_playback/render_session.rs:1362`

**Issue:**  
The `overlapping_requests_with_same_external_id_remain_independent` test is a synchronous unit test that:
1. Calls `session.submit()` to allocate internal IDs
2. Manually extracts IDs from the pending slot
3. Directly calls `lifecycle_registry.finish_request()`

It does **not** invoke `render_one()`, `present_native_frame_internal()`, `decode_native_video_layers()`, or any asynchronous work.

**Task Requirement Violation:**  
> "One final acceptance requirement: the overlapping-request test must exercise the actual asynchronous pipeline, not simply prove that two registry entries have different IDs."

**Evidence:**
```rust
#[test]  // ❌ Not #[tokio::test]
fn overlapping_requests_with_same_external_id_remain_independent() {
    let session = mock_session();
    // ... submit, extract IDs, directly manipulate registry ...
    // NO async .await, NO render_one(), NO decode, NO queue, NO present
}
```

**Consequence:**  
The test validates registry mechanics (already covered by existing lifecycle tests) but provides no evidence that request identities survive async decoder dispatch, queue insertion/extraction, or presentation handoff.

**Required Fix:**  
Convert to an async integration test that:
1. Submits two overlapping demands with the same external ID
2. Actually calls `render_one()` or equivalent async path
3. Verifies that both contexts flow through decode → queue → present
4. Confirms distinct internal IDs are preserved across async boundaries

This may require test infrastructure for async execution and mock Tauri app handles.

---

## What Works Correctly

### ✅ RenderLifecycleContext Type Design
- `Vec<FrameRequestId>` correctly allows multiple requests per frame
- `new()`, `empty()`, `is_empty()`, `add_request()` API is appropriate
- Non-serialized internal metadata matches architectural intent

### ✅ QueuedNativeFrame Threading
- `lifecycle_context` field added to struct
- Preserved through queue insertion in `queue_native_frame` (line 2141)
- Extracted on queue hit in `present_native_frame_internal` (line 2853)

### ✅ decode_native_video_layers Signature
- Accepts `RenderLifecycleContext` parameter
- Returns context in success tuple
- All three call sites updated (lines 1339, 2123, 2857)

### ✅ render_one() Propagation
- Constructs `RenderLifecycleContext::new(id.clone())` when `internal_request_id` is Some
- Passes context to `present_native_frame_internal`
- Handles cancellation with lifecycle registry transitions

### ✅ Audio-Clock Allocation Policy
- Does NOT allocate `FrameRequestId` for every audio-clock tick
- Only allocates for explicit demands (pause/scrub/seek modes)
- `audio_clock_internal_id` remains None for continuous playback
- Prevents registry accumulation as required

### ✅ Correlation Map Removed
- `active_request_ids: Mutex<HashMap<String, FrameRequestId>>` deleted from `NativeRenderSession`
- No external-ID lookups remain
- Direct typed metadata propagation used instead

### ✅ Behavior Preservation
- No changes to decoder concurrency, scheduling policy, lookahead logic, or GPU composition
- Test count unchanged (26 native_playback + 16 lifecycle = 42 total)
- TypeScript and i18n checks passed per commit message

---

## Recommendations

### Fix Sequence
1. **Immediate (Blocker 1):** Change line 2857 to pass `lifecycle_context` instead of `::empty()`
2. **Immediate (Blocker 2):** Rewrite overlapping-requests test as async integration test
3. **Post-Fix Verification:** Run full test suite including new async test
4. **Documentation:** Update commit message to accurately reflect test coverage

### Future Task 4 Preparation
The current implementation correctly leaves requests in `Active` state with TODO comments for `FrameId` association (lines 1077, 1078). This is the correct boundary for Task 3.

Task 4 will need to:
- Allocate `FrameId` when frames are produced
- Associate `FrameId` with originating `FrameRequestId` collection
- Mark requests as `Terminal(Presented)` after successful display

---

## Architectural Compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| RenderLifecycleContext struct | ✅ | Vec semantics correct |
| QueuedFrame carries context | ✅ | Field added, used |
| decode_native_video_layers accepts/returns | ⚠️ | Signature correct, but one call site broken |
| Lookahead scheduling preserves | ✅ | queue_native_frame threads through |
| Context survives async boundaries | ❌ | Queue-miss path breaks chain |
| No audio-clock allocation | ✅ | Policy correctly implemented |
| No unused parameters | ❌ | `_lifecycle_context` in present_native_frame_internal |
| Async pipeline test | ❌ | Test is synchronous registry manipulation |
| All tests pass | ⚠️ | Per commit message, but evidence corrupted |
| Behavior unchanged | ✅ | No rendering logic modified |

---

## Conclusion

This is 90% complete. The type design is sound, the queue threading is correct, and the audio-clock policy is properly implemented. However, **the queue-miss fallback path breaks the propagation contract**, and **the test does not validate async survivability**.

Both blockers are straightforward to fix:
- Change one function argument from `::empty()` to the received parameter
- Convert one test from sync registry manipulation to async render invocation

Once corrected, this will satisfy the Task 3 acceptance criteria.
