import { describe, expect, it } from "vitest";
import { normalizeUpdaterManifest } from "../../../scripts/normalize-updater-manifest.mjs";

describe("normalizeUpdaterManifest", () => {
  const manifest = {
    version: "1.6.9-1",
    platforms: {
      "darwin-x86_64": {
        signature: "signed",
        url: "https://github.com/AIEraDev/Clypra/releases/download/untagged-draft/Clypra_x64.app.tar.gz",
      },
    },
  };

  it("rewrites draft-era URLs to the published tag and preserves signatures", () => {
    const normalized = normalizeUpdaterManifest(manifest, ["Clypra_x64.app.tar.gz"], {
      repository: "AIEraDev/Clypra",
      tag: "v1.6.9-1",
    });

    expect(normalized.platforms["darwin-x86_64"]).toEqual({
      signature: "signed",
      url: "https://github.com/AIEraDev/Clypra/releases/download/v1.6.9-1/Clypra_x64.app.tar.gz",
    });
    expect(manifest.platforms["darwin-x86_64"].url).toContain("untagged-draft");
  });

  it("fails when the manifest points at an asset absent from the release", () => {
    expect(() =>
      normalizeUpdaterManifest(manifest, [], {
        repository: "AIEraDev/Clypra",
        tag: "v1.6.9-1",
      }),
    ).toThrow("Clypra_x64.app.tar.gz");
  });
});
