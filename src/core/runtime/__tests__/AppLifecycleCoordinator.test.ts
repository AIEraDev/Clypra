import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppLifecycleCoordinator } from "../AppLifecycleCoordinator";

describe("AppLifecycleCoordinator", () => {
  let coordinator: AppLifecycleCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    coordinator = new AppLifecycleCoordinator();
  });

  afterEach(() => {
    coordinator.dispose();
    vi.useRealTimers();
  });

  it("initializes with foreground state", () => {
    expect(coordinator.getState()).toBe("foreground");
    expect(coordinator.isForeground()).toBe(true);
    expect(coordinator.isBackgrounded()).toBe(false);
  });

  it("transitions to backgrounded when document is hidden", () => {
    const onSleep = vi.fn();
    coordinator.onBackgroundSleep(onSleep);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance through debounce timer (150ms)
    vi.advanceTimersByTime(200);

    expect(coordinator.getState()).toBe("backgrounded");
    expect(coordinator.isBackgrounded()).toBe(true);
    expect(onSleep).toHaveBeenCalledTimes(1);
  });

  it("transitions to foreground and emits wakeup immediately", () => {
    const onWakeup = vi.fn();
    coordinator.onForegroundWakeup(onWakeup);

    // First go to background
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(200);

    // Return to foreground
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => true,
    });
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(50);

    expect(coordinator.getState()).toBe("foreground");
    expect(coordinator.isForeground()).toBe(true);
    expect(onWakeup).toHaveBeenCalledTimes(1);
  });

  it("cancels pending background transition if focus returns before debounce expires", () => {
    const onSleep = vi.fn();
    const onWakeup = vi.fn();
    coordinator.onBackgroundSleep(onSleep);
    coordinator.onForegroundWakeup(onWakeup);

    // Window blurs
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(50); // < 150ms

    // Focus returns quickly
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => true,
    });
    window.dispatchEvent(new Event("focus"));

    vi.advanceTimersByTime(200);

    expect(coordinator.getState()).toBe("foreground");
    expect(onSleep).not.toHaveBeenCalled();
  });

  it("unsubscribes listeners cleanly", () => {
    const onWakeup = vi.fn();
    const unsubscribe = coordinator.onForegroundWakeup(onWakeup);

    // Go background
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(200);

    // Unsubscribe before wakeup
    unsubscribe();

    // Wakeup
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    window.dispatchEvent(new Event("focus"));

    expect(onWakeup).not.toHaveBeenCalled();
  });
});
