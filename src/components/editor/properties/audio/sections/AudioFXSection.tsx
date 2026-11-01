/**
 * AudioFXSection.tsx
 *
 * Exposes AudioFXConfig fields (EQ, noise suppression, compressor) that are
 * fully wired through the pipeline but had no UI surface.
 *
 * Uses PropertySectionHeader (same collapsible pattern as AudioSection),
 * SliderTrack + NumericControl, and the RotateCcw reset pattern.
 */

import React, { useCallback, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { Clip } from "@/types";
import type { AudioFXConfig } from "@/types/audio";
import { PropertySectionHeader } from "../../primitives/PropertySectionHeader";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";

interface AudioFXSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

const DEFAULT_FX: AudioFXConfig = {
  eq: { low: 0, mid: 0, high: 0 },
  noiseSuppression: 0,
};

export const AudioFXSection: React.FC<AudioFXSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const fx: AudioFXConfig = selectedClip.audioFX ?? DEFAULT_FX;

  const eqLow = fx.eq?.low ?? 0;
  const eqMid = fx.eq?.mid ?? 0;
  const eqHigh = fx.eq?.high ?? 0;
  const noiseSuppression = fx.noiseSuppression ?? 0;
  const compThreshold = fx.compressor?.threshold ?? -20;
  const compRatio = fx.compressor?.ratio ?? 2;

  const hasActiveFX =
    eqLow !== 0 ||
    eqMid !== 0 ||
    eqHigh !== 0 ||
    noiseSuppression > 0 ||
    fx.compressor !== undefined;

  // Start expanded when any FX is already active, collapsed otherwise
  const [isExpanded, setIsExpanded] = useState(hasActiveFX);

  const updateFX = useCallback(
    (patch: Partial<AudioFXConfig>) => {
      handleUpdate("audioFX", { ...fx, ...patch });
    },
    [fx, handleUpdate],
  );

  const updateEQ = useCallback(
    (band: "low" | "mid" | "high", value: number) => {
      updateFX({ eq: { low: eqLow, mid: eqMid, high: eqHigh, [band]: value } });
    },
    [updateFX, eqLow, eqMid, eqHigh],
  );

  const handleResetAll = useCallback(() => {
    handleUpdate("audioFX", DEFAULT_FX);
  }, [handleUpdate]);

  const resetEQ = useCallback(() => {
    updateFX({ eq: { low: 0, mid: 0, high: 0 } });
  }, [updateFX]);

  const resetNoise = useCallback(() => {
    updateFX({ noiseSuppression: 0 });
  }, [updateFX]);

  const resetCompressor = useCallback(() => {
    updateFX({ compressor: undefined });
  }, [updateFX]);

  // ── Shared row: label + slider + numeric (matches AudioSection spacing) ──
  const SliderRow = ({
    label,
    value,
    min,
    max,
    step,
    decimals,
    suffix,
    snapAtZero,
    onChange,
    onReset,
    propertyId,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    decimals: number;
    suffix: string;
    snapAtZero?: boolean;
    onChange: (v: number) => void;
    onReset?: () => void;
    propertyId: string;
  }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-white/90">{label}</label>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
            title={`Reset ${label}`}
            aria-label={`Reset ${label}`}
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
      <div className="flex items-center">
        <div className="relative flex-1 mr-4">
          <SliderTrack
            value={value}
            min={min}
            max={max}
            step={step}
            propertyId={propertyId}
            category="audio"
            snapPoints={
              snapAtZero ? [{ value: 0, threshold: step * 2 }] : undefined
            }
            onChange={onChange}
          />
          {/* Center tick for bipolar (±) sliders */}
          {snapAtZero && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-white/40 pointer-events-none"
              style={{ left: `${((0 - min) / (max - min)) * 100}%` }}
            />
          )}
        </div>
        <NumericControl
          value={value}
          onChange={onChange}
          step={step}
          min={min}
          max={max}
          suffix={suffix}
          inputWidth="w-8"
          inputPosition="text-right"
          decimals={decimals}
          ariaLabel={label}
          propertyId={propertyId}
          category="audio"
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-4 px-3 py-2">
      <PropertySectionHeader
        title="FX"
        isCollapsed={!isExpanded}
        onToggleCollapse={() => setIsExpanded((v) => !v)}
        onReset={hasActiveFX ? handleResetAll : undefined}
        resetTitle="Reset all FX"
        isKeyframe={hasActiveFX}
      />

      {isExpanded && (
        <>
          {/* Noise Suppression */}
          <SliderRow
            label="Noise suppression"
            value={Math.round(noiseSuppression * 100)}
            min={0}
            max={100}
            step={1}
            decimals={0}
            suffix="%"
            propertyId="noiseSuppression"
            onChange={(pct) => updateFX({ noiseSuppression: pct / 100 })}
            onReset={noiseSuppression !== 0 ? resetNoise : undefined}
          />

          {/* EQ */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-white/90">
                EQ
              </label>
              {(eqLow !== 0 || eqMid !== 0 || eqHigh !== 0) && (
                <button
                  type="button"
                  onClick={resetEQ}
                  className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
                  title="Reset EQ"
                  aria-label="Reset EQ"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
            <SliderRow
              label="Low"
              value={eqLow}
              min={-12}
              max={12}
              step={0.1}
              decimals={1}
              suffix="dB"
              snapAtZero
              propertyId="eqLow"
              onChange={(v) => updateEQ("low", v)}
            />
            <SliderRow
              label="Mid"
              value={eqMid}
              min={-12}
              max={12}
              step={0.1}
              decimals={1}
              suffix="dB"
              snapAtZero
              propertyId="eqMid"
              onChange={(v) => updateEQ("mid", v)}
            />
            <SliderRow
              label="High"
              value={eqHigh}
              min={-12}
              max={12}
              step={0.1}
              decimals={1}
              suffix="dB"
              snapAtZero
              propertyId="eqHigh"
              onChange={(v) => updateEQ("high", v)}
            />
          </div>

          {/* Compressor */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-white/90">
                Compressor
              </label>
              {fx.compressor && (
                <button
                  type="button"
                  onClick={resetCompressor}
                  className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
                  title="Reset compressor"
                  aria-label="Reset compressor"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
            <SliderRow
              label="Threshold"
              value={compThreshold}
              min={-60}
              max={0}
              step={0.5}
              decimals={1}
              suffix="dB"
              propertyId="compThreshold"
              onChange={(v) =>
                updateFX({ compressor: { threshold: v, ratio: compRatio } })
              }
            />
            <SliderRow
              label="Ratio"
              value={compRatio}
              min={1}
              max={20}
              step={0.1}
              decimals={1}
              suffix=":1"
              propertyId="compRatio"
              onChange={(v) =>
                updateFX({ compressor: { threshold: compThreshold, ratio: v } })
              }
            />
          </div>
        </>
      )}
    </div>
  );
};
