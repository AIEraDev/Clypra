# Property Panel Components Structural Reorganization Plan

## Executive Summary

This plan reorganizes 45 component files from a flat structure into a clear hierarchy organized by clip type (video, audio, text, image, effects) with shared components extracted. The reorganization uses smart_relocate for automatic import updates and is executed in 7 phases with verification checkpoints.

## Current State Analysis

### Discovered Structure

- **Total files**: 45 component files in flat structure
- **Subdirectories**: `primitives/` (14 files), `data/` (4 files), `__tests__/` (8 files)
- **Core panel components**: 5 files (PropertyPanelHeader, PropertyPanelBody, PropertyPanelCollapsed, EmptyPropertiesState, PropertiesPanel.tsx in parent dir)
- **Video components**: 8 files (tabs + sections)
- **Audio components**: 5 files (tabs + sections)
- **Text components**: 14 files (tabs + sections)
- **Effects components**: 5 files
- **Shared components**: 3 files (MotionPresetSection, TransformSection, SpeedStyleSection)
- **Image/Sticker**: 1 file
- **Project-level**: 2 files
- **Legacy/deprecated**: 3 files

### Key Import Relationships Verified

- `PropertiesPanel.tsx` (parent dir) imports: EmptyPropertiesState, PropertyPanelHeader, PropertyPanelBody, PropertyPanelCollapsed, types
- `PropertyPanelBody.tsx` imports: ALL tab and section components
- `TextStyleSection.tsx` imports: TextBasicTab, TextBubbleTab
- `VideoStyleSection.tsx` imports: VideoBasicTab
- Test files import their corresponding components

## Target Structure

```
src/components/editor/properties/
├── core/                          # Core panel orchestration
│   ├── PropertiesPanel.tsx       # MOVED from parent ../PropertiesPanel.tsx
│   ├── PropertyPanelHeader.tsx
│   ├── PropertyPanelBody.tsx
│   ├── PropertyPanelCollapsed.tsx
│   └── EmptyPropertiesState.tsx
│
├── primitives/                    # UNCHANGED - UI control primitives
│   └── (14 files remain as-is)
│
├── shared/                        # NEW - Cross-clip-type components
│   ├── MotionPresetSection.tsx
│   ├── TransformSection.tsx
│   └── SpeedSection.tsx          # RENAMED from SpeedStyleSection
│
├── video/                         # NEW - Video clip components
│   ├── tabs/
│   │   ├── VideoBasicTab.tsx
│   │   └── VideoAdjustTab.tsx
│   └── sections/
│       ├── VideoStyleSection.tsx
│       ├── VideoTransformControls.tsx
│       ├── VideoBlendControls.tsx
│       ├── AudioStyleSection.tsx
│       ├── LUTSection.tsx
│       ├── HSLSection.tsx
│       └── ColorWheelsSection.tsx
│
├── audio/                         # NEW - Audio clip components
│   ├── tabs/
│   │   ├── AudioBasicTab.tsx
│   │   └── AudioVoiceChangerTab.tsx
│   └── sections/
│       └── AudioSection.tsx
│
├── text/                          # NEW - Text clip components
│   ├── tabs/
│   │   ├── TextBasicTab.tsx
│   │   └── TextBubbleTab.tsx
│   └── sections/
│       ├── TextStyleSection.tsx
│       ├── TextTransformSection.tsx
│       ├── TextStrokeSection.tsx
│       ├── TextBackgroundSection.tsx
│       ├── TextAnimationControls.tsx
│       ├── PresetStyleGrid.tsx
│       ├── BubblePresetCanvas.tsx
│       ├── TextTemplateOverlay.tsx
│       ├── TemplateLayerEditor.tsx
│       ├── TextToSpeechSection.tsx
│       ├── TextTrackingSection.tsx
│       └── TextAiAvatarsSection.tsx
│
├── image/                         # NEW - Image/sticker components
│   └── sections/
│       └── StickerSettingsSection.tsx
│
├── effects/                       # NEW - Effects/filters
│   └── sections/
│       ├── TimelineEffectSection.tsx
│       ├── EffectsFiltersSection.tsx
│       ├── EffectStylePanel.tsx
│       ├── ChromaKeySection.tsx
│       └── TransitionSection.tsx
│
├── legacy/                        # NEW - Deprecated components
│   ├── AdjustmentsSection.tsx
│   ├── AdjustStyleSection.tsx
│   └── PlaybackSection.tsx
│
├── project/                       # NEW - Project-level panels
│   ├── ProjectDetailsPanel.tsx
│   └── BackgroundInspectorPanel.tsx
│
├── data/                          # UNCHANGED - Data/config
│   └── (4 files remain as-is)
│
├── __tests__/                     # Tests stay in place for now
│   └── (8 files - will need adjustment after move)
│
├── types.ts                       # UNCHANGED - Root types
└── data.ts                        # UNCHANGED - Root data
```

## Execution Plan

### Phase 0: Pre-flight Verification

**Objective**: Ensure clean baseline before any moves

#### Steps:

1. Run baseline TypeScript check

   ```bash
   npx tsc --noEmit
   ```

   **Expected**: 0 errors

2. Verify git status is clean or changes are committed

   ```bash
   git status
   ```

   **Expected**: Either clean working tree or all changes committed

3. Create feature branch

   ```bash
   git checkout -b refactor/property-panel-structure
   ```

4. Run baseline tests
   ```bash
   npm run test -- src/components/editor/properties/__tests__/
   ```
   **Expected**: All tests pass

**Checkpoint**: All verifications pass before proceeding to Phase 1

---

### Phase 1: Create Directory Structure

**Objective**: Create all new subdirectories

#### Steps:

1. Create new subdirectories (non-recursive to verify each level):

   ```bash
   mkdir -p src/components/editor/properties/core
   mkdir -p src/components/editor/properties/shared
   mkdir -p src/components/editor/properties/video/tabs
   mkdir -p src/components/editor/properties/video/sections
   mkdir -p src/components/editor/properties/audio/tabs
   mkdir -p src/components/editor/properties/audio/sections
   mkdir -p src/components/editor/properties/text/tabs
   mkdir -p src/components/editor/properties/text/sections
   mkdir -p src/components/editor/properties/image/sections
   mkdir -p src/components/editor/properties/effects/sections
   mkdir -p src/components/editor/properties/legacy
   mkdir -p src/components/editor/properties/project
   ```

2. Verify all directories created:
   ```bash
   find src/components/editor/properties -type d -maxdepth 2 | sort
   ```
   **Expected**: All 17 directories listed

**Verification**:

- All directories exist
- No files moved yet
- TypeScript check still passes: `npx tsc --noEmit`

**Git Commit**: `git commit -m "feat(properties): create new directory structure for reorganization"`

---

### Phase 2: Move Core Panel Components

**Objective**: Relocate the 5 core orchestration components

#### Critical Note:

PropertiesPanel.tsx is in the PARENT directory (`/src/components/editor/`), not in properties/. This is the most critical move as it affects imports from outside the properties module.

#### Moves (use smart_relocate for EACH):

1. **Move PropertiesPanel.tsx from parent directory**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/PropertiesPanel.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/core/PropertiesPanel.tsx
   ```

   **Impact**: High - imported by main Editor component and tests
   **Dependencies**: Imports 4 files from properties/ (relative paths will change)

2. **Move PropertyPanelHeader.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/PropertyPanelHeader.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/core/PropertyPanelHeader.tsx
   ```

3. **Move PropertyPanelBody.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/PropertyPanelBody.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/core/PropertyPanelBody.tsx
   ```

   **Impact**: High - imports 20+ section/tab components

4. **Move PropertyPanelCollapsed.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/PropertyPanelCollapsed.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/core/PropertyPanelCollapsed.tsx
   ```

5. **Move EmptyPropertiesState.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/EmptyPropertiesState.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/core/EmptyPropertiesState.tsx
   ```

**Verification After Each Move**:

- File moved successfully (check source deleted, destination exists)
- Wait for move to complete before starting next

**Verification After Phase**:

```bash
npx tsc --noEmit
```

**Expected**: 0 TypeScript errors (smart_relocate updates all imports)

```bash
ls -1 src/components/editor/properties/core/
```

**Expected**: 5 files listed

**Git Commit**: `git commit -m "refactor(properties): move core panel components to core/ subdirectory"`

---

### Phase 3: Move Shared Components

**Objective**: Relocate 3 cross-clip-type shared components

#### Moves (use smart_relocate for EACH):

1. **Move MotionPresetSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/MotionPresetSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/shared/MotionPresetSection.tsx
   ```

   **Dependencies**: Has test file (**tests**/MotionPresetSection.test.tsx)

2. **Move TransformSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TransformSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/shared/TransformSection.tsx
   ```

   **Dependencies**: Has 2 test files (TransformSection.test.tsx, TransformSectionEdgeCases.test.tsx)

3. **Move and rename SpeedStyleSection.tsx → SpeedSection.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/SpeedStyleSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/shared/SpeedSection.tsx
   ```
   **Note**: This is a RENAME operation - smart_relocate handles both move and rename

**Verification After Phase**:

```bash
npx tsc --noEmit
```

**Expected**: 0 TypeScript errors

```bash
ls -1 src/components/editor/properties/shared/
```

**Expected**: 3 files (MotionPresetSection.tsx, TransformSection.tsx, SpeedSection.tsx)

**Git Commit**: `git commit -m "refactor(properties): move shared components to shared/ subdirectory and rename SpeedStyleSection to SpeedSection"`

---

### Phase 4: Move Video Components

**Objective**: Relocate 8 video-related components to video/tabs/ and video/sections/

#### Moves - Tabs (use smart_relocate for EACH):

1. **VideoBasicTab.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/VideoBasicTab.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/tabs/VideoBasicTab.tsx
   ```

2. **VideoAdjustTab.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/VideoAdjustTab.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/tabs/VideoAdjustTab.tsx
   ```

#### Moves - Sections (use smart_relocate for EACH):

3. **VideoStyleSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/VideoStyleSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/sections/VideoStyleSection.tsx
   ```

   **Dependencies**: Imports VideoBasicTab (will be in ../tabs/)

4. **VideoTransformControls.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/VideoTransformControls.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/sections/VideoTransformControls.tsx
   ```

5. **VideoBlendControls.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/VideoBlendControls.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/sections/VideoBlendControls.tsx
   ```

6. **AudioStyleSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/AudioStyleSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/sections/AudioStyleSection.tsx
   ```

   **Note**: This is audio controls FOR video clips (linked audio track)

7. **LUTSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/LUTSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/sections/LUTSection.tsx
   ```

8. **HSLSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/HSLSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/sections/HSLSection.tsx
   ```

9. **ColorWheelsSection.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/ColorWheelsSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/video/sections/ColorWheelsSection.tsx
   ```
   **Dependencies**: Has test file (**tests**/colorGrading.test.ts)

**Verification After Phase**:

```bash
npx tsc --noEmit
```

**Expected**: 0 TypeScript errors

```bash
ls -1 src/components/editor/properties/video/tabs/
ls -1 src/components/editor/properties/video/sections/
```

**Expected**: 2 tabs, 7 sections

**Git Commit**: `git commit -m "refactor(properties): move video components to video/ subdirectory"`

---

### Phase 5: Move Audio Components

**Objective**: Relocate 5 audio-related components to audio/tabs/ and audio/sections/

#### Moves - Tabs (use smart_relocate for EACH):

1. **AudioBasicTab.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/AudioBasicTab.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/audio/tabs/AudioBasicTab.tsx
   ```

2. **AudioVoiceChangerTab.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/AudioVoiceChangerTab.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/audio/tabs/AudioVoiceChangerTab.tsx
   ```

#### Moves - Sections (use smart_relocate for EACH):

3. **AudioSection.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/AudioSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/audio/sections/AudioSection.tsx
   ```
   **Dependencies**: Has test file (**tests**/AudioSection.test.tsx)

**Verification After Phase**:

```bash
npx tsc --noEmit
```

**Expected**: 0 TypeScript errors

```bash
ls -1 src/components/editor/properties/audio/tabs/
ls -1 src/components/editor/properties/audio/sections/
```

**Expected**: 2 tabs, 1 section

**Git Commit**: `git commit -m "refactor(properties): move audio components to audio/ subdirectory"`

---

### Phase 6: Move Text Components

**Objective**: Relocate 14 text-related components to text/tabs/ and text/sections/

#### Moves - Tabs (use smart_relocate for EACH):

1. **TextBasicTab.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextBasicTab.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/tabs/TextBasicTab.tsx
   ```

2. **TextBubbleTab.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextBubbleTab.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/tabs/TextBubbleTab.tsx
   ```

#### Moves - Sections (use smart_relocate for EACH):

3. **TextStyleSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextStyleSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextStyleSection.tsx
   ```

   **Dependencies**: Has test file (**tests**/TextStyleSection.test.ts), imports TextBasicTab and TextBubbleTab

4. **TextTransformSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextTransformSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextTransformSection.tsx
   ```

5. **TextStrokeSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextStrokeSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextStrokeSection.tsx
   ```

6. **TextBackgroundSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextBackgroundSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextBackgroundSection.tsx
   ```

7. **TextAnimationControls.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextAnimationControls.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextAnimationControls.tsx
   ```

8. **PresetStyleGrid.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/PresetStyleGrid.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/PresetStyleGrid.tsx
   ```

9. **BubblePresetCanvas.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/BubblePresetCanvas.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/BubblePresetCanvas.tsx
   ```

10. **TextTemplateOverlay.tsx**

    ```
    Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextTemplateOverlay.tsx
    Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextTemplateOverlay.tsx
    ```

11. **TemplateLayerEditor.tsx**

    ```
    Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TemplateLayerEditor.tsx
    Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TemplateLayerEditor.tsx
    ```

12. **TextToSpeechSection.tsx**

    ```
    Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextToSpeechSection.tsx
    Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextToSpeechSection.tsx
    ```

13. **TextTrackingSection.tsx**

    ```
    Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextTrackingSection.tsx
    Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextTrackingSection.tsx
    ```

14. **TextAiAvatarsSection.tsx**
    ```
    Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TextAiAvatarsSection.tsx
    Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/text/sections/TextAiAvatarsSection.tsx
    ```

**Verification After Phase**:

```bash
npx tsc --noEmit
```

**Expected**: 0 TypeScript errors

```bash
ls -1 src/components/editor/properties/text/tabs/
ls -1 src/components/editor/properties/text/sections/
```

**Expected**: 2 tabs, 12 sections

**Git Commit**: `git commit -m "refactor(properties): move text components to text/ subdirectory"`

---

### Phase 7: Move Image, Effects, Legacy, and Project Components

**Objective**: Relocate remaining components to their appropriate subdirectories

#### Image Components (use smart_relocate):

1. **StickerSettingsSection.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/StickerSettingsSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/image/sections/StickerSettingsSection.tsx
   ```

#### Effects Components (use smart_relocate for EACH):

2. **TimelineEffectSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TimelineEffectSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/effects/sections/TimelineEffectSection.tsx
   ```

   **Dependencies**: Has test file (**tests**/TimelineEffectSection.test.tsx)

3. **EffectsFiltersSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/EffectsFiltersSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/effects/sections/EffectsFiltersSection.tsx
   ```

4. **EffectStylePanel.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/EffectStylePanel.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/effects/sections/EffectStylePanel.tsx
   ```

5. **ChromaKeySection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/ChromaKeySection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/effects/sections/ChromaKeySection.tsx
   ```

6. **TransitionSection.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/TransitionSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/effects/sections/TransitionSection.tsx
   ```

#### Legacy Components (use smart_relocate for EACH):

7. **AdjustmentsSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/AdjustmentsSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/legacy/AdjustmentsSection.tsx
   ```

8. **AdjustStyleSection.tsx**

   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/AdjustStyleSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/legacy/AdjustStyleSection.tsx
   ```

9. **PlaybackSection.tsx**
   ```
   Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/PlaybackSection.tsx
   Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/legacy/PlaybackSection.tsx
   ```

#### Project Components (use smart_relocate for EACH):

10. **ProjectDetailsPanel.tsx**

    ```
    Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/ProjectDetailsPanel.tsx
    Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/project/ProjectDetailsPanel.tsx
    ```

11. **BackgroundInspectorPanel.tsx**
    ```
    Source: /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/BackgroundInspectorPanel.tsx
    Dest:   /Users/AIEraDev/Documents/clypra-family/clypra/src/components/editor/properties/project/BackgroundInspectorPanel.tsx
    ```

**Verification After Phase**:

```bash
npx tsc --noEmit
```

**Expected**: 0 TypeScript errors

```bash
ls -1 src/components/editor/properties/image/sections/
ls -1 src/components/editor/properties/effects/sections/
ls -1 src/components/editor/properties/legacy/
ls -1 src/components/editor/properties/project/
```

**Expected**: 1 image, 5 effects, 3 legacy, 2 project components

**Git Commit**: `git commit -m "refactor(properties): move image, effects, legacy, and project components to respective subdirectories"`

---

### Phase 8: Final Verification and Documentation

**Objective**: Comprehensive verification and cleanup

#### Steps:

1. **Verify all files moved correctly**

   ```bash
   # Check root properties/ for any stray component files (should only see types.ts, data.ts, and subdirs)
   ls -1 src/components/editor/properties/*.tsx 2>/dev/null | wc -l
   ```

   **Expected**: 0 (no .tsx files in root)

2. **Count files in each subdirectory**

   ```bash
   echo "Core:"; ls -1 src/components/editor/properties/core/*.tsx | wc -l
   echo "Shared:"; ls -1 src/components/editor/properties/shared/*.tsx | wc -l
   echo "Video tabs:"; ls -1 src/components/editor/properties/video/tabs/*.tsx | wc -l
   echo "Video sections:"; ls -1 src/components/editor/properties/video/sections/*.tsx | wc -l
   echo "Audio tabs:"; ls -1 src/components/editor/properties/audio/tabs/*.tsx | wc -l
   echo "Audio sections:"; ls -1 src/components/editor/properties/audio/sections/*.tsx | wc -l
   echo "Text tabs:"; ls -1 src/components/editor/properties/text/tabs/*.tsx | wc -l
   echo "Text sections:"; ls -1 src/components/editor/properties/text/sections/*.tsx | wc -l
   echo "Image:"; ls -1 src/components/editor/properties/image/sections/*.tsx | wc -l
   echo "Effects:"; ls -1 src/components/editor/properties/effects/sections/*.tsx | wc -l
   echo "Legacy:"; ls -1 src/components/editor/properties/legacy/*.tsx | wc -l
   echo "Project:"; ls -1 src/components/editor/properties/project/*.tsx | wc -l
   ```

   **Expected**: Core:5, Shared:3, Video tabs:2, Video sections:7, Audio tabs:2, Audio sections:1, Text tabs:2, Text sections:12, Image:1, Effects:5, Legacy:3, Project:2

3. **Run full TypeScript verification**

   ```bash
   npx tsc --noEmit
   ```

   **Expected**: 0 errors

4. **Run all property panel tests**

   ```bash
   npm run test -- src/components/editor/properties/__tests__/
   ```

   **Expected**: All 8 test files pass (tests import from new locations automatically via smart_relocate)

5. **Run full project test suite**

   ```bash
   npm run verify:fast
   ```

   **Expected**: All checks pass

6. **Verify no broken imports in Editor**

   ```bash
   grep -r "from.*PropertiesPanel" src/components/editor/*.tsx
   ```

   **Expected**: All imports updated to new path

7. **Create index.ts barrel exports (optional enhancement)**
   - Consider adding index.ts files in each subdirectory for cleaner imports
   - Example: `src/components/editor/properties/core/index.ts`
   ```typescript
   export { PropertiesPanel } from "./PropertiesPanel";
   export { PropertyPanelHeader } from "./PropertyPanelHeader";
   // etc.
   ```
   **Note**: This is optional and can be done in a follow-up PR

**Final Git Commit**: `git commit -m "refactor(properties): complete reorganization - all 45 components moved to structured hierarchy"`

---

## Summary of Changes

### Files Moved: 45

- **Core**: 5 files (including PropertiesPanel.tsx from parent directory)
- **Shared**: 3 files (1 renamed: SpeedStyleSection → SpeedSection)
- **Video**: 9 files (2 tabs, 7 sections)
- **Audio**: 3 files (2 tabs, 1 section)
- **Text**: 14 files (2 tabs, 12 sections)
- **Image**: 1 file
- **Effects**: 5 files
- **Legacy**: 3 files
- **Project**: 2 files

### Files Unchanged: 27

- **primitives/**: 14 files (unchanged)
- **data/**: 4 files (unchanged)
- ****tests**/**: 8 files (remain in place, imports updated)
- **Root files**: types.ts, data.ts (unchanged)

### Total Files in Scope: 72

- 45 moved
- 27 unchanged

## Critical Success Factors

1. **Use smart_relocate exclusively** - Never use bash `mv` or manual file operations
2. **One file at a time** - Wait for each move to complete before starting the next
3. **Verify after each phase** - Run `npx tsc --noEmit` after phases 2-7
4. **Git commits at phase boundaries** - 7 feature commits + 1 final commit
5. **PropertiesPanel.tsx special attention** - This file is in parent directory and is the most critical move

## Risk Assessment

### Low Risk:

- Moving isolated section components with few dependencies
- Creating directory structure
- Moving legacy components (low usage)

### Medium Risk:

- Moving tab components that are imported by section components
- Moving shared components (used across multiple clip types)

### High Risk:

- Moving PropertiesPanel.tsx from parent directory (imported by main Editor)
- Moving PropertyPanelBody.tsx (imports 20+ components)

**Mitigation**: smart_relocate automatically handles all import updates, reducing risk to near-zero

## Post-Reorganization Opportunities

1. **Barrel exports**: Add index.ts files for cleaner imports
2. **Test organization**: Consider moving tests to match new structure (e.g., `video/__tests__/`)
3. **Shared component extraction**: Identify more shared patterns across clip types
4. **Documentation**: Update architecture docs to reflect new structure
5. **Path aliases**: Consider adding TypeScript path aliases for common imports

## Rollback Plan

If issues arise during any phase:

1. Check the git log: `git log --oneline`
2. Revert to previous phase: `git reset --hard <commit-hash>`
3. Investigate TypeScript errors: `npx tsc --noEmit --listFiles`
4. Re-run the failed phase with increased verification

## Timeline Estimate

- Phase 0: 2 minutes (verification)
- Phase 1: 1 minute (directory creation)
- Phase 2: 10 minutes (5 core files, critical)
- Phase 3: 6 minutes (3 shared files)
- Phase 4: 15 minutes (9 video files)
- Phase 5: 6 minutes (3 audio files)
- Phase 6: 25 minutes (14 text files)
- Phase 7: 20 minutes (11 files across 4 categories)
- Phase 8: 10 minutes (final verification)

**Total Estimated Time**: ~95 minutes (~1.5 hours)

---

## Execution Checklist

- [ ] Phase 0: Pre-flight verification complete
- [ ] Phase 1: Directory structure created
- [ ] Phase 2: Core components moved (5 files)
- [ ] Phase 3: Shared components moved (3 files)
- [ ] Phase 4: Video components moved (9 files)
- [ ] Phase 5: Audio components moved (3 files)
- [ ] Phase 6: Text components moved (14 files)
- [ ] Phase 7: Image/Effects/Legacy/Project moved (11 files)
- [ ] Phase 8: Final verification and documentation
- [ ] All tests passing
- [ ] TypeScript compilation successful
- [ ] Git commits clean and descriptive
- [ ] PR ready for review

---

**Plan Author**: AI Planning Agent  
**Plan Date**: 2024  
**Target Execution**: Immediate (workflow step will execute this plan)  
**Approved By**: Pending user review
