import React from "react";
import { t } from "@/i18n";

/**
 * Shown when the PreviewErrorBoundary catches a WebGL / Pixi initialization error.
 * Clypra requires WebGL — there is no Canvas 2D fallback renderer.
 */
export const WebGLUnavailableError: React.FC = () => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#0f0f11",
        color: "#e0e0e6",
        fontFamily: "system-ui, -apple-system, sans-serif",
        gap: "12px",
        padding: "32px",
        textAlign: "center",
      }}
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#f87171"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p style={{ fontSize: "15px", fontWeight: 600, margin: 0, color: "#fafafa" }}>
        {t("editor.preview.webgl.unavailable")}
      </p>
      <p style={{ fontSize: "13px", margin: 0, color: "#9ca3af", maxWidth: "320px", lineHeight: 1.5 }}>
        {t("editor.preview.webgl.requirement")}
      </p>
    </div>
  );
};
