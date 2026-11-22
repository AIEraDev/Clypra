/**
 * propertyEditTelemetry.ts
 *
 * Dedicated performance and interaction telemetry for Clypra property adjustments
 * across Video, Audio, Text, and Color Adjustments.
 *
 * Responsibilities:
 * - Tracks gesture lifecycle (drag start, progress sample count, drag commit) for SliderTrack.
 * - Tracks numeric input commits and stepper clicks for NumericControl.
 * - Tracks discrete property commands (alignments, resets, fit mode, unlink/relink).
 * - Aggregates metrics (durationMs, sampleCount, inputKind, propertyName, category).
 * - Enqueues non-blocking NDJSON entries to PerfLogService under "property-edit-rollup".
 *
 * Invariants:
 * - Strictly zero PII: property identifier, duration in ms, sample count, and timestamp only.
 * - Non-blocking fire-and-forget: errors in telemetry never interrupt user interaction.
 * - Zero allocation on rapid scrub/drag hot path.
 */

import { perfLogService } from "@/services/perfLogService";

export type PropertyCategory =
  "video" | "audio" | "text" | "adjust" | "unknown";
export type PropertyInputKind =
  "slider_drag" | "numeric_stepper" | "numeric_input" | "button_action";
export type KeyframeAction = "add" | "remove" | "update" | "evaluate";

export interface PropertyEditTelemetryPayload {
  category: PropertyCategory;
  property: string;
  inputKind: PropertyInputKind;
  durationMs: number;
  sampleCount?: number;
  direction?: "up" | "down";
  action?: string;
  timeSeconds?: number;
  timestampEpochMs: number;
}

export class PropertyEditTelemetryCollector {
  private buffer: PropertyEditTelemetryPayload[] = [];
  private maxBufferSize = 100;

  /** Record a slider drag interaction span */
  public recordSliderDrag(input: {
    property: string;
    category?: PropertyCategory;
    durationMs: number;
    sampleCount: number;
  }): void {
    this.record({
      category: input.category || "unknown",
      property: input.property,
      inputKind: "slider_drag",
      durationMs: Math.max(0, Math.round(input.durationMs)),
      sampleCount: input.sampleCount,
      timestampEpochMs: Date.now(),
    });
  }

  /** Record a numeric input commit (blur or enter) */
  public recordNumericCommit(input: {
    property: string;
    category?: PropertyCategory;
    durationMs: number;
  }): void {
    this.record({
      category: input.category || "unknown",
      property: input.property,
      inputKind: "numeric_input",
      durationMs: Math.max(0, Math.round(input.durationMs)),
      timestampEpochMs: Date.now(),
    });
  }

  /** Record a numeric stepper click */
  public recordNumericStep(input: {
    property: string;
    category?: PropertyCategory;
    direction: "up" | "down";
  }): void {
    this.record({
      category: input.category || "unknown",
      property: input.property,
      inputKind: "numeric_stepper",
      direction: input.direction,
      durationMs: 0,
      timestampEpochMs: Date.now(),
    });
  }

  /** Record a button action (alignment, reset, fit mode, link/unlink) */
  public recordButtonAction(input: {
    action: string;
    category?: PropertyCategory;
    property?: string;
  }): void {
    this.record({
      category: input.category || "unknown",
      property: input.property || input.action,
      inputKind: "button_action",
      action: input.action,
      durationMs: 0,
      timestampEpochMs: Date.now(),
    });
  }

  /** Record a keyframe lifecycle event without exposing clip or path identity. */
  public recordKeyframeAction(input: {
    property: string;
    category?: PropertyCategory;
    action: KeyframeAction;
    timeSeconds: number;
  }): void {
    this.record({
      category: input.category || "unknown",
      property: input.property,
      inputKind: "button_action",
      action: `keyframe-${input.action}`,
      durationMs: 0,
      timeSeconds: Math.max(0, input.timeSeconds),
      timestampEpochMs: Date.now(),
    });
  }

  /** Record a sampled keyframe evaluation, throttled by the caller's sampling cadence. */
  public recordKeyframeEvaluation(input: {
    property: string;
    category?: PropertyCategory;
    timeSeconds: number;
    source: "exact" | "interpolated" | "default";
  }): void {
    this.record({
      category: input.category || "unknown",
      property: input.property,
      inputKind: "button_action",
      action: `keyframe-evaluate-${input.source}`,
      durationMs: 0,
      timeSeconds: Math.max(0, input.timeSeconds),
      timestampEpochMs: Date.now(),
    });
  }

  private record(payload: PropertyEditTelemetryPayload): void {
    try {
      if (this.buffer.length >= this.maxBufferSize) {
        this.buffer.shift();
      }
      this.buffer.push(payload);

      const sessionId = perfLogService.getSessionId() ?? "session";
      perfLogService.enqueue({
        kind: "property-edit-rollup",
        sessionId,
        timestampEpochMs: payload.timestampEpochMs,
        payload,
      });
    } catch {
      // Fire-and-forget: Never throw into the UI interaction path
    }
  }

  /** For unit testing / verification inspection */
  public getRecentEntries(): PropertyEditTelemetryPayload[] {
    return [...this.buffer];
  }

  /** Clear buffer (for tests) */
  public clear(): void {
    this.buffer = [];
  }
}

export const propertyEditTelemetry = new PropertyEditTelemetryCollector();
