import { describe, expect, it } from "vitest";
import { resolveTelemetryUpload } from "../telemetryConsent";

describe("resolveTelemetryUpload", () => {
  it.each([
    ["development build", { isDev: true, envKill: false, stored: null, noticeShown: true }],
    ["environment kill switch", { isDev: false, envKill: true, stored: null, noticeShown: true }],
    ["explicit opt-out", { isDev: false, envKill: false, stored: "false", noticeShown: true }],
    ["unreadable storage", { isDev: false, envKill: false, stored: undefined, noticeShown: true }],
    ["unknown stored value", { isDev: false, envKill: false, stored: "unexpected", noticeShown: true }],
    ["absent storage before notice", { isDev: false, envKill: false, stored: null, noticeShown: false }],
  ] as const)("blocks upload for %s", (_label, input) => {
    expect(resolveTelemetryUpload(input)).toEqual({ enabled: false });
  });

  it("enables explicit opt-in independently of the default notice", () => {
    expect(
      resolveTelemetryUpload({
        isDev: false,
        envKill: false,
        stored: "true",
        noticeShown: false,
      }),
    ).toEqual({ enabled: true, consentState: "explicit-on" });
  });

  it("enables an absent value only after the notice was shown", () => {
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
