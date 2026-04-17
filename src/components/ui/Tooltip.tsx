/**
 * Tooltip Component for Timeline Engine v1
 * Shows explanations for invalid operations
 */

import { useState, useRef, useEffect } from "react";

export interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  delay?: number; // milliseconds before showing
}

/**
 * Displays tooltip explanations on hover
 */
export function Tooltip({ content, children, position = "top", delay = 500 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    // Calculate tooltip position based on prop
    let x = 0;
    let y = 0;

    switch (position) {
      case "top":
        x = rect.left + rect.width / 2;
        y = rect.top - 8;
        break;
      case "bottom":
        x = rect.left + rect.width / 2;
        y = rect.bottom + 8;
        break;
      case "left":
        x = rect.left - 8;
        y = rect.top + rect.height / 2;
        break;
      case "right":
        x = rect.right + 8;
        y = rect.top + rect.height / 2;
        break;
    }

    setCoords({ x, y });

    // Show tooltip after delay
    timeoutRef.current = window.setTimeout(() => {
      setVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <div ref={containerRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className="inline-block">
        {children}
      </div>

      {visible && (
        <div
          className="fixed z-50 px-3 py-2 text-xs font-medium text-white bg-gray-900 rounded-lg shadow-lg pointer-events-none transition-opacity duration-200"
          style={{
            left: coords.x,
            top: coords.y,
            transform: position === "top" ? "translate(-50%, -100%)" : position === "bottom" ? "translate(-50%, 0)" : position === "left" ? "translate(-100%, -50%)" : "translate(0, -50%)",
            maxWidth: "300px",
          }}
          role="tooltip"
        >
          {content}

          {/* Arrow */}
          <div
            className="absolute w-2 h-2 bg-gray-900 transform rotate-45"
            style={{
              left: position === "top" || position === "bottom" ? "50%" : position === "left" ? "100%" : "-4px",
              top: position === "left" || position === "right" ? "50%" : position === "top" ? "100%" : "-4px",
              transform: position === "top" || position === "bottom" ? "translateX(-50%) rotate(45deg)" : position === "left" || position === "right" ? "translateY(-50%) rotate(45deg)" : "rotate(45deg)",
            }}
          />
        </div>
      )}
    </>
  );
}
