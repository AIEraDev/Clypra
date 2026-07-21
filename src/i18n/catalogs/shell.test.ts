import { describe, expect, test } from "vitest";

import { t } from "@/i18n";

describe("application shell localization", () => {
  test("uses the required Chinese launch and recording defaults", () => {
    expect(t("launch.createProject")).toBe("新建项目");
    expect(t("launch.recentProjects")).toBe("最近项目");
    expect(t("launch.untitledProject")).toBe("未命名项目");
    expect(t("recording.defaultProjectName")).toBe("录屏项目");
    expect(t("recording.videoFilterName")).toBe("视频");
  });

  test("formats recent-project relative dates in Simplified Chinese", () => {
    expect(t("launch.today")).toBe("今天");
    expect(t("launch.yesterday")).toBe("昨天");
    expect(t("launch.daysAgo", { count: 4 })).toBe("4 天前");
  });

  test("interpolates a project name without translating it", () => {
    expect(t("recovery.restoreProject", { project: "Client Launch v2" })).toBe(
      "恢复“Client Launch v2”",
    );
  });

  test("provides the exact macOS recording permission guidance", () => {
    expect(t("recording.permissionDenied")).toBe(
      "无法访问摄像头或麦克风。请检查 macOS“系统设置”→“隐私与安全性”。",
    );
  });

  test("interpolates update version and download progress", () => {
    expect(t("update.available", { version: "2.0.0-beta.3" })).toBe(
      "Clypra 2.0.0-beta.3 可用",
    );
    expect(t("update.downloading", { percent: 47 })).toBe(
      "正在下载更新：47%",
    );
  });

  test("wraps raw error details with a stable Chinese prefix", () => {
    expect(
      t("recording.startFailed", {
        error: "NotAllowedError: Permission denied",
      }),
    ).toBe("启动录制失败：NotAllowedError: Permission denied");
  });

  test("preserves device names and server-provided release notes", () => {
    expect(
      t("recording.selectedMicrophone", { device: "External USB Mic (2)" }),
    ).toBe("已选择麦克风：External USB Mic (2)");

    const notes = "Fixes AV1/WebM playback.\nhttps://example.com/release/2.0.0";
    expect(t("update.releaseNotes", { notes })).toBe(`发行说明：${notes}`);
  });
});
