# Task 3 Implementation Review: FrameRequestId Propagation

## Review Summary

**Verdict: CHANGES_REQUESTED**

The implementation successfully establishes the lifecycle registry infrastructure and handles several important lifecycle transitions (supersession, cancellation, abandonment). However, there is a **critical blocker**: the `FrameRequestId` is allocated and tracked in the pending slot but is **not propagated through the actual render pipeline** after being extracted from the demand.

---

## Critical Blocker

### B1: Request identity lost after demand extraction (render_session.rs:868-883)

**Location:** `src-tauri/src/commands/native_playback/render_session.rs:868-883`

**Issue:** The `_internal_request_id` is extracted from the taken demand but is only used in the generation-mismatch coalescing case (line 875-881). For requests that pass the generation check and proceed through the render path, the ID is discarded and never propagated to:
- Decoder dispatch
- Ready-frame queue
- Produced-frame handoff
- Any subsequent async operation

**Evidence:**
```rust
let dynamic_demand_with_id = self.pending.lock().ok().and_then(|mut slot| slot.take());
let (dynamic_demand, _internal_request_id) = match dynamic_demand_with_id {
    Some((demand, internal_id)) => (Some(demand), internal_id),
    None => (None, None),
};
if let Some(demand) = &dynamic_demand {
    if demand.generation.unwrap_or(0) < generation {
        // Coalesced by generation mismatch - cancel the internal request
        if let Some(internal_id) = _internal_request_id {
            // ... cancellation logic ...
        }
        continue;  // ← Only path where ID is used
    }
}
// ← After this point, _internal_request_id is never referenced
let base_request = match self.materialize_request(dynamic_demand.as_ref()) {
    Ok(req) => req,
    Err(_) => continue,
};
// ... render_one() and all subsequent operations have no access to the ID
```

**User-visible consequence:** Accepted requests remain in `Active` state indefinitely because their lifecycle identity never reaches the decoder, compositor, or presentation boundaries where terminal transitions should occur. Session shutdown will correctly abandon them, but legitimate completion paths cannot mark them `Presented` or handle failures.

**Required correction:**
1. Remove the underscore prefix from `_internal_request_id` to signal it must be used
2. Thread the `Option<FrameRequestId>` through:
   - `materialize_request()` (or store alongside `base_request`)
   - `render_one()` signature
   - Decoder dispatch async boundary
   - Ready-frame queue structure
   - Produced-frame handoff
3. At minimum, store the ID in a structure that survives until the frame is presented or fails
4. Consider storing active request IDs in a session-level map keyed by external request_id or generation to enable lifecycle queries

---

## Strengths

### ✅ Registry ownership and synchronization
- `FrameLifecycleRegistry` added to `NativeRenderSession` as `Mutex<FrameLifecycleRegistry>` field (line 49)
- Mutex appropriately held only for allocation and transition operations, not across async work
- Registry lifetime correctly matches session lifetime

### ✅ Identity allocation at demand acceptance
- `submit()` allocates distinct internal `FrameRequestId` via `registry.begin_request(&demand.request_id)` (lines 488-493)
- External `request_id` preserved unchanged as correlation label
- Allocation occurs before demand enters pending slot

### ✅ Supersession tracking
- `submit()` correctly records supersession when replacing pending demand (lines 499-510)
- Superseded request transitions to `Terminal(Superseded { by_request_id })` with correct successor

### ✅ Cancellation paths
- `pause_continuous_playback()` cancels pending request (lines 240-245)
- `invalidate()` cancels obsolete pending request (lines 453-460)
- `stop()` cancels pending request before shutdown (lines 405-410)

### ✅ Abandonment on shutdown
- `stop()` calls `registry.abandon_active(AbandonReason::SessionShutdown)` (line 413)
- All active lifecycles correctly transition to `Abandoned { reason: SessionShutdown }`

### ✅ Test coverage for allocation and early transitions
All 8 tests pass and verify:
1. Distinct internal IDs for repeated external IDs ✓
2. Supersession relationship correctness ✓
3. Generation-mismatch coalescing (though this is actually cancellation, not true coalescing) ✓
4. Pause cancellation ✓
5. Invalidate cancellation ✓
6. Shutdown abandonment ✓
7. Async boundary survival via `take()` ✓
8. No auto-presentation without explicit transition ✓

---

## Scope Compliance

### ✅ No decoder/compositor/presentation changes
- Decoder concurrency, scheduling, and lookahead logic unchanged
- GPU compositor behavior untouched
- Presentation timing and native surface ownership preserved
- No `FrameId` or `PresentationAttemptId` propagation (correctly deferred to Tasks 4-5)

### ✅ Existing playback tests pass
According to commit message: "Existing playback behavior unchanged; all existing tests pass."

---

## Architecture and Design Quality

### ✅ Clear ownership boundary
- Registry is caller-owned with explicit synchronization
- No global registry or mutex held across async work
- Ownership model suitable for later FrameId and PresentationAttemptId stages

### ✅ External vs. internal ID distinction
- Implementation correctly treats external `request_id` as correlation label
- Each `submit()` allocates distinct internal ID even for repeated external values
- No replacement of external ID

### ⚠️ Incomplete propagation architecture
The current implementation establishes the "what" (identity types, registry) and "where" (allocation point, early cancellation points) but does not complete the "how" (carrying the ID through the async render path to its terminal boundaries).

---

## Missing Coverage (Not Blockers for Task 3 Scope)

These are noted for completeness but are expected to be addressed in later tasks:

1. **No decoder result correlation:** When a frame is produced, there's no mechanism to associate it with the originating `FrameRequestId` (Task 4 scope)
2. **No presentation success recording:** `render_one()` returns presentation success but cannot mark request as `Presented` without the ID (Task 4/5 scope)
3. **No failure handling:** Decoder failures, compositor failures, and presentation failures cannot transition the request to `Failed` state (Task 4/5 scope)
4. **Audio-clock frame generation:** Continuous playback frames generated from audio clock (lines 906-965) have no explicit demand, so no `internal_request_id` exists for them. This is acceptable for Task 3 but will need design attention in Task 4.

---

## Recommended Fix Path

1. **Immediate:** Change `_internal_request_id` to `internal_request_id` (remove underscore)
2. **Carry through materialize_request:** Either:
   - Add `internal_request_id: Option<FrameRequestId>` field to `FrameRequest`, or
   - Return tuple `(FrameRequest, Option<FrameRequestId>)` from `materialize_request()`, or
   - Store in a session-level `HashMap<String, FrameRequestId>` keyed by external `request_id`
3. **Thread through render_one:** Extend signature to accept `internal_request_id: Option<FrameRequestId>`
4. **Store with presentation result:** Include ID in the returned presentation structure so caller can access it
5. **Add comment:** Explain that terminal success transitions will be wired in Task 4 after FrameId allocation

This preserves the narrow scope of Task 3 while making identity continuity explicit and testable.

---

## Acceptance Criteria Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 1. Repeated external IDs → distinct internal IDs | ✅ Pass | Test line 1196-1208 |
| 2. Identity survives async operations | ⚠️ Partial | Survives `take()` (test line 1303-1314) but discarded afterward |
| 3. Coalescing/supersession relationships correct | ✅ Pass | Test line 1213-1228; supersession works, generation-mismatch treated as cancellation |
| 4. Cancellation prevents resurrection | ✅ Pass | Tests line 1244-1276 |
| 5. Request cannot become Presented without explicit transition | ✅ Pass | Test line 1319-1328; registry API enforces this |
| 6. Shutdown abandons unresolved requests | ✅ Pass | Test line 1281-1298 |
| 7. Existing playback tests pass | ✅ Pass | Per commit message |

**Overall:** 5/7 pass fully, 1/7 partial (identity continuity broken after extraction), 1/7 pass.

---

## Conclusion

The foundation is solid: allocation, supersession, cancellation, and abandonment work correctly. The registry design is clean and the synchronization strategy is appropriate. However, the implementation does not achieve the core goal stated in the task requirements:

> **"Propagate FrameRequestId through the real playback request path"**
> 
> **"The ID must survive cloning, asynchronous task handoff, queue insertion, retries and delayed delivery."**

The ID currently survives the initial `take()` handoff but is immediately discarded. This must be fixed before Task 3 can be considered complete.

Once the propagation gap is closed, Task 4 (FrameId allocation and request/frame associations) will have a solid foundation to build on.
