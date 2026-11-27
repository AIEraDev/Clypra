#!/usr/bin/env node

import { spawn } from "node:child_process";
import { buildTauriCommand } from "./tauri-cli-command.mjs";

const args = process.argv.slice(2);
const isDevCommand = args[0] === "dev";

const forwardedArgs = isDevCommand && !args.includes("--features")
  ? [...args, "--", "--features", "perf-driver"]
  : args;

const { command, args: commandArgs } = buildTauriCommand();

const child = spawn(command, [...commandArgs, ...forwardedArgs], {
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
