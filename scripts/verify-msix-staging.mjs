#!/usr/bin/env node
// scripts/verify-msix-staging.mjs
// Validates Microsoft Store configuration, MSIX AppxManifest template,
// and icon asset requirements for Clypra's Microsoft Store release pipeline.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toMsixVersion } from "./msix-version.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const srcTauriDir = path.join(rootDir, "src-tauri");

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    failures++;
  } else {
    console.log(`  ✅ [PASS] ${message}`);
  }
}

console.log("============================================================");
console.log(" Clypra Microsoft Store MSIX Configuration & Asset Validator");
console.log("============================================================\n");

// 1. Verify tauri.microsoftstore.conf.json
console.log("1. Validating tauri.microsoftstore.conf.json...");
const storeConfigPath = path.join(srcTauriDir, "tauri.microsoftstore.conf.json");
assert(fs.existsSync(storeConfigPath), "tauri.microsoftstore.conf.json exists");

if (fs.existsSync(storeConfigPath)) {
  try {
    const raw = fs.readFileSync(storeConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    assert(
      Array.isArray(parsed?.plugins?.updater?.endpoints) &&
        parsed.plugins.updater.endpoints.length === 0,
      "plugins.updater.endpoints is empty array (disables GitHub update checks for Store)"
    );
    assert(
      parsed?.bundle?.windows?.webviewInstallMode?.type === "offlineInstaller",
      "bundle.windows.webviewInstallMode is configured to 'offlineInstaller'"
    );
  } catch (err) {
    assert(false, `Failed to parse tauri.microsoftstore.conf.json: ${err.message}`);
  }
}

// 2. Verify AppxManifest.xml template
console.log("\n2. Validating AppxManifest.xml template...");
const manifestPath = path.join(srcTauriDir, "msix", "AppxManifest.xml");
assert(fs.existsSync(manifestPath), "AppxManifest.xml template exists");

if (fs.existsSync(manifestPath)) {
  const content = fs.readFileSync(manifestPath, "utf8");
  assert(content.includes("__VERSION__"), "Contains __VERSION__ placeholder");
  assert(content.includes("__PACKAGE_NAME__"), "Contains __PACKAGE_NAME__ placeholder");
  assert(content.includes("__PUBLISHER_ID__"), "Contains __PUBLISHER_ID__ placeholder");
  assert(content.includes("__PUBLISHER_DISPLAY_NAME__"), "Contains __PUBLISHER_DISPLAY_NAME__ placeholder");
  assert(content.includes('EntryPoint="Windows.FullTrustApplication"'), "Configured with Windows.FullTrustApplication EntryPoint");
  assert(content.includes('<rescap:Capability Name="runFullTrust"'), "Declares runFullTrust capability");
}

// 3. Verify Store Icon Assets
console.log("\n3. Validating required Store icon assets in src-tauri/icons/...");
const iconsDir = path.join(srcTauriDir, "icons");
const requiredIcons = [
  "StoreLogo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square150x150Logo.png",
  "Square310x310Logo.png",
];

for (const icon of requiredIcons) {
  const fullPath = path.join(iconsDir, icon);
  assert(fs.existsSync(fullPath), `Icon asset exists: ${icon}`);
}

// 4. Test Staging Layout Generation
console.log("\n4. Testing Mock MSIX Staging Layout Generation...");
const tempStageDir = path.join(rootDir, "dist", ".test-msix-staging");
try {
  if (fs.existsSync(tempStageDir)) {
    fs.rmSync(tempStageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(tempStageDir, "Assets"), { recursive: true });
  fs.mkdirSync(path.join(tempStageDir, "bin"), { recursive: true });

  // Test version transformation
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const rawVer = pkg.version;
  let quadVer = "";
  try {
    quadVer = toMsixVersion(rawVer);
    assert(true, `Version formatted to quad-part MSIX version: ${quadVer}`);
  } catch (err) {
    assert(false, err.message);
  }

  // Test manifest rendering
  let renderedManifest = fs.readFileSync(manifestPath, "utf8");
  renderedManifest = renderedManifest
    .replace("__VERSION__", quadVer)
    .replace("__PACKAGE_NAME__", "AIEraDev.Clypra")
    .replace("__PUBLISHER_ID__", "CN=TEST-PUBLISHER-ID")
    .replace("__PUBLISHER_DISPLAY_NAME__", "AIEraDev");

  fs.writeFileSync(path.join(tempStageDir, "AppxManifest.xml"), renderedManifest, "utf8");
  assert(fs.existsSync(path.join(tempStageDir, "AppxManifest.xml")), "Generated test AppxManifest.xml in staging dir");

  // Copy icons to test staging
  for (const icon of requiredIcons) {
    fs.copyFileSync(path.join(iconsDir, icon), path.join(tempStageDir, "Assets", icon));
  }
  assert(
    fs.readdirSync(path.join(tempStageDir, "Assets")).length === requiredIcons.length,
    `Staged ${requiredIcons.length} icon assets in Assets/`
  );

  // Clean up test dir
  fs.rmSync(tempStageDir, { recursive: true, force: true });
  assert(!fs.existsSync(tempStageDir), "Cleaned up temporary staging directory");
} catch (err) {
  assert(false, `Staging test failed: ${err.message}`);
}

console.log("\n============================================================");
if (failures === 0) {
  console.log(" All Microsoft Store MSIX validation checks passed! 🎉");
  console.log("============================================================\n");
  process.exit(0);
} else {
  console.error(` ${failures} check(s) failed.`);
  console.log("============================================================\n");
  process.exit(1);
}
