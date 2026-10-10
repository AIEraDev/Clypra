import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import i18nInstance from "./i18nInstance";
import {
  AppLanguage,
  SUPPORTED_LANGUAGES,
  DICTIONARIES,
  LanguageInfo,
} from "./locales";

export type { AppLanguage, LanguageInfo };
export { SUPPORTED_LANGUAGES };

const STORAGE_KEY = "clypra.language";

const REVERSE_DICTIONARIES: Record<string, string>[] = Object.values(DICTIONARIES).map((dict) =>
  Object.fromEntries(Object.entries(dict).map(([en, localized]) => [localized, en]))
);

const DYNAMIC_REPLACEMENTS: Record<Exclude<AppLanguage, "en">, [RegExp, string][]> = {
  "zh-TW": [
    [/\bUntitled Project\b/g, "未命名專案"],
    [/\bToday\b/g, "今天"],
    [/\bYesterday\b/g, "昨天"],
    [/\bStandard\b/g, "標準"],
    [/\bReadable cadence\b/g, "可讀節奏"],
    [/\btimes\b/g, "倍"],
    [/\bsamples\b/g, "樣本"],
  ],
  "zh-CN": [
    [/\bUntitled Project\b/g, "未命名项目"],
    [/\bToday\b/g, "今天"],
    [/\bYesterday\b/g, "昨天"],
    [/\bStandard\b/g, "标准"],
    [/\bReadable cadence\b/g, "可读节奏"],
    [/\btimes\b/g, "倍"],
    [/\bsamples\b/g, "样本"],
  ],
  "ru": [
    [/\bUntitled Project\b/g, "Безымянный проект"],
    [/\bToday\b/g, "Сегодня"],
    [/\bYesterday\b/g, "Вчера"],
    [/\bStandard\b/g, "Стандартный"],
    [/\bReadable cadence\b/g, "Удобочитаемый темп"],
    [/\btimes\b/g, "раз"],
    [/\bsamples\b/g, "сэмплов"],
  ],
  "es": [
    [/\bUntitled Project\b/g, "Proyecto sin título"],
    [/\bToday\b/g, "Hoy"],
    [/\bYesterday\b/g, "Ayer"],
    [/\bStandard\b/g, "Estándar"],
    [/\bReadable cadence\b/g, "Cadencia legible"],
    [/\btimes\b/g, "veces"],
    [/\bsamples\b/g, "muestras"],
  ],
  "ja": [
    [/\bUntitled Project\b/g, "名称未設定プロジェクト"],
    [/\bToday\b/g, "今日"],
    [/\bYesterday\b/g, "昨日"],
    [/\bStandard\b/g, "標準"],
    [/\bReadable cadence\b/g, "読みやすいテンポ"],
    [/\btimes\b/g, "倍"],
    [/\bsamples\b/g, "サンプル"],
  ],
  "de": [
    [/\bUntitled Project\b/g, "Unbenanntes Projekt"],
    [/\bToday\b/g, "Heute"],
    [/\bYesterday\b/g, "Gestern"],
    [/\bStandard\b/g, "Standard"],
    [/\bReadable cadence\b/g, "Lesbares Tempo"],
    [/\btimes\b/g, "Mal"],
    [/\bsamples\b/g, "Samples"],
  ],
  "fr": [
    [/\bUntitled Project\b/g, "Projet sans titre"],
    [/\bToday\b/g, "Aujourd'hui"],
    [/\bYesterday\b/g, "Hier"],
    [/\bStandard\b/g, "Standard"],
    [/\bReadable cadence\b/g, "Cadence lisible"],
    [/\btimes\b/g, "fois"],
    [/\bsamples\b/g, "échantillons"],
  ],
  "ko": [
    [/\bUntitled Project\b/g, "제목 없는 프로젝트"],
    [/\bToday\b/g, "오늘"],
    [/\bYesterday\b/g, "어제"],
    [/\bStandard\b/g, "표준"],
    [/\bReadable cadence\b/g, "읽기 편한 템포"],
    [/\btimes\b/g, "배"],
    [/\bsamples\b/g, "샘플"],
  ],
};

const EN_DYNAMIC_REPLACEMENTS: [RegExp, string][] = [
  [/未命名專案|未命名项目|Безымянный проект|Proyecto sin título|名称未設定プロジェクト|Unbenanntes Projekt|Projet sans titre|제목 없는 프로젝트/g, "Untitled Project"],
  [/今天|Сегодня|Hoy|今日|Heute|Aujourd'hui|오늘/g, "Today"],
  [/昨天|Вчера|Ayer|昨日|Gestern|Hier|어제/g, "Yesterday"],
  [/標準|标准|Стандартный|Estándar|Lesbares Tempo|읽기 편한 템포/g, "Standard"],
  [/可讀節奏|可读节奏|Удобочитаемый темп|Cadencia legible|読みやすいテンポ|Cadence lisible/g, "Readable cadence"],
  [/倍|раз|veces|Mal|fois|배/g, "times"],
  [/樣本|样本|сэмплов|muestras|サンプル|Samples|échantillons|샘플/g, "samples"],
];

const ATTRIBUTES = ["title", "placeholder", "aria-label"] as const;
const originalText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Map<string, string>>();

export function translateText(value: string, language: AppLanguage): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (language === "en") {
    for (const rev of REVERSE_DICTIONARIES) {
      const fromRev = rev[trimmed];
      if (fromRev) return value.replace(trimmed, fromRev);
    }
    let res = value;
    for (const [pattern, replacement] of EN_DYNAMIC_REPLACEMENTS) {
      res = res.replace(pattern, replacement);
    }
    return res;
  }

  const dict = DICTIONARIES[language];
  if (dict) {
    const translated = dict[trimmed];
    if (translated) return value.replace(trimmed, translated);
  }

  const replacements = DYNAMIC_REPLACEMENTS[language];
  if (replacements) {
    let res = value;
    for (const [pattern, replacement] of replacements) {
      res = res.replace(pattern, replacement);
    }
    return res;
  }

  return value;
}

function resolveOriginalEnglish(text: string): string {
  const trimmed = text.trim();
  for (const rev of REVERSE_DICTIONARIES) {
    const origEn = rev[trimmed];
    if (origEn) return text.replace(trimmed, origEn);
  }
  return text;
}

function isKnownTranslationOf(candidate: string, source: string): boolean {
  if (candidate === source) return true;
  for (const lang of Object.keys(DICTIONARIES) as (keyof typeof DICTIONARIES)[]) {
    if (translateText(source, lang) === candidate) return true;
  }
  return false;
}

function localizeTree(root: Node, language: AppLanguage) {
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (!text.data.trim()) return;
      const previous = originalText.get(text);
      if (previous === undefined) {
        originalText.set(text, resolveOriginalEnglish(text.data));
      } else if (!isKnownTranslationOf(text.data, previous)) {
        originalText.set(text, text.data);
      }

      const source = originalText.get(text)!;
      const next = translateText(source, language);
      if (text.data !== next) {
        text.data = next;
      }
      return;
    }

    if (
      !(node instanceof Element) ||
      ["SCRIPT", "STYLE", "TEXTAREA"].includes(node.tagName) ||
      node.closest("[data-no-i18n], [contenteditable='true']")
    ) {
      return;
    }

    let saved = originalAttrs.get(node);
    if (!saved) {
      saved = new Map();
      originalAttrs.set(node, saved);
    }

    for (const attr of ATTRIBUTES) {
      const value = node.getAttribute(attr);
      if (value === null) continue;
      const previous = saved.get(attr);
      if (previous === undefined) {
        saved.set(attr, resolveOriginalEnglish(value));
      } else if (!isKnownTranslationOf(value, previous)) {
        saved.set(attr, value);
      }
      const source = saved.get(attr)!;
      const next = translateText(source, language);
      if (value !== next) {
        node.setAttribute(attr, next);
      }
    }

    node.childNodes.forEach(visit);
  };

  visit(root);
}

export type I18nValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (keyOrText: string, options?: Record<string, unknown>) => string;
  i18n: typeof i18nInstance;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (date: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDuration: (seconds: number) => string;
  formatFileSize: (bytes: number) => string;
  formatPercent: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function initialLanguage(): AppLanguage {
  const saved = localStorage.getItem(STORAGE_KEY) as AppLanguage | null;
  if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
    return saved;
  }
  const nav = navigator.language.toLowerCase();
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

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, updateLanguage] = useState<AppLanguage>(initialLanguage);

  const setLanguage = useCallback((next: AppLanguage) => {
    localStorage.setItem(STORAGE_KEY, next);
    i18nInstance.changeLanguage(next).catch(() => undefined);
    updateLanguage(next);
  }, []);

  const t = useCallback(
    (keyOrText: string, options?: Record<string, unknown>) => {
      // 1. Check if it is a registered semantic key in i18next
      if (i18nInstance.exists(keyOrText, { lng: language })) {
        return i18nInstance.t(keyOrText, { lng: language, ...options });
      }

      // 2. Legacy fallback: check legacy reverse/direct dictionary
      const legacy = translateText(keyOrText, language);
      if (legacy !== keyOrText) {
        return legacy;
      }

      // 3. Fallback to i18next resolution (including fallbackLng)
      return i18nInstance.t(keyOrText, { lng: language, ...options });
    },
    [language]
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => {
      try {
        return new Intl.NumberFormat(language, options).format(value);
      } catch {
        return value.toLocaleString();
      }
    },
    [language]
  );

  const formatDate = useCallback(
    (date: Date | number, options?: Intl.DateTimeFormatOptions) => {
      try {
        const d = typeof date === "number" ? new Date(date) : date;
        return new Intl.DateTimeFormat(language, options).format(d);
      } catch {
        return String(date);
      }
    },
    [language]
  );

  const formatDuration = useCallback((seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }, []);

  const formatFileSize = useCallback(
    (bytes: number) => {
      if (bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      const val = bytes / Math.pow(1024, i);
      const formatted = new Intl.NumberFormat(language, {
        maximumFractionDigits: val >= 10 ? 1 : 2,
      }).format(val);
      return `${formatted} ${units[i]}`;
    },
    [language]
  );

  const formatPercent = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => {
      try {
        return new Intl.NumberFormat(language, {
          style: "percent",
          maximumFractionDigits: 1,
          ...options,
        }).format(value);
      } catch {
        return `${(value * 100).toFixed(1)}%`;
      }
    },
    [language]
  );

  useEffect(() => {
    document.documentElement.lang = language;
    i18nInstance.changeLanguage(language).catch(() => undefined);
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_menu_language", { language }))
      .catch(() => undefined);
    localizeTree(document.body, language);
    let isApplying = false;
    const observer = new MutationObserver((mutations) => {
      if (isApplying) return;
      isApplying = true;
      try {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") localizeTree(mutation.target, language);
          mutation.addedNodes.forEach((node) => localizeTree(node, language));
        }
      } finally {
        queueMicrotask(() => {
          isApplying = false;
        });
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      i18n: i18nInstance,
      formatNumber,
      formatDate,
      formatDuration,
      formatFileSize,
      formatPercent,
    }),
    [language, setLanguage, t, formatNumber, formatDate, formatDuration, formatFileSize, formatPercent]
  );

  return (
    <I18nextProvider i18n={i18nInstance}>
      <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    </I18nextProvider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    const lang = (i18nInstance.language as AppLanguage) || "en";
    return {
      language: lang,
      setLanguage: (next: AppLanguage) => {
        i18nInstance.changeLanguage(next).catch(() => undefined);
      },
      t: (keyOrText: string, options?: Record<string, unknown>) => {
        if (i18nInstance.exists(keyOrText, { lng: lang })) {
          return i18nInstance.t(keyOrText, { lng: lang, ...options });
        }
        const legacy = translateText(keyOrText, lang);
        if (legacy !== keyOrText) return legacy;
        return i18nInstance.t(keyOrText, { lng: lang, ...options });
      },
      i18n: i18nInstance,
      formatNumber: (v: number, options?: Intl.NumberFormatOptions) => {
        try {
          return new Intl.NumberFormat(lang, options).format(v);
        } catch {
          return String(v);
        }
      },
      formatDate: (d: Date | number, options?: Intl.DateTimeFormatOptions) => {
        try {
          return new Intl.DateTimeFormat(lang, options).format(new Date(d));
        } catch {
          return String(d);
        }
      },
      formatDuration: (s: number) => {
        const total = Math.max(0, Math.floor(s));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return `${mins}:${String(secs).padStart(2, "0")}`;
      },
      formatFileSize: (b: number) => `${b} B`,
      formatPercent: (p: number) => `${Math.round(p * 100)}%`,
    };
  }
  return context;
}
