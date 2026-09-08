/**
 * TransferPanel
 *
 * Bidirectional Phone ↔ Laptop file transfer UI, built on top of the native Rust
 * LocalSend-compatible server and Web Hub.
 *
 * Capabilities:
 *   1. Send to Phone (Laptop → Phone):
 *      - Stage files on desktop.
 *      - Real scannable QR code for zero-install mobile browser download.
 *      - Direct peer-to-peer push transfer to discovered LocalSend phones.
 *   2. Receive from Phone (Phone → Laptop):
 *      - Real scannable QR code for zero-install mobile browser upload.
 *      - LocalSend v2 inbound receiver with consent prompt and real-time progress.
 *      - 1-click "Add to Project" import.
 *   3. Network Diagnostics:
 *      - Multi-interface LAN IP detection.
 *      - Active subnet scanner (bypasses router multicast drops).
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  X,
  Smartphone,
  Wifi,
  CheckCircle,
  XCircle,
  Loader2,
  FileVideo,
  FileText,
  Copy,
  Check as CheckIcon,
  AlertTriangle,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  Plus,
  Send,
  Laptop,
  Folder,
  FolderOpen,
  Eye,
  Image as ImageIcon,
  HelpCircle,
  Cable,
  ShieldCheck,
  ChevronRight,
  Info,
  Radio,
} from "lucide-react";
import {
  useSettingsStore,
  syncThemeToTransferService,
} from "@/store/settingsStore";
import { platform } from "@/core/platform";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ── Tauri IPC helpers ─────────────────────────────────────────────────────────

async function invokeTransfer<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri) throw new Error("Transfer only available in Tauri app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function listenEvent(
  event: string,
  handler: (payload: any) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(event, (e) => handler(e.payload));
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StagedFile {
  id: string;
  fileName: string;
  filePath: string;
  size: number;
  mimeType: string;
  createdAt: number;
}

interface DiscoveredDevice {
  alias: string;
  deviceType?: string;
  ip: string;
  port: number;
  fingerprint: string;
  lastSeenSecs: number;
}

interface IncomingFile {
  id: string;
  fileName: string;
  size: number;
  fileType: string;
}

interface TransferSession {
  sessionId: string;
  senderAlias: string;
  senderIp: string;
  state:
    | "Pending"
    | "Accepted"
    | "Rejected"
    | "InProgress"
    | "Complete"
    | "Cancelled";
  files: IncomingFile[];
  receivedFiles: string[];
  bytesReceived: number;
  totalBytes: number;
}

interface ConsentRequest {
  sessionId: string;
  senderAlias: string;
  files: { id: string; name: string; size: number }[];
}

interface ProgressEvent {
  sessionId: string;
  fileId: string;
  bytesReceived: number;
  totalBytes: number;
}

interface CompleteEvent {
  sessionId: string;
  filePaths: string[];
}

interface OutboundProgressEvent {
  sessionId: string;
  fileId: string;
  fileName: string;
  bytesSent: number;
  totalBytes: number;
}

interface NetworkInterfaceInfo {
  name: string;
  ip: string;
  isDefault: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── QR Code Renderer (SVG from Rust backend) ──────────────────────────────────

function QRCodeSVG({
  svg,
  url,
  subtitle,
}: {
  svg: string | null;
  url: string | null;
  subtitle: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-44 h-44 bg-white rounded-2xl p-2.5 shadow-xl flex items-center justify-center border border-white/20">
        {svg ? (
          <div
            className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
            <span className="text-[11px]">Generating QR…</span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1.5 max-w-[240px] text-center">
        <p className="text-[12px] font-medium text-text-primary">{subtitle}</p>
        {url && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/8">
            <span className="text-[11px] font-mono text-text-muted truncate max-w-[160px]">
              {url}
            </span>
            <button
              onClick={copyUrl}
              className="text-text-muted hover:text-text-primary p-0.5 cursor-pointer transition-colors"
              title="Copy URL"
            >
              {copied ? (
                <CheckIcon className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TransferPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onImportFiles: (filePaths: string[]) => void;
  /** Optional initial active tab */
  initialTab?: "send" | "receive" | "guide";
}

// ── Main Component ────────────────────────────────────────────────────────────

export const TransferPanel: React.FC<TransferPanelProps> = ({
  isOpen,
  onClose,
  onImportFiles,
  initialTab = "send",
}) => {
  const transferSaveDirectory = useSettingsStore(
    (s) => s.transferSaveDirectory,
  );
  const setTransferSaveDirectory = useSettingsStore(
    (s) => s.setTransferSaveDirectory,
  );
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const [saveDirectory, setSaveDirectory] = useState<string>(
    transferSaveDirectory || "",
  );

  const [activeTab, setActiveTab] = useState<"send" | "receive" | "guide">(
    initialTab,
  );
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [localIp, setLocalIp] = useState<string>("");
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);

  // Send state
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<
    DiscoveredDevice[]
  >([]);
  const [isScanning, setIsScanning] = useState(false);
  const [outboundStatus, setOutboundStatus] = useState<string | null>(null);
  const [outboundProgress, setOutboundProgress] = useState<{
    sent: number;
    total: number;
    fileName: string;
  } | null>(null);

  // Receive state
  const [consentRequest, setConsentRequest] = useState<ConsentRequest | null>(
    null,
  );
  const [sessions, setSessions] = useState<TransferSession[]>([]);
  const [progress, setProgress] = useState<
    Record<string, { received: number; total: number }>
  >({});

  const unlistenRefs = useRef<Array<() => void>>([]);
  const pollIntervalRef = useRef<any>(null);

  // ── Server lifecycle & initialization ───────────────────────────────────────

  const loadStaged = useCallback(async () => {
    if (!isTauri) return;
    try {
      const files = await invokeTransfer<StagedFile[]>("get_staged_files");
      setStagedFiles(files);
    } catch {}
  }, []);

  const loadDevices = useCallback(async () => {
    if (!isTauri) return;
    try {
      const devs = await invokeTransfer<DiscoveredDevice[]>(
        "get_discovered_devices",
      );
      setDiscoveredDevices(devs);
    } catch {}
  }, []);

  const triggerSubnetScan = useCallback(async () => {
    if (!isTauri || isScanning) return;
    setIsScanning(true);
    try {
      const found =
        await invokeTransfer<DiscoveredDevice[]>("scan_local_network");
      setDiscoveredDevices(found);
    } catch (err) {
      console.warn("[Transfer] Scan error:", err);
    } finally {
      setIsScanning(false);
    }
  }, [isScanning]);

  const handleChangeDirectory = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Folder to Save Transferred Files",
        defaultPath: saveDirectory || undefined,
      });

      if (!selected || typeof selected !== "string") return;
      const updated = await invokeTransfer<string>(
        "set_transfer_save_directory",
        { path: selected },
      );
      setSaveDirectory(updated);
      setTransferSaveDirectory(updated);
    } catch (err: any) {
      console.error("[Transfer] Failed to change save directory:", err);
    }
  };

  const handleOpenDirectory = async () => {
    if (!isTauri) return;
    try {
      await invokeTransfer("open_transfer_save_directory");
    } catch (err: any) {
      console.error("[Transfer] Failed to open save directory:", err);
    }
  };

  const handleOpenFile = async (filePath: string) => {
    if (!isTauri) return;
    try {
      await invokeTransfer("open_file_path", { path: filePath });
    } catch (err: any) {
      console.error("[Transfer] Failed to open file:", err);
    }
  };

  const handleShowInFolder = async (filePath: string) => {
    if (!isTauri) return;
    try {
      await invokeTransfer("show_item_in_folder", { path: filePath });
    } catch (err: any) {
      console.error("[Transfer] Failed to show item in folder:", err);
    }
  };

  useEffect(() => {
    if (!isOpen || !isTauri) return;

    const startServer = async () => {
      try {
        await invokeTransfer("start_transfer_service", {
          customDir: transferSaveDirectory || undefined,
        });
        const status = await invokeTransfer<{
          running: boolean;
          port: number;
          localIp: string;
        }>("get_transfer_service_status");

        setServerRunning(status.running);
        setLocalIp(status.localIp);
        setServerError(null);

        const url = await invokeTransfer<string>("get_transfer_server_url");
        setServerUrl(url);

        const svg = await invokeTransfer<string>("get_transfer_qr_code");
        setQrCodeSvg(svg);

        const dir = await invokeTransfer<string>("get_transfer_save_directory");
        setSaveDirectory(dir);

        const ifaces = await invokeTransfer<NetworkInterfaceInfo[]>(
          "get_network_interfaces",
        );
        setInterfaces(ifaces);

        await loadStaged();
        await loadDevices();

        // Sync active editor theme to mobile web hub
        await syncThemeToTransferService();

        // Run an active scan on open to find peers immediately
        void triggerSubnetScan();
      } catch (err: any) {
        setServerError(err?.message || String(err));
      }
    };

    startServer();

    pollIntervalRef.current = setInterval(() => {
      loadDevices();
      loadStaged();
    }, 4000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [
    isOpen,
    loadStaged,
    loadDevices,
    triggerSubnetScan,
    transferSaveDirectory,
  ]);

  // Synchronize mobile hub theme whenever editor theme or font family changes
  useEffect(() => {
    if (isOpen && isTauri) {
      void syncThemeToTransferService();
    }
  }, [uiTheme, fontFamily, isOpen]);

  // ── Event listeners ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !isTauri) return;

    const setup = async () => {
      const unlistenIncoming = await listenEvent(
        "clypra://transfer-incoming",
        (payload: any) => {
          setConsentRequest({
            sessionId: payload.sessionId,
            senderAlias: payload.senderAlias,
            files: payload.files || [],
          });
          // Switch to receive tab so user sees consent immediately
          setActiveTab("receive");
        },
      );

      const unlistenProgress = await listenEvent(
        "clypra://transfer-progress",
        (payload: ProgressEvent) => {
          setProgress((prev) => ({
            ...prev,
            [payload.sessionId]: {
              received: payload.bytesReceived,
              total: payload.totalBytes,
            },
          }));
        },
      );

      const unlistenComplete = await listenEvent(
        "clypra://transfer-complete",
        (payload: CompleteEvent) => {
          setSessions((prev) =>
            prev.map((s) =>
              s.sessionId === payload.sessionId
                ? {
                    ...s,
                    state: "Complete",
                    receivedFiles: payload.filePaths,
                  }
                : s,
            ),
          );
        },
      );

      const unlistenCancelled = await listenEvent(
        "clypra://transfer-cancelled",
        (payload: { sessionId: string }) => {
          setSessions((prev) =>
            prev.map((s) =>
              s.sessionId === payload.sessionId
                ? { ...s, state: "Cancelled" }
                : s,
            ),
          );
        },
      );

      const unlistenOutProgress = await listenEvent(
        "clypra://transfer-outbound-progress",
        (payload: OutboundProgressEvent) => {
          setOutboundProgress({
            sent: payload.bytesSent,
            total: payload.totalBytes,
            fileName: payload.fileName,
          });
        },
      );

      const unlistenOutComplete = await listenEvent(
        "clypra://transfer-outbound-complete",
        () => {
          setOutboundStatus("✅ Sent successfully to remote device!");
          setTimeout(() => {
            setOutboundProgress(null);
            setOutboundStatus(null);
          }, 4000);
        },
      );

      unlistenRefs.current = [
        unlistenIncoming,
        unlistenProgress,
        unlistenComplete,
        unlistenCancelled,
        unlistenOutProgress,
        unlistenOutComplete,
      ];
    };

    setup();
    return () => {
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, [isOpen]);

  // ── Staged files actions ────────────────────────────────────────────────────

  const handlePickFiles = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        title: "Select Files to Send to Phone",
      });

      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      const updated = await invokeTransfer<StagedFile[]>(
        "stage_files_for_transfer",
        { paths },
      );
      setStagedFiles(updated);
    } catch (err: any) {
      console.error("[Transfer] Pick files error:", err);
    }
  };

  const handleUnstage = async (fileId: string) => {
    try {
      await invokeTransfer("unstage_file", { fileId });
      setStagedFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch {}
  };

  const handleClearStaged = async () => {
    try {
      await invokeTransfer("clear_staged_files");
      setStagedFiles([]);
    } catch {}
  };

  const handleSendToPeer = async (device: DiscoveredDevice) => {
    if (stagedFiles.length === 0) return;
    setOutboundStatus(`Sending to ${device.alias}…`);
    setOutboundProgress({
      sent: 0,
      total: stagedFiles.reduce((acc, f) => acc + f.size, 0),
      fileName: stagedFiles[0].fileName,
    });

    try {
      await invokeTransfer("send_files_to_peer", {
        peerIp: device.ip,
        peerPort: device.port,
        filePaths: stagedFiles.map((f) => f.filePath),
      });
    } catch (err: any) {
      setOutboundStatus(`Failed: ${err?.message || String(err)}`);
      setOutboundProgress(null);
    }
  };

  // ── Consent actions ─────────────────────────────────────────────────────────

  const handleAccept = useCallback(async (req: ConsentRequest) => {
    try {
      await invokeTransfer("accept_transfer_session", {
        sessionId: req.sessionId,
      });
      setConsentRequest(null);
      setSessions((prev) => [
        ...prev,
        {
          sessionId: req.sessionId,
          senderAlias: req.senderAlias,
          senderIp: "",
          state: "Accepted",
          files: req.files.map((f) => ({
            id: f.id,
            fileName: f.name,
            size: f.size,
            fileType: "video/*",
          })),
          receivedFiles: [],
          bytesReceived: 0,
          totalBytes: req.files.reduce((acc, f) => acc + f.size, 0),
        },
      ]);
    } catch (err: any) {
      console.error("[TransferPanel] Accept failed:", err);
    }
  }, []);

  const handleReject = useCallback(async (req: ConsentRequest) => {
    try {
      await invokeTransfer("reject_transfer_session", {
        sessionId: req.sessionId,
      });
    } catch {}
    setConsentRequest(null);
  }, []);

  const handleImport = useCallback(
    (session: TransferSession) => {
      if (session.receivedFiles.length > 0) {
        onImportFiles(session.receivedFiles);
      }
    },
    [onImportFiles],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden text-text-primary"
        style={{
          background: "var(--clypra-surface-panel, #15151c)",
          border:
            "1px solid color-mix(in srgb, var(--clypra-text-primary, #fff) 12%, transparent)",
          maxHeight: "88vh",
        }}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text-primary">
                  Local File Sharing
                </h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent">
                  WiFi Transfer
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Laptop ↔ Mobile Phone · No cloud · Full quality
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/8 px-6 pt-2 bg-white/2 shrink-0">
          <button
            onClick={() => setActiveTab("send")}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-semibold border-b-2 cursor-pointer transition-all ${
              activeTab === "send"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Send to Phone</span>
            {stagedFiles.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-accent text-white font-bold">
                {stagedFiles.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("receive")}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-semibold border-b-2 cursor-pointer transition-all ${
              activeTab === "receive"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Receive from Phone</span>
            {consentRequest && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveTab("guide")}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-semibold border-b-2 cursor-pointer transition-all ${
              activeTab === "guide"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>Connection Guide</span>
          </button>
        </div>

        {/* Save Destination Folder Bar */}
        <div className="px-6 pt-3.5 shrink-0">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-white/3 border border-white/8 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <Folder className="w-4 h-4 text-accent shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">
                  Save files to:
                </span>
                <p
                  className="font-mono text-xs font-semibold text-text-primary truncate"
                  title={saveDirectory}
                >
                  {saveDirectory || "Default: ~/Downloads/Clypra Transfers"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleOpenDirectory}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-text-primary text-[11px] font-medium border border-white/10 transition-colors cursor-pointer flex items-center gap-1"
                title="Reveal folder in Finder / Explorer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Open</span>
              </button>
              <button
                onClick={handleChangeDirectory}
                className="px-2.5 py-1 rounded-lg bg-accent/20 hover:bg-accent text-accent hover:text-white text-[11px] font-semibold border border-accent/30 transition-colors cursor-pointer"
                title="Choose custom folder on your system"
              >
                Change…
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
          {!isTauri ? (
            <div className="flex items-center gap-2 text-sm text-yellow-400 p-4 rounded-xl bg-yellow-400/10 border border-yellow-400/20">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>
                Local transfer is only available in the Clypra desktop app.
              </span>
            </div>
          ) : serverError ? (
            <div className="flex items-start gap-3 text-sm text-red-400 p-4 rounded-xl bg-red-400/10 border border-red-400/20">
              <XCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Server Error</p>
                <p className="text-xs text-red-400/80">{serverError}</p>
              </div>
            </div>
          ) : !serverRunning ? (
            <div className="flex items-center justify-center gap-3 py-12 text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
              <span>Starting transfer engine…</span>
            </div>
          ) : activeTab === "send" ? (
            /* ─────────────────────────────────────────────────────────── */
            /* TAB 1: SEND TO PHONE                                       */
            /* ─────────────────────────────────────────────────────────── */
            <div className="space-y-6">
              {/* Quick Connection Tip Banner */}
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-accent/10 border border-accent/20 text-xs text-text-primary">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
                    <Radio className="w-4 h-4 text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary truncate">
                      Hotspot tip: Keep Mobile Data turned ON on your phone
                    </p>
                    <p className="text-[11px] text-text-muted truncate">
                      Required for phone routing · 0 MB mobile data is consumed · 100% local Wi-Fi
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab("guide")}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-accent/20 hover:bg-accent text-accent hover:text-white text-[11px] font-semibold border border-accent/30 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <span>View Guide</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* Dual presentation: QR Code on left, Staged files & peers on right */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                <div className="md:col-span-5 flex flex-col items-center">
                  <QRCodeSVG
                    svg={qrCodeSvg}
                    url={serverUrl}
                    subtitle="Scan with Phone Camera to download in mobile browser"
                  />

                  {/* How to download on phone */}
                  <div className="w-full mt-3 p-3.5 rounded-xl bg-white/3 border border-white/8 space-y-1.5 text-left">
                    <h4 className="text-[11px] font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5 text-accent" />
                      <span>How to download on phone</span>
                    </h4>
                    <ol className="text-xs text-text-muted space-y-1 list-decimal list-inside leading-relaxed">
                      <li>Add files on the right to stage them for your phone.</li>
                      <li>Scan QR code with phone camera to open Web Hub.</li>
                      <li>Tap <strong>"Download"</strong> or <strong>"View 👁️"</strong>.</li>
                      <li>If Chrome warns, tap <strong>"Keep"</strong> (it's 100% offline & safe).</li>
                    </ol>
                  </div>
                </div>

                <div className="md:col-span-7 flex flex-col gap-4">
                  <div className="flex flex-col gap-y-2">
                    <div>
                      <h3 className="text-sm font-bold">Staged Files</h3>
                      <p className="text-[11px] text-text-muted">
                        Files ready for phone download
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {stagedFiles.length > 0 && (
                        <button
                          onClick={handleClearStaged}
                          className="text-[11px] flex-1 text-red-400 bg-red-800 rounded-md hover:text-red-300 p-1 cursor-pointer flex items-center justify-center gap-1"
                          title="Clear all staged files"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Clear</span>
                        </button>
                      )}
                      <button
                        onClick={handlePickFiles}
                        className="px-3 flex-1 py-1.5 rounded-md bg-accent text-white text-xs font-semibold hover:bg-accent/90 cursor-pointer flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-accent/20"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Files…</span>
                      </button>
                    </div>
                  </div>

                  {stagedFiles.length === 0 ? (
                    <div
                      onClick={handlePickFiles}
                      className="border-2 border-dashed border-white/10 hover:border-accent/40 rounded-xl p-6 text-center cursor-pointer transition-colors bg-white/1"
                    >
                      <FileVideo className="w-8 h-8 text-text-muted/40 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-text-muted">
                        No files staged yet
                      </p>
                      <p className="text-[11px] text-text-muted/60 mt-1">
                        Click here to select videos, images, or exports to share
                        with phone
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-44 overflow-y-auto scrollbar-thin">
                      {stagedFiles.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/4 border border-white/6 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                            <span
                              className="truncate font-medium"
                              title={file.fileName}
                            >
                              {file.fileName}
                            </span>
                            <span className="text-[10px] text-text-muted shrink-0">
                              · {formatBytes(file.size)}
                            </span>
                          </div>
                          <button
                            onClick={() => handleUnstage(file.id)}
                            className="text-text-muted hover:text-red-400 p-1 cursor-pointer"
                            title="Remove"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Outbound Transfer Progress */}
                  {outboundProgress && (
                    <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-accent truncate">
                          Sending {outboundProgress.fileName}…
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">
                          {formatBytes(outboundProgress.sent)} /{" "}
                          {formatBytes(outboundProgress.total)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all duration-200"
                          style={{
                            width: `${Math.round(
                              (outboundProgress.sent /
                                (outboundProgress.total || 1)) *
                                100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {outboundStatus && !outboundProgress && (
                    <p className="text-xs font-semibold text-green-400">
                      {outboundStatus}
                    </p>
                  )}
                </div>
              </div>

              {/* Discovered LocalSend Devices */}
              <div className="border-t border-white/8 pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-accent" />
                    <h3 className="text-sm font-bold">Discovered Devices</h3>
                    <span className="text-xs text-text-muted">
                      ({discoveredDevices.length})
                    </span>
                  </div>
                  <button
                    onClick={triggerSubnetScan}
                    disabled={isScanning}
                    className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/8 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isScanning ? "animate-spin text-accent" : ""}`}
                    />
                    <span>
                      {isScanning ? "Scanning WiFi…" : "Scan Network"}
                    </span>
                  </button>
                </div>

                {discoveredDevices.length === 0 ? (
                  <div className="rounded-xl border border-white/6 bg-white/2 p-4 text-center">
                    <p className="text-xs text-text-muted">
                      No LocalSend devices discovered automatically yet.
                    </p>
                    <p className="text-[11px] text-text-muted/60 mt-1">
                      Open LocalSend on your phone, or simply scan the QR code
                      above with your camera!
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {discoveredDevices.map((dev) => (
                      <div
                        key={dev.fingerprint}
                        className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/8 hover:border-white/20 transition-all"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                            <Smartphone className="w-4 h-4 text-accent" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">
                              {dev.alias}
                            </p>
                            <p className="text-[10px] text-text-muted font-mono truncate">
                              {dev.ip}:{dev.port}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleSendToPeer(dev)}
                          disabled={stagedFiles.length === 0}
                          className="px-2.5 py-1 rounded-lg bg-accent/20 text-accent hover:bg-accent text-xs font-semibold hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0 flex items-center gap-1"
                        >
                          <Send className="w-3 h-3" />
                          <span>Push</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "receive" ? (
            /* ─────────────────────────────────────────────────────────── */
            /* TAB 2: RECEIVE FROM PHONE                                  */
            /* ─────────────────────────────────────────────────────────── */
            <div className="space-y-6">
              {/* Quick Connection Tip Banner */}
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-accent/10 border border-accent/20 text-xs text-text-primary">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
                    <Radio className="w-4 h-4 text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary truncate">
                      Hotspot tip: Keep Mobile Data turned ON on your phone
                    </p>
                    <p className="text-[11px] text-text-muted truncate">
                      Required for phone routing · 0 MB mobile data is consumed · 100% local Wi-Fi
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab("guide")}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-accent/20 hover:bg-accent text-accent hover:text-white text-[11px] font-semibold border border-accent/30 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <span>View Guide</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* Incoming consent request */}
              {consentRequest && (
                <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 shadow-lg animate-in zoom-in-95">
                  <div className="flex items-start gap-3 mb-3">
                    <Download className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-text-primary">
                        <span className="text-accent">
                          {consentRequest.senderAlias}
                        </span>{" "}
                        wants to send {consentRequest.files.length} file
                        {consentRequest.files.length !== 1 ? "s" : ""}
                      </p>
                      <div className="mt-2 space-y-1">
                        {consentRequest.files.slice(0, 3).map((f, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="text-xs text-text-muted truncate">
                              {f.name}
                            </span>
                            <span className="text-[11px] text-text-muted/60 shrink-0 font-mono">
                              {formatBytes(f.size)}
                            </span>
                          </div>
                        ))}
                        {consentRequest.files.length > 3 && (
                          <p className="text-[11px] text-text-muted/60">
                            +{consentRequest.files.length - 3} more files…
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReject(consentRequest)}
                      className="flex-1 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-text-muted hover:bg-white/10 hover:text-text-primary transition-colors cursor-pointer"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => handleAccept(consentRequest)}
                      className="flex-1 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors cursor-pointer shadow-md shadow-accent/20"
                    >
                      Accept Transfer
                    </button>
                  </div>
                </div>
              )}

              {/* QR and upload instructions */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                <div className="md:col-span-5 flex justify-center">
                  <QRCodeSVG
                    svg={qrCodeSvg}
                    url={serverUrl}
                    subtitle="Scan with Phone Camera to upload directly into Clypra"
                  />
                </div>

                <div className="md:col-span-7 space-y-3">
                  <div className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-2">
                    <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-accent" />
                      <span>How to upload from phone</span>
                    </h3>
                    <ol className="text-xs text-text-muted space-y-1.5 list-decimal list-inside leading-relaxed">
                      <li>Point your phone camera at the QR code.</li>
                      <li>
                        Tap the link banner to open Clypra Web Hub in browser.
                      </li>
                      <li>
                        Select photos or 4K videos and tap{" "}
                        <strong>"Send to Clypra"</strong>.
                      </li>
                      <li>Accept the transfer prompt on your laptop.</li>
                    </ol>
                  </div>

                  <div className="p-3 rounded-xl bg-white/2 border border-white/6 text-xs text-text-muted flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-text-primary text-[11px]">
                        Lossless Direct Local Transfer
                      </p>
                      <p className="text-[11px] text-text-muted/80 leading-relaxed">
                        Transfers occur untouched directly between devices over local radio hardware. No cloud, no quality degradation, and 0 MB mobile data used.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active & Completed Transfer Sessions */}
              {sessions.length > 0 && (
                <div className="border-t border-white/8 pt-5 space-y-3">
                  <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">
                    Recent Inbound Transfers
                  </h3>
                  {sessions.map((session) => {
                    const prog = progress[session.sessionId];
                    const pct =
                      prog && prog.total > 0
                        ? Math.round((prog.received / prog.total) * 100)
                        : session.state === "Complete"
                          ? 100
                          : 0;

                    return (
                      <div
                        key={session.sessionId}
                        className="rounded-xl border border-white/8 bg-white/[0.03] p-3.5 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileVideo className="w-4 h-4 text-accent shrink-0" />
                            <span className="text-xs font-semibold text-text-primary truncate">
                              {session.senderAlias}
                            </span>
                            <span className="text-[11px] text-text-muted">
                              · {session.files.length} file
                              {session.files.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <div>
                            {session.state === "Complete" && (
                              <CheckCircle className="w-4 h-4 text-green-400" />
                            )}
                            {session.state === "Cancelled" && (
                              <XCircle className="w-4 h-4 text-red-400" />
                            )}
                            {(session.state === "Accepted" ||
                              session.state === "InProgress") && (
                              <Loader2 className="w-4 h-4 text-accent animate-spin" />
                            )}
                          </div>
                        </div>

                        {/* Progress */}
                        {(session.state === "InProgress" ||
                          session.state === "Accepted" ||
                          session.state === "Complete") && (
                          <div className="space-y-1">
                            <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-accent rounded-full transition-all duration-200"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-[10px] text-text-muted">
                              <span>
                                {prog ? formatBytes(prog.received) : "0 B"} /{" "}
                                {prog
                                  ? formatBytes(prog.total)
                                  : formatBytes(session.totalBytes)}
                              </span>
                              <span className="font-mono">{pct}%</span>
                            </div>
                          </div>
                        )}

                        {session.state === "Complete" &&
                          session.receivedFiles.length > 0 && (
                            <div className="space-y-2.5 pt-1 border-t border-white/5">
                              <div className="space-y-1.5">
                                {session.receivedFiles.map((filePath, idx) => {
                                  const fileName =
                                    filePath.split(/[/\\]/).pop() || "File";
                                  const isImage =
                                    /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(
                                      fileName,
                                    );
                                  const isVideo =
                                    /\.(mp4|mov|mkv|webm|m4v|avi|flv|wmv)$/i.test(
                                      fileName,
                                    );
                                  const matchingInfo = session.files.find(
                                    (f) => f.fileName === fileName,
                                  );
                                  const fileSrc = isTauri
                                    ? platform.convertFileSrc(filePath)
                                    : "";

                                  return (
                                    <div
                                      key={`${filePath}-${idx}`}
                                      className="flex items-center justify-between gap-3 p-2 rounded-lg bg-black/25 border border-white/5 hover:border-white/15 transition-colors"
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        {isImage && fileSrc ? (
                                          <div
                                            onClick={() =>
                                              handleOpenFile(filePath)
                                            }
                                            className="w-11 h-11 rounded-lg overflow-hidden bg-black/40 border border-white/15 shrink-0 cursor-pointer hover:opacity-85 transition-opacity relative group shadow-sm"
                                            title="Click to view full image on PC"
                                          >
                                            <img
                                              src={fileSrc}
                                              alt={fileName}
                                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                            />
                                          </div>
                                        ) : isVideo ? (
                                          <div className="w-11 h-11 rounded-lg bg-accent/10 border border-accent/25 flex items-center justify-center shrink-0">
                                            <FileVideo className="w-5 h-5 text-accent" />
                                          </div>
                                        ) : (
                                          <div className="w-11 h-11 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                            <FileText className="w-5 h-5 text-text-muted" />
                                          </div>
                                        )}
                                        <div className="min-w-0">
                                          <p
                                            className="text-xs font-semibold text-text-primary truncate max-w-[190px]"
                                            title={fileName}
                                          >
                                            {fileName}
                                          </p>
                                          <p className="text-[10px] text-text-muted mt-0.5">
                                            {matchingInfo?.size
                                              ? formatBytes(matchingInfo.size)
                                              : isImage
                                                ? "Image"
                                                : isVideo
                                                  ? "Video"
                                                  : "File"}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          onClick={() =>
                                            handleOpenFile(filePath)
                                          }
                                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-[11px] font-medium text-text-primary transition-all cursor-pointer shadow-sm active:scale-95"
                                          title="Open and view locally on PC"
                                        >
                                          <Eye className="w-3.5 h-3.5 text-accent" />
                                          <span>
                                            {isImage ? "View Image" : "Open"}
                                          </span>
                                        </button>
                                        <button
                                          onClick={() =>
                                            handleShowInFolder(filePath)
                                          }
                                          className="p-1.5 rounded-lg hover:bg-white/10 border border-transparent hover:border-white/10 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                                          title="Reveal in Finder / Explorer"
                                        >
                                          <FolderOpen className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <button
                                onClick={() => handleImport(session)}
                                className="w-full py-1.5 rounded-lg bg-accent/20 border border-accent/30 text-accent text-xs font-semibold hover:bg-accent hover:text-white transition-colors cursor-pointer"
                              >
                                Add to Project ({session.receivedFiles.length}{" "}
                                file
                                {session.receivedFiles.length !== 1 ? "s" : ""})
                              </button>
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ─────────────────────────────────────────────────────────── */
            /* TAB 3: CONNECTION & OFFLINE GUIDE                          */
            /* ─────────────────────────────────────────────────────────── */
            <div className="space-y-6">
              {/* Feature Highlights / Guarantee Banner */}
              <div className="p-4 rounded-xl bg-accent/10 border border-accent/25 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">
                      100% Offline & Zero Data Consumed
                    </h3>
                    <p className="text-xs text-text-muted">
                      Transfers occur strictly between devices over local radio hardware. No cloud or internet.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-black/25 border border-white/5 text-[11px]">
                    <span className="text-emerald-400 font-bold text-sm">0 MB</span>
                    <span className="text-text-muted">Mobile data used</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-black/25 border border-white/5 text-[11px]">
                    <span className="text-sky-400 font-bold text-sm">100%</span>
                    <span className="text-text-muted">Offline & private</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-black/25 border border-white/5 text-[11px]">
                    <span className="text-amber-400 font-bold text-sm">Lossless</span>
                    <span className="text-text-muted">Original 4K / Audio</span>
                  </div>
                </div>
              </div>

              {/* Connection Methods */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider">
                  Choose How to Connect
                </h4>

                {/* Option 1: Same Wi-Fi */}
                <div className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <Wifi className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-text-primary">
                          Method 1: Same Wi-Fi Network
                        </span>
                        <p className="text-[11px] text-text-muted">
                          Best for Home, Studio, or Office
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                      Recommended
                    </span>
                  </div>
                  <ol className="text-xs text-text-muted space-y-1.5 list-decimal list-inside leading-relaxed pl-1">
                    <li>Connect both your laptop and phone to the <strong>same Wi-Fi router</strong>.</li>
                    <li>
                      <strong>No internet required:</strong> Even if your router has no active internet subscription, devices communicate directly over the local network.
                    </li>
                    <li>Point your phone camera at the QR code in Clypra to start transferring!</li>
                  </ol>
                </div>

                {/* Option 2: Phone Hotspot */}
                <div className="p-4 rounded-xl bg-white/3 border border-amber-500/25 space-y-3 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        <Smartphone className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-text-primary">
                          Method 2: Phone Hotspot (Away from Wi-Fi)
                        </span>
                        <p className="text-[11px] text-text-muted">
                          Best when travelling or outdoors
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                      Mobile Hotspot
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs space-y-1.5">
                    <div className="flex items-center gap-2 text-amber-300 font-semibold">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Important: Turn Mobile Data ON on your phone</span>
                    </div>
                    <p className="text-[11px] text-amber-200/90 leading-relaxed">
                      <strong>Why won't Hotspot work if Mobile Data is off?</strong><br />
                      Android and iOS automatically disable their local network DHCP router and socket bridges if Mobile Data is toggled off. When Mobile Data is off, your phone refuses to assign an IP address or route packets to your laptop.
                    </p>
                    <p className="text-[11px] text-emerald-300 font-medium">
                      🛡️ <strong>Zero Data Consumption Guarantee:</strong> Even with Mobile Data toggled ON, <strong>0 MB of your cellular data plan is used</strong>. Clypra transfers files strictly over the phone-to-laptop Wi-Fi radio frequencies at up to 80+ MB/s.
                    </p>
                  </div>

                  <ol className="text-xs text-text-muted space-y-1.5 list-decimal list-inside leading-relaxed pl-1">
                    <li>Turn <strong>Mobile Data ON</strong> on your phone.</li>
                    <li>Turn <strong>Personal Hotspot</strong> ON on your phone.</li>
                    <li>Connect your laptop's Wi-Fi to your phone's hotspot.</li>
                    <li>Scan the QR code in Clypra to send or receive files.</li>
                  </ol>
                </div>

                {/* Option 3: Laptop Hotspot */}
                <div className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                        <Laptop className="w-4 h-4 text-sky-400" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-text-primary">
                          Method 3: Laptop Hotspot (No SIM / Data Needed)
                        </span>
                        <p className="text-[11px] text-text-muted">
                          100% offline without SIM card or cellular signal
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-400">
                      Laptop Host
                    </span>
                  </div>
                  <div className="text-xs text-text-muted space-y-2 leading-relaxed">
                    <p>
                      If you want to keep your phone completely offline or don't have a SIM card:
                    </p>
                    <ul className="space-y-1 list-disc list-inside text-[11px]">
                      <li>
                        <strong>macOS:</strong> Open <em>System Settings → General → Sharing → Internet Sharing</em>. Turn it on to create a local Wi-Fi hotspot from your Mac.
                      </li>
                      <li>
                        <strong>Windows:</strong> Open <em>Settings → Network & Internet → Mobile Hotspot</em>. Toggle it ON.
                      </li>
                      <li>Connect your phone's Wi-Fi to the laptop's network and scan the QR code.</li>
                    </ul>
                  </div>
                </div>

                {/* Option 4: USB Cable Tethering */}
                <div className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                        <Cable className="w-4 h-4 text-purple-400" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-text-primary">
                          Method 4: USB Cable Tethering
                        </span>
                        <p className="text-[11px] text-text-muted">
                          Fastest speeds (up to 10 Gbps wired) & zero wireless interference
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400">
                      Wired Fast
                    </span>
                  </div>
                  <ol className="text-xs text-text-muted space-y-1.5 list-decimal list-inside leading-relaxed pl-1">
                    <li>Connect phone to laptop using a USB-C or Lightning cable.</li>
                    <li>On phone, open <strong>Settings → Hotspot / Tethering → enable USB Tethering</strong>.</li>
                    <li>Clypra will detect the wired adapter automatically. Great for transferring 50+ GB 4K footage!</li>
                  </ol>
                </div>
              </div>

              {/* Troubleshooting & Browser Tips */}
              <div className="p-4 rounded-xl bg-white/2 border border-white/6 space-y-3">
                <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-2">
                  <Info className="w-4 h-4 text-accent" />
                  <span>Mobile Browser Tips & Warnings</span>
                </h4>

                <div className="space-y-2.5 text-xs text-text-muted">
                  <div className="p-3 rounded-lg bg-black/20 border border-white/5 space-y-1">
                    <p className="font-semibold text-text-primary text-[11px]">
                      Android Chrome: "File can't be downloaded securely"
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      Because Clypra runs directly on your private home/hotspot IP (<code className="text-accent">http://192.168.x.x</code>) without routing through public cloud servers, Chrome shows this routine security check. Tap the prompt or 3 dots and select <strong>"Keep"</strong> or <strong>"Download anyway"</strong>.
                    </p>
                    <p className="text-[11px] text-accent">
                      💡 <em>Alternative:</em> You can also tap <strong>"View 👁️"</strong> in the Clypra mobile web hub to view or stream photos and videos directly in your browser tab without downloading!
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-black/20 border border-white/5 space-y-1">
                    <p className="font-semibold text-text-primary text-[11px]">
                      iPhone / iPad Safari: "Do you want to download?"
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      Tap <strong>"Download"</strong> when Safari asks. Once downloaded, tap the blue arrow circle in the Safari URL bar to open the file or save it directly into your Photos app.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setActiveTab("send")}
                  className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors cursor-pointer shadow-md shadow-accent/20 flex items-center gap-1.5"
                >
                  <span>Go to Send / Receive</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Network Diagnostics Bar */}
        <div className="px-6 py-3 border-t border-white/8 bg-white/2 flex items-center justify-between text-xs text-text-muted shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="font-medium text-text-primary">
              LAN IP: {localIp || "Detecting…"}
            </span>
            {interfaces.length > 1 && (
              <span className="text-[10px] text-text-muted">
                ({interfaces.length} network cards available)
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Wifi className="w-3.5 h-3.5 text-accent" />
            <span>Port 53317 (LocalSend v2)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
