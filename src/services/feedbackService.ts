/**
 * User Feedback Service
 * Submits bug reports, feature requests, performance issues, and general feedback
 * to the Clypra API (`POST /api/v1/feedback`).
 */

import { getApiBaseUrl, getApiHeaders } from "@/lib/api/apiUtils";
import { getAppVersion } from "@/lib/app/appVersion";
import { platform } from "@/core/platform";
import { perfLogService } from "@/services/perfLogService";

export type FeedbackType = "bug" | "feature" | "performance" | "general";

export interface SubmitFeedbackInput {
  type: FeedbackType;
  description: string;
  stepsToReproduce?: string;
  contactEmail?: string;
  includeDiagnostics?: boolean;
  locale?: string;
}

export interface SubmitFeedbackResult {
  ok: true;
  id: string;
  createdAt: string;
}

function detectOsFamily(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  return "unknown";
}

function detectPlatformName(): string {
  if (platform.isTauri()) return "tauri-desktop";
  if (platform.isCapacitor()) return "capacitor";
  return "web";
}

export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<SubmitFeedbackResult> {
  const description = input.description.trim();
  if (description.length < 5) {
    throw new Error("Please enter at least 5 characters in the description.");
  }

  const appVersion = await getAppVersion().catch(() => "unknown");
  const includeDiagnostics = input.includeDiagnostics ?? true;
  const sessionId = includeDiagnostics ? perfLogService.getSessionId() : null;

  const baseUrl = getApiBaseUrl().replace(/\/+$/, "");
  const endpoint = `${baseUrl}/api/v1/feedback`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: getApiHeaders(),
    body: JSON.stringify({
      type: input.type,
      description,
      stepsToReproduce: input.stepsToReproduce?.trim() || undefined,
      contactEmail: input.contactEmail?.trim() || undefined,
      includeDiagnostics,
      appVersion,
      osFamily: detectOsFamily(),
      platform: detectPlatformName(),
      locale: input.locale,
      sessionId: sessionId || undefined,
    }),
  });

  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const serverMessage =
      payload && typeof payload.error === "string" ? payload.error : null;
    if (response.status === 429) {
      throw new Error(
        serverMessage || "Too many feedback submissions. Please try again later.",
      );
    }
    throw new Error(
      serverMessage || `Feedback submission failed (HTTP ${response.status}).`,
    );
  }

  return {
    ok: true,
    id: typeof payload?.id === "string" ? payload.id : "",
    createdAt:
      typeof payload?.createdAt === "string"
        ? payload.createdAt
        : new Date().toISOString(),
  };
}
