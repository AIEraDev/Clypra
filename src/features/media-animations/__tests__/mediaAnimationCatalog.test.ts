import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useMediaAnimationCatalogSnapshot,
  getCatalogSnapshot,
  notifyCatalogListeners,
} from "../mediaAnimationCatalog";

describe("Media Animation Catalog - useSyncExternalStore snapshot stability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a stable cached reference on consecutive calls when store has not changed", () => {
    const snap1 = getCatalogSnapshot();
    const snap2 = getCatalogSnapshot();
    expect(snap1).toBe(snap2);
  });

  it("updates cached reference when notifyCatalogListeners is called and stabilizes on the new snapshot", () => {
    const snap1 = getCatalogSnapshot();
    notifyCatalogListeners();
    const snap2 = getCatalogSnapshot();
    const snap3 = getCatalogSnapshot();

    expect(snap1).not.toBe(snap2);
    expect(snap2).toBe(snap3);
  });

  it("does not trigger getSnapshot caching errors or infinite loops when hooked into React", () => {
    const errorSpy = vi.spyOn(console, "error");
    const { result, unmount } = renderHook(() =>
      useMediaAnimationCatalogSnapshot(),
    );

    expect(result.current).toBeDefined();
    expect(result.current.presets).toBeDefined();

    // Verify React DEV did NOT log the getSnapshot caching warning
    const infiniteLoopWarnings = errorSpy.mock.calls.filter((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes("The result of getSnapshot should be cached"),
      ),
    );
    expect(infiniteLoopWarnings).toHaveLength(0);

    // Verify triggering store update notifies the hook properly without looping
    act(() => {
      notifyCatalogListeners();
    });

    expect(result.current).toBe(getCatalogSnapshot());

    unmount();
  });
});
