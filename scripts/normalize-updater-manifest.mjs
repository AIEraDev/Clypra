import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeUpdaterManifest(manifest, releaseAssets, { repository, tag }) {
  const assetsByName = new Map(
    releaseAssets.map((asset) => [typeof asset === "string" ? asset : asset.name, asset]),
  );
  const assetsById = new Map(
    releaseAssets
      .filter((asset) => typeof asset !== "string")
      .map((asset) => {
        const apiId = asset.apiUrl?.match(/\/releases\/assets\/(\d+)$/)?.[1];
        return [apiId ?? String(asset.id ?? ""), asset];
      })
      .filter(([id]) => id !== ""),
  );
  const normalized = structuredClone(manifest);

  for (const [platform, data] of Object.entries(normalized.platforms ?? {})) {
    if (!data || typeof data.url !== "string") continue;

    const urlPath = new URL(data.url).pathname.split("/").filter(Boolean);
    const pathPart = decodeURIComponent(urlPath.at(-1) ?? "");
    const releaseAsset = assetsById.get(pathPart) ?? assetsByName.get(pathPart);
    if (!releaseAsset) {
      throw new Error(`Updater asset ${pathPart} for ${platform} is missing from release ${tag}`);
    }
    const assetName = typeof releaseAsset === "string" ? releaseAsset : releaseAsset.name;

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
    releaseInfo.assets,
    { repository, tag },
  );
  const output = `${JSON.stringify(normalized, null, 2)}\n`;
  fs.writeFileSync(latestOutput, output);
  fs.writeFileSync(updaterOutput, output);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
