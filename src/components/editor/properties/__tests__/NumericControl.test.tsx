import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NumericControl } from "../primitives/NumericControl";
import { IncreaseDecreaseHandler } from "../primitives/IncreaseDecreaseHandler";

describe("NumericControl & IncreaseDecreaseHandler — Press & Hold Auto-repeat Suite", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("IncreaseDecreaseHandler Hold Behavior", () => {
    it("fires single increase immediately on pointerdown and does not double-fire on click", () => {
      const onIncrease = vi.fn();
      const onDecrease = vi.fn();

      render(
        <IncreaseDecreaseHandler
          onIncrease={onIncrease}
          onDecrease={onDecrease}
          label="Scale"
        />,
      );

      const increaseBtn = screen.getByRole("button", { name: "Increase Scale" });

      // Pointer down
      fireEvent.pointerDown(increaseBtn, { button: 0 });
      expect(onIncrease).toHaveBeenCalledTimes(1);

      // Fast release before hold delay (e.g. 50ms)
      act(() => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.pointerUp(increaseBtn);

      // Trailing click event should be suppressed
      fireEvent.click(increaseBtn);
      expect(onIncrease).toHaveBeenCalledTimes(1);
    });

    it("continuously increases when pointerdown is held, and stops on pointerup", () => {
      const onIncrease = vi.fn();
      const onDecrease = vi.fn();

      render(
        <IncreaseDecreaseHandler
          onIncrease={onIncrease}
          onDecrease={onDecrease}
          label="Scale"
        />,
      );

      const increaseBtn = screen.getByRole("button", { name: "Increase Scale" });

      // Pointer down starts hold
      fireEvent.pointerDown(increaseBtn, { button: 0 });
      expect(onIncrease).toHaveBeenCalledTimes(1); // Immediate 1st tick

      // Before hold delay (300ms < 350ms), no extra ticks
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(onIncrease).toHaveBeenCalledTimes(1);

      // At 350ms, 2nd tick fires
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(onIncrease).toHaveBeenCalledTimes(2);

      // Next tick scheduled (80ms later)
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(onIncrease).toHaveBeenCalledTimes(3);

      // Advance through several ticks
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(onIncrease.mock.calls.length).toBeGreaterThanOrEqual(6);

      const countBeforeRelease = onIncrease.mock.calls.length;

      // Pointer up releases hold
      fireEvent.pointerUp(window);

      // Advance more time; no more calls should happen
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(onIncrease).toHaveBeenCalledTimes(countBeforeRelease);
    });

    it("continuously decreases when pointerdown is held on decrease button", () => {
      const onIncrease = vi.fn();
      const onDecrease = vi.fn();

      render(
        <IncreaseDecreaseHandler
          onIncrease={onIncrease}
          onDecrease={onDecrease}
          label="Position"
        />,
      );

      const decreaseBtn = screen.getByRole("button", { name: "Decrease Position" });

      fireEvent.pointerDown(decreaseBtn, { button: 0 });
      expect(onDecrease).toHaveBeenCalledTimes(1);

      // Advance past hold threshold
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(onDecrease).toHaveBeenCalledTimes(2);

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onDecrease.mock.calls.length).toBeGreaterThanOrEqual(4);

      // Global window pointerup stops it
      fireEvent.pointerUp(window);

      const finalCount = onDecrease.mock.calls.length;
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onDecrease).toHaveBeenCalledTimes(finalCount);
    });

    it("stops repeat if pointercancel fires", () => {
      const onIncrease = vi.fn();
      const onDecrease = vi.fn();

      render(
        <IncreaseDecreaseHandler
          onIncrease={onIncrease}
          onDecrease={onDecrease}
          label="Rotate"
        />,
      );

      const increaseBtn = screen.getByRole("button", { name: "Increase Rotate" });

      fireEvent.pointerDown(increaseBtn, { button: 0 });
      expect(onIncrease).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(onIncrease).toHaveBeenCalledTimes(2);

      // Pointer cancel
      fireEvent.pointerCancel(window);

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(onIncrease).toHaveBeenCalledTimes(2);
    });

    it("does nothing when disabled", () => {
      const onIncrease = vi.fn();
      const onDecrease = vi.fn();

      render(
        <IncreaseDecreaseHandler
          onIncrease={onIncrease}
          onDecrease={onDecrease}
          label="Scale"
          disabled={true}
        />,
      );

      const increaseBtn = screen.getByRole("button", { name: "Increase Scale" });

      fireEvent.pointerDown(increaseBtn, { button: 0 });
      expect(onIncrease).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(onIncrease).not.toHaveBeenCalled();

      fireEvent.click(increaseBtn);
      expect(onIncrease).not.toHaveBeenCalled();
    });

    it("supports keyboard clicks (Enter/Space) via onClick", () => {
      const onIncrease = vi.fn();
      const onDecrease = vi.fn();

      render(
        <IncreaseDecreaseHandler
          onIncrease={onIncrease}
          onDecrease={onDecrease}
          label="Scale"
        />,
      );

      const increaseBtn = screen.getByRole("button", { name: "Increase Scale" });

      // Direct click without pointerdown (keyboard trigger)
      fireEvent.click(increaseBtn);
      expect(onIncrease).toHaveBeenCalledTimes(1);
    });
  });

  describe("NumericControl Integration with Hold", () => {
    it("increments value repeatedly on hold and clamps to max", () => {
      let currentValue = 98;
      const handleChange = vi.fn((nextVal: number) => {
        currentValue = nextVal;
      });

      const { rerender } = render(
        <NumericControl
          value={currentValue}
          onChange={handleChange}
          min={0}
          max={100}
          step={1}
          ariaLabel="Scale"
        />,
      );

      const increaseBtn = screen.getByRole("button", { name: "Increase Scale" });

      fireEvent.pointerDown(increaseBtn, { button: 0 });
      expect(handleChange).toHaveBeenCalledWith(99);

      // Rerender with updated value
      rerender(
        <NumericControl
          value={currentValue}
          onChange={handleChange}
          min={0}
          max={100}
          step={1}
          ariaLabel="Scale"
        />,
      );

      // Past hold threshold (350ms)
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(handleChange).toHaveBeenCalledWith(100);

      rerender(
        <NumericControl
          value={currentValue}
          onChange={handleChange}
          min={0}
          max={100}
          step={1}
          ariaLabel="Scale"
        />,
      );

      // Further time should clamp at max 100
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(handleChange).toHaveBeenLastCalledWith(100);

      fireEvent.pointerUp(window);
    });

    it("decrements value repeatedly on hold and clamps to min", () => {
      let currentValue = 2;
      const handleChange = vi.fn((nextVal: number) => {
        currentValue = nextVal;
      });

      const { rerender } = render(
        <NumericControl
          value={currentValue}
          onChange={handleChange}
          min={0}
          max={100}
          step={1}
          ariaLabel="Opacity"
        />,
      );

      const decreaseBtn = screen.getByRole("button", { name: "Decrease Opacity" });

      fireEvent.pointerDown(decreaseBtn, { button: 0 });
      expect(handleChange).toHaveBeenCalledWith(1);

      rerender(
        <NumericControl
          value={currentValue}
          onChange={handleChange}
          min={0}
          max={100}
          step={1}
          ariaLabel="Opacity"
        />,
      );

      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(handleChange).toHaveBeenCalledWith(0);

      rerender(
        <NumericControl
          value={currentValue}
          onChange={handleChange}
          min={0}
          max={100}
          step={1}
          ariaLabel="Opacity"
        />,
      );

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(handleChange).toHaveBeenLastCalledWith(0);

      fireEvent.pointerUp(window);
    });
  });
});
