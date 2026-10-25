# Property Panel UI Primitives

Low-level reusable UI controls and components used throughout the property panel system.

## Categories

### Slider Components

#### SliderTrack
Standard draggable slider with fill indicator.

**Features:**
- Click and drag interaction
- Visual fill from min to current value
- Customizable min/max/step
- Disabled state support

**Usage:**
```typescript
<SliderTrack
  value={50}
  min={0}
  max={100}
  step={1}
  onChange={setValue}
/>
```

#### SpeedSliderTrack
Specialized slider for speed control with visual tick marks at common intervals.

**Features:**
- Tick marks at 0.25x, 0.5x, 1x, 2x, 4x, 8x
- Standard slider interaction
- Visual guides for common speeds

#### GradientSliderTrack
Slider with color gradient background (temp/tint/saturation).

**Features:**
- Pre-defined gradients: `temp`, `tint`, `saturation`, `none`
- Visual representation of adjustment effect
- Used in color grading controls

#### GradientSliderControl
Complete slider control combining gradient track + numeric input + keyframe controls.

**Features:**
- All-in-one color adjustment control
- Label, gradient slider, numeric input, keyframe buttons
- Standardized layout for video adjust tab

### Input Components

#### NumericControl
Numeric input with increase/decrease buttons.

**Features:**
- Optional prefix label (X, Y)
- Optional suffix unit (%, px, deg)
- Inline editing with validation
- Min/max clamping
- Keyboard shortcuts (↑/↓ arrows)

**Usage:**
```typescript
<NumericControl
  value={rotation}
  onChange={setRotation}
  suffix="°"
  min={0}
  max={360}
  step={1}
/>
```

#### PropertySelect
Dropdown select for property values.

**Features:**
- Custom styling for property panel
- Option rendering
- Keyboard navigation

### Keyframe Components

#### KeyframeNavControls
Complete keyframe control bar with add/remove toggle and prev/next navigation.

**Features:**
- Add/remove keyframe button (with plus/minus icons)
- Previous keyframe button
- Next keyframe button
- Hover-to-reveal icons
- Consistent styling

**Usage:**
```typescript
<KeyframeNavControls
  hasKeyframes={hasKeyframes}
  isAtKeyframe={isAtKeyframe}
  onToggleKeyframe={handleToggleKeyframe}
  onPrevKeyframe={handlePrevKeyframe}
  onNextKeyframe={handleNextKeyframe}
  label="Opacity"
/>
```

#### KeyframeToggleButton
Standalone keyframe add/remove button.

#### InlineKeyframeNav
Compact keyframe controls for inline use.

### Utility Components

#### IncreaseDecreaseHandler
Up/down arrow buttons for incrementing numeric values.

**Used by:** NumericControl

#### ColorWheel
Circular color picker for hue/saturation selection.

**Used by:** HSLSection, color grading controls

### Section Components

#### PropertySection
Generic collapsible section container.

**Features:**
- Expand/collapse animation
- Header with title
- Content area

#### PropertySectionHeader
Header component for property sections with collapse toggle.

**Features:**
- Title display
- Collapse/expand button
- Consistent styling
- Icon support

**Usage:**
```typescript
<PropertySectionHeader
  title="Transform"
  isCollapsed={collapsed}
  onToggleCollapse={() => setCollapsed(!collapsed)}
/>
```

## Design Principles

Primitives should:

1. **Be reusable** - Work in multiple contexts
2. **Be composable** - Can be combined to create higher-level controls
3. **Have minimal dependencies** - Don't depend on other primitives
4. **Be well-typed** - Strong TypeScript interfaces
5. **Be accessible** - Proper ARIA labels and keyboard support

## Usage Pattern

```typescript
// Compose primitives to create custom controls
import { SliderTrack, NumericControl, KeyframeNavControls } from "@/components/editor/properties/primitives";

<div className="flex items-center gap-3">
  <label>Opacity</label>
  <SliderTrack value={opacity} min={0} max={100} onChange={setOpacity} />
  <NumericControl value={opacity} onChange={setOpacity} suffix="%" />
  <KeyframeNavControls hasKeyframes={false} isAtKeyframe={false} ... />
</div>
```

## Standard Control Pattern

Most property controls follow this pattern:
```
[Label] [Slider] [NumericInput] [KeyframeControls]
```

Example: `GradientSliderControl` implements this pattern for color adjustments.

## Adding New Primitives

Before adding a primitive:

1. ✅ Verify it's used in 2+ places
2. ✅ Ensure it's generic enough for reuse
3. ✅ Check if existing primitives can be composed instead
4. ✅ Add proper TypeScript types
5. ✅ Add JSDoc documentation

## Related

- **Shared Components:** Higher-level composed controls in `shared/`
- **Clip Sections:** Clip-specific sections that use these primitives
