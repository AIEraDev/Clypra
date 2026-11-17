# Lookahead Queue Verification — Task 3 Part 2

## Objective
Verify that lookahead queue insertion/extraction works during continuous playback and add instrumentation to observe the complete lookahead path.

## Implementation

### Added Instrumentation Stages

The following lifecycle traces were added to `schedule_lookahead_predecode`:

1. **LOOKAHEAD_SCHEDULE_REQUESTED** - Emitted when lookahead scheduling is requested
   - Location: Entry point of `schedule_lookahead_predecode`
   - Fields: `generation`, `lookahead_count`

2. **LOOKAHEAD_SCHEDULE_ACCEPTED** - Emitted after worker guard checks pass
   - Location: After determining current audio frame and before spawning worker task
   - Fields: `start_frame`, `lookahead_count`

3. **LOOKAHEAD_WORKER_STARTED** - Emitted inside spawned task after range determination
   - Location: After calculating `start_frame_index` and `target_end_frame_index`
   - Fields: `range` (start..end)

4. **LOOKAHEAD_DECODE_COMPLETED** - Emitted after successful decode in queue_native_frame
   - Location: After `decode_native_video_layers` succeeds, before queue lock
   - Fields: `frame`, `internal` (lifecycle context ID)

### Verified Existing Traces

The following traces were already correctly implemented:

- **QUEUE_INSERT** - Emitted when decoded frame enters the queue
  - Location: `queue_native_frame` after successful decode
  - Fields: `internal`, `external`, `key`
  - ✓ Correctly emits internal ID from `RenderLifecycleContext`

- **QUEUE_EXTRACT** - Emitted when frame is consumed from queue
  - Location: `present_native_frame` when queue hit occurs
  - Fields: `internal`, `external`, `queue_hit=true`
  - ✓ Correctly emits matching internal ID

## Test Protocol (Manual Execution Required)

The instrumentation is now in place. To verify the lookahead queue path:

1. Start `npm run tauri dev`
2. Load a project with video clips
3. Start playback and let run for 10 seconds
4. Stop and save terminal output
5. Parse for the following event sequence:
   ```
   LOOKAHEAD_SCHEDULE_REQUESTED
   LOOKAHEAD_SCHEDULE_ACCEPTED
   LOOKAHEAD_WORKER_STARTED
   LOOKAHEAD_DECODE_COMPLETED
   QUEUE_INSERT
   QUEUE_EXTRACT (with queue_hit=true)
   ```

## Expected Observations

### Successful Lookahead Queue Path

If the lookahead queue is working correctly during playback:

1. **Scheduling events** - `LOOKAHEAD_SCHEDULE_REQUESTED` and `LOOKAHEAD_SCHEDULE_ACCEPTED` should appear during playback
2. **Worker spawning** - `LOOKAHEAD_WORKER_STARTED` should follow with frame range
3. **Decode completion** - `LOOKAHEAD_DECODE_COMPLETED` should appear for each frame in range
4. **Queue insertion** - `QUEUE_INSERT` should follow each successful decode
5. **Queue consumption** - `QUEUE_EXTRACT` with `queue_hit=true` should appear when those frames are presented
6. **Internal ID correlation** - The `internal` ID should match across DECODE_COMPLETED, QUEUE_INSERT, and QUEUE_EXTRACT for the same frame

### Failure Modes

If any of the following occur, the lookahead queue path has issues:

- **No scheduling events** - Lookahead is not being triggered during playback
- **Worker never starts** - Guard checks are rejecting all lookahead attempts
- **No decode completions** - Worker is spawning but not successfully decoding
- **No queue insertions** - Decoded frames are not entering the queue
- **No queue extractions** - Frames enter queue but are never consumed
- **queue_hit=false always** - Presentation is always missing the queue and going direct to decoder

## Findings

_To be populated after manual test execution_

### Were LOOKAHEAD_SCHEDULE_REQUESTED events observed?

Pending manual test execution.

### Did worker actually spawn and decode frames?

Pending manual test execution.

### Did frames enter queue (QUEUE_INSERT)?

Pending manual test execution.

### Were queued frames consumed (QUEUE_EXTRACT with queue_hit=true)?

Pending manual test execution.

### If queue path never triggered, explain why

Pending manual test execution.

## Notes

- All instrumentation uses temporary `eprintln!` traces prefixed with `[LIFECYCLE_TRACE]`
- No changes to scheduling logic, queue capacity, or worker behavior
- Focus is observation and documentation only
- Manual test execution required as this is runtime behavior verification
