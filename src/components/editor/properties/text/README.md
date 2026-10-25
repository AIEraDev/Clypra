# Text Clip Property Components

Components specific to text clip properties in Clypra's property panel.

## Structure

```
text/
├── tabs/                           # Top-level tab content
│   ├── TextBasicTab.tsx
│   └── TextBubbleTab.tsx
└── sections/                       # Sub-sections within tabs
    ├── TextStyleSection.tsx
    ├── TextTransformSection.tsx
    ├── TextStrokeSection.tsx
    ├── TextBackgroundSection.tsx
    ├── TextAnimationControls.tsx
    ├── PresetStyleGrid.tsx
    ├── BubblePresetCanvas.tsx
    ├── TextTemplateOverlay.tsx
    ├── TemplateLayerEditor.tsx
    ├── TextToSpeechSection.tsx
    ├── TextTrackingSection.tsx
    └── TextAiAvatarsSection.tsx
```

## Tabs

### TextBasicTab
Main text properties tab with typography and style controls.

**Used by:** Text clips when "Text" tab is active

### TextBubbleTab
Speech bubble preset selection and customization.

**Used by:** Text clips when "Bubble" tab is active

## Sections

### TextStyleSection
Main text styling router containing presets, typography, stroke, and background sections.

### TextTransformSection
Position, scale, and rotation controls specific to text clips.

### TextStrokeSection
Text outline/stroke controls (color, thickness, enable/disable).

### TextBackgroundSection
Text background box controls (color, opacity, padding, rounded corners).

### TextAnimationControls
Animation preset selection and configuration for text clips.

### PresetStyleGrid
Grid display of text style presets for quick application.

### BubblePresetCanvas
Canvas component for rendering speech bubble previews.

### TextTemplateOverlay
Overlay UI for editing text templates.

### TemplateLayerEditor
Editor for managing layers within text templates.

### TextToSpeechSection
Text-to-speech generation controls (planned feature).

### TextTrackingSection
Object tracking for text (planned feature).

### TextAiAvatarsSection
AI avatar integration for text (planned feature).

## Usage

```typescript
import { TextBasicTab, TextBubbleTab } from "@/components/editor/properties/text";
import { TextStyleSection, TextStrokeSection } from "@/components/editor/properties/text";
```

## Text Clip Tab Structure

When a text clip is selected, the property panel shows:
1. **Text** - Typography, stroke, background, presets
2. **Animation** - Motion presets (from `shared/MotionPresetSection`)

## Adding New Text Components

1. **For a new tab:** Create in `tabs/TextNewTab.tsx`
2. **For a new section:** Create in `sections/NewSection.tsx`
3. Export from `index.ts`
4. Register in `PropertyPanelBody.tsx` with `isTextClip && activePropertyTab === "newtab"`

## Related

- **Shared Components:** `shared/MotionPresetSection`, `shared/TransformSection`
- **Primitives:** `primitives/NumericControl`, `primitives/ColorWheel`, `primitives/PropertySlider`
