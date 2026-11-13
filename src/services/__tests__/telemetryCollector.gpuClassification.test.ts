import { describe, it, expect, beforeEach } from "vitest";
import { telemetryCollector } from "../telemetryCollector";

describe("GPU Adapter Classification Edge Cases", () => {
  beforeEach(() => {
    telemetryCollector.clearQueue();
    telemetryCollector.setEnabled(true);
    // Reset cached hardware context
    (telemetryCollector as any).cachedHardware = null;
  });

  describe("Software adapter detection", () => {
    it("correctly identifies wgpu DeviceType::Cpu as software adapter", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Software Renderer",
        backend: "Vulkan",
        deviceType: "Cpu", // wgpu DeviceType::Cpu
        vendorId: 0,
        deviceId: 0,
        driver: "software",
        driverInfo: "1.0.0",
        isSoftwareAdapter: true,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(true);
      expect(hw.gpuVendor).toBe("software");
    });

    it("does not misclassify hardware GPU with Discrete device type as software", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "NVIDIA GeForce RTX 4090",
        backend: "Dx12",
        deviceType: "DiscreteGpu",
        vendorId: 0x10de,
        deviceId: 0x2684,
        driver: "nvlddmkm",
        driverInfo: "536.23",
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(false);
      expect(hw.gpuVendor).toBe("nvidia");
    });

    it("does not misclassify hardware GPU with Integrated device type as software", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Intel(R) UHD Graphics 770",
        backend: "Dx12",
        deviceType: "IntegratedGpu",
        vendorId: 0x8086,
        deviceId: 0x4680,
        driver: "igdkmd64",
        driverInfo: "31.0.101.4953",
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(false);
      expect(hw.gpuVendor).toBe("intel");
    });

    it("does not misclassify hardware GPU with VirtualGpu device type as software", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "VMware SVGA 3D",
        backend: "Vulkan",
        deviceType: "VirtualGpu",
        vendorId: 0x15ad,
        deviceId: 0x0405,
        driver: "vmwgfx",
        driverInfo: "1.0.0",
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(false);
      expect(hw.gpuVendor).not.toBe("software");
    });
  });

  describe("Transfer path independence", () => {
    it("does not classify hardware GPU with cpu-rgba transfer as software adapter", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "AMD Radeon RX 7900 XTX",
        backend: "Dx12",
        deviceType: "DiscreteGpu",
        vendorId: 0x1002,
        deviceId: 0x744c,
        driver: "amdxxx64",
        driverInfo: "23.11.1",
        isSoftwareAdapter: false,
      });

      // Record a frame with cpu-rgba transfer path
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 25000 },
        0,
        60,
        { codec: "h264", resolutionBucket: "1080p", nominalFps: 60 },
        "playback",
        undefined,
        0,
        0,
        {
          transferPath: "cpu-rgba",
        },
      );

      const event = (telemetryCollector as any).queue[0];
      expect(event.device.isSoftwareAdapter).toBe(false);
      expect(event.device.gpuVendor).toBe("amd");
      expect(event.workload.transferPath).toBe("cpu-rgba");
    });

    it("correctly identifies software adapter regardless of transfer path", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Software Rasterizer",
        backend: "Vulkan",
        deviceType: "Cpu",
        vendorId: 0,
        deviceId: 0,
        driver: "software",
        driverInfo: "1.0.0",
        isSoftwareAdapter: true,
      });

      // Record with any transfer path
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 30000 },
        0,
        60,
        { codec: "h264", resolutionBucket: "1080p", nominalFps: 60 },
        "playback",
        undefined,
        0,
        0,
        {
          transferPath: "gpu-zero-copy",
        },
      );

      const event = (telemetryCollector as any).queue[0];
      expect(event.device.isSoftwareAdapter).toBe(true);
      expect(event.device.gpuVendor).toBe("software");
    });
  });

  describe("Cross-platform adapter types", () => {
    describe("Windows", () => {
      it("correctly identifies WARP as software adapter", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "Microsoft Basic Render Driver",
          backend: "Dx12",
          deviceType: "Cpu",
          vendorId: 0x1414,
          deviceId: 0x008c,
          driver: "BasicRender.sys",
          driverInfo: "10.0.22621.1",
          isSoftwareAdapter: true,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(true);
        expect(hw.gpuVendor).toBe("software");
      });

      it("correctly identifies Intel UHD as integrated hardware", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "Intel(R) UHD Graphics 630",
          backend: "Dx12",
          deviceType: "IntegratedGpu",
          vendorId: 0x8086,
          deviceId: 0x5912,
          driver: "igdkmd64",
          driverInfo: "30.0.101.1404",
          isSoftwareAdapter: false,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(false);
        expect(hw.gpuVendor).toBe("intel");
        expect(hw.gpuDeviceType).toBe("IntegratedGpu");
      });

      it("correctly identifies NVIDIA discrete GPU", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "NVIDIA GeForce RTX 3060",
          backend: "Dx12",
          deviceType: "DiscreteGpu",
          vendorId: 0x10de,
          deviceId: 0x2503,
          driver: "nvlddmkm",
          driverInfo: "531.61",
          isSoftwareAdapter: false,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(false);
        expect(hw.gpuVendor).toBe("nvidia");
        expect(hw.gpuDeviceType).toBe("DiscreteGpu");
      });
    });

    describe("macOS", () => {
      it("correctly identifies Apple silicon as integrated hardware", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "Apple M3 Max",
          backend: "Metal",
          deviceType: "IntegratedGpu",
          vendorId: 0x106b,
          deviceId: 0,
          driver: "Metal",
          driverInfo: "1.2",
          isSoftwareAdapter: false,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(false);
        expect(hw.gpuVendor).toBe("apple");
        expect(hw.gpuDeviceType).toBe("IntegratedGpu");
      });

      it("correctly identifies AMD discrete GPU on macOS", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "AMD Radeon Pro 5500M",
          backend: "Metal",
          deviceType: "DiscreteGpu",
          vendorId: 0x1002,
          deviceId: 0x7340,
          driver: "Metal",
          driverInfo: "1.2",
          isSoftwareAdapter: false,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(false);
        expect(hw.gpuVendor).toBe("amd");
        expect(hw.gpuDeviceType).toBe("DiscreteGpu");
      });
    });

    describe("Linux", () => {
      it("correctly identifies llvmpipe as software adapter", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "llvmpipe (LLVM 15.0.0, 256 bits)",
          backend: "Vulkan",
          deviceType: "Cpu",
          vendorId: 0x10005,
          deviceId: 0,
          driver: "llvmpipe",
          driverInfo: "1.0.0",
          isSoftwareAdapter: true,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(true);
        expect(hw.gpuVendor).toBe("software");
      });

      it("correctly identifies Intel hardware on Linux", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "Intel(R) Xe Graphics (TGL GT2)",
          backend: "Vulkan",
          deviceType: "IntegratedGpu",
          vendorId: 0x8086,
          deviceId: 0x9a49,
          driver: "Intel open-source Mesa driver",
          driverInfo: "23.1.4",
          isSoftwareAdapter: false,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(false);
        expect(hw.gpuVendor).toBe("intel");
      });

      it("correctly identifies AMD hardware on Linux", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "AMD Radeon RX 6800",
          backend: "Vulkan",
          deviceType: "DiscreteGpu",
          vendorId: 0x1002,
          deviceId: 0x73bf,
          driver: "radv",
          driverInfo: "23.1.4",
          isSoftwareAdapter: false,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(false);
        expect(hw.gpuVendor).toBe("amd");
      });

      it("correctly identifies NVIDIA hardware on Linux", () => {
        telemetryCollector.updateFromNativeGpu({
          adapterName: "NVIDIA GeForce RTX 4080",
          backend: "Vulkan",
          deviceType: "DiscreteGpu",
          vendorId: 0x10de,
          deviceId: 0x2704,
          driver: "NVIDIA",
          driverInfo: "535.104.05",
          isSoftwareAdapter: false,
        });

        const hw = telemetryCollector.initHardwareContext();
        expect(hw.isSoftwareAdapter).toBe(false);
        expect(hw.gpuVendor).toBe("nvidia");
      });
    });
  });

  describe("Missing/unknown adapter metadata", () => {
    it("handles missing vendorId/deviceId gracefully", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Generic GPU",
        backend: "Vulkan",
        deviceType: "IntegratedGpu",
        // vendorId and deviceId omitted
        vendorId: null,
        deviceId: null,
        driver: "generic",
        driverInfo: "1.0.0",
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(false);
      expect(hw.gpuVendorId).toBeUndefined();
      expect(hw.gpuDeviceId).toBeUndefined();
    });

    it("handles unknown device type gracefully", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Unknown Device",
        backend: "Vulkan",
        deviceType: "Other",
        vendorId: 0xffff,
        deviceId: 0xffff,
        driver: "unknown",
        driverInfo: "0.0.0",
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.gpuDeviceType).toBe("Other");
      expect(hw.isSoftwareAdapter).toBe(false);
    });

    it("handles missing driver information gracefully", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Intel(R) UHD Graphics",
        backend: "Dx12",
        deviceType: "IntegratedGpu",
        vendorId: 0x8086,
        deviceId: 0x9a40,
        // driver and driverInfo omitted
        driver: null,
        driverInfo: null,
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(false);
      expect(hw.gpuDriver).toBeUndefined();
      expect(hw.gpuDriverVersion).toBeUndefined();
    });

    it("handles null isSoftwareAdapter as unknown, not false", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Generic Adapter",
        backend: "Vulkan",
        deviceType: "IntegratedGpu",
        vendorId: 0x1234,
        deviceId: 0x5678,
        driver: "generic",
        driverInfo: "1.0",
        // isSoftwareAdapter omitted
        isSoftwareAdapter: null,
      });

      const hw = telemetryCollector.initHardwareContext();
      // When not explicitly set, isSoftwareAdapter should be undefined
      // rather than falsely claiming hardware
      expect(hw.isSoftwareAdapter).toBeUndefined();
    });
  });

  describe("Hardware decode validation", () => {
    it("captures FFmpeg decoder name correctly", () => {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 15000 },
        5, // Dropped frames to force sampling
        60,
        { codec: "h264", resolutionBucket: "1080p", nominalFps: 60 },
        "playback",
        undefined,
        0,
        0,
        {
          hwDecodeActive: true,
          decoderName: "h264_qsv",
          hwDeviceType: "qsv",
        },
      );

      const event = (telemetryCollector as any).queue[0];
      expect(event).toBeDefined();
      expect(event.workload.hwDecodeActive).toBe(true);
      expect(event.workload.decoderName).toBe("h264_qsv");
      expect(event.workload.hwDeviceType).toBe("qsv");
    });

    it("detects QSV hardware acceleration API", () => {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 12000 },
        5, // Dropped frames to force sampling
        60,
        { codec: "hevc", resolutionBucket: "4k", nominalFps: 60 },
        "playback",
        undefined,
        0,
        0,
        {
          hwDecodeActive: true,
          decoderName: "hevc_qsv",
          hwDeviceType: "qsv",
        },
      );

      const event = (telemetryCollector as any).queue[0];
      expect(event).toBeDefined();
      expect(event.workload.hwDeviceType).toBe("qsv");
    });

    it("detects D3D11VA hardware acceleration API", () => {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 13000 },
        5, // Dropped frames to force sampling
        60,
        { codec: "h264", resolutionBucket: "1080p", nominalFps: 60 },
        "playback",
        undefined,
        0,
        0,
        {
          hwDecodeActive: true,
          decoderName: "h264_cuvid",
          hwDeviceType: "d3d11va",
        },
      );

      const event = (telemetryCollector as any).queue[0];
      expect(event).toBeDefined();
      expect(event.workload.hwDeviceType).toBe("d3d11va");
    });

    it("detects VideoToolbox hardware acceleration API", () => {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 11000 },
        5, // Dropped frames to force sampling
        60,
        { codec: "hevc", resolutionBucket: "4k", nominalFps: 60 },
        "playback",
        undefined,
        0,
        0,
        {
          hwDecodeActive: true,
          decoderName: "hevc_videotoolbox",
          hwDeviceType: "videotoolbox",
        },
      );

      const event = (telemetryCollector as any).queue[0];
      expect(event).toBeDefined();
      expect(event.workload.hwDeviceType).toBe("videotoolbox");
    });

    it("captures software decode correctly when hardware is not active", () => {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 22000 },
        0,
        60,
        { codec: "h264", resolutionBucket: "1080p", nominalFps: 60 },
        "playback",
        undefined,
        0,
        0,
        {
          hwDecodeActive: false,
          decoderName: "h264",
          hwDeviceType: "none",
        },
      );

      const event = (telemetryCollector as any).queue[0];
      expect(event.workload.hwDecodeActive).toBe(false);
      expect(event.workload.decoderName).toBe("h264");
    });

    it("distinguishes software decode from software adapter", () => {
      // Hardware GPU with software decode (e.g., unsupported codec)
      telemetryCollector.updateFromNativeGpu({
        adapterName: "NVIDIA GeForce RTX 4090",
        backend: "Dx12",
        deviceType: "DiscreteGpu",
        vendorId: 0x10de,
        deviceId: 0x2684,
        driver: "nvlddmkm",
        driverInfo: "536.23",
        isSoftwareAdapter: false,
      });

      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 28000 },
        0,
        60,
        { codec: "av1", resolutionBucket: "4k", nominalFps: 60 },
        "playback",
        undefined,
        0,
        0,
        {
          hwDecodeActive: false,
          decoderName: "libdav1d",
          hwDeviceType: "none",
        },
      );

      const event = (telemetryCollector as any).queue[0];
      // GPU is hardware, but decode is software
      expect(event.device.isSoftwareAdapter).toBe(false);
      expect(event.device.gpuVendor).toBe("nvidia");
      expect(event.workload.hwDecodeActive).toBe(false);
      expect(event.workload.decoderName).toBe("libdav1d");
    });
  });

  describe("Adapter classification consistency", () => {
    it("maintains consistent classification across multiple frames", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Intel(R) UHD Graphics 770",
        backend: "Dx12",
        deviceType: "IntegratedGpu",
        vendorId: 0x8086,
        deviceId: 0x4680,
        driver: "igdkmd64",
        driverInfo: "31.0.101.4953",
        isSoftwareAdapter: false,
      });

      // Record multiple frames with dropped frames to force sampling
      for (let i = 0; i < 5; i++) {
        telemetryCollector.recordRenderSpan(
          { totalTimeUs: 16000 },
          5, // Dropped frames to force sampling
          60,
          { codec: "h264", resolutionBucket: "1080p", nominalFps: 60 },
          "playback",
          undefined,
          0,
          0,
          {},
        );
      }

      const events = (telemetryCollector as any).queue;
      expect(events.length).toBeGreaterThan(0);

      // All events should have consistent adapter classification
      events.forEach((event: any) => {
        expect(event.device.isSoftwareAdapter).toBe(false);
        expect(event.device.gpuVendor).toBe("intel");
        expect(event.device.gpuDeviceType).toBe("IntegratedGpu");
      });
    });

    it("distinguishes adapter type from backend", () => {
      // Same hardware adapter can use different backends
      telemetryCollector.updateFromNativeGpu({
        adapterName: "AMD Radeon RX 6900 XT",
        backend: "Vulkan", // Backend choice
        deviceType: "DiscreteGpu", // Hardware type
        vendorId: 0x1002,
        deviceId: 0x73af,
        driver: "radv",
        driverInfo: "23.1.0",
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(false);
      expect(hw.gpuVendor).toBe("amd");
      expect(hw.graphicsBackend).toBe("vulkan");
      expect(hw.gpuDeviceType).toBe("DiscreteGpu");
    });
  });

  describe("Edge case adapter names", () => {
    it("correctly identifies SwiftShader as software", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "SwiftShader Device (Subzero)",
        backend: "Vulkan",
        deviceType: "Cpu",
        vendorId: 0x1ae0,
        deviceId: 0xc0de,
        driver: "SwiftShader",
        driverInfo: "5.0.0",
        isSoftwareAdapter: true,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(true);
      expect(hw.gpuVendor).toBe("software");
    });

    it("handles adapter names with version suffixes", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Intel(R) Iris(R) Xe Graphics [0x9a49]",
        backend: "Dx12",
        deviceType: "IntegratedGpu",
        vendorId: 0x8086,
        deviceId: 0x9a49,
        driver: "igdkmd64",
        driverInfo: "30.0.101.1340",
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.isSoftwareAdapter).toBe(false);
      expect(hw.gpuVendor).toBe("intel");
    });

    it("handles generic adapter names without vendor markers", () => {
      telemetryCollector.updateFromNativeGpu({
        adapterName: "Generic VGA Compatible Controller",
        backend: "Vulkan",
        deviceType: "Other",
        vendorId: 0x1234,
        deviceId: 0x5678,
        driver: "generic",
        driverInfo: "1.0",
        isSoftwareAdapter: false,
      });

      const hw = telemetryCollector.initHardwareContext();
      expect(hw.gpuVendor).toBe("unknown");
      expect(hw.isSoftwareAdapter).toBe(false);
    });
  });
});
