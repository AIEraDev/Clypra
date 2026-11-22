import React from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { SUPPORTED_FRAME_RATES, type FrameRate } from "@/store/settingsTypes";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { refitClipsForCanvasChange } from "@/lib/timeline/refitClips";
import { useI18n } from "@/i18n/I18nProvider";
import { SettingRow } from "./SettingRow";
import { ToggleSwitch } from "./ToggleSwitch";

export const EditorTab: React.FC = () => {
  const {
    snapToGrid,
    autoSave,
    defaultFrameRate,
    previewQuality,
    proxyEditingEnabled,
    autoClearCacheOnProjectClose,
    setSnapToGrid,
    setAutoSave,
    setDefaultFrameRate,
    setPreviewQuality,
    setProxyEditingEnabled,
    setAutoClearCacheOnProjectClose,
  } = useSettingsStore();

  const { snapEnabled, toggleSnapEnabled } = useTimelineStore();
  const { project, updateProject } = useProjectStore();
  const { t } = useI18n();

  const aspectRatios: Array<{
    value: string;
    label: string;
    dimensions: string;
  }> = [
    { value: "16:9", label: "16:9", dimensions: "1920×1080" },
    { value: "9:16", label: "9:16", dimensions: "1080×1920" },
    { value: "1:1", label: "1:1", dimensions: "1080×1080" },
    { value: "4:3", label: "4:3", dimensions: "1440×1080" },
    { value: "21:9", label: "21:9", dimensions: "2520×1080" },
  ];

  const handleAspectRatioChange = (aspectRatio: string) => {
    if (!project) return;

    const dims = aspectRatios.find((ar) => ar.value === aspectRatio);
    if (!dims) return;

    const [width, height] = dims.dimensions.split("×").map(Number);
    const oldW = project.canvasWidth;
    const oldH = project.canvasHeight;

    updateProject({
      aspectRatio: aspectRatio as any,
      canvasWidth: width,
      canvasHeight: height,
    });
    refitClipsForCanvasChange(width, height, oldW, oldH);
  };

  return (
    <div className="space-y-5">
      {/* Timeline Controls */}
      <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
          {t("settings.editor.timelineTitle")}
        </h3>
        <div className="divide-y divide-border-subtle/50">
          <SettingRow
            label={t("settings.editor.snapToGrid")}
            description={t("settings.editor.snapToGridDesc")}
          >
            <ToggleSwitch
              checked={snapToGrid}
              onChange={setSnapToGrid}
              aria-label={t("settings.editor.snapToGrid")}
            />
          </SettingRow>
          <SettingRow
            label={t("settings.editor.magneticSnap")}
            description={t("settings.editor.magneticSnapDesc")}
          >
            <ToggleSwitch
              checked={snapEnabled}
              onChange={toggleSnapEnabled}
              aria-label={t("settings.editor.magneticSnap")}
            />
          </SettingRow>
        </div>
      </section>

      {/* Playback & Quality */}
      <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
          {t("settings.editor.playbackTitle")}
        </h3>
        <div className="divide-y divide-border-subtle/50">
          <SettingRow
            label={t("settings.editor.previewQuality")}
            description={t("settings.editor.previewQualityDesc")}
          >
            <div className="flex rounded-lg overflow-hidden border border-border-default bg-surface-elevated p-0.5">
              {(
                [
                  { value: "full", label: "Full" },
                  { value: "high", label: "High" },
                  { value: "medium", label: "Med" },
                  { value: "low", label: "Proxy" },
                ] as const
              ).map((tier) => (
                <button
                  key={tier.value}
                  type="button"
                  onClick={() => setPreviewQuality(tier.value)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                    previewQuality === tier.value
                      ? "bg-accent-primary text-white shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label={t("settings.editor.proxyMode")}
            description={t("settings.editor.proxyModeDesc")}
          >
            <ToggleSwitch
              checked={proxyEditingEnabled}
              onChange={setProxyEditingEnabled}
              aria-label={t("settings.editor.proxyMode")}
            />
          </SettingRow>

          <SettingRow
            label={t("settings.editor.autoClearCache")}
            description={t("settings.editor.autoClearCacheDesc")}
          >
            <ToggleSwitch
              checked={autoClearCacheOnProjectClose}
              onChange={setAutoClearCacheOnProjectClose}
              aria-label={t("settings.editor.autoClearCache")}
            />
          </SettingRow>
        </div>
      </section>

      {/* Active Sequence Settings (Project Dependent) */}
      {project && (
        <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
            {t("settings.editor.sequenceTitle")}
          </h3>
          <div className="divide-y divide-border-subtle/50">
            <SettingRow
              label={t("settings.editor.aspectRatio")}
              description={t("settings.editor.aspectRatioDesc")}
            >
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex rounded-lg overflow-hidden border border-border-default bg-surface-elevated p-0.5">
                  {aspectRatios.map((ar) => (
                    <button
                      key={ar.value}
                      type="button"
                      onClick={() => handleAspectRatioChange(ar.value)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                        project.aspectRatio === ar.value
                          ? "bg-accent-primary text-white shadow-xs font-semibold"
                          : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
                      }`}
                    >
                      {ar.label}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] font-mono text-text-muted">
                  {project.canvasWidth}×{project.canvasHeight}px
                </span>
              </div>
            </SettingRow>

            <SettingRow
              label={t("settings.editor.frameRate")}
              description={t("settings.editor.frameRateDesc")}
            >
              <select
                value={project.frameRate}
                onChange={(e) =>
                  updateProject({
                    frameRate: Number(e.target.value) as FrameRate,
                  })
                }
                aria-label={t("settings.editor.frameRate")}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-input border border-border-default text-text-primary focus:outline-none focus:border-accent-primary cursor-pointer transition-colors"
              >
                {SUPPORTED_FRAME_RATES.map((fps) => (
                  <option key={fps} value={fps}>
                    {Number.isInteger(fps) ? `${fps} fps` : `${fps} fps`}
                  </option>
                ))}
              </select>
            </SettingRow>
          </div>
        </section>
      )}

      {/* Defaults */}
      <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
          {t("settings.editor.defaultsTitle")}
        </h3>
        <div className="divide-y divide-border-subtle/50">
          <SettingRow
            label={t("settings.editor.autoSave")}
            description={t("settings.editor.autoSaveDesc")}
          >
            <ToggleSwitch
              checked={autoSave}
              onChange={setAutoSave}
              aria-label={t("settings.editor.autoSave")}
            />
          </SettingRow>

          <SettingRow
            label={t("settings.editor.defaultFrameRate")}
            description={t("settings.editor.defaultFrameRateDesc")}
          >
            <select
              value={defaultFrameRate}
              onChange={(e) =>
                setDefaultFrameRate(Number(e.target.value) as FrameRate)
              }
              aria-label={t("settings.editor.defaultFrameRate")}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-input border border-border-default text-text-primary focus:outline-none focus:border-accent-primary cursor-pointer transition-colors"
            >
              {SUPPORTED_FRAME_RATES.map((fps) => (
                <option key={fps} value={fps}>
                  {Number.isInteger(fps) ? `${fps} fps` : `${fps} fps`}
                </option>
              ))}
            </select>
          </SettingRow>
        </div>
      </section>
    </div>
  );
};
