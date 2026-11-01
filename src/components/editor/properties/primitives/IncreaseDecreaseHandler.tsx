import React, { useCallback, useEffect, useRef, useState } from "react";

interface IncreaseDecreaseHandlerProps {
  onIncrease: () => void;
  onDecrease: () => void;
  label: string;
  disabled?: boolean;
}

export const IncreaseDecreaseHandler: React.FC<
  IncreaseDecreaseHandlerProps
> = ({ onIncrease, onDecrease, label, disabled = false }) => {
  const onIncreaseRef = useRef(onIncrease);
  const onDecreaseRef = useRef(onDecrease);
  useEffect(() => {
    onIncreaseRef.current = onIncrease;
    onDecreaseRef.current = onDecrease;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepCountRef = useRef(0);
  const suppressClickRef = useRef(false);
  const [activeDirection, setActiveDirection] = useState<"up" | "down" | null>(
    null,
  );

  const clearHoldTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    stepCountRef.current = 0;
    setActiveDirection(null);
  }, []);

  // Cleanup on unmount or disable
  useEffect(() => {
    if (disabled) {
      clearHoldTimer();
    }
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [disabled, clearHoldTimer]);

  const scheduleNextTick = useCallback((direction: "up" | "down") => {
    stepCountRef.current += 1;
    const count = stepCountRef.current;
    let nextDelay = 80;
    if (count > 25) {
      nextDelay = 25;
    } else if (count > 10) {
      nextDelay = 40;
    } else if (count > 4) {
      nextDelay = 60;
    }

    timerRef.current = setTimeout(() => {
      const fn =
        direction === "up" ? onIncreaseRef.current : onDecreaseRef.current;
      fn();
      scheduleNextTick(direction);
    }, nextDelay);
  }, []);

  const startHold = useCallback(
    (direction: "up" | "down", e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();

      clearHoldTimer();
      suppressClickRef.current = true;
      setActiveDirection(direction);

      const action =
        direction === "up" ? onIncreaseRef.current : onDecreaseRef.current;
      // Immediate first step on pointerdown
      action();

      // Schedule continuous repeat after initial hold delay (350ms)
      timerRef.current = setTimeout(() => {
        const repeatAction =
          direction === "up" ? onIncreaseRef.current : onDecreaseRef.current;
        repeatAction();
        scheduleNextTick(direction);
      }, 350);
    },
    [disabled, clearHoldTimer, scheduleNextTick],
  );

  const stopHold = useCallback(() => {
    clearHoldTimer();
  }, [clearHoldTimer]);

  // Global listener ensures hold stops even if pointer releases outside the button
  useEffect(() => {
    if (!activeDirection) return;

    const handleGlobalRelease = () => {
      clearHoldTimer();
    };

    window.addEventListener("pointerup", handleGlobalRelease);
    window.addEventListener("pointercancel", handleGlobalRelease);
    return () => {
      window.removeEventListener("pointerup", handleGlobalRelease);
      window.removeEventListener("pointercancel", handleGlobalRelease);
    };
  }, [activeDirection, clearHoldTimer]);

  const handleIncreaseClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (!disabled) {
        onIncrease();
      }
    },
    [disabled, onIncrease],
  );

  const handleDecreaseClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (!disabled) {
        onDecrease();
      }
    },
    [disabled, onDecrease],
  );

  return (
    <div className="flex flex-col bg-[#27272a] border border-white/8 rounded-sm overflow-hidden select-none">
      <button
        type="button"
        onPointerDown={(e) => startHold("up", e)}
        onPointerUp={stopHold}
        onClick={handleIncreaseClick}
        disabled={disabled}
        className={`h-[10px] w-[16px] flex items-center justify-center transition-colors border-b border-white/8 ${
          disabled
            ? "text-[#71717a]/40 cursor-not-allowed"
            : activeDirection === "up"
              ? "bg-white/15 text-white cursor-pointer"
              : "text-[#71717a] hover:text-white hover:bg-white/8 cursor-pointer"
        }`}
        aria-label={`Increase ${label}`}
      >
        {/* prettier-ignore */}
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
      </button>
      <button
        type="button"
        onPointerDown={(e) => startHold("down", e)}
        onPointerUp={stopHold}
        onClick={handleDecreaseClick}
        disabled={disabled}
        className={`h-[10px] w-[16px] flex items-center justify-center transition-colors ${
          disabled
            ? "text-[#71717a]/40 cursor-not-allowed"
            : activeDirection === "down"
              ? "bg-white/15 text-white cursor-pointer"
              : "text-[#71717a] hover:text-white hover:bg-white/8 cursor-pointer"
        }`}
        aria-label={`Decrease ${label}`}
      >
        {/* prettier-ignore */}
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" ><polyline points="6 9 12 15 18 9" /></svg>
      </button>
    </div>
  );
};
