/**
 * Bundled Starter Stickers for Clypra Desktop
 *
 * Pre-bundled offline assets that are available immediately on first launch
 * without requiring any network requests or API downloads.
 */

import type { StickerItem } from "./api/stickersApi";

export interface BundledSticker extends StickerItem {
  lottieData: Record<string, any>;
  svgThumbnail: string; // SVG data URL for instant zero-fetch thumbnail rendering
}

function makeStarLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 60,
    w: 500,
    h: 500,
    nm: "Golden Star",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Star",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: {
            a: 1,
            k: [
              { t: 0, s: [0] },
              { t: 60, s: [360] },
            ],
          },
          p: { a: 0, k: [250, 250, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 100] },
              { t: 30, s: [120, 120, 100] },
              { t: 60, s: [100, 100, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "sr",
            sy: 1,
            d: 1,
            pt: { a: 0, k: 5 },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: 0 },
            ir: { a: 0, k: 60 },
            is: { a: 0, k: 0 },
            or: { a: 0, k: 140 },
            os: { a: 0, k: 0 },
            nm: "Star Path",
          },
          {
            ty: "fl",
            c: { a: 0, k: [1, 0.84, 0, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
          {
            ty: "st",
            c: { a: 0, k: [1, 0.65, 0, 1] },
            o: { a: 0, k: 100 },
            w: { a: 0, k: 12 },
            lc: 2,
            lj: 2,
            nm: "Stroke",
          },
        ],
      },
    ],
  };
}

function makeHeartLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 45,
    w: 500,
    h: 500,
    nm: "Pulsing Heart",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Heart",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [250, 250, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 100] },
              { t: 15, s: [125, 125, 100] },
              { t: 25, s: [105, 105, 100] },
              { t: 35, s: [120, 120, 100] },
              { t: 45, s: [100, 100, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "sh",
            nm: "Heart Path",
            ks: {
              a: 0,
              k: {
                c: true,
                i: [
                  [0, -40],
                  [-40, 0],
                  [0, 50],
                  [40, 0],
                ],
                o: [
                  [0, 50],
                  [40, 0],
                  [0, -40],
                  [-40, 0],
                ],
                v: [
                  [0, 120],
                  [120, -20],
                  [0, -80],
                  [-120, -20],
                ],
              },
            },
          },
          {
            ty: "fl",
            c: { a: 0, k: [0.95, 0.15, 0.3, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
    ],
  };
}

function makeFireLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 45,
    w: 500,
    h: 500,
    nm: "Fire Burst",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Flame Outer",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: {
            a: 1,
            k: [
              { t: 0, s: [-5] },
              { t: 22, s: [5] },
              { t: 45, s: [-5] },
            ],
          },
          p: { a: 0, k: [250, 260, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [95, 105, 100] },
              { t: 22, s: [105, 95, 100] },
              { t: 45, s: [95, 105, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "el",
            p: { a: 0, k: [0, 0] },
            s: { a: 0, k: [180, 220] },
            nm: "Flame Base",
          },
          {
            ty: "fl",
            c: { a: 0, k: [1, 0.35, 0.05, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
      {
        ddd: 0,
        ind: 2,
        ty: 4,
        nm: "Flame Core",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [250, 270, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 100] },
              { t: 22, s: [120, 110, 100] },
              { t: 45, s: [100, 100, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "el",
            p: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 130] },
            nm: "Core Base",
          },
          {
            ty: "fl",
            c: { a: 0, k: [1, 0.85, 0.1, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
    ],
  };
}

function makeThumbsUpLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 45,
    w: 500,
    h: 500,
    nm: "Thumbs Up",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Hand",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: {
            a: 1,
            k: [
              { t: 0, s: [-10] },
              { t: 22, s: [10] },
              { t: 45, s: [-10] },
            ],
          },
          p: { a: 0, k: [250, 250, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 100] },
              { t: 22, s: [115, 115, 100] },
              { t: 45, s: [100, 100, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "rc",
            p: { a: 0, k: [0, 30] },
            s: { a: 0, k: [160, 120] },
            r: { a: 0, k: 25 },
            nm: "Fist",
          },
          {
            ty: "rc",
            p: { a: 0, k: [-40, -60] },
            s: { a: 0, k: [60, 120] },
            r: { a: 0, k: 25 },
            nm: "Thumb",
          },
          {
            ty: "fl",
            c: { a: 0, k: [0.98, 0.75, 0.15, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
    ],
  };
}

function makeArrowRightLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 45,
    w: 500,
    h: 500,
    nm: "Arrow Right",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Arrow",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: {
            a: 1,
            k: [
              { t: 0, s: [230, 250, 0] },
              { t: 22, s: [270, 250, 0] },
              { t: 45, s: [230, 250, 0] },
            ],
          },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        shapes: [
          {
            ty: "rc",
            p: { a: 0, k: [-50, 0] },
            s: { a: 0, k: [140, 50] },
            r: { a: 0, k: 15 },
            nm: "Stem",
          },
          {
            ty: "sr",
            sy: 1,
            d: 1,
            pt: { a: 0, k: 3 },
            p: { a: 0, k: [40, 0] },
            r: { a: 0, k: 90 },
            ir: { a: 0, k: 50 },
            is: { a: 0, k: 0 },
            or: { a: 0, k: 100 },
            os: { a: 0, k: 0 },
            nm: "Head",
          },
          {
            ty: "fl",
            c: { a: 0, k: [0.35, 0.55, 0.95, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
    ],
  };
}

function makeSparklesLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 60,
    w: 500,
    h: 500,
    nm: "Sparkles",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Sparkle Big",
        sr: 1,
        ks: {
          o: {
            a: 1,
            k: [
              { t: 0, s: [40] },
              { t: 30, s: [100] },
              { t: 60, s: [40] },
            ],
          },
          r: {
            a: 1,
            k: [
              { t: 0, s: [0] },
              { t: 60, s: [180] },
            ],
          },
          p: { a: 0, k: [220, 240, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [80, 80, 100] },
              { t: 30, s: [120, 120, 100] },
              { t: 60, s: [80, 80, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "sr",
            sy: 1,
            d: 1,
            pt: { a: 0, k: 4 },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: 0 },
            ir: { a: 0, k: 25 },
            is: { a: 0, k: 0 },
            or: { a: 0, k: 90 },
            os: { a: 0, k: 0 },
            nm: "Star 4",
          },
          {
            ty: "fl",
            c: { a: 0, k: [1, 0.85, 0.2, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
    ],
  };
}

function makeVerifiedBadgeLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 45,
    w: 500,
    h: 500,
    nm: "Verified Badge",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Badge",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: {
            a: 1,
            k: [
              { t: 0, s: [0] },
              { t: 45, s: [360] },
            ],
          },
          p: { a: 0, k: [250, 250, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        shapes: [
          {
            ty: "sr",
            sy: 1,
            d: 1,
            pt: { a: 0, k: 12 },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: 0 },
            ir: { a: 0, k: 120 },
            is: { a: 0, k: 0 },
            or: { a: 0, k: 145 },
            os: { a: 0, k: 0 },
            nm: "Burst",
          },
          {
            ty: "fl",
            c: { a: 0, k: [0.15, 0.65, 0.98, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
    ],
  };
}

function makeSpeechCalloutLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 45,
    w: 500,
    h: 500,
    nm: "Speech Callout",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Bubble",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [250, 240, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [95, 95, 100] },
              { t: 22, s: [105, 105, 100] },
              { t: 45, s: [95, 95, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "rc",
            p: { a: 0, k: [0, 0] },
            s: { a: 0, k: [260, 180] },
            r: { a: 0, k: 30 },
            nm: "Box",
          },
          {
            ty: "fl",
            c: { a: 0, k: [0.95, 0.95, 0.98, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
          {
            ty: "st",
            c: { a: 0, k: [0.2, 0.2, 0.3, 1] },
            o: { a: 0, k: 100 },
            w: { a: 0, k: 12 },
            lc: 2,
            lj: 2,
            nm: "Stroke",
          },
        ],
      },
    ],
  };
}

function makeCelebrationPopperLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 45,
    w: 500,
    h: 500,
    nm: "Party Popper",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Cone",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: {
            a: 1,
            k: [
              { t: 0, s: [-40] },
              { t: 22, s: [-30] },
              { t: 45, s: [-40] },
            ],
          },
          p: { a: 0, k: [220, 270, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 100] },
              { t: 15, s: [115, 115, 100] },
              { t: 45, s: [100, 100, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "sr",
            sy: 1,
            d: 1,
            pt: { a: 0, k: 3 },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: 0 },
            ir: { a: 0, k: 40 },
            is: { a: 0, k: 0 },
            or: { a: 0, k: 90 },
            os: { a: 0, k: 0 },
            nm: "Popper Cone",
          },
          {
            ty: "fl",
            c: { a: 0, k: [0.95, 0.6, 0.1, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
    ],
  };
}

function makeSubscribeBadgeLottie(): Record<string, any> {
  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 45,
    w: 500,
    h: 500,
    nm: "Subscribe CTA",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Button",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [250, 250, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 100] },
              { t: 22, s: [110, 110, 100] },
              { t: 45, s: [100, 100, 100] },
            ],
          },
        },
        shapes: [
          {
            ty: "rc",
            p: { a: 0, k: [0, 0] },
            s: { a: 0, k: [320, 110] },
            r: { a: 0, k: 30 },
            nm: "Rect",
          },
          {
            ty: "fl",
            c: { a: 0, k: [0.9, 0.15, 0.15, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            nm: "Fill",
          },
        ],
      },
    ],
  };
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const STARTER_STICKERS: BundledSticker[] = [
  {
    id: "starter-golden-star",
    name: "Golden Star",
    category: "reaction",
    tags: ["star", "gold", "favorite", "award"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 64,36 98,36 70,57 81,91 50,70 19,91 30,57 2,36 36,36" fill="#FFD700" stroke="#FFA500" stroke-width="4"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 64,36 98,36 70,57 81,91 50,70 19,91 30,57 2,36 36,36" fill="#FFD700" stroke="#FFA500" stroke-width="4"/></svg>`,
    ),
    lottieData: makeStarLottie(),
    license: {
      spdx: "CC0-1.0",
      author: "Clypra Open Media",
      attributionRequired: false,
    },
  },
  {
    id: "starter-pulsing-heart",
    name: "Pulsing Heart",
    category: "reaction",
    tags: ["heart", "love", "like", "reaction"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50,85 C20,60 5,40 5,25 C5,10 18,5 30,5 C40,5 47,12 50,18 C53,12 60,5 70,5 C82,5 95,10 95,25 C95,40 80,60 50,85 Z" fill="#F43F5E"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50,85 C20,60 5,40 5,25 C5,10 18,5 30,5 C40,5 47,12 50,18 C53,12 60,5 70,5 C82,5 95,10 95,25 C95,40 80,60 50,85 Z" fill="#F43F5E"/></svg>`,
    ),
    lottieData: makeHeartLottie(),
    license: {
      spdx: "CC-BY-4.0",
      author: "Google Noto Emoji Team",
      attributionRequired: true,
      attributionText: "Designed by Google Noto Emoji under CC BY 4.0",
      sourceUrl: "https://github.com/googlefonts/noto-emoji",
    },
  },
  {
    id: "starter-fire-burst",
    name: "Fire Burst",
    category: "reaction",
    tags: ["fire", "hot", "flame", "lit"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50,10 C50,10 65,35 60,50 C70,45 75,35 75,35 C85,55 80,85 50,95 C20,85 15,55 25,35 C25,35 30,45 40,50 C35,35 50,10 50,10 Z" fill="#F97316"/><path d="M50,50 C45,60 45,75 50,80 C55,75 55,60 50,50 Z" fill="#FACC15"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50,10 C50,10 65,35 60,50 C70,45 75,35 75,35 C85,55 80,85 50,95 C20,85 15,55 25,35 C25,35 30,45 40,50 C35,35 50,10 50,10 Z" fill="#F97316"/><path d="M50,50 C45,60 45,75 50,80 C55,75 55,60 50,50 Z" fill="#FACC15"/></svg>`,
    ),
    lottieData: makeFireLottie(),
    license: {
      spdx: "CC-BY-4.0",
      author: "Google Noto Emoji Team",
      attributionRequired: true,
      attributionText: "Designed by Google Noto Emoji under CC BY 4.0",
      sourceUrl: "https://github.com/googlefonts/noto-emoji",
    },
  },
  {
    id: "starter-thumbs-up",
    name: "Thumbs Up",
    category: "social",
    tags: ["thumbsup", "like", "approve", "yes"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M30,45 L15,45 L15,85 L30,85 Z M35,85 L65,85 C72,85 78,80 80,73 L88,52 C89,50 89,47 87,45 C85,42 82,40 78,40 L55,40 L58,25 C59,20 56,15 50,15 L45,18 L35,45 Z" fill="#F59E0B"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M30,45 L15,45 L15,85 L30,85 Z M35,85 L65,85 C72,85 78,80 80,73 L88,52 C89,50 89,47 87,45 C85,42 82,40 78,40 L55,40 L58,25 C59,20 56,15 50,15 L45,18 L35,45 Z" fill="#F59E0B"/></svg>`,
    ),
    lottieData: makeThumbsUpLottie(),
    license: {
      spdx: "CC-BY-4.0",
      author: "Google Noto Emoji Team",
      attributionRequired: true,
      attributionText: "Designed by Google Noto Emoji under CC BY 4.0",
      sourceUrl: "https://github.com/googlefonts/noto-emoji",
    },
  },
  {
    id: "starter-arrow-pointer",
    name: "Arrow Pointer",
    category: "arrow",
    tags: ["arrow", "right", "next", "pointer"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20,40 L55,40 L55,20 L90,50 L55,80 L55,60 L20,60 Z" fill="#3B82F6"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20,40 L55,40 L55,20 L90,50 L55,80 L55,60 L20,60 Z" fill="#3B82F6"/></svg>`,
    ),
    lottieData: makeArrowRightLottie(),
    license: {
      spdx: "CC0-1.0",
      author: "Kenney Assets",
      attributionRequired: false,
      sourceUrl: "https://kenney.nl",
    },
  },
  {
    id: "starter-sparkle-magic",
    name: "Magic Sparkles",
    category: "celebration",
    tags: ["sparkle", "magic", "stars", "shine"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50,10 Q50,45 85,50 Q50,55 50,90 Q50,55 15,50 Q50,45 50,10 Z" fill="#FBBF24"/><path d="M78,18 Q78,32 92,35 Q78,38 78,52 Q78,38 64,35 Q78,32 78,18 Z" fill="#FBBF24"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50,10 Q50,45 85,50 Q50,55 50,90 Q50,55 15,50 Q50,45 50,10 Z" fill="#FBBF24"/><path d="M78,18 Q78,32 92,35 Q78,38 78,52 Q78,38 64,35 Q78,32 78,18 Z" fill="#FBBF24"/></svg>`,
    ),
    lottieData: makeSparklesLottie(),
    license: {
      spdx: "CC-BY-4.0",
      author: "Google Noto Emoji Team",
      attributionRequired: true,
      attributionText: "Designed by Google Noto Emoji under CC BY 4.0",
      sourceUrl: "https://github.com/googlefonts/noto-emoji",
    },
  },
  {
    id: "starter-verified-badge",
    name: "Verified Badge",
    category: "shape",
    tags: ["verified", "badge", "check", "official"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,10 62,15 75,10 82,22 95,25 95,38 103,48 97,60 101,72 90,80 88,93 75,93 67,102 54,98 43,103 36,93 23,93 21,80 10,72 14,60 8,48 16,38 16,25 29,22 36,10 49,15" fill="#0EA5E9"/><polyline points="35,52 46,63 68,38" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,10 62,15 75,10 82,22 95,25 95,38 103,48 97,60 101,72 90,80 88,93 75,93 67,102 54,98 43,103 36,93 23,93 21,80 10,72 14,60 8,48 16,38 16,25 29,22 36,10 49,15" fill="#0EA5E9"/><polyline points="35,52 46,63 68,38" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    ),
    lottieData: makeVerifiedBadgeLottie(),
    license: {
      spdx: "CC0-1.0",
      author: "Kenney Assets",
      attributionRequired: false,
      sourceUrl: "https://kenney.nl",
    },
  },
  {
    id: "starter-speech-callout",
    name: "Speech Bubble",
    category: "callout",
    tags: ["speech", "bubble", "callout", "talk"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M15,20 C15,15 20,10 25,10 L75,10 C80,10 85,15 85,20 L85,60 C85,65 80,70 75,70 L35,70 L20,85 L22,70 L15,70 C10,70 5,65 5,60 Z" fill="#F8FAFC" stroke="#334155" stroke-width="4"/><circle cx="35" cy="40" r="4" fill="#334155"/><circle cx="50" cy="40" r="4" fill="#334155"/><circle cx="65" cy="40" r="4" fill="#334155"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M15,20 C15,15 20,10 25,10 L75,10 C80,10 85,15 85,20 L85,60 C85,65 80,70 75,70 L35,70 L20,85 L22,70 L15,70 C10,70 5,65 5,60 Z" fill="#F8FAFC" stroke="#334155" stroke-width="4"/><circle cx="35" cy="40" r="4" fill="#334155"/><circle cx="50" cy="40" r="4" fill="#334155"/><circle cx="65" cy="40" r="4" fill="#334155"/></svg>`,
    ),
    lottieData: makeSpeechCalloutLottie(),
    license: {
      spdx: "CC0-1.0",
      author: "Kenney Assets",
      attributionRequired: false,
      sourceUrl: "https://kenney.nl",
    },
  },
  {
    id: "starter-party-popper",
    name: "Party Popper",
    category: "celebration",
    tags: ["party", "popper", "celebration", "confetti"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="20,80 40,40 60,60" fill="#F59E0B"/><circle cx="55" cy="30" r="4" fill="#EF4444"/><circle cx="70" cy="45" r="3" fill="#3B82F6"/><circle cx="75" cy="25" r="4" fill="#10B981"/><circle cx="45" cy="20" r="3" fill="#8B5CF6"/><circle cx="65" cy="15" r="4" fill="#EC4899"/></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="20,80 40,40 60,60" fill="#F59E0B"/><circle cx="55" cy="30" r="4" fill="#EF4444"/><circle cx="70" cy="45" r="3" fill="#3B82F6"/><circle cx="75" cy="25" r="4" fill="#10B981"/><circle cx="45" cy="20" r="3" fill="#8B5CF6"/><circle cx="65" cy="15" r="4" fill="#EC4899"/></svg>`,
    ),
    lottieData: makeCelebrationPopperLottie(),
    license: {
      spdx: "CC-BY-4.0",
      author: "Google Noto Emoji Team",
      attributionRequired: true,
      attributionText: "Designed by Google Noto Emoji under CC BY 4.0",
      sourceUrl: "https://github.com/googlefonts/noto-emoji",
    },
  },
  {
    id: "starter-subscribe-badge",
    name: "Subscribe CTA",
    category: "social",
    tags: ["subscribe", "social", "cta", "button"],
    kind: "lottie",
    animated: true,
    thumbnailUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="32" width="80" height="36" rx="8" fill="#DC2626"/><text x="50" y="55" font-family="sans-serif" font-size="12" font-weight="bold" fill="#FFFFFF" text-anchor="middle">SUBSCRIBE</text></svg>`,
    ),
    svgThumbnail: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="32" width="80" height="36" rx="8" fill="#DC2626"/><text x="50" y="55" font-family="sans-serif" font-size="12" font-weight="bold" fill="#FFFFFF" text-anchor="middle">SUBSCRIBE</text></svg>`,
    ),
    lottieData: makeSubscribeBadgeLottie(),
    license: {
      spdx: "LicenseRef-Clypra-Original",
      author: "Clypra Studio Team",
      attributionRequired: false,
    },
  },
];

export function getStarterStickers(): StickerItem[] {
  return STARTER_STICKERS.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    tags: s.tags,
    kind: s.kind,
    animated: s.animated,
    thumbnailUrl: s.thumbnailUrl,
    license: s.license,
  }));
}
