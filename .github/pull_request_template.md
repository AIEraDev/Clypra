## Summary
<!-- What does this PR do? -->

## Type
- [ ] Bug fix (label: `bugfix`)
- [ ] Feature
- [ ] Refactor
- [ ] Documentation

---

## Evidence Bundle (mandatory for preview/playback/audio/text/sticker changes)

### Test Output
<!-- Paste raw command output. Do not summarize. -->
```
<paste npx vitest run output here>
```

### Subsystem Contract Suites
<!-- Did all 4 pass? Paste output. -->
- [ ] `replayBehavioralContract.test.ts`
- [ ] `audioPreviewSyncContract.test.ts`
- [ ] `previewStateResetContract.test.ts`
- [ ] `textEditPreviewCycle.test.ts`

### Negative Control (bug fixes only)
<!-- Show the test FAILS on the base commit -->
- [ ] Applied test to base commit → test fails
- [ ] Applied test to PR head → test passes

### Mutation Canary
<!-- Did `npm run verify:canary-mutations` pass? -->
- [ ] Known-bad patches turn tests red

### Pixel Validation (if applicable)
- [ ] Layer A (Playwright canvas) passed
- [ ] Layer B (Rust golden) passed
- [ ] Layer C (native readback) ran locally

---

## Not Verified
<!-- List anything you couldn't verify and why -->

---

## Architecture-First Delivery

Complete every applicable item before review. If an item does not apply, write `N/A` and why.

- **Root cause and owning subsystem:**
- **Single authoritative state and execution flow:**
- **Affected consumers:** editor / native preview / browser preview / export / serialization-project loading
- **Cross-runtime verification:** for each affected consumer, test and result:
- **Focused regression coverage:**

### Transition layer (if any)
- **Owner and bounded scope:**
- **Remaining consumers of the old path:**
- **Tracking issue or retirement milestone:**
- **Checkable removal condition:**

### Native playback or performance work (if any)
- **Native test environment:** OS, device, sample rate/channels, representative media:
- **Measured result:** before/after, or diagnostic trace including installed/active clips, mixer peak, callback/rendered/non-silent frames, and output device:
- **Browser verification where browser preview remains supported:**
