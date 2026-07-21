import React from "react";
import { t } from "@/i18n";

interface SafeOverlayProps {
  visible: boolean;
  displayWidth: number;
  displayHeight: number;
  displayOffset: { x: number; y: number };
}

export const SafeOverlay: React.FC<SafeOverlayProps> = ({
  visible,
  displayWidth,
  displayHeight,
  displayOffset,
}) => {
  if (!visible) return null;

  // 90% Action Safe dimensions
  const actionWidth = displayWidth * 0.9;
  const actionHeight = displayHeight * 0.9;
  const actionX = displayOffset.x + (displayWidth - actionWidth) / 2;
  const actionY = displayOffset.y + (displayHeight - actionHeight) / 2;

  // 80% Title Safe dimensions
  const titleWidth = displayWidth * 0.8;
  const titleHeight = displayHeight * 0.8;
  const titleX = displayOffset.x + (displayWidth - titleWidth) / 2;
  const titleY = displayOffset.y + (displayHeight - titleHeight) / 2;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-30 select-none animate-in fade-in duration-200"
      style={{
        width: "100%",
        height: "100%",
      }}
    >
      {/* 90% Action Safe Boundary */}
      <div
        className="absolute border border-dashed border-cyan-400/40 rounded-sm"
        style={{
          left: actionX,
          top: actionY,
          width: actionWidth,
          height: actionHeight,
        }}
      >
        <span className="absolute -top-4 left-1 text-[8px] font-bold font-mono text-cyan-400/50 uppercase tracking-wider select-none">
          {t("editor.preview.safe.action")}
        </span>
      </div>

      {/* 80% Title Safe Boundary */}
      <div
        className="absolute border border-dashed border-indigo-400/40 rounded-sm"
        style={{
          left: titleX,
          top: titleY,
          width: titleWidth,
          height: titleHeight,
        }}
      >
        <span className="absolute -top-4 left-1 text-[8px] font-bold font-mono text-indigo-400/50 uppercase tracking-wider select-none">
          {t("editor.preview.safe.title")}
        </span>
      </div>

      {/* Center Crosshair Marker */}
      <div
        className="absolute w-4 h-px bg-accent/40"
        style={{
          left: displayOffset.x + displayWidth / 2 - 8,
          top: displayOffset.y + displayHeight / 2,
        }}
      />
      <div
        className="absolute h-4 w-px bg-accent/40"
        style={{
          left: displayOffset.x + displayWidth / 2,
          top: displayOffset.y + displayHeight / 2 - 8,
        }}
      />
    </div>
  );
};
