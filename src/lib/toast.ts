/**
 * Clypra Toast Notification System
 * Powered by Sonner (https://sonner.emilkowal.ski/)
 *
 * Provides a unified, accessible, and high-performance toast mechanism
 * across React components, Zustand stores, async handlers, and native bridges.
 * Automatically resolves semantic internationalization keys and fallback text.
 */

import { toast as sonnerToast, type ExternalToast } from "sonner";
import i18nInstance from "@/i18n/i18nInstance";
import { translateText } from "@/i18n/I18nProvider";

export type ToastVariant = "success" | "error" | "warning" | "info";
export type ToastOptions = ExternalToast & {
  interpolation?: Record<string, unknown>;
};

/**
 * Resolves a toast message string against canonical semantic keys and legacy dictionaries.
 */
export function resolveToastMessage(
  message: unknown,
  options?: ToastOptions,
): unknown {
  if (typeof message !== "string") return message;
  const lang = (i18nInstance.language as string) || "en";
  const lookupOptions = { lng: lang, ...options?.interpolation };
  if (i18nInstance.exists(message, lookupOptions)) {
    return i18nInstance.t(message, lookupOptions);
  }
  const legacy = translateText(message, lang as any);
  if (legacy !== message) {
    return legacy;
  }
  return message;
}

/**
 * Universal toast trigger with automatic localization.
 */
export function notify(
  message: string,
  variant: ToastVariant = "success",
  options?: ToastOptions,
): string | number {
  const resolved = resolveToastMessage(message, options) as string;
  switch (variant) {
    case "error":
      return sonnerToast.error(resolved, options);
    case "warning":
      return sonnerToast.warning(resolved, options);
    case "info":
      return sonnerToast.info(resolved, options);
    case "success":
    default:
      return sonnerToast.success(resolved, options);
  }
}

/**
 * Localized toast proxy wrapping Sonner's toast methods.
 */
const toast = ((message: unknown, data?: ToastOptions) => {
  return sonnerToast(resolveToastMessage(message, data) as any, data);
}) as typeof sonnerToast;

// Retain all underlying properties and methods from Sonner
Object.assign(toast, sonnerToast);

toast.success = (message: unknown, data?: ToastOptions) =>
  sonnerToast.success(resolveToastMessage(message, data) as any, data);

toast.error = (message: unknown, data?: ToastOptions) =>
  sonnerToast.error(resolveToastMessage(message, data) as any, data);

toast.warning = (message: unknown, data?: ToastOptions) =>
  sonnerToast.warning(resolveToastMessage(message, data) as any, data);

toast.info = (message: unknown, data?: ToastOptions) =>
  sonnerToast.info(resolveToastMessage(message, data) as any, data);

toast.message = (message: unknown, data?: ToastOptions) =>
  sonnerToast.message(resolveToastMessage(message, data) as any, data);

toast.loading = (message: unknown, data?: ToastOptions) =>
  sonnerToast.loading(resolveToastMessage(message, data) as any, data);

export { toast };
