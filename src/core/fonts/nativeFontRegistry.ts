import {
  isTauriRuntime,
  registerNativeFontBytes,
} from "@/lib/platform/tauri";

import interUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import montserratUrl from "@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2?url";
import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import spaceGroteskUrl from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url";
import robotoUrl from "@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2?url";
import outfitUrl from "@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url";
import robotoCondensedUrl from "@fontsource-variable/roboto-condensed/files/roboto-condensed-latin-wght-normal.woff2?url";
import openSansUrl from "@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2?url";
import ralewayUrl from "@fontsource-variable/raleway/files/raleway-latin-wght-normal.woff2?url";
import oswaldUrl from "@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2?url";
import playfairDisplayUrl from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url";
import nunitoUrl from "@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url";
import dancingScriptUrl from "@fontsource-variable/dancing-script/files/dancing-script-latin-wght-normal.woff2?url";
import latoUrl from "@fontsource/lato/files/lato-latin-400-normal.woff2?url";
import antonUrl from "@fontsource/anton/files/anton-latin-400-normal.woff2?url";
import bebasNeueUrl from "@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url";
import poppinsUrl from "@fontsource/poppins/files/poppins-latin-400-normal.woff2?url";
import permanentMarkerUrl from "@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url";
import bangersUrl from "@fontsource/bangers/files/bangers-latin-400-normal.woff2?url";
import pressStartUrl from "@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2?url";
import pacificoUrl from "@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url";
import notoEmojiUrl from "@fontsource/noto-emoji/files/noto-emoji-emoji-400-normal.woff2?url";

/** Internal native-only face used for emoji glyphs missing from editor fonts. */
export const NATIVE_EMOJI_FONT_ID = "__clypra_noto_emoji";

type NativeBundledFont = {
  url: string;
  aliases: readonly string[];
};

// These are the same latin editor fonts imported by index.css. Registering a
// family once is sufficient for the native glyph cache; the resolved
// weight/style values remain in the frame snapshot and are applied by Rust's
// deterministic glyph rasterizer.
const BUNDLED_FONTS: readonly NativeBundledFont[] = [
  { url: interUrl, aliases: ["Inter", "Inter Variable"] },
  { url: montserratUrl, aliases: ["Montserrat", "Montserrat Variable"] },
  { url: geistUrl, aliases: ["Geist", "Geist Variable"] },
  { url: spaceGroteskUrl, aliases: ["Space Grotesk", "Space Grotesk Variable"] },
  { url: robotoUrl, aliases: ["Roboto", "Roboto Variable"] },
  { url: outfitUrl, aliases: ["Outfit", "Outfit Variable"] },
  { url: robotoCondensedUrl, aliases: ["Roboto Condensed", "Roboto Condensed Variable"] },
  { url: openSansUrl, aliases: ["Open Sans", "Open Sans Variable"] },
  { url: ralewayUrl, aliases: ["Raleway", "Raleway Variable"] },
  { url: oswaldUrl, aliases: ["Oswald", "Oswald Variable"] },
  { url: playfairDisplayUrl, aliases: ["Playfair Display", "Playfair Display Variable"] },
  { url: nunitoUrl, aliases: ["Nunito", "Nunito Variable"] },
  { url: dancingScriptUrl, aliases: ["Dancing Script", "Dancing Script Variable"] },
  { url: latoUrl, aliases: ["Lato"] },
  { url: antonUrl, aliases: ["Anton"] },
  { url: bebasNeueUrl, aliases: ["Bebas Neue"] },
  { url: poppinsUrl, aliases: ["Poppins"] },
  { url: permanentMarkerUrl, aliases: ["Permanent Marker"] },
  { url: bangersUrl, aliases: ["Bangers"] },
  { url: pressStartUrl, aliases: ["Press Start 2P"] },
  { url: pacificoUrl, aliases: ["Pacifico"] },
];

const assetByFontId = new Map<string, string>();
for (const font of BUNDLED_FONTS) {
  for (const alias of font.aliases) assetByFontId.set(alias.toLowerCase(), font.url);
}

const registrations = new Map<string, Promise<number>>();

function fontIdsKey(fontIds: readonly string[]): string[] {
  return [...new Set(fontIds.map((fontId) => fontId.trim()).filter(Boolean))];
}

async function registerBundledFont(fontId: string, url: string): Promise<number> {
  const existing = registrations.get(fontId.toLowerCase());
  if (existing) return existing;

  const pending = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Unable to load bundled font (${response.status})`);
      return response.arrayBuffer();
    })
    .then((bytes) => registerNativeFontBytes(fontId, bytes));
  registrations.set(fontId.toLowerCase(), pending);
  pending.catch(() => registrations.delete(fontId.toLowerCase()));
  return pending;
}

/**
 * Ensure all known editor fonts referenced by a native frame are available in
 * Rust before the frame is queued. Unknown/custom families intentionally do
 * not get a browser fallback; the native request will report the exact
 * missing-font error.
 */
export async function ensureNativeFontsRegistered(
  fontIds: readonly string[],
): Promise<void> {
  if (!isTauriRuntime()) return;
  const emojiFallback = registerBundledFont(NATIVE_EMOJI_FONT_ID, notoEmojiUrl);
  await Promise.all(
    [emojiFallback, ...fontIdsKey(fontIds).flatMap((fontId) => {
      const url = assetByFontId.get(fontId.toLowerCase());
      return url ? [registerBundledFont(fontId, url)] : [];
    })],
  );
}

export function getBundledNativeFontIds(): string[] {
  return BUNDLED_FONTS.flatMap(({ aliases }) => aliases);
}
