// src/components/inspector/InspectorPanel.tsx
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import * as PIXI from 'pixi.js';
import { useTimelineStore } from '../../store/timelineStore';
import { useUIStore } from '../../store/uiStore';
import { useEyedropper } from '../../core/hooks/useEyedropper';
import { defaultChromaKeyConfig, defaultColorGradeUniforms } from '../../types/compositor';

export interface InspectorPanelProps {
  pixiAppRef: React.RefObject<PIXI.Application | null>;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({ pixiAppRef }) => {
  const selectedClipId = useUIStore((state) => state.selectedClipIds[0] ?? null);
  const clip = useTimelineStore((state) => 
    selectedClipId ? state.clips.find((c) => c.id === selectedClipId) ?? null : null
  );

  const updateChroma = useTimelineStore((state) => state.updateClipChromaKey);
  const updateColor = useTimelineStore((state) => state.updateClipColorGrade);
  const { pickColor, isPicking } = useEyedropper(pixiAppRef);

  if (!clip || !selectedClipId) {
    return (
      <div className="w-80 bg-gray-900 text-gray-500 h-full p-4 flex items-center justify-center border-l border-gray-800 text-sm">
        Select a clip to inspect color & UltraKey settings.
      </div>
    );
  }

  const chromaKey = clip.chromaKey ?? defaultChromaKeyConfig;
  const colorGrade = clip.colorGrade ?? defaultColorGradeUniforms;

  // --- Handlers ---
  const handlePickKeyColor = async () => {
    const color = await pickColor();
    if (color && selectedClipId) {
      updateChroma(selectedClipId, { keyColor: color, enabled: true });
    }
  };

  const handleLoadLut = async () => {
    if (!selectedClipId) return;
    
    try {
      // Open OS File Dialog
      const file = await open({
        filters: [{ name: '3D LUT', extensions: ['cube'] }],
        multiple: false,
      });

      if (typeof file === 'string') {
        // Send file path to Rust backend to parse and upload to wgpu Texture3D
        const lutInfo = await invoke<{ id: string; title: string; size: number }>('load_lut_cube', { 
          lutId: `lut_${Date.now()}`, 
          filePath: file 
        });
        
        updateColor(selectedClipId, { 
          hasLut: 1, 
          lutId: lutInfo.id,
          lutSize: lutInfo.size 
        });
      }
    } catch (err) {
      console.error('Failed to load LUT:', err);
    }
  };

  return (
    <div className="w-80 bg-gray-900 text-gray-200 h-full overflow-y-auto border-l border-gray-800 flex flex-col select-none">
      
      {/* ── ULTRAKEY (CHROMA KEY) SECTION ── */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-300">UltraKey (Chroma Key)</h3>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={chromaKey.enabled}
              onChange={(e) => updateChroma(selectedClipId, { enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600" />
          </label>
        </div>

        <button 
          onClick={handlePickKeyColor}
          disabled={!chromaKey.enabled}
          className={`w-full py-2 px-4 rounded text-xs font-medium mb-4 flex items-center justify-center space-x-2 transition-colors border ${
            !chromaKey.enabled
              ? 'opacity-40 cursor-not-allowed bg-gray-800 border-gray-700'
              : isPicking 
                ? 'bg-blue-600 border-blue-500 animate-pulse text-white shadow-lg shadow-blue-500/20' 
                : 'bg-gray-800 hover:bg-gray-750 border-gray-700 hover:border-gray-600 text-gray-200'
          }`}
        >
          <span 
            className="w-3 h-3 rounded-full border border-white/40 shadow-inner" 
            style={{ 
              backgroundColor: `rgb(${Math.round(chromaKey.keyColor[0] * 255)}, ${Math.round(chromaKey.keyColor[1] * 255)}, ${Math.round(chromaKey.keyColor[2] * 255)})` 
            }} 
          />
          <span>{isPicking ? 'Click Preview Canvas to Sample...' : 'Eyedropper (Pick Key Color)'}</span>
        </button>

        <div className={chromaKey.enabled ? 'space-y-3' : 'space-y-3 opacity-40 pointer-events-none'}>
          <SliderControl 
            label="Tolerance" 
            value={chromaKey.tolerance} 
            min={0} max={1} step={0.01}
            onChange={(v) => updateChroma(selectedClipId, { tolerance: v })}
          />
          <SliderControl 
            label="Edge Softness" 
            value={chromaKey.smoothness} 
            min={0} max={1} step={0.01}
            onChange={(v) => updateChroma(selectedClipId, { smoothness: v })}
          />
          <SliderControl 
            label="Despill Cleanup" 
            value={chromaKey.despillAmount} 
            min={0} max={1} step={0.01}
            onChange={(v) => updateChroma(selectedClipId, { despillAmount: v })}
          />
          <SliderControl 
            label="Matte Pedestal" 
            value={chromaKey.mattePedestal} 
            min={0} max={0.5} step={0.01}
            onChange={(v) => updateChroma(selectedClipId, { mattePedestal: v })}
          />
          <SliderControl 
            label="Matte Highlight" 
            value={chromaKey.matteHighlight} 
            min={0.5} max={1.0} step={0.01}
            onChange={(v) => updateChroma(selectedClipId, { matteHighlight: v })}
          />
        </div>
      </div>

      {/* ── COLOR GRADING SECTION ── */}
      <div className="p-4">
        <div className="flex items-center space-x-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
          <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-300">Lumetri Color & 3D LUT</h3>
        </div>
        
        <div className="mb-4">
          <button 
            onClick={handleLoadLut}
            className="w-full bg-gray-800 hover:bg-gray-750 py-2 rounded text-xs text-left px-3 border border-gray-700 hover:border-gray-600 transition-colors flex items-center justify-between text-gray-200"
          >
            <span>{colorGrade.hasLut === 1 ? 'Change .cube LUT...' : 'Browse .cube LUT...'}</span>
            <span className="text-[10px] text-gray-500">.cube</span>
          </button>
          
          {colorGrade.hasLut === 1 && (
            <div className="mt-3">
              <SliderControl 
                label="LUT Intensity" 
                value={colorGrade.lutIntensity} 
                min={0} max={1} step={0.01}
                onChange={(v) => updateColor(selectedClipId, { lutIntensity: v })}
              />
            </div>
          )}
        </div>

        <div className="space-y-3">
          <SliderControl 
            label="Exposure (EV)" 
            value={colorGrade.exposure} 
            min={-3} max={3} step={0.1}
            onChange={(v) => updateColor(selectedClipId, { exposure: v })}
          />
          <SliderControl 
            label="Contrast" 
            value={colorGrade.contrast} 
            min={0} max={2} step={0.05}
            onChange={(v) => updateColor(selectedClipId, { contrast: v })}
          />
          <SliderControl 
            label="Saturation" 
            value={colorGrade.saturation} 
            min={0} max={2} step={0.05}
            onChange={(v) => updateColor(selectedClipId, { saturation: v })}
          />
          <SliderControl 
            label="Temperature" 
            value={colorGrade.temperature} 
            min={-1} max={1} step={0.05}
            onChange={(v) => updateColor(selectedClipId, { temperature: v })}
          />
          <SliderControl 
            label="Tint" 
            value={colorGrade.tint} 
            min={-1} max={1} step={0.05}
            onChange={(v) => updateColor(selectedClipId, { tint: v })}
          />
        </div>
      </div>

    </div>
  );
};

// --- Reusable Fast-Slider Component ---
interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function SliderControl({ label, value, min, max, step, onChange }: SliderControlProps) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-gray-400">
        <span>{label}</span>
        <span className="font-mono text-gray-300">{value.toFixed(2)}</span>
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        step={step} 
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 transition-opacity hover:opacity-100 opacity-90"
      />
    </div>
  );
}

export default InspectorPanel;
