/**
 * TextStyleSection.tsx
 *
 * Root section for text-clip property editing.
 *
 * Responsibilities kept here:
 * - Sub-tab switcher (Basic / Bubble)
 * - Sticky textarea via `TextContentEditor`
 * - Caption "apply to all" transaction logic
 * - Template-detach actions
 * - `handleCustomStyleUpdate` — clears styleId when overriding effect fields
 * - Resolving effective font/weight/spacing values from clip + active effect
 * - Composing the sub-components: TextBasicTab, TextBubbleTab,
 *   TextTemplateOverlay
 */

import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { AlertTriangle } from "lucide-react";
import { normalizeFontFamily } from "@/core/evaluation/evaluator";
import type { TextClip } from "@/types";
import { useTemplateStore } from "@/features/text-templates/templateStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { resolveTextClipStyleUpdate } from "@/lib/text/textClip";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { getBundledNativeFontIds } from "@/core/fonts/nativeFontRegistry";

import { CAPTION_STYLE_KEYS } from "../../data/textStyleData";
import { TextBasicTab } from "../tabs/TextBasicTab";
import { TextBubbleTab } from "../tabs/TextBubbleTab";
import { TextTemplateOverlay } from "./TextTemplateOverlay";

// Re-export shared font utilities so existing imports from this path keep
// working (TemplateLayerEditor, any external consumers).
export {
  FONT_PICKER_OPTIONS,
  resolveFontPickerValue,
  SYSTEM_FONTS,
  GOOGLE_FONTS,
  COLOR_PALETTE,
  SOLID_COLOR_SWATCHES,
  FONT_WEIGHTS,
} from "../../data/fontData";

// ---------------------------------------------------------------------------
// TextContentEditor
// ---------------------------------------------------------------------------

interface TextContentEditorProps {
  value: string;
  onChange: (value: string) => void;
  mode: "plain" | "effect";
}

/**
 * Keep text entry responsive while the timeline and preview catch up at RAF
 * cadence. The timeline remains authoritative outside the focused editor,
 * but React store renders must not replace a newer DOM input value while the
 * user is typing.
 */
const TextContentEditor = React.memo<TextContentEditorProps>(
  ({ value, onChange, mode }) => {
    const [draft, setDraft] = useState(value);
    const focusedRef = useRef(false);

    useEffect(() => {
      if (!focusedRef.current || value === draft) {
        setDraft(value);
      }
    }, [value, draft]);

    return (
      <textarea
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (draft !== value) onChange(draft);
        }}
        onChange={(e) => {
          const nextValue = e.target.value;
          setDraft(nextValue);
          onChange(nextValue);
        }}
        rows={3}
        placeholder="Enter text..."
        aria-label={`${mode === "effect" ? "Effect" : "Plain"} text content`}
        className="w-full bg-[#161618] border border-[#2a2a2e] rounded-lg p-3 text-xs text-white placeholder-text-muted/40 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20 resize-none font-sans min-h-[84px] transition-colors"
      />
    );
  },
);

// ---------------------------------------------------------------------------
// TextStyleSectionProps
// ---------------------------------------------------------------------------

interface TextStyleSectionProps {
  textClip: TextClip;
  presets: any[];
  newPresetName: string;
  setNewPresetName: (name: string) => void;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  /** Immediate command path used when applying a caption style transaction. */
  handleUpdateImmediate?: (key: string, value: any) => void;
  handleUpdateMultipleImmediate?: (fields: Record<string, any>) => void;
  handleApplyPreset: (preset: any) => void;
  savePreset: (name: string, style: any) => void;
  deletePreset: (id: string) => void;
}

// ---------------------------------------------------------------------------
// TextStyleSection
// ---------------------------------------------------------------------------

export const TextStyleSection: React.FC<TextStyleSectionProps> = ({
  textClip,
  presets,
  newPresetName,
  setNewPresetName,
  handleUpdate: originalHandleUpdate,
  handleUpdateMultiple: originalHandleUpdateMultiple,
  handleUpdateImmediate,
  handleUpdateMultipleImmediate,
  handleApplyPreset,
  savePreset,
  deletePreset,
}) => {
  const [textSubTab, setTextSubTab] = useState<"basic" | "bubble">("basic");
  const [applyToAll, setApplyToAll] = useState(false);

  // Collapsible section state for the basic tab
  const [alignExpanded, setAlignExpanded] = useState(false);
  const [strokeExpanded, setStrokeExpanded] = useState(false);
  const [shadowExpanded, setShadowExpanded] = useState(false);
  const [backgroundExpanded, setBackgroundExpanded] = useState(false);

  const { templates } = useTemplateStore();
  const { definitions } = useEffectsStore();

  const templateDef =
    templates.find((t) => t.id === textClip.templateId) ??
    (textClip.templateDefinition as any) ??
    (textClip.templateSnapshot as any);
  const innerTemplate = templateDef
    ? templateDef.templateData || templateDef.lottieData || templateDef
    : ((textClip.templateSnapshot as any) ??
      (textClip.templateDefinition as any) ??
      null);

  useEffect(() => {
    if (
      textClip.templateId &&
      templateDef &&
      !templateDef.templateData &&
      !templateDef.lottieData
    ) {
      useTemplateStore.getState().selectTemplate(templateDef);
    }
  }, [textClip.templateId, templateDef]);

  const effectFont = textClip.styleId
    ? definitions[textClip.styleId]?.font
    : undefined;

  const mode = textClip.templateId
    ? "template"
    : textClip.styleId
      ? "effect"
      : "plain";

  // ── Native font availability ─────────────────────────────────────────────
  const nativeDesktop = isTauriRuntime();
  const nativeFontIds = useMemo(
    () => new Set(getBundledNativeFontIds().map((id) => id.toLowerCase())),
    [],
  );
  const requestedFont =
    textClip.fontFamily || effectFont?.family || "Inter Variable";
  const resolvedFont = normalizeFontFamily(requestedFont);

  // ── Effective style values (clip overrides effect font defaults) ──────────
  const effectiveFontWeight = textClip.fontWeight ?? effectFont?.weight;
  const parsedWeight =
    typeof effectiveFontWeight === "number"
      ? effectiveFontWeight
      : Number(effectiveFontWeight);
  const currentWeight = Number.isFinite(parsedWeight)
    ? Math.min(900, Math.max(100, parsedWeight))
    : effectiveFontWeight === "bold"
      ? 700
      : 400;
  const effectiveFontStyle =
    textClip.fontStyle || effectFont?.style || "normal";
  const effectiveLetterSpacing =
    textClip.letterSpacing ?? effectFont?.letterSpacing ?? 0;
  const effectiveLineHeight =
    textClip.lineHeight ?? effectFont?.lineHeight ?? 1.2;

  // ── Text canvas budget check ──────────────────────────────────────────────
  const isTextExceedingMaxDimension = useMemo(() => {
    const text = textClip.text || "";
    if (!text) return false;
    const fontSize = textClip.fontSize || 32;
    const letterSpacing = textClip.letterSpacing || 0;
    const lines = text.split("\n");
    const maxLineChars = Math.max(...lines.map((l) => l.length), 0);
    const estimatedMaxLinePx = maxLineChars * (fontSize * 0.7 + letterSpacing);
    return estimatedMaxLinePx > 8192;
  }, [textClip.text, textClip.fontSize, textClip.letterSpacing]);

  // ── Caption apply-to-all transaction helpers ─────────────────────────────
  function executeCaptionStyleUpdate(
    clip: TextClip,
    updates: Record<string, any>,
  ): void {
    const project = useProjectStore.getState().project;
    const resolvedUpdates = resolveTextClipStyleUpdate(
      clip,
      updates,
      project?.canvasWidth ?? 1920,
      project?.canvasHeight ?? 1080,
    );
    const oldProperties = Object.fromEntries(
      Object.keys(resolvedUpdates).map((key) => [key, (clip as any)[key]]),
    );
    useHistoryStore
      .getState()
      .execute(
        new TransformClipCommand(clip.id, oldProperties, resolvedUpdates),
      );
  }

  const handleUpdate = (key: string, value: any) => {
    if (
      applyToAll &&
      textClip.textRole === "caption" &&
      CAPTION_STYLE_KEYS.includes(key)
    ) {
      const { clips } = useTimelineStore.getState();
      const trackCaptions = clips.filter(
        (c) =>
          c.trackId === textClip.trackId && (c as any).textRole === "caption",
      );
      const history = useHistoryStore.getState();
      history.beginTransaction("Apply Caption Style to All");
      try {
        (handleUpdateImmediate ?? originalHandleUpdate)(key, value);
        trackCaptions.forEach((c) => {
          if (c.id !== textClip.id)
            executeCaptionStyleUpdate(c as TextClip, { [key]: value });
        });
        history.commitTransaction();
      } catch (error) {
        history.rollbackTransaction();
        throw error;
      }
    } else {
      originalHandleUpdate(key, value);
    }
  };

  const handleUpdateMultiple = (fields: Record<string, any>) => {
    const hasStyleField = Object.keys(fields).some((k) =>
      CAPTION_STYLE_KEYS.includes(k),
    );
    if (applyToAll && textClip.textRole === "caption" && hasStyleField) {
      const { clips } = useTimelineStore.getState();
      const trackCaptions = clips.filter(
        (c) =>
          c.trackId === textClip.trackId && (c as any).textRole === "caption",
      );
      const styleFields: Record<string, any> = {};
      Object.entries(fields).forEach(([k, v]) => {
        if (CAPTION_STYLE_KEYS.includes(k)) styleFields[k] = v;
      });
      const history = useHistoryStore.getState();
      history.beginTransaction("Apply Caption Style to All");
      try {
        (handleUpdateMultipleImmediate ?? originalHandleUpdateMultiple)(fields);
        trackCaptions.forEach((c) => {
          if (c.id !== textClip.id)
            executeCaptionStyleUpdate(c as TextClip, styleFields);
        });
        history.commitTransaction();
      } catch (error) {
        history.rollbackTransaction();
        throw error;
      }
    } else {
      originalHandleUpdateMultiple(fields);
    }
  };

  // ── Effect / template detach ──────────────────────────────────────────────
  const handleDetachTemplate = () => {
    handleUpdateMultiple({
      templateId: undefined,
      styleId: undefined,
      styleDefinition: undefined,
      customization: undefined,
      text: textClip.text || "",
    });
  };

  // ── handleCustomStyleUpdate — detaches effect when overriding visual fields ─
  const EFFECT_DETACH_KEYS = new Set(["stroke", "shadow", "background"]);
  const handleCustomStyleUpdate = (key: string, value: any) => {
    const updates: Record<string, any> = { [key]: value };
    if (textClip.styleId && key !== "styleId" && EFFECT_DETACH_KEYS.has(key)) {
      updates.styleId = undefined;
      updates.styleDefinition = undefined;
    }
    handleUpdateMultiple(updates);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-1.5 select-none text-white relative p-2 pt-0">
      {/* Sticky header: sub-tab switcher + textarea */}
      <div className="bg-(--color-gray-900) pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
          {(["basic", "bubble"] as const).map((tab) => {
            const isLocked = tab === "bubble";
            return (
              <button
                key={tab}
                type="button"
                onClick={() => !isLocked && setTextSubTab(tab)}
                disabled={isLocked}
                title={isLocked ? "Coming soon" : undefined}
                className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center capitalize flex items-center justify-center gap-1 ${
                  isLocked
                    ? "text-[#8e8e93]/50 cursor-not-allowed"
                    : textSubTab === tab
                      ? "bg-[#38383e] text-white shadow-sm font-semibold cursor-pointer"
                      : "text-[#8e8e93] hover:text-white cursor-pointer"
                }`}
              >
                {tab}
                {isLocked && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-2.5 h-2.5 shrink-0"
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        <TextContentEditor
          key={`${textClip.id}-content`}
          value={textClip.text || ""}
          onChange={(value) => handleUpdate("text", value)}
          mode={mode === "effect" ? "effect" : "plain"}
        />

        {isTextExceedingMaxDimension && (
          <div className="mt-1 flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-tight">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Text exceeds 8192px canvas budget and was clamped.</span>
          </div>
        )}
      </div>

      {/* Basic tab */}
      {textSubTab === "basic" && mode !== "template" && (
        <TextBasicTab
          textClip={textClip}
          newPresetName={newPresetName}
          currentWeight={currentWeight}
          effectiveFontStyle={effectiveFontStyle}
          effectiveLetterSpacing={effectiveLetterSpacing}
          effectiveLineHeight={effectiveLineHeight}
          applyToAll={applyToAll}
          setApplyToAll={setApplyToAll}
          alignExpanded={alignExpanded}
          setAlignExpanded={setAlignExpanded}
          strokeExpanded={strokeExpanded}
          setStrokeExpanded={setStrokeExpanded}
          shadowExpanded={shadowExpanded}
          setShadowExpanded={setShadowExpanded}
          backgroundExpanded={backgroundExpanded}
          setBackgroundExpanded={setBackgroundExpanded}
          handleUpdate={handleUpdate}
          handleCustomStyleUpdate={handleCustomStyleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          savePreset={savePreset}
        />
      )}

      {/* Bubble tab */}
      {textSubTab === "bubble" && (
        <TextBubbleTab
          textClip={textClip}
          handleCustomStyleUpdate={handleCustomStyleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
        />
      )}

      {/* Template overlay (supersedes basic tab when a template is active) */}
      {mode === "template" && (
        <TextTemplateOverlay
          textClip={textClip}
          templateDef={templateDef}
          innerTemplate={innerTemplate}
          onDetach={handleDetachTemplate}
          handleUpdateMultiple={handleUpdateMultiple}
        />
      )}
    </div>
  );
};
