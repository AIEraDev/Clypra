/**
 * Tauri IPC Bridge Tests
 * 
 * Tests the communication layer between frontend and Rust backend
 * Covers: success responses, error responses, timeouts, parameter validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  getAudioWaveformPeaks,
  exportTrimmedVideo,
  extractFrameAtTime,
  extractFilmstripFrames,
  getFrameCacheDir,
  getCachedFramePath,
  saveFrameToCache,
  readCachedFrame,
  clearFrameCache,
  getFrameCacheSize,
} from "../tauri";

// Mock the Tauri invoke function
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("Tauri IPC Bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUCCESS RESPONSE HANDLING
  // =========================================================================

  describe("Success Responses", () => {
    it("should handle successful audio_waveform_peaks response", async () => {
      const mockPeaks = [0.1, 0.5, 0.8, 0.3, 0.0];
      vi.mocked(invoke).mockResolvedValueOnce(mockPeaks);

      const result = await getAudioWaveformPeaks("/test/video.mp4", 100);

      expect(invoke).toHaveBeenCalledWith("audio_waveform_peaks", {
        inputPath: "/test/video.mp4",
        bucketCount: 100,
      });
      expect(result).toEqual(mockPeaks);
    });

    it("should handle successful trim_export response", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await expect(
        exportTrimmedVideo("/test/input.mp4", "/test/output.mp4", 0, 10)
      ).resolves.toBeUndefined();

      expect(invoke).toHaveBeenCalledWith("trim_export", {
        inputPath: "/test/input.mp4",
        outputPath: "/test/output.mp4",
        startSec: 0,
        endSec: 10,
      });
    });

    it("should handle successful extract_frame_at_time response", async () => {
      const mockDataUrl = "data:image/png;base64,iVBORw0KGgo=";
      vi.mocked(invoke).mockResolvedValueOnce(mockDataUrl);

      const result = await extractFrameAtTime("/test/video.mp4", 5.0, 1920, 1080);

      expect(invoke).toHaveBeenCalledWith("extract_frame_at_time", {
        inputPath: "/test/video.mp4",
        timeSecs: 5.0,
        width: 1920,
        height: 1080,
      });
      expect(result).toBe(mockDataUrl);
    });

    it("should handle successful extract_filmstrip_frames response", async () => {
      const mockFrames = [
        "data:image/png;base64,frame1=",
        "data:image/png;base64,frame2=",
        "data:image/png;base64,frame3=",
      ];
      vi.mocked(invoke).mockResolvedValueOnce(mockFrames);

      const result = await extractFilmstripFrames("/test/video.mp4", 3, 320, 180);

      expect(invoke).toHaveBeenCalledWith("extract_filmstrip_frames", {
        inputPath: "/test/video.mp4",
        frameCount: 3,
        width: 320,
        height: 180,
        timeStart: null,
        timeEnd: null,
      });
      expect(result).toEqual(mockFrames);
    });

    it("should pass trim times to extract_filmstrip_frames when provided", async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]);

      await extractFilmstripFrames("/test/video.mp4", 6, 120, 68, 1.25, 8.5);

      expect(invoke).toHaveBeenCalledWith("extract_filmstrip_frames", {
        inputPath: "/test/video.mp4",
        frameCount: 6,
        width: 120,
        height: 68,
        timeStart: 1.25,
        timeEnd: 8.5,
      });
    });

    it("should normalize file:// URLs before extract_filmstrip_frames invoke", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(["data:image/png;base64,x="]);
      await extractFilmstripFrames("file:///Users/test/clip.mov", 1, 64, 36);
      expect(invoke).toHaveBeenCalledWith(
        "extract_filmstrip_frames",
        expect.objectContaining({
          inputPath: "/Users/test/clip.mov",
        }),
      );
    });

    it("should handle successful frame cache operations", async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce("/cache/dir") // getFrameCacheDir
        .mockResolvedValueOnce("/cache/frame1.png") // getCachedFramePath
        .mockResolvedValueOnce("data:image/png;base64,cached=") // readCachedFrame
        .mockResolvedValueOnce("/cache/frame1.png") // saveFrameToCache
        .mockResolvedValueOnce(undefined) // clearFrameCache
        .mockResolvedValueOnce(42.5); // getFrameCacheSize

      const cacheDir = await getFrameCacheDir();
      expect(cacheDir).toBe("/cache/dir");

      const framePath = await getCachedFramePath("/test/video.mp4", 1.0, 1920, 1080);
      expect(framePath).toBe("/cache/frame1.png");

      const frameData = await readCachedFrame("/test/video.mp4", 1.0, 1920, 1080);
      expect(frameData).toBe("data:image/png;base64,cached=");

      const savedPath = await saveFrameToCache(
        "/test/video.mp4",
        1.0,
        1920,
        1080,
        "data:image/png;base64,newframe="
      );
      expect(savedPath).toBe("/cache/frame1.png");

      await expect(clearFrameCache()).resolves.toBeUndefined();

      const size = await getFrameCacheSize();
      expect(size).toBe(42.5);
    });

    it("should handle null cached frame path (cache miss)", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null);

      const result = await getCachedFramePath("/test/video.mp4", 1.0, 1920, 1080);

      expect(result).toBeNull();
    });

    it("should handle null cached frame data (cache miss)", async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null);

      const result = await readCachedFrame("/test/video.mp4", 1.0, 1920, 1080);

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // ERROR RESPONSE HANDLING
  // =========================================================================

  describe("Error Responses", () => {
    it("should propagate Rust Err() as thrown exception", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error("FFmpeg not found"));

      await expect(
        extractFrameAtTime("/test/video.mp4", 1.0, 1920, 1080)
      ).rejects.toThrow("FFmpeg not found");
    });

    it("should handle FFmpeg failure with detailed error", async () => {
      const ffmpegError = `ffmpeg failed:
Error opening filters!
Failed to inject frame into filter network`;
      vi.mocked(invoke).mockRejectedValueOnce(new Error(ffmpegError));

      await expect(
        extractFrameAtTime("/test/corrupt.mp4", 1.0, 1920, 1080)
      ).rejects.toThrow("Error opening filters");
    });

    it("should handle file not found error", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error("No such file or directory")
      );

      await expect(
        extractFrameAtTime("/nonexistent/video.mp4", 1.0, 1920, 1080)
      ).rejects.toThrow("No such file or directory");
    });

    it("should handle permission denied error", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error("Permission denied (os error 13)")
      );

      await expect(
        exportTrimmedVideo("/root/video.mp4", "/test/output.mp4", 0, 10)
      ).rejects.toThrow("Permission denied");
    });

    it("should handle codec not found error", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error("Unknown decoder 'hevc' | Codec not found")
      );

      await expect(
        extractFrameAtTime("/test/hevc.mp4", 1.0, 1920, 1080)
      ).rejects.toThrow("Unknown decoder");
    });

    it("should handle invalid video format error", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error("Invalid data found when processing input")
      );

      await expect(
        extractFrameAtTime("/test/not-a-video.txt", 1.0, 1920, 1080)
      ).rejects.toThrow("Invalid data found");
    });

    it("should handle out of range timestamp error", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error("frame=    0 fps=0.0 q=-0.0 Lsize=       0kB time=N/A bitrate=N/A speed=N/A")
      );

      await expect(
        extractFrameAtTime("/test/video.mp4", 999999.0, 1920, 1080)
      ).rejects.toThrow();
    });

    it("should handle timeout error", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error("Frame extraction timeout (5s exceeded)")
      );

      await expect(
        extractFrameAtTime("/test/large.mp4", 3600.0, 1920, 1080)
      ).rejects.toThrow("timeout");
    });

    it("should handle disk full error during export", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error("No space left on device (os error 28)")
      );

      await expect(
        exportTrimmedVideo("/test/input.mp4", "/full/disk/output.mp4", 0, 100)
      ).rejects.toThrow("No space left");
    });
  });

  // =========================================================================
  // TIMEOUT / NO RESPONSE SCENARIOS
  // =========================================================================

  describe("Timeout and No Response", () => {
    it("should handle invoke that never resolves", async () => {
      // Create a promise that never resolves
      vi.mocked(invoke).mockImplementationOnce(() => new Promise(() => {}));

      // Wrap in our own timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Custom timeout")), 100);
      });

      const invokePromise = extractFrameAtTime("/test/video.mp4", 1.0, 1920, 1080);

      await expect(
        Promise.race([invokePromise, timeoutPromise])
      ).rejects.toThrow("Custom timeout");
    });

    it("should handle slow invoke response", async () => {
      vi.mocked(invoke).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve("data:image/png;base64,slow="), 50);
          })
      );

      const result = await extractFrameAtTime("/test/video.mp4", 1.0, 1920, 1080);
      expect(result).toBe("data:image/png;base64,slow=");
    });

    it("should handle invoke called before previous resolves (concurrent calls)", async () => {
      let resolveFirst: (value: string) => void;
      let resolveSecond: (value: string) => void;

      vi.mocked(invoke)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            })
        );

      const promise1 = extractFrameAtTime("/test/video1.mp4", 1.0, 1920, 1080);
      const promise2 = extractFrameAtTime("/test/video2.mp4", 2.0, 1920, 1080);

      // Resolve in reverse order
      resolveSecond!("data:image/png;base64,second=");
      resolveFirst!("data:image/png;base64,first=");

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe("data:image/png;base64,first=");
      expect(result2).toBe("data:image/png;base64,second=");
    });
  });

  // =========================================================================
  // PARAMETER VALIDATION
  // =========================================================================

  describe("Parameter Validation", () => {
    it("should call command with correct parameter types", async () => {
      vi.mocked(invoke).mockResolvedValueOnce("data:image/png;base64,test=");

      await extractFrameAtTime("/test/video.mp4", 1.5, 1920, 1080);

      const callArgs = vi.mocked(invoke).mock.calls[0];
      expect(callArgs[0]).toBe("extract_frame_at_time");
      expect(callArgs[1]).toMatchObject({
        inputPath: expect.any(String),
        timeSecs: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
      });
    });

    it("should pass through empty string paths", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error("Empty path"));

      await expect(extractFrameAtTime("", 1.0, 1920, 1080)).rejects.toThrow();

      expect(invoke).toHaveBeenCalledWith("extract_frame_at_time", {
        inputPath: "",
        timeSecs: 1.0,
        width: 1920,
        height: 1080,
      });
    });

    it("should pass through very long file paths", async () => {
      const longPath = "/very/long/path/" + "a".repeat(200) + "/video.mp4";
      vi.mocked(invoke).mockResolvedValueOnce("data:image/png;base64,test=");

      await extractFrameAtTime(longPath, 1.0, 1920, 1080);

      expect(invoke).toHaveBeenCalledWith(
        "extract_frame_at_time",
        expect.objectContaining({
          inputPath: longPath,
        })
      );
    });

    it("should pass through special characters in paths", async () => {
      const specialPaths = [
        "/test/video with spaces.mp4",
        "/test/video-with-dashes.mp4",
        "/test/video[brackets].mp4",
        "/test/video(parens).mp4",
        "/test/video'apostrophe'.mp4",
        '/test/video"quotes".mp4',
      ];

      for (const path of specialPaths) {
        vi.mocked(invoke).mockResolvedValueOnce("data:image/png;base64,test=");
        await extractFrameAtTime(path, 1.0, 1920, 1080);

        expect(invoke).toHaveBeenCalledWith(
          "extract_frame_at_time",
          expect.objectContaining({ inputPath: path })
        );

        vi.clearAllMocks();
      }
    });

    it("should pass through unicode paths", async () => {
      const unicodePaths = [
        "/test/视频.mp4",
        "/test/відео.mp4",
        "/test/🎬video.mp4",
      ];

      for (const path of unicodePaths) {
        vi.mocked(invoke).mockResolvedValueOnce("data:image/png;base64,test=");
        await extractFrameAtTime(path, 1.0, 1920, 1080);

        expect(invoke).toHaveBeenCalledWith(
          "extract_frame_at_time",
          expect.objectContaining({ inputPath: path })
        );

        vi.clearAllMocks();
      }
    });

    it("should handle boundary time values", async () => {
      const boundaryTimes = [
        0, // Start of video
        0.033, // 1 frame at 30fps
        1, // 1 second
        59.94, // NTSC frame rate period
        3600, // 1 hour
        10800, // 3 hours
      ];

      for (const time of boundaryTimes) {
        vi.mocked(invoke).mockResolvedValueOnce("data:image/png;base64,test=");
        await extractFrameAtTime("/test/video.mp4", time, 1920, 1080);

        expect(invoke).toHaveBeenCalledWith(
          "extract_frame_at_time",
          expect.objectContaining({ timeSecs: time })
        );

        vi.clearAllMocks();
      }
    });

    it("should handle boundary dimension values", async () => {
      const dimensions = [
        { width: 1, height: 1 }, // Minimum
        { width: 320, height: 180 }, // 360p
        { width: 640, height: 360 }, // 360p
        { width: 1280, height: 720 }, // 720p
        { width: 1920, height: 1080 }, // 1080p
        { width: 2560, height: 1440 }, // 1440p
        { width: 3840, height: 2160 }, // 4K
        { width: 7680, height: 4320 }, // 8K
      ];

      for (const { width, height } of dimensions) {
        vi.mocked(invoke).mockResolvedValueOnce("data:image/png;base64,test=");
        await extractFrameAtTime("/test/video.mp4", 1.0, width, height);

        expect(invoke).toHaveBeenCalledWith(
          "extract_frame_at_time",
          expect.objectContaining({ width, height })
        );

        vi.clearAllMocks();
      }
    });
  });

  // =========================================================================
  // MISSING PARAMETER SCENARIOS
  // =========================================================================

  describe("Missing Parameters", () => {
    it("should handle invoke with undefined parameters gracefully", async () => {
      // TypeScript should catch this, but runtime might receive undefined
      vi.mocked(invoke).mockRejectedValueOnce(new Error("Missing parameter"));

      // @ts-expect-error Testing runtime behavior with undefined
      await expect(extractFrameAtTime(undefined, 1.0, 1920, 1080)).rejects.toThrow();
    });

    it("should handle invoke with null parameters gracefully", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error("Invalid parameter type"));

      // @ts-expect-error Testing runtime behavior with null
      await expect(extractFrameAtTime(null, 1.0, 1920, 1080)).rejects.toThrow();
    });
  });

  // =========================================================================
  // WRONG TYPE SCENARIOS
  // =========================================================================

  describe("Wrong Type Parameters", () => {
    it("should handle string where number expected", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error("Invalid type"));

      // @ts-expect-error Testing runtime behavior
      await expect(extractFrameAtTime("/test/video.mp4", "not-a-number", 1920, 1080)).rejects.toThrow();
    });

    it("should handle number where string expected", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error("Invalid type"));

      // @ts-expect-error Testing runtime behavior
      await expect(extractFrameAtTime(12345, 1.0, 1920, 1080)).rejects.toThrow();
    });

    it("should handle boolean where number expected", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error("Invalid type"));

      // @ts-expect-error Testing runtime behavior
      await expect(extractFrameAtTime("/test/video.mp4", true, 1920, 1080)).rejects.toThrow();
    });
  });

  // =========================================================================
  // CONCURRENT OPERATION TESTS
  // =========================================================================

  describe("Concurrent Operations", () => {
    it("should handle multiple simultaneous frame extractions", async () => {
      vi.mocked(invoke).mockResolvedValue("data:image/png;base64,frame=");

      const promises = Array.from({ length: 10 }, (_, i) =>
        extractFrameAtTime(`/test/video${i}.mp4`, i, 1920, 1080)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result).toBe("data:image/png;base64,frame=");
      });

      expect(invoke).toHaveBeenCalledTimes(10);
    });

    it("should handle mixed concurrent operations", async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce([0.1, 0.5]) // getAudioWaveformPeaks
        .mockResolvedValueOnce("data:image/png;base64,frame=") // extractFrameAtTime
        .mockResolvedValueOnce(["data:image/png;base64,strip="]); // extractFilmstripFrames

      const [peaks, frame, strip] = await Promise.all([
        getAudioWaveformPeaks("/test/video.mp4", 50),
        extractFrameAtTime("/test/video.mp4", 1.0, 1920, 1080),
        extractFilmstripFrames("/test/video.mp4", 1, 320, 180),
      ]);

      expect(peaks).toEqual([0.1, 0.5]);
      expect(frame).toBe("data:image/png;base64,frame=");
      expect(strip).toEqual(["data:image/png;base64,strip="]);
    });

    it("should handle rapid sequential calls to same function", async () => {
      vi.mocked(invoke).mockResolvedValue("data:image/png;base64,frame=");

      // Simulate rapid scrubbing through timeline
      for (let i = 0; i < 1000; i++) {
        await extractFrameAtTime("/test/video.mp4", i / 10, 1920, 1080);
      }

      expect(invoke).toHaveBeenCalledTimes(1000);
    });
  });

  // =========================================================================
  // BASE64 DATA URL TESTS
  // =========================================================================

  describe("Base64 Data URL Handling", () => {
    it("should handle valid base64 PNG data URL", async () => {
      const validPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      vi.mocked(invoke).mockResolvedValueOnce(validPng);

      const result = await extractFrameAtTime("/test/video.mp4", 1.0, 1920, 1080);

      expect(result).toBe(validPng);
      expect(result.startsWith("data:image/png;base64,")).toBe(true);
    });

    it("should handle malformed base64 (passed through to caller)", async () => {
      const malformed = "data:image/png;base64,!!!invalid!!!";
      vi.mocked(invoke).mockResolvedValueOnce(malformed);

      const result = await extractFrameAtTime("/test/video.mp4", 1.0, 1920, 1080);

      // Function passes through what it receives - decoding handled elsewhere
      expect(result).toBe(malformed);
    });

    it("should handle empty base64 string", async () => {
      const empty = "data:image/png;base64,";
      vi.mocked(invoke).mockResolvedValueOnce(empty);

      const result = await extractFrameAtTime("/test/video.mp4", 1.0, 1920, 1080);

      expect(result).toBe(empty);
    });

    it("should handle large base64 response (4K frame)", async () => {
      // Simulate ~5MB base64 (4K PNG)
      const largeBase64 = "data:image/png;base64," + "A".repeat(7_000_000);
      vi.mocked(invoke).mockResolvedValueOnce(largeBase64);

      const result = await extractFrameAtTime("/test/4k.mp4", 1.0, 3840, 2160);

      expect(result).toBe(largeBase64);
      expect(result.length).toBeGreaterThan(7_000_000);
    });
  });
});
