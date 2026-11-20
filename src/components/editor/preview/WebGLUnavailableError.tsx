import React from "react";
import { useI18n } from "@/i18n";

export interface WebGLUnavailableErrorProps {
  reason?: "native-surface" | "gpu";
}

/**
 * Shown when the native preview cannot initialize. The desktop editor does
 * not silently switch to a different renderer.
 */
export const WebGLUnavailableError: React.FC<WebGLUnavailableErrorProps> = ({
  reason = "native-surface",
}) => {
  const { t } = useI18n();
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
        {t("preview.errors.title")}
      </p>
      <p style={{ fontSize: "13px", margin: 0, color: "#9ca3af", maxWidth: "320px", lineHeight: 1.5 }}>
        {t(reason === "gpu" ? "preview.errors.gpu" : "preview.errors.nativeSurface")}
      </p>
    </div>
  );
};
