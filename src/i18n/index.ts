import { useSyncExternalStore } from "react";

import { messages } from "./catalogs";
import type { LocalizedMessage, MessageParams, UiLanguage } from "./types";

export type { UiLanguage } from "./types";

export type MessageKey = keyof typeof messages;

let language: UiLanguage = "zhCN";
const languageListeners = new Set<() => void>();

export function getLanguage(): UiLanguage {
  return language;
}

export function setLanguage(nextLanguage: UiLanguage): void {
  if (nextLanguage === language) return;

  language = nextLanguage;
  languageListeners.forEach((listener) => listener());
}

export function subscribeLanguage(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

export function useLanguage(): UiLanguage {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

export function resolveMessage(
  definition: Partial<LocalizedMessage> | undefined,
  key: string,
  params: MessageParams = {},
  selectedLanguage: UiLanguage = getLanguage(),
): string {
  const fallbackLanguage = selectedLanguage === "zhCN" ? "en" : "zhCN";
  const message = definition?.[selectedLanguage]?.trim()
    ? definition[selectedLanguage]
    : definition?.[fallbackLanguage]?.trim()
      ? definition[fallbackLanguage]
      : key;

  return message.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (placeholder, name) => {
    const value = params[name];

    if (value !== undefined && value !== null) {
      return String(value);
    }

    if (import.meta.env.DEV) {
      console.warn(`[i18n] Missing parameter "${name}" for "${key}"`);
    }

    return placeholder;
  });
}

export function t(key: MessageKey, params: MessageParams = {}): string {
  return resolveMessage(messages[key], key, params);
}
