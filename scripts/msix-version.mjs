/**
 * Converts an app semver (including prerelease/build metadata) to the
 * four-part numeric version required by MSIX manifests.
 */
export function toMsixVersion(rawVersion) {
  const version = String(rawVersion).trim().split("+", 1)[0].split("-", 1)[0];
  const parts = version.split(".");

  if (!/^\d+$/.test(version.replace(/\./g, "")) || (parts.length !== 3 && parts.length !== 4)) {
    throw new Error(`Invalid MSIX-compatible app version: ${rawVersion}`);
  }

  return parts.length === 3 ? `${version}.0` : version;
}
