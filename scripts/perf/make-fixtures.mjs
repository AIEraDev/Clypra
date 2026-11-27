#!/usr/bin/env node

/**
 * Deterministic Performance Test Fixture & Manifest Generator.
 *
 * Generates synthetic media using ffmpeg (testsrc2, sine beeps, corner-marked images)
 * and produces normalized, deterministic project JSON files across all workload tiers.
 * Creates and verifies scripts/perf/fixtures/manifest.json.
 */

import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const MANIFEST_SCHEMA_VERSION = 1;

export async function hashFile(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function computeObjectHash(obj) {
  const canonical = JSON.stringify(canonicalize(obj));
  return createHash("sha256").update(canonical).digest("hex");
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveFfmpeg() {
  return process.env.CLYPRA_FFMPEG || "ffmpeg";
}

/**
 * Generate synthetic media files or link existing valid fixture sources.
 */
export async function generateMediaFixtures(targetDir, options = {}) {
  await mkdir(targetDir, { recursive: true });
  const ffmpeg = resolveFfmpeg();
  const searchDirs = [
    options.sourceDir,
    process.env.CLYPRA_FIXTURES_DIR,
    path.join(os.homedir(), "Documents", "clypra-fixtures"),
  ].filter(Boolean);

  const mediaDefinitions = [
    {
      filename: "clip_1440p25_gop1s.mp4",
      width: 2560,
      height: 1440,
      frameRate: 25,
      duration: 60,
      generator: async (dest) => {
        // First try to link from pre-existing fixtures directory if available
        for (const dir of searchDirs) {
          const candidate = path.join(dir, "clip_1440p25_gop1s.mp4");
          if (await fileExists(candidate)) {
            try {
              await symlink(candidate, dest);
              return;
            } catch {
              // Copy if symlink fails (e.g. cross-device on Windows)
              const content = await readFile(candidate);
              await writeFile(dest, content);
              return;
            }
          }
        }
        await execFile(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "testsrc2=size=2560x1440:rate=25",
          "-t", "35",
          "-c:v", "libx264", "-preset", "ultrafast",
          "-g", "25", "-keyint_min", "25", "-sc_threshold", "0",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          dest,
        ]);
      },
    },
    {
      filename: "clip_1440p25_gop10s.mp4",
      width: 2560,
      height: 1440,
      frameRate: 25,
      duration: 60,
      generator: async (dest) => {
        for (const dir of searchDirs) {
          const candidate = path.join(dir, "clip_1440p25_gop10s.mp4");
          if (await fileExists(candidate)) {
            try {
              await symlink(candidate, dest);
              return;
            } catch {
              const content = await readFile(candidate);
              await writeFile(dest, content);
              return;
            }
          }
        }
        await execFile(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "testsrc2=size=2560x1440:rate=25",
          "-t", "35",
          "-c:v", "libx264", "-preset", "ultrafast",
          "-g", "250", "-keyint_min", "250", "-sc_threshold", "0",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          dest,
        ]);
      },
    },
    {
      filename: "clip_1080p30_gop1s.mp4",
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 35,
      generator: async (dest) => {
        await execFile(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30",
          "-t", "35",
          "-c:v", "libx264", "-preset", "ultrafast",
          "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          dest,
        ]);
      },
    },
    {
      filename: "sync_test.mp4",
      width: 1280,
      height: 720,
      frameRate: 25,
      duration: 60,
      generator: async (dest) => {
        for (const dir of searchDirs) {
          const candidate = path.join(dir, "sync_test.mp4");
          if (await fileExists(candidate)) {
            try {
              await symlink(candidate, dest);
              return;
            } catch {
              const content = await readFile(candidate);
              await writeFile(dest, content);
              return;
            }
          }
        }
        await execFile(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25",
          "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
          "-t", "35",
          "-c:v", "libx264", "-preset", "ultrafast",
          "-g", "25", "-keyint_min", "25", "-sc_threshold", "0",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "128k",
          "-movflags", "+faststart",
          dest,
        ]);
      },
    },
    {
      filename: "audio_beeps_48k_35s.m4a",
      sampleRate: 48000,
      channels: 2,
      duration: 35,
      generator: async (dest) => {
        await execFile(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=35",
          "-af", "volume=enable='not(between(mod(t,1.0),0,0.1))':volume=0:eval=frame",
          "-c:a", "aac", "-b:a", "192k",
          dest,
        ]);
      },
    },
    {
      filename: "image_corner_markers_1080p.png",
      width: 1920,
      height: 1080,
      generator: async (dest) => {
        await execFile(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "color=c=black:size=1920x1080:duration=1",
          "-vf", "drawbox=x=0:y=0:w=100:h=100:color=red@1:t=fill,drawbox=x=1820:y=0:w=100:h=100:color=green@1:t=fill,drawbox=x=0:y=980:w=100:h=100:color=blue@1:t=fill,drawbox=x=1820:y=980:w=100:h=100:color=yellow@1:t=fill",
          "-frames:v", "1", "-c:v", "png",
          dest,
        ]);
      },
    },
  ];

  const generated = [];
  for (const def of mediaDefinitions) {
    const dest = path.join(targetDir, def.filename);
    if (!(await fileExists(dest)) || options.force) {
      await def.generator(dest);
    }
    const sha256 = await hashFile(dest);
    generated.push({ ...def, dest, sha256 });
  }

  return generated;
}

/**
 * Build normalized, deterministic project JSON definitions across the 3 workload tiers.
 */
export function buildTierProjects(mediaDirRelative = "tests/fixtures/perf") {
  const mkAsset = (id, name, filename, type, w, h, dur = 60) => ({
    id,
    name,
    path: path.join(mediaDirRelative, filename),
    type,
    duration: dur,
    width: w,
    height: h,
  });

  const baseProject = (id, name, fps, duration = 60) => ({
    id,
    name,
    created_at: 1700000000000,
    modified_at: 1700000000000,
    aspect_ratio: "16:9",
    canvas_width: 1920,
    canvas_height: 1080,
    frame_rate: fps,
    duration,
    timeline_schema_version: 1,
    audio_model_version: 1,
    caption_model_version: 2,
    caption_tracks: [],
    transcripts: {},
    transitions: [],
    gaps: [],
    markers: [],
    main_video_track_id: "track-v1",
    media_assets: [],
    tracks: [],
    clips: [],
    text_effects: [],
    text_templates: [],
  });

  // Tier 1: Single Feature Isolation
  const pVideo25 = {
    ...baseProject("project-steady-25fps", "Steady Playback Benchmark (25fps)", 25, 60),
    media_assets: [
      mkAsset("asset-video-25", "clip_1440p25_gop1s.mp4", "clip_1440p25_gop1s.mp4", "video", 2560, 1440, 60),
    ],
    tracks: [{ id: "track-v1", type: "video", name: "Video Track 1", muted: false, locked: false, visible: true, height: 80 }],
    clips: [{ id: "clip-v1", kind: "video", trackId: "track-v1", mediaId: "asset-video-25", name: "Video Clip 25fps", startTime: 0, duration: 60, trimIn: 0, trimOut: 60 }],
  };

  const pVideo30 = {
    ...baseProject("project-steady-30fps", "Steady Playback Benchmark (30fps)", 30, 35),
    media_assets: [
      mkAsset("asset-video-30", "clip_1080p30_gop1s.mp4", "clip_1080p30_gop1s.mp4", "video", 1920, 1080, 35),
    ],
    tracks: [{ id: "track-v1", type: "video", name: "Video Track 1", muted: false, locked: false, visible: true, height: 80 }],
    clips: [{ id: "clip-v1", kind: "video", trackId: "track-v1", mediaId: "asset-video-30", name: "Video Clip 30fps", startTime: 0, duration: 35, trimIn: 0, trimOut: 35 }],
  };

  const pVideoGop10s = {
    ...baseProject("project-video-gop10s", "GOP 10s Playback Benchmark (25fps)", 25, 60),
    media_assets: [
      mkAsset("asset-video-gop10s", "clip_1440p25_gop10s.mp4", "clip_1440p25_gop10s.mp4", "video", 2560, 1440, 60),
    ],
    tracks: [{ id: "track-v1", type: "video", name: "Video Track 1", muted: false, locked: false, visible: true, height: 80 }],
    clips: [{ id: "clip-v1", kind: "video", trackId: "track-v1", mediaId: "asset-video-gop10s", name: "Video Clip GOP10s", startTime: 0, duration: 60, trimIn: 0, trimOut: 60 }],
  };

  const pImage = {
    ...baseProject("project-image", "Image Overlay Benchmark", 25, 30),
    media_assets: [
      mkAsset("asset-image-1", "image_corner_markers_1080p.png", "image_corner_markers_1080p.png", "image", 1920, 1080, 30),
    ],
    tracks: [{ id: "track-v1", type: "video", name: "Image Track", muted: false, locked: false, visible: true, height: 80 }],
    clips: [{ id: "clip-img-1", kind: "image", trackId: "track-v1", mediaId: "asset-image-1", name: "Corner Markers Image", startTime: 0, duration: 30, trimIn: 0, trimOut: 30 }],
  };

  const pAudio = {
    ...baseProject("project-audio", "Audio Mixer & Beeps Benchmark", 25, 35),
    media_assets: [
      mkAsset("asset-audio-1", "audio_beeps_48k_35s.m4a", "audio_beeps_48k_35s.m4a", "audio", 0, 0, 35),
    ],
    tracks: [{ id: "track-a1", type: "audio", name: "Audio Track", muted: false, locked: false, visible: true, height: 50, volume: 1.0 }],
    clips: [{ id: "clip-aud-1", kind: "audio", trackId: "track-a1", mediaId: "asset-audio-1", name: "Periodic Beeps Track", startTime: 0, duration: 35, trimIn: 0, trimOut: 35 }],
  };

  const pText = {
    ...baseProject("project-text", "Plain Text Overlay Benchmark", 25, 30),
    tracks: [{ id: "track-t1", type: "text", name: "Text Track", muted: false, locked: false, visible: true, height: 50 }],
    clips: [
      {
        id: "clip-text-1",
        kind: "text",
        trackId: "track-t1",
        mediaId: "",
        name: "Plain Text Benchmark",
        startTime: 0,
        duration: 30,
        trimIn: 0,
        trimOut: 30,
        x: 460,
        y: 450,
        width: 1000,
        height: 180,
        opacity: 1.0,
        rotation: 0,
        text: "Performance Benchmark Text",
        fontSize: 64,
        fontFamily: "Inter",
        color: "#FFFFFF",
        textAlign: "center",
      },
    ],
  };

  const pTextEffect = {
    ...baseProject("project-text-effect", "Animated Text Effect Benchmark", 25, 30),
    tracks: [{ id: "track-t1", type: "text", name: "Text Effect Track", muted: false, locked: false, visible: true, height: 50 }],
    clips: [
      {
        id: "clip-text-fx-1",
        kind: "text",
        trackId: "track-t1",
        mediaId: "",
        name: "Animated Text Effect",
        startTime: 0,
        duration: 30,
        trimIn: 0,
        trimOut: 30,
        x: 460,
        y: 450,
        width: 1000,
        height: 180,
        opacity: 1.0,
        rotation: 0,
        text: "Kinetic Motion Graphics",
        fontSize: 64,
        fontFamily: "Inter",
        color: "#FFCC00",
        textAlign: "center",
        entranceAnimation: {
          type: "slide-up",
          duration: 1.0,
          easing: "ease-out",
        },
        exitAnimation: {
          type: "fade",
          duration: 1.0,
          easing: "ease-in",
        },
      },
    ],
  };

  const pTextTemplate = {
    ...baseProject("project-text-template", "Text Template Benchmark", 25, 30),
    tracks: [{ id: "track-t1", type: "text", name: "Text Template Track", muted: false, locked: false, visible: true, height: 50 }],
    clips: [
      {
        id: "clip-template-1",
        kind: "text-template",
        role: "text",
        trackId: "track-t1",
        mediaId: "",
        name: "Lower Third Template",
        startTime: 0,
        duration: 30,
        trimIn: 0,
        trimOut: 30,
        x: 150,
        y: 750,
        width: 650,
        height: 140,
        opacity: 1.0,
        rotation: 0,
        templateId: "lower-third-broadcast",
        templateControlValues: {
          headline: "Lower Third Headline",
          subline: "Secondary Descriptor",
          accentColor: "#00AAFF",
        },
      },
    ],
  };

  // Tier 2: Stacked Video Ramp (2, 4, 6, 8 Layers)
  const buildStackedRamp = (layerCount) => {
    const p = baseProject(`project-stacked-${layerCount}`, `Stacked Video Ramp ${layerCount}-Layers`, 25, 35);
    const assetId = "asset-video-primary";
    p.media_assets = [
      mkAsset(assetId, "clip_1440p25_gop1s.mp4", "clip_1440p25_gop1s.mp4", "video", 2560, 1440, 60),
    ];
    for (let i = 1; i <= layerCount; i++) {
      const trackId = `track-v${i}`;
      p.tracks.push({
        id: trackId,
        type: "video",
        name: `Video Layer ${i}`,
        muted: false,
        locked: false,
        visible: true,
        height: 60,
      });
      p.clips.push({
        id: `clip-v${i}`,
        kind: "video",
        trackId,
        mediaId: assetId,
        name: `Layer Clip ${i}`,
        startTime: 0,
        duration: 35,
        trimIn: (i - 1) * 2,
        trimOut: (i - 1) * 2 + 35,
        opacity: 1.0 / layerCount + 0.1,
      });
    }
    return p;
  };

  const pStacked2 = buildStackedRamp(2);
  const pStacked4 = buildStackedRamp(4);
  const pStacked6 = buildStackedRamp(6);
  const pStacked8 = buildStackedRamp(8);

  // Tier 3: Composite Multi-Layer Interaction (25fps and 30fps)
  const buildComposite = (fps) => {
    const is30 = fps === 30;
    const dur = is30 ? 35 : 60;
    const p = baseProject(`project-composite-${fps}fps`, `Composite Multi-Media Interaction (${fps}fps)`, fps, dur);
    p.media_assets = [
      mkAsset("asset-video-aroll", is30 ? "clip_1080p30_gop1s.mp4" : "clip_1440p25_gop1s.mp4", is30 ? "clip_1080p30_gop1s.mp4" : "clip_1440p25_gop1s.mp4", "video", is30 ? 1920 : 2560, is30 ? 1080 : 1440, dur),
      mkAsset("asset-video-broll", "sync_test.mp4", "sync_test.mp4", "video", 1280, 720, dur),
      mkAsset("asset-image-logo", "image_corner_markers_1080p.png", "image_corner_markers_1080p.png", "image", 1920, 1080, dur),
      mkAsset("asset-audio-bed", "audio_beeps_48k_35s.m4a", "audio_beeps_48k_35s.m4a", "audio", 0, 0, 35),
    ];
    p.tracks = [
      { id: "track-v1-aroll", type: "video", name: "Primary Video A-Roll", muted: false, locked: false, visible: true, height: 80 },
      { id: "track-v2-broll", type: "video", name: "Overlay B-Roll PIP", muted: false, locked: false, visible: true, height: 60 },
      { id: "track-v3-image", type: "video", name: "Corner Graphics", muted: false, locked: false, visible: true, height: 50 },
      { id: "track-a1-audio", type: "audio", name: "Audio Bed", muted: false, locked: false, visible: true, height: 48, volume: 0.9 },
      { id: "track-t1-titles", type: "text", name: "Text Overlay", muted: false, locked: false, visible: true, height: 44 },
    ];
    p.clips = [
      { id: "clip-v1", kind: "video", trackId: "track-v1-aroll", mediaId: "asset-video-aroll", name: "A-Roll Clip", startTime: 0, duration: dur, trimIn: 0, trimOut: dur },
      { id: "clip-v2", kind: "video", trackId: "track-v2-broll", mediaId: "asset-video-broll", name: "B-Roll PIP Clip", startTime: 2, duration: dur - 4, trimIn: 0, trimOut: dur - 4 },
      { id: "clip-v3", kind: "image", trackId: "track-v3-image", mediaId: "asset-image-logo", name: "Corner Image", startTime: 0, duration: dur, trimIn: 0, trimOut: dur },
      { id: "clip-a1", kind: "audio", trackId: "track-a1-audio", mediaId: "asset-audio-bed", name: "Periodic Beeps Track", startTime: 0, duration: 35, trimIn: 0, trimOut: 35 },
      {
        id: "clip-text-composite-1",
        kind: "text",
        trackId: "track-t1-titles",
        mediaId: "",
        name: `Composite Multi-Layer ${fps}fps`,
        startTime: 1,
        duration: dur - 2,
        trimIn: 0,
        trimOut: dur - 2,
        x: 460,
        y: 860,
        width: 1000,
        height: 120,
        opacity: 1.0,
        rotation: 0,
        text: `Composite Multi-Layer ${fps}fps`,
        fontSize: 44,
        fontFamily: "Inter",
        color: "#00FFCC",
        textAlign: "center",
      },
    ];
    return p;
  };

  return {
    "project-steady-25fps.json": pVideo25,
    "project-steady-30fps.json": pVideo30,
    "project-video-gop10s.json": pVideoGop10s,
    "project-image.json": pImage,
    "project-audio.json": pAudio,
    "project-text.json": pText,
    "project-text-effect.json": pTextEffect,
    "project-text-template.json": pTextTemplate,
    "project-stacked-2.json": pStacked2,
    "project-stacked-4.json": pStacked4,
    "project-stacked-6.json": pStacked6,
    "project-stacked-8.json": pStacked8,
    "project-composite-25fps.json": buildComposite(25),
    "project-composite-30fps.json": buildComposite(30),
  };
}

/**
 * Write normalized project JSON files to target directory.
 */
export async function generateProjectFixtures(outputDir, mediaDirRelative = "tests/fixtures/perf") {
  await mkdir(outputDir, { recursive: true });
  const projects = buildTierProjects(mediaDirRelative);
  const written = [];
  for (const [filename, project] of Object.entries(projects)) {
    const dest = path.join(outputDir, filename);
    const jsonStr = JSON.stringify(project, null, 2) + "\n";
    await writeFile(dest, jsonStr, "utf8");
    const sha256 = createHash("sha256").update(jsonStr).digest("hex");
    written.push({ filename, dest, sha256, project });
  }
  return written;
}

/**
 * Create manifest.json capturing all media and project hashes and metadata.
 */
export async function generateManifest(mediaDir, projectsDir, manifestPath) {
  const mediaFiles = await readdir(mediaDir);
  const mediaEntries = {};

  for (const file of mediaFiles.sort()) {
    if (file.startsWith(".")) continue;
    const fullPath = path.join(mediaDir, file);
    try {
      const sha256 = await hashFile(fullPath);
      mediaEntries[file] = {
        filename: file,
        sha256,
      };
    } catch {
      // Ignore directories or broken links
    }
  }

  const projectFiles = await readdir(projectsDir);
  const projectEntries = {};

  for (const file of projectFiles.sort()) {
    if (!file.endsWith(".json") || file === "manifest.json") continue;
    const fullPath = path.join(projectsDir, file);
    try {
      const content = await readFile(fullPath, "utf8");
      const project = JSON.parse(content);
      const sha256 = createHash("sha256").update(content).digest("hex");
      const requiredMedia = (project.media_assets ?? []).map((a) => path.basename(a.path));
      projectEntries[file] = {
        filename: file,
        projectId: project.id,
        frameRate: project.frame_rate,
        duration: project.duration,
        sha256,
        requiredMedia,
      };
    } catch {
      // Ignore unparseable files
    }
  }

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    media: mediaEntries,
    projects: projectEntries,
  };

  const jsonStr = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(manifestPath, jsonStr, "utf8");
  return manifest;
}

/**
 * Validate media and project fixtures against manifest.json.
 */
export async function verifyManifest(mediaDir, projectsDir, manifestPath) {
  const content = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(content);
  const errors = [];

  for (const [filename, expected] of Object.entries(manifest.media ?? {})) {
    const fullPath = path.join(mediaDir, filename);
    if (!(await fileExists(fullPath))) {
      errors.push(`Missing media fixture: ${filename} (expected at ${fullPath})`);
      continue;
    }
    const actualSha = await hashFile(fullPath);
    if (actualSha !== expected.sha256) {
      errors.push(`Media fixture hash mismatch for ${filename}: expected ${expected.sha256}, got ${actualSha}`);
    }
  }

  for (const [filename, expected] of Object.entries(manifest.projects ?? {})) {
    const fullPath = path.join(projectsDir, filename);
    if (!(await fileExists(fullPath))) {
      errors.push(`Missing project fixture: ${filename} (expected at ${fullPath})`);
      continue;
    }
    const projectContent = await readFile(fullPath, "utf8");
    const actualSha = createHash("sha256").update(projectContent).digest("hex");
    if (actualSha !== expected.sha256) {
      errors.push(`Project fixture hash mismatch for ${filename}: expected ${expected.sha256}, got ${actualSha}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    manifest,
  };
}

function valueAfter(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  const mediaDir = valueAfter(argv, "--media-dir", "tests/fixtures/perf");
  const projectsDir = valueAfter(argv, "--projects-dir", "scripts/perf/fixtures");
  const manifestPath = valueAfter(argv, "--manifest", path.join(projectsDir, "manifest.json"));
  const verifyOnly = argv.includes("--verify-only") || argv.includes("--verify");

  if (verifyOnly) {
    console.log(`Verifying fixtures against ${manifestPath}...`);
    const res = await verifyManifest(mediaDir, projectsDir, manifestPath);
    if (!res.ok) {
      console.error(`❌ Manifest verification failed (${res.errors.length} errors):`);
      for (const err of res.errors) console.error(`  - ${err}`);
      process.exit(1);
    }
    console.log("✅ All fixtures match manifest.json exactly.");
    process.exit(0);
  }

  console.log("Generating media fixtures...");
  await generateMediaFixtures(mediaDir);

  console.log("Generating normalized tier projects...");
  await generateProjectFixtures(projectsDir, mediaDir);

  console.log("Generating manifest.json...");
  await generateManifest(mediaDir, projectsDir, manifestPath);

  console.log(`✅ Fixtures & manifest generated successfully at ${manifestPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
