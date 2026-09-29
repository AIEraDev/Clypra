import { useEffect } from "react";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { getNativeGpuStatus } from "@/lib/platform/tauri";
import { telemetryCollector } from "@/services/telemetryCollector";

/**
 * Initializes GPU telemetry by fetching native GPU diagnostics from Tauri
 * and updating the telemetry collector with vendor/device IDs, driver info,
 * and software adapter detection.
 */
export function useGpuTelemetryInit() {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let mounted = true;

    async function initGpuTelemetry() {
      try {
        const gpuStatus = await getNativeGpuStatus();
        
        if (!mounted) return;

        // Update telemetry collector with full GPU diagnostics
        telemetryCollector.updateFromNativeGpu({
          adapterName: gpuStatus.adapterName,
          backend: gpuStatus.backend,
          deviceType: gpuStatus.deviceType,
          vendorId: gpuStatus.vendorId,
          deviceId: gpuStatus.deviceId,
          driver: gpuStatus.driver,
          driverInfo: gpuStatus.driverInfo,
          isSoftwareAdapter: gpuStatus.isSoftwareAdapter,
        });
      } catch (error) {
        console.warn("Failed to initialize GPU telemetry:", error);
      }
    }

    initGpuTelemetry();

    return () => {
      mounted = false;
    };
  }, []);
}
