import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeUpdaterManifest(manifest, assetNames, { repository, tag }) {
  const assets = new Set(assetNames);
  const normalized = structuredClone(manifest);

  for (const [platform, data] of Object.entries(normalized.platforms ?? {})) {
    if (!data || typeof data.url !== "string") continue;

    const assetName = decodeURIComponent(new URL(data.url).pathname.split("/").pop() ?? "");
    if (!assets.has(assetName)) {
      throw new Error(`Updater asset ${assetName} for ${platform} is missing from release ${tag}`);
    }

    data.url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(assetName)}`;
  }

  return normalized;
}

function main() {
  const [inputPath = "/tmp/latest.json", latestOutput = inputPath, updaterOutput = "/tmp/updater.json"] = process.argv.slice(2);
  const repository = process.env.GITHUB_REPOSITORY ?? "AIEraDev/Clypra";
  const tag = process.env.RELEASE_TAG;
  if (!tag) throw new Error("RELEASE_TAG is required");

  const releaseInfo = JSON.parse(
    execFileSync("gh", ["release", "view", tag, "--json", "assets", "--repo", repository], { encoding: "utf8" }),
  );
  const manifest = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const normalized = normalizeUpdaterManifest(
    manifest,
    releaseInfo.assets.map((asset) => asset.name),
    { repository, tag },
  );
  const output = `${JSON.stringify(normalized, null, 2)}\n`;
  fs.writeFileSync(latestOutput, output);
  fs.writeFileSync(updaterOutput, output);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
