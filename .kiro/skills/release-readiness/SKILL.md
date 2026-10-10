---
name: release-readiness
description: >-
  Guides AI agents through pre-release audit and build validation for Clypra.
  Activate when preparing release candidates, validating packaged desktop installers (.dmg, .msi, .deb),
  auditing bundled sidecar binaries (FFmpeg), or checking release CI workflows.
  Enforces read-only validation without performing unauthorized publishing or code signing.
---

# Release Readiness Validation Workflow

## Overview
This skill outlines the strict verification procedure required before publishing a new release of Clypra.
Clypra is a native desktop application with bundled native sidecars and hardware-dependent components. A broken release can leave users with crashes, missing FFmpeg binaries, or unstartable processes.
**Important Rule**: This skill strictly performs *validation and auditing*. It must NEVER trigger automated publishing, deploy artifacts, push tags, or alter external secrets without explicit user authorization.

---

## When to Use This Skill
- Validating a release candidate branch or tag.
- Checking that version numbers match across `package.json`, `Cargo.toml`, and `tauri.conf.json`.
- Auditing bundled sidecars (FFmpeg, Whisper models, platform libraries).
- Running pre-release build checks and package verification scripts.

## When NOT to Use This Skill
- Routine feature development or localized bug fixes (use `feature-implementation` or `bugfix-regression`).
- Live production deployment or continuous deployment runs.

---

## Pre-Release Validation Checklist

### 1. Version & Metadata Synchronization
Verify that versions are strictly consistent:
- `package.json`: `"version": "x.y.z"`
- `src-tauri/Cargo.toml`: `version = "x.y.z"`
- `src-tauri/tauri.conf.json`: `version` field
- `CHANGELOG.md`: Latest release notes present with date and change details.

### 2. Static Analysis & Documentation Integrity
All static gates must pass with zero warnings/errors:
```bash
# Check documentation links
npm run docs:check

# TypeScript compilation
npx tsc --noEmit
```

### 3. Automated Test Verification
Run full test suites:
```bash
# Preview render loop suite (155 tests)
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts

# Rust backend tests
cargo test --manifest-path src-tauri/Cargo.toml
```

### 4. Sidecar & Native Tool Verification
Clypra bundles native binaries (FFmpeg sidecars, etc.):
```bash
# Verify sidecar presence and executable status
node scripts/verify-sidecars.mjs
```
Confirm that:
- Binaries are compiled for target architectures (e.g. `x86_64-pc-windows-msvc`, `aarch64-apple-darwin`, `x86_64-apple-darwin`).
- Dynamic library dependencies are satisfied (static linking where required).

### 5. Frontend Production Bundle Build
```bash
npm run build
```
Verify that:
- `dist/` directory is produced.
- Bundle sizes are within reasonable thresholds.
- Web Worker scripts (`templateRasterizer.worker-*.js`, etc.) are generated properly.

### 6. Desktop Packaging Verification
- For Windows:
  ```powershell
  node scripts/verify-msix-staging.mjs
  ```
- For macOS / Linux / Windows:
  Run automated bundle and startup smoke check:
  ```bash
  npm run smoke:bundle
  ```
- Check Tauri configuration bundles:
  ```bash
  # Check Tauri configuration validity without full native bundle
  npx tauri info
  ```

### 7. Release Report & Sign-off
Summarize release candidate status across all declared targets (consult [`docs/engineering/platform-compatibility.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/platform-compatibility.md)):
- Target version and commit SHA.
- Static check results (TS, doc links).
- Test execution results (Vitest, Cargo).
- Sidecar verification results.
- Built artifact sizes and checksums.
- Outstanding limitations or platform-specific manual testing requirements (e.g., Windows MSIX signing, macOS Apple notarization).

**No Single-Platform Release Claims**: A successful build on one operating system (e.g. Windows or macOS) does not establish cross-platform release readiness. All declared targets (macOS Apple Silicon/Intel, Windows x64, Linux x64/AArch64) must produce independent, traceable verification results. Any target that cannot be verified must be explicitly flagged as unverified in the sign-off report.

**Safety Reminder**: Do not push release tags or invoke publishing actions without direct instruction.
