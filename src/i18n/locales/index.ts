import { ZH_TW } from "./zh-TW";
import { ZH_CN } from "./zh-CN";
import { RU } from "./ru";
import { ES } from "./es";
import { JA } from "./ja";
import { DE } from "./de";
import { FR } from "./fr";
import { KO } from "./ko";

export type AppLanguage = "en" | "zh-TW" | "zh-CN" | "ru" | "es" | "ja" | "de" | "fr" | "ko";

export interface LanguageInfo {
  code: AppLanguage;
  name: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "zh-CN", name: "Simplified Chinese", nativeName: "简体中文" },
  { code: "zh-TW", name: "Traditional Chinese", nativeName: "繁體中文" },
];

export const DICTIONARIES: Record<Exclude<AppLanguage, "en">, Record<string, string>> = {
  "ru": RU,
  "es": ES,
  "ja": JA,
  "de": DE,
  "fr": FR,
  "ko": KO,
  "zh-CN": ZH_CN,
  "zh-TW": ZH_TW,
};

export { ZH_TW, ZH_CN, RU, ES, JA, DE, FR, KO };
