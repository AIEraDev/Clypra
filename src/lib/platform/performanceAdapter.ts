/**
 * Performance Adapter
 *
 * Applies device-specific performance optimizations on application startup.
 * Monitors device state and adapts settings dynamically.
 *
 * Integration:
 * - Call initializePerformanceAdapter() in App.tsx on mount
 * - Automatically adjusts worker count, cache sizes, preview FPS
 * - Reacts to battery/thermal state changes
 */

import { getPerformanceProfile, monitorDeviceState, type DeviceCapabilities, logDeviceCapabilities } from "./deviceCapabilities";
import { ThumbnailWorkerPool } from "@/workers";

interface PerformanceSettings {
  workerCount: number;
  thumbnailSize: { width: number; height: number };
  decoderPoolSize: number;
  previewFps: number;
  cacheSizeMB: number;
  backgroundProcessing: boolean;
}

let currentSettings: PerformanceSettings | null = null;
let stateMonitorCleanup: (() => void) | null = null;

/**
 * Initialize performance adapter.
 * Call this once on app startup.
 */
export async function initializePerformanceAdapter(): Promise<void> {
  // console.log("[PerformanceAdapter] Initializing...");

  // Log device capabilities for debugging
  await logDeviceCapabilities();

  // Get initial profile and apply settings
  const profile = await getPerformanceProfile();
  await applyPerformanceProfile(profile);

  // Monitor device state changes
  stateMonitorCleanup = await monitorDeviceState(async (caps: DeviceCapabilities) => {
    // console.log("[PerformanceAdapter] Device state changed:", {
    //   onBattery: caps.onBattery,
    //   batteryLevel: caps.batteryLevel !== null ? `${(caps.batteryLevel * 100).toFixed(0)}%` : "unknown",
    //   thermalThrottling: caps.thermalThrottling,
    // });

    // Recompute profile and adapt
    const newProfile = await getPerformanceProfile();
    await adaptPerformanceProfile(newProfile);
  });

  // console.log("[PerformanceAdapter] Initialization complete");
}

/**
 * Shutdown performance adapter.
 * Call this on app unmount.
 */
export function shutdownPerformanceAdapter(): void {
  if (stateMonitorCleanup) {
    stateMonitorCleanup();
    stateMonitorCleanup = null;
  }
  currentSettings = null;
  // console.log("[PerformanceAdapter] Shutdown complete");
}

/**
 * Apply performance profile (initial setup).
 */
async function applyPerformanceProfile(profile: Awaited<ReturnType<typeof getPerformanceProfile>>): Promise<void> {
  const settings: PerformanceSettings = {
    workerCount: profile.workerCount,
    thumbnailSize: {
      width: profile.thumbnailWidth,
      height: profile.thumbnailHeight,
    },
    decoderPoolSize: profile.decoderPoolSize,
    previewFps: profile.previewFps,
    cacheSizeMB: profile.cacheSizeMB,
    backgroundProcessing: profile.enableBackgroundProcessing,
  };

  // Initialize worker pool with optimal count
  ThumbnailWorkerPool.getInstance(settings.workerCount);

  // Store current settings
  currentSettings = settings;

  // console.log("[PerformanceAdapter] Applied profile:", settings);
}

/**
 * Adapt performance profile (runtime adjustment).
 * Only changes settings that differ significantly.
 */
async function adaptPerformanceProfile(profile: Awaited<ReturnType<typeof getPerformanceProfile>>): Promise<void> {
  if (!currentSettings) {
    await applyPerformanceProfile(profile);
    return;
  }

  const newSettings: PerformanceSettings = {
    workerCount: profile.workerCount,
    thumbnailSize: {
      width: profile.thumbnailWidth,
      height: profile.thumbnailHeight,
    },
    decoderPoolSize: profile.decoderPoolSize,
    previewFps: profile.previewFps,
    cacheSizeMB: profile.cacheSizeMB,
    backgroundProcessing: profile.enableBackgroundProcessing,
  };

  // Check if worker count changed
  if (newSettings.workerCount !== currentSettings.workerCount) {
    // console.log(`[PerformanceAdapter] Adapting worker count: ${currentSettings.workerCount} → ${newSettings.workerCount}`);
    ThumbnailWorkerPool.reset(newSettings.workerCount);
  }

  // Check if thumbnail size changed significantly
  const thumbnailSizeChanged = newSettings.thumbnailSize.width !== currentSettings.thumbnailSize.width || newSettings.thumbnailSize.height !== currentSettings.thumbnailSize.height;

  if (thumbnailSizeChanged) {
    // console.log(`[PerformanceAdapter] Thumbnail size adapted: ${currentSettings.thumbnailSize.width}×${currentSettings.thumbnailSize.height} → ${newSettings.thumbnailSize.width}×${newSettings.thumbnailSize.height}`);
    // Thumbnail size is applied by reading from getCurrentPerformanceSettings()
    // No immediate action needed - next thumbnail requests will use new size
  }

  // Check if background processing changed
  if (newSettings.backgroundProcessing !== currentSettings.backgroundProcessing) {
    // console.log(`[PerformanceAdapter] Background processing: ${currentSettings.backgroundProcessing} → ${newSettings.backgroundProcessing}`);
    // Background processing control would be implemented in ProjectSession or similar
    // For now, just log the change
  }

  // Update current settings
  currentSettings = newSettings;
}

/**
 * Get current performance settings.
 * Other modules can query this to adjust their behavior.
 */
export function getCurrentPerformanceSettings(): PerformanceSettings | null {
  return currentSettings;
}

/**
 * Check if currently in low power mode.
 */
export function isLowPowerMode(): boolean {
  if (!currentSettings) return false;

  // Heuristic: low power if using minimal workers
  return currentSettings.workerCount <= 1;
}

/**
 * Get recommended preview FPS based on current settings.
 */
export function getRecommendedPreviewFps(): number {
  return currentSettings?.previewFps ?? 30;
}

/**
 * Get recommended thumbnail size based on current settings.
 */
export function getRecommendedThumbnailSize(): { width: number; height: number } {
  return currentSettings?.thumbnailSize ?? { width: 160, height: 90 };
}

/**
 * Get recommended decoder pool size based on current settings.
 */
export function getRecommendedDecoderPoolSize(): number {
  return currentSettings?.decoderPoolSize ?? 20;
}
