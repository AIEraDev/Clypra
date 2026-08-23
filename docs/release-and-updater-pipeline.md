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
