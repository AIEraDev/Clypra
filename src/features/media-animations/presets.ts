/**
 * presets.ts — Four Initial Procedural Media Animation Presets
 *
 * These are the four immutable, procedural presets:
 *   1. media-slide-in-left   — Category: in  — Slides in from the left
 *   2. media-slide-in-right  — Category: in  — Slides in from the right
 *   3. media-slide-out-left  — Category: out — Slides out to the left
 *   4. media-slide-out-right — Category: out — Slides out to the right
 *
 * Design constraints (from product requirements):
 *   - Each direction is a SEPARATE preset — do NOT combine into one configurable animation
 *   - Direction is BAKED INTO the keyframe values — NOT a runtime parameter
 *   - No opacity track — keep presets minimal, exactly as specified
 *   - positionX keyframe values use normalized offscreen offsets in [-1, 1]:
 *       -1.0 = fully off-screen left  (runtime: pixelX = -1.0 * |offLeft|)
 *       +1.0 = fully off-screen right (runtime: pixelX = +1.0 * offRight)
 *        0.0 = original media position (no offset)
 *   - Exactly TWO keyframes per track: frame 0 and frame (durationFrames - 1)
 *   - renderMode: "procedural" — NO binary assets required
 *   - durationFrames: 30 (authored at 30fps)
 *
 * The Studio submits these drafts to the API. The API's compileCandidateManifest()
 * produces the final ImmutableMediaAnimationManifest with contentHash.
 */

import type { MediaAnimationDraftDocument, PropertyTrack } from "./types";

const DEFAULT_DURATION_FRAMES = 30;
const DEFAULT_FRAME_RATE = { numerator: 30, denominator: 1 };
const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };
const DEFAULT_SUPPORTED_MEDIA = ["image", "video"] as const;
const LAST_FRAME = DEFAULT_DURATION_FRAMES - 1; // 29

// ── Helper: create a two-keyframe positionX track ──────────────────────────

/**
 * Creates a positionX track with exactly two keyframes (frame 0 and last frame).
 *
 * For "in" presets:
 *   startValue = -1.0 or +1.0 (off-screen), endValue = 0.0 (resting)
 * For "out" presets:
 *   startValue = 0.0 (resting), endValue = -1.0 or +1.0 (off-screen)
 */
function makePositionXTrack(
  startValue: number,
  endValue: number,
): PropertyTrack {
  return {
    property: "positionX",
    keyframes: [
      {
        frame: 0,
        value: startValue,
        interpolation: "linear",
      },
      {
        frame: LAST_FRAME,
        value: endValue,
        interpolation: "linear",
      },
    ],
  };
}

// ── Shared draft skeleton ──────────────────────────────────────────────────

function makeDraftSkeleton(
  id: string,
  name: string,
  category: "in" | "out",
  tracks: PropertyTrack[],
): MediaAnimationDraftDocument {
  return {
    schemaVersion: 2,
    id,
    ownerId: 0, // Will be assigned by the API on creation
    name,
    description: "",
    family: "media_animation",
    category,
    supportedMediaTypes: [...DEFAULT_SUPPORTED_MEDIA],
    renderMode: "procedural",
    resolution: { ...DEFAULT_RESOLUTION },
    frameRate: { ...DEFAULT_FRAME_RATE },
    durationFrames: DEFAULT_DURATION_FRAMES,
    lockVersion: 1,
    tracks,
    layers: [],
    previewContext: {
      kind: "checkerboard",
      targetMediaType: "video",
      width: DEFAULT_RESOLUTION.width,
      height: DEFAULT_RESOLUTION.height,
    },
    status: "draft",
    createdAt: "",
    updatedAt: "",
  };
}

// ── 1. Media Slide In From Left ────────────────────────────────────────────
//
// frame 0:  positionX = -1.0  → media starts fully off-screen to the LEFT
// frame 29: positionX =  0.0  → media arrives at its authored/resting position
//
// Runtime pixel resolution:
//   offsetX = -1.0 * Math.abs(computeOffscreenDistances(...).offLeft)

const SLIDE_IN_LEFT_TRACKS: PropertyTrack[] = [
  makePositionXTrack(-1.0, 0.0),
];

export const MEDIA_SLIDE_IN_LEFT: MediaAnimationDraftDocument =
  makeDraftSkeleton(
    "media-slide-in-left",
    "Media Slide In From Left",
    "in",
    SLIDE_IN_LEFT_TRACKS,
  );

// ── 2. Media Slide In From Right ───────────────────────────────────────────
//
// frame 0:  positionX = +1.0  → media starts fully off-screen to the RIGHT
// frame 29: positionX =  0.0  → media arrives at its authored/resting position
//
// Runtime pixel resolution:
//   offsetX = +1.0 * computeOffscreenDistances(...).offRight

const SLIDE_IN_RIGHT_TRACKS: PropertyTrack[] = [
  makePositionXTrack(1.0, 0.0),
];

export const MEDIA_SLIDE_IN_RIGHT: MediaAnimationDraftDocument =
  makeDraftSkeleton(
    "media-slide-in-right",
    "Media Slide In From Right",
    "in",
    SLIDE_IN_RIGHT_TRACKS,
  );

// ── 3. Media Slide Out To Left ─────────────────────────────────────────────
//
// frame 0:  positionX =  0.0  → media begins at its authored/resting position
// frame 29: positionX = -1.0  → media ends fully off-screen to the LEFT
//
// Runtime pixel resolution:
//   offsetX = -1.0 * Math.abs(computeOffscreenDistances(...).offLeft)

const SLIDE_OUT_LEFT_TRACKS: PropertyTrack[] = [
  makePositionXTrack(0.0, -1.0),
];

export const MEDIA_SLIDE_OUT_LEFT: MediaAnimationDraftDocument =
  makeDraftSkeleton(
    "media-slide-out-left",
    "Media Slide Out To Left",
    "out",
    SLIDE_OUT_LEFT_TRACKS,
  );

// ── 4. Media Slide Out To Right ────────────────────────────────────────────
//
// frame 0:  positionX =  0.0  → media begins at its authored/resting position
// frame 29: positionX = +1.0  → media ends fully off-screen to the RIGHT
//
// Runtime pixel resolution:
//   offsetX = +1.0 * computeOffscreenDistances(...).offRight

const SLIDE_OUT_RIGHT_TRACKS: PropertyTrack[] = [
  makePositionXTrack(0.0, 1.0),
];

export const MEDIA_SLIDE_OUT_RIGHT: MediaAnimationDraftDocument =
  makeDraftSkeleton(
    "media-slide-out-right",
    "Media Slide Out To Right",
    "out",
    SLIDE_OUT_RIGHT_TRACKS,
  );

// ── Registry ───────────────────────────────────────────────────────────────

/**
 * All four initial procedural presets keyed by their stable preset ID.
 *
 * These are the local Studio-side draft documents used to create API drafts.
 * The actual published manifests (ImmutableMediaAnimationManifest) are
 * compiled server-side via POST /api/v1/media-animation-drafts/:id/validate.
 */
export const MEDIA_ANIMATION_PRESET_DRAFTS: Record<
  string,
  MediaAnimationDraftDocument
> = {
  "media-slide-in-left": MEDIA_SLIDE_IN_LEFT,
  "media-slide-in-right": MEDIA_SLIDE_IN_RIGHT,
  "media-slide-out-left": MEDIA_SLIDE_OUT_LEFT,
  "media-slide-out-right": MEDIA_SLIDE_OUT_RIGHT,
};

/** All preset keys in canonical order */
export const MEDIA_ANIMATION_PRESET_KEYS = [
  "media-slide-in-left",
  "media-slide-in-right",
  "media-slide-out-left",
  "media-slide-out-right",
] as const;

export type MediaAnimationPresetKey =
  (typeof MEDIA_ANIMATION_PRESET_KEYS)[number];
