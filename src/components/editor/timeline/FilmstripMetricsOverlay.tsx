import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getFrontendMetricsSnapshot } from "@/lib/renderEngine/filmstripMetrics";
import { X, Activity, RefreshCw } from "lucide-react";

interface BackendTierSummary {
  operations: number;
  seek_avg_ms: number;
  decode_avg_ms: number;
  convert_avg_ms: number;
  convert_fast_hits: number;
  convert_slow_hits: number;
  downsample_avg_ms: number;
  serialize_avg_ms: number;
  tier_cache_hits: number;
  decodes: number;
  evictions: number;
  hit_rate_pct: number;
}

interface BackendMetricsSnapshot {
  l0: BackendTierSummary;
  l1: BackendTierSummary;
  l2: BackendTierSummary;
  l3: BackendTierSummary;
  timestamp_epoch_ms: number;
}

export const FilmstripMetricsOverlay: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [frontendData, setFrontendData] = useState<Record<string, any>>({});
  const [backendData, setBackendData] = useState<BackendMetricsSnapshot | null>(null);

  // Keyboard shortcut: Cmd+Shift+M / Ctrl+Shift+M
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Polling loop when open
  useEffect(() => {
    if (!isOpen) return;

    const poll = async () => {
      setFrontendData(getFrontendMetricsSnapshot());
      try {
        const snap = await invoke<BackendMetricsSnapshot>("get_decode_metrics_snapshot");
        setBackendData(snap);
      } catch (err) {
        // In web-mock mode or error
      }
    };

    poll();
    const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const tiers = [
    { key: "l0", label: "L0 (160×90)", feKey: "L0" },
    { key: "l1", label: "L1 (240×135)", feKey: "L1" },
    { key: "l2", label: "L2 (320×180)", feKey: "L2" },
    { key: "l3", label: "L3 (480×270)", feKey: "L3" },
  ];

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[720px] max-w-[95vw] rounded-xl border border-white/10 bg-black/85 p-4 shadow-2xl backdrop-blur-xl text-xs text-neutral-200 font-mono">
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
        <div className="flex items-center gap-2 font-semibold text-white">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span>Filmstrip Pipeline Telemetry (Cmd+Shift+M)</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Frontend Section */}
        <div className="rounded-lg bg-white/5 p-3 border border-white/5">
          <div className="text-emerald-400 font-semibold mb-2 flex items-center gap-1.5">
            <span>🌐 Frontend Transport & Paint</span>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 text-neutral-400 text-[10px]">
                <th className="pb-1">Tier</th>
                <th className="pb-1">Reqs</th>
                <th className="pb-1">1st Art(ms)</th>
                <th className="pb-1">Cache(ms)</th>
                <th className="pb-1">Paint(ms)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tiers.map(({ label, feKey }) => {
                const s = frontendData[feKey] || {};
                return (
                  <tr key={feKey} className="hover:bg-white/5">
                    <td className="py-1 font-medium text-white">{label.split(" ")[0]}</td>
                    <td className="py-1">{s.requests ?? 0}</td>
                    <td className="py-1">{s.dispatchToFirstMs ?? 0}</td>
                    <td className="py-1">{s.cacheApplyMs ?? 0}</td>
                    <td className="py-1">{s.paintCommitMs ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Backend Section */}
        <div className="rounded-lg bg-white/5 p-3 border border-white/5">
          <div className="text-amber-400 font-semibold mb-2 flex items-center gap-1.5">
            <span>🦀 Rust Decode & Downsample</span>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 text-neutral-400 text-[10px]">
                <th className="pb-1">Tier</th>
                <th className="pb-1">Seek</th>
                <th className="pb-1">Decode</th>
                <th className="pb-1">Downsample</th>
                <th className="pb-1">Hit%</th>
                <th className="pb-1">Evict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tiers.map(({ key, label }) => {
                const b: BackendTierSummary | undefined = backendData ? (backendData as any)[key] : undefined;
                return (
                  <tr key={key} className="hover:bg-white/5">
                    <td className="py-1 font-medium text-white">{label.split(" ")[0]}</td>
                    <td className="py-1">{b ? b.seek_avg_ms.toFixed(1) : "-"}ms</td>
                    <td className="py-1">{b ? b.decode_avg_ms.toFixed(1) : "-"}ms</td>
                    <td className="py-1">{b ? b.downsample_avg_ms.toFixed(1) : "-"}ms</td>
                    <td className="py-1">{b ? `${b.hit_rate_pct.toFixed(0)}%` : "-"}</td>
                    <td className="py-1">{b ? b.evictions : 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[10px] text-neutral-400 border-t border-white/10 pt-2">
        <span>Press <kbd className="rounded bg-white/10 px-1 py-0.5 text-white">Cmd+Shift+M</kbd> to toggle</span>
        <span className="text-emerald-400">Live 1s Polling Active</span>
      </div>
    </div>
  );
};
