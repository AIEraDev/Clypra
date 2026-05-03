import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || Number.isNaN(min) || Number.isNaN(max)) return NaN;
  const actualMin = Math.min(min, max);
  const actualMax = Math.max(min, max);
  return Math.min(Math.max(value, actualMin), actualMax);
}

export function fileBasename(path: string | null | undefined): string {
  if (!path) return "clip";

  if (path.endsWith("/") || path.endsWith("\\")) return "clip";

  let cleanPath = path;
  if (cleanPath === "/" || cleanPath === "\\") return "clip";

  while (cleanPath.length > 0 && (cleanPath.endsWith("/") || cleanPath.endsWith("\\"))) {
    cleanPath = cleanPath.slice(0, -1);
  }

  if (!cleanPath) return "clip";

  if (cleanPath.startsWith("asset://localhost/")) {
    cleanPath = cleanPath.replace("asset://localhost/", "");
  } else if (cleanPath.startsWith("file:///")) {
    cleanPath = cleanPath.replace("file:///", "");
  } else if (cleanPath.startsWith("file://")) {
    cleanPath = cleanPath.replace("file://", "");
  }

  const lastSlash = Math.max(cleanPath.lastIndexOf("/"), cleanPath.lastIndexOf("\\"));

  if (lastSlash !== -1) {
    return cleanPath.slice(lastSlash + 1);
  }

  return cleanPath;
}

export function isFormElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;

  const formElements = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "FORM"];
  if (formElements.includes(target.tagName)) return true;

  if (target.getAttribute("role") === "button") return true;

  if (target.isContentEditable) return true;

  if (target.closest('[contenteditable="true"]')) return true;

  if (target.closest("form")) return true;

  return false;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${ms}`;
}

export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
