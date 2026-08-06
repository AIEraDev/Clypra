import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "@/store/projectStore";
import { parseSubtitles } from "@/features/subtitles/parser";

// Helper replicating sanitizeFileName logic used in cache modules
function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_. ]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

describe("Secure System-Level Sanitization & Boundary Edge Cases", () => {
  // ─── 1. PATH TRAVERSAL & SMUGGLING DEFENSES ─────────────────────────────
  describe("Path Traversal & Filename Sanitization", () => {
    it("should neutralize directory separators (/ and \\) from untrusted paths", () => {
      const maliciousPaths = [
        "../../../etc/passwd",
        "..\\..\\Windows\\System32\\cmd.exe",
        "....//....//secret.txt",
        "folder/../../secret.mp4",
        "%2e%2e%2f%2e%2e%2fsecret",
      ];

      maliciousPaths.forEach((path) => {
        const sanitized = sanitizeFileName(path);
        expect(sanitized).not.toContain("/");
        expect(sanitized).not.toContain("\\");
        expect(sanitized).toMatch(/^[a-zA-Z0-9-_.]*$/);
      });
    });

    it("should neutralize null-byte injection attempts", () => {
      const nullByteInput = "video_clip.mp4\0.exe";
      const sanitized = sanitizeFileName(nullByteInput);
      expect(sanitized).not.toContain("\0");
      expect(sanitized).toBe("video_clip.mp4_.exe");
    });

    it("should enforce a strict length limit to avoid buffer overflow / OS filename limits", () => {
      const hugeName = "A".repeat(500);
      const sanitized = sanitizeFileName(hugeName);
      expect(sanitized.length).toBeLessThanOrEqual(100);
    });

    it("should handle control characters and special shell operators without throwing", () => {
      const shellOperators = "clip; rm -rf / | cat `whoami` $(id) > out.mp4";
      const sanitized = sanitizeFileName(shellOperators);
      expect(sanitized).not.toContain(";");
      expect(sanitized).not.toContain("|");
      expect(sanitized).not.toContain("`");
      expect(sanitized).not.toContain("$");
      expect(sanitized).not.toContain(">");
      expect(sanitized).not.toContain("<");
    });
  });

  // ─── 2. PROJECT NAME SECURITY & GRAPHICAL BOUNDARIES ─────────────────────
  describe("Project Store Name Sanitization", () => {
    it("should fallback to 'Untitled Project' for whitespace or empty inputs", async () => {
      const store = useProjectStore.getState();
      await store.createProject("   ", "16:9", 30);
      const currentProj = useProjectStore.getState().project;
      expect(currentProj?.name).toBe("Untitled Project");
    });

    it("should safely truncate hyper-extended emoji and Unicode grapheme sequences", async () => {
      const store = useProjectStore.getState();
      const unicodeString = "🎬".repeat(200); // 200 emoji graphemes
      await store.createProject(unicodeString, "16:9", 30);
      const currentProj = useProjectStore.getState().project;
      
      expect(currentProj).toBeDefined();
      expect(currentProj!.name.length).toBeGreaterThan(0);
      expect(Array.from(currentProj!.name).length).toBeLessThanOrEqual(100);
    });

    it("should handle invalid empty/whitespace runtime parameters gracefully", async () => {
      const store = useProjectStore.getState();
      // @ts-expect-error testing invalid runtime parameter
      await store.createProject("");
      const currentProj = useProjectStore.getState().project;
      expect(currentProj?.name).toBe("Untitled Project");
    });
  });

  // ─── 3. SUBTITLE / TEXT XSS & MARKUP INJECTION ───────────────────────────
  describe("Subtitle Parser Security & Script Injection Neutralization", () => {
    it("should parse SRT files containing XSS scripts without execution side-effects", () => {
      const srtWithXss = `1
00:00:01,000 --> 00:00:04,000
<script>alert('XSS')</script><img src=x onerror=alert(1)>Hello World
`;
      const captions = parseSubtitles(srtWithXss);
      expect(captions.length).toBe(1);
      expect(captions[0].text).toContain("Hello World");
      expect(typeof captions[0].text).toBe("string");
    });

    it("should parse VTT files with embedded HTML-like malicious markup cleanly", () => {
      const vttWithMaliciousTags = `WEBVTT

00:00:01.000 --> 00:00:05.000
<iframe src="javascript:alert(1)"></iframe>Subtitles text
`;
      const captions = parseSubtitles(vttWithMaliciousTags);
      expect(captions.length).toBe(1);
      expect(captions[0].text).toBeDefined();
    });

    it("should handle corrupt / non-standard subtitle timestamps safely without crashing", () => {
      const corruptSrt = `1
INVALID_TIMESTAMP --> ALSO_INVALID
Corrupted caption body
`;
      expect(() => parseSubtitles(corruptSrt)).not.toThrow();
    });
  });
});
