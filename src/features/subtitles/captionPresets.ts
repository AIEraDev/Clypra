export interface CaptionStylePreset {
  id: string;
  name: string;
  description: string;
  fillColor: string;
  strokeColor?: string;
  strokeWidth?: number;
  backgroundColor?: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
}

export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  {
    id: "yellow-bold",
    name: "Classic Yellow Bold",
    description: "Vibrant yellow text with dark outline for maximum readability on social media.",
    fillColor: "#FFE600",
    strokeColor: "#000000",
    strokeWidth: 4,
    fontFamily: "Outfit Variable",
    fontSize: 34,
    bold: true,
  },
  {
    id: "black-box",
    name: "High-Contrast Box",
    description: "Clean white text with semi-transparent dark background box.",
    fillColor: "#FFFFFF",
    backgroundColor: "rgba(0,0,0,0.8)",
    fontFamily: "Inter Variable",
    fontSize: 32,
    bold: true,
  },
  {
    id: "neon-glow",
    name: "Neon Cyber Glow",
    description: "Electric cyan text with vibrant glowing outline for modern aesthetics.",
    fillColor: "#00FFFF",
    strokeColor: "#0055ff",
    strokeWidth: 3,
    fontFamily: "Outfit Variable",
    fontSize: 34,
    bold: true,
  },
  {
    id: "minimal-clean",
    name: "Minimalist White",
    description: "Subtle white typography with soft drop shadow.",
    fillColor: "#FFFFFF",
    strokeColor: "rgba(0,0,0,0.4)",
    strokeWidth: 2,
    fontFamily: "Inter Variable",
    fontSize: 30,
    bold: false,
  },
];

export function getCaptionPresetById(id: string): CaptionStylePreset | undefined {
  return CAPTION_STYLE_PRESETS.find((p) => p.id === id);
}
