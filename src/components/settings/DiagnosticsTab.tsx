import React, { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { PerfLogService, perfLogService } from "@/services/perfLogService";
import { SettingRow } from "./SettingRow";
import { ToggleSwitch } from "./ToggleSwitch";

export const DiagnosticsTab: React.FC = () => {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(() => PerfLogService.isTelemetryUploadEnabledStatic());
  const [busy, setBusy] = useState(false);

  const handleChange = async (nextEnabled: boolean) => {
    setBusy(true);
    try {
      if (nextEnabled) {
        PerfLogService.setTelemetryUploadEnabled(true);
      } else {
        await PerfLogService.disableTelemetryUpload();
      }
      setEnabled(nextEnabled);
    } finally {
      setBusy(false);
    }
  };

  const openTelemetryDoc = () => {
    window.open(
      "https://github.com/AIEraDev/Clypra/blob/master/docs/telemetry.md",
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
          {t("settings.tabs.diagnostics")}
        </h3>
        <p className="text-xs leading-5 text-text-muted mb-3">
          {t("settings.diagnostics.telemetryDescription")}
        </p>
        <div className="divide-y divide-border-subtle/50">
          <SettingRow
            label={t("settings.diagnostics.shareAnonymousDiagnostics")}
            description={t("settings.diagnostics.telemetryPurpose")}
          >
            <ToggleSwitch
              checked={enabled}
              disabled={busy}
              onChange={(next) => void handleChange(next)}
              aria-label={t("settings.diagnostics.shareAnonymousDiagnostics")}
            />
          </SettingRow>
        </div>
        <button
          type="button"
          onClick={openTelemetryDoc}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent-primary underline underline-offset-2"
        >
          {t("settings.diagnostics.whatIsSentLink")}
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </section>

      <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
        <SettingRow
          label={t("settings.diagnostics.sessionIdLabel")}
          description={perfLogService.getSessionId() ?? t("settings.diagnostics.sessionIdUnavailable")}
        >
          <span className="max-w-[180px] truncate font-mono text-[11px] text-text-muted">
            {perfLogService.getSessionId() ?? "—"}
          </span>
        </SettingRow>
        <p className="mt-3 text-[11px] leading-5 text-text-muted">
          {t("settings.diagnostics.deletionRequest")}
        </p>
      </section>
    </div>
  );
};
