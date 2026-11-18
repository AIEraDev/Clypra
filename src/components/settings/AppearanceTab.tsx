import React from "react";
import { Moon, Sun, Check } from "lucide-react";
import { useSettingsStore, FontFamily, FONT_META } from "@/store/settingsStore";
import type { ColorMode } from "@/store/settingsTypes";
import { useI18n, SUPPORTED_LANGUAGES, AppLanguage } from "@/i18n/I18nProvider";
import { SettingRow } from "./SettingRow";

export const AppearanceTab: React.FC = () => {
  const { uiTheme, fontFamily, setTheme, setFontFamily } = useSettingsStore();
  const { language, setLanguage, t } = useI18n();

  const colorModes: ColorMode[] = ["dark", "light"];
  const fontKeys: FontFamily[] = [
    "inter",
    "montserrat",
    "geist",
    "outfit",
    "roboto",
    "space-grotesk",
    "system",
    "mono",
  ];

  return (
    <div className="space-y-5">
      {/* Interface Language */}
      <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
          {t("settings.language.label")}
        </h3>
        <SettingRow
          label={t("settings.language.label")}
          description={t("settings.language.description")}
        >
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as AppLanguage)}
            aria-label={t("settings.language.label")}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-input border border-border-default text-text-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/40 cursor-pointer transition-colors"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code} data-no-i18n>
                {lang.code === "en" ? lang.name : `${lang.nativeName} (${lang.name})`}
              </option>
            ))}
          </select>
        </SettingRow>
      </section>

      {/* Theme Mode (Dark / Light) */}
      <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t("settings.theme.title")}
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {colorModes.map((mode) => {
            const isSelected = uiTheme === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setTheme(mode)}
                className={`flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-accent-primary/10 border-accent-primary text-accent-primary shadow-xs ring-1 ring-accent-primary/30"
                    : "bg-surface-elevated border-border-default text-text-muted hover:text-text-primary hover:border-border-hover"
                }`}
              >
                {mode === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                <span>{mode === "dark" ? t("settings.theme.dark") : t("settings.theme.light")}</span>
                {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-accent-primary" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Typography / Font Family */}
      <section className="rounded-xl bg-surface-card border border-border-default/70 p-4 sm:p-5 shadow-xs">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
          {t("settings.font.title")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {fontKeys.map((f) => {
            const meta = FONT_META[f];
            const isSel = fontFamily === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFontFamily(f)}
                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all cursor-pointer ${
                  isSel
                    ? "border-accent-primary bg-accent-primary/10 text-accent-primary ring-1 ring-accent-primary/40 shadow-xs"
                    : "border-border-default bg-surface-elevated hover:border-border-hover text-text-muted hover:text-text-primary"
                }`}
              >
                <span className="text-xl leading-none" style={{ fontFamily: meta.stack }}>
                  Aa
                </span>
                <span className="text-[11px] font-medium tracking-tight truncate max-w-full">
                  {meta.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
