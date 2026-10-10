#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const catalogsDir = path.join(rootDir, "src/i18n/catalogs");

const supportedLocales = ["en", "ru", "es", "ja", "de", "fr", "ko", "zh-CN", "zh-TW"];
const canonicalLocale = "en";

console.log("🔍 Validating Clypra Internationalization Catalogs...\n");

if (!fs.existsSync(catalogsDir)) {
  console.error(`❌ Catalogs directory not found: ${catalogsDir}`);
  process.exit(1);
}

const canonicalPath = path.join(catalogsDir, `${canonicalLocale}.json`);
if (!fs.existsSync(canonicalPath)) {
  console.error(`❌ Canonical catalog missing: ${canonicalPath}`);
  process.exit(1);
}

const canonicalCatalog = JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
const canonicalKeys = Object.keys(canonicalCatalog);
console.log(`ℹ️ Canonical locale (${canonicalLocale}): ${canonicalKeys.length} semantic keys.\n`);

let hasErrors = false;

for (const locale of supportedLocales) {
  if (locale === canonicalLocale) continue;

  const catalogPath = path.join(catalogsDir, `${locale}.json`);
  if (!fs.existsSync(catalogPath)) {
    console.error(`❌ [${locale}] Missing catalog file: ${catalogPath}`);
    hasErrors = true;
    continue;
  }

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch (err) {
    console.error(`❌ [${locale}] Malformed JSON: ${err.message}`);
    hasErrors = true;
    continue;
  }

  const keys = Object.keys(catalog);
  const missingKeys = canonicalKeys.filter((k) => !(k in catalog));
  const unexpectedKeys = keys.filter((k) => !(k in canonicalCatalog));

  // Extract interpolation variables from string: {{var}}
  const getPlaceholders = (str) => {
    const matches = str.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];
    return matches.sort().join(",");
  };

  const interpolationMismatches = [];
  for (const k of canonicalKeys) {
    if (k in catalog) {
      const srcPh = getPlaceholders(canonicalCatalog[k]);
      const trPh = getPlaceholders(catalog[k]);
      if (srcPh !== trPh) {
        interpolationMismatches.push({ key: k, source: srcPh, target: trPh });
      }
    }
  }

  if (missingKeys.length > 0) {
    console.error(`❌ [${locale}] Missing ${missingKeys.length} keys:`);
    console.error(`   Sample: ${missingKeys.slice(0, 5).join(", ")}`);
    hasErrors = true;
  } else if (interpolationMismatches.length > 0) {
    console.error(`❌ [${locale}] Interpolation placeholder mismatch in ${interpolationMismatches.length} keys:`);
    console.error(`   Sample: ${interpolationMismatches[0].key} (source: ${interpolationMismatches[0].source}, target: ${interpolationMismatches[0].target})`);
    hasErrors = true;
  } else {
    // Note: ru has special plural forms _few, _many which are legitimate CLDR additions
    const validUnexpected = locale === "ru" ? unexpectedKeys.filter(k => !k.endsWith("_few") && !k.endsWith("_many")) : unexpectedKeys;
    if (validUnexpected.length > 0) {
      console.warn(`⚠️ [${locale}] Has ${validUnexpected.length} unexpected keys not in canonical catalog.`);
    }
    console.log(`✅ [${locale}] Catalog valid (${keys.length} keys, 100% canonical key parity, placeholders match).`);
  }
}

console.log("\n--------------------------------------------------");
if (hasErrors) {
  console.error("❌ Internationalization Catalog Validation FAILED.");
  process.exit(1);
} else {
  console.log("✅ All Clypra Internationalization Catalogs VALIDATED successfully.");
  process.exit(0);
}
