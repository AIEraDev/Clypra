# Enhanced Media Panel Design

## Overview

The Enhanced Media Panel is a comprehensive tabbed interface that provides access to all creative assets and tools needed for video editing. It replaces the simple MediaPanel with a professional-grade asset browser supporting multiple content types.

## Features

### 7 Main Tabs

#### 1. **Media** 📁

- Import and manage video, audio, and image files
- Grid view with thumbnails
- Drag-and-drop support
- Duration display for video/audio
- Quick add to timeline button

**Features:**

- File import via button or drag-and-drop
- Visual preview thumbnails
- Asset metadata display
- Context menu for actions

#### 2. **Audio** 🎵

- Two sub-tabs: Sound Effects and Music
- Search functionality
- Play preview button
- Author/creator attribution
- Quick add and favorite buttons

**Sound Effects:**

- Short audio clips (whoosh, explosions, UI sounds)
- Category tags (transition, impact, ambient, UI)
- Duration display

**Music:**

- Background music tracks
- BPM and duration info
- Genre/mood filtering (future)

#### 3. **Text** 📝

- Pre-designed text presets
- Custom text creation
- Font style previews
- Animation presets

**Text Presets:**

- Title (72px, bold, fade-in)
- Subtitle (48px, regular, slide-up)
- Lower Third (32px, medium, slide-left)
- Caption (24px, regular, none)
- Headline (64px, bold, zoom-in)
- Quote (36px, italic, fade-in)

#### 4. **Stickers** 😊

- Emoji and graphic stickers
- Grid layout for easy browsing
- Search functionality
- Category organization

**Categories:**

- Reactions (👍, 🔥, ❤️, 🎉)
- Shapes (⭐)
- Effects (⚡, ✨)
- Objects (🚀)

#### 5. **Effects** ✨

- Visual effects and filters
- Preview thumbnails
- Category organization

**Effect Types:**

- **Filters:** Blur, Vignette, Sharpen
- **Color:** Black & White, Sepia
- **Light:** Glow
- **Distortion:** Chromatic, Pixelate

#### 6. **Transitions** 🔄

- Transition effects between clips
- Duration display
- Visual preview

**Transition Types:**

- Fade (0.5s)
- Dissolve (1.0s)
- Wipe (0.8s)
- Slide (0.6s)
- Zoom (0.7s)
- Spin (1.0s)

#### 7. **Captions** 💬

- Auto-generate captions (AI-powered)
- Manual caption creation
- Caption style presets

**Caption Styles:**

- Default
- Bold
- Minimal
- Boxed

## Design Principles

### Visual Hierarchy

1. **Tab Navigation** - Top-level navigation with icons and labels
2. **Search/Actions** - Secondary controls below tabs
3. **Content Area** - Scrollable grid or list of items
4. **Quick Actions** - Hover states reveal add/favorite buttons

### Interaction Patterns

#### Adding to Timeline

- **Click + button** - Adds item to timeline at playhead position
- **Drag and drop** - Drag item directly to timeline track
- **Double-click** - Quick add to default track (future)

#### Preview/Play

- **Audio items** - Play button for preview
- **Visual items** - Hover for preview (future)
- **Transitions** - Animated preview on hover (future)

#### Organization

- **Search** - Real-time filtering by name
- **Categories** - Filter by type/category (future)
- **Favorites** - Heart icon to save favorites (future)

## Component Structure

```
EnhancedMediaPanel/
├── Tab Navigation (horizontal scroll)
├── MediaTab
│   ├── Import Button
│   └── Grid of MediaCards
├── AudioTab
│   ├── Sub-tabs (Effects/Music)
│   ├── Search Bar
│   └── List of AudioItems
├── TextTab
│   ├── Add Custom Button
│   └── List of TextPresetCards
├── StickersTab
│   ├── Search Bar
│   └── Grid of StickerCards
├── EffectsTab
│   └── Grid of EffectCards
├── TransitionsTab
│   └── Grid of TransitionCards
└── CaptionsTab
    ├── Auto-Generate Button
    ├── Add Manual Button
    └── Style Presets
```

## Dummy Data Structure

### Sound Effect

```typescript
{
  id: string;
  name: string;
  author: string;
  duration: number;
  category: "transition" | "impact" | "ambient" | "ui";
}
```

### Music Track

```typescript
{
  id: string;
  name: string;
  author: string;
  duration: number;
  bpm: number;
}
```

### Text Preset

```typescript
{
  id: string;
  name: string;
  style: "bold" | "regular" | "medium" | "italic";
  fontSize: number;
  animation: string;
}
```

### Sticker

```typescript
{
  id: string;
  name: string;
  category: string;
  emoji: string;
}
```

### Effect

```typescript
{
  id: string;
  name: string;
  category: "filter" | "color" | "light" | "distortion";
  icon: string;
}
```

### Transition

```typescript
{
  id: string;
  name: string;
  duration: number;
  preview: string;
}
```

## Future Enhancements

### Phase 1 (Current)

- ✅ Tab navigation
- ✅ Dummy data for all tabs
- ✅ Basic search functionality
- ✅ Add to timeline integration

### Phase 2

- [ ] Real audio preview playback
- [ ] Animated transition previews
- [ ] Text editor modal
- [ ] Favorites system
- [ ] Category filtering

### Phase 3

- [ ] Asset library integration (stock audio/video)
- [ ] AI caption generation
- [ ] Custom effect parameters
- [ ] Asset collections/folders
- [ ] Cloud sync for favorites

### Phase 4

- [ ] Collaborative asset sharing
- [ ] Asset marketplace
- [ ] Custom plugin support
- [ ] Advanced search with tags
- [ ] Asset version history

## Integration Points

### Timeline Integration

```typescript
handleAddToTimeline(item: any, type: TabType) => {
  switch(type) {
    case "media": // Add video/audio/image clip
    case "audio": // Add sound effect or music
    case "text": // Add text layer
    case "stickers": // Add sticker overlay
    case "effects": // Apply effect to selected clip
    case "transitions": // Add transition between clips
    case "captions": // Add caption track
  }
}
```

### Store Integration

- **projectStore** - Media assets
- **timelineStore** - Clips, tracks
- **uiStore** - Selection state
- **Future: assetsStore** - Library assets, favorites

## Accessibility

- Keyboard navigation through tabs (Arrow keys)
- Search with keyboard shortcuts (Cmd/Ctrl + F)
- Screen reader support for all items
- Focus indicators on interactive elements
- ARIA labels for icon-only buttons

## Performance Considerations

- Virtualized lists for large asset libraries
- Lazy loading of thumbnails
- Debounced search input
- Memoized filter functions
- Optimized re-renders with React.memo

## Styling

### Colors

- **Accent:** `#8cc7ff` (active tab, buttons)
- **Surface:** `bg-surface-raised` (cards, inputs)
- **Border:** `border-border` (dividers)
- **Text:** `text-text-primary`, `text-text-muted`

### Spacing

- **Panel width:** `23rem` (368px)
- **Card gap:** `0.5rem` (8px)
- **Padding:** `0.75rem` (12px)

### Typography

- **Tab labels:** `text-sm font-medium`
- **Item names:** `text-sm font-medium`
- **Metadata:** `text-xs text-text-muted`

## Testing Strategy

### Unit Tests

- Tab switching logic
- Search filtering
- Add to timeline handlers
- Drag and drop functionality

### Integration Tests

- Timeline integration
- Store updates
- File import flow

### E2E Tests

- Complete workflow: import → add to timeline → edit
- Multi-tab navigation
- Search and filter

## Migration from MediaPanel

### Breaking Changes

- Component name changed: `MediaPanel` → `EnhancedMediaPanel`
- Callback signature changed: `onAddToTimeline(mediaId: string)` → `onAddToTimeline(item: any, type: TabType)`

### Migration Steps

1. Update import in `EditorLayout.tsx`
2. Update `handleAddToTimeline` to handle multiple types
3. Test existing media import functionality
4. Gradually implement handlers for new types

### Backward Compatibility

- Media tab maintains all existing functionality
- Existing media assets continue to work
- No changes to timeline or store contracts
