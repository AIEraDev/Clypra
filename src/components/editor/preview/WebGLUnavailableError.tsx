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
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface-workspace px-8 text-center font-sans text-text-primary">
      <svg
        className="h-10 w-10 text-danger"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="m-0 text-[15px] font-semibold text-text-primary">
        {t("preview.errors.title")}
      </p>
      <p className="m-0 max-w-[320px] text-[13px] leading-relaxed text-text-secondary">
        {t(reason === "gpu" ? "preview.errors.gpu" : "preview.errors.nativeSurface")}
      </p>
    </div>
  );
};
