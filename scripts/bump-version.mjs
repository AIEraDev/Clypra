#!/usr/bin/env node

/**
 * Clypra Canonical Version Synchronization Utility
 *
 * Keeps all version references in perfect sync across the workspace:
 * - package.json & package-lock.json (via npm version --no-git-tag-version)
 * - src-tauri/Cargo.toml
 * - src-tauri/tauri.conf.json
 * - AGENTS.md
 * - .agents/skills/clypra-dev/SKILL.md
 * - .kiro/skills/clypra-dev/SKILL.md (via npm run skills:sync)
 * - src-tauri/Cargo.lock (via cargo check)
 *
 * Usage:
 *   node scripts/bump-version.mjs <new-version>
 *   npm run version:sync [optional-new-version]
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

const targetVersion = process.argv[2];

if (!targetVersion) {
  // If no version argument passed, read current version from package.json and sync everywhere
  const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
  console.log(`Syncing all manifests to match package.json version: ${pkg.version}`);
  syncAll(pkg.version);
} else {
  // Validate semver
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(targetVersion)) {
    console.error(`Invalid semver version: ${targetVersion}`);
    process.exit(1);
  }
  console.log(`Bumping all Clypra manifests to version: ${targetVersion}`);
  
  // 1. Update package.json and package-lock.json
  execSync(`npm version ${targetVersion} --no-git-tag-version`, { cwd: rootDir, stdio: "inherit" });
  
  syncAll(targetVersion);
}

function syncAll(version) {
  // 2. Update src-tauri/Cargo.toml
  const cargoTomlPath = resolve(rootDir, "src-tauri/Cargo.toml");
  let cargoToml = readFileSync(cargoTomlPath, "utf8");
  cargoToml = cargoToml.replace(
    /^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`
  );
  writeFileSync(cargoTomlPath, cargoToml, "utf8");
  console.log(`✓ Updated src-tauri/Cargo.toml -> ${version}`);

  // 3. Update src-tauri/tauri.conf.json
  const tauriConfPath = resolve(rootDir, "src-tauri/tauri.conf.json");
  const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
  tauriConf.version = version;
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n", "utf8");
  console.log(`✓ Updated src-tauri/tauri.conf.json -> ${version}`);

  // 4. Update AGENTS.md
  const agentsMdPath = resolve(rootDir, "AGENTS.md");
  let agentsMd = readFileSync(agentsMdPath, "utf8");
  agentsMd = agentsMd.replace(
    /Clypra is a high-performance native desktop video editor \(`v[^`]+`\)/,
    `Clypra is a high-performance native desktop video editor (\`v${version}\`)`
  );
  writeFileSync(agentsMdPath, agentsMd, "utf8");
  console.log(`✓ Updated AGENTS.md -> v${version}`);

  // 5. Update .agents/skills/clypra-dev/SKILL.md
  const skillMdPath = resolve(rootDir, ".agents/skills/clypra-dev/SKILL.md");
  let skillMd = readFileSync(skillMdPath, "utf8");
  skillMd = skillMd.replace(
    /Clypra is a \*\*native desktop video editor\*\* \(v[^\)]+\)/,
    `Clypra is a **native desktop video editor** (v${version})`
  );
  writeFileSync(skillMdPath, skillMd, "utf8");
  console.log(`✓ Updated .agents/skills/clypra-dev/SKILL.md -> v${version}`);

  // 6. Sync Kiro skills
  try {
    execSync("node scripts/sync-kiro-skills.mjs", { cwd: rootDir, stdio: "pipe" });
    console.log(`✓ Synchronized Kiro skills`);
  } catch (err) {
    console.warn(`Warning: failed to sync Kiro skills: ${err.message}`);
  }

  // 7. Update Cargo.lock
  try {
    console.log(`Checking src-tauri Cargo lockfile...`);
    execSync("cargo check --manifest-path src-tauri/Cargo.toml", { cwd: rootDir, stdio: "pipe" });
    console.log(`✓ Updated src-tauri/Cargo.lock -> ${version}`);
  } catch (err) {
    console.warn(`Warning: cargo check failed: ${err.message}`);
  }

  console.log(`\n🎉 All Clypra manifests and constants successfully synchronized to v${version}!`);
}
