import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CrashReportingService,
  scrubPII,
  type CrashEnvelope,
} from "../CrashReportingService";
import { lifecycleMonitor } from "@/core/monitoring/LifecycleMonitor";

describe("CrashReportingService & Telemetry Pipeline", () => {
  let service: CrashReportingService;

  beforeEach(() => {
    service = new CrashReportingService();
    vi.restoreAllMocks();
  });

  describe("PII and Secret Redaction (scrubPII)", () => {
    it("redacts Windows user directory paths", () => {
      const input = "Error in C:\\Users\\JohnDoe\\AppData\\Local\\Clypra\\logs\\app.log";
      const scrubbed = scrubPII(input);
      expect(scrubbed).not.toContain("JohnDoe");
      expect(scrubbed).toContain("C:\\Users\\[REDACTED]\\AppData\\Local\\Clypra\\logs\\app.log");
    });

    it("redacts macOS user directory paths", () => {
      const input = "Failed to load /Users/alice/Movies/Project1/raw.mp4";
      const scrubbed = scrubPII(input);
      expect(scrubbed).not.toContain("alice");
      expect(scrubbed).toContain("/Users/[REDACTED]/Movies/Project1/raw.mp4");
    });

    it("redacts Linux user directory paths", () => {
      const input = "File not found: /home/bob/.config/clypra/state.json";
      const scrubbed = scrubPII(input);
      expect(scrubbed).not.toContain("bob");
      expect(scrubbed).toContain("/home/[REDACTED]/.config/clypra/state.json");
    });

    it("redacts API keys and authorization tokens", () => {
      const input = "Failed with api_key=secret_123456789 and Bearer abcdef123456";
      const scrubbed = scrubPII(input);
      expect(scrubbed).not.toContain("secret_123456789");
      expect(scrubbed).not.toContain("abcdef123456");
      expect(scrubbed).toContain("[REDACTED_SECRET]");
    });
  });

  describe("Crash Envelope Creation", () => {
    it("creates a standardized envelope with system specs, breadcrumbs, and sanitized error", () => {
      lifecycleMonitor.record("APP_STARTUP");
      lifecycleMonitor.record("PROJECT_LOAD_START", { projectId: "proj-1" });

      const rawError = new Error("Direct3D 12 Device Lost at C:\\Users\\Developer\\src\\render.ts:50");
      const envelope = service.createEnvelope({
        crashType: "WEBGL_LOST",
        error: rawError,
        subsystem: "Preview Engine",
        activeProjectId: "proj-1",
      });

      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.id).toMatch(/^crash-/);
      expect(envelope.crashType).toBe("WEBGL_LOST");
      expect(envelope.subsystem).toBe("Preview Engine");
      expect(envelope.error.name).toBe("Error");
      expect(envelope.error.message).not.toContain("Developer");
      expect(envelope.error.message).toContain("C:\\Users\\[REDACTED]");
      expect(envelope.system).toBeDefined();
      expect(envelope.system.os).toBeDefined();
      expect(envelope.breadcrumbs.length).toBeGreaterThanOrEqual(2);
      expect(envelope.app.activeProjectId).toBe("proj-1");
    });
  });

  describe("Telemetry Transmission & Deduplication", () => {
    it("sends envelope via fetch to configured endpoint", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      globalThis.fetch = fetchMock;

      const envelope = await service.reportCrash({
        crashType: "JS_UNCAUGHT",
        error: "Uncaught ReferenceError: window is not defined",
      });

      expect(envelope).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain("/telemetry/crashes");
      expect(options.method).toBe("POST");
      const body: CrashEnvelope = JSON.parse(options.body);
      expect(body.crashType).toBe("JS_UNCAUGHT");
    });

    it("deduplicates identical errors occurring within deduplication window", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      globalThis.fetch = fetchMock;

      await service.reportCrash({
        crashType: "JS_UNCAUGHT",
        error: "Repeated error message",
      });

      // Second immediate call with same error should be deduplicated
      await service.reportCrash({
        crashType: "JS_UNCAUGHT",
        error: "Repeated error message",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("respects telemetry toggle when disabled", async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      service.setTelemetryEnabled(false);
      const result = await service.reportCrash({
        crashType: "SUBSYSTEM_ERROR",
        error: "Should not report",
      });

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
