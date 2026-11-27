import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { TelemetryConsentDialog } from "../TelemetryConsentDialog";

describe("TelemetryConsentDialog", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records that the disclosure was shown and offers both choices", () => {
    render(
      <TelemetryConsentDialog
        isOpen
        onKeepSharing={vi.fn()}
        onTurnOff={vi.fn()}
      />,
    );

    expect(localStorage.getItem("clypra.telemetryOnboardingShown")).toBe("true");
    expect(screen.getByRole("button", { name: "Keep sharing" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeDefined();
  });

  it("treats Escape as keeping sharing after the disclosure is shown", () => {
    const onKeepSharing = vi.fn();
    render(
      <TelemetryConsentDialog
        isOpen
        onKeepSharing={onKeepSharing}
        onTurnOff={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onKeepSharing).toHaveBeenCalledOnce();
  });

  it("calls the opt-out action", () => {
    const onTurnOff = vi.fn().mockResolvedValue(undefined);
    render(
      <TelemetryConsentDialog
        isOpen
        onKeepSharing={vi.fn()}
        onTurnOff={onTurnOff}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(onTurnOff).toHaveBeenCalledOnce();
  });
});
