import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs } from "./catalogs";

const resources = {
  en: { translation: catalogs.en },
  ru: { translation: catalogs.ru },
  es: { translation: catalogs.es },
  ja: { translation: catalogs.ja },
  de: { translation: catalogs.de },
  fr: { translation: catalogs.fr },
  ko: { translation: catalogs.ko },
  "zh-CN": { translation: catalogs["zh-CN"] },
  "zh-TW": { translation: catalogs["zh-TW"] },
};

export const STORAGE_KEY = "clypra.language";

export function getInitialLanguage(): string {
  if (typeof window === "undefined" || !window.localStorage) return "en";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && Object.prototype.hasOwnProperty.call(resources, saved)) {
    return saved;
  }
  const nav = (navigator.language || "").toLowerCase();
  if (nav.startsWith("ru")) return "ru";
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("ja")) return "ja";
  if (nav.startsWith("de")) return "de";
  if (nav.startsWith("fr")) return "fr";
  if (nav.startsWith("ko")) return "ko";
  if (nav === "zh-cn" || nav.startsWith("zh-cn-") || nav.startsWith("zh-sg")) return "zh-CN";
  if (nav.startsWith("zh")) return "zh-TW";
  return "en";
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false,
    },
  });
}

export default i18n;
