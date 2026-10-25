# Effect/Filter Clip Property Components

Components specific to timeline effects and filters in Clypra's property panel.

## Structure

```
effects/
└── sections/
    ├── TimelineEffectSection.tsx
    ├── EffectsFiltersSection.tsx
    ├── EffectStylePanel.tsx
    ├── ChromaKeySection.tsx
    └── TransitionSection.tsx
```

## Sections

### TimelineEffectSection
Properties for timeline-level effects (filters, overlays, etc.).

**Used by:** Filter clips, video effect clips, body effect clips

**Features:**
- Effect-specific parameter controls
- Effect enable/disable
- Effect intensity/strength controls

### EffectsFiltersSection
Collection of video effects and filters.

**Used by:** Visual clips without tabs

**Features:**
- Effect selection and configuration
- Multiple effect stacking
- Effect presets

### EffectStylePanel
Styling controls for effects.

**Features:**
- Effect-specific style parameters
- Color adjustments for effects
- Blend modes for effects

### ChromaKeySection
Chroma key (green screen) effect controls.

**Used by:** Visual clips

**Features:**
- Color selection for keying
- Tolerance/threshold controls
- Edge refinement
- Spill suppression

### TransitionSection
Transition effect properties.

**Used by:** Transition clips

**Features:**
- Transition type selection
- Duration control
- Transition-specific parameters

## Usage

```typescript
import { ChromaKeySection, TransitionSection } from "@/components/editor/properties/effects";
```

## Effect Types

Clypra supports several effect clip types:

1. **Filter Clips** - Color grading, blur, etc.
2. **Video Effects** - Overlays, particles, etc.
3. **Body Effects** - Person detection effects
4. **Transitions** - Dissolve, wipe, etc.

## Adding New Effect Components

1. Create in `sections/NewEffectSection.tsx`
2. Export from `index.ts`
3. Register in `PropertyPanelBody.tsx` with appropriate conditional
4. Follow effect parameter patterns from existing sections

## Effect Parameter Patterns

Effects typically use:
- **Intensity sliders** - 0-100 range
- **Enable/disable toggles**
- **Color pickers** - For color-based effects
- **Preset dropdowns** - For effect variations

## Related

- **Video Sections:** `video/sections/` (some effects integrate with video controls)
- **Primitives:** `primitives/SliderTrack`, `primitives/ColorWheel`
