# Task 3 Runtime Identity Propagation Verification

## Purpose
Verify that `FrameRequestId` actually propagates through the production async rendering pipeline, not just simulated tests.

## Temporary Debug Traces Added

### Location: `src-tauri/src/commands/native_playback/render_session.rs`

1. **REQUEST_ACCEPTED** - When demand submitted and internal ID allocated
   - Logs: external ID, internal ID, generation

2. **RENDER_DISPATCH** - When lifecycle context created and passed to present_native_frame_internal
   - Logs: internal ID, external ID, mode

### Location: `src-tauri/src/commands/native_preview/mod.rs`

3. **DECODER_DISPATCH** - When queue miss triggers decoder dispatch
   - Logs: internal ID, external ID, queue_hit=false

4. **DECODER_RESULT** - After decode completes and context returned
   - Logs: internal ID, external ID

5. **QUEUE_INSERT** - When lookahead worker stores frame in queue
   - Logs: internal ID, external ID, cache key

6. **QUEUE_EXTRACT** - When frame retrieved from queue
   - Logs: internal ID, external ID, queue_hit=true

7. **PRESENTATION_HANDOFF** - Final handoff with context
   - Logs: internal ID, external ID, queue_hit status

## Verification Protocol

### Test 1: Basic Identity Continuity
```bash
npm run tauri dev 2>&1 | grep LIFECYCLE_TRACE > /tmp/lifecycle-trace.txt
```

Expected trace pattern for one request:
```
REQUEST_ACCEPTED | external=scrub-123 internal=req_0_scrub-123 generation=Some(1)
RENDER_DISPATCH | internal=req_0_scrub-123 external=scrub-123 mode=Some("scrub")
DECODER_DISPATCH | internal=req_0_scrub-123 external=scrub-123 queue_hit=false
DECODER_RESULT | internal=req_0_scrub-123 external=scrub-123 queue_hit=false
PRESENTATION_HANDOFF | internal=req_0_scrub-123 external=scrub-123 queue_hit=false
```

### Test 2: Overlapping External IDs
Rapidly scrub/seek to generate overlapping requests with reused external IDs.

Expected: Each request gets distinct internal ID despite same external ID.

```
REQUEST_ACCEPTED | external=scrub-pos-100 internal=req_5_scrub-pos-100 ...
RENDER_DISPATCH | internal=req_5_scrub-pos-100 ...
REQUEST_ACCEPTED | external=scrub-pos-100 internal=req_6_scrub-pos-100 ...
RENDER_DISPATCH | internal=req_6_scrub-pos-100 ...
```

Both req_5 and req_6 should have independent traces with same external ID.

### Test 3: Queue Path vs Direct Path

**Queue hit (lookahead):**
```
QUEUE_INSERT | internal=req_X ... (from lookahead worker)
...later...
QUEUE_EXTRACT | internal=req_X ... queue_hit=true
PRESENTATION_HANDOFF | internal=req_X ... queue_hit=true
```

**Queue miss (direct decode):**
```
DECODER_DISPATCH | internal=req_Y ... queue_hit=false
DECODER_RESULT | internal=req_Y ...
PRESENTATION_HANDOFF | internal=req_Y ... queue_hit=false
```

Same internal ID throughout both paths.

### Test 4: Lifecycle Registry Accumulation

After sustained playback (5+ minutes):
```rust
// Check registry doesn't accumulate active records from audio-clock
// Audio-clock frames should use empty context, not allocate IDs
```

Grep for REQUEST_ACCEPTED during continuous playback - should be minimal/zero during pure audio-clock playback.

## Success Criteria

✅ Same internal ID appears at all boundaries for one request
✅ Overlapping external IDs have distinct internal IDs
✅ Queue path preserves identity through insert/extract
✅ Direct decode path preserves identity through dispatch/result
✅ Audio-clock playback doesn't spam REQUEST_ACCEPTED

## Cleanup

After verification, remove all `eprintln!` traces containing `[LIFECYCLE_TRACE]`.

These are temporary development-only traces, not production telemetry.
