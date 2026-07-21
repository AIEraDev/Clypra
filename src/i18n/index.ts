import { messages } from "./catalogs";
import type { LocalizedMessage, MessageParams } from "./types";

export type MessageKey = keyof typeof messages;

export function resolveMessage(
  definition: Partial<LocalizedMessage> | undefined,
  key: string,
  params: MessageParams = {},
): string {
  const message = definition?.zhCN?.trim()
    ? definition.zhCN
    : definition?.en?.trim()
      ? definition.en
      : key;

  return message.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (placeholder, name) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name]);
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
