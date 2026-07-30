import { describe, it, expect, beforeEach, vi } from "vitest";
import { useExportStore } from "../exportStore";

describe("exportStore — Export Progress & Session State", () => {
  beforeEach(() => {
    useExportStore.getState().reset();
  });

  it("starts export and tracks frame progress", () => {
    const { startExporting, setProgress } = useExportStore.getState();

    startExporting("/output/video.mp4");
    expect(useExportStore.getState().isExporting).toBe(true);
    expect(useExportStore.getState().phase).toBe("exporting");
    expect(useExportStore.getState().outputPath).toBe("/output/video.mp4");

    setProgress({
      currentFrame: 150,
      totalFrames: 300,
      progress: 0.5,
      etaSeconds: 12,
      fps: 30,
    });

    const currentProgress = useExportStore.getState().progress;
    expect(currentProgress?.progress).toBe(0.5);
    expect(currentProgress?.currentFrame).toBe(150);
  });

  it("handles export cancellation via cancelFn", async () => {
    const cancelMock = vi.fn().mockResolvedValue(undefined);
    useExportStore.getState().setCancelFn(cancelMock);

    await useExportStore.getState().cancelExport();

    expect(cancelMock).toHaveBeenCalled();
    expect(useExportStore.getState().isExporting).toBe(false);
    expect(useExportStore.getState().phase).toBe("idle");
  });

  it("handles export errors and resets state", () => {
    useExportStore.getState().setError("Encoder crashed");

    expect(useExportStore.getState().error).toBe("Encoder crashed");
    expect(useExportStore.getState().phase).toBe("error");
    expect(useExportStore.getState().isExporting).toBe(false);

    useExportStore.getState().reset();
    expect(useExportStore.getState().phase).toBe("idle");
    expect(useExportStore.getState().error).toBeNull();
  });
});
