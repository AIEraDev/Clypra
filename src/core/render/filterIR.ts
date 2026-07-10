export interface FilterIR {
  sepia?: number; // 0.0 to 1.0
  saturate?: number; // multiplier, e.g. 1.0 is neutral
  contrast?: number; // multiplier, e.g. 1.0 is neutral
  grayscale?: number; // 0.0 to 1.0
  hueRotate?: number; // angle in degrees, e.g. 0 is neutral
}

export function normalizeFilterIntensity(intensity: number | undefined): number {
  if (typeof intensity !== "number" || !Number.isFinite(intensity)) {
    return 0.8;
  }
  return Math.min(1, Math.max(0, intensity));
}

/**
 * Parses a standard CSS filter string into a FilterIR object.
 */
export function parseCSSFilterToIR(cssFilter: string): FilterIR {
  const ir: FilterIR = {};
  if (!cssFilter) return ir;

  const parsePercentOrFloat = (valStr: string): number => {
    valStr = valStr.trim();
    if (valStr.endsWith("%")) {
      return parseFloat(valStr) / 100;
    }
    return parseFloat(valStr);
  };

  const parseAngle = (valStr: string): number => {
    valStr = valStr.trim();
    if (valStr.endsWith("deg")) {
      return parseFloat(valStr);
    }
    if (valStr.endsWith("rad")) {
      return (parseFloat(valStr) * 180) / Math.PI;
    }
    if (valStr.endsWith("turn")) {
      return parseFloat(valStr) * 360;
    }
    return parseFloat(valStr);
  };

  const sepiaMatch = cssFilter.match(/sepia\(([^)]+)\)/);
  if (sepiaMatch) {
    ir.sepia = parsePercentOrFloat(sepiaMatch[1]);
  }

  const grayscaleMatch = cssFilter.match(/grayscale\(([^)]+)\)/);
  if (grayscaleMatch) {
    ir.grayscale = parsePercentOrFloat(grayscaleMatch[1]);
  }

  const saturateMatch = cssFilter.match(/saturate\(([^)]+)\)/);
  if (saturateMatch) {
    ir.saturate = parsePercentOrFloat(saturateMatch[1]);
  }

  const contrastMatch = cssFilter.match(/contrast\(([^)]+)\)/);
  if (contrastMatch) {
    ir.contrast = parsePercentOrFloat(contrastMatch[1]);
  }

  const hueRotateMatch = cssFilter.match(/hue-rotate\(([^)]+)\)/);
  if (hueRotateMatch) {
    ir.hueRotate = parseAngle(hueRotateMatch[1]);
  }

  return ir;
}

/**
 * Maps standard preset filter IDs to a FilterIR object.
 * Legacy swatch CSS parameter is deprecated - filters now use GPU rendering exclusively.
 */
export function resolveFilterToIR(filterId: string, intensity: number, swatch?: string): FilterIR {
  const amount = normalizeFilterIntensity(intensity);

  // If a custom swatch is provided, parse it and scale it by intensity
  if (swatch) {
    const baseIR = parseCSSFilterToIR(swatch);
    const scaledIR: FilterIR = {};
    if (baseIR.sepia !== undefined) {
      scaledIR.sepia = amount * baseIR.sepia;
    }
    if (baseIR.grayscale !== undefined) {
      scaledIR.grayscale = amount * baseIR.grayscale;
    }
    if (baseIR.saturate !== undefined) {
      // 1.0 is neutral
      scaledIR.saturate = 1.0 + amount * (baseIR.saturate - 1.0);
    }
    if (baseIR.contrast !== undefined) {
      // 1.0 is neutral
      scaledIR.contrast = 1.0 + amount * (baseIR.contrast - 1.0);
    }
    if (baseIR.hueRotate !== undefined) {
      scaledIR.hueRotate = amount * baseIR.hueRotate;
    }
    return scaledIR;
  }

  return (() => {
    switch (filterId) {
      case "filter-sepia":
        return { sepia: amount };
      case "filter-retro":
        return {
          sepia: amount * 0.5,
          saturate: 1 + amount * 0.4,
          contrast: 1 - amount * 0.15,
        };
      case "filter-aged":
        return {
          sepia: amount * 0.7,
          saturate: 1 - amount * 0.35,
          contrast: 1 - amount * 0.12,
          hueRotate: amount * 8,
        };
      case "filter-crisp":
        return {
          saturate: 1 + amount * 0.25,
          contrast: 1 + amount * 0.35,
        };
      case "filter-vivid":
        return {
          saturate: 1 + amount * 1.2,
          contrast: 1 + amount * 0.25,
        };
      case "filter-cool":
        return {
          hueRotate: -amount * 25,
          saturate: 1 - amount * 0.1,
        };
      case "filter-cinematic-teal":
        return {
          contrast: 1 + amount * 0.15,
          saturate: 1 - amount * 0.1,
          hueRotate: amount * 5,
        };
      case "filter-bleach":
        return {
          saturate: 1 - amount * 0.55,
          contrast: 1 + amount * 0.45,
        };
      case "filter-moody":
        return {
          saturate: 1 - amount * 0.25,
          contrast: 1 + amount * 0.3,
          hueRotate: -amount * 8,
        };
      case "filter-bw-classic":
        return { grayscale: amount };
      case "filter-high-contrast":
        return {
          grayscale: amount,
          contrast: 1 + amount * 0.55,
        };
      case "filter-soft-bw":
        return {
          grayscale: amount,
          contrast: 1 - amount * 0.12,
        };
      case "filter-warm":
        return {
          sepia: amount * 0.22,
          saturate: 1 + amount * 0.18,
          hueRotate: amount * 10,
        };
      case "filter-cool-blue":
        return {
          hueRotate: -amount * 18,
          saturate: 1 + amount * 0.08,
          contrast: 1 + amount * 0.08,
        };
      case "filter-purple-haze":
        return {
          hueRotate: amount * 28,
          saturate: 1 + amount * 0.25,
          contrast: 1 - amount * 0.08,
        };
      default:
        return {};
    }
  })();
}

/**
 * Compiles a FilterIR object into a CSS filter string for Canvas2D rendering.
 */
export function compileFilterIRToCSS(ir: FilterIR): string {
  const parts: string[] = [];
  if (ir.sepia !== undefined && ir.sepia > 0) {
    parts.push(`sepia(${ir.sepia * 100}%)`);
  }
  if (ir.saturate !== undefined && ir.saturate !== 1) {
    parts.push(`saturate(${ir.saturate})`);
  }
  if (ir.contrast !== undefined && ir.contrast !== 1) {
    parts.push(`contrast(${ir.contrast})`);
  }
  if (ir.grayscale !== undefined && ir.grayscale > 0) {
    parts.push(`grayscale(${ir.grayscale * 100}%)`);
  }
  if (ir.hueRotate !== undefined && ir.hueRotate !== 0) {
    parts.push(`hue-rotate(${ir.hueRotate}deg)`);
  }
  return parts.join(" ");
}

/**
 * Compiles a FilterIR object into a FFmpeg video filter chain segment.
 */
export function compileFilterIRToFFmpeg(ir: FilterIR): string {
  const parts: string[] = [];

  // Sepia color channel mixer matrix:
  // R' = R*0.393 + G*0.769 + B*0.189
  // G' = R*0.349 + G*0.686 + B*0.168
  // B' = R*0.272 + G*0.534 + B*0.131
  if (ir.sepia !== undefined && ir.sepia > 0) {
    const s = ir.sepia;
    const rr = 1 - s + s * 0.393;
    const rg = s * 0.769;
    const rb = s * 0.189;
    const gr = s * 0.349;
    const gg = 1 - s + s * 0.686;
    const gb = s * 0.168;
    const br = s * 0.272;
    const bg = s * 0.534;
    const bb = 1 - s + s * 0.131;
    parts.push(`colorchannelmixer=rr=${rr.toFixed(4)}:rg=${rg.toFixed(4)}:rb=${rb.toFixed(4)}:gr=${gr.toFixed(4)}:gg=${gg.toFixed(4)}:gb=${gb.toFixed(4)}:br=${br.toFixed(4)}:bg=${bg.toFixed(4)}:bb=${bb.toFixed(4)}`);
  }

  // Grayscale color channel mixer matrix (Luma formula coefficients):
  if (ir.grayscale !== undefined && ir.grayscale > 0) {
    const g = ir.grayscale;
    const rr = 1 - g + g * 0.299;
    const rg = g * 0.587;
    const rb = g * 0.114;
    const gr = g * 0.299;
    const gg = 1 - g + g * 0.587;
    const gb = g * 0.114;
    const br = g * 0.299;
    const bg = g * 0.587;
    const bb = 1 - g + g * 0.114;
    parts.push(`colorchannelmixer=rr=${rr.toFixed(4)}:rg=${rg.toFixed(4)}:rb=${rb.toFixed(4)}:gr=${gr.toFixed(4)}:gg=${gg.toFixed(4)}:gb=${gb.toFixed(4)}:br=${br.toFixed(4)}:bg=${bg.toFixed(4)}:bb=${bb.toFixed(4)}`);
  }

  if (ir.hueRotate !== undefined && ir.hueRotate !== 0) {
    parts.push(`hue=h=${ir.hueRotate}`);
  }

  if (ir.saturate !== undefined && ir.saturate !== 1) {
    parts.push(`hue=s=${ir.saturate}`);
  }

  if (ir.contrast !== undefined && ir.contrast !== 1) {
    parts.push(`eq=contrast=${ir.contrast}`);
  }

  return parts.join(",");
}
