import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSettings, applyFontFamily, useSettingsStore, type Language } from "./store/settingsStore";
import { initI18n } from "./i18n";

// Ensure settings (theme, font, etc) are initialized immediately
initSettings();

/**
 * On first launch (no persisted language) match the browser/OS language to one
 * of the supported locales, falling back to English.
 */
function resolveInitialLanguage(): Language {
  const persisted = localStorage.getItem("clypra-settings");
  if (persisted) {
    return useSettingsStore.getState().language;
  }
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("ja")) return "ja";
  if (nav.startsWith("zh")) return "zh-CN";
  return "en";
}

async function bootstrap() {
  const lang = resolveInitialLanguage();
  await initI18n(lang);

  // First-run detection may pick a non-default language: sync the store and
  // re-apply the font (for CJK fallbacks) before rendering.
  if (lang !== useSettingsStore.getState().language) {
    useSettingsStore.setState({ language: lang });
    applyFontFamily(useSettingsStore.getState().fontFamily, lang);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
