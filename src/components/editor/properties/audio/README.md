# Audio Clip Property Components

Components specific to audio clip properties in Clypra's property panel.

## Structure

```
audio/
├── tabs/                       # Top-level tab content
│   ├── AudioBasicTab.tsx
│   └── AudioVoiceChangerTab.tsx
└── sections/                   # Sub-sections within tabs
    └── AudioSection.tsx
```

## Tabs

### AudioBasicTab
Main audio properties tab with volume, fade in, and fade out controls.

**Used by:** Audio clips when "Basic" tab is active

**Controls:**
- Volume (with mute button)
- Fade in duration
- Fade out duration

### AudioVoiceChangerTab
Voice changer effects tab (placeholder for future implementation).

**Used by:** Audio clips when "Voice Changer" tab is active

## Sections

### AudioSection
Legacy audio properties section (used for audio clips without tabs).

**Contains:**
- Volume control
- Fade in/out controls
- Audio linking/unlinking for video clips

## Usage

```typescript
import { AudioBasicTab, AudioVoiceChangerTab } from "@/components/editor/properties/audio";
```

## Audio Clip Tab Structure

When an audio clip is selected, the property panel shows:
1. **Basic** - Volume, Fade in, Fade out
2. **Voice Changer** - Voice effects (coming soon)
3. **Speed** - Playback speed control (from `shared/SpeedSection`)

## Adding New Audio Components

1. **For a new tab:** Create in `tabs/AudioNewTab.tsx`
2. **For a new section:** Create in `sections/NewSection.tsx`
3. Export from `index.ts`
4. Register in `PropertyPanelBody.tsx` with `isAudioClip && activePropertyTab === "newtab"`

## Related

- **Shared Components:** `shared/SpeedSection` (used for audio speed tab)
- **Primitives:** `primitives/SliderTrack`, `primitives/NumericControl`, `primitives/KeyframeNavControls`
