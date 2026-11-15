import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerPreviewRepaintHandler,
  requestPreviewRepaint,
  isPreviewRepaintPending,
  resetPreviewRepaintCoordinator,
  forceRepaintNativeProgramPreview,
} from "../previewRepaintCoordinator";

describe("previewRepaintCoordinator", () => {
  beforeEach(() => {
    resetPreviewRepaintCoordinator();
  });

  it("latches repaint requests when no handler is registered yet", () => {
    expect(isPreviewRepaintPending()).toBe(false);
    requestPreviewRepaint();
    expect(isPreviewRepaintPending()).toBe(true);

    const handler = vi.fn();
    const unregister = registerPreviewRepaintHandler(handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(isPreviewRepaintPending()).toBe(false);

    unregister();
  });

  it("invokes registered handler directly when requested", () => {
    const handler = vi.fn();
    const unregister = registerPreviewRepaintHandler(handler);

    expect(handler).not.toHaveBeenCalled();
    requestPreviewRepaint();
    expect(handler).toHaveBeenCalledTimes(1);

    forceRepaintNativeProgramPreview();
    expect(handler).toHaveBeenCalledTimes(2);

    unregister();
    requestPreviewRepaint();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(isPreviewRepaintPending()).toBe(true);
  });
});
