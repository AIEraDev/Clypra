#!/usr/bin/env node

/**
 * R2 Audio URL Migration - Simple version
 * Migrates one file at a time
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const BUCKET = "clypra-assets";
const WRANGLER_DIR = resolve("../clypra-api");
const GITHUB_BASE = "https://raw.githubusercontent.com/AIEraDev/clypra-api/main/data/";
const CLOUDFLARE_BASE = "https://clypra-worker-api.abdulkabirmusa.com/files/";

const files = ["audio/music/333524-lekhalekha-music-school-india.json", "audio/music/heavy-urban-traffic.json", "audio/music/jumpscare-icy-chill.json", "audio/music/wii-u-song-pou-song-loop.json", "audio/music/m142-himars-rocket-launch.json"];

console.log("🚀 R2 Audio URL Migration\n");

if (!existsSync(WRANGLER_DIR)) {
  console.error("❌ clypra-api directory not found");
  process.exit(1);
}

let updated = 0;
let skipped = 0;
let failed = 0;

for (const file of files) {
  console.log(`\n📄 Processing: ${file}`);
  const localFile = `temp-${file.replace(/\//g, "-")}`;

  try {
    // Download
    console.log("  ⬇️  Downloading...");
    execSync(`cd ${WRANGLER_DIR} && npx wrangler r2 object get ${file} --bucket ${BUCKET} --file ${resolve(localFile)}`, { stdio: "pipe" });

    if (!existsSync(localFile)) {
      console.log("  ⚠️  File not found in R2, skipping");
      failed++;
      continue;
    }

    // Read and migrate
    const content = readFileSync(localFile, "utf8");

    if (!content.includes("raw.githubusercontent.com")) {
      console.log("  ✅ Already migrated");
      skipped++;
      execSync(`rm -f ${localFile}`);
      continue;
    }

    const migrated = content.replace(new RegExp(GITHUB_BASE, "g"), CLOUDFLARE_BASE);
    writeFileSync(localFile, migrated, "utf8");

    // Upload
    console.log("  ⬆️  Uploading...");
    execSync(`cd ${WRANGLER_DIR} && npx wrangler r2 object put ${file} --bucket ${BUCKET} --file ${resolve(localFile)}`, { stdio: "pipe" });

    console.log("  ✅ Updated successfully");
    updated++;

    // Cleanup
    execSync(`rm -f ${localFile}`);
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    failed++;
    execSync(`rm -f ${localFile}`, { stdio: "ignore" });
  }
}

console.log("\n📊 Summary:");
console.log(`  ✅ Updated: ${updated}`);
console.log(`  ⏭️  Skipped: ${skipped}`);
console.log(`  ❌ Failed: ${failed}`);
console.log("\n✨ Done!\n");
