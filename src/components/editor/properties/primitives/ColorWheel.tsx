import React, { useRef, useState, useCallback, useEffect } from "react";
import { Undo2 } from "lucide-react";

export interface ColorWheelValue {
  r: number; // -1.0 to 1.0 (Red shift)
  g: number; // -1.0 to 1.0 (Green shift)
  b: number; // -1.0 to 1.0 (Blue shift)
  y: number; // -1.0 to 1.0 (Luminance shift)
}

interface ColorWheelProps {
  label: string;
  value: ColorWheelValue;
  onChange: (newValue: ColorWheelValue) => void;
  onReset?: () => void;
}

export const ColorWheel: React.FC<ColorWheelProps> = ({
  label,
  value,
  onChange,
  onReset,
}) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const r = value.r ?? 0;
  const g = value.g ?? 0;
  const b = value.b ?? 0;
  const y = value.y ?? 0;

  // Convert RGB shift (r, g, b) to 2D vector (px, py) inside wheel [-1, 1]
  // Vector X maps to Red-Cyan balance; Vector Y maps to Green-Magenta/Blue balance
  const puckX = Math.max(-1, Math.min(1, r - (g + b) / 2));
  const puckY = Math.max(-1, Math.min(1, (g - b) * 0.866));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    updateFromPointer(e);
  };

  const updateFromPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement> | MouseEvent) => {
      const wheel = wheelRef.current;
      if (!wheel) return;

      const rect = wheel.getBoundingClientRect();
      const radius = rect.width / 2;
      const centerX = rect.left + radius;
      const centerY = rect.top + radius;

      const dx = (e.clientX - centerX) / radius;
      const dy = (e.clientY - centerY) / radius;

      // Clamp distance to circle boundary
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clampedDist = Math.min(1, dist);
      const angle = Math.atan2(dy, dx);

      const normX = Math.cos(angle) * clampedDist;
      const normY = Math.sin(angle) * clampedDist;

      // Derive RGB shifts from wheel position
      const nextR = Math.max(-1, Math.min(1, normX * 0.8));
      const nextG = Math.max(-1, Math.min(1, -normY * 0.7 + normX * 0.3));
      const nextB = Math.max(-1, Math.min(1, normY * 0.7 + normX * 0.3));

      onChange({ r: nextR, g: nextG, b: nextB, y });
    },
    [onChange, y]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => updateFromPointer(e);
    const handleUp = () => setIsDragging(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging, updateFromPointer]);

  const handleResetPuck = () => {
    if (onReset) {
      onReset();
    } else {
      onChange({ r: 0, g: 0, b: 0, y: 0 });
    }
  };

  const isOverridden = r !== 0 || g !== 0 || b !== 0 || y !== 0;

  return (
    <div className="flex flex-col items-center gap-1.5 p-2 bg-surface-raised/80 border border-border/50 rounded-xl select-none shadow-xs">
      {/* Header Label & Reset */}
      <div className="w-full flex items-center justify-between px-0.5">
        <span className="text-[10px] font-semibold text-text-primary">{label}</span>
        {isOverridden && (
          <button
            onClick={handleResetPuck}
            className="text-accent hover:opacity-80 transition-colors p-0.5"
            title="Reset color wheel"
          >
            <Undo2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* 2D Color Wheel Disc */}
      <div
        ref={wheelRef}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleResetPuck}
        className="relative w-20 h-20 rounded-full border border-border/80 cursor-crosshair shadow-inner overflow-hidden flex items-center justify-center"
        style={{
          background: `conic-gradient(
            from 90deg,
            #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000
          )`,
        }}
      >
        {/* Radial overlay gradient for center saturation blend */}
        <div className="absolute inset-0 rounded-full bg-radial from-surface-panel/90 via-surface-panel/40 to-transparent pointer-events-none" />

        {/* Center alignment crosshairs */}
        <div className="absolute w-full h-[1px] bg-border/60 pointer-events-none" />
        <div className="absolute h-full w-[1px] bg-border/60 pointer-events-none" />

        {/* Draggable Puck Indicator */}
        <div
          className="absolute w-3 h-3 border-2 border-white rounded-full bg-accent shadow-[0_0_6px_rgba(0,0,0,0.8)] transition-transform pointer-events-none"
          style={{
            left: `${50 + puckX * 42}%`,
            top: `${50 + puckY * 42}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      </div>

      {/* Luminance (Y) Slider */}
      <div className="w-full space-y-1 pt-1">
        <div className="flex items-center justify-between text-[9px] text-text-muted">
          <span>Lum</span>
          <span className="tabular-nums font-mono text-text-primary">{(y * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={y}
          onChange={(e) => onChange({ r, g, b, y: parseFloat(e.target.value) })}
          className="w-full h-1 bg-surface rounded appearance-none outline-none cursor-pointer accent-accent"
        />
      </div>
    </div>
  );
};
