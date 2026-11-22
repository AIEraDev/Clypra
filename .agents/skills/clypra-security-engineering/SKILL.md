---
name: clypra-security-engineering
description: >-
  Guides threat modeling, defensive architecture, vulnerability prevention, and input sanitization across Clypra's
  Three-Tier Compute Boundary (React UI, Web Workers, Rust native core) and Tauri v2 IPC transport. Use when authoring
  or reviewing Tauri IPC commands, filesystem operations, external process/FFmpeg invocations, remote asset fetching,
  project file serialization, SVG/text template parsing, worker messaging, or privacy/telemetry redaction.
---

# Clypra Three-Tier Security Architecture & Engineering Standards

## 1. Mission & Threat Model

Clypra is a high-performance native desktop video editor combining a React 19 webview frontend, multi-threaded Web Workers, and a privileged Rust backend with direct OS, GPU (Metal/DirectX 12), and filesystem access. 

Desktop video editors present an expansive attack surface because they ingest arbitrary media files, parse complex JSON project schemas, fetch remote assets (LUTs, templates, stickers, fonts), spawn FFmpeg sidecars, and execute high-frequency native IPC.

To ensure user data, host systems, and media workflows remain uncompromised, Clypra enforces a **Zero-Trust, Three-Tier Defensive Architecture**:
1. **Tier 1 (Frontend & Webview Boundary)**: Sanitizes remote payloads, prevents prototype pollution, enforces finite numeric bounds, validates URL schemes, and blocks script/XSS injection.
2. **Tier 2 (Web Worker Sandboxing Boundary)**: Constrains off-thread compute quotas, validates message schemas, prevents memory exhaustion DoS, and guarantees explicit termination lifecycles.
3. **Tier 3 (Rust Native Core & Tauri Host Boundary)**: Confines filesystem operations, eliminates path traversal, sanitizes shell arguments, quarantines corrupted files, redacts user privacy in logs, and enforces panic-free error propagation.
4. **Cross-Tier Boundary (Tauri v2 IPC & Capabilities)**: Applies strict least-privilege capability manifests, validates deserialized parameters, and isolates native handles.

### Non-Negotiable Invariants
- **Architecture Invariant 9 (Three-Tier Compute Boundary)**: Security controls must be applied at the respective tier boundary. Heavy security checks must not block real-time audio or GPU rendering loops.
- **Architecture Invariant 11 (Cross-Platform Contract Discipline)**: Security checks (path separators, URI schemes, shell argument validation) must behave identically across macOS, Windows, and Linux. Never rely on OS-specific path parsing.
- **Architecture Invariant 14 (Diagnostic Logging & Privacy Invariant)**: All local logs and telemetry must redact absolute user directories, usernames (`/Users/<user>` or `C:\Users\<user>`), machine IDs, and credentials.
- **Architecture Invariant 16 (Native UI Thread Safety)**: Native window and graphics surface calls must dispatch via `run_on_main_thread` to prevent thread affinity crashes or memory access violations.

---

## 2. When to Activate This Skill

Activate this skill whenever a task involves:
- Adding or modifying a Tauri IPC command (`#[tauri::command]`).
- Reading, writing, moving, or deleting files on the host filesystem.
- Invoking external CLI tools or sidecars (e.g. FFmpeg, FFprobe).
- Fetching, downloading, or caching remote assets (stickers, LUTs, templates, fonts).
- Parsing user-provided or imported project files (`.clypra`, JSON, XML, SRT, VTT).
- Rendering dynamic SVG, HTML, or Lottie vector graphics in the webview.
- Passing data or transferring buffers across Web Worker boundaries.
- Configuring Tauri v2 permission capabilities or ACL manifests (`src-tauri/capabilities/`).
- Writing diagnostic, telemetry, or crash logging code (Invariant 14).
- Auditing the codebase for path traversal, injection, DoS, or memory safety vulnerabilities.

---

## 3. High-Level Security Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 1: FRONTEND & WEBVIEW BOUNDARY (React 19 / TypeScript)            │
│   • Input validation: Zod / strict structural schema verification      │
│   • Prototype pollution defense: isDangerousKey() checks               │
│   • URL scheme whitelisting: HTTPS only (HTTP strictly for localhost)  │
│   • DOM / SVG sanitization: No unescaped dangerouslySetInnerHTML       │
│   • Value clamping: clampNumeric() prevents NaN/Infinity poisoning     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ postMessage (Structured Clone / Transfer)
┌───────────────────────────────────▼────────────────────────────────────┐
│ TIER 2: WEB WORKER SANDBOXING & COMPUTE DOS DEFENSE                    │
│   • Strict discriminated union message contracts                       │
│   • Memory allocation caps (prevent worker OOM on corrupted media)     │
│   • Explicit worker lifecycle termination ({ type: "DISPOSE" })        │
│   • Zero prototype mutation in worker deserialization                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Tauri v2 IPC Command Boundary (invoke)
┌───────────────────────────────────▼────────────────────────────────────┐
│ TIER 3: RUST NATIVE CORE & TAURI HOST DEFENSE                          │
│   • Path traversal elimination: sanitize_and_validate_path()           │
│   • Project ID character restriction: validate_project_id()            │
│   • Shell injection defense: sanitize_shell_arg() & discrete args      │
│   • Atomic writes & quarantine: validate_or_quarantine()               │
│   • Diagnostic privacy & path redaction (Invariant 14)                 │
│   • Native main-thread UI dispatch (Invariant 16)                      │
│   • Least-privilege Tauri v2 ACL capabilities                          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Tier 1: Frontend & Webview Security Standards

### 4.1 Remote URL Validation & Scheme Whitelisting
All network asset downloads (LUTs, templates, smart overlays, audio previews) must be validated using `isValidFilterUrl` or equivalent URL parsers before initiating a network request.

**Mandatory Rules:**
- Disallow dangerous schemes (`javascript:`, `file:`, `data:`, `blob:`, `vbscript:`).
- Strip credentials from URLs (e.g. `https://user:pass@host`).
- Enforce `https:` protocol in production; allow `http:` strictly for loopback addresses (`localhost`, `127.0.0.1`, `::1`).
- Limit URL length to at most 2,048 characters.

```typescript
// Canonical pattern (src/features/filters/security/filterValidation.ts)
export function isValidFilterUrl(url: string): boolean {
  if (typeof url !== "string" || !url.trim() || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === "https:") return Boolean(parsed.hostname);
    if (parsed.protocol === "http:") {
      return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    }
    return false;
  } catch {
    return false;
  }
}
```

### 4.2 Prototype Pollution Protection
When parsing JSON presets, remote metadata, or configuration maps, never assign user-controlled keys directly to JavaScript objects without filtering dangerous property names.

```typescript
export function isDangerousKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

// When merging or building dictionaries:
for (const [key, val] of Object.entries(rawInput)) {
  if (isDangerousKey(key)) continue;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) continue;
  safeOutput[key] = val;
}
```

### 4.3 Numeric Value Clamping & Finite Bounds
Malicious or corrupt project files can inject `NaN`, `Infinity`, or negative dimensions into clip transforms, volume sliders, or timecode calculations. Unchecked values cause shader crashes, infinite loops, or audio screeching.

- **Rule**: Every numeric value received from external sources or IPC must be validated with `Number.isFinite()` and clamped to an allowed domain:
  - Audio volume / gain: clamped to `[0.0, 10.0]` (silent to +20dB).
  - Track pan: clamped to `[-1.0, 1.0]`.
  - Clip scale / opacity: clamped to `[0.0, 50.0]` and `[0.0, 1.0]`.
  - Shader uniforms: clamped to finite ranges (e.g. `[-1000.0, 1000.0]`).

### 4.4 Safe SVG & Vector Rendering
Text effects, stickers, and title cards allow custom vector paths.
- Never use `dangerouslySetInnerHTML` with raw unescaped SVG text.
- Strip `<script>`, `<foreignObject>`, `onload=`, `onerror=`, and external CSS `url()` references before rendering SVGs.

---

## 5. Tier 2: Web Worker & Off-Thread Compute Security

### 5.1 Strictly Typed Message Contracts
Web Workers process untrusted media payloads outside the main thread. Communication over `postMessage` must use typed Discriminated Unions with explicit runtime message structure checks:

```typescript
export type WorkerInboundMessage =
  | { type: "PROCESS_WAVEFORM"; payload: { audioBuffer: Float32Array; samplesPerPixel: number } }
  | { type: "RASTERIZE_STICKER"; payload: { stickerId: string; width: number; height: number } }
  | { type: "DISPOSE" };
```

### 5.2 Compute Quotas & Denial-of-Service Defense
Corrupted or hostile media files (e.g. a 10-hour audio file decoded into 10 GB of PCM, or a deeply nested recursive Lottie sticker) can starve the worker thread and exhaust browser memory.

- **Allocation Limits**: Enforce maximum sample limits for waveform processing (`MAX_WAVEFORM_SAMPLES = 48000 * 3600`).
- **Complexity Limits**: Bound the maximum recursion depth or node count for sticker / text templates (`MAX_EFFECT_STACK_NODES = 32`).
- **Payload Caps**: Limit remote JSON payload sizes before parsing (`MAX_FILTER_PAYLOAD_BYTES = 1024 * 1024`).

### 5.3 Explicit Lifecycle Termination
Workers holding large allocated typed arrays or WebAssembly instances must be explicitly disposed of:
- When the parent component unmounts, post `{ type: "DISPOSE" }`.
- If a worker becomes unresponsive or exceeds a timeout budget, forcefully invoke `worker.terminate()`.

---

## 6. Tier 3: Rust Native Core & Tauri Host Security

### 6.1 Path Traversal Elimination & Path Sanitization
The Rust native core has full OS filesystem privileges. Any path passed from the frontend to a Tauri command must be treated as **untrusted input**.

**Canonical Sanitization Function (`src-tauri/src/commands/security.rs`)**:
```rust
pub fn sanitize_and_validate_path(raw_path: &str) -> Result<PathBuf, String> {
    if raw_path.contains('\0') {
        return Err("Security Violation: Path contains null bytes".into());
    }
    if raw_path.chars().any(|c| c.is_control()) {
        return Err("Security Violation: Path contains illegal control characters".into());
    }
    let lower = raw_path.to_lowercase();
    if lower.starts_with("javascript:") || lower.starts_with("data:") || lower.starts_with("vbscript:") {
        return Err("Security Violation: Disallowed URI protocol scheme".into());
    }
    let normalized = raw_path.replace('\\', "/");
    let path = Path::new(&normalized);
    for component in path.components() {
        if component == Component::ParentDir || component.as_os_str() == ".." {
            return Err("Security Violation: Path traversal '..' detected".into());
        }
    }
    Ok(path.to_path_buf())
}
```

### 6.2 Project & Asset Identifier Validation
Project IDs, cache keys, and asset hashes must be strictly validated before constructing filesystem paths:
- Only alphanumeric characters, hyphens, and underscores are permitted (`[a-zA-Z0-9_-]`).
- Explicitly reject `/`, `\`, `..`, null bytes, and control characters.
- Enforce length limits (e.g. 128 characters max).

```rust
pub fn validate_project_id(raw_id: &str) -> Result<String, String> {
    let trimmed = raw_id.trim();
    if trimmed.is_empty() {
        return Err("Security Violation: Project ID cannot be empty".into());
    }
    if trimmed.len() > 128 {
        return Err("Security Violation: Project ID exceeds maximum length (128)".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("Security Violation: Project ID contains illegal path traversal characters".into());
    }
    if !trimmed.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Security Violation: Project ID contains illegal non-alphanumeric characters".into());
    }
    Ok(trimmed.to_string())
}
```

### 6.3 Shell & Subprocess Injection Defense
When invoking external binaries (FFmpeg sidecar, hardware encoders):
1. **Never construct shell strings**: Never pass user input to a shell command (`sh -c` or `cmd.exe /c`).
2. **Discrete Argument Slices**: Always pass arguments as discrete array slices (`std::process::Command::new(binary).args(&[...])`).
3. **Token Sanitization**: Validate each argument using `sanitize_shell_arg` to reject injection tokens:
   - Reject `;`, `|`, `&`, `` ` ``, `$`, `<`, `>`, `\n`, `\r`.

### 6.4 Atomic I/O & Corrupted File Quarantine
To prevent file truncation, write races, and corrupted cache reads:
- Write to a unique temporary file (`.tmp.<uuid>`).
- Flush and sync to disk.
- Atomically rename the temporary file to the final destination path (`atomic_write_file`).
- If an on-disk cache file is 0 bytes or fails verification, safely isolate or delete it using `validate_or_quarantine()`.

### 6.5 Privacy & Diagnostic Log Redaction (Architecture Invariant 14)
Local editor sessions accumulate NDJSON logs in `perf_logs/`.
- **Absolute Paths**: Redact user home paths (e.g. `/Users/johndoe/Projects/video.mp4` $\rightarrow$ `<USER_HOME>/Projects/video.mp4`).
- **Machine Identifiers**: Hash or redact MAC addresses, UUIDs, and network hostnames.
- **Credentials & Tokens**: Strip any API keys, auth tokens, or query parameters before logging.

---

## 7. Cross-Tier Boundary: Tauri v2 Capabilities & Least Privilege

### 7.1 Least-Privilege Capability Manifests
Tauri v2 uses an explicit permission-set model.
- **Rules**:
  - Never add broad wildcards (`"core:default"`, `"fs:allow-all"`, `"shell:allow-all"`) to `src-tauri/capabilities/`.
  - Explicitly restrict filesystem access to `<AppCache>` and `<AppData>` directories.
  - Require native OS file dialogs for any user file read/write outside application directories.
  - Keep security settings restrictive across all platforms (consult `docs/engineering/platform-compatibility.md`).

### 7.2 Panic-Free IPC Error Handling
Never call `.unwrap()` or `.expect()` in Tauri command handlers. An unhandled panic crashes the entire desktop process.
- Return `Result<T, String>`.
- Format security rejections clearly: `"Security Violation: <detailed reason>"`.
- Allow the frontend to catch the rejection, display an accessible error toast, and maintain timeline session integrity.

---

## 8. Security Verification & Testing Checklist

Every code change touching cross-tier boundaries must verify the following:

### Mandatory Security Negative Tests
1. **Path Traversal Negative Tests**:
   - Verify rejection of `../`, `..\\`, `....//`, `C:\Windows\..\System32`, `/var/storage/../../root`.
2. **Null Byte & Control Character Tests**:
   - Verify rejection of `file.mp4\0.exe`, `\n`, `\r`, `\t` in paths and IDs.
3. **Malicious URI Scheme Tests**:
   - Verify rejection of `javascript:alert(1)`, `data:text/html,...`, `vbscript:...`.
4. **Prototype Pollution Tests**:
   - Verify rejection of `{"__proto__": {"polluted": true}}` and `constructor.prototype`.
5. **Command Injection Negative Tests**:
   - Verify rejection of `test; rm -rf /`, `test | cat /etc/passwd`, `test & echo pwned`.
6. **Property-Based Fuzzing**:
   - Use `proptest` (see `src-tauri/src/commands/ipc_security_tests.rs`) to test string boundaries with randomized unicode, control sequences, and extreme lengths.

### Quality Gate Verification
Before declaring a security-sensitive task complete:
```bash
# 1. Rust backend security unit & proptest suites
cargo test --manifest-path src-tauri/Cargo.toml ipc_security_tests

# 2. Frontend security & validation unit tests
npx vitest run src/features/filters/__tests__/filterValidation.test.ts

# 3. TypeScript contract & type integrity
npx tsc --noEmit

# 4. Unified architecture check
npm run verify:architecture
```
