// src/types/chromaKey.ts

export interface ChromaKeyConfig {
  enabled: boolean;
  keyColor: [number, number, number]; // [r, g, b] in range [0, 1]
  tolerance: number;                  // 0.0 to 1.0 (default: 0.25)
  smoothness: number;                 // 0.0 to 1.0 (default: 0.15)
  despillAmount: number;              // 0.0 to 1.0 (default: 0.85)
  despillBalance: number;             // 0.0 to 1.0 (default: 0.5)
  mattePedestal: number;              // 0.0 to 0.5 (default: 0.05)
  matteHighlight: number;             // 0.5 to 1.0 (default: 0.95)
}

export const defaultChromaKeyConfig: ChromaKeyConfig = {
  enabled: false,
  keyColor: [0.0, 1.0, 0.0],
  tolerance: 0.25,
  smoothness: 0.15,
  despillAmount: 0.85,
  despillBalance: 0.5,
  mattePedestal: 0.05,
  matteHighlight: 0.95,
};
