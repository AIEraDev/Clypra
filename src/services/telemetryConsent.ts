export type TelemetryConsentState = "default" | "explicit-on";

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
