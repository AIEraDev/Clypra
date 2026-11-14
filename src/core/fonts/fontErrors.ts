/**
 * Font Resolution Errors
 *
 * Surfaced when export pipeline encounters a missing or unloaded font.
 */

export class ExportFontResolutionError extends Error {
  readonly code = "ExportFontResolutionError";
  readonly fontFamily: string;

  constructor(fontFamily: string, reason?: string) {
    super(
      `Export failed: Font "${fontFamily}" could not be resolved or loaded for final rendering.${reason ? ` Reason: ${reason}` : ""}`,
    );
    this.name = "ExportFontResolutionError";
    this.fontFamily = fontFamily;
  }
}

/**
 * Checks whether a specific FontFace is loaded in a FontFaceSet.
 *
 * DO NOT use fonts.check() as the failure signal — document.fonts.check() or
 * self.fonts.check() can return true for an unregistered or missing family by
 * matching a system fallback face.
 *
 * This function iterates the actual FontFace set and asserts face.status === "loaded".
 */
export function isSpecificFontFaceLoaded(
  fontFaces: FontFaceSet | undefined | null,
  family: string,
): boolean {
  if (!fontFaces) return false;
  const targetFamily = family.trim().replace(/^['"]|['"]$/g, "").toLowerCase();

  for (const face of fontFaces) {
    const faceFamily = face.family.replace(/^['"]|['"]$/g, "").toLowerCase();
    if (faceFamily === targetFamily) {
      return face.status === "loaded";
    }
  }
  return false;
}
