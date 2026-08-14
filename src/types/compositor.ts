// src/types/compositor.ts
import { ChromaKeyConfig, defaultChromaKeyConfig } from './chromaKey';

export * from './chromaKey';

export interface ColorGradeUniforms {
  exposure: number;       // EV stops [-3.0, 3.0], default 0.0
  contrast: number;       // [0.0, 2.0], default 1.0
  saturation: number;     // [0.0, 2.0], default 1.0
  temperature: number;    // [-1.0, 1.0], default 0.0
  tint: number;           // [-1.0, 1.0], default 0.0
  lutIntensity: number;   // [0.0, 1.0], default 1.0
  lutSize: number;        // default 33.0
  hasLut: number;         // 0: Disabled, 1: Enabled
  lutId?: string;
}

export const defaultColorGradeUniforms: ColorGradeUniforms = {
  exposure: 0.0,
  contrast: 1.0,
  saturation: 1.0,
  temperature: 0.0,
  tint: 0.0,
  lutIntensity: 1.0,
  lutSize: 33.0,
  hasLut: 0,
};
