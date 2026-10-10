import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const AGENTS_SKILLS_DIR = path.join(ROOT, ".agents", "skills");
const KIRO_SKILLS_DIR = path.join(ROOT, ".kiro", "skills");

const isCheckOnly = process.argv.includes("--check");

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function compareDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    return [`Missing destination directory: ${dest}`];
  }
  const errors = [];
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (!fs.existsSync(destPath)) {
      errors.push(`Missing destination file/dir: ${destPath}`);
      continue;
    }
    if (entry.isDirectory()) {
      errors.push(...compareDirRecursive(srcPath, destPath));
    } else {
      const srcContent = fs.readFileSync(srcPath);
      const destContent = fs.readFileSync(destPath);
      if (!srcContent.equals(destContent)) {
        errors.push(`Content mismatch: ${srcPath} !== ${destPath}`);
      }
    }
  }
  return errors;
}

if (!fs.existsSync(AGENTS_SKILLS_DIR)) {
  console.error(`Error: Source skills directory not found: ${AGENTS_SKILLS_DIR}`);
  process.exit(1);
}

if (isCheckOnly) {
  const errors = compareDirRecursive(AGENTS_SKILLS_DIR, KIRO_SKILLS_DIR);
  if (errors.length > 0) {
    console.error("❌ Kiro skills parity check FAILED. Differences found:");
    errors.forEach((err) => console.error(`  - ${err}`));
    console.error("\nRun 'node scripts/sync-kiro-skills.mjs' to synchronize.");
    process.exit(1);
  } else {
    console.log("✅ Kiro skills parity verified: .kiro/skills/ matches .agents/skills/ 100%.");
    process.exit(0);
  }
} else {
  console.log("🔄 Synchronizing .agents/skills/ -> .kiro/skills/...");
  if (!fs.existsSync(KIRO_SKILLS_DIR)) {
    fs.mkdirSync(KIRO_SKILLS_DIR, { recursive: true });
  }
  copyDirRecursive(AGENTS_SKILLS_DIR, KIRO_SKILLS_DIR);
  console.log("✅ Successfully synchronized all skills to .kiro/skills/.");
}
