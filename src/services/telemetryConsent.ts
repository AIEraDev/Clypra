export type TelemetryConsentState = "default" | "explicit-on";

export const TELEMETRY_UPLOAD_KEY = "clypra.telemetryUploadEnabled";
export const TELEMETRY_ONBOARDING_KEY = "clypra.telemetryOnboardingShown";

export interface TelemetryUploadResolution {
  enabled: boolean;
  consentState?: TelemetryConsentState;
}

export interface TelemetryUploadResolverInput {
  isDev: boolean;
  envKill: boolean;
  /** `null` means absent; `undefined` means storage could not be read. */
  stored: string | null | undefined;
  noticeShown: boolean;
}

export interface TelemetryUploadStorage {
  getItem(key: string): string | null;
}

const disabled: TelemetryUploadResolution = { enabled: false };

/**
 * Resolves the upload policy without touching browser or Tauri APIs.
 * Unknown or unreadable storage values fail closed so a previous opt-out is
 * never accidentally overridden by the default-on migration.
 */
export function resolveTelemetryUpload({
  isDev,
  envKill,
  stored,
  noticeShown,
}: TelemetryUploadResolverInput): TelemetryUploadResolution {
  if (isDev || envKill || stored === undefined || stored === "false") {
    return disabled;
  }

  if (stored === "true") {
    return { enabled: true, consentState: "explicit-on" };
  }

  if (stored === null && noticeShown) {
    return { enabled: true, consentState: "default" };
  }

  return disabled;
}

/** Resolves the shared browser upload policy; storage failures fail closed. */
export function resolveTelemetryUploadFromStorage({
  isDev,
  envKill,
  storage = typeof localStorage === "undefined" ? undefined : localStorage,
}: {
  isDev: boolean;
  envKill: boolean;
  storage?: TelemetryUploadStorage;
}): TelemetryUploadResolution {
  try {
    if (!storage) {
      return resolveTelemetryUpload({ isDev, envKill, stored: undefined, noticeShown: false });
    }

    return resolveTelemetryUpload({
      isDev,
      envKill,
      stored: storage.getItem(TELEMETRY_UPLOAD_KEY),
      noticeShown: storage.getItem(TELEMETRY_ONBOARDING_KEY) === "true",
    });
  } catch {
    return resolveTelemetryUpload({ isDev, envKill, stored: undefined, noticeShown: false });
  }
}
