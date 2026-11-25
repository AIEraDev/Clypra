import React, { useMemo } from "react";
import { useI18n } from "@/i18n";
import { getPreviewMarkerRanges, type PlanPreview } from "@/core/editPlan/preview";
import type { EditOp, EditPlan } from "@/core/editPlan/types";

export interface EditPlanPreviewPanelProps {
  preview: PlanPreview;
  liveEpoch: number;
  appliedOpCount?: number | null;
  onToggleOp: (opIndex: number) => void;
  onApprove: (plan: EditPlan) => void;
  onReject: () => void;
  onRerun?: () => void;
  onKeep?: () => void;
  onUndo?: () => void;
}

function formatSeconds(ms: number, locale: string): string {
  const sec = ms / 1000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(sec)}s`;
}

function opLabelKey(op: EditOp["op"]): string {
  switch (op) {
    case "deleteRange":
      return "aiPlan.op.deleteRange";
    case "split":
      return "aiPlan.op.split";
    case "trim":
      return "aiPlan.op.trim";
    case "addText":
      return "aiPlan.op.addText";
  }
}

export const EditPlanPreviewPanel: React.FC<EditPlanPreviewPanelProps> = ({
  preview,
  liveEpoch,
  appliedOpCount = null,
  onToggleOp,
  onApprove,
  onReject,
  onRerun,
  onKeep,
  onUndo,
}) => {
  const { t, language } = useI18n();
  const isStale = liveEpoch !== preview.baseEpoch || preview.isStale;
  const markers = useMemo(() => getPreviewMarkerRanges(preview), [preview]);

  if (appliedOpCount !== null) {
    return (
      <section aria-label={t("aiPlan.title")} className="p-3 rounded-lg border border-border bg-card space-y-3">
        <p className="text-sm font-medium">
          {t("aiPlan.appliedBanner", { count: appliedOpCount })}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onKeep}
            className="px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground"
          >
            {t("aiPlan.keep")}
          </button>
          <button
            type="button"
            onClick={onUndo}
            className="px-3 py-1.5 text-xs font-medium rounded border border-border"
          >
            {t("aiPlan.undo")}
          </button>
        </div>
      </section>
    );
  }

  const canApprove =
    !isStale && preview.isValid && preview.totals.enabledOpCount > 0;

  return (
    <section aria-label={t("aiPlan.title")} className="p-3 rounded-lg border border-border bg-card space-y-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("aiPlan.title")}</h3>
        <span className="text-xs text-muted-foreground" data-testid="ai-plan-markers-count">
          {t("aiPlan.markersCount", { count: markers.length })}
        </span>
      </header>

      <div className="text-xs text-muted-foreground space-y-1" data-testid="ai-plan-summary">
        <p>
          {t("aiPlan.summary", {
            cuts: new Intl.NumberFormat(language).format(preview.totals.cutCount),
            before: formatSeconds(preview.totals.durationBeforeMs, language),
            after: formatSeconds(preview.totals.durationAfterMs, language),
          })}
        </p>
      </div>

      {isStale && (
        <div role="status" className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs flex items-center justify-between gap-2">
          <span>{t("aiPlan.staleBanner")}</span>
          {onRerun && (
            <button
              type="button"
              onClick={onRerun}
              className="px-2 py-1 rounded bg-amber-500 text-black font-medium"
            >
              {t("aiPlan.rerun")}
            </button>
          )}
        </div>
      )}

      {preview.warnings.length > 0 && (
        <ul className="text-xs text-destructive space-y-1">
          {preview.warnings.map((w, idx) => (
            <li key={idx}>{w}</li>
          ))}
        </ul>
      )}

      <ul className="space-y-1.5 max-h-60 overflow-y-auto">
        {preview.rows.map((row) => (
          <li
            key={row.opIndex}
            className="flex items-center justify-between gap-2 text-xs p-1.5 rounded border border-border/60"
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={row.enabled}
                aria-label={t("aiPlan.toggleOp", { index: row.opIndex + 1 })}
                onChange={() => onToggleOp(row.opIndex)}
              />
              <span>{t(opLabelKey(row.op.op))}</span>
            </label>
            <span className="text-muted-foreground tabular-nums">
              {row.startMs !== null && row.endMs !== null
                ? `${formatSeconds(row.startMs, language)}–${formatSeconds(row.endMs, language)}`
                : ""}
            </span>
          </li>
        ))}
      </ul>

      <footer className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onReject}
          className="px-3 py-1.5 text-xs font-medium rounded border border-border"
        >
          {t("aiPlan.reject")}
        </button>
        <button
          type="button"
          disabled={!canApprove}
          onClick={() => onApprove(preview.filteredPlan)}
          className="px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {t("aiPlan.approve")}
        </button>
      </footer>
    </section>
  );
};
