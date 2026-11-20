import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  BUILTIN_PROJECT_TEMPLATES,
  type ProjectTemplate,
} from "@/features/templates/projectTemplates";
import { useI18n } from "@/i18n/I18nProvider";
import { Film, Sparkles, Layers } from "lucide-react";

interface ProjectTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (templateId: string) => void;
}

export const ProjectTemplatesModal: React.FC<ProjectTemplatesModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
}) => {
  const { t } = useI18n();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const categories = [
    { id: "all", label: "All Templates" },
    { id: "social", label: "Social & Shorts" },
    { id: "video", label: "YouTube & Widescreen" },
    { id: "podcast", label: "Podcast & Interview" },
    { id: "cinematic", label: "Cinematic" },
  ];

  const filteredTemplates = BUILTIN_PROJECT_TEMPLATES.filter((tpl) => {
    if (selectedCategory === "all") return true;
    return tpl.category === selectedCategory;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("launch.templatesModalTitle")}
      size="xl"
    >
      <div className="p-6 space-y-6 h-full overflow-y-auto">
        <p className="text-xs text-text-secondary leading-relaxed">
          {t("launch.templatesModalDesc")}
        </p>

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedCategory === cat.id
                  ? "bg-accent text-white shadow-2xs"
                  : "bg-surface-elevated text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border-subtle"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Templates Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((tpl: ProjectTemplate) => (
            <div
              key={tpl.id}
              className="flex flex-col justify-between p-4 rounded-xl border border-border-default bg-surface-panel hover:border-accent/40 hover:bg-surface-hover transition-all duration-200 group shadow-2xs"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-surface-elevated text-accent border border-accent/20">
                    {tpl.aspectRatio} • {tpl.frameRate}fps
                  </span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted border border-border-subtle">
                    {tpl.badge}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-text-primary group-hover:text-accent transition-colors">
                  {tpl.name}
                </h4>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                  {tpl.description}
                </p>

                {/* Preconfigured Tracks list */}
                <div className="mt-3 pt-3 border-t border-border-subtle">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted mb-1.5">
                    <Layers className="w-3 h-3 text-accent" />
                    <span>Preset Tracks:</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tpl.initialTracks.map((tr, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-secondary border border-border-subtle"
                      >
                        {tr.name} ({tr.type})
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={() => {
                  onSelectTemplate(tpl.id);
                  onClose();
                }}
                className="mt-4 w-full py-2 rounded-lg bg-surface-elevated hover:bg-accent hover:text-white text-text-primary text-xs font-semibold border border-border-default hover:border-accent transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t("launch.useTemplate")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};
