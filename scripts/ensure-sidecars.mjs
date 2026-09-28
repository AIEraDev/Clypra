#!/usr/bin/env node
// scripts/ensure-sidecars.mjs
// Assures that verified static FFmpeg and FFprobe sidecars are ready before dev/build.
// If valid native binaries already exist, exits in <15ms.
// If missing or stubs, auto-provisions and cryptographically verifies them.
//
// After provisioning the triple-named source files in src-tauri/bin/, this
// script also refreshes the plain-named copies that Tauri places in the Cargo
// output directories (target/debug/ and target/release/).  This prevents a
// stale stub that was written before the real binary was provisioned from
// surviving in the build output and being picked up at runtime over the real
// bundled sidecar.

import { open, stat, copyFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");

function hostTarget() {
  const arch =
    process.arch === "arm64"
      ? "aarch64"
      : process.arch === "x64"
        ? "x86_64"
        : null;
  if (!arch) return null;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "linux") return `${arch}-unknown-linux-gnu`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  return null;
}

const target = hostTarget();
if (!target) {
  console.warn(
    `[SidecarAssurance] Unknown host platform (${process.platform} ${process.arch}). Skipping check.`,
  );
  process.exit(0);
}

const extension = target.includes("windows") ? ".exe" : "";
const expectedMagic = target.includes("windows")
  ? "4d5a"
  : target.includes("linux")
    ? "7f454c46"
    : null;
const binaries = ["ffmpeg", "ffprobe"];

async function checkBinary(binary) {
  const path = resolve(
    rootDir,
    "src-tauri",
    "bin",
    `${binary}-${target}${extension}`,
  );
  try {
    const handle = await open(path, "r");
    const header = Buffer.alloc(4);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const { size } = await stat(path);

    if (size < 1_000_000) {
      return false; // text stub or truncated
    }

    const magic = header.toString("hex");
    if (expectedMagic && !magic.startsWith(expectedMagic)) {
      return false;
    }
    if (target.includes("apple-darwin") && !isMachO(magic)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isMachO(magic) {
  return new Set([
    "feedface",
    "cefaedfe",
    "feedfacf",
    "cffaedfe",
    "cafebabe",
    "bebafeca",
  ]).has(magic);
}

let allValid = true;
for (const binary of binaries) {
  const valid = await checkBinary(binary);
  if (!valid) {
    allValid = false;
    break;
  }
}

if (allValid) {
  console.log(
    `[SidecarAssurance] Verified static media runtime (${target}) is ready.`,
  );
} else {
  console.log(
    `[SidecarAssurance] Verified static sidecars missing or stub detected for ${target}. Auto-provisioning...`,
  );

  let result;
  if (process.platform === "win32") {
    // Try pwsh first, then powershell
    result = spawnSync(
      "powershell.exe",
      [
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "scripts/setup-sidecars.ps1",
        "-Target",
        target,
        "-Force",
      ],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    );
  } else {
    result = spawnSync(
      "bash",
      ["scripts/setup-sidecars.sh", "--target", target, "--force"],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    );
  }

  if (result.status !== 0) {
    console.error(
      `[SidecarAssurance] Failed to auto-provision verified sidecars (exit code ${result.status}).`,
    );
    process.exit(result.status ?? 1);
  }

  console.log(
    `[SidecarAssurance] Successfully provisioned verified static media runtime for ${target}.`,
  );
}

// ---------------------------------------------------------------------------
// Sync plain-named copies in Cargo output directories.
//
// Tauri copies src-tauri/bin/ffmpeg-<triple> → target/{debug,release}/ffmpeg
// at `cargo tauri dev` / `cargo tauri build` time.  If the build output
// directories already contain a stale stub (e.g. from a `cargo build --release`
// run before the real sidecar was provisioned) those copies will not be
// refreshed until the next full Tauri CLI build.  We fix this here so that
// every `npm run dev` (and every `npm run build` via beforeBuildCommand) is
// guaranteed to have the real binary in place.
// ---------------------------------------------------------------------------

const outputProfiles = ["debug", "release"];

for (const profile of outputProfiles) {
  const outputDir = resolve(rootDir, "src-tauri", "target", profile);

  // Skip profile directories that don't exist yet (e.g. release/ on a fresh
  // checkout that has only ever been run with `dev`).
  let outputDirExists = false;
  try {
    await stat(outputDir);
    outputDirExists = true;
  } catch {
    // directory does not exist — nothing to sync
  }
  if (!outputDirExists) continue;

  for (const binary of binaries) {
    const srcPath = resolve(
      rootDir,
      "src-tauri",
      "bin",
      `${binary}-${target}${extension}`,
    );
    const destName = target.includes("windows") ? `${binary}.exe` : binary;
    const destPath = resolve(outputDir, destName);

    // Only copy if the destination is missing, is a stub (< 1 MB), or is
    // older than the verified source file.  This avoids unnecessary I/O on
    // repeated `npm run dev` invocations where everything is already in sync.
    let needsCopy = false;
    try {
      const [srcStat, destStat] = await Promise.all([
        stat(srcPath),
        stat(destPath),
      ]);
      if (destStat.size < 1_000_000) {
        needsCopy = true; // destination is still a stub
      } else if (srcStat.mtimeMs > destStat.mtimeMs) {
        needsCopy = true; // source is newer (e.g. just re-provisioned)
      }
    } catch {
      // destination does not exist, or source stat failed — attempt the copy
      // only if the source file actually exists and is real
      try {
        const srcStat = await stat(srcPath);
        if (srcStat.size >= 1_000_000) {
          needsCopy = true;
        }
      } catch {
        // source missing — nothing we can do here
      }
    }

    if (needsCopy) {
      try {
        await mkdir(outputDir, { recursive: true });
        await copyFile(srcPath, destPath);
        // Preserve executable permission on Unix
        if (process.platform !== "win32") {
          const { chmodSync } = await import("node:fs");
          chmodSync(destPath, 0o755);
        }
        console.log(
          `[SidecarAssurance] Synced ${binary} → target/${profile}/${destName}`,
        );
      } catch (err) {
        // Non-fatal: the Tauri CLI will re-copy on its own build step.
        // Log a warning rather than aborting the whole dev/build pipeline.
        console.warn(
          `[SidecarAssurance] Could not sync ${binary} to target/${profile}/: ${err.message}`,
        );
      }
    }
  }
}
