# ADR-0007 W1-A: Scoped DXGI latch volunteer guide

Status: pre-registered before field data

This guide validates the W1-A scoped DXGI latch on real Windows machines. It
compares the existing legacy behavior with `CLYPRA_DXGI_SCOPED_LATCH=1` on the
same volunteer, adapter, driver, clips, and trigger sequence.

W1-A changes eligibility scoping only. It does not add a frame lease, change
surface-pool sizing, compare adapter LUIDs, or change cross-API ordering. Do not
use this guide to make claims about those features.

## Who should participate

The minimum analysis set is:

- 6 volunteers, each running both arms on the same Windows installation.
- 3 distinct adapter-and-driver cohorts, with at least 2 volunteers in each
  cohort.
- A release build containing W1-A and the opt-in telemetry uploader.

A cohort is identified by the observed adapter vendor/device facts and driver
version already present in telemetry. Do not send GPU serial numbers, user
names, project names, or file paths.

If a volunteer updates the GPU driver between arms, treat the pair as two
different cohorts and repeat the comparison on an unchanged driver.

## Arm setup

Run two separate sessions with the same volunteer and machine:

| Arm | Environment | Expected header evidence |
| --- | --- | --- |
| Legacy | Leave `CLYPRA_DXGI_SCOPED_LATCH` unset, or set it to `0` | `resolvedFlags.CLYPRA_DXGI_SCOPED_LATCH=false`, `experimentArm=dxgi-legacy-latch` |
| Scoped | Set `CLYPRA_DXGI_SCOPED_LATCH=1` before starting Clypra | `resolvedFlags.CLYPRA_DXGI_SCOPED_LATCH=true`, `experimentArm=dxgi-scoped-latch` |

Restart Clypra after changing the environment variable. Do not change the
flag during a session. Randomize which arm each volunteer runs first, and keep
the same order of arms recorded with the returned session IDs.

Before sending a result, confirm that the session header contains the expected
flag and arm. A session with missing or contradictory arm evidence is invalid
for the comparison.

## Trigger sequence

Use the same three clips in both arms. The clips must represent:

1. **A:** H.264, 8-bit, 4:2:0, with a resolution bucket recorded by the app.
2. **B:** a clip that leaves the DXGI zero-copy path, preferably HEVC/P010 or
   another clip that is software-decoded on the test machine.
3. **A again:** the exact same H.264 clip from step 1.

For each session:

1. Open a new project and add clip A.
2. Play or scrub clip A for 30 seconds, including at least one seek.
3. Add clip B and play or scrub it for 30 seconds, including at least one
   seek. Do not force a crash or use debug fault injection.
4. Return to clip A and play or scrub it for 30 seconds, including at least
   one seek. This is the primary observation window.
5. Close the project normally so the append-only session log uploads.

Do not add other video clips, change display hardware, or run another GPU-heavy
application during the sequence. If Clypra freezes, crashes, or cannot upload
the completed session, record the failure and stop; do not retry until the
session ID and arm are known.

## Pre-registered outcomes

The primary metric is the zero-copy frame share in the **later A window**:

```text
zero_copy_share = zero_copy_frames / observed_video_frames
```

The scoped arm is considered to show the expected H1 improvement only if all
of these are true after the minimum cohort set is complete:

- Scoped median later-A zero-copy share is at least 70%.
- Legacy median later-A zero-copy share is at most 20%.
- The paired scoped-minus-legacy median uplift is at least 30 percentage
  points.

These are thresholds, not a promise that the result will pass. Report the
paired values even when a session is below the threshold.

## Harm checks

The scoped arm must not exceed the paired legacy arm by more than:

- 2 percentage points in dropped-frame share.
- 2 percentage points in freeze or timeout share.
- 1 percentage point in per-attempt import-failure share.

The session-level evidence must also satisfy both of these limits:

- At most one breaker promotion per session.
- Zero device-scope latch events in a valid comparison session.

A stream-class event for clip B is expected when B exercises the intended
failure scope. A class latch for B must not be treated as a device latch, and
the later A window must retain its own class evidence.

Any crash, unrecoverable freeze, missing arm evidence, invalid trust grade, or
missing primary counter excludes that session from the primary analysis and is
reported separately as a safety outcome.

## What to send back

Use the existing opt-in telemetry path. Send only the two session IDs and this
small companion table; do not attach raw local logs or screenshots containing
paths.

| Field | Legacy | Scoped |
| --- | --- | --- |
| Session ID |  |  |
| Header arm |  |  |
| Resolved flag |  |  |
| Adapter/driver cohort label |  |  |
| Clip B class (codec/profile/bit depth/chroma/size bucket) |  |  |
| Later-A zero-copy share |  |  |
| Dropped-frame share |  |  |
| Freeze/timeout share |  |  |
| Import-failure share |  |  |
| Breaker promotions |  |  |
| Device-scope events |  |  |
| Crash or unrecoverable freeze |  |  |

The analysis owner should pair sessions by volunteer and machine, then report
the median and range for each cohort. Do not pool across cohorts before showing
the cohort-level result.

## Decision rule

Do not start W1-B from this guide alone. Hold W1-B until the uploaded Windows
sessions show the `sliceReuseInFlight` hazard counter for the volunteer cohort.
If it remains zero, frame-lease work stays lower priority. If it is nonzero,
revisit the lease together with pool sizing and the CPU-copy exhaustion
fallback.

