# Core Property Panel Infrastructure

Core components that make up the property panel system.

## Components

### PropertiesPanel
Main property panel container component.

**Responsibilities:**
- Manages selected clip state
- Determines clip type (video, audio, text, image, effect)
- Provides panel resize and collapse functionality
- Routes to appropriate sub-components based on selection

**Props:**
- `width?: number` - Panel width in pixels
- `fillWidth?: boolean` - Whether to fill available width
- `collapsed?: boolean` - Collapsed state
- `onToggleCollapse?: () => void` - Collapse handler
- `className?: string` - Additional CSS classes

**Usage:**
```typescript
import { PropertiesPanel } from "@/components/editor/properties/core";

<PropertiesPanel
  width={400}
  collapsed={false}
  onToggleCollapse={() => setCollapsed(!collapsed)}
/>
```

### PropertyPanelHeader
Tab navigation and header controls.

**Responsibilities:**
- Renders tab navigation (Text, Video, Audio, Speed, Animation, Adjust)
- Manages active tab state
- Filters tabs based on clip type and capabilities
- Shows/hides collapse toggle button

**Tabs by Clip Type:**
- **Text:** Text, Animation
- **Video:** Video, Audio, Speed, Animation, Adjust
- **Audio:** Basic, Voice Changer, Speed

### PropertyPanelBody
Content area router that renders appropriate sections based on clip type and active tab.

**Responsibilities:**
- Routes to correct tab content based on `activePropertyTab`
- Handles conditional rendering for different clip types
- Renders legacy sections for clips without tabs
- Manages shared section rendering

**Rendering Logic:**
```typescript
{isVideoClip && activePropertyTab === "video" && <VideoStyleSection />}
{isAudioClip && activePropertyTab === "basic" && <AudioBasicTab />}
{isTextClip && activePropertyTab === "text" && <TextStyleSection />}
```

### PropertyPanelCollapsed
Collapsed state view showing vertical icon buttons.

**Responsibilities:**
- Displays clip type icon
- Shows quick-access buttons for common sections
- Provides expand button

### EmptyPropertiesState
No selection state UI.

**Responsibilities:**
- Shows message when no clip is selected
- Provides visual feedback for empty state

## Architecture

```
PropertiesPanel (container)
├── PropertyPanelHeader (tabs)
├── PropertyPanelCollapsed (collapsed view)
│   OR
└── PropertyPanelBody (content router)
    ├── Video Components (video/)
    ├── Audio Components (audio/)
    ├── Text Components (text/)
    ├── Image Components (image/)
    ├── Effects Components (effects/)
    └── Shared Components (shared/)
```

## State Management

The property panel uses:
- **Zustand stores** for clip data (`timelineStore`, `projectStore`)
- **Local React state** for UI state (active tab, collapsed state)
- **usePropertyEditCoordinator** hook for coordinated property updates

## Usage Pattern

```typescript
// In EditorLayout.tsx
import { PropertiesPanel } from "./properties/core/PropertiesPanel";

<PropertiesPanel
  width={propertyPanelWidth}
  collapsed={propertyPanelCollapsed}
  onToggleCollapse={handleTogglePropertyPanel}
/>
```

## Customization

To add a new clip type:

1. Update `PropertyPanelHeader` to include new tabs
2. Update `PropertyPanelBody` to route to new components
3. Create new directory structure under `properties/`
4. Follow existing patterns for tabs and sections

## Related

- **Clip Components:** `video/`, `audio/`, `text/`, `image/`, `effects/`
- **Shared Sections:** `shared/`
- **UI Primitives:** `primitives/`
