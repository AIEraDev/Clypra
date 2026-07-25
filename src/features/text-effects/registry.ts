/**
 * VireoStudio Text Effect Registry
 *
 * The single source of truth for all registered text effects.
 *
 * ─── How to add a new effect ──────────────────────────────────────────────────
 *
 *  1. Paste the studio-generated file into src/features/text-effects/effects/
 *  2. Add exactly one line at the bottom of the "REGISTERED EFFECTS" section:
 *
 *       import { MyEffectEngine } from "./effects/MyEffect";
 *       register("my-effect-id", MyEffectEngine);
 *
 *  That's it. The renderer and everything else update automatically.
 *  Effect definitions are now fetched dynamically from the API.
 *
 * ─── Studio known issue ───────────────────────────────────────────────────────
 *  If the generated drawFrame references an undefined `className` variable, remove
 *  or guard that block. This is a bug in the studio generator, not in your code.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { TextEffectDefinition } from "./types/types";
import { wrapText } from "./lib/helpers";
import { _buildConfig, resolveFontFamilyName } from "@clypra-studio/engine";

// ─── Internal registry state ──────────────────────────────────────────────────

type EffectConfig = Record<string, unknown> & { width: number; height: number; text: string };
type EngineInstance = { drawFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, ghostFrames?: ImageData[]): void };
type EffectEngineClass = new (config: EffectConfig) => EngineInstance;

const _engines = new Map<string, EffectEngineClass>();
const _definitions: TextEffectDefinition[] = []; // Empty - definitions now fetched from API

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register an effect engine by ID.
 * Definitions are fetched dynamically from the API; only engines are registered locally.
 */
export function register(id: string, Engine: EffectEngineClass): void {
  _engines.set(id, Engine);
}

/**
 * All registered effect definitions.
 * @deprecated This array is now empty. Use effectsStore to fetch definitions from the API.
 */
export const allTextEffects: TextEffectDefinition[] = _definitions;

/** @deprecated use allTextEffects */
export const allEffects = allTextEffects;

/**
 * Returns true when a registered engine exists for the given effect id.
 */
export function hasRegisteredEngine(id: string): boolean {
  return _engines.has(id);
}

/**
 * Renders a registered effect to any 2D canvas context.
 * Internally maps TextEffectDefinition → flat engine config and calls drawFrame.
 * The effect definition must be provided (typically fetched from the API).
 */
export function renderRegisteredEffect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: TextEffectDefinition, text: string, fontSize: number, canvasWidth: number, canvasHeight: number, time?: number, clipStartTime?: number, clipDuration?: number): void {
  const Engine = _engines.get(effect.id);
  if (!Engine) return;

  // Dynamic Bounding Box Word-Wrapping: Wrap sentences to fit canvasWidth * 0.8 boundary!
  ctx.save();
  ctx.font = `${effect.font?.style || "normal"} ${effect.font?.weight || "bold"} ${fontSize}px "${resolveFontFamilyName(effect.font?.family || "Arial")}"`;
  if (typeof (ctx as any).letterSpacing !== "undefined") {
    (ctx as any).letterSpacing = `${effect.font?.letterSpacing || 0}px`;
  }
  const maxWidth = canvasWidth * 0.8;
  const rawLines = text.split("\n");
  const wrappedLines: string[] = [];
  rawLines.forEach((rl) => {
    wrappedLines.push(...wrapText(ctx, rl, maxWidth));
  });
  ctx.restore();
  const wrappedText = wrappedLines.join("\n");

  const config = _buildConfig(effect, wrappedText, fontSize, canvasWidth, canvasHeight, time, clipStartTime, clipDuration);
  new Engine(config as any).drawFrame(ctx);
}

