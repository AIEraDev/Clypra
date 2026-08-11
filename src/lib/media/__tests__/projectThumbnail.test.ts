import { describe, expect, it } from "vitest";
import { getProjectThumbnail, formatEditorTimecode } from "../projectThumbnail";
import type { Project } from "@/types";

describe("Project Thumbnail & Timecode Utilities", () => {
  describe("getProjectThumbnail", () => {
    it("prioritizes live program preview thumbnail snapshot over asset fallbacks", () => {
      const project: Partial<Project> = {
        thumbnail: "data:image/jpeg;base64,live_snapshot",
        mediaAssets: [
          {
            id: "1",
            name: "test.mp4",
            path: "/path/video.mp4",
            type: "video",
            duration: 10,
            size: 1024,
            posterFrame: "/path/poster.jpg",
          },
        ],
      };

      expect(getProjectThumbnail(project)).toBe("data:image/jpeg;base64,live_snapshot");
    });

    it("falls back to posterFrame of first visual asset when project.thumbnail is absent", () => {
      const project: Partial<Project> = {
        mediaAssets: [
          {
            id: "1",
            name: "test.mp4",
            path: "/path/video.mp4",
            type: "video",
            duration: 10,
            size: 1024,
            posterFrame: "/path/poster.jpg",
          },
        ],
      };

      expect(getProjectThumbnail(project)).toBe("/path/poster.jpg");
    });

    it("falls back to coverArt when posterFrame is missing", () => {
      const project: Partial<Project> = {
        mediaAssets: [
          {
            id: "1",
            name: "test.mp4",
            path: "/path/video.mp4",
            type: "video",
            duration: 10,
            size: 1024,
            coverArt: "/path/cover.jpg",
          },
        ],
      };

      expect(getProjectThumbnail(project)).toBe("/path/cover.jpg");
    });

    it("returns image path directly if first visual asset is an image", () => {
      const project: Partial<Project> = {
        mediaAssets: [
          {
            id: "1",
            name: "photo.jpg",
            path: "/path/photo.jpg",
            type: "image",
            duration: 5,
            size: 1024,
          },
        ],
      };


      expect(getProjectThumbnail(project)).toBe("/path/photo.jpg");
    });

    it("returns undefined when no media assets or thumbnail are present", () => {
      const project: Partial<Project> = {
        mediaAssets: [],
      };

      expect(getProjectThumbnail(project)).toBeUndefined();
    });
  });

  describe("formatEditorTimecode", () => {
    it("formats 0 or negative seconds as 00:00", () => {
      expect(formatEditorTimecode(0)).toBe("00:00");
      expect(formatEditorTimecode(-5)).toBe("00:00");
      expect(formatEditorTimecode(undefined)).toBe("00:00");
    });

    it("formats seconds under a minute correctly", () => {
      expect(formatEditorTimecode(45)).toBe("00:45");
      expect(formatEditorTimecode(9)).toBe("00:09");
    });

    it("formats minutes and seconds correctly", () => {
      expect(formatEditorTimecode(125)).toBe("02:05");
      expect(formatEditorTimecode(599)).toBe("09:59");
    });

    it("formats hours, minutes, and seconds correctly", () => {
      expect(formatEditorTimecode(3665)).toBe("01:01:05");
    });
  });
});
