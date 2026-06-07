import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@/store/settingsStore";

// Lazy loaders: each locale becomes its own Vite chunk and is only fetched
// when the language is actually used.
const loaders: Record<Language, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("./locales/en.json"),
  ja: () => import("./locales/ja.json"),
  "zh-CN": () => import("./locales/zh-CN.json"),
};

const loaded = new Set<Language>();

async function ensureLoaded(lang: Language) {
  if (loaded.has(lang)) return;
  const mod = await loaders[lang]();
  i18next.addResourceBundle(lang, "translation", mod.default, true, true);
  loaded.add(lang);
}

export async function initI18n(lang: Language) {
  await i18next.use(initReactI18next).init({
    lng: lang,
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  // Load the active language plus the English fallback up front so missing
  // keys never surface as raw key strings.
  await Promise.all([ensureLoaded(lang), ensureLoaded("en")]);
}

export async function changeLanguage(lang: Language) {
  await ensureLoaded(lang);
  await i18next.changeLanguage(lang);
}

export default i18next;
