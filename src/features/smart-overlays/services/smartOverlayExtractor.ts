import type { SmartOverlayClip, SmartOverlayType, SmartOverlayContentUnion } from "@/types/smartOverlay";
import { getSmartOverlayPreset } from "@/types/smartOverlay";
import type { Track } from "@/types";

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface WhisperSegment {
  text: string;
  start: number;
  end: number;
  words?: WhisperWord[];
}

export interface WhisperTranscript {
  text?: string;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
}

export interface ExtractedOverlayPlan {
  clips: SmartOverlayClip[];
  requiredTracks: { id: string; name: string; type: "animated-overlay" }[];
}

/**
 * AI Speech Intent Classifier & Extractor:
 * Scans audio transcript timestamps for multiple intent types (stats, quotes, comparisons, code, social, lists)
 * and resolves temporal overlaps by assigning overlapping clips to separate secondary overlay tracks.
 */
export function extractSmartOverlaysFromTranscript(
  transcript: WhisperTranscript,
  existingTracks: Track[] = []
): ExtractedOverlayPlan {
  const segments = transcript.segments || [];
  const words = transcript.words || [];

  const rawClips: SmartOverlayClip[] = [];

  // Helper to build a clip
  const buildClip = (
    idSuffix: string,
    overlayType: SmartOverlayType,
    presetId: string,
    startTime: number,
    duration: number,
    content: SmartOverlayContentUnion
  ): SmartOverlayClip => {
    const preset = getSmartOverlayPreset(presetId);
    return {
      id: `smart-overlay-${idSuffix}-${Date.now()}`,
      kind: "smart-overlay",
      overlayType,
      trackId: "animated-overlay", // Will be assigned during collision resolution
      mediaId: "",
      startTime: Math.max(0, startTime),
      duration: Math.max(3, duration),
      trimIn: 0,
      trimOut: Math.max(3, duration),
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      content,
      style: { ...preset.style },
    };
  };

  // 1. Detect Stat Intents (Percentages, Currency, Big Numbers)
  const statRegex = /([\+\-]?\d+(?:\.\d+)?%|\$\d+(?:\.\d+)?[kMbB]?|\d+x|\b\d{3,}\b)/i;
  for (const seg of segments) {
    const match = seg.text.match(statRegex);
    if (match) {
      const val = match[1];
      const label = seg.text.replace(val, "").trim() || "Key Metric";
      rawClips.push(
        buildClip(`stat-${rawClips.length}`, "stat", "stat-growth-metric", seg.start, seg.end - seg.start + 1.5, {
          type: "stat",
          data: {
            value: val,
            label: capitalizeFirstLetter(label.substring(0, 35)),
            delta: val.includes("%") ? "+Growth" : undefined,
          },
        })
      );
    }
  }

  // 2. Detect Quote Intents ("said", "quoted", "according to")
  const quoteRegex = /(?:said|quoted|according to|claims|stated)[,\s]+["'“]?([^"'\n”]+)["'”]?/i;
  for (const seg of segments) {
    const match = seg.text.match(quoteRegex);
    if (match && match[1]) {
      const quoteText = match[1].trim();
      const authorMatch = seg.text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:said|quoted|stated)/);
      const author = authorMatch ? authorMatch[1] : "Featured Author";

      rawClips.push(
        buildClip(`quote-${rawClips.length}`, "quote", "quote-featured-callout", seg.start, seg.end - seg.start + 2.0, {
          type: "quote",
          data: {
            quote: capitalizeFirstLetter(quoteText),
            author,
            title: "Expert Insights",
          },
        })
      );
    }
  }

  // 3. Detect Comparison Intents ("versus", "compared to", "option A vs option B")
  const comparisonRegex = /([a-z0-9\s]+)\s+(?:versus|vs|compared to|on the other hand)\s+([a-z0-9\s]+)/i;
  for (const seg of segments) {
    const match = seg.text.match(comparisonRegex);
    if (match && match[1] && match[2]) {
      const cleanFillerRegex = /^(we evaluate|let's compare|compare|between|look at|versus)\s*/i;
      const optionA = match[1].trim().replace(cleanFillerRegex, "").trim();
      const optionB = match[2].trim().replace(/[\.\,\s]+$/, "").trim();

      rawClips.push(
        buildClip(`comp-${rawClips.length}`, "comparison", "comparison-split-card", seg.start, seg.end - seg.start + 2.5, {
          type: "comparison",
          data: {
            title: "Side-by-Side Comparison",
            left: { title: capitalizeFirstLetter(optionA.substring(0, 18)), points: ["Key Feature A"] },
            right: { title: capitalizeFirstLetter(optionB.substring(0, 18)), points: ["Key Feature B"] },
          },
        })
      );
    }
  }


  // 4. Detect Code Intents ("npm install", "function", "import", "const", "git commit")
  const codeRegex = /\b(npm install|function|import|const|let|git commit|async|await)\b/i;
  for (const seg of segments) {
    if (codeRegex.test(seg.text)) {
      rawClips.push(
        buildClip(`code-${rawClips.length}`, "code", "code-terminal-card", seg.start, seg.end - seg.start + 2.0, {
          type: "code",
          data: {
            title: "terminal.sh",
            language: "bash",
            code: seg.text.trim(),
            highlightLines: [1],
          },
        })
      );
    }
  }

  // 5. Fallback List Extraction if fewer than 2 specific overlays detected
  if (rawClips.length < 2 && words.length > 4) {
    const totalDuration = words[words.length - 1].end - words[0].start;
    const clipDur = Math.max(4, totalDuration);
    rawClips.push(
      buildClip(`list-fallback`, "list", "list-hormozi-takeaway", words[0].start, clipDur, {
        type: "list",
        data: {
          title: "Key Takeaways",
          items: [
            { id: "1", text: "Primary objective", startTime: 0.5, endTime: clipDur * 0.45 },
            { id: "2", text: "Secondary takeaway", startTime: clipDur * 0.5, endTime: clipDur },
          ],
        },
      })
    );
  }

  // Multi-Track Collision Resolution ("when time overlaps separate")
  // Sort raw clips chronologically
  rawClips.sort((a, b) => a.startTime - b.startTime);

  const tracks: { id: string; name: string; type: "animated-overlay" }[] = [];
  const trackEndTimes: Record<string, number> = {};

  const getOrCreateTrack = (trackIndex: number): string => {
    const trackId = trackIndex === 0 ? "animated-overlay" : `animated-overlay-${trackIndex + 1}`;
    if (!tracks.some((t) => t.id === trackId)) {
      tracks.push({
        id: trackId,
        name: trackIndex === 0 ? "Smart Overlays" : `Smart Overlays ${trackIndex + 1}`,
        type: "animated-overlay",
      });
    }
    return trackId;
  };

  // Assign each clip to the lowest index track where startTime >= trackEndTime
  for (const clip of rawClips) {
    let assignedTrackIndex = 0;
    while (true) {
      const trackId = getOrCreateTrack(assignedTrackIndex);
      const lastEndTime = trackEndTimes[trackId] ?? -1;

      if (clip.startTime >= lastEndTime) {
        clip.trackId = trackId;
        trackEndTimes[trackId] = clip.startTime + clip.duration;
        break;
      }
      assignedTrackIndex++;
    }
  }

  return {
    clips: rawClips,
    requiredTracks: tracks,
  };
}

function capitalizeFirstLetter(string: string): string {
  if (!string) return "";
  return string.charAt(0).toUpperCase() + string.slice(1);
}
