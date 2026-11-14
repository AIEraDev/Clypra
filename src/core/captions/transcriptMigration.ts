/**
 * Clypra Caption & Transcript Migration Engine
 *
 * Migrates existing v1.5.0 caption TextClips (the active visual representation)
 * into the canonical v2 Transcript model with zero data loss.
 */

import type { Clip, Project, TextClip } from "@/types";
import type { CaptionTrack, Transcript, TranscriptWord } from "@/types/captions";
import { CAPTION_MODEL_VERSION } from "@/types/captions";

export interface ProjectMigrationInput {
  project: Project;
  clips: Clip[];
  captionTracks?: CaptionTrack[];
}

export interface ProjectMigrationResult {
  project: Project;
  clips: Clip[];
  captionTracks: CaptionTrack[];
  migrated: boolean;
  backupPayload?: {
    backupFileName: string;
    backupContent: string;
    writtenPath?: string;
  };
}

/**
 * Redistributes word timings across visible text tokens.
 *
 * Invariant: If user-edited `clip.text` differs from the joined raw transcribed words,
 * the visible text wins. The original speech boundary [startMs, endMs] is preserved,
 * and timings are redistributed across the new words weighted by character length.
 */
export function redistributeWordTimings(
  visibleText: string,
  rawWords: readonly {
    word?: string;
    text?: string;
    start?: number;
    end?: number;
    startMs?: number;
    endMs?: number;
    probability?: number;
  }[],
): TranscriptWord[] {
  const tokens = visibleText.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }

  // Derive bounding range from raw words, fallback to 0..1000ms if empty
  let totalStartMs = 0;
  let totalEndMs = 1000;

  if (rawWords.length > 0) {
    const first = rawWords[0];
    const last = rawWords[rawWords.length - 1];

    totalStartMs =
      first.startMs !== undefined
        ? first.startMs
        : typeof first.start === "number"
          ? Math.round(first.start * 1000)
          : 0;

    totalEndMs =
      last.endMs !== undefined
        ? last.endMs
        : typeof last.end === "number"
          ? Math.round(last.end * 1000)
          : totalStartMs + 1000;
  }

  const totalDurationMs = Math.max(1, totalEndMs - totalStartMs);

  // 1:1 token match fast path
  if (tokens.length === rawWords.length) {
    return tokens.map((token, i) => {
      const rw = rawWords[i];
      const startMs =
        rw.startMs !== undefined
          ? rw.startMs
          : typeof rw.start === "number"
            ? Math.round(rw.start * 1000)
            : totalStartMs;
      const endMs =
        rw.endMs !== undefined
          ? rw.endMs
          : typeof rw.end === "number"
            ? Math.round(rw.end * 1000)
            : totalEndMs;

      return {
        id: `w-${i}-${token.toLowerCase()}`,
        text: token,
        startMs,
        endMs,
        probability: rw.probability,
      };
    });
  }

  // Length-weighted proportional redistribution
  const totalChars = tokens.reduce((acc, t) => acc + Math.max(1, t.length), 0);
  let currentStart = totalStartMs;

  return tokens.map((token, i) => {
    const charWeight = Math.max(1, token.length) / totalChars;
    const isLast = i === tokens.length - 1;
    const wordDur = isLast
      ? totalEndMs - currentStart
      : Math.max(1, Math.round(charWeight * totalDurationMs));

    const word: TranscriptWord = {
      id: `w-${i}-${token.toLowerCase()}`,
      text: token,
      startMs: currentStart,
      endMs: currentStart + wordDur,
    };

    currentStart += wordDur;
    return word;
  });
}

/**
 * Creates an immutable backup descriptor for a pre-migration project JSON
 * and persists the backup file to disk or storage before migration executes.
 */
export function createProjectV150Backup(
  rawProject: unknown,
  projectId: string,
  targetDirOrPath?: string,
): { backupFileName: string; backupContent: string; writtenPath?: string } {
  const backupFileName = `project-${projectId}.v1.5.0.backup.json`;
  const backupContent =
    typeof rawProject === "string"
      ? rawProject
      : JSON.stringify(rawProject, null, 2);

  let writtenPath: string | undefined;

  // In Node.js / test environments: write directly to disk
  const proc = (globalThis as any).process;
  if (typeof proc !== "undefined" && proc?.versions?.node) {
    try {
      // Use dynamic require so Vite bundler doesn't complain in browser target
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeFs = eval("require")("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodePath = eval("require")("node:path");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeOs = eval("require")("node:os");

      let dest = targetDirOrPath;
      if (
        dest &&
        nodeFs.existsSync(dest) &&
        nodeFs.statSync(dest).isDirectory()
      ) {
        dest = nodePath.join(dest, backupFileName);
      } else if (!dest) {
        dest = nodePath.join(nodeOs.tmpdir(), backupFileName);
      }
      nodeFs.writeFileSync(dest, backupContent, "utf8");
      writtenPath = dest;
    } catch {
      // Fallback
    }
  }

  // In browser environment: persist into localStorage
  if (!writtenPath && typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(
        `clypra:backup:${backupFileName}`,
        backupContent,
      );
      writtenPath = `localStorage:clypra:backup:${backupFileName}`;
    } catch {
      // Ignore storage errors
    }
  }

  return {
    backupFileName,
    backupContent,
    writtenPath,
  };
}

/**
 * Migrates a project's caption data from v1.5.0 to v2 (Transcript model).
 *
 * Rules:
 * 1. Idempotent: If project.transcripts is already populated, returns unmodified.
 * 2. Source of Truth: Migrates from existing caption TextClips (what currently renders).
 * 3. Text Reconciliation: If clip.text differs from joined words, visible text wins.
 * 4. Derived Backward-Compatibility: Keeps caption_tracks populated as a write-only snapshot.
 */
export function migrateProjectToTranscripts(
  input: ProjectMigrationInput,
  rawJsonForBackup?: unknown,
): ProjectMigrationResult {
  const { project, clips, captionTracks = [] } = input;

  // Idempotency check: already migrated if transcripts exists and version >= 2
  if (
    project.transcripts &&
    Object.keys(project.transcripts).length > 0 &&
    (project.captionModelVersion ?? 1) >= CAPTION_MODEL_VERSION
  ) {
    return {
      project,
      clips,
      captionTracks,
      migrated: false,
    };
  }

  // Find all caption TextClips
  const captionClips = clips.filter(
    (c): c is TextClip =>
      c.kind === "text" && (c as TextClip).textRole === "caption",
  );

  if (captionClips.length === 0) {
    // No captions to migrate; just bump model version
    return {
      project: {
        ...project,
        captionModelVersion: CAPTION_MODEL_VERSION,
        transcripts: project.transcripts ?? {},
      },
      clips,
      captionTracks,
      migrated: false,
    };
  }

  const backupPayload = rawJsonForBackup
    ? createProjectV150Backup(rawJsonForBackup, project.id)
    : undefined;

  const transcripts: Record<string, Transcript> = {
    ...(project.transcripts ?? {}),
  };

  // Group caption clips by associated media asset or fallback
  const clipsByMediaId = new Map<string, TextClip[]>();
  for (const c of captionClips) {
    const key = c.mediaId || "media-default";
    const group = clipsByMediaId.get(key) ?? [];
    group.push(c);
    clipsByMediaId.set(key, group);
  }

  const updatedClips = [...clips];

  for (const [mediaId, group] of clipsByMediaId.entries()) {
    const transcriptId = `transcript-${mediaId}`;
    const allWords: TranscriptWord[] = [];

    // Sort clips chronologically by start time
    group.sort((a, b) => a.startTime - b.startTime);

    for (const clip of group) {
      const rawWords = clip.words ?? [];
      const joinedWords = rawWords
        .map((w) => w.word || (w as any).text || "")
        .join(" ")
        .trim();
      const visibleText = (clip.text ?? "").trim();

      let reconciledWords: TranscriptWord[];
      if (visibleText && rawWords.length > 0 && visibleText !== joinedWords) {
        // Visible text wins; redistribute timings
        reconciledWords = redistributeWordTimings(visibleText, rawWords);
      } else if (rawWords.length > 0) {
        reconciledWords = rawWords.map((rw, idx) => {
          const raw = rw as {
            word?: string;
            text?: string;
            startMs?: number;
            endMs?: number;
            start?: number;
            end?: number;
            probability?: number;
          };
          return {
            id: `w-${idx}-${(raw.word || "w").toLowerCase()}`,
            text: raw.word || raw.text || "",
            startMs:
              raw.startMs !== undefined
                ? raw.startMs
                : typeof raw.start === "number"
                  ? Math.round(raw.start * 1000)
                  : 0,
            endMs:
              raw.endMs !== undefined
                ? raw.endMs
                : typeof raw.end === "number"
                  ? Math.round(raw.end * 1000)
                  : 1000,
            probability: raw.probability,
          };
        });
      } else if (visibleText) {
        // Clip had no words array; synthesize words from visible text
        const clipStartMs = Math.round(clip.trimIn * 1000);
        const clipEndMs = Math.round(clip.trimOut * 1000);
        reconciledWords = redistributeWordTimings(visibleText, [
          { startMs: clipStartMs, endMs: clipEndMs },
        ]);
      } else {
        reconciledWords = [];
      }

      allWords.push(...reconciledWords);

      // Update clip with transcriptId and canonical trim bounds
      const clipIndex = updatedClips.findIndex((c) => c.id === clip.id);
      if (clipIndex !== -1) {
        const updatedClip: TextClip = {
          ...clip,
          transcriptId,
          // Words on the clip are normalized
          words: reconciledWords.map((rw) => ({
            word: rw.text,
            start: rw.startMs / 1000,
            end: rw.endMs / 1000,
            probability: rw.probability,
          })),
        };
        updatedClips[clipIndex] = updatedClip;
      }
    }

    transcripts[transcriptId] = {
      id: transcriptId,
      sourceMediaId: mediaId,
      language: "en",
      words: allWords,
    };
  }

  // Derive write-only backward-compatible CaptionTrack snapshot
  const derivedCaptionTrack: CaptionTrack = {
    id: "derived-caption-track",
    captionModelVersion: CAPTION_MODEL_VERSION,
    name: "Subtitles",
    visible: true,
    locked: false,
    defaultStyle: {
      text: "",
      fontFamily: "Inter Variable",
      fontSize: 36,
      color: "#ffffff",
      align: "center",
      verticalAlign: "middle",
      fontWeight: 700,
      fontStyle: "normal",
      lineHeight: 1.25,
      letterSpacing: 0,
    },
    cues: captionClips.map((c, i) => ({
      id: `cue-${c.id}`,
      startTicks: Math.round(c.startTime * 1_000_000),
      endTicks: Math.round((c.startTime + c.duration) * 1_000_000),
      text: c.text,
      styleVersion: 1,
    })),
  };

  const nextCaptionTracks =
    captionTracks.length > 0 ? captionTracks : [derivedCaptionTrack];

  return {
    project: {
      ...project,
      captionModelVersion: CAPTION_MODEL_VERSION,
      transcripts,
    },
    clips: updatedClips,
    captionTracks: nextCaptionTracks,
    migrated: true,
    backupPayload,
  };
}
