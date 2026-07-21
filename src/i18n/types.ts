export interface LocalizedMessage {
  en: string;
  zhCN: string;
}

export type MessageParams = Record<string, string | number>;

export function defineMessages<
  const T extends Record<string, LocalizedMessage>,
>(messages: T): T {
  return messages;
}
