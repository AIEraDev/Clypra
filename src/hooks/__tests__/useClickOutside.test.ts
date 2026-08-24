import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useClickOutside } from "../useClickOutside";
import React from "react";

describe("useClickOutside hook", () => {
  it("calls onDismiss when clicking outside target element", () => {
    const onDismiss = vi.fn();
    const targetEl = document.createElement("div");
    document.body.appendChild(targetEl);

    const outsideEl = document.createElement("button");
    document.body.appendChild(outsideEl);

    const ref = { current: targetEl };

    renderHook(() => useClickOutside(ref, onDismiss, { enabled: true }));

    // Click inside
    targetEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    // Click outside
    outsideEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.body.removeChild(targetEl);
    document.body.removeChild(outsideEl);
  });

  it("handles multiple target refs correctly", () => {
    const onDismiss = vi.fn();
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    const outsideEl = document.createElement("div");

    document.body.appendChild(el1);
    document.body.appendChild(el2);
    document.body.appendChild(outsideEl);

    const ref1 = { current: el1 };
    const ref2 = { current: el2 };

    renderHook(() => useClickOutside([ref1, ref2], onDismiss, { enabled: true }));

    // Click inside el1
    el1.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    // Click inside el2
    el2.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    // Click outside both
    outsideEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.body.removeChild(el1);
    document.body.removeChild(el2);
    document.body.removeChild(outsideEl);
  });

  it("calls onDismiss when Escape key is pressed", () => {
    const onDismiss = vi.fn();
    const targetEl = document.createElement("div");
    document.body.appendChild(targetEl);
    const ref = { current: targetEl };

    renderHook(() => useClickOutside(ref, onDismiss, { enabled: true, listenEscape: true }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.body.removeChild(targetEl);
  });

  it("does not attach listeners or call onDismiss when enabled is false", () => {
    const onDismiss = vi.fn();
    const outsideEl = document.createElement("button");
    document.body.appendChild(outsideEl);
    const ref = { current: document.createElement("div") };

    renderHook(() => useClickOutside(ref, onDismiss, { enabled: false }));

    outsideEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onDismiss).not.toHaveBeenCalled();
    document.body.removeChild(outsideEl);
  });
});
