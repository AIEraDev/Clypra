import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_PERFORMANCE_BUDGETS,
  previewQualificationController,
} from "../previewPerformanceContract";

describe("preview qualification controller", () => {
  afterEach(() => {
    previewQualificationController.cancel();
    vi.useRealTimers();
  });

  it("runs native and WebView sequentially with no persisted mode switch", () => {
    vi.useFakeTimers();
    const paths: string[] = [];
    const onComplete = vi.fn();

    const initial = previewQualificationController.start({
      onPathChange: (path) => paths.push(path),
      onComplete,
    }, 1_000);

    expect(initial.status).toBe("running");
    expect(initial.path).toBe("native");
    expect(initial.durationMs).toBe(1_000);
    expect(paths).toEqual(["native"]);
    expect(window.localStorage.getItem("clypra-preview-path")).toBeNull();

    vi.advanceTimersByTime(1_000);
    expect(previewQualificationController.getState().path).toBe("webview");
    expect(previewQualificationController.getState().completedPaths).toEqual(["native"]);
    expect(paths).toEqual(["native", "webview"]);

    vi.advanceTimersByTime(1_000);
    expect(previewQualificationController.getState().status).toBe("complete");
    expect(previewQualificationController.getState().completedPaths).toEqual(["native", "webview"]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(PREVIEW_PERFORMANCE_BUDGETS.qualificationDurationMs).toBe(30_000);
  });
});
