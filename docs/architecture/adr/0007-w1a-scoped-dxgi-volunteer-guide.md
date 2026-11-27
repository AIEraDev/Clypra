# ADR-0007 W1-A: Scoped DXGI latch volunteer guide

Status: pre-registered; lock before field data

Protocol version: `w1a-volunteer-v1`

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

## Protocol lock and arm counterbalancing

This exact guide, including the thresholds and sequence, must be committed and
tagged as `w1a-volunteer-v1` before the first volunteer starts. Do not change
the arm order, fixture, thresholds, or exclusion rules after data collection
begins. A substantive change creates a new protocol version; do not combine its
results with v1.

The A→B→A order below is the clip order within each session. The order of the
two arms is a separate counterbalance: assign exactly three volunteers to run
Legacy first and three to run Scoped first. Keep both arms on the same machine,
driver, and display, and record the assigned order with the session IDs. This
prevents cache warmth and thermal state from being confounded with the arm.

| Volunteers | First arm | Second arm |
| --- | --- | --- |
| V01–V03 | Legacy | Scoped |
| V04–V06 | Scoped | Legacy |

Do not silently replace a missed or invalid volunteer. Record any replacement
as a new participant and preserve the 3/3 first-arm balance.

## Arm setup and Windows launch

Run two separate sessions with the same volunteer and machine:

| Arm | Environment | Expected header evidence |
| --- | --- | --- |
| Legacy | Leave `CLYPRA_DXGI_SCOPED_LATCH` unset, or set it to `0` | `resolvedFlags.CLYPRA_DXGI_SCOPED_LATCH=false`, `experimentArm=dxgi-legacy-latch` |
| Scoped | Set `CLYPRA_DXGI_SCOPED_LATCH=1` before starting Clypra | `resolvedFlags.CLYPRA_DXGI_SCOPED_LATCH=true`, `experimentArm=dxgi-scoped-latch` |

For a temporary arm assignment, launch Clypra from the **same PowerShell
window** in which the variables were set. For example:

```powershell
$env:CLYPRA_DXGI_SCOPED_LATCH = "1" # use "0" for Legacy
$env:CLYPRA_MEDIA_HASH = "<published-fixture-pack-sha256>"
& "C:\Path\To\Clypra.exe"
```

Do not set the variable in PowerShell and then launch from the Start menu; that
launch does not inherit the temporary shell environment. As an alternative,
persist the values before a full sign-out/restart:

```powershell
setx CLYPRA_DXGI_SCOPED_LATCH 1 # use 0 for Legacy
setx CLYPRA_MEDIA_HASH <published-fixture-pack-sha256>
```

`setx` affects future processes only. Fully exit Clypra and restart Windows
(or sign out and back in) before launching from the Start menu. Do not change
the flag during a session.

Before sending a result, confirm all of the following in the uploaded session
header: `resolvedFlags.CLYPRA_DXGI_SCOPED_LATCH`, the expected
`experimentArm`, and the expected `mediaHash`. A missing or contradictory
value invalidates that session for the primary comparison; exclude it rather
than inferring the arm from how Clypra was launched.

## Fixture pack

Every volunteer must use the same immutable, hash-verified fixture pack,
published with this protocol. The pack contains:

1. **A:** H.264, 8-bit, 4:2:0, with a resolution bucket recorded by the app.
2. **B:** a Main10/P010 clip or a clip that is software-decoded on the test
   machine.

Verify the pack's SHA-256 independently before the run. Set
`CLYPRA_MEDIA_HASH` to that published hash and reject any session whose header
`mediaHash` does not match it. The header value identifies the approved pack;
the independent local hash check is what verifies that the files actually
match.

For clip B, record which trigger occurred in the companion result: if the GPU
cannot hardware-decode 10-bit video, B may fall off the path as a non-D3D11
frame (the H1 case); if it does hardware-decode, the P010 import may be
rejected (the H5 case). Both are valid W1-A triggers and must not be pooled as
if they were the same mechanism.

## Trigger sequence

Use the same three clips in both arms. The clips must represent:

1. **A:** the approved H.264 8-bit clip.
2. **B:** the approved Main10/P010 or software-decoded clip.
3. **A again:** the exact approved H.264 clip from step 1.

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

Six paired volunteers are intended to detect only a large effect such as
legacy near-zero later-A zero-copy share versus scoped high share. This sample
can catch gross regressions in drops and failures, but it cannot rule out rare
harm; a clean result must not be described as evidence that rare failures do
not exist.

## Consent and withdrawal

Participation is opt-in. Before each run, the volunteer must enable telemetry
upload in Settings → Diagnostics and agree to this comparison. The upload is
limited to the session header and bounded counters/metadata needed for the
comparison, including the arm, fixture hash, adapter/driver facts, latch
events, and video-path counters. It does not upload media, project names, or
file paths. The volunteer may withdraw from future uploads at any time by
turning telemetry upload off in Settings → Diagnostics; for the next launch,
`CLYPRA_DISABLE_TELEMETRY_UPLOAD=1` is also an explicit opt-out override.
Already-uploaded sessions are identified by session ID for the documented
90-day retention and deletion-request process.

## What to send back

Use the existing opt-in telemetry path. Send only the two session IDs and this
small companion table; do not attach raw local logs or screenshots containing
paths.

| Field | Legacy | Scoped |
| --- | --- | --- |
| Session ID |  |  |
| Header arm |  |  |
| Resolved flag |  |  |
| Media hash |  |  |
| Adapter/driver cohort label |  |  |
| Clip B trigger (H1 non-D3D11 or H5 P010 import rejection) |  |  |
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

