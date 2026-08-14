// src/components/editor/properties/ChromaKeySection.tsx
import React from 'react';
import { Pipette, Sparkles } from 'lucide-react';
import type { Clip } from '@/types';
import { useTimelineStore } from '@/store/timelineStore';
import { useEyedropper } from '@/core/hooks/useEyedropper';
import { defaultChromaKeyConfig } from '@/types/compositor';
import { PropertySection } from './primitives/PropertySection';
import { PropertySlider } from './primitives/PropertySlider';

interface ChromaKeySectionProps {
  selectedClip: Clip;
  pixiAppRef?: React.RefObject<any>;
}

export const ChromaKeySection: React.FC<ChromaKeySectionProps> = ({
  selectedClip,
  pixiAppRef,
}) => {
  const updateClipChromaKey = useTimelineStore((state) => state.updateClipChromaKey);
  const { pickColor, isPicking } = useEyedropper(pixiAppRef ?? { current: null });

  const chromaKey = selectedClip.chromaKey ?? defaultChromaKeyConfig;

  const handleToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateClipChromaKey(selectedClip.id, { enabled: e.target.checked });
  };

  const handlePickColor = async () => {
    const color = await pickColor();
    if (color) {
      updateClipChromaKey(selectedClip.id, { keyColor: color, enabled: true });
    }
  };

  const [r, g, b] = chromaKey.keyColor;
  const colorRgbStr = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

  const headerAction = (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={chromaKey.enabled}
        onChange={handleToggle}
        className="sr-only peer"
      />
      <div className="w-7 h-3.5 bg-surface-raised border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-accent" />
    </label>
  );

  return (
    <PropertySection
      title="UltraKey (Chroma Key)"
      icon={<Sparkles className="w-3.5 h-3.5" />}
      defaultCollapsed={!chromaKey.enabled}
      action={headerAction}
    >
      <div className="space-y-3 pt-1">
        {/* Color picker / Eyedropper row */}
        <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface/60 border border-white/5">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-md border border-white/20 shadow-xs shrink-0"
              style={{ backgroundColor: colorRgbStr }}
            />
            <span className="text-[11px] font-mono text-text-secondary">
              {colorRgbStr}
            </span>
          </div>

          <button
            type="button"
            onClick={handlePickColor}
            disabled={!chromaKey.enabled}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer ${
              !chromaKey.enabled
                ? 'opacity-40 cursor-not-allowed bg-surface-raised border-white/5 text-text-muted'
                : isPicking
                ? 'bg-accent border-accent text-white animate-pulse shadow-xs shadow-accent/30'
                : 'bg-surface-raised hover:bg-white/10 border-white/10 text-text-secondary hover:text-text-primary'
            }`}
          >
            <Pipette className="w-3 h-3" />
            <span>{isPicking ? 'Click Canvas...' : 'Eyedropper'}</span>
          </button>
        </div>

        {/* Sliders */}
        <div className={chromaKey.enabled ? 'space-y-2.5' : 'space-y-2.5 opacity-40 pointer-events-none'}>
          <PropertySlider
            label="Tolerance"
            value={Math.round(chromaKey.tolerance * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => updateClipChromaKey(selectedClip.id, { tolerance: v / 100 })}
          />

          <PropertySlider
            label="Edge Softness"
            value={Math.round(chromaKey.smoothness * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => updateClipChromaKey(selectedClip.id, { smoothness: v / 100 })}
          />

          <PropertySlider
            label="Despill Cleanup"
            value={Math.round(chromaKey.despillAmount * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => updateClipChromaKey(selectedClip.id, { despillAmount: v / 100 })}
          />

          <PropertySlider
            label="Matte Pedestal"
            value={Math.round(chromaKey.mattePedestal * 100)}
            min={0}
            max={50}
            step={1}
            suffix="%"
            onChange={(v) => updateClipChromaKey(selectedClip.id, { mattePedestal: v / 100 })}
          />

          <PropertySlider
            label="Matte Highlight"
            value={Math.round(chromaKey.matteHighlight * 100)}
            min={50}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => updateClipChromaKey(selectedClip.id, { matteHighlight: v / 100 })}
          />
        </div>
      </div>
    </PropertySection>
  );
};
