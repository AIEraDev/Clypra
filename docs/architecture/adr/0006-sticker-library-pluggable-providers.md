# ADR-0006: Sticker Library with Pluggable Providers and Sub-Tab Browsing

## Status

Proposed (revised after independent review)

## Context & Problem Statement

Clypra's Stickers tab is currently a single list with a search box, category
pills, and a three-column grid. The product needs a professional browsing
experience with sub-tabs in the same style as the Text tab: trending,
favorites, recents, imports, shapes, and an online GIF/sticker source. The
interaction pattern is a reference only; no third-party branding or assets are
copied.

The sticker catalog is served by the sibling `clypra-api` repository. Clypra
has no premium concept, so premium badges are not rendered. GIPHY is included
as a provider boundary, but remains disabled until its key, attribution,
storage, export, and privacy requirements are cleared.

Verified repository facts:

- The frontend currently fetches `/stickers` and `/stickers/{category}` with
  ETag revalidation and falls back to bundled Lottie starters.
- The placement engine resolves a cached sticker and dispatches
  `AddClipCommand` through the history store.
- `EvaluatedScene` is the canonical render input. The worker raster path
  currently supports Lottie; the native preview has a separate GIF branch.
- Project serialization stores only `stickerFormat`,
  `stickerAnimationPath`, and `stickerSourceId`.
- The sticker cache is file-backed but reports an IndexedDB tier, writes files
  directly, returns zero from synchronous `trimTo`, and does not protect
  favorites or project references.
- The sidebar unmounts inactive top-level tabs, so component-local sticker
  browsing state is lost.
- The sibling `clypra-api` repository is available in the workspace. Its
  current sticker routes are not cursor-paginated and do not provide server
  search; the manifest schema contains richer license, hash, and dimension
  metadata than the current summary response.

## Decision

Introduce a provider abstraction, persisted provenance, an explicit format
support matrix, and a storage model that separates evictable cache data from
user-owned library data. Implement foundations before the visible UI.

### Persisted reference and migration

Every sticker clip stores a stable reference:

```ts
interface StickerRef {
  providerId: string;
  itemId: string;
  contentHash?: string;
  revisionId?: string;
  format: StickerFormat;
  license?: {
    spdx: string;
    author: string;
    attributionRequired: boolean;
    sourceUrl?: string;
    attributionText?: string;
  };
  shape?: ShapeSpec;
}
```

`contentHash` identifies the complete stored primary artifact bytes, not a
thumbnail or metadata document. `revisionId` identifies the provider revision
used to obtain it. Resolution prefers the immutable hash/revision and uses
`providerId:itemId` only to rediscover an artifact when the local copy is
missing.

Shape parameters are a discriminated, bounded `ShapeSpec` stored in the
project; they are not represented as cache entries. Animation controls remain
in `StickerSettings` and are separate from shape-generation parameters.

Legacy projects containing only `stickerSourceId` load without failure. A
starter id maps to `bundled`; all other ids map to `catalog`, with unknown hash
and revision. A legacy fixture covers this migration. The new reference is
added to both TypeScript and Rust serialization models while old files remain
readable.

### Provider contract

Provider resolution is format-neutral:

```ts
interface StickerProvider {
  id: string;
  capabilities: {
    canStore: boolean;
    requiresNetwork: boolean;
    attributionRequired: boolean;
    formats: StickerFormat[];
  };
  sections(): Promise<StickerSection[]>;
  list(section: string, cursor?: string): Promise<Page<StickerItem>>;
  search(query: string, cursor?: string): Promise<Page<StickerItem>>;
  resolve(ref: StickerRef): Promise<StickerResolution>;
}

type StickerResolution =
  | { kind: "local"; artifact: StickerArtifact }
  | {
      kind: "unavailable";
      reason: "storage-prohibited" | "unsupported-format" | "offline" | "missing";
    };
```

`StickerArtifact` is a discriminated union for Lottie JSON, static raster/vector
assets, animated image assets, generated shapes, and imported library assets.
It is not the current Lottie-shaped `CachedSticker` record. Cache records may
wrap artifacts but do not define the provider contract.

GIPHY implements `canStore: false`; its resolver returns `unavailable` with
`storage-prohibited` until a compliant storage and export policy is approved.

### Format support matrix

One resolver decides how formats are handled. Animated content is never
silently treated as static.

| Format | Preview | Export | Cache | Status |
| --- | --- | --- | --- | --- |
| Lottie | Worker raster to native | Same path | Yes | Supported |
| Static PNG, SVG, WebP | Static image layer | Same | Yes | Supported |
| GIF | Native video graph, after verification | After verification | Yes | Phase 3 |
| Animated WebP | Dedicated path required | Dedicated path required | Yes | Phase 3 |
| APNG | Dedicated path required | Dedicated path required | Yes | Phase 3 |

An unsupported animated format resolves as `unsupported-format`, or uses an
explicit first-frame fallback with a visible indicator. The placement engine
sets `stickerFormat` from this matrix rather than inferring it from a path.

### Storage ownership

The cache and library are separate:

- The file-backed cache is evictable and uses atomic temporary-file writes and
  rename, provider-scoped keys, accurate byte accounting, and the `disk` cache
  tier.
- The user-owned library contains imports, favorites metadata, and recents.
  Imports are copied with a content hash and are never evicted by cache trim.
- Cache entries referenced by open or saved projects, or by favorites, are
  pinned. Phase 0 uses an explicit project-reference index owned by the
  library/cache boundary; index updates are atomic and stale references are
  tolerated until reconciliation.
- Each entry has explicit ownership: `cache`, `library`, or `pinned`.

The shared `CacheCoordinator` contract remains synchronous for in-memory
participants. Disk eviction is accounted for synchronously from the index and
deletion is queued/awaited separately; a future coordinator-wide async trim is
not introduced in this phase.

### UI and state

The sticker panel follows the Text tab: header action, divider, horizontally
scrollable `SubTabPills`, optional search/filter controls, and a scrollable
content area. The shared pill component is used by both Text and Stickers.

Ephemeral sticker UI state stores active sub-tab, search text, and scroll
position because the sidebar unmounts inactive tabs. The grid is virtualized;
tiles use static thumbnails and animate only on hover. Loading, empty, offline,
and error states are explicit and accessible. All application-owned strings use
the canonical i18n catalogs across all supported locales.

The initial sub-tabs are Stickers, Shapes, Yours (recents, favorites, and
imports), and a disabled-by-default GIPHY tab. Existing catalog endpoints are
used through a compatibility adapter until versioned sections, cursor
pagination, and server search are available.

### Shapes and animated images

Shapes are generated as bounded parametric Lottie for the existing render path.
The first set is rectangle, rounded rectangle, circle, ellipse, triangle, star,
heart, arrow, line, speech bubble, and polygon. Fill, stroke, and corner radius
regenerate the artifact; the parameter spec is persisted in the project.

Before adding a decoder, Phase 3 verifies the existing native GIF path for
transparency, frame timing, looping, preview, and export. Only unsupported
formats receive new decoding paths, with limits on dimensions, frame count,
bytes, and complexity.

### Backend and licensing

The current API remains compatible while a versioned shared schema adds
sections, cursor/limit pagination, server search, and complete SPDX license
metadata. The canonical manifest schema is owned by the API contract package
and consumed by both repositories; contract tests run in both repositories.

GIPHY remains behind a disabled setting and requires a production key,
attribution, a one-time privacy notice and consent, rate-limit handling, and
written confirmation of storage/export policy. Query text is never sent to
telemetry. Requests are not proxied without provider approval.

Bundled assets must have a verified license that permits shipping and use in
exports. CC-BY and CC BY-SA content requires an explicit credits/export policy
before it is bundled.

## Alternatives Considered

- Keep one list with category pills: rejected because it does not scale.
- Use a side rail: rejected by the product owner; sub-tabs match Text.
- Hard-wire GIPHY into the tab: rejected in favor of a provider boundary.
- Cache or proxy GIPHY media: rejected pending written approval and because
  the documented restrictions conflict with the normal cache/export pipeline.
- Keep only `stickerSourceId`: rejected because ids collide and do not survive
  catalog changes or eviction.
- Store imports in the evictable cache: rejected because user data must not be
  evicted.
- Bundle share-alike packs immediately: deferred until export obligations are
  defined.

## Consequences & Trade-offs

- **Positive**: projects retain provenance; missing assets are diagnosable;
  unsupported formats cannot silently degrade; user-owned data is protected;
  providers and backend evolution are decoupled from the rendering pipeline.
- **Negative / Costs**: project migration, Rust model changes, cache/library
  work, provider contracts, UI state and localization work, and additional
  behavior tests.
- **Risks & Mitigations**: tolerant legacy reads, atomic writes and recovery
  tests, pinning tests, explicit unavailable states, shared schema tests,
  bounded animated decoding, and feature flags for staged rollback.

## Verification & Migration Strategy

Implementation is phased and independently verifiable:

0. **Foundations**: references and migration in TypeScript/Rust, provider
   registry, format resolver, cache hardening, library ownership and pinning.
1. **Visible UI**: shared pills, ephemeral state, virtualized browsing, Yours,
   Shapes, imports, localization, and removal of premium presentation.
2. **Backend contract**: versioned sections, cursor pagination, search, shared
   schema, license validation, and client fallback migration.
3. **Animated images**: verify GIF first; implement only missing paths with
   preview/export parity and resource limits.
4. **GIPHY**: enable only after key, attribution, privacy, storage, export, and
   rate-limit preconditions are approved.

Every phase requires targeted unit/integration tests, `npx tsc --noEmit`,
`npm run i18n:check`, affected sticker/render tests, and the applicable Clypra
quality gates. Legacy projects are read through the additive mapping and are
not rewritten unless the user saves them. The current tab remains available
behind a feature flag until the provider shell is stable.

Open decisions retained for implementation review:

- project-reference reconciliation details;
- GIF transparency and export behavior;
- CC-BY export credits;
- first bundled packs and verified licenses;
- curated versus usage-based trending;
- written GIPHY storage/export policy;
- whether future cross-device sync changes library ownership.
