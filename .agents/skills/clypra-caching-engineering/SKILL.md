---
name: clypra-caching-engineering
description: >-
  Guides the design, implementation, registration, budgeting, and debugging of Clypra's multi-tier caching
  infrastructure across both Rust native disk caching (UnifiedDiskCacheManager) and TypeScript in-memory caching
  (CacheCoordinator). Use when adding cache namespaces, registering cache participants, configuring LRU eviction weights,
  optimizing RAM/VRAM allocations, debugging cache invalidation or memory leaks, or integrating new media subsystems.
---

# Clypra Multi-Tier Caching Architecture & Engineering Standards

## 1. Mission & Architectural Intent

Clypra is a high-performance desktop video editor demanding 60 FPS interactive timeline scrubbing, instantaneous playhead seeks, real-time waveform generation, multi-resolution filmstrip atlases, and neural rotoscoping masks without starving real-time CPAL audio callbacks or exhausting host RAM/GPU memory.

To achieve this, Clypra implements a **Two-Pillar, Three-Tier Unified Caching Infrastructure**:
1. **Tier 3 Native Disk Pillar (`UnifiedDiskCacheManager`)**: Synchronous-safe Rust singleton governing all on-disk artifacts across 6 isolated namespaces with atomic writes, corrupted file quarantine, weighted LRU eviction, and legacy migration.
2. **Tier 1/2 In-Memory Pillar (`CacheCoordinator`)**: Dynamic RAM-budgeted TypeScript coordinator enforcing memory limits, tracking multi-tier allocations (RAM, GPU VRAM, IndexedDB, Web Workers), and guaranteeing complete session teardown on project close.

### Non-Negotiable Invariants
- **Architecture Invariant 2 (EvaluatedScene Currency & State Reset)**: Session and ephemeral caches must be wiped unconditionally on project close via `getCacheCoordinator().resetSessionCaches()` to prevent cross-project state or frame contamination.
- **Architecture Invariant 9 (Three-Tier Compute Boundary)**: Cache compute is split across Tier 1 (React UI & telemetry), Tier 2 (Web Worker thumbnail decoders & waveform analyzers), and Tier 3 (Rust video decode, audio stem extraction, and atomic disk persistence).
- **Architecture Invariant 10 (Preserve Comments & JSDoc)**: Never delete existing comments or architectural notes when modifying cache participants.
- **Architecture Invariant 16 (Native Thread Safety)**: Global cache singletons in Rust must be synchronous (`parking_lot::RwLock`) to prevent `Cannot start a runtime from within a runtime` panics when called from sync native contexts or audio callbacks.

---

## 2. When to Activate This Skill

Activate this skill whenever a task involves:
- Designing or adding a new on-disk cache namespace or directory.
- Registering a new in-memory, GPU, or worker cache in TypeScript.
- Modifying `CacheCoordinator`, `ICacheParticipant`, or memory budget calculation.
- Adjusting LRU eviction weights, disk limits, or memory trim algorithms.
- Investigating cache-related memory leaks, GPU VRAM exhaustion, or disk bloat.
- Fixing cache corruption, 0-byte orphan files, or atomic file write races.
- Debugging project close / switch cache leakage (Invariant 2).
- Adding or modifying cache settings, telemetry UI, or IPC commands.

---

## 3. High-Level Caching Topology

```text
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 1: FRONTEND UI & CONTROLS (React 19 / TypeScript)                 │
│   • CacheSettings.tsx — Multi-namespace storage breakdown & purge UI   │
│   • useUnifiedCache.ts — Reactive hook bridging IPC & memory telemetry │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ TIER 1 & 2: IN-MEMORY CACHE COORDINATOR (src/core/cache/)              │
│   • Dynamic RAM budget (256 MB – 2048 MB via navigator.deviceMemory)   │
│   • Tier breakdown: "memory" | "gpu" | "indexeddb" | "worker"          │
│   • Lifespans: "ephemeral" | "session" | "persistent"                  │
│   • Participants:                                                      │
│     - ResourceCache (ImageBitmaps, session)                            │
│     - FilmstripTileCache (LOD zoom tiles, session)                     │
│     - globalGPUCache (WebGL/wgpu frame textures, session)              │
│     - EvaluationCache (EvaluatedScenes, session — Invariant 2)         │
│     - waveformCache (PCM audio waveforms, session)                     │
│     - filterCache (LUTs & video shader stages, persistent)             │
│   • resetSessionCaches(): Guaranteed project close cleanup             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Tauri IPC (4 commands)
┌───────────────────────────────────▼────────────────────────────────────┐
│ TIER 3: UNIFIED DISK CACHE MANAGER (src-tauri/src/disk_cache/)         │
│   Root: <AppCache>/clypra_cache/                                       │
│   • 6 Isolated Namespaces:                                             │
│     1. thumbnails/  — WebP pyramid atlases (weight: 0.8)               │
│     2. audio/       — Normalized WAV/FLAC audio stems (weight: 0.6)    │
│     3. proxies/     — H.264 preview proxies (weight: 1.0)              │
│     4. mattes/      — AI rotoscope .clymatte masks (weight: 0.4)       │
│     5. assets/      — Remote LUTs, templates, stickers (weight: 0.2)   │
│     6. temp/        — Scratch renders & active exports (weight: 1.0)   │
│   • Atomic I/O: write to .tmp.<uuid>, sync, atomic rename              │
│   • Corrupted file quarantine: move invalid/0-byte files to quarantine/│
│   • Weighted LRU eviction: effective_age = age * eviction_weight       │
│   • Legacy migration: automatic moving of old ad-hoc folders on start  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Tier 3: Rust Native Disk Cache Standards

### 4.1 Namespace Definition & Eviction Weights

Every disk artifact must belong to an explicit `CacheNamespace` enum variant in `src-tauri/src/disk_cache/types.rs`:

```rust
pub enum CacheNamespace {
    Thumbnails,       // Weight 0.8
    AudioStems,       // Weight 0.6
    PreviewProxies,   // Weight 1.0 (Cheapest to re-encode, pruned first)
    RotoscopeMattes,  // Weight 0.4 (Costly AI compute, preserved longer)
    RemoteAssets,     // Weight 0.2 (Network downloads, highest retention)
    Temp,             // Weight 1.0 (Ephemeral scratch, pruned immediately)
}
```

### 4.2 Atomic Write & Quarantine Invariants

1. **Never write directly to target cache files**. A crash or power loss during writing produces 0-byte or truncated files that poison future reads.
2. **Always write to a unique temporary sibling** (`<target>.tmp.<uuid>`), flush, and perform an OS atomic rename:
   ```rust
   use crate::disk_cache::atomic_io::atomic_write_file;

   atomic_write_file(&target_path, &data)?;
   ```
3. **Quarantine on corruption**: If a cache entry is detected to have 0 bytes or an invalid magic header, never leave it in place or delete it silently. Move it to `<AppCache>/clypra_cache/quarantine/` so telemetry can record disk health:
   ```rust
   use crate::disk_cache::atomic_io::validate_or_quarantine;

   if !validate_or_quarantine(&cached_file, minimum_valid_bytes) {
       // File was corrupted and moved to quarantine; regenerate fresh artifact
   }
   ```

### 4.3 Synchronous Global Singleton Pattern

The global disk cache manager must be accessed synchronously to avoid async runtime conflicts:
```rust
use crate::disk_cache::manager::get_global_disk_cache;

if let Some(cache_mgr) = get_global_disk_cache() {
    let target = cache_mgr.resolve_path(CacheNamespace::AudioStems, "clip_hash.wav");
    // read or record hit/miss
    cache_mgr.record_hit();
}
```
*Note*: Do **NOT** use `tokio::sync::RwLock` for `get_global_disk_cache()`. It must use `parking_lot::RwLock` to allow synchronous calling from background threads, audio callbacks, and sync Tauri commands without deadlocking or panicking.

---

## 5. Tier 1/2: TypeScript In-Memory `CacheCoordinator` Standards

### 5.1 The `ICacheParticipant` Contract

Every in-memory cache must implement `ICacheParticipant` and register with `getCacheCoordinator()`:

```typescript
export interface ICacheParticipant {
  /** Unique domain identifier (e.g., 'resource-cache', 'filmstrip-tile-cache') */
  name: string;
  /** Storage tier level */
  tier?: "memory" | "gpu" | "indexeddb" | "worker";
  /** Lifespan scope */
  lifespan?: "ephemeral" | "session" | "persistent";
  /** Estimated memory consumption in bytes */
  getBytesUsed(): number;
  /** Trim oldest entries until under targetBytes. Returns bytes freed. */
  trimTo(targetBytes: number): number;
  /** Clear all cached entries unconditionally. Can be sync or async. */
  clear(): void | Promise<void>;
  /** Optional hit/miss telemetry */
  getMetrics?(): { hits?: number; misses?: number; entryCount?: number };
}
```

### 5.2 Dynamic Memory Budgeting

Never hardcode memory limits (e.g. `const MAX_RAM = 500 * 1024 * 1024`). Always leverage dynamic host RAM detection via `detectDefaultMemoryBudget()`:
- 4 GB host RAM → 256 MB cache budget
- 8 GB host RAM → 512 MB cache budget
- 16 GB host RAM → 1024 MB cache budget
- 32+ GB host RAM → 2048 MB cache budget (clamped ceiling)

### 5.3 Resource Cleanup & Handle Leaks

When implementing `trimTo()` or `clear()` on an in-memory participant:
- **`ImageBitmap`**: Explicitly call `.close()` on each bitmap before removing from the map.
- **GPU Textures**: Call `.destroy()` or release the `wgpu` / WebGL texture handle.
- **Audio Buffers**: Zero references to allow immediate Garbage Collection.
- **Web Workers**: Post `{ type: "DISPOSE" }` or terminate workers if recreating.

---

## 6. Project Lifecycle & Invariant 2 Teardown Protocol

When closing a project in `src/core/runtime/ProjectStateReset.ts`:

1. **Unconditional Session Teardown**:
   ```typescript
   // Phase 4 in ProjectStateReset.ts
   const { getCacheCoordinator } = await import("@/core/cache/cacheCoordinator");
   await getCacheCoordinator().resetSessionCaches();
   ```
   This clears all participants marked with `lifespan: "ephemeral"` or `lifespan: "session"`.
2. **Conditional Disk Cache Purge**:
   If the user has enabled `autoClearCacheOnProjectClose` in `settingsStore`:
   ```typescript
   if (autoClear && isTauriRuntime()) {
     const { invoke } = await import("@tauri-apps/api/core");
     await invoke("purge_unified_cache", {
       filter: { namespaces: ["thumbnails", "preview_proxies"] }
     });
   }
   ```
   *Rule*: Never purge `RotoscopeMattes` or `RemoteAssets` on project close unless explicitly requested by the user, as recomputing AI neural mattes is computationally expensive.

---

## 7. Implementation Recipes

### Recipe A: Registering a New Cache Participant in TypeScript

```typescript
import { getCacheCoordinator, type ICacheParticipant } from "@/core/cache/cacheCoordinator";

export class SubsystemCacheManager implements ICacheParticipant {
  readonly name = "my-subsystem-cache";
  readonly tier = "memory";
  readonly lifespan = "session";

  private cache = new Map<string, { data: Uint8Array; lastAccessed: number }>();
  private currentBytes = 0;

  getBytesUsed(): number {
    return this.currentBytes;
  }

  trimTo(targetBytes: number): number {
    const initial = this.currentBytes;
    if (this.currentBytes <= targetBytes) return 0;

    // Evict oldest by lastAccessed
    const sorted = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed
    );

    for (const [key, entry] of sorted) {
      if (this.currentBytes <= targetBytes) break;
      this.currentBytes -= entry.data.byteLength;
      this.cache.delete(key);
    }

    return initial - this.currentBytes;
  }

  clear(): void {
    this.cache.clear();
    this.currentBytes = 0;
  }
}

// Auto-register singleton
export const mySubsystemCache = new SubsystemCacheManager();
getCacheCoordinator().register(mySubsystemCache);
```

### Recipe B: Storing a Media Artifact in Rust Disk Cache

```rust
use crate::disk_cache::manager::get_global_disk_cache;
use crate::disk_cache::types::CacheNamespace;
use crate::disk_cache::atomic_io::atomic_write_file;

pub fn save_media_artifact(cache_key: &str, raw_bytes: &[u8]) -> Result<PathBuf, String> {
    let cache_mgr = get_global_disk_cache()
        .ok_or_else(|| "Disk cache manager uninitialized".to_string())?;

    let file_name = format!("{}.bin", cache_key);
    let target_path = cache_mgr.resolve_path(CacheNamespace::Thumbnails, &file_name);

    atomic_write_file(&target_path, raw_bytes)
        .map_err(|e| format!("Atomic write failed: {}", e))?;

    // Prune in background if over budget
    cache_mgr.prune_if_needed();

    Ok(target_path)
}
```

---

## 8. Anti-Patterns to Avoid

| Anti-Pattern | Fatal Risk | Correct Pattern |
|---|---|---|
| **Secondary Cache Clocks / Independent Budget Maps** | Uncoordinated memory growth leading to OOM crashes. | Register as `ICacheParticipant` in `CacheCoordinator`. |
| **Direct File Overwrites in Disk Cache** | Power loss / crash results in 0-byte corrupt files. | Use `atomic_write_file` (.tmp → atomic rename). |
| **Calling Async RwLock in Native Callbacks** | `Cannot start a runtime from within a runtime` crash. | Use `parking_lot::RwLock` for synchronous singleton access. |
| **Omitting `ImageBitmap.close()` on Eviction** | Native memory leak outside JS garbage collector. | Call `bitmap.close()` immediately upon eviction. |
| **Retaining Session State Across Projects** | Cross-project frame leaks (Architecture Invariant 2). | Ensure participant is `lifespan: "session"` and cleared in `resetSessionCaches()`. |
| **Hardcoding User-Facing Text in Settings** | Breaks i18n parity across 9 supported languages. | Use `settings.storage.*` semantic keys in `en.json` & all catalogs. |

---

## 9. Verification & Quality Gates

Any cache modification must pass all five verification pillars before merging:

1. **Rust Unit & Corruption Tests**:
   ```bash
   cargo test --manifest-path src-tauri/Cargo.toml disk_cache
   cargo test --manifest-path src-tauri/Cargo.toml filmstrip_corruption
   ```
2. **TypeScript Coordinator Tests**:
   ```bash
   npx vitest run src/core/cache/
   npx vitest run src/core/resources/__tests__/ResourceCache.test.ts
   npx vitest run src/lib/filmstrip/__tests__/FilmstripTileCache.test.ts
   ```
3. **Strict Type Integrity**:
   ```bash
   npx tsc --noEmit  # 0 errors mandatory
   ```
4. **i18n Catalog Parity**:
   ```bash
   npm run i18n:check  # 100% key and placeholder parity across all 9 locales
   ```
5. **Universal Architecture Gate**:
   ```bash
   npm run verify:architecture
   ```
