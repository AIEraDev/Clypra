## Summary
<!-- What does this PR do? Explain the problem, solution, and motivation. -->

## Related Issues
<!-- Closes #123, Relates to #456 -->

## Type
- [ ] Bug fix (label: `bugfix`)
- [ ] Feature / Capability enhancement
- [ ] Performance / Optimization / Caching
- [ ] Security / ACL / Capability hardening
- [ ] Refactor / Architecture cleanup
- [ ] Internationalization (i18n)
- [ ] Documentation / CI / Tooling

---

## Mechanical Quality Gates (Mandatory Definition of Done)

Before submitting or requesting review, confirm every applicable gate passes locally:

- [ ] `npx tsc --noEmit` — 0 TypeScript errors
- [ ] `npm run verify:architecture` — 8/8 Architecture Invariant & Fitness checks pass
- [ ] `npm run i18n:check` — 100% key and placeholder parity across all 9 supported locales (en, de, es, fr, ja, ko, ru, zh-CN, zh-TW)
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` — Rust native backend compiles cleanly
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D clippy::disallowed-methods -D warnings` — 0 Clippy lints or warnings
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — Rust unit & integration test suites pass
- [ ] `npm run verify:gate` or `npm run verify:fast` passed cleanly

---

## Three-Tier Architecture & Invariant Compliance

Check off all invariants applicable to this change:

- [ ] **Tier 1 (React UI / State)**:
  - Invariant 1: `PlaybackClock.ts` is sole session authority (no secondary clocks).
  - Invariant 2: Consumes `EvaluatedScene` emitted by `evaluateTimelineSceneCached()` (never read `timelineStore` in render loops).
  - Invariant 3: Command-pattern mutations via `historyStore.dispatch()` (zero direct store mutations).
  - Invariant 12: Zero hardcoded user-facing text (canonical semantic keys in `src/i18n/catalogs/en.json`).
- [ ] **Tier 2 (Web Workers)**:
  - Input validation, compute DoS quotas, and explicit resource disposal (`{ type: "DISPOSE" }`, buffer transfers).
- [ ] **Tier 3 (Rust Core / Desktop Shell)**:
  - Invariant 14: Diagnostic logging scrubs all personal paths, credentials, and machine IDs.
  - Invariant 16: All native OS window/view/hierarchy operations dispatch exclusively on the main UI thread via `window.run_on_main_thread()` / `app.run_on_main_thread()`.
  - Tauri v2 IPC ACL least-privilege capabilities and path traversal elimination.
- [ ] **Cross-Platform Contract Discipline (Invariant 11)**:
  - Zero OS branching in timeline math; identical editing semantics across macOS, Windows, and Linux.

---

## Evidence Bundle (Mandatory for preview/playback/audio/text/sticker changes)

### Test Output
<!-- Paste raw command output. Do not summarize. -->
```
<paste npx vitest run / cargo test output here>
```

### Subsystem Contract Suites
<!-- When touching src/core/playback/, src/core/audio/, src/components/editor/preview/, or src/features/text-effects/ -->
- [ ] `replayBehavioralContract.test.ts`
- [ ] `audioPreviewSyncContract.test.ts`
- [ ] `previewStateResetContract.test.ts`
- [ ] `textEditPreviewCycle.test.ts`

### Negative Control (Bug fixes only)
<!-- Show that the regression test FAILS on base commit and PASSES on PR head -->
- [ ] Applied test to base commit → test fails (paste failure):
- [ ] Applied test to PR head → test passes:

### Mutation Canary
<!-- Did `npm run verify:canary-mutations` pass? -->
- [ ] Known-bad patches turn tests red

### Presenter & Pixel Validation (if applicable)
- [ ] Layer A (Playwright canvas fallback) passed
- [ ] Layer B (Rust golden comparison) passed
- [ ] Layer C (Native GPU surface: Metal on macOS / DirectX 12 on Windows) verified at runtime (Invariant 13)

---

## Cross-Platform Verification

Indicate platforms verified for this change:
- [ ] **macOS** (AppKit / Metal / VideoToolbox)
- [ ] **Windows** (Win32 / DirectX 12 / Media Foundation)
- [ ] **Linux** (GTK / WebKitGTK / VA-API)

---

## Not Verified & Remaining Gaps
<!-- List anything you could not verify locally (e.g. specific hardware codec, remote OS target, physical device) and explain why -->

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
