# Frame Lifecycle Registry Retention Audit

**Audit Date:** 2025-01-XX  
**Auditor:** Kiro (AI Agent)  
**Objective:** Determine if `FrameLifecycleRegistry` retains terminal entries indefinitely.

---

## Executive Summary

**Are terminal entries ever removed?** **NO**

The `FrameLifecycleRegistry` does not implement any cleanup mechanism for terminal lifecycle records. All three core HashMaps (`requests`, `frames`, `attempts`) accumulate entries for the lifetime of the registry instance.

---

## Evidence

### 1. Exhaustive Map Mutation Scan

Searched for all standard HashMap cleanup operations:
- `.remove()` — **Not found**
- `.retain()` — **Not found**
- `.drain()` — **Not found**
- `.clear()` — **Not found**

**Conclusion:** No code path removes individual entries or bulk-clears the maps.

### 2. Registry Lifecycle

The `FrameLifecycleRegistry` is constructed in `NativeRenderSession::new()` and stored in:
```rust
pub(crate) lifecycle_registry: Mutex<FrameLifecycleRegistry>
```

The registry is **session-scoped**, not request-scoped or frame-scoped. It persists for the entire lifetime of the `NativeRenderSession`.

**When is the registry destroyed?**
- When `NativeRenderSession::stop()` is called and the session is dropped
- When the `NativeRenderSession` Arc refcount reaches zero
- Effectively: **only at application shutdown or explicit session teardown**

### 3. Terminal State Handling

The registry provides `abandon_active()` which converts **Active** lifecycles to **Abandoned** terminal states, but does **not remove** them:

```rust
pub fn abandon_active(&mut self, reason: AbandonReason) {
    for state in self.requests.values_mut() {
        if matches!(state, LifecycleState::Active) {
            let _ = state.finish(RequestTerminalDisposition::Abandoned { reason });
        }
    }
    // ... same for frames and attempts ...
}
```

Called in:
- `NativeRenderSession::stop()` — session shutdown
- Direct `abandon_active()` invocations

This marks entries as terminal but **retains them in the maps**.

### 4. Design Rationale (Inferred)

Terminal records serve several legitimate purposes:

1. **Duplicate Registration Rejection**
   - `register_request()`, `register_frame()`, `register_presentation_attempt()` all check `contains_key()` and return `DuplicateRequest/Frame/Attempt` errors
   - Preventing duplicate IDs requires retaining terminal entries

2. **Late Callback Validation**
   - `finish_request()`, `finish_frame()`, `finish_presentation_attempt()` require the entry to exist
   - Terminal state transitions use `state.finish()` which rejects duplicate terminal transitions via `LifecycleError::DuplicateTerminalTransition`
   - Late callbacks (e.g., from async workers) are rejected by checking terminal disposition

3. **Correlation Queries**
   - `frames_for_request()` iterates all frames to find correlations
   - `frame_accounting()` reconciles all frame states
   - These queries span both active and terminal entries

4. **Lifecycle Reconciliation**
   - `finish_request()` validates that the claimed `frame_id` correlates to the request
   - `finish_frame()` validates that the claimed `attempt_id` succeeded
   - Removing terminal frames would break these post-presentation validation chains

**However:** These design requirements do not distinguish between:
- Short-term operational history (recent terminal entries)
- Unbounded session-lifetime accumulation

---

## Growth Rate Estimates

### Typical Workload Assumptions
- 30 fps timeline
- 60-second continuous playback session
- Scrubbing with 10 seeks per session
- 1 presentation attempt per frame (optimistic path)

### Request Growth
**Continuous Playback:**
- Audio-clock ticks reuse external request ID (`"playback"`)
- Each tick allocates a new internal `FrameRequestId` via `begin_request()`
- **Rate:** ~30 requests/second during playback
- **60-second session:** ~1,800 request entries

**Scrubbing:**
- Each scrub event allocates a unique internal request
- **10 scrubs:** +10 request entries

**Total Requests:** ~1,810 entries

### Frame Growth
- Ideally: 1 frame per request (no retries)
- **Rate:** ~30 frames/second
- **60-second session:** ~1,800 frame entries

### Presentation Attempt Growth
- Ideally: 1 attempt per frame (no failures)
- **Rate:** ~30 attempts/second
- **60-second session:** ~1,800 attempt entries

### Aggregate Growth
**Per-minute of playback:**
- ~1,800 requests
- ~1,800 frames
- ~1,800 attempts
- **Total:** ~5,400 HashMap entries

**Memory footprint (rough estimate):**
- Each entry: ~200-400 bytes (ID string + state enum + HashMap overhead)
- **Per-minute:** ~1-2 MB

**10-minute session:** ~10-20 MB  
**60-minute session:** ~60-120 MB

---

## Conclusion

**This constitutes unbounded, session-scoped retention.**

- Terminal entries accumulate linearly with session duration
- No cleanup mechanism exists
- Growth is proportional to playback time and interaction frequency
- Memory impact is modest for typical sessions but unbounded in principle

**Is this a memory leak?** 
- Technically **no** if the session is eventually destroyed
- Effectively **yes** for long-running sessions (e.g., extended editing, looped preview)

---

## Remaining Questions

1. **What is the longest expected session duration in production?**
   - 5 minutes? 30 minutes? Hours?
   - Determines whether unbounded retention is acceptable

2. **Are there legitimate use cases for querying old terminal records?**
   - Debugging traces? Analytics? Post-session telemetry?
   - If yes, bounded history (e.g., last 1000 terminal entries) may be sufficient

3. **Can duplicate ID rejection rely on shorter windows?**
   - If IDs are time-bucketed or session-scoped, recent history may suffice
   - Current allocator uses monotonic u64 sequences, which never wrap

4. **Should terminal records be compacted into summaries?**
   - Keep active records + compact terminal summaries (counts, timestamps)
   - Preserve correlation/accounting without full lifecycle state

---

## Next Steps

1. **Add diagnostic snapshot instrumentation** (this task)
   - Measure actual retention in realistic workloads
   - Confirm growth rates match predictions

2. **Establish retention requirements** (design task)
   - Define minimum retention window for correctness
   - Identify queries that span terminal entries

3. **Implement bounded retention** (future task, if justified)
   - LRU or time-based eviction of old terminal entries
   - Preserve active records and recent terminal history
   - Maintain duplicate-rejection and correlation guarantees

---

## Instrumentation Plan

Add lightweight diagnostic snapshot:
1. Count active vs terminal entries in each map
2. Emit snapshot every 50 rendered frames (not every frame)
3. Include total allocated IDs from allocator sequences
4. Zero per-frame overhead (no map scanning)
