import React from "react";
import { Check } from "lucide-react";
import { Modal } from "./Modal";
import { useSettingsStore, Theme, FontFamily } from "../../store/settingsStore";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { theme, fontFamily, setTheme, setFontFamily } = useSettingsStore();

  const themes: Array<{ id: Theme; name: string; description: string; preview: string }> = [
    {
      id: "dark",
      name: "Dark",
      description: "Classic dark theme",
      preview: "linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #242424 100%)",
    },
    {
      id: "midnight",
      name: "Midnight",
      description: "Deep blue tones",
      preview: "linear-gradient(135deg, #0a0e1a 0%, #131829 50%, #1a2138 100%)",
    },
    {
      id: "ocean",
      name: "Ocean",
      description: "Cool cyan accents",
      preview: "linear-gradient(135deg, #0a1520 0%, #0f1f2e 50%, #16293d 100%)",
    },
    {
      id: "forest",
      name: "Forest",
      description: "Natural green hues",
      preview: "linear-gradient(135deg, #0d1410 0%, #141d18 50%, #1c2820 100%)",
    },
  ];

  const fonts: Array<{ id: FontFamily; name: string; description: string; sample: string }> = [
    {
      id: "inter",
      name: "Inter",
      description: "Modern and clean",
      sample: "Inter Variable",
    },
    {
      id: "system",
      name: "System",
      description: "Native system font",
      sample: "System Font",
    },
    {
      id: "mono",
      name: "Monospace",
      description: "Code-style font",
      sample: "Monospace",
    },
    {
      id: "serif",
      name: "Serif",
      description: "Classic and elegant",
      sample: "Serif Font",
    },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <div className="space-y-8">
        {/* Theme Selection */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-3">Theme</h3>
          <div className="grid grid-cols-2 gap-3">
            {themes.map((themeOption) => (
              <button key={themeOption.id} onClick={() => setTheme(themeOption.id)} className={`relative p-4 rounded-lg border-2 transition-all text-left hover:border-accent/50 ${theme === themeOption.id ? "border-accent bg-surface-raised" : "border-border bg-surface"}`}>
                {/* Theme preview gradient */}
                <div className="w-full h-16 rounded-md mb-3" style={{ background: themeOption.preview }} />

                {/* Theme info */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-text-primary text-sm">{themeOption.name}</div>
                    <div className="text-xs text-text-muted mt-0.5">{themeOption.description}</div>
                  </div>

                  {/* Check icon for selected theme */}
                  {theme === themeOption.id && (
                    <div className="shrink-0 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Font Family Selection */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-3">Font Family</h3>
          <div className="space-y-2">
            {fonts.map((fontOption) => (
              <button key={fontOption.id} onClick={() => setFontFamily(fontOption.id)} className={`w-full p-3 rounded-lg border-2 transition-all text-left hover:border-accent/50 flex items-center justify-between ${fontFamily === fontOption.id ? "border-accent bg-surface-raised" : "border-border bg-surface"}`}>
                <div className="flex-1">
                  <div className="font-medium text-text-primary text-sm">{fontOption.name}</div>
                  <div className="text-xs text-text-muted mt-0.5">{fontOption.description}</div>
                </div>

                {/* Font preview */}
                <div
                  className="text-sm text-text-muted mr-3"
                  style={{
                    fontFamily: fontOption.id === "inter" ? '"Inter Variable", sans-serif' : fontOption.id === "system" ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : fontOption.id === "mono" ? '"JetBrains Mono", "Fira Code", Consolas, monospace' : 'Georgia, "Times New Roman", serif',
                  }}
                >
                  Aa
                </div>

                {/* Check icon for selected font */}
                {fontFamily === fontOption.id && (
                  <div className="shrink-0 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
