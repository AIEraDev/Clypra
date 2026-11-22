#!/usr/bin/env node

import { spawn } from "node:child_process";

const viteBinary = process.platform === "win32"
  ? "node_modules/.bin/vite.cmd"
  : "node_modules/.bin/vite";
const child = spawn(viteBinary, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, CLYPRA_DEV: "1" },
});

child.on("error", (error) => {
  console.error(`Unable to start Vite: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
