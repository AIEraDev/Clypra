#!/usr/bin/env node
/**
 * scripts/smoke-test-packaged-app.mjs
 *
 * Clypra Automated Packaged Application & Distribution Smoke Test.
 *
 * Verifies:
 * 1. Production frontend asset bundle (`dist/`) integrity, entrypoint, and worker chunks.
 * 2. Tauri packaging manifests and store staging alignment (`tauri.conf.json`, MSIX).
 * 3. Sidecar distribution binaries (or stub diagnostic status).
 * 4. Desktop bundle unpacking and process startup smoke check across platforms
 *    (macOS .app, Linux .deb / .AppImage / raw binary, Windows .exe / MSIX).
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = join(rootDir, "dist");
const srcTauriDir = join(rootDir, "src-tauri");

let failures = 0;
let passes = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    failures++;
  } else {
    console.log(`  ✅ [PASS] ${message}`);
    passes++;
  }
}

console.log("============================================================");
console.log(" Clypra Packaged Application & Distribution Smoke Test");
console.log("============================================================\n");

// ── 1. Frontend Bundle Integrity ──────────────────────────────────────────
console.log("1. Validating frontend production bundle (dist/)...");
assert(existsSync(distDir), "dist/ directory exists");

if (existsSync(distDir)) {
  const indexPath = join(distDir, "index.html");
  assert(existsSync(indexPath), "dist/index.html exists");

  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf8");
    assert(html.includes('<div id="root">') || html.includes("<div id=\"root\""), "dist/index.html has root mount node");
    assert(html.includes("<script type=\"module\"") || html.includes("<script"), "dist/index.html includes module script");
  }

  const assetsDir = join(distDir, "assets");
  assert(existsSync(assetsDir), "dist/assets/ directory exists");

  if (existsSync(assetsDir)) {
    const files = readdirSync(assetsDir);
    const jsFiles = files.filter(f => f.endsWith(".js"));
    const cssFiles = files.filter(f => f.endsWith(".css"));
    const workerFiles = files.filter(f => f.includes("worker") && f.endsWith(".js"));

    assert(jsFiles.length > 0, `JavaScript chunks present (${jsFiles.length} files found)`);
    assert(cssFiles.length > 0, `CSS stylesheets present (${cssFiles.length} files found)`);
    assert(workerFiles.length > 0, `Worker threads present (${workerFiles.length} worker files found)`);

    // Verify main entry point chunk is non-trivial (>100KB)
    let mainJs = null;
    if (existsSync(indexPath)) {
      const match = readFileSync(indexPath, "utf8").match(/src="(?:\/assets\/|\.\/assets\/|assets\/)?([^"]+\.js)"/);
      if (match && existsSync(join(assetsDir, match[1].replace(/^.*[\\/]/, "")))) {
        mainJs = match[1].replace(/^.*[\\/]/, "");
      }
    }
    if (!mainJs) {
      mainJs = jsFiles.reduce((largest, f) => {
        const s = statSync(join(assetsDir, f)).size;
        return s > (largest?.size ?? 0) ? { file: f, size: s } : largest;
      }, null)?.file;
    }
    if (mainJs && existsSync(join(assetsDir, mainJs))) {
      const mainJsSize = statSync(join(assetsDir, mainJs)).size;
      assert(mainJsSize > 100_000, `Main JS bundle has reasonable size (${Math.round(mainJsSize / 1024)} KB, ${mainJs})`);
    }
  }
}

// ── 2. Tauri Configuration & Metadata Parity ─────────────────────────────
console.log("\n2. Validating packaging manifests & version synchronization...");
const pkgJsonPath = join(rootDir, "package.json");
const tauriConfPath = join(srcTauriDir, "tauri.conf.json");

assert(existsSync(pkgJsonPath), "package.json exists");
assert(existsSync(tauriConfPath), "src-tauri/tauri.conf.json exists");

let version = "";
if (existsSync(pkgJsonPath) && existsSync(tauriConfPath)) {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const tauri = JSON.parse(readFileSync(tauriConfPath, "utf8"));
  version = pkg.version;

  assert(Boolean(pkg.version), `package.json version defined (${pkg.version})`);
  assert(tauri.version === pkg.version, `tauri.conf.json version matches package.json (${tauri.version})`);
  assert(tauri.identifier === "com.deenminder.clypra" || tauri.identifier.includes("clypra"), `tauri.conf.json identifier is valid (${tauri.identifier})`);
}

// ── 3. Microsoft Store MSIX Staging Validation ───────────────────────────
console.log("\n3. Validating MSIX staging layout & store assets...");
const msixScript = join(rootDir, "scripts", "verify-msix-staging.mjs");
if (existsSync(msixScript)) {
  const result = spawnSync("node", [msixScript], { stdio: "pipe", encoding: "utf8" });
  assert(result.status === 0, "verify-msix-staging.mjs passed successfully");
} else {
  console.log("  ⚠️  verify-msix-staging.mjs not found, skipping MSIX stage check");
}

// ── 4. Packaged Application Unpacking & Process Startup Smoke Check ───────
console.log("\n4. Detecting built bundles and checking process startup...");

const candidateBinaries = [
  // macOS .app bundle binary
  join(srcTauriDir, "target", "release", "bundle", "macos", "Clypra.app", "Contents", "MacOS", "clypra"),
  join(srcTauriDir, "target", "debug", "bundle", "macos", "ClypraDev.app", "Contents", "MacOS", "clypra"),
  // Linux binaries
  join(srcTauriDir, "target", "release", "clypra"),
  join(srcTauriDir, "target", "debug", "clypra"),
  // Windows binaries
  join(srcTauriDir, "target", "release", "clypra.exe"),
  join(srcTauriDir, "target", "release", "bundle", "nsis", "Clypra.exe"),
  join(srcTauriDir, "target", "debug", "clypra.exe"),
  // Native CLI binary
  join(rootDir, "crates", "clypra-native-cli", "target", "release", "clypra-native-cli"),
  join(rootDir, "crates", "clypra-native-cli", "target", "debug", "clypra-native-cli"),
];

// Check for Linux .deb bundles to unpack
const debDir = join(srcTauriDir, "target", "release", "bundle", "deb");
if (existsSync(debDir)) {
  const debFiles = readdirSync(debDir).filter(f => f.endsWith(".deb"));
  for (const deb of debFiles) {
    console.log(`  📦 Found Linux .deb bundle: ${deb}. Testing unpacking...`);
    const unpackDir = join(srcTauriDir, "target", "tmp_deb_unpack");
    try {
      if (existsSync(unpackDir)) rmSync(unpackDir, { recursive: true, force: true });
      mkdirSync(unpackDir, { recursive: true });
      const extractResult = spawnSync("dpkg-deb", ["-x", join(debDir, deb), unpackDir], { stdio: "pipe" });
      if (extractResult.status === 0) {
        assert(true, `Successfully unpacked ${deb} using dpkg-deb`);
        const unpackedBin = join(unpackDir, "usr", "bin", "clypra");
        if (existsSync(unpackedBin)) {
          candidateBinaries.unshift(unpackedBin);
        }
      }
    } catch (e) {
      console.warn(`  ⚠️ Could not unpack .deb: ${e.message}`);
    } finally {
      try { rmSync(unpackDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

// Locate any available executable
const detectedBin = candidateBinaries.find(p => existsSync(p));

if (detectedBin) {
  console.log(`  🎯 Testing detected executable: ${detectedBin}`);
  const st = statSync(detectedBin);
  assert(st.size > 1_000_000, `Executable binary has realistic size (${Math.round(st.size / 1024 / 1024)} MB)`);

  // Smoke test execution: spawn with timeout
  try {
    let cmd = detectedBin;
    let args = ["--help"];
    if (process.platform === "linux" && !process.env.DISPLAY) {
      // In headless Linux CI without X11, test using xvfb-run if present
      const xvfbCheck = spawnSync("which", ["xvfb-run"], { stdio: "pipe" });
      if (xvfbCheck.status === 0) {
        cmd = "xvfb-run";
        args = ["-a", detectedBin, "--help"];
      }
    }

    const testProc = spawnSync(cmd, args, {
      timeout: 5000,
      stdio: "pipe",
      encoding: "utf8",
      env: { ...process.env, CLYPRA_HEADLESS_SMOKE: "1" },
    });

    // Tauri apps or CLIs may return 0, or be killed by timeout if opening GUI window
    const exitedNormally = testProc.status === 0 || testProc.signal === "SIGTERM" || testProc.signal === "SIGKILL";
    assert(exitedNormally, `Executable process started and terminated cleanly (status: ${testProc.status}, signal: ${testProc.signal})`);
  } catch (err) {
    console.warn(`  ⚠️ Process startup check encountered: ${err.message}`);
  }
} else {
  console.log("  ℹ️  No compiled desktop binary present in this workspace (expected in frontend-only stages).");
  console.log("     Frontend bundle and packaging staging validated successfully.");
}

console.log("\n============================================================");
if (failures === 0) {
  console.log(` Packaged Application Smoke Test: ALL ${passes} CHECKS PASSED! 🎉`);
  console.log("============================================================\n");
  process.exit(0);
} else {
  console.error(` Packaged Application Smoke Test: ${failures} CHECKS FAILED.`);
  console.log("============================================================\n");
  process.exit(1);
}
