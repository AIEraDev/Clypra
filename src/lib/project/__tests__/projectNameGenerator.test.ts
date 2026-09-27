import { describe, expect, it } from "vitest";
import {
  generateRandomProjectName,
  PROJECT_ADJECTIVES,
  PROJECT_NOUNS,
} from "../projectNameGenerator";

describe("generateRandomProjectName", () => {
  it("generates a non-empty name with two words", () => {
    const name = generateRandomProjectName();
    expect(name).toBeTruthy();
    const parts = name.split(" ");
    expect(parts.length).toBe(2);
    expect(PROJECT_ADJECTIVES).toContain(parts[0] as any);
    expect(PROJECT_NOUNS).toContain(parts[1] as any);
  });

  it("avoids names present in existingNames", () => {
    const existing = ["Velvet Horizon", "Crimson Drift", "Amber Echo"];
    for (let i = 0; i < 20; i++) {
      const name = generateRandomProjectName(existing);
      expect(existing).not.toContain(name);
    }
  });

  it("handles case-insensitive collisions cleanly", () => {
    const existing = ["velvet horizon", "crimson drift"];
    for (let i = 0; i < 10; i++) {
      const name = generateRandomProjectName({ existingNames: existing });
      expect(existing.map((n) => n.toLowerCase())).not.toContain(
        name.toLowerCase(),
      );
    }
  });

  it("generates suffixed name when candidates are exhausted", () => {
    // If all single pairs are blocked, it should append a numeric suffix
    const allCombinations: string[] = [];
    for (const adj of PROJECT_ADJECTIVES) {
      for (const noun of PROJECT_NOUNS) {
        allCombinations.push(`${adj} ${noun}`);
      }
    }
    const name = generateRandomProjectName({
      existingNames: allCombinations,
      maxAttempts: 5,
    });
    expect(name).toMatch(/^[A-Za-z]+ [A-Za-z]+ \d{2}$/);
  });
});
