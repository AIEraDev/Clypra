import React, { useState } from "react";
import { Sparkles, Video, Smartphone, Mic, Film, Square, ArrowRight } from "lucide-react";
import { BUILTIN_PROJECT_TEMPLATES, type ProjectTemplate } from "@/features/templates/projectTemplates";
import { useProjectStore } from "@/store/projectStore";

interface ProjectTemplatePickerProps {
  onTemplateSelected?: () => void;
}

export const ProjectTemplatePicker: React.FC<ProjectTemplatePickerProps> = ({ onTemplateSelected }) => {
  const createProjectFromTemplate = useProjectStore((s) => s.createProjectFromTemplate);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const categories = [
    { id: "all", label: "All Templates" },
    { id: "social", label: "Mobile & Social" },
    { id: "video", label: "YouTube & Widescreen" },
    { id: "podcast", label: "Podcasts & Audio" },
    { id: "cinematic", label: "Cinematic" },
  ];

  const filteredTemplates = BUILTIN_PROJECT_TEMPLATES.filter(
    (t) => selectedCategory === "all" || t.category === selectedCategory
  );

  const handleSelectTemplate = async (template: ProjectTemplate) => {
    await createProjectFromTemplate(template.id);
    if (onTemplateSelected) {
      onTemplateSelected();
    }
  };

  const getTemplateIcon = (category: string) => {
    switch (category) {
      case "social":
        return <Smartphone className="w-4 h-4 text-emerald-400" />;
      case "video":
        return <Video className="w-4 h-4 text-blue-400" />;
      case "podcast":
        return <Mic className="w-4 h-4 text-amber-400" />;
      case "cinematic":
        return <Film className="w-4 h-4 text-purple-400" />;
      default:
        return <Square className="w-4 h-4 text-accent" />;
    }
  };

  return (
    <div className="space-y-4 select-none">
      {/* Category Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${
              selectedCategory === cat.id
                ? "bg-accent text-white shadow-sm"
                : "bg-surface-raised border border-white/6 text-text-muted hover:text-text-primary hover:bg-white/10"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1">
        {filteredTemplates.map((template) => (
          <div
            key={template.id}
            onClick={() => handleSelectTemplate(template)}
            className="group flex flex-col justify-between p-3.5 rounded-xl bg-surface-raised/80 hover:bg-surface-raised border border-white/8 hover:border-accent/40 transition-all cursor-pointer shadow-sm hover:shadow-md"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-surface border border-white/10">
                    {getTemplateIcon(template.category)}
                  </div>
                  <span className="text-[12px] font-semibold text-text-primary group-hover:text-accent transition-colors">
                    {template.name}
                  </span>
                </div>
                <span className="px-2 py-0.5 text-[9px] font-mono font-semibold rounded-md bg-white/5 border border-white/10 text-accent">
                  {template.badge}
                </span>
              </div>

              <p className="text-[11px] text-text-muted leading-relaxed line-clamp-2">
                {template.description}
              </p>
            </div>

            <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                <span>{template.initialTracks.length} tracks pre-configured</span>
              </div>
              <span className="text-[11px] font-medium text-accent flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                Use Template <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
