/**
 * Text Template Debug Logging
 *
 * Focused logging for text template rendering and bounding box issues.
 * Enable via localStorage: localStorage.setItem('debug:text-template', 'true')
 */

const STORAGE_KEY = "debug:text-template";

export function isTextTemplateDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function enableTextTemplateDebug(): void {
  localStorage.setItem(STORAGE_KEY, "true");
  console.log("✅ Text template debug logging enabled");
}

export function disableTextTemplateDebug(): void {
  localStorage.removeItem(STORAGE_KEY);
  console.log("❌ Text template debug logging disabled");
}

/**
 * Log text template operations
 */
export function logTextTemplate(operation: string, data?: any): void {
  if (!isTextTemplateDebugEnabled()) return;

  const dataStr = data ? ` - ${JSON.stringify(data, null, 2)}` : "";
  console.log(`📝 [TextTemplate] ${operation}${dataStr}`);
}

/**
 * Log canvas/bounds information
 */
export function logTemplateBounds(
  label: string,
  data: {
    canvasSize?: { width: number; height: number };
    contentBounds?: { x: number; y: number; width: number; height: number } | null;
    clipSize?: { x: number; y: number; width: number; height: number };
    templateId?: string;
    text?: string;
  },
): void {
  if (!isTextTemplateDebugEnabled()) return;

  console.group(`📐 [TextTemplate] ${label}`);

  if (data.templateId) {
    console.log(`Template ID: ${data.templateId}`);
  }

  if (data.text) {
    console.log(`Text: "${data.text}"`);
  }

  if (data.canvasSize) {
    console.log(`Canvas Size: ${data.canvasSize.width} × ${data.canvasSize.height}`);
  }

  if (data.contentBounds !== undefined) {
    if (data.contentBounds) {
      console.log(`Content Bounds:`, {
        x: data.contentBounds.x,
        y: data.contentBounds.y,
        width: data.contentBounds.width,
        height: data.contentBounds.height,
        aspectRatio: (data.contentBounds.width / data.contentBounds.height).toFixed(3),
      });
    } else {
      console.log(`Content Bounds: null`);
    }
  }

  if (data.clipSize) {
    console.log(`Clip Size:`, {
      x: data.clipSize.x,
      y: data.clipSize.y,
      width: data.clipSize.width,
      height: data.clipSize.height,
      aspectRatio: (data.clipSize.width / data.clipSize.height).toFixed(3),
    });

    // Show size mismatch if both bounds and clip size exist
    if (data.contentBounds && data.contentBounds.width > 0) {
      const widthRatio = data.clipSize.width / data.contentBounds.width;
      const heightRatio = data.clipSize.height / data.contentBounds.height;

      if (Math.abs(widthRatio - 1) > 0.1 || Math.abs(heightRatio - 1) > 0.1) {
        console.warn(`⚠️ Size Mismatch Detected!`);
        console.warn(`  Width ratio: ${widthRatio.toFixed(2)}x (${widthRatio > 1 ? "clip larger" : "content larger"})`);
        console.warn(`  Height ratio: ${heightRatio.toFixed(2)}x (${heightRatio > 1 ? "clip larger" : "content larger"})`);
      }
    }
  }

  console.groupEnd();
}

/**
 * Log template renderer state
 */
export function logRendererState(
  label: string,
  data: {
    layers?: number;
    canvasDimensions?: { width: number; height: number };
    drawTime?: number;
  },
): void {
  if (!isTextTemplateDebugEnabled()) return;

  console.log(`🎨 [TextTemplate Renderer] ${label}`, data);
}

// Console helpers
if (typeof window !== "undefined") {
  (window as any).__textTemplateDebug = {
    enable: enableTextTemplateDebug,
    disable: disableTextTemplateDebug,
    isEnabled: isTextTemplateDebugEnabled,
  };
}
