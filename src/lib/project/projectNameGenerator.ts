/**
 * Random Project Name Generator
 *
 * Provides creative, aesthetic, and unique names for newly created projects
 * instead of generic placeholders like "Untitled Project".
 */

export const PROJECT_ADJECTIVES = [
  "Amber",
  "Arcadian",
  "Arctic",
  "Astral",
  "Auburn",
  "Aurora",
  "Autumn",
  "Azure",
  "Breeze",
  "Cascade",
  "Celestial",
  "Cinder",
  "Cobalt",
  "Cosmic",
  "Crimson",
  "Crystal",
  "Dawn",
  "Dynamic",
  "Echoing",
  "Electric",
  "Emerald",
  "Ethereal",
  "Fabled",
  "Frost",
  "Gilded",
  "Golden",
  "Halcyon",
  "Harmonic",
  "Indigo",
  "Infinite",
  "Ivory",
  "Kinetic",
  "Lagoon",
  "Lucid",
  "Luminous",
  "Lunar",
  "Midnight",
  "Mirage",
  "Mystic",
  "Nebula",
  "Neon",
  "Noble",
  "Nordic",
  "Nova",
  "Obsidian",
  "Opal",
  "Pastel",
  "Polaris",
  "Prism",
  "Prismatic",
  "Radiant",
  "Rustic",
  "Saffron",
  "Scarlet",
  "Serene",
  "Shadow",
  "Shimmering",
  "Silent",
  "Silver",
  "Solar",
  "Solitary",
  "Spectral",
  "Starlit",
  "Stellar",
  "Summer",
  "Sundance",
  "Sunlit",
  "Tidal",
  "Timeless",
  "Twilight",
  "Velvet",
  "Vibrant",
  "Vivid",
  "Whispering",
  "Wild",
  "Zenith",
  "Zephyr",
] as const;

export const PROJECT_NOUNS = [
  "Aura",
  "Basin",
  "Beacon",
  "Breeze",
  "Canvas",
  "Canyon",
  "Cascade",
  "Chronicle",
  "Cinema",
  "Coast",
  "Crest",
  "Current",
  "Dawn",
  "Dream",
  "Drift",
  "Dune",
  "Echo",
  "Eclipse",
  "Ember",
  "Enclave",
  "Estuary",
  "Fable",
  "Flare",
  "Flux",
  "Forest",
  "Frontier",
  "Genesis",
  "Glacier",
  "Glow",
  "Harbor",
  "Haven",
  "Horizon",
  "Impulse",
  "Island",
  "Journey",
  "Lagoon",
  "Meadow",
  "Mirage",
  "Monolith",
  "Mosaic",
  "Nomad",
  "Notion",
  "Oasis",
  "Odyssey",
  "Orbit",
  "Outlook",
  "Palace",
  "Passage",
  "Peak",
  "Pinnacle",
  "Prism",
  "Pulse",
  "Radiance",
  "Realm",
  "Resonance",
  "Rhythm",
  "Ripple",
  "Sanctuary",
  "Sequence",
  "Shadow",
  "Shore",
  "Silhouette",
  "Solstice",
  "Spectrum",
  "Summit",
  "Symphony",
  "Tide",
  "Timber",
  "Trail",
  "Tribute",
  "Valley",
  "Venture",
  "Vessel",
  "Vision",
  "Vista",
  "Voyage",
  "Wanderer",
  "Wave",
  "Whisper",
  "Zenith",
] as const;

export interface GenerateProjectNameOptions {
  existingNames?: readonly (string | null | undefined)[];
  maxAttempts?: number;
}

/**
 * Generates an aesthetic, randomly chosen project name in "Adjective Noun" format.
 *
 * @param optionsOrExistingNames - Array of existing project names to prevent collisions, or options object.
 * @returns A unique, formatted project name (e.g. "Velvet Horizon", "Crimson Drift")
 */
export function generateRandomProjectName(
  optionsOrExistingNames?:
    | readonly (string | null | undefined)[]
    | GenerateProjectNameOptions,
): string {
  const isOptionsObject =
    Boolean(optionsOrExistingNames) &&
    !Array.isArray(optionsOrExistingNames) &&
    typeof optionsOrExistingNames === "object" &&
    !("length" in (optionsOrExistingNames as object));

  const options: GenerateProjectNameOptions = isOptionsObject
    ? (optionsOrExistingNames as GenerateProjectNameOptions)
    : {
        existingNames: Array.isArray(optionsOrExistingNames)
          ? (optionsOrExistingNames as readonly (string | null | undefined)[])
          : undefined,
      };

  const existingSet = new Set(
    (options.existingNames ?? [])
      .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
      .map((name) => name.trim().toLowerCase()),
  );
  const maxAttempts = options.maxAttempts ?? 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const adj =
      PROJECT_ADJECTIVES[Math.floor(Math.random() * PROJECT_ADJECTIVES.length)];
    const noun =
      PROJECT_NOUNS[Math.floor(Math.random() * PROJECT_NOUNS.length)];
    const candidate = `${adj} ${noun}`;
    if (!existingSet.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // Fallback if collisions exhaust max attempts: append a two-digit index
  const baseAdj =
    PROJECT_ADJECTIVES[Math.floor(Math.random() * PROJECT_ADJECTIVES.length)];
  const baseNoun =
    PROJECT_NOUNS[Math.floor(Math.random() * PROJECT_NOUNS.length)];
  let suffix = 2;
  while (
    existingSet.has(
      `${baseAdj} ${baseNoun} ${String(suffix).padStart(2, "0")}`.toLowerCase(),
    )
  ) {
    suffix++;
  }
  return `${baseAdj} ${baseNoun} ${String(suffix).padStart(2, "0")}`;
}
