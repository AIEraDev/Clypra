import React, { useEffect, useRef, useState } from "react";
import { Modal } from "../primitives/Modal";
import { useI18n } from "@/i18n";

const NOTICE_KEY = "clypra.telemetryOnboardingShown";

interface TelemetryConsentDialogProps {
  isOpen: boolean;
  onKeepSharing: () => void;
  onTurnOff: () => void | Promise<void>;
}

export const TelemetryConsentDialog: React.FC<TelemetryConsentDialogProps> = ({
  isOpen,
  onKeepSharing,
  onTurnOff,
}) => {
  const { t } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  const [isTurningOff, setIsTurningOff] = useState(false);
  const markedShownRef = useRef(false);

  useEffect(() => {
    if (!isOpen || markedShownRef.current) return;
    markedShownRef.current = true;
    try {
      localStorage.setItem(NOTICE_KEY, "true");
    } catch {
      // The resolver fails closed when the notice cannot be persisted.
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTurningOff) return;
      event.preventDefault();
      event.stopPropagation();
      onKeepSharing();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [isOpen, isTurningOff, onKeepSharing]);

  if (!isOpen) return null;

  const handleTurnOff = async () => {
    setIsTurningOff(true);
    try {
      await onTurnOff();
    } finally {
      setIsTurningOff(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onKeepSharing}
      title={t("telemetry.consent.title")}
      size="default"
    >
      <div className="p-6">
        <p className="text-sm leading-6 text-text-primary">
          {t("telemetry.consent.body")}
        </p>

        <button
          type="button"
          className="mt-4 text-sm font-medium text-accent-primary underline underline-offset-2"
          onClick={() => setShowDetails((visible) => !visible)}
          aria-expanded={showDetails}
        >
          {t("telemetry.consent.whatIsSent")}
        </button>
        {showDetails && (
          <p className="mt-2 text-xs leading-5 text-text-muted">
            {t("telemetry.consent.whatIsSentDetails")}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={isTurningOff}
            onClick={onKeepSharing}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
          >
            {t("telemetry.consent.keepSharing")}
          </button>
          <button
            type="button"
            disabled={isTurningOff}
            onClick={handleTurnOff}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
          >
            {t("telemetry.consent.turnOff")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
