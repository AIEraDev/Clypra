/**
 * TextTemplateOverlay.tsx
 *
 * The template-mode overlay rendered inside TextStyleSection when a text
 * clip has an active templateId. Shows the TemplateLayerEditor and a
 * "Detach Template" escape hatch.
 */

import React from "react";
import { resolveTextTemplateArtifact } from "@clypra-studio/engine";
import type { TextClip } from "@/types";
import { TemplateLayerEditor } from "./TemplateLayerEditor";

interface TextTemplateOverlayProps {
  textClip: TextClip;
  templateDef: any;
  innerTemplate: any;
  onDetach: () => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
}

export const TextTemplateOverlay: React.FC<TextTemplateOverlayProps> = ({
  textClip,
  templateDef,
  innerTemplate,
  onDetach,
  handleUpdateMultiple,
}) => {
  const customization = textClip.customization || {
    primaryText: textClip.text || "",
    secondaryText: "",
    accentText: "",
    primaryColor: "#ffffff",
    secondaryColor: "#ffffff",
    layerColors: {},
    layerTexts: {},
    layerFontSizes: {},
    layerFontWeights: {},
  };

  return (
    <div className="space-y-3 p-3 bg-surface-raised/20 border border-border/40 rounded-xl">
      {templateDef ? (
        <>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">
              Active Template: {templateDef.label || templateDef.name}
            </span>
            <button
              onClick={onDetach}
              className="text-[9px] font-semibold text-red-400 hover:text-red-300 transition-colors cursor-pointer"
            >
              Detach Template
            </button>
          </div>
          <TemplateLayerEditor
            template={innerTemplate!}
            customization={customization}
            onChange={(nextCust) => {
              const resolvedArtifact = resolveTextTemplateArtifact(innerTemplate);
              const firstNodeId =
                resolvedArtifact?.document?.nodes?.find((n: any) => n.type === "text")?.id ||
                innerTemplate?.layers?.find((l: any) => l.kind === "text")?.id ||
                "";
              const primaryTextVal =
                nextCust.layerTexts?.[firstNodeId] ?? nextCust.primaryText ?? textClip.text;
              const primaryFontVal =
                nextCust.layerFontFamilies?.[firstNodeId] ?? nextCust.primaryFontFamily ?? textClip.fontFamily;
              const primaryColorVal =
                nextCust.layerColors?.[firstNodeId] ?? nextCust.primaryColor ?? textClip.color;

              const existingControlValues = textClip.templateControlValues || {};
              const nextControlValues: Record<string, unknown> = { ...existingControlValues };

              if (nextCust.layerTexts) {
                for (const [nodeId, txt] of Object.entries(nextCust.layerTexts)) {
                  nextControlValues[`text-${nodeId}`] = txt;
                }
              }
              if (nextCust.layerFontFamilies) {
                for (const [nodeId, font] of Object.entries(nextCust.layerFontFamilies)) {
                  nextControlValues[`font-${nodeId}`] = font;
                }
              }
              if (nextCust.layerColors) {
                for (const [nodeId, col] of Object.entries(nextCust.layerColors)) {
                  nextControlValues[`color-${nodeId}`] = col;
                }
              }

              handleUpdateMultiple({
                customization: nextCust,
                templateControlValues: nextControlValues,
                text: primaryTextVal,
                fontFamily: primaryFontVal,
                color: primaryColorVal,
              });
            }}
          />
        </>
      ) : (
        <div className="text-center py-4">
          <p className="text-xs text-text-muted mb-2">No template active.</p>
        </div>
      )}
    </div>
  );
};
