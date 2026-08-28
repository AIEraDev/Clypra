import { describe, it, expect } from "vitest";
import {
  isValidFilterUrl,
  isDangerousKey,
  sanitizeGradingParams,
  sanitizeEffectStack,
  hasPrototypePollution,
  sanitizeRemoteFilterPayload,
  clampNumeric,
} from "../security/filterValidation";
import type { FilterAsset } from "../types";

describe("Filter Security & Validation", () => {
  // ─── 1. URL SANITIZATION & VALIDATION ────────────────────────────────────
  describe("isValidFilterUrl", () => {
    it("allows valid HTTPS URLs", () => {
      expect(isValidFilterUrl("https://api.clypra.com/filters/cinematic/teal_orange.json")).toBe(true);
      expect(isValidFilterUrl("https://cdn.example.org/presets/filter.json")).toBe(true);
    });

    it("allows localhost HTTP URLs for local development", () => {
      expect(isValidFilterUrl("http://localhost:3000/filters/test.json")).toBe(true);
      expect(isValidFilterUrl("http://127.0.0.1:8080/filters/test.json")).toBe(true);
    });

    it("rejects non-localhost HTTP URLs", () => {
      expect(isValidFilterUrl("http://remote-server.com/filters/test.json")).toBe(false);
    });

    it("rejects dangerous URI schemes (javascript, file, data, blob)", () => {
      expect(isValidFilterUrl("javascript:alert(1)")).toBe(false);
      expect(isValidFilterUrl("file:///etc/passwd")).toBe(false);
      expect(isValidFilterUrl("data:text/json;base64,eyJpZCI6InRlc3QifQ==")).toBe(false);
      expect(isValidFilterUrl("blob:https://clypra.com/uuid-1234")).toBe(false);
      expect(isValidFilterUrl("about:blank")).toBe(false);
    });

    it("rejects URLs containing embedded credentials", () => {
      expect(isValidFilterUrl("https://user:password@clypra.com/filter.json")).toBe(false);
    });

    it("rejects empty, malformed, or excessively long strings", () => {
      expect(isValidFilterUrl("")).toBe(false);
      expect(isValidFilterUrl("   ")).toBe(false);
      expect(isValidFilterUrl("not-a-url")).toBe(false);
      expect(isValidFilterUrl("https://clypra.com/" + "a".repeat(3000))).toBe(false);
    });
  });

  // ─── 2. PROTOTYPE POLLUTION DETECTION ────────────────────────────────────
  describe("Prototype Pollution Defense", () => {
    it("identifies dangerous prototype keys", () => {
      expect(isDangerousKey("__proto__")).toBe(true);
      expect(isDangerousKey("constructor")).toBe(true);
      expect(isDangerousKey("prototype")).toBe(true);
      expect(isDangerousKey("contrast")).toBe(false);
      expect(isDangerousKey("gradingParams")).toBe(false);
    });

    it("detects nested prototype pollution attempts in raw JSON", () => {
      const malicious = JSON.parse('{"name": "test", "__proto__": {"polluted": true}}');
      expect(hasPrototypePollution(malicious)).toBe(true);

      const nestedMalicious = JSON.parse('{"name": "test", "gradingParams": {"__proto__": {"admin": true}}}');
      expect(hasPrototypePollution(nestedMalicious)).toBe(true);

      const safe = { name: "test", gradingParams: { contrast: 1.2 } };
      expect(hasPrototypePollution(safe)).toBe(false);
    });
  });

  // ─── 3. GRADING PARAMS SANITIZATION ──────────────────────────────────────
  describe("sanitizeGradingParams", () => {
    it("preserves valid finite numeric uniform parameters", () => {
      const input = {
        contrast: 1.2,
        brightness: -0.1,
        saturation: 1.5,
        sepia: 0.8,
        temperature: 0.3,
        tint: -0.2,
      };

      const sanitized = sanitizeGradingParams(input);
      expect(sanitized).toEqual(input);
    });

    it("strips NaN, Infinity, -Infinity and invalid types", () => {
      const input = {
        contrast: NaN,
        brightness: Infinity,
        saturation: -Infinity,
        sepia: "invalid-string-should-be-string-or-stripped",
        validParam: 1.0,
      };

      const sanitized = sanitizeGradingParams(input) as Record<string, unknown> | undefined;
      expect(sanitized).toBeDefined();
      expect(sanitized?.validParam).toBe(1.0);
      expect(sanitized?.contrast).toBeUndefined();
      expect(sanitized?.brightness).toBeUndefined();
      expect(sanitized?.saturation).toBeUndefined();
    });

    it("clamps extreme uniform values to safe shader bounds [-1000, 1000]", () => {
      const input = {
        hugeContrast: 999999,
        hugeNegative: -999999,
        normalParam: 0.5,
      };

      const sanitized = sanitizeGradingParams(input) as Record<string, unknown> | undefined;
      expect(sanitized?.hugeContrast).toBe(1000);
      expect(sanitized?.hugeNegative).toBe(-1000);
      expect(sanitized?.normalParam).toBe(0.5);
    });

    it("strips prototype pollution keys from gradingParams", () => {
      const input = JSON.parse('{"contrast": 1.2, "__proto__": {"admin": true}}');
      const sanitized = sanitizeGradingParams(input);
      expect(sanitized?.contrast).toBe(1.2);
      expect((Object.prototype as any).admin).toBeUndefined();
    });

    it("sanitizes structured sub-dictionaries (e.g. vibrance, grain)", () => {
      const input = {
        vibrance: { amount: 0.5, speed: NaN, hugeVal: 5000 },
        exposure: 0.2,
      };

      const sanitized = sanitizeGradingParams(input);
      expect(sanitized?.exposure).toBe(0.2);
      expect((sanitized?.vibrance as any)?.amount).toBe(0.5);
      expect((sanitized?.vibrance as any)?.speed).toBeUndefined();
      expect((sanitized?.vibrance as any)?.hugeVal).toBe(1000);
    });
  });

  // ─── 4. EFFECT STACK SANITIZATION ────────────────────────────────────────
  describe("sanitizeEffectStack", () => {
    it("preserves valid MPG effect stack nodes", () => {
      const input = [
        { type: "color_adjustments", params: { contrast: 1.2, brightness: 0.1 } },
        { type: "blur", params: { blurAmount: 5.0 } },
      ];

      const sanitized = sanitizeEffectStack(input);
      expect(sanitized).toHaveLength(2);
      expect(sanitized?.[0].type).toBe("color_adjustments");
      expect(sanitized?.[0].params?.contrast).toBe(1.2);
    });

    it("caps effect stack length at 32 nodes to prevent DoS", () => {
      const input = Array.from({ length: 100 }, (_, i) => ({
        type: `effect_${i}`,
        params: { val: 1.0 },
      }));

      const sanitized = sanitizeEffectStack(input);
      expect(sanitized).toHaveLength(32);
    });

    it("discards nodes with invalid or dangerous type names", () => {
      const input = [
        { type: "valid_effect", params: { val: 1.0 } },
        { type: "invalid<script>alert(1)</script>", params: { val: 1.0 } },
        { type: "", params: { val: 1.0 } },
      ];

      const sanitized = sanitizeEffectStack(input);
      expect(sanitized).toHaveLength(1);
      expect(sanitized?.[0].type).toBe("valid_effect");
    });
  });

  // ─── 5. REMOTE FILTER PAYLOAD SANITIZATION ───────────────────────────────
  describe("sanitizeRemoteFilterPayload", () => {
    const baseFilter: FilterAsset = {
      id: "f-teal",
      name: "Teal & Orange",
      type: "filter",
      category: "cinematic",
      description: "Default description",
      thumbnail: "https://clypra.com/thumb.jpg",
    };

    it("validates and constructs a safe FilterAsset from remote JSON", () => {
      const remoteJson = {
        name: "Remote Teal",
        gradingParams: { contrast: 1.3, saturation: 1.1 },
        intensity: { min: 0, max: 1, default: 0.7, step: 0.05 },
        tags: ["cinematic", "film"],
      };

      const result = sanitizeRemoteFilterPayload(remoteJson, baseFilter);
      expect(result.id).toBe("f-teal");
      expect(result.name).toBe("Remote Teal");
      expect(result.gradingParams?.contrast).toBe(1.3);
      expect(result.intensity?.default).toBe(0.7);
      expect(result.tags).toEqual(["cinematic", "film"]);
    });

    it("throws error on prototype pollution attempt", () => {
      const malicious = JSON.parse('{"name": "hack", "__proto__": {"polluted": true}}');
      expect(() => sanitizeRemoteFilterPayload(malicious, baseFilter)).toThrow(
        /prototype pollution attempt detected/
      );
    });

    it("clamps invalid intensity parameters", () => {
      const remoteJson = {
        intensity: { min: -10, max: 100, default: 50, step: -1 },
      };

      const result = sanitizeRemoteFilterPayload(remoteJson, baseFilter);
      expect(result.intensity?.min).toBe(0);
      expect(result.intensity?.max).toBe(2);
      expect(result.intensity?.default).toBe(2); // clamped to max
      expect(result.intensity?.step).toBe(0.001); // clamped to min (0.001)
    });

    it("throws when payload is not an object", () => {
      expect(() => sanitizeRemoteFilterPayload(null, baseFilter)).toThrow(/expected a JSON object/);
      expect(() => sanitizeRemoteFilterPayload("string", baseFilter)).toThrow(/expected a JSON object/);
      expect(() => sanitizeRemoteFilterPayload([1, 2, 3], baseFilter)).toThrow(/expected a JSON object/);
    });
  });

  // ─── 6. CLAMP NUMERIC HELPER ─────────────────────────────────────────────
  describe("clampNumeric", () => {
    it("returns clamped value within min and max", () => {
      expect(clampNumeric(5, 0, 10, 1)).toBe(5);
      expect(clampNumeric(-5, 0, 10, 1)).toBe(0);
      expect(clampNumeric(15, 0, 10, 1)).toBe(10);
    });

    it("returns fallback for NaN, Infinity, or non-numbers", () => {
      expect(clampNumeric(NaN, 0, 10, 3)).toBe(3);
      expect(clampNumeric(Infinity, 0, 10, 3)).toBe(3);
      expect(clampNumeric("invalid", 0, 10, 3)).toBe(3);
      expect(clampNumeric(undefined, 0, 10, 3)).toBe(3);
    });
  });
});
