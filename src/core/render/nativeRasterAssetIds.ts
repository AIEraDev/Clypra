/** Stable identities shared by native raster producers and frame validators. */

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildNativeImageAssetId(sourcePath: string, width: number, height: number): string {
  return `native-image:${stableSerialize({
    sourcePath,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  })}`;
}
