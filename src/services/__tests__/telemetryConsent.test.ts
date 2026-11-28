import { describe, expect, it } from "vitest";
import { resolveTelemetryUpload } from "../telemetryConsent";

describe("resolveTelemetryUpload", () => {
  it.each([
    ["environment kill switch", { isDev: false, envKill: true, stored: null, noticeShown: true }],
    ["explicit opt-out", { isDev: false, envKill: false, stored: "false", noticeShown: true }],
    ["unreadable storage", { isDev: false, envKill: false, stored: undefined, noticeShown: true }],
    ["unknown stored value", { isDev: false, envKill: false, stored: "unexpected", noticeShown: true }],
    ["absent storage before notice", { isDev: false, envKill: false, stored: null, noticeShown: false }],
  ] as const)("blocks upload for %s", (_label, input) => {
    expect(resolveTelemetryUpload(input)).toEqual({ enabled: false });
  });

  it("allows explicit opt-in during development", () => {
    expect(
      resolveTelemetryUpload({
        isDev: true,
        envKill: false,
        stored: "true",
        noticeShown: true,
      }),
    ).toEqual({ enabled: true, consentState: "explicit-on" });
  });

  it("keeps development uploads disabled without explicit opt-in", () => {
    expect(
      resolveTelemetryUpload({
        isDev: true,
        envKill: false,
        stored: null,
        noticeShown: true,
      }),
    ).toEqual({ enabled: false });
  });

  it("keeps the environment kill switch authoritative", () => {
    expect(
      resolveTelemetryUpload({
        isDev: true,
        envKill: true,
        stored: "true",
        noticeShown: true,
      }),
    ).toEqual({ enabled: false });
  });

  it("enables an absent value only after the notice was shown in production", () => {
    expect(
      resolveTelemetryUpload({
        isDev: false,
        envKill: false,
        stored: null,
        noticeShown: true,
      }),
    ).toEqual({ enabled: true, consentState: "default" });
  });
});
