# Image/Sticker Clip Property Components

Components specific to image and sticker clip properties in Clypra's property panel.

## Structure

```
image/
└── sections/
    └── StickerSettingsSection.tsx
```

## Sections

### StickerSettingsSection
Configuration for sticker clips (animated and static).

**Used by:** Sticker clips (animated Lottie and static images)

**Features:**
- Sticker-specific properties
- Animation controls (for animated stickers)
- Format-specific settings
- Sizing and positioning

## Image Clip Types

Clypra supports several image-based clip types:

1. **Static Images** - PNG, JPG, WebP
2. **Animated Stickers** - Lottie JSON animations
3. **Static Stickers** - Sticker library images
4. **GIF Images** - Animated GIFs

## Shared Components Usage

Image clips also use shared components:
- **TransformSection** (from `shared/`) - Position, scale, rotation
- **MotionPresetSection** (from `shared/`) - Animation presets

## Usage

```typescript
import { StickerSettingsSection } from "@/components/editor/properties/image";
```

## Adding New Image Components

1. Create in `sections/NewImageSection.tsx`
2. Export from `index.ts`
3. Register in `PropertyPanelBody.tsx` with `isSticker` or `isImageClip` conditional
4. Consider if component should be shared with video/text

## Image-Specific Considerations

Image clips are unique because they:
- May not have a mediaAsset entry (stickers from library)
- Support both static and animated formats
- Often use synthesized asset data for stickers
- Share many controls with video clips

## Related

- **Shared Components:** `shared/TransformSection`, `shared/MotionPresetSection`
- **Video Sections:** Many video controls apply to images too
- **Primitives:** Standard UI controls for image properties
