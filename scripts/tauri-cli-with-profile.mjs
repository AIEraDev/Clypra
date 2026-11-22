#!/usr/bin/env node

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const isDevCommand = args[0] === "dev";
const tauriBinary = process.platform === "win32"
  ? "node_modules/.bin/tauri.cmd"
  : "node_modules/.bin/tauri";

const child = spawn(tauriBinary, args, {
  stdio: "inherit",
  env: isDevCommand ? { ...process.env, CLYPRA_DEV: "1" } : process.env,
});

child.on("error", (error) => {
  console.error(`Unable to start Tauri CLI: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
