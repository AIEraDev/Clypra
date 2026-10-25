# Shared Property Panel Components

Reusable property sections used across multiple clip types.

## Overview

Components in this directory are shared across different clip types (video, audio, text, image) to promote code reuse and maintain consistency.

## Components

### MotionPresetSection
Animation preset selection and configuration.

**Used by:**
- Video clips (Animation tab)
- Text clips (Animation tab)
- Image clips (legacy layout)

**Features:**
- In/Out/Loop animation presets
- Preset categories (Basic, Motion, 3D, Glitch)
- Preset search and favorites
- Duration and intensity controls

### TransformSection
Position, scale, and rotation controls.

**Used by:**
- Video clips (legacy layout)
- Image clips (legacy layout)
- Sticker clips (legacy layout)

**Features:**
- Position (X, Y)
- Scale (uniform or separate width/height)
- Rotation
- Alignment tools
- Fit options (Fill, Fit, Stretch)

### SpeedSection
Playback speed control with tick marks and pitch adjustment.

**Used by:**
- Video clips (Speed tab)
- Audio clips (Speed tab)

**Features:**
- Speed slider with visual tick marks (0.25x, 0.5x, 1x, 2x, 4x, 8x)
- Numeric speed input
- Duration display (read-only)
- Change audio pitch toggle
- Standard/Curve/Velocity sub-tabs (Curve and Velocity locked)

**Export Name:** `SpeedStyleSection` (for backwards compatibility)

## Usage

```typescript
// Import from shared directory
import { MotionPresetSection } from "@/components/editor/properties/shared";
import { TransformSection } from "@/components/editor/properties/shared";
import { SpeedStyleSection } from "@/components/editor/properties/shared";

// Use in clip-specific components
<MotionPresetSection
  selectedClip={selectedClip}
  handleUpdateMultiple={handleUpdateMultiple}
  canvasWidth={canvasWidth}
  canvasHeight={canvasHeight}
/>
```

## Design Principles

Components in `shared/` should:

1. **Be clip-type agnostic** - Work with any clip type that supports the feature
2. **Have consistent interfaces** - Similar props patterns across shared components
3. **Be well-documented** - Clear JSDoc comments explaining usage
4. **Have no clip-type-specific logic** - Use props for customization instead

## Adding New Shared Components

Before adding a component to `shared/`, verify:

1. ✅ Used by 2+ clip types
2. ✅ No clip-type-specific logic needed
3. ✅ Consistent interface across use cases
4. ✅ Generic enough for future clip types

If these criteria aren't met, place the component in a clip-specific directory instead.

## Related

- **Primitives:** Low-level UI controls in `primitives/`
- **Clip-Specific:** `video/`, `audio/`, `text/`, `image/`
