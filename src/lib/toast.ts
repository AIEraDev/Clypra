/**
 * Clypra Toast Notification System
 * Powered by Sonner (https://sonner.emilkowal.ski/)
 *
 * Provides a unified, accessible, and high-performance toast mechanism
 * across React components, Zustand stores, async handlers, and native bridges.
 */

import { toast, type ExternalToast } from "sonner";

export type ToastVariant = "success" | "error" | "warning" | "info";
export type ToastOptions = ExternalToast;

/**
 * Universal toast trigger
 */
export function notify(
  message: string,
  variant: ToastVariant = "success",
  options?: ToastOptions,
): string | number {
  switch (variant) {
    case "error":
      return toast.error(message, options);
    case "warning":
      return toast.warning(message, options);
    case "info":
      return toast.info(message, options);
    case "success":
    default:
      return toast.success(message, options);
  }
}

export { toast };
