/**
 * TransferPanel
 *
 * Phone ↔ Laptop file transfer UI, built on top of the native Rust
 * LocalSend-compatible server. Surfaces on the LaunchScreen as a
 * full-screen overlay.
 *
 * Flow:
 *   1. User opens Transfer Panel → server starts, QR code + URL shown
 *   2. Phone user either opens LocalSend app (discovers Clypra on LAN)
 *      or visits http://<ip>:53317 in browser
 *   3. Incoming transfer fires clypra://transfer-incoming → consent dialog
 *   4. User accepts → file streams in → progress bar → complete
 *   5. "Add to Project" imports files into the current/new project
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
  Copy,
  Check as CheckIcon,
  AlertTriangle,
  Download,
} from "lucide-react";
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

interface IncomingFile {
  id: string;
  file_name: string;
  size: number;
  file_type: string;
}

interface TransferSession {
  session_id: string;
  sender_alias: string;
  sender_ip: string;
  state:
    | "Pending"
    | "Accepted"
    | "Rejected"
    | "InProgress"
    | "Complete"
    | "Cancelled";
  files: IncomingFile[];
  received_files: string[];
  bytes_received: number;
  total_bytes: number;
}

interface ConsentRequest {
  session_id: string;
  sender_alias: string;
  files: { name: string; size: number }[];
}

interface ProgressEvent {
  session_id: string;
  file_id: string;
  bytes_received: number;
  total_bytes: number;
}

interface CompleteEvent {
  session_id: string;
  file_paths: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── QR Code rendering (pure CSS/SVG fallback via URL display) ─────────────────

function QRDisplay({ url }: { url: string }) {
  // We show the URL prominently for manual entry; a proper QR would require
  // a JS library. For now, use a placeholder SVG frame with the URL below it.
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="w-36 h-36 bg-white rounded-xl flex items-center justify-center relative overflow-hidden"
        style={{ padding: "8px" }}
      >
        {/* Simplified QR visual hint */}
        <div className="absolute inset-2 grid grid-cols-7 gap-0.5">
          {Array.from({ length: 49 }).map((_, i) => {
            // Corner squares pattern
            const row = Math.floor(i / 7);
            const col = i % 7;
            const isCorner =
              (row < 3 && col < 3) ||
              (row < 3 && col >= 4) ||
              (row >= 4 && col < 3);
            const isRandom =
              Math.sin(i * 7 + url.charCodeAt(i % url.length)) > 0;
            return (
              <div
                key={i}
                className={`rounded-[1px] ${isCorner || isRandom ? "bg-black" : "bg-transparent"}`}
              />
            );
          })}
        </div>
        {/* Center Clypra dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 bg-white rounded-sm flex items-center justify-center">
            <div className="w-4 h-4 bg-black rounded-sm" />
          </div>
        </div>
      </div>
      <p className="text-[11px] text-text-muted text-center">
        Scan with LocalSend app or open in browser
      </p>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TransferPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with paths of received files when user clicks "Add to Project" */
  onImportFiles: (filePaths: string[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TransferPanel: React.FC<TransferPanelProps> = ({
  isOpen,
  onClose,
  onImportFiles,
}) => {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [consentRequest, setConsentRequest] = useState<ConsentRequest | null>(
    null,
  );
  const [sessions, setSessions] = useState<TransferSession[]>([]);
  const [progress, setProgress] = useState<
    Record<string, { received: number; total: number }>
  >({});
  const [copiedUrl, setCopiedUrl] = useState(false);

  const unlistenRefs = useRef<Array<() => void>>([]);

  // ── Server lifecycle ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !isTauri) return;

    const startServer = async () => {
      try {
        await invokeTransfer("start_transfer_service");
        const status = await invokeTransfer<{
          running: boolean;
          port: number;
          local_ip: string;
        }>("get_transfer_service_status");
        setServerRunning(status.running);
        setServerError(null);
        const url = await invokeTransfer<string>("get_transfer_server_url");
        setServerUrl(url);
      } catch (err: any) {
        setServerError(err?.message || String(err));
      }
    };

    startServer();
  }, [isOpen]);

  // ── Event listeners ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !isTauri) return;

    const setup = async () => {
      const unlisten1 = await listenEvent(
        "clypra://transfer-incoming",
        (payload: ConsentRequest) => {
          setConsentRequest(payload);
        },
      );

      const unlisten2 = await listenEvent(
        "clypra://transfer-progress",
        (payload: ProgressEvent) => {
          setProgress((prev) => ({
            ...prev,
            [payload.session_id]: {
              received: payload.bytes_received,
              total: payload.total_bytes,
            },
          }));
        },
      );

      const unlisten3 = await listenEvent(
        "clypra://transfer-complete",
        (payload: CompleteEvent) => {
          setSessions((prev) =>
            prev.map((s) =>
              s.session_id === payload.session_id
                ? {
                    ...s,
                    state: "Complete",
                    received_files: payload.file_paths,
                  }
                : s,
            ),
          );
        },
      );

      const unlisten4 = await listenEvent(
        "clypra://transfer-cancelled",
        (payload: { session_id: string }) => {
          setSessions((prev) =>
            prev.map((s) =>
              s.session_id === payload.session_id
                ? { ...s, state: "Cancelled" }
                : s,
            ),
          );
        },
      );

      unlistenRefs.current = [unlisten1, unlisten2, unlisten3, unlisten4];
    };

    setup();
    return () => {
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, [isOpen]);

  // ── Consent actions ─────────────────────────────────────────────────────────

  const handleAccept = useCallback(async (req: ConsentRequest) => {
    try {
      await invokeTransfer("accept_transfer_session", {
        sessionId: req.session_id,
      });
      setConsentRequest(null);
      // Optimistically add session to list
      setSessions((prev) => [
        ...prev,
        {
          session_id: req.session_id,
          sender_alias: req.sender_alias,
          sender_ip: "",
          state: "Accepted",
          files: req.files.map((f, i) => ({
            id: String(i),
            file_name: f.name,
            size: f.size,
            file_type: "video/*",
          })),
          received_files: [],
          bytes_received: 0,
          total_bytes: req.files.reduce((acc, f) => acc + f.size, 0),
        },
      ]);
    } catch (err: any) {
      console.error("[TransferPanel] Accept failed:", err);
    }
  }, []);

  const handleReject = useCallback(async (req: ConsentRequest) => {
    try {
      await invokeTransfer("reject_transfer_session", {
        sessionId: req.session_id,
      });
    } catch {}
    setConsentRequest(null);
  }, []);

  const handleCopyUrl = useCallback(async () => {
    if (!serverUrl) return;
    await navigator.clipboard.writeText(serverUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }, [serverUrl]);

  const handleImport = useCallback(
    (session: TransferSession) => {
      if (session.received_files.length > 0) {
        onImportFiles(session.received_files);
      }
    },
    [onImportFiles],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl">
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          background: "var(--clypra-surface-panel)",
          border:
            "1px solid color-mix(in srgb, var(--clypra-text-primary) 10%, transparent)",
          maxHeight: "85vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/6 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-text-primary">
                Receive from Phone
              </h2>
              <p className="text-[11px] text-text-muted">
                Local network · no internet needed
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Server status / setup section */}
          <div className="px-5 py-4 border-b border-white/6">
            {!isTauri ? (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                Transfer is only available in the Tauri desktop app.
              </div>
            ) : serverError ? (
              <div className="flex items-start gap-2 text-sm text-red-400">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{serverError}</span>
              </div>
            ) : !serverRunning ? (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting transfer server…
              </div>
            ) : (
              <div className="flex gap-5 items-start">
                {serverUrl && <QRDisplay url={serverUrl} />}
                <div className="flex-1 flex flex-col gap-3 pt-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-xs font-semibold text-green-400">
                      Server active
                    </span>
                  </div>
                  <div>
                    <p className="text-[11px] text-text-muted mb-1.5">
                      Open this URL on your phone:
                    </p>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg border border-white/8">
                      <Wifi className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      <span className="text-xs font-mono text-text-primary flex-1 truncate">
                        {serverUrl}
                      </span>
                      <button
                        onClick={handleCopyUrl}
                        className="shrink-0 text-text-muted hover:text-text-primary cursor-pointer transition-colors"
                        title="Copy URL"
                      >
                        {copiedUrl ? (
                          <CheckIcon className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    Or use the{" "}
                    <span className="text-text-primary font-semibold">
                      LocalSend
                    </span>{" "}
                    app on your phone — it will discover Clypra automatically.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Incoming consent dialog */}
          {consentRequest && (
            <div className="mx-4 my-4 rounded-xl border border-accent/30 bg-accent/5 p-4 shadow-lg">
              <div className="flex items-start gap-3 mb-3">
                <Download className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-text-primary">
                    <span className="text-accent">
                      {consentRequest.sender_alias}
                    </span>{" "}
                    wants to send {consentRequest.files.length} file
                    {consentRequest.files.length !== 1 ? "s" : ""}
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {consentRequest.files.slice(0, 3).map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-xs text-text-muted truncate">
                          {f.name}
                        </span>
                        <span className="text-[11px] text-text-muted/60 shrink-0">
                          {formatBytes(f.size)}
                        </span>
                      </div>
                    ))}
                    {consentRequest.files.length > 3 && (
                      <p className="text-[11px] text-text-muted/60">
                        +{consentRequest.files.length - 3} more…
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleReject(consentRequest)}
                  className="flex-1 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-text-muted hover:bg-white/10 hover:text-text-primary transition-colors cursor-pointer font-semibold"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleAccept(consentRequest)}
                  className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors cursor-pointer shadow-md shadow-accent/20"
                >
                  Accept
                </button>
              </div>
            </div>
          )}

          {/* Active and completed sessions */}
          {sessions.length > 0 && (
            <div className="px-4 py-3 space-y-3">
              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Transfers
              </p>
              {sessions.map((session) => {
                const prog = progress[session.session_id];
                const pct =
                  prog && prog.total > 0
                    ? Math.round((prog.received / prog.total) * 100)
                    : session.state === "Complete"
                      ? 100
                      : 0;

                return (
                  <div
                    key={session.session_id}
                    className="rounded-xl border border-white/6 bg-bg p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileVideo className="w-4 h-4 text-text-muted shrink-0" />
                        <span className="text-sm font-semibold text-text-primary truncate">
                          {session.sender_alias}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          · {session.files.length} file
                          {session.files.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="shrink-0">
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

                    {/* Progress bar */}
                    {(session.state === "InProgress" ||
                      session.state === "Accepted" ||
                      session.state === "Complete") && (
                      <div className="space-y-1">
                        <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full transition-[width] duration-200"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-text-muted">
                          <span>
                            {prog ? formatBytes(prog.received) : "0 B"} /{" "}
                            {prog
                              ? formatBytes(prog.total)
                              : formatBytes(session.total_bytes)}
                          </span>
                          <span>{pct}%</span>
                        </div>
                      </div>
                    )}

                    {/* Complete action */}
                    {session.state === "Complete" &&
                      session.received_files.length > 0 && (
                        <button
                          onClick={() => handleImport(session)}
                          className="w-full py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-semibold hover:bg-accent/20 transition-colors cursor-pointer"
                        >
                          Add to Project
                        </button>
                      )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state when no sessions yet */}
          {sessions.length === 0 && !consentRequest && serverRunning && (
            <div className="px-5 py-8 flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-surface-raised border border-white/6 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-text-muted/40" />
              </div>
              <p className="text-sm text-text-muted">
                Waiting for incoming transfer…
              </p>
              <p className="text-xs text-text-muted/50">
                Phone and laptop must be on the same WiFi network.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
