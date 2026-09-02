/**
 * SubtitleParserWorkerClient — Main-Thread Client for SubtitleParserWorker
 *
 * Provides off-thread subtitle parsing (SRT, VTT, ASS, Whisper) and text layout
 * via WorkerBus with synchronous fallbacks for non-worker environments.
 */

import { WorkerBus } from "./workerBus";
import type {
  SubtitleParserWorkerRequest,
  SubtitleParserWorkerResponse,
  SubtitleFormat,
  WhisperWordSegment,
  ParsedCaptionCue,
  ParseResult,
  LayoutResult,
  LayoutedCaptionCue,
} from "@/workers/types";

export class SubtitleParserWorkerClient {
  private readonly bus: WorkerBus<
    SubtitleParserWorkerRequest,
    SubtitleParserWorkerResponse
  >;

  constructor() {
    this.bus = new WorkerBus(
      () =>
        new Worker(
          new URL("../../workers/subtitleParser.worker.ts", import.meta.url),
          { type: "module" },
        ),
      { name: "SubtitleParserWorker", autoRestart: true },
    );
  }

  /**
   * Parse subtitle text or Whisper segments into standardized ParsedCaptionCues.
   */
  async parseSubtitles(
    format: SubtitleFormat,
    rawText?: string,
    whisperSegments?: WhisperWordSegment[],
  ): Promise<ParseResult> {
    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return this.fallbackParseSubtitles(format, rawText, whisperSegments);
    }

    try {
      return await this.bus.send<ParseResult>({
        type: "PARSE_SUBTITLES",
        format,
        rawText,
        whisperSegments,
      } as any);
    } catch {
      return this.fallbackParseSubtitles(format, rawText, whisperSegments);
    }
  }

  /**
   * Compute bounding box metrics and word wrapping for caption cues.
   */
  async layoutCues(
    cues: ParsedCaptionCue[],
    options: {
      fontFamily: string;
      fontSize: number;
      canvasWidth: number;
      canvasHeight: number;
      maxLineWidthRatio?: number;
    },
  ): Promise<LayoutResult> {
    const {
      fontFamily,
      fontSize,
      canvasWidth,
      canvasHeight,
      maxLineWidthRatio = 0.85,
    } = options;

    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return this.fallbackLayoutCues(cues, canvasWidth, canvasHeight, fontSize);
    }

    try {
      return await this.bus.send<LayoutResult>({
        type: "LAYOUT_CUES",
        cues,
        fontFamily,
        fontSize,
        canvasWidth,
        canvasHeight,
        maxLineWidthRatio,
      } as any);
    } catch {
      return this.fallbackLayoutCues(cues, canvasWidth, canvasHeight, fontSize);
    }
  }

  dispose(): void {
    this.bus.dispose();
  }

  // ─── Main-Thread Fallback ───────────────────────────────────────────────────

  private fallbackParseSubtitles(
    _format: SubtitleFormat,
    rawText = "",
    whisperSegments: WhisperWordSegment[] = [],
  ): ParseResult {
    const cues: ParsedCaptionCue[] = [];

    if (whisperSegments && whisperSegments.length > 0) {
      for (let i = 0; i < whisperSegments.length; i += 6) {
        const chunk = whisperSegments.slice(i, i + 6);
        cues.push({
          id: `cue-${i}`,
          startTime: chunk[0].startTime,
          endTime: chunk[chunk.length - 1].endTime,
          text: chunk.map((w) => w.word).join(" "),
          words: chunk.map((w) => ({
            word: w.word,
            startTime: w.startTime,
            endTime: w.endTime,
          })),
        });
      }
    } else if (rawText) {
      const blocks = rawText.split(/\n\n+/);
      let idx = 1;
      for (const block of blocks) {
        const lines = block.split("\n").filter(Boolean);
        if (lines.length >= 2) {
          cues.push({
            id: `cue-${idx++}`,
            startTime: (idx - 1) * 3,
            endTime: idx * 3,
            text: lines[lines.length - 1].replace(/<[^>]*>/g, ""),
          });
        }
      }
    }

    const durationSeconds =
      cues.length > 0 ? cues[cues.length - 1].endTime : 0;

    return {
      type: "PARSE_RESULT",
      id: "fallback",
      cues,
      durationSeconds,
      parseMs: 0,
    };
  }

  private fallbackLayoutCues(
    cues: ParsedCaptionCue[],
    canvasWidth: number,
    canvasHeight: number,
    fontSize: number,
  ): LayoutResult {
    const layoutedCues: LayoutedCaptionCue[] = cues.map((cue) => {
      const estimatedWidth = Math.min(canvasWidth * 0.8, cue.text.length * fontSize * 0.55);
      const estimatedHeight = fontSize * 1.5;
      return {
        ...cue,
        boundingBox: {
          x: Math.round((canvasWidth - estimatedWidth) / 2),
          y: Math.round(canvasHeight - estimatedHeight - canvasHeight * 0.1),
          width: Math.round(estimatedWidth),
          height: Math.round(estimatedHeight),
        },
      };
    });

    return {
      type: "LAYOUT_RESULT",
      id: "fallback",
      cues: layoutedCues,
      layoutMs: 0,
    };
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

let clientInstance: SubtitleParserWorkerClient | null = null;

export function getSubtitleParserWorkerClient(): SubtitleParserWorkerClient {
  if (!clientInstance) {
    clientInstance = new SubtitleParserWorkerClient();
  }
  return clientInstance;
}
