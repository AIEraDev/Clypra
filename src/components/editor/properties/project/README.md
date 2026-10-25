# Project-Level Property Components

Components for project-wide settings and configuration in Clypra's property panel.

## Structure

```
project/
├── ProjectDetailsPanel.tsx
└── BackgroundInspectorPanel.tsx
```

## Components

### ProjectDetailsPanel
Project metadata and settings panel.

**Used by:** When project settings are being edited (no clip selected, or project button clicked)

**Features:**
- Project name
- Project description
- Canvas dimensions (1920x1080, 1080x1920, etc.)
- Frame rate settings
- Project metadata

**Accessibility:**
Shows project-level information that affects all clips and export settings.

### BackgroundInspectorPanel
Canvas background configuration.

**Used by:** When editing canvas background (project-level or timeline background)

**Features:**
- Background color selection
- Background type (solid, gradient, image)
- Background opacity
- Canvas preview

**Relationship to Timeline:**
The canvas background appears behind all timeline clips and can be configured at the project level.

## Usage

```typescript
import { ProjectDetailsPanel, BackgroundInspectorPanel } from "@/components/editor/properties/project";
```

## Project Settings vs Clip Properties

**Project Settings:**
- Canvas dimensions
- Frame rate
- Background
- Global effects
- Export presets

**Clip Properties:**
- Position, scale, rotation
- Color adjustments
- Speed, volume
- Clip-specific effects

## Adding New Project Components

1. Create in `project/NewProjectComponent.tsx`
2. Export from `index.ts`
3. Register in appropriate panel router
4. Consider if setting affects all clips or just project metadata

## Related

- **Core Components:** `core/PropertiesPanel` (decides when to show project vs clip properties)
- **Project Store:** Zustand store for project-level state
