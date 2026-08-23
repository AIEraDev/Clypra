import { useEffect, useRef, type RefObject } from "react";

export type ClickOutsideTarget =
  | RefObject<HTMLElement | null>
  | Array<RefObject<HTMLElement | null>>;

export interface UseClickOutsideOptions {
  enabled?: boolean;
  listenEscape?: boolean;
  events?: Array<"mousedown" | "pointerdown" | "touchstart">;
}

/**
 * Hook to handle clicks/taps outside of element(s) and optional Escape key dismissal.
 * Optimizes performance by only binding document listeners when `enabled` is true.
 */
export function useClickOutside(
  target: ClickOutsideTarget,
  onDismiss: () => void,
  options: UseClickOutsideOptions = {}
): void {
  const {
    enabled = true,
    listenEscape = true,
    events = ["mousedown", "pointerdown"],
  } = options;

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;

    const handleEvent = (event: Event) => {
      const targetElement = event.target as Node | null;
      if (!targetElement) return;

      const targets = Array.isArray(target) ? target : [target];
      const clickedInside = targets.some((ref) => {
        const el = ref.current;
        return el ? el.contains(targetElement) : false;
      });

      if (!clickedInside) {
        onDismissRef.current();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (listenEscape && event.key === "Escape") {
        onDismissRef.current();
      }
    };

    for (const eventName of events) {
      document.addEventListener(eventName, handleEvent);
    }

    if (listenEscape) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      for (const eventName of events) {
        document.removeEventListener(eventName, handleEvent);
      }
      if (listenEscape) {
        document.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [enabled, listenEscape, target, ...events]);
}
