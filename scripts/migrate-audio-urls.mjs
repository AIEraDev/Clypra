#!/usr/bin/env node

/**
 * R2 Audio URL Migration Script (Node.js version)
 *
 * Updates all JSON files in R2 bucket to use Cloudflare URLs
 * instead of GitHub URLs
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

const BUCKET = "clypra-assets";
const TEMP_DIR = "./r2-migration-temp";
const GITHUB_BASE = "https://raw.githubusercontent.com/AIEraDev/clypra-api/main/data/";
const CLOUDFLARE_BASE = "https://clypra-worker-api.abdulkabirmusa.com/files/";

console.log("🚀 Starting R2 Audio URL Migration...");
console.log(`📦 Bucket: ${BUCKET}\n`);

// Check if wrangler is installed
try {
  execSync("wrangler --version", { stdio: "ignore" });
} catch (error) {
  console.error("❌ Error: wrangler is not installed");
  console.error("Install it with: npm install -g wrangler");
  process.exit(1);
}

// Create temp directory
try {
  mkdirSync(TEMP_DIR, { recursive: true });
  console.log(`📁 Created temp directory: ${TEMP_DIR}`);
} catch (error) {
  // Directory might already exist
}

// Get list of all JSON files
console.log("📋 Fetching list of JSON files from R2...");
let output;
try {
  output = execSync(`wrangler r2 object list ${BUCKET} --prefix audio/`, { encoding: "utf8" });
} catch (error) {
  console.error("❌ Failed to list R2 objects");
  console.error("Make sure you are logged in: wrangler login");
  process.exit(1);
}

// Parse JSON file paths
const lines = output.split("\n");
const jsonFiles = lines
  .filter((line) => line.includes(".json"))
  .map((line) => {
    // Extract object name from wrangler output
    const match = line.match(/^(audio\/[^\s]+\.json)/);
    return match ? match[1] : null;
  })
  .filter(Boolean);

if (jsonFiles.length === 0) {
  console.error("❌ No JSON files found in audio/ directory");
  process.exit(1);
}

console.log(`✅ Found ${jsonFiles.length} JSON files to migrate:`);
jsonFiles.forEach((file) => console.log(`  - ${file}`));
console.log("");

// Process each JSON file
let updated = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < jsonFiles.length; i++) {
  const file = jsonFiles[i];
  console.log(`[${i + 1}/${jsonFiles.length}] Processing: ${file}`);

  const localFile = join(TEMP_DIR, file.replace(/\//g, "-"));

  try {
    // Download the JSON file
    execSync(`wrangler r2 object get ${BUCKET}/${file} --file ${localFile}`, { stdio: "ignore" });

    // Read and parse JSON
    const content = readFileSync(localFile, "utf8");

    // Check if migration is needed
    if (!content.includes("raw.githubusercontent.com")) {
      console.log("  ⏭️  Already migrated, skipping...");
      skipped++;
      unlinkSync(localFile);
      continue;
    }

    // Migrate URLs
    const migrated = content.replace(new RegExp(GITHUB_BASE, "g"), CLOUDFLARE_BASE);

    // Verify it's valid JSON
    try {
      JSON.parse(migrated);
    } catch (error) {
      console.log("  ⚠️  Invalid JSON after migration, skipping...");
      failed++;
      unlinkSync(localFile);
      continue;
    }

    // Write updated content
    writeFileSync(localFile, migrated, "utf8");

    // Upload back to R2
    execSync(`wrangler r2 object put ${BUCKET}/${file} --file ${localFile}`, { stdio: "ignore" });

    console.log("  ✅ Updated and uploaded");
    updated++;

    // Clean up
    unlinkSync(localFile);
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    failed++;
  }
}

console.log("");
console.log("✨ Migration complete!");
console.log("");
console.log("📊 Summary:");
console.log(`  ✅ Updated: ${updated}`);
console.log(`  ⏭️  Skipped: ${skipped}`);
console.log(`  ❌ Failed: ${failed}`);
console.log("");

if (updated > 0) {
  console.log("🔍 Verification:");
  console.log(`  wrangler r2 object get ${BUCKET}/audio/music/333524-lekhalekha-music-school-india.json --file test.json`);
  console.log("  cat test.json | grep audioUrl");
  console.log("");
  console.log("✅ Your audio URLs are now using Cloudflare!");
}
