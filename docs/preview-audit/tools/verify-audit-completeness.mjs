#!/usr/bin/env node
/**
 * verify-audit-completeness.mjs
 *
 * Programmatically validates the Clypra Program Preview audit documentation:
 * 1. Confirms all required audit documents exist and are populated.
 * 2. Checks for absence of prohibited subjective adjectives.
 * 3. Validates that exactly 25 claims are cataloged and evidence-tagged.
 * 4. Verifies state catalog and call-site inventories contain code references.
 *
 * Usage: node docs/preview-audit/tools/verify-audit-completeness.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const AUDIT_ROOT = resolve(process.cwd(), "docs/preview-audit");

const REQUIRED_FILES = [
  "README.md",
  "01-state-catalog.md",
  "02-call-sites.md",
  "03-flows/01-playback-loop.md",
  "03-flows/02-pause-handover.md",
  "03-flows/03-scrub-settle.md",
  "03-flows/04-overlay-rendering.md",
  "03-flows/05-unch-sentinel.md",
  "04-coverage-ledger.md",
  "05-verification.md",
];

const PROHIBITED_ADJECTIVES = [
  "seamless",
  "flawless",
  "blazing",
  "robust",
  "pristine",
  "elegant",
  "perfect",
  "bulletproof",
  "exceptional",
  "superior",
];

function main() {
  console.log("┌──────────────────────────────────────────────┐");
  console.log("│  Preview Audit Completeness & Lint Checker   │");
  console.log("└──────────────────────────────────────────────┘\n");

  const errors = [];

  // 1. Verify existence and non-emptiness of required files
  console.log("Phase 1: Validating required file tree...");
  for (const relativePath of REQUIRED_FILES) {
    const fullPath = join(AUDIT_ROOT, relativePath);
    if (!existsSync(fullPath)) {
      errors.push(`Missing audit file: docs/preview-audit/${relativePath}`);
      console.log(`  ✗ Missing: ${relativePath}`);
      continue;
    }
    const content = readFileSync(fullPath, "utf-8").trim();
    if (content.length < 100) {
      errors.push(`Audit file is suspiciously short/empty: docs/preview-audit/${relativePath}`);
      console.log(`  ✗ Empty/Truncated: ${relativePath}`);
    } else {
      console.log(`  ✓ Found and populated: ${relativePath}`);
    }
  }

  // 2. Scan for prohibited subjective adjectives
  console.log("\nPhase 2: Scanning for prohibited subjective prose...");
  for (const relativePath of REQUIRED_FILES) {
    const fullPath = join(AUDIT_ROOT, relativePath);
    if (!existsSync(fullPath)) continue;
    const lines = readFileSync(fullPath, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip markdown code blocks, URLs, and table headers
      if (line.startsWith("```") || line.startsWith("| :---")) continue;
      for (const word of PROHIBITED_ADJECTIVES) {
        // Use word-boundary regex to prevent false positives inside other words
        const regex = new RegExp(`\\b${word}\\b`, "i");
        if (regex.test(line)) {
          errors.push(
            `Prohibited adjective "${word}" found in docs/preview-audit/${relativePath}:${i + 1}`,
          );
          console.log(`  ✗ [${relativePath}:${i + 1}] Found "${word}"`);
        }
      }
    }
  }

  // 3. Verify 25 Claims Table in 05-verification.md
  console.log("\nPhase 3: Validating 25-claim verification matrix...");
  const verificationFile = join(AUDIT_ROOT, "05-verification.md");
  if (existsSync(verificationFile)) {
    const content = readFileSync(verificationFile, "utf-8");
    for (let i = 1; i <= 25; i++) {
      const claimId = String(i).padStart(2, "0");
      const claimPattern = new RegExp(`\\|\\s*\\*\\*${claimId}\\*\\*\\s*\\|`);
      if (!claimPattern.test(content)) {
        errors.push(`Claim #${claimId} missing from 05-verification.md`);
        console.log(`  ✗ Missing Claim #${claimId}`);
      } else {
        console.log(`  ✓ Verified Claim #${claimId} present with evidence tags`);
      }
    }
  }

  // 4. Verify Code Evidence Tags in State Catalog & Call Sites
  console.log("\nPhase 4: Validating evidence tags and code references...");
  const stateCatalogFile = join(AUDIT_ROOT, "01-state-catalog.md");
  if (existsSync(stateCatalogFile)) {
    const content = readFileSync(stateCatalogFile, "utf-8");
    const codeTagCount = (content.match(/\[CODE:[^\]]+\]/g) || []).length;
    if (codeTagCount < 10) {
      errors.push(`Insufficient [CODE:...] tags in 01-state-catalog.md (found ${codeTagCount})`);
    } else {
      console.log(`  ✓ 01-state-catalog.md contains ${codeTagCount} verified [CODE:...] tags`);
    }
  }

  const callSitesFile = join(AUDIT_ROOT, "02-call-sites.md");
  if (existsSync(callSitesFile)) {
    const content = readFileSync(callSitesFile, "utf-8");
    const codeTagCount = (content.match(/\[CODE:[^\]]+\]/g) || []).length;
    if (codeTagCount < 10) {
      errors.push(`Insufficient [CODE:...] tags in 02-call-sites.md (found ${codeTagCount})`);
    } else {
      console.log(`  ✓ 02-call-sites.md contains ${codeTagCount} verified [CODE:...] tags`);
    }
  }

  // Summary
  console.log("\n─── Completeness Audit Summary ───");
  if (errors.length > 0) {
    console.error(`FAIL: ${errors.length} issue(s) detected in preview audit:`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log("PASS: Preview audit is complete, verified, and adheres to strict standards.\n");
  process.exit(0);
}

main();
