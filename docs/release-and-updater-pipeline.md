# Release & Auto-Updater Pipeline Specification

This document details the architecture, manifest structure, signature verification, and CI/CD workflow for Clypra's cross-platform auto-updater.

---

## 1. Architecture Overview

Clypra uses the native `@tauri-apps/plugin-updater` and `tauri-plugin-updater` system.

```text
┌────────────────────────┐         ┌────────────────────────────────────────────────────────┐
│ Clypra Client (v1.x.x) │ ──────> │ GitHub Releases Endpoint                               │
│ (updaterService.ts)    │         │ https://github.com/.../releases/latest/download/latest.json
└───────────┬────────────┘         └────────────────────────┬───────────────────────────────┘
            │                                               │
            │ Parses latest.json                            │ HTTP 302 Redirect
            ▼                                               ▼
┌────────────────────────┐         ┌────────────────────────────────────────────────────────┐
│ Verify Minisign Sig    │         │ Release Binaries (Direct URLs)                         │
│ Compare Version string │ ──────> │ https://github.com/.../releases/download/vX.Y.Z/...    │
└────────────────────────┘         └────────────────────────────────────────────────────────┘
```

---

## 2. Dual Manifest Specification (`latest.json` & `updater.json`)

To ensure 100% compatibility across different client versions, tooling, and legacy installations, every release publishes **BOTH** `latest.json` and `updater.json` as identical synchronized mirrors:
- `https://github.com/AIEraDev/clypra/releases/latest/download/latest.json` (Tauri 2 standard)
- `https://github.com/AIEraDev/clypra/releases/latest/download/updater.json` (Tauri 1 / legacy mirror)

The release manifests must contain direct, public download links (NOT internal GitHub API URLs):

```json
{
  "version": "1.4.1",
  "notes": "Automated multi-platform release bundle",
  "pub_date": "2026-08-23T02:19:49.475Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/AIEraDev/Clypra/releases/download/v1.4.0/Clypra_1.4.0_aarch64.app.tar.gz"
    },
    "darwin-aarch64-app": {
      "signature": "...",
      "url": "https://github.com/AIEraDev/Clypra/releases/download/v1.4.0/Clypra_1.4.0_aarch64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "...",
      "url": "https://github.com/AIEraDev/Clypra/releases/download/v1.4.0/Clypra_1.4.0_amd64.AppImage"
    },
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/AIEraDev/Clypra/releases/download/v1.4.0/Clypra_1.4.0_x64_en-US.msi"
    }
  }
}
```

### Critical Rules:
1. **Public Direct URLs**: URLs MUST point to `https://github.com/<owner>/<repo>/releases/download/<tag>/<filename>`. GitHub API asset URLs will fail on public clients because they return JSON metadata instead of binary archives without explicit authentication headers.
2. **Platform Keys**: Tauri 2 matches the platform key (`darwin-aarch64`, `windows-x86_64`, `linux-x86_64`, etc.). If a platform key is absent for the host system, `check()` returns an error.

---

## 3. GitHub Actions Release Configuration

In `.github/workflows/release.yml`, the release step MUST specify:
```yaml
- name: Build & Publish Release
  uses: tauri-apps/tauri-action@action-v1.0.0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  with:
    tagName: v__VERSION__
    releaseName: "Clypra v__VERSION__"
    releaseBody: "Automated multi-platform release bundle"
    releaseDraft: false
    prerelease: false
    args: ${{ matrix.args }}
```

- **`releaseDraft: false`**: Ensures `tauri-action` publishes the release immediately and generates public download URLs rather than `api.github.com` asset URLs.

---

## 4. Homebrew Cask Tap Distribution

Clypra is distributed on macOS via the custom tap `AIEraDev/homebrew-tap`.

- **Tap Repository**: `https://github.com/AIEraDev/homebrew-tap`
- **Cask File**: `Casks/clypra.rb`
- **Installation Command**:
  ```bash
  brew install AIEraDev/tap/clypra
  ```
- **Update Command**:
  ```bash
  brew upgrade clypra
  ```

### Cask Definition:
```ruby
cask "clypra" do
  arch arm: "aarch64"

  version "1.4.1"
  sha256 arm: "<SHA256_OF_DMG>"

  url "https://github.com/AIEraDev/Clypra/releases/download/v#{version}/Clypra_#{version}_#{arch}.dmg",
      verified: "github.com/AIEraDev/Clypra/"

  name "Clypra"
  desc "A modern, native video editor built with Tauri, React, and FFmpeg"
  homepage "https://github.com/AIEraDev/Clypra"

  app "Clypra.app"

  postflight do
    system_command "xattr",
                   args: ["-cr", "#{appdir}/Clypra.app"]
  end

  zap trash: [
    "~/Library/Application Support/com.clypra.editor",
    "~/Library/Caches/com.clypra.editor",
    "~/Library/Preferences/com.clypra.editor.plist",
    "~/Library/Saved Application State/com.clypra.editor.savedState",
  ]
end
```

## 5. Session-Safe Deferred Updates

Clypra uses a two-stage update lifecycle. Discovering or downloading an update
must never interrupt an active editing session:

```text
available
   │ user chooses Download update
   ▼
downloading ───────────────► downloaded
                                  │
                                  │ user chooses Restart and update
                                  ▼
                             applying
                                  │
                                  ├─ pause active transport
                                  ├─ flush the current project state
                                  ├─ verify the finalized project file
                                  ├─ dispose the active runtime session
                                  ├─ install the downloaded package
                                  └─ relaunch Clypra
```

The downloaded package is held by the Tauri updater resource for the current
process. If Clypra exits before the user applies it, the package is discarded
and the next launch performs a safe update check again.

### Save-before-update contract

The update coordinator calls the project store's immediate save operation. This
operation does not depend on the auto-save setting or on a pending debounce
timer. It serializes the latest project, timeline, transitions, gaps, markers,
and media assets, waits for the platform write to finish, and requires a
verified save result.

On desktop, `save_project` writes a temporary file, atomically replaces the
project file, reads the finalized file back, and compares it with the payload.
The update cannot proceed unless this verification succeeds. Save failures are
reported to the user and leave the project/session open for retry.

### Failure and retry behavior

- Download failures keep the update available for retry and never relaunch.
- Save failures block installation and preserve the downloaded update.
- Installation failures keep the downloaded update available when the updater
  resource remains valid.
- Duplicate download/apply actions are ignored while an operation is active.
- The startup banner and Settings use the same updater state, so they cannot
  disagree about whether an update is downloading or ready to apply.

### Release QA checklist

- Discover an update while a project is open and actively playing; confirm
  playback continues during download.
- Download the update, continue editing, and confirm no relaunch occurs.
- Apply it with auto-save disabled and with no pending auto-save timer; confirm
  the latest project state is saved before installation.
- Force a save failure; confirm installation and relaunch do not occur and the
  project remains open.
- Apply with no active project; confirm the update can install after explicit
  confirmation.
- Close the app before applying; reopen and confirm the update is checked again
  without a false pending-download state.

## 6. Project Persistence Reliability (1.4.5)

Version 1.4.4 is already released. These persistence changes are for the next
unreleased version, 1.4.5; no tag or release metadata is changed by this work.

### File generations

Each project has three possible files in the `projects` directory:

```text
<project-id>.json       verified current primary
<project-id>.json.bak   one verified previous generation
<project-id>.json.tmp   in-progress candidate, never opened as a project
```

The save pipeline is shared by normal save, auto-save, close-project, rename,
and updater preparation:

1. Serialize the canonical project snapshot, including tracks, clips,
   transitions, gaps, markers, media assets, metadata, thumbnails, canvas
   settings, text effects, conform data, and `timelineSchemaVersion`.
2. Write and flush the temporary file.
3. Read the temporary file back, parse it, and validate it.
4. Preserve the current validated primary as `.bak`.
5. Replace the primary using the platform file replacement path.
6. Read and validate the final primary and compare it with the candidate.
7. Return a receipt containing project ID, byte count, persisted modification
   time, and verification metadata.

If replacement or final verification fails, the previous primary is restored
from `.bak` and the error is returned. A `.bak` is never produced from an
unvalidated candidate.

Capacitor uses the same ordering with Filesystem temporary files and readback
verification. Its localStorage path is only used when the filesystem backend
is unavailable; filesystem read/write/verification failures are surfaced and
are never silently redirected to localStorage.

### Safe reopening and migration

Project payloads pass through `validateAndMigrateProjectPayload` before active
project state or timeline state is changed. Legacy clip kind, conform, and
embedded text-effect data are migrated in memory through the central
serialization layer. A migrated payload is saved only after successful
hydration and verified persistence. If that save fails, the original file is
left in place and the user receives a warning.

Hydration failures are transactional: the failed project remains closed and a
currently open project is restored. The previous behavior of catching a
hydration error, resetting the timeline to empty, and continuing is forbidden.

### Recent projects and recovery copies

Recent-project discovery is failure-isolated. A malformed project is shown as
an unreadable entry with its path, reason, and backup availability; it cannot
hide valid projects. When a verified backup exists, the Launch screen offers
“Open recovered copy”. Recovery reads the backup, assigns a new project ID and
`(Recovered)` name, and saves it as a new project. Neither the corrupted
primary nor its backup is overwritten automatically.

### Crash recovery completeness

The IndexedDB recovery snapshot includes every editable persistence field:
project metadata, media assets, tracks, clips, transitions, gaps, markers, and
timeline schema version. Older snapshots default missing fields to empty arrays
or the project schema marker during read.

### 1.4.5 persistence QA checklist

- Save/reopen a project containing metadata, media assets, thumbnails, canvas
  settings, tracks, clips, transitions, gaps, markers, text effects, and conform
  data; compare all fields after reopening.
- Interrupt or fail a candidate write; confirm the previous primary remains
  readable and the backup is the prior verified generation.
- Force replacement failure; confirm rollback restores the primary.
- Corrupt one recent project; confirm other projects remain visible and the
  corrupt project shows its concrete error and recovery action.
- Confirm a malformed project never opens with an empty timeline.
- Force hydration failure while another project is open; confirm the active
  project and timeline remain intact.
- Open a legacy project, verify migration in memory, and confirm migration
  save failure leaves the legacy file unchanged.
- Restore a crash snapshot and verify gaps and markers are present.
- Run the TypeScript suite and Rust library/command tests before release
  preparation. Do not create or alter the `v1.4.5` tag until these checks and
  manual recovery scenarios pass.
