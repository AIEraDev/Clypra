# Clypra Release Readiness & Distribution Validation

## 1. Overview
Clypra is distributed as a native desktop application across Windows (`.msi`, `.exe`, `.msix`) and macOS (`.dmg`), with Linux packaging (`.deb`, `.AppImage`) available via GitHub Actions.
Because the application embeds native sidecar executables (FFmpeg), native C++ ML runtimes (Whisper.cpp, ONNX), and platform-specific audio/GPU drivers, release validation requires rigorous verification of bundled dependencies before publication.

---

## 2. Release Candidate Verification Pipeline

The release validation workflow consists of the following phases:

```
┌────────────────────────┐
│  Phase 1: Source Audit │ Version metadata parity across package manifests
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ Phase 2: Static Checks │ Zero TS errors, documentation links validated
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ Phase 3: Automated Test│ Vitest preview render loop + Cargo engine tests
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ Phase 4: Sidecar Audit │ Verify presence and architectures of bundled binaries
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ Phase 5: Bundle Build  │ Production frontend compilation via Vite
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ Phase 6: Package Stage │ MSIX staging / Tauri installer bundling
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ Phase 7: Manual Signoff│ Smoke test on clean OS, code signing & notarization
└────────────────────────┘
```

---

## 3. Discovered Tooling & Executable Scripts

The repository includes several scripts supporting release validation:

### 3.1 Sidecar Management & Verification
- `scripts/setup-sidecars.sh` (macOS/Linux) and `scripts/setup-sidecars.ps1` (Windows): Downloads and extracts platform-specific FFmpeg binaries into `src-tauri/sidecars/`.
- `scripts/ensure-sidecars.mjs`: Node.js script executed during `predev` to ensure required binaries are present.
- `scripts/verify-sidecars.mjs`: Validates that required sidecar binaries exist, have executable permissions, and match expected architecture naming conventions.

### 3.2 Packaging Scripts
- `scripts/verify-msix-staging.mjs`: Validates Windows MSIX packaging manifest, icons, and staging layout.
- `scripts/package-msix.ps1`: PowerShell script for assembling the Windows MSIX container.
- `pnpm tauri build`: Standard Tauri multi-platform bundler producing `.dmg` on macOS, `.msi`/`.exe` on Windows, and `.deb`/`.AppImage` on Linux.

### 3.3 GitHub Actions Release Pipeline
- `.github/workflows/release.yml`: Triggered on `v*` tag push or manual `workflow_dispatch`.
  - Matrix builds: `macos-latest` (Apple Silicon), `macos-15-intel`, `windows-latest` (x64), `ubuntu-22.04` (x64), `ubuntu-24.04-arm`.
  - Links static FFmpeg and builds distributable installers.

---

## 4. Execution Commands for Release Validation

To audit release readiness locally:

```bash
# 1. Verify docs links
npm run docs:check

# 2. Strict type check
npx tsc --noEmit

# 3. Preview render loop regression suite
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts

# 4. Native Rust backend tests
cargo test --manifest-path src-tauri/Cargo.toml

# 5. Sidecar audit
node scripts/verify-sidecars.mjs

# 6. Build production frontend assets
npm run build
```

---

## 5. Current Implementation Status & Outstanding Requirements

| Release Step | Current Status | Operational Notes |
|---|---|---|
| **Version Alignment** | Implemented | Manually synchronized across `package.json`, `Cargo.toml`, and `tauri.conf.json`. |
| **Frontend Production Build** | Implemented | `npm run build` succeeds cleanly. |
| **Sidecar Verification Script** | Implemented | `node scripts/verify-sidecars.mjs` checks local files. |
| **MSIX Verification Script** | Implemented | `node scripts/verify-msix-staging.mjs` checks staging tree. |
| **Windows MSIX Packaging** | Implemented | `pwsh scripts/package-msix.ps1` available on Windows. |
| **Apple Code Signing & Notarization** | CI Automated | Handled in GitHub Actions via Apple developer secrets; requires secrets for local execution. |
| **Windows Authenticode Signing** | CI Automated | Handled in GitHub Actions via Azure Trusted Signing or PFX certs. |
| **Automated Smoke Testing** | Future Enhancement | Currently performed manually on physical hardware before public release tag push. |

**Important Constraint**: AI agents and automated scripts must never perform code signing, create git tags, or deploy binaries to package repositories without explicit authorization.
