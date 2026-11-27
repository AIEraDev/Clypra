import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTauriCommand, resolveTauriCliEntry } from "../tauri-cli-command.mjs";

describe("Tauri CLI command construction", () => {
  it("uses the package bin entry through Node on Windows", () => {
    const packageJsonPath = "/repo/node_modules/@tauri-apps/cli/package.json";
    const command = buildTauriCommand({
      platform: "win32",
      nodeExecutable: "C:/Program Files/nodejs/node.exe",
      packageJson: { bin: { tauri: "./tauri.js" } },
      packageJsonPath,
    });

    assert.equal(command.command, "C:/Program Files/nodejs/node.exe");
    assert.deepEqual(command.args, [resolveTauriCliEntry(
      { bin: { tauri: "./tauri.js" } },
      packageJsonPath,
    )]);
    assert.match(command.args[0], /node_modules[\\/]@tauri-apps[\\/]cli[\\/]tauri\.js$/);
  });

  it("preserves the existing Unix shim command", () => {
    assert.deepEqual(buildTauriCommand({ platform: "darwin" }), {
      command: "node_modules/.bin/tauri",
      args: [],
    });
  });
});
