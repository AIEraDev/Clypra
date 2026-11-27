import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

function loadTauriCliPackage() {
  const cliModulePath = require.resolve("@tauri-apps/cli");
  const packageJsonPath = resolve(dirname(cliModulePath), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  return { packageJson, packageJsonPath };
}

export function resolveTauriCliEntry(packageJson, packageJsonPath) {
  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.tauri;
  if (!bin) {
    throw new Error("@tauri-apps/cli does not declare a tauri binary entry");
  }

  return resolve(dirname(packageJsonPath), bin);
}

export function buildTauriCommand({
  platform = process.platform,
  nodeExecutable = process.execPath,
  packageJson,
  packageJsonPath,
} = {}) {
  if (platform !== "win32") {
    return { command: "node_modules/.bin/tauri", args: [] };
  }

  const packageInfo = packageJson && packageJsonPath
    ? { packageJson, packageJsonPath }
    : loadTauriCliPackage();

  return {
    command: nodeExecutable,
    args: [resolveTauriCliEntry(packageInfo.packageJson, packageInfo.packageJsonPath)],
  };
}
