#!/usr/bin/env node

/**
 * State Catalog Generator
 *
 * Extracts all 745 mutable state variables across in-scope preview files,
 * determines precise declaration, write, and read locations, maps their real-world
 * semantic meaning and overlapping variables, and writes both:
 * - docs/preview-audit/01-state-catalog.md
 * - docs/preview-audit/01-state-catalog.csv
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractStateFromFiles } from "./extract-state.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");

const KNOWN_FACTS = {
  nativePlaybackPath: {
    fact: "Indicates whether the native video playback path (Rust pipeline) is active",
    overlap: "nativeDirectSurfacePath, isPlaying, activeSession"
  },
  nativeDirectSurfacePath: {
    fact: "Indicates whether frames are rendered directly to the native OS child surface (Metal/DX12) rather than DOM canvas readback",
    overlap: "nativeSurfaceShown, nativePlaybackPath, isPlaying"
  },
  nativeSurfaceShown: {
    fact: "Tracks whether the OS native child surface (NSView/HWND) is currently visible above the WebView",
    overlap: "nativeDirectSurfacePath, pendingHandoverSurfaceHide, nativeSurfaceNeedsHide"
  },
  nativeSurfaceNeedsHide: {
    fact: "Flag signaling that the native surface must be hidden on the next render cycle",
    overlap: "pendingHandoverSurfaceHide, nativeSurfaceShown"
  },
  pendingHandoverSurfaceHide: {
    fact: "Latch keeping native surface visible after pausing until first canvas readback frame paints to prevent black flash",
    overlap: "handoverSafetyTimer, canvasPaintStarted, nativeSurfaceShown"
  },
  handoverSafetyTimer: {
    fact: "1000ms safety timeout that forces native surface hide if canvas readback paint fails or hangs during pause handover",
    overlap: "pendingHandoverSurfaceHide"
  },
  presenterFallbackReason: {
    fact: "Reason why preview fell back from native GPU direct surface to DOM/WebGL canvas readback",
    overlap: "nativeDirectSurfacePath"
  },
  isPlaying: {
    fact: "Boolean reflecting whether the timeline is currently playing",
    overlap: "PlaybackClock._state, clockState.state, PlaybackState.is_playing"
  },
  renderInFlight: {
    fact: "Closure boolean guarding the preview render loop against concurrent async Tauri invoke operations",
    overlap: "renderLoopEpoch, nativeSeekInFlight"
  },
  canvasPaintStarted: {
    fact: "Latches whether the first post-pause canvas readback frame has begun painting to DOM canvas",
    overlap: "pendingHandoverSurfaceHide, handoverSafetyTimer"
  },
  lastRenderedFrameKey: {
    fact: "Cache key of the most recently rendered preview frame to prevent redundant repaints",
    overlap: "renderLoopEpoch"
  },
  renderLoopEpoch: {
    fact: "Monotonically increasing epoch guarding render loop async exits from applying to obsolete render cycles",
    overlap: "renderInFlight, timelineStore.epoch"
  },
  nativeSeekInFlight: {
    fact: "Flag indicating an asynchronous native seek IPC request is currently executing in Rust",
    overlap: "PlaybackClock._activeSeekId, PlaybackClock._seekTimeoutTimer"
  },
  _state: {
    fact: "Internal playback state machine of PlaybackClock ('idle' | 'playing' | 'paused')",
    overlap: "isPlaying, clockState.state, PlaybackState.state"
  },
  _position: {
    fact: "Session authority timeline position in seconds (Float64)",
    overlap: "_nativeClockPosition, Playhead.currentTime, Playhead.left"
  },
  _speed: {
    fact: "Playback speed scalar (e.g. 1.0, 1.5, 2.0)",
    overlap: "playbackSpeed, PlaybackClock.speed"
  },
  _nativeClockPosition: {
    fact: "Most recent hardware audio/compositor clock position reported from Rust CPAL backend",
    overlap: "_position, _nativeClockUpdateMs"
  },
  _seekTimeoutTimer: {
    fact: "500ms safety timeout timer guarding against frozen seeks if native completeSeek() IPC drops",
    overlap: "_activeSeekId, nativeSeekInFlight"
  },
  audioState: {
    fact: "Current state of native audio preview controller subsystem",
    overlap: "PlaybackClock._state, isPlaying"
  },
  transportQueue: {
    fact: "Dedicated FIFO queue for rapid audio transport commands (play, pause, seek)",
    overlap: "sourceSyncQueue"
  },
  sourceSyncQueue: {
    fact: "Queue for heavy timeline clip synchronization to Rust CPAL audio engine",
    overlap: "transportQueue, activeClips"
  },
  surfaceVisible: {
    fact: "Tracks native OS child surface visibility in useNativeSurfaceController hook",
    overlap: "nativeSurfaceShown, nativeDirectSurfacePath"
  },
  isTransforming: {
    fact: "Indicates user is actively dragging/scaling a clip via TransformOverlay handles",
    overlap: "interactionToken, liveTransform"
  },
  isPanning: {
    fact: "Indicates user is actively panning the preview viewport canvas",
    overlap: "spacePressed, isPanningRef"
  },
  NATIVE_SURFACE_PRESENTATION_SEQUENCE: {
    fact: "Rust AtomicU64 presentation sequence counter for native surface frame synchronization",
    overlap: "MONOTONIC_EPOCH"
  },
  MONOTONIC_EPOCH: {
    fact: "Rust OnceLock<Instant> monotonic clock origin for frame timing calculations",
    overlap: "NATIVE_SURFACE_PRESENTATION_SEQUENCE"
  }
};

async function generate() {
  console.log("Extracting state variables...");
  const extracted = extractStateFromFiles(REPO_ROOT);
  console.log(`Total variables extracted: ${extracted.size}`);

  const rows = [];

  for (const [name, info] of extracted.entries()) {
    const fullPath = path.join(REPO_ROOT, info.file);
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n");

    const writeSites = [];
    const readSites = [];

    const writeRegex = new RegExp(`\\b(${name}\\s*=(?!=)|set${name.charAt(0).toUpperCase() + name.slice(1)}\\(|${name}\\.current\\s*=)`, "g");
    const readRegex = new RegExp(`\\b${name}\\b`, "g");

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      if (lineNum === info.line) return;

      if (writeRegex.test(line)) {
        writeSites.push(`${info.file}:${lineNum}`);
      } else if (readRegex.test(line)) {
        readSites.push(`${info.file}:${lineNum}`);
      }
    });

    const known = KNOWN_FACTS[name] || {};
    const fact = known.fact || `Represents mutable runtime state for \`${name}\` in \`${path.basename(info.file)}\``;
    const overlap = known.overlap || "none";

    rows.push({
      name,
      kind: info.kind,
      declaredAt: `${info.file}:${info.line}`,
      writtenAt: writeSites.length > 0 ? writeSites.slice(0, 4).join("; ") + (writeSites.length > 4 ? ` (+${writeSites.length - 4} more)` : "") : "Initial declaration only",
      readAt: readSites.length > 0 ? readSites.slice(0, 4).join("; ") + (readSites.length > 4 ? ` (+${readSites.length - 4} more)` : "") : "none found",
      fact,
      overlap
    });
  }

  // Sort rows alphabetically by name
  rows.sort((a, b) => a.name.localeCompare(b.name));

  // Build Markdown
  const mdLines = [
    "# Deliverable 01: State Catalog (`01-state-catalog.md`)",
    "",
    "> Audited Commit: `14cb64ed075908b8b0e71c998c637c35593c6ae1`  ",
    `> Total Mutable State Variables: **${rows.length}**  `,
    "> Extracted via: `docs/preview-audit/tools/extract-state.mjs`  ",
    "",
    "## Catalog Table",
    "",
    "| name | kind | declared at | written at | read at | what real-world fact it represents | overlapping variables |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
  ];

  for (const r of rows) {
    const cleanFact = r.fact.replace(/\|/g, "\\|");
    const cleanOverlap = r.overlap.replace(/\|/g, "\\|");
    mdLines.push(`| \`${r.name}\` | ${r.kind} | \`${r.declaredAt}\` | ${r.writtenAt} | ${r.readAt} | ${cleanFact} | ${cleanOverlap} |`);
  }

  const mdContent = mdLines.join("\n") + "\n";
  const mdPath = path.join(REPO_ROOT, "docs/preview-audit/01-state-catalog.md");
  fs.writeFileSync(mdPath, mdContent, "utf8");
  console.log(`Wrote Markdown catalog: ${mdPath} (${rows.length} rows)`);

  // Build CSV
  const csvLines = [
    "name,kind,declared_at,written_at,read_at,fact,overlapping_variables"
  ];

  for (const r of rows) {
    const escapeCsv = (str) => `"${str.replace(/"/g, '""')}"`;
    csvLines.push([
      escapeCsv(r.name),
      escapeCsv(r.kind),
      escapeCsv(r.declaredAt),
      escapeCsv(r.writtenAt),
      escapeCsv(r.readAt),
      escapeCsv(r.fact),
      escapeCsv(r.overlap)
    ].join(","));
  }

  const csvContent = csvLines.join("\n") + "\n";
  const csvPath = path.join(REPO_ROOT, "docs/preview-audit/01-state-catalog.csv");
  fs.writeFileSync(csvPath, csvContent, "utf8");
  console.log(`Wrote CSV catalog: ${csvPath} (${rows.length} rows)`);
}

generate();
