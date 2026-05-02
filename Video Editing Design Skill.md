# Video Editing Design Skill

## Objective
Create and evolve video-editing UI/UX with maximum consistency, implementation quality, and production readiness for this codebase.

This skill is optimized for:
- Frontend: React 19 + TypeScript + Vite 7
- Desktop runtime: Tauri 2
- Styling: Tailwind CSS 4 + shadcn/radix patterns + Lucide icons
- State: Zustand stores
- Backend integration: Tauri commands in Rust (`src-tauri/src`)

## Project Context Detection
Before proposing or implementing design changes, anchor decisions to this repository structure:

- Frontend app root: `src/`
- Core editor UI: `src/components/editor/`
- Timeline UI: `src/components/editor/timeline/`
- Generic UI primitives: `src/components/ui/`
- Video playback components: `src/components/video/`
- App screens: `src/components/screens/`
- Hooks: `src/hooks/`
- Global/state stores: `src/store/`
- Shared utils and Tauri bridge: `src/lib/`
- Constants/theme tokens: `src/constants/`
- Tauri/Rust backend: `src-tauri/src/` (`commands/`, `models/`)

## Non-Negotiable Design Principles
1. Keep editor behavior predictable: no hidden controls, no surprising timeline mutations.
2. Preserve visual consistency across editor panels, timeline controls, and top-level actions.
3. Prefer composition over ad-hoc UI patterns; reuse existing UI primitives first.
4. Maintain type safety end-to-end (component props, store actions, command payloads).
5. Optimize for editing speed: high information density, clear affordances, low click count.
6. Design for desktop-first precision (mouse + keyboard), while avoiding fragile layouts.

## Language, Framework, and Tooling Rules
1. Use TypeScript for all UI logic and strongly typed interfaces in `src/types`.
2. Use React functional components and hooks only.
3. Use existing Zustand stores (`projectStore`, `timelineStore`, `playbackStore`, `uiStore`) instead of local duplicated state.
4. Put cross-component logic in hooks (`src/hooks`) or stores, not deeply nested component state.
5. Keep Tailwind class usage consistent with existing patterns in `src/index.css` and shadcn style config (`components.json`).
6. Use `@/` aliases from `components.json` and `tsconfig` for imports when possible.
7. For native or filesystem-heavy operations, route through Tauri command boundaries, not direct browser assumptions.

## UI/UX System for Consistent Video Editing Design
1. Panel Architecture:
- Maintain a clear 3-zone editor mental model: media/tools, preview, timeline/properties.
- Avoid adding panels without defining their interaction priority and collapse behavior.

2. Timeline Behavior:
- Timeline operations must be deterministic (drag, trim, split, move, zoom).
- Any timeline affordance must have visual feedback for hover, active, selected, and disabled states.
- Preserve ruler, playhead, and clip alignment semantics; never fake time positions visually.

3. Controls and Actions:
- Primary actions (import, export, play/pause, cut) must stay visually prominent and stable.
- Destructive operations require confirmation or undo-safe flow.
- Keyboard shortcuts should map to common editor conventions when possible.

4. Typography and Color:
- Use existing typography and tokenized colors from project constants and CSS variables.
- Do not introduce one-off color values when token equivalents exist.
- Ensure sufficient contrast for timeline text, handles, markers, and overlays.

5. Empty, Loading, and Error States:
- Every new visual surface must define empty/loading/error behavior.
- Error states must be actionable (retry, clear instruction), not decorative.

6. Motion and Feedback:
- Keep motion purposeful and short; avoid heavy animations on timeline operations.
- Use subtle transitions to clarify state changes, never to hide latency.

## Implementation Workflow (Required)
1. Discovery:
- Read relevant components, hooks, stores, and constants before proposing structural UI changes.
- Identify whether behavior belongs in component, hook, store, or Tauri command.

2. Design Spec in Code Terms:
- Define user goal, interaction steps, and state transitions.
- List impacted files by directory responsibility before editing.

3. Build:
- Reuse `src/components/ui` primitives and existing editor/timeline patterns.
- Keep components small; extract reusable UI and logic early.
- Add concise comments only where timeline or synchronization logic is non-obvious.

4. Validate:
- Run `npm run build` for type/build safety.
- Run targeted tests or `npm test` when behavior/state logic is touched.
- Verify no regressions in timeline rendering, playback sync, and panel layout.

5. Final Consistency Check:
- Ensure naming, spacing, iconography, and interaction states match nearby components.
- Confirm dark-theme readability and no clipped controls in core editor layouts.

## Directory-Specific Responsibilities
1. `src/components/editor/`:
- High-level editor layout and cross-panel orchestration.
- Do not place heavy business logic here; delegate to hooks/stores.

2. `src/components/editor/timeline/`:
- Timeline visuals and interaction components only.
- Time math and shared behavior should be centralized, not duplicated per component.

3. `src/components/ui/`:
- Reusable primitives and generic building blocks.
- No editor-specific business logic.

4. `src/hooks/`:
- Reusable stateful flows (playback, timeline interaction, media import, keyboard shortcuts).

5. `src/store/`:
- Canonical app state and actions.
- Any multi-panel state belongs here, not in isolated component trees.

6. `src-tauri/src/commands/`:
- Native operations, media I/O, and command-facing orchestration.
- Keep JSON payloads stable and explicitly typed on both sides.

## Quality Gates
A design/task is not complete unless all pass:
1. Visual consistency with existing editor and timeline surfaces.
2. No duplicated state source for the same concern.
3. Clean type checks and successful build.
4. No obvious accessibility regressions (focus visibility, contrast, keyboard reachability).
5. Interaction remains responsive under realistic timeline complexity.

## Anti-Patterns to Reject
1. One-off CSS/inline styles that bypass established design tokens.
2. Introducing new state containers when existing Zustand stores already model the concern.
3. Mixing timeline math across multiple components without a shared source of truth.
4. UI additions that look polished but break editing speed or precision.
5. Feature work without empty/loading/error states.

## Output Contract for Future Design Tasks
For every substantial UI/UX change, provide:
1. Short intent summary.
2. Files changed grouped by responsibility.
3. State model impact (stores/hooks/commands).
4. Validation performed (`build`, tests, manual interaction checks).
5. Known limitations and next hardening steps.

