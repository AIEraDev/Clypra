# Video Clip Property Components

Components specific to video clip properties in Clypra's property panel.

## Structure

```
video/
├── tabs/               # Top-level tab content
│   ├── VideoBasicTab.tsx
│   └── VideoAdjustTab.tsx
└── sections/           # Sub-sections within tabs
    ├── VideoStyleSection.tsx
    ├── VideoTransformControls.tsx
    ├── VideoBlendControls.tsx
    ├── AudioStyleSection.tsx
    ├── LUTSection.tsx
    ├── HSLSection.tsx
    └── ColorWheelsSection.tsx
```

## Tabs

### VideoBasicTab
Main video properties tab containing transform, blend, and basic video controls.

**Used by:** Video clips when "Video" tab is active

### VideoAdjustTab
Color adjustment tab with LUT, HSL, and color grading controls.

**Used by:** Video clips when "Adjust" tab is active

## Sections

### VideoStyleSection
Router component for video sub-tabs (Basic, Remove BG, Mask, Retouch).

### VideoTransformControls
Position, scale, rotation, and opacity controls specific to video clips.

### VideoBlendControls
Blend mode selection for compositing video clips.

### AudioStyleSection
Audio properties for video clips with embedded audio tracks.

### LUTSection
LUT (Look-Up Table) selection and intensity control for color grading.

### HSLSection
HSL (Hue, Saturation, Lightness) color adjustments with preset colors.

### ColorWheelsSection
Advanced color wheels interface for professional color grading.

## Usage

```typescript
import { VideoBasicTab, VideoAdjustTab } from "@/components/editor/properties/video";
import { LUTSection, HSLSection } from "@/components/editor/properties/video";
```

## Adding New Video Components

1. **For a new tab:** Create in `tabs/VideoNewTab.tsx`
2. **For a new section:** Create in `sections/NewSection.tsx`
3. Export from `index.ts`
4. Register in `PropertyPanelBody.tsx` with conditional rendering

## Related

- **Shared Components:** `shared/TransformSection`, `shared/MotionPresetSection`
- **Primitives:** `primitives/GradientSliderControl`, `primitives/SliderTrack`
