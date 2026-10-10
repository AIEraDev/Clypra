# Clypra Native Desktop vs. Browser E2E Testing Strategy

## 1. Architectural Distinction & Test Boundaries

Clypra employs a dual-tiered end-to-end testing strategy to balance rapid feedback loops with native platform verification:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Clypra Verification Model                       │
├──────────────────────────────────┬─────────────────────────────────────┤
│   Playwright Browser Tests       │  WebdriverIO Native Desktop Tests   │
│   (Frontend UI & Workflows)      │  (@wdio/tauri-service Native E2E)   │
├──────────────────────────────────┼─────────────────────────────────────┤
│ Runner: @playwright/test         │ Runner: WebdriverIO + tauri-driver  │
│ Target: Vite Dev Server (Chrome) │ Target: Compiled Native Binary      │
│ IPC: Controlled In-Memory Mock   │ IPC: Real Tauri v2 Rust Backend     │
│ Surface: Web Canvas / WebGL      │ Surface: wgpu Metal / DX12 / OpenGL │
│ Execution: ~2-5s per scenario    │ Execution: ~30-60s per scenario     │
│ Purpose: UI workflows, state,   │ Purpose: OS integration, menus,     │
│ modals, i18n switching & layout │ WebViews, HW codecs, native dialogs │
└──────────────────────────────────┴─────────────────────────────────────┘
```

### 1.1 Invariant: Mock Boundary Discipline
- Browser Playwright tests simulate frontend contracts through [`tests/e2e/mocks/tauriMock.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/tests/e2e/mocks/tauriMock.ts).
- Browser tests **never** represent proof that native Rust decoders, FFmpeg static builds, OS audio hardware, or native desktop menus function correctly.
- Conversely, native desktop tests require an ahead-of-time application compilation and test the assembled package.

---

## 2. Playwright Frontend UI Testing (Layer 3)

### 2.1 Scope & Coverage
Playwright runs headless or headful Chromium/WebKit against `http://127.0.0.1:5173`.
- **Workflow verification**: Launch screen navigation, project creation, timeline mounting, playback controls.
- **Internationalization**: Language switching across 9 locales (`en`, `ru`, `es`, `ja`, `de`, `fr`, `ko`, `zh-CN`, `zh-TW`), HTML `lang` attributes, pluralization, and persistence in `localStorage`.
- **Accessibility & Focus**: Keyboard traps, dialog roles, `aria-modal`, and screen reader labels.

### 2.2 Execution Command
```bash
npx playwright test
# Or target a specific test suite:
npx playwright test tests/e2e/localization.spec.ts
```

---

## 3. WebdriverIO Desktop Application Testing (Layer 4)

### 3.1 Scope & Coverage
Native desktop E2E tests verify the compiled application binary using official Tauri v2 tooling:
- **Tauri Driver**: `tauri-driver` mediates between WebDriver protocols and the OS-specific WebView (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux).
- **Native OS Menus**: Validates top-level native desktop menu bar translation (`set_menu_language` command in `src-tauri/src/lib.rs`).
- **File System Dialogs**: Validates native file selection via `@tauri-apps/plugin-dialog`.
- **Hardware Acceleration**: Confirms Metal / DirectX 12 GPU context initialization under `VITE_CLYPRA_NATIVE_SURFACE=1`.
- **Process Lifecycle**: Verifies clean termination, lockfile release, and background worker shutdown.

### 3.2 WebdriverIO Architecture & Configuration

A standard Clypra WebdriverIO desktop configuration uses `wdio.conf.ts`:

```typescript
import type { Options } from "@wdio/types";
import path from "node:path";
import os from "node:os";

const binaryPath = process.env.CLYPRA_BINARY_PATH || (
  os.platform() === "darwin"
    ? path.resolve(__dirname, "../src-tauri/target/release/bundle/macos/Clypra.app/Contents/MacOS/Clypra")
    : os.platform() === "win32"
    ? path.resolve(__dirname, "../src-tauri/target/release/Clypra.exe")
    : path.resolve(__dirname, "../src-tauri/target/release/clypra")
);

export const config: Options.Testrunner = {
  specs: ["./tests/desktop/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: binaryPath,
      },
    },
  ],
  services: ["tauri"],
  framework: "mocha",
  reporters: ["spec"],
};
```

### 3.3 Prerequisites & Execution
To execute native desktop tests:
1. Build the desktop binary in release or debug mode:
   ```bash
   pnpm tauri build --debug
   ```
2. Ensure `tauri-driver` is installed:
   ```bash
   cargo install tauri-driver
   ```
3. Run the desktop test runner:
   ```bash
   npx wdio run wdio.conf.ts
   ```

---

## 4. Test Selection Decision Matrix

| Scenario / Verification Need | Layer 3: Playwright | Layer 4: WebdriverIO Native |
| :--- | :---: | :---: |
| Fast pull request UI regression | ✅ Primary | ❌ Too slow for local inner loop |
| Modal trapping and focus styling | ✅ Primary | ⚪ Redundant |
| Language selector UI & reactivity | ✅ Primary | ⚪ Redundant |
| Native OS top menu bar translation | ❌ Unsupported in browser | ✅ Primary (`tauri-driver`) |
| Native file dialog opening | ⚪ Mocked | ✅ Primary (`plugin-dialog`) |
| Metal/DX12 GPU buffer swapchain | ❌ Unsupported in browser | ✅ Primary (Real desktop binary) |
| Release staging smoke test | ⚪ Supplementary | ✅ Primary (Gate 3 CI verification) |

---

## 5. Summary
By keeping browser-based workflow tests fast and isolated via [`tauriMock.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/tests/e2e/mocks/tauriMock.ts), Clypra maintains developer velocity while reserving native desktop WebdriverIO tests for deep OS platform validation during release cycles.
