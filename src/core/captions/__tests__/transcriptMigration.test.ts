import { describe, it, expect } from "vitest";
import {
  migrateProjectToTranscripts,
  redistributeWordTimings,
  createProjectV150Backup,
} from "../transcriptMigration";
import type { Project, TextClip } from "@/types";
import { CAPTION_MODEL_VERSION } from "@/types/captions";

describe("Caption Transcript Migration (v1.5.0 -> v2)", () => {
  const baseProject: Project = {
    id: "proj-migration-test",
    name: "Migration Test",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    aspectRatio: "16:9",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 30,
    timelineSchemaVersion: 1,
    captionModelVersion: 1,
  };

  const sampleCaptionClip: TextClip = {
    id: "clip-caption-1",
    kind: "text",
    textRole: "caption",
    trackId: "track-text-1",
    mediaId: "media-video-1",
    startTime: 2.0,
    duration: 3.0,
    trimIn: 2.0,
    trimOut: 5.0,
    x: 960,
    y: 900,
    width: 800,
    height: 120,
    rotation: 0,
    opacity: 1.0,
    text: "Welcome to Clypra editor",
    fontFamily: "Inter Variable",
    fontSize: 48,
    color: "#ffffff",
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    paddingX: 10,
    paddingY: 10,
    words: [
      { word: "Welcome", start: 2.0, end: 2.6 },
      { word: "to", start: 2.6, end: 2.9 },
      { word: "Clypra", start: 2.9, end: 3.8 },
      { word: "editor", start: 3.8, end: 4.8 },
    ],
  };

  describe("redistributeWordTimings", () => {
    it("preserves exact word timings when token count matches raw words", () => {
      const rawWords = [
        { word: "Hello", startMs: 1000, endMs: 1500 },
        { word: "world", startMs: 1500, endMs: 2000 },
      ];
      const result = redistributeWordTimings("Hello world", rawWords);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ text: "Hello", startMs: 1000, endMs: 1500 });
      expect(result[1]).toMatchObject({ text: "world", startMs: 1500, endMs: 2000 });
    });

    it("redistributes timings proportionally by character length when visible text changed word count", () => {
      // User edited "cannot wait" -> "can not wait today" (2 words -> 4 words)
      const rawWords = [
        { word: "cannot", startMs: 1000, endMs: 2000 },
        { word: "wait", startMs: 2000, endMs: 3000 },
      ];
      const newText = "can not wait today";
      const result = redistributeWordTimings(newText, rawWords);

      expect(result).toHaveLength(4);
      expect(result.map((w) => w.text)).toEqual(["can", "not", "wait", "today"]);

      // First word must start at original start (1000ms)
      expect(result[0].startMs).toBe(1000);
      // Last word must end at original end (3000ms)
      expect(result[3].endMs).toBe(3000);

      // Timings must be strictly monotonically increasing and continuous
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].endMs).toBe(result[i + 1].startMs);
        expect(result[i].endMs).toBeGreaterThan(result[i].startMs);
      }
    });
  });

  describe("migrateProjectToTranscripts", () => {
    it("migrates existing caption TextClips into canonical project.transcripts", () => {
      const result = migrateProjectToTranscripts({
        project: baseProject,
        clips: [sampleCaptionClip],
        captionTracks: [],
      });

      expect(result.migrated).toBe(true);
      expect(result.project.captionModelVersion).toBe(CAPTION_MODEL_VERSION);
      expect(result.project.transcripts).toBeDefined();

      const transcript = result.project.transcripts!["transcript-media-video-1"];
      expect(transcript).toBeDefined();
      expect(transcript.words).toHaveLength(4);
      expect(transcript.words[0].text).toBe("Welcome");
      expect(transcript.words[0].startMs).toBe(2000);
      expect(transcript.words[3].text).toBe("editor");
      expect(transcript.words[3].endMs).toBe(4800);

      // Updated clip references the transcript
      const updatedClip = result.clips[0] as TextClip;
      expect(updatedClip.transcriptId).toBe("transcript-media-video-1");
    });

    it("ensures visible text wins if clip.text differs from raw transcribed words", () => {
      // User fixed a typo: transcribed was "Welcom to Clypra edtor", visible text was corrected to "Welcome to Clypra editor"
      const editedClip: TextClip = {
        ...sampleCaptionClip,
        text: "Welcome to Clypra editor",
        words: [
          { word: "Welcom", start: 2.0, end: 2.6 },
          { word: "to", start: 2.6, end: 2.9 },
          { word: "Clypra", start: 2.9, end: 3.8 },
          { word: "edtor", start: 3.8, end: 4.8 },
        ],
      };

      const result = migrateProjectToTranscripts({
        project: baseProject,
        clips: [editedClip],
      });

      const words = result.project.transcripts!["transcript-media-video-1"].words;
      expect(words[0].text).toBe("Welcome"); // Corrected text wins
      expect(words[3].text).toBe("editor"); // Corrected text wins
      expect(words[0].startMs).toBe(2000);
      expect(words[3].endMs).toBe(4800);
    });

    it("is strictly idempotent: running migration on already-migrated project produces zero changes", () => {
      // First pass
      const pass1 = migrateProjectToTranscripts({
        project: baseProject,
        clips: [sampleCaptionClip],
      });

      expect(pass1.migrated).toBe(true);

      // Second pass on pass1 output
      const pass2 = migrateProjectToTranscripts({
        project: pass1.project,
        clips: pass1.clips,
        captionTracks: pass1.captionTracks,
      });

      expect(pass2.migrated).toBe(false);
      expect(pass2.project).toEqual(pass1.project);
      expect(pass2.clips).toEqual(pass1.clips);
      expect(pass2.captionTracks).toEqual(pass1.captionTracks);
    });

    it("creates a valid v1.5.0 backup descriptor and writes it to disk", () => {
      const rawPayload = {
        project: baseProject,
        clips: [sampleCaptionClip],
        version: "1.5.0",
      };

      const result = migrateProjectToTranscripts(
        {
          project: baseProject,
          clips: [sampleCaptionClip],
        },
        rawPayload,
      );

      expect(result.backupPayload).toBeDefined();
      expect(result.backupPayload!.backupFileName).toBe(
        `project-${baseProject.id}.v1.5.0.backup.json`,
      );
      expect(result.backupPayload!.writtenPath).toBeDefined();

      // Verify the file was written to disk
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = eval("require")("node:fs");
      expect(fs.existsSync(result.backupPayload!.writtenPath)).toBe(true);

      // Restore simulation from written file
      const restoredContent = fs.readFileSync(
        result.backupPayload!.writtenPath,
        "utf8",
      );
      const restoredRaw = JSON.parse(restoredContent);
      expect(restoredRaw.project.id).toBe(baseProject.id);
      expect(restoredRaw.clips[0].text).toBe(sampleCaptionClip.text);
      expect(restoredRaw.version).toBe("1.5.0");

      // Cleanup
      try {
        fs.unlinkSync(result.backupPayload!.writtenPath);
      } catch {
        // ignore
      }
    });

    it("wires migration into project load via validateAndMigrateProjectPayload", async () => {
      const { validateAndMigrateProjectPayload } = await import(
        "@/types/serialization"
      );

      const legacyProject = {
        id: "project-load-wire-test",
        name: "Legacy Caption Project",
        created_at: 1000,
        modified_at: 2000,
        frame_rate: 30,
        caption_model_version: 1,
        tracks: [
          {
            id: "track-1",
            type: "text",
            name: "Captions",
            order: 0,
            muted: false,
            locked: false,
            solo: false,
          },
        ],
        clips: [
          {
            id: "clip-c1",
            track_id: "track-1",
            media_id: "media-v1",
            kind: "text",
            start_time: 1.0,
            duration: 2.0,
            trim_in: 0,
            trim_out: 2.0,
            speed: 1.0,
            text_role: "caption",
            text: "Hello from v1.5.0",
            words: [
              { word: "Hello", start: 0, end: 0.8 },
              { word: "from", start: 0.8, end: 1.2 },
              { word: "v1.5.0", start: 1.2, end: 2.0 },
            ],
          },
        ],
      };

      const loaded = validateAndMigrateProjectPayload(legacyProject);

      expect(loaded.project.captionModelVersion).toBe(2);
      expect(loaded.transcripts).toBeDefined();
      expect(loaded.transcripts!["transcript-media-v1"]).toBeDefined();
      expect(loaded.transcripts!["transcript-media-v1"].words).toHaveLength(3);
      expect(loaded.transcripts!["transcript-media-v1"].words[0].text).toBe("Hello");

      const migratedClip = loaded.clips[0] as any;
      expect(migratedClip.transcriptId).toBe("transcript-media-v1");
    });
  });
});
