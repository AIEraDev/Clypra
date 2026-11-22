#!/usr/bin/env node

/**
 * Guard the hand-authored JSON Schema against the Rust session-header types.
 * This is intentionally small and deterministic until schemars generation is
 * introduced; it prevents adding a required provenance field to Rust without
 * updating the schema consumed by the offline analyzer and API.
 */

import { readFile } from "node:fs/promises";

const schemaPath = new URL("./perf-v2.schema.json", import.meta.url);
const rustPath = new URL("../../src-tauri/src/diagnostics/perf_log.rs", import.meta.url);

const headerFields = [
  "schemaVersion",
  "sessionId",
  "openedAtEpochMs",
  "build",
  "system",
  "resolvedFlags",
  "decodePolicy",
  "decodePolicySource",
  "decodePolicyEffective",
  "decodePolicyRejectionReason",
  "unverifiedCapabilityOverride",
  "unverifiedCapabilitiesVerified",
  "ffmpegCallbackVerified",
  "mediaHash",
  "projectHash",
  "scenarioId",
  "scenarioHash",
  "experimentArm",
  "validationMode",
];

const buildFields = [
  "applicationVersion",
  "gitCommit",
  "gitDirty",
  "gitTree",
  "gitDiffHash",
  "optLevel",
  "debugAssertions",
  "ffmpegVersion",
  "instrumentationPatchHash",
  "perfDriverEnabled",
  "binaryHash",
];

function snakeCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function assertRustFields(source, fields, typeName) {
  const start = source.indexOf(`pub struct ${typeName}`);
  if (start < 0) throw new Error(`Rust type ${typeName} not found`);
  const end = source.indexOf("}\n", start);
  const body = source.slice(start, end < 0 ? source.length : end);
  for (const field of fields) {
    if (!new RegExp(`\\bpub ${snakeCase(field)}\\s*:`).test(body)) {
      throw new Error(`Rust ${typeName} is missing field ${field}`);
    }
  }
}

function assertSchemaRequired(schema, fields, label) {
  const required = new Set(schema.allOf?.[0]?.then?.properties?.payload?.required ?? []);
  for (const field of fields) {
    if (field === "scenarioId" || field === "scenarioHash" || field === "experimentArm") continue;
    if (!required.has(field)) throw new Error(`schema session-header payload is missing required ${field}`);
  }
  const buildRequired = new Set(
    schema.allOf?.[0]?.then?.properties?.payload?.properties?.build?.required ?? [],
  );
  for (const field of ["gitDirty", "optLevel", "debugAssertions", "ffmpegVersion", "perfDriverEnabled", "binaryHash"]) {
    if (!buildRequired.has(field)) throw new Error(`schema build is missing required ${field}`);
  }
  if (label !== "session-header") throw new Error(`unexpected schema label ${label}`);
}

const [schemaSource, rustSource] = await Promise.all([
  readFile(schemaPath, "utf8"),
  readFile(rustPath, "utf8"),
]);
const schema = JSON.parse(schemaSource);
assertRustFields(rustSource, headerFields, "PerfSessionHeader");
assertRustFields(rustSource, buildFields, "PerfBuildIdentity");
assertSchemaRequired(schema, headerFields, "session-header");
console.log("perf-v2 schema is synchronized with Rust provenance fields");
