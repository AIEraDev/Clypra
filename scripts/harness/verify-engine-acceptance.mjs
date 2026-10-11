import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessResultCollector } from "./collect-results.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const collector = new HarnessResultCollector("Clypra Engine Acceptance");
const KEEP_ARTIFACTS = process.env.KEEP_ENGINE_ACCEPTANCE_ARTIFACTS === "1";
const FIXTURE_DIR = path.resolve(
  process.env.CLYPRA_GOLDEN_FIXTURES || path.join(ROOT, "fixtures/golden-project"),
);
const FIXTURE = path.join(FIXTURE_DIR, "video_1080p_60fps_h264.mp4");
const FILMCRAFT_REPO = path.resolve(
  process.env.FILMCRAFT_REPO || path.join(ROOT, "../filmcraft"),
);
const TEMP_ROOT = await mkdtemp(path.join(os.tmpdir(), "clypra-engine-acceptance-"));

function record(name, category, status, started, details = "", exitCode = status === "PASSED" ? 0 : 1, artifacts = []) {
  collector.record({
    name,
    category,
    status,
    durationMs: Date.now() - started,
    exitCode,
    details,
    artifacts,
  });
}

async function gate(name, category, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    record(name, category, "PASSED", started, typeof result === "string" ? result : "");
    console.log(`✓ [${category}] ${name}`);
    return { ok: true, value: result };
  } catch (error) {
    const status = error?.blocked === true ? "BLOCKED" : "FAILED";
    record(name, category, status, started, error?.message || String(error), status === "PASSED" ? 0 : 1);
    console.error(`${status === "BLOCKED" ? "○" : "✗"} [${category}] ${name}: ${error?.message || error}`);
    return { ok: false, error };
  }
}

function blocked(message) {
  const error = new Error(message);
  error.blocked = true;
  return error;
}

async function pathExists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function executable(target) {
  try {
    await access(target, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(command) {
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(directory, command + suffix);
      if (await pathExists(candidate) && (process.platform === "win32" || await executable(candidate))) {
        return candidate;
      }
    }
  }
  return null;
}

async function resolveCli() {
  if (process.env.FILMCRAFT_CLI?.trim()) {
    const configured = path.resolve(process.env.FILMCRAFT_CLI);
    if (!(await pathExists(configured))) throw blocked(`FILMCRAFT_CLI does not exist: ${configured}`);
    return configured;
  }
  const suffix = process.platform === "win32" ? ".exe" : "";
  for (const candidate of [
    path.join(FILMCRAFT_REPO, "target/release", `filmcraft-cli${suffix}`),
    path.join(FILMCRAFT_REPO, "target/debug", `filmcraft-cli${suffix}`),
  ]) {
    if (await pathExists(candidate)) return candidate;
  }
  const onPath = await findOnPath("filmcraft-cli");
  if (onPath) return onPath;
  throw blocked(
    "FilmCraft CLI was not found. Build it with `cargo build --release -p filmcraft-cli` in the FilmCraft checkout, or set FILMCRAFT_CLI.",
  );
}

function spawnCaptured(command, args, options = {}) {
  const { cwd = ROOT, env = process.env, timeoutMs = 120_000, input, maxOutputBytes = 16 * 1024 * 1024 } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const result = {
        code: code ?? 1,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (timedOut) {
        reject(new Error(`Timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}\n${result.stderr}`));
      } else if (outputBytes > maxOutputBytes) {
        reject(new Error(`Output exceeded ${maxOutputBytes} bytes: ${command} ${args.join(" ")}`));
      } else {
        resolve(result);
      }
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function ensureSuccess(result, label) {
  if (result.code !== 0) {
    throw new Error(
      `${label} exited ${result.code}${result.signal ? ` (${result.signal})` : ""}.\nstdout: ${result.stdout.slice(0, 2000)}\nstderr: ${result.stderr.slice(-4000)}`,
    );
  }
  return result;
}

function parseJsonOutput(text, label) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${label} returned no JSON on stdout.`);
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} did not return one JSON value: ${error.message}\nstdout: ${trimmed.slice(0, 2000)}`);
  }
}

async function runCli(cli, args, project = null, options = {}) {
  const cliArgs = project ? ["--project", project, ...args] : [...args];
  const cliCwd = await pathExists(path.join(FILMCRAFT_REPO, "Cargo.toml")) ? FILMCRAFT_REPO : ROOT;
  const result = await spawnCaptured(cli, cliArgs, {
    cwd: cliCwd,
    timeoutMs: options.timeoutMs || 120_000,
    env: process.env,
  });
  if (options.allowFailure) return result;
  ensureSuccess(result, `filmcraft-cli ${cliArgs.join(" ")}`);
  return options.json === false ? result : parseJsonOutput(result.stdout, `filmcraft-cli ${cliArgs.join(" ")}`);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function pick(object, keys) {
  const out = {};
  for (const key of keys) {
    if (object && Object.hasOwn(object, key)) out[key] = object[key];
  }
  return out;
}

function normalizeEffect(effect) {
  return {
    effect: effect?.effect ?? null,
    enabled: effect?.enabled ?? null,
    params: stable(effect?.params ?? {}),
    masks: effect?.masks ?? null,
  };
}

function normalizeTrack(track) {
  return {
    name: track?.name ?? null,
    locked: track?.locked ?? null,
    syncLock: track?.syncLock ?? null,
    enabled: track?.enabled ?? null,
    muted: track?.muted ?? null,
    solo: track?.solo ?? null,
    items: (track?.items ?? []).map((item) => ({
      name: item.name ?? null,
      start: item.start,
      end: item.end,
      duration: item.duration,
      startFrame: item.startFrame,
      endFrame: item.endFrame,
      durationFrames: item.durationFrames,
      sourceIn: item.sourceIn,
      sourceOut: item.sourceOut,
      speed: item.speed,
      reverse: item.reverse,
      gainDb: item.gainDb,
      enabled: item.enabled,
      label: item.label,
      effects: (item.effects ?? []).map(normalizeEffect),
    })),
    transitions: (track?.transitions ?? []).map((transition) => ({
      effect: transition.effect,
      start: transition.start,
      duration: transition.duration,
      reverse: transition.reverse,
      align: transition.align,
      params: stable(transition.params ?? {}),
    })),
  };
}

function canonicalSequence(sequence) {
  if (!sequence || typeof sequence !== "object") {
    throw new Error("sequence inspection returned an unexpected payload.");
  }
  return stable({
    settings: pick(sequence.settings, [
      "width", "height", "frameRate", "frame_rate", "sampleRate", "sample_rate",
      "audioMaster", "audio_master", "workingSpace", "working_space", "dropFrame", "drop_frame",
    ]),
    duration: sequence.duration,
    durationFrames: sequence.durationFrames,
    in: sequence.in ?? null,
    out: sequence.out ?? null,
    markers: (sequence.markers ?? []).map((marker) => pick(marker, [
      "start", "duration", "kind", "name", "comment", "color",
    ])),
    video: (sequence.video ?? []).map(normalizeTrack),
    audio: (sequence.audio ?? []).map(normalizeTrack),
  });
}

function assertDeepEqual(left, right, message) {
  const a = JSON.stringify(stable(left));
  const b = JSON.stringify(stable(right));
  if (a !== b) {
    const max = 1800;
    throw new Error(`${message}\nCLI: ${a.slice(0, max)}\nMCP: ${b.slice(0, max)}`);
  }
}

function parseToolJson(result, label) {
  if (result?.isError) {
    const message = (result.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
    throw new Error(`${label} returned an MCP tool error: ${message || JSON.stringify(result)}`);
  }
  const blocks = (result?.content || []).filter((part) => part.type === "text" && typeof part.text === "string");
  for (const block of blocks) {
    try {
      return JSON.parse(block.text);
    } catch {
      // Some tools return a human-readable status block before the JSON payload.
    }
  }
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  throw new Error(`${label} did not return a JSON text block: ${JSON.stringify(result).slice(0, 2000)}`);
}

class McpClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.protocolNoise = [];
    child.stderr.on("data", (chunk) => { this.stderr += chunk.toString("utf8"); this.stderr = this.stderr.slice(-8000); });
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.protocolNoise.push(line);
        return;
      }
      if (message.id === undefined || message.id === null) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`MCP ${waiter.method} failed: ${message.error.message || JSON.stringify(message.error)}`));
      else waiter.resolve(message.result);
    });
    child.on("exit", (code, signal) => {
      for (const [id, waiter] of this.pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`MCP server exited before response (${code ?? signal ?? "unknown"}): ${this.stderr}`));
        this.pending.delete(id);
      }
    });
  }

  notify(method, params = {}) {
    if (!this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")) {
      throw new Error(`Could not write MCP notification ${method}`);
    }
  }

  call(method, params = {}, timeoutMs = 120_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for MCP ${method}. stderr: ${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async initialize() {
    await this.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "clypra-engine-acceptance", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
  }

  async tool(name, args = {}, timeoutMs = 120_000) {
    return this.call("tools/call", { name, arguments: args }, timeoutMs);
  }

  async close() {
    this.lines.close();
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => this.child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
    }
  }
}

async function startMcp(cli, dataDir) {
  await mkdir(dataDir, { recursive: true });
  const cliCwd = await pathExists(path.join(FILMCRAFT_REPO, "Cargo.toml")) ? FILMCRAFT_REPO : ROOT;
  const child = spawn(cli, ["mcp", "--data-dir", dataDir], {
    cwd: cliCwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const client = new McpClient(child);
  try {
    await client.initialize();
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

async function mcpCommand(client, id, params = {}) {
  const result = await client.tool("command_run", { id, params });
  return parseToolJson(result, `MCP command_run(${id})`);
}

async function inspectMcpSequence(client) {
  return parseToolJson(await client.tool("sequence_inspect", {}), "MCP sequence_inspect");
}

async function imageRgba(pngBytes, label) {
  let canvasModule;
  try {
    canvasModule = await import("canvas");
  } catch (error) {
    throw blocked(`Node canvas is required to compare rendered pixels. Run npm ci first. ${error.message}`);
  }
  const { createCanvas, loadImage } = canvasModule;
  const image = await loadImage(pngBytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  return {
    width: image.width,
    height: image.height,
    pixels: Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    label,
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function checkTickGridContract() {
  const clypraTypesPath = path.join(ROOT, "src-tauri/src/engine/types.rs");
  const clypraTypes = await readFile(clypraTypesPath, "utf8");
  const clypraTickMatch = clypraTypes.match(/const FILMCRAFT_TICKS_PER_SECOND:\s*i128\s*=\s*([\d_]+)\s*;/);
  if (!clypraTickMatch) throw new Error("Clypra's FilmCraft tick-grid oracle constant was not found.");
  const expectedConstant = clypraTickMatch[1].replaceAll("_", "");

  const filmcraftTimePath = path.join(FILMCRAFT_REPO, "crates/time/src/lib.rs");
  if (!(await pathExists(filmcraftTimePath))) {
    throw blocked(`FilmCraft time crate source not found at ${filmcraftTimePath}. Set FILMCRAFT_REPO to the AIEraDev/filmcraft checkout.`);
  }
  const filmcraftTime = await readFile(filmcraftTimePath, "utf8");
  const filmcraftTickMatch = filmcraftTime.match(/pub const TICKS_PER_SECOND:\s*i64\s*=\s*([\d_]+)\s*;/);
  if (!filmcraftTickMatch) throw new Error("Could not read TICKS_PER_SECOND from FilmCraft crates/time/src/lib.rs.");
  const actualConstant = filmcraftTickMatch[1].replaceAll("_", "");
  if (actualConstant !== expectedConstant) {
    throw new Error(`Tick-grid contract mismatch: Clypra oracle=${expectedConstant}, FilmCraft source=${actualConstant}.`);
  }
  return `Both implementations use ${actualConstant} ticks per second as the reference grid.`;
}

async function main() {
  const rustTest = await gate("Clypra MediaTime property tests", "Timeline Math", async () => {
    const result = await spawnCaptured("cargo", [
      "test", "--manifest-path", path.join(ROOT, "src-tauri/Cargo.toml"), "engine::types::tests",
    ], { cwd: ROOT, timeoutMs: 30 * 60_000 });
    ensureSuccess(result, "Clypra MediaTime tests");
    return result.stdout.split("\n").filter((line) => /test result:/.test(line)).join("; ") || "Rust test command passed.";
  });

  await gate("TypeScript timeline/audio regressions", "Timeline Math", async () => {
    const result = await spawnCaptured(process.platform === "win32" ? "npm.cmd" : "npm", [
      "exec", "--", "vitest", "run",
      "src/core/evaluation/__tests__/mediaTimelineRegression.test.ts",
      "src/core/timeline/__tests__/audioClipsExportRangeFades.test.ts",
    ], { cwd: ROOT, timeoutMs: 10 * 60_000 });
    ensureSuccess(result, "Clypra Vitest regressions");
    return result.stdout.split("\n").filter((line) => /Test Files:|Tests\s+\d+ passed/.test(line)).join("; ");
  });

  const filmcraftRepoReady = await pathExists(path.join(FILMCRAFT_REPO, "Cargo.toml"));
  if (!filmcraftRepoReady) {
    await gate("FilmCraft Tick/edit crate property suites", "FilmCraft", async () => {
      throw blocked(`FilmCraft checkout not found at ${FILMCRAFT_REPO}. Set FILMCRAFT_REPO to the AIEraDev/filmcraft repository root.`);
    });
    await gate("Clypra ↔ FilmCraft tick-grid contract", "Timeline Math", async () => {
      throw blocked("Cannot verify the FilmCraft tick constant without FILMCRAFT_REPO.");
    });
  } else {
    await gate("Clypra ↔ FilmCraft tick-grid contract", "Timeline Math", checkTickGridContract);
    await gate("FilmCraft Tick/edit crate property suites", "FilmCraft", async () => {
      const editTestPath = path.join(FILMCRAFT_REPO, "crates/edit/src/tests.rs");
      const editSource = await readFile(editTestPath, "utf8");
      if (!editSource.includes("razor_split_preserves_tick_duration_and_source_continuity")) {
        throw blocked(
          "The FilmCraft checkout does not contain razor_split_preserves_tick_duration_and_source_continuity yet. Check out branch codex/acceptance-property-tests or run after that test is merged.",
        );
      }
      const result = await spawnCaptured("cargo", [
        "test", "--manifest-path", path.join(FILMCRAFT_REPO, "Cargo.toml"),
        "-p", "filmcraft-time", "-p", "filmcraft-edit",
      ], { cwd: FILMCRAFT_REPO, timeoutMs: 30 * 60_000 });
      ensureSuccess(result, "FilmCraft time/edit property tests");
      return result.stdout.split("\n").filter((line) => /test result:/.test(line)).join("; ") || "FilmCraft time/edit tests passed.";
    });
  }

  const cliResult = await gate("Locate FilmCraft CLI and golden media fixture", "Automation", async () => {
    const cli = await resolveCli();
    if (!(await pathExists(FIXTURE))) {
      throw blocked(
        `Golden media fixture not found at ${FIXTURE}. Generate/download Clypra golden assets with npm run benchmark:assets or set CLYPRA_GOLDEN_FIXTURES.`,
      );
    }
    const metadata = await stat(FIXTURE);
    if (metadata.size === 0) throw new Error(`Golden media fixture is empty: ${FIXTURE}`);
    return { cli, fixture: FIXTURE, bytes: metadata.size };
  });

  let mcp = null;
  let cliProjectPath = null;
  let cliCanonical = null;
  let mcpCanonical = null;
  let cliFramePath = null;
  let mcpFrameBytes = null;
  let cliPostFailure = null;
  let mcpPostFailure = null;

  if (cliResult.ok) {
    const cli = cliResult.value.cli;
    try {
      await gate("CLI workflow: import, sequence, trim, inspect, render", "CLI/MCP Parity", async () => {
        cliProjectPath = path.join(TEMP_ROOT, "cli-project.fcproj");
        cliFramePath = path.join(TEMP_ROOT, "cli-frame.png");

        await runCli(cli, ["exec", "file.newProject", JSON.stringify({ name: "Clypra Engine Acceptance" }), "--save-as", cliProjectPath, "--compact"]);
        const imported = await runCli(cli, [
          "exec", "file.import", JSON.stringify({ paths: [FIXTURE] }), "--save", "--compact",
        ], cliProjectPath);
        const itemId = imported?.items?.[0];
        if (!Number.isSafeInteger(itemId)) throw new Error(`CLI import didn't return an item id: ${JSON.stringify(imported)}`);
        await runCli(cli, [
          "exec", "file.newSequence",
          JSON.stringify({ name: "Clypra Acceptance Sequence", fromItem: itemId }),
          "--save", "--compact",
        ], cliProjectPath);
        const before = await runCli(cli, ["inspect", "sequence", "--compact"], cliProjectPath);
        const firstClip = (before.video || []).flatMap((track) => track.items || [])[0];
        if (!Number.isSafeInteger(firstClip?.clip)) throw new Error(`CLI new sequence has no video clip: ${JSON.stringify(before).slice(0, 1600)}`);
        await runCli(cli, [
          "exec", "timeline.trim",
          JSON.stringify({ clip: firstClip.clip, edge: "out", mode: "regular", deltaFrames: -1 }),
          "--save", "--compact",
        ], cliProjectPath);
        const after = await runCli(cli, ["inspect", "sequence", "--compact"], cliProjectPath);
        cliCanonical = canonicalSequence(after);
        await runCli(cli, ["render", "--seconds", "1.0", "--scale", "1.0", "--out", cliFramePath], cliProjectPath, { json: false });
        if (!(await pathExists(cliFramePath))) throw new Error(`CLI render did not create ${cliFramePath}`);
        return `Imported fixture (${cliResult.value.bytes} bytes), applied one-frame trim, inspected state, rendered 1.0s.`;
      });

      await gate("MCP workflow: import, sequence, trim, inspect, render", "CLI/MCP Parity", async () => {
        mcp = await startMcp(cli, path.join(TEMP_ROOT, "mcp-data"));
        await mcpCommand(mcp, "file.newProject", { name: "Clypra Engine Acceptance" });
        const imported = await mcpCommand(mcp, "file.import", { paths: [FIXTURE] });
        const itemId = imported?.items?.[0];
        if (!Number.isSafeInteger(itemId)) throw new Error(`MCP import didn't return an item id: ${JSON.stringify(imported)}`);
        await mcpCommand(mcp, "file.newSequence", { name: "Clypra Acceptance Sequence", fromItem: itemId });
        const before = await inspectMcpSequence(mcp);
        const firstClip = (before.video || []).flatMap((track) => track.items || [])[0];
        if (!Number.isSafeInteger(firstClip?.clip)) throw new Error(`MCP new sequence has no video clip: ${JSON.stringify(before).slice(0, 1600)}`);
        await mcpCommand(mcp, "timeline.trim", {
          clip: firstClip.clip, edge: "out", mode: "regular", deltaFrames: -1,
        });
        const after = await inspectMcpSequence(mcp);
        mcpCanonical = canonicalSequence(after);
        const rendered = await mcp.tool("render_frame", { seconds: 1.0, max_side: 1920 }, 180_000);
        if (rendered?.isError) throw new Error(`MCP render_frame failed: ${JSON.stringify(rendered).slice(0, 1800)}`);
        const imageBlock = (rendered?.content || []).find((part) => part.type === "image" && typeof part.data === "string");
        if (!imageBlock) throw new Error(`MCP render_frame returned no PNG image block: ${JSON.stringify(rendered).slice(0, 1800)}`);
        mcpFrameBytes = Buffer.from(imageBlock.data, "base64");
        if (mcpFrameBytes.length < 64) throw new Error(`MCP render_frame PNG payload is unexpectedly small: ${mcpFrameBytes.length} bytes`);
        return "Repeated the same import/new-sequence/trim workflow through MCP and rendered 1.0s.";
      });

      if (cliCanonical && mcpCanonical) {
        await gate("CLI/MCP canonical timeline state parity", "CLI/MCP Parity", async () => {
          assertDeepEqual(cliCanonical, mcpCanonical, "CLI and MCP canonical timeline state differs.");
          return "Track structure, clip timing/source ranges, effects, markers, and sequence settings match after ID/selection normalization.";
        });
      } else {
        await gate("CLI/MCP canonical timeline state parity", "CLI/MCP Parity", async () => {
          throw blocked("State comparison skipped because both CLI and MCP workflows did not finish.");
        });
      }

      if (cliFramePath && mcpFrameBytes) {
        await gate("CLI/MCP rendered pixel parity", "CLI/MCP Parity", async () => {
          const cliPng = await readFile(cliFramePath);
          const cliPixels = await imageRgba(cliPng, "CLI");
          const mcpPixels = await imageRgba(mcpFrameBytes, "MCP");
          if (cliPixels.width !== mcpPixels.width || cliPixels.height !== mcpPixels.height) {
            throw new Error(`Rendered dimensions differ: CLI ${cliPixels.width}x${cliPixels.height}, MCP ${mcpPixels.width}x${mcpPixels.height}.`);
          }
          const cliHash = sha256(cliPixels.pixels);
          const mcpHash = sha256(mcpPixels.pixels);
          if (cliHash !== mcpHash) {
            let differingBytes = 0;
            for (let i = 0; i < cliPixels.pixels.length; i++) if (cliPixels.pixels[i] !== mcpPixels.pixels[i]) differingBytes++;
            throw new Error(`Rendered pixels differ (${differingBytes}/${cliPixels.pixels.length} RGBA bytes). CLI SHA-256=${cliHash}; MCP SHA-256=${mcpHash}.`);
          }
          return `Exact RGBA parity at ${cliPixels.width}x${cliPixels.height}; SHA-256 ${cliHash}.`;
        });
      } else {
        await gate("CLI/MCP rendered pixel parity", "CLI/MCP Parity", async () => {
          throw blocked("Pixel comparison skipped because both rendering workflows did not return images.");
        });
      }

      await gate("Malformed edit errors are structured and do not corrupt state", "CLI/MCP Parity", async () => {
        const invalidClip = 987654321;
        const cliBad = await runCli(cli, [
          "exec", "timeline.trim",
          JSON.stringify({ clip: invalidClip, edge: "out", mode: "regular", deltaFrames: -1 }),
          "--compact",
        ], cliProjectPath, { allowFailure: true, json: false });
        if (cliBad.code === 0) throw new Error("CLI unexpectedly accepted a trim against a nonexistent clip id.");
        const cliSequenceAfter = await runCli(cli, ["inspect", "sequence", "--compact"], cliProjectPath);

        const mcpBad = await mcp.tool("command_run", {
          id: "timeline.trim",
          params: { clip: invalidClip, edge: "out", mode: "regular", deltaFrames: -1 },
        });
        if (!mcpBad?.isError) throw new Error(`MCP did not mark the invalid edit as an error: ${JSON.stringify(mcpBad).slice(0, 1600)}`);
        const mcpSequenceAfter = await inspectMcpSequence(mcp);
        cliPostFailure = canonicalSequence(cliSequenceAfter);
        mcpPostFailure = canonicalSequence(mcpSequenceAfter);

        assertDeepEqual(cliCanonical, cliPostFailure, "CLI project state changed after the invalid edit.");
        assertDeepEqual(mcpCanonical, mcpPostFailure, "MCP project state changed after the invalid edit.");
        return "Both surfaces rejected a nonexistent clip and retained the pre-error canonical state.";
      });
    } finally {
      if (mcp) await mcp.close();
    }
  } else {
    await gate("CLI/MCP canonical state, render, and error parity", "CLI/MCP Parity", async () => {
      throw blocked("Skipped: FilmCraft CLI or Clypra golden media fixture is unavailable; see the preceding gate.");
    });
  }

  if (!KEEP_ARTIFACTS) {
    await rm(TEMP_ROOT, { recursive: true, force: true });
  } else {
    console.log(`Acceptance artifacts retained in ${TEMP_ROOT}`);
  }

  const pass = collector.printSummary();
  await collector.saveJsonReport("test-results/engine-acceptance.json");
  if (!pass) process.exitCode = 1;
}


main().catch(async (error) => {
  console.error("Fatal engine acceptance harness error:", error);
  try {
    if (!KEEP_ARTIFACTS) await rm(TEMP_ROOT, { recursive: true, force: true });
    collector.record({
      name: "Harness startup",
      category: "Harness",
      status: "FAILED",
      durationMs: 0,
      exitCode: 1,
      details: error?.stack || String(error),
    });
    collector.printSummary();
    await collector.saveJsonReport("test-results/engine-acceptance.json");
  } catch (reportError) {
    console.error("Failed to write acceptance report:", reportError);
  }
  process.exitCode = 1;
});
