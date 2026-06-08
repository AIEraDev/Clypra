# Export Pipeline Performance Analysis & Solutions

## Why Is Export Slow? Root Causes

### 1. **Sequential Frame Processing (Main Bottleneck)**

**Location:** `src/lib/videoExport.ts` lines 207-275

```typescript
// CURRENT: Sequential processing - ONE frame at a time
for (let i = 0; i < frameTimes.length; i++) {
  const time = frameTimes[i];

  // 1. Find active clips (synchronous loop)
  for (const clip of clips) { ... }

  // 2. Acquire video elements (await each)
  const video = await videoPool.acquire(resolvedPath, sourceTime);

  // 3. Schedule ONE frame render (await)
  const jobId = scheduler.schedule({ time, ... });
  const result = await scheduler.wait(jobId);

  // 4. Write ONE frame to FFmpeg (await)
  await invoke("write_export_frame", imageData);

  // 5. Release video elements (synchronous)
  for (const video of videoElements.values()) { ... }

  completedFrames++;
}
```

**Problem:** Each frame waits for the previous frame to complete entirely.

**Time per frame:**

- Video seek: ~5-10ms
- Frame render: ~10-30ms (GPU)
- FFmpeg write: ~5-15ms (IPC + encoding)
- **Total: ~20-55ms per frame**

**At 30 fps for 60 seconds:**

- 1800 frames × 40ms avg = **72 seconds minimum**
- Plus overhead = **90+ seconds for 1 minute video**

---

### 2. **No Frame Render Batching**

The scheduler is called once per frame with no look-ahead or batch optimization. Modern GPUs can render multiple frames in parallel.

---

### 3. **Video Seeking Overhead**

Every frame triggers individual `videoPool.acquire()` calls, causing redundant seeks when the same video is used across consecutive frames.

---

### 4. **No Frame Buffer Pipeline**

The export doesn't use a producer-consumer pattern:

- **Current:** Render frame → Wait → Write frame → Render next
- **Optimal:** Render frames ahead into buffer → FFmpeg consumes from buffer

---

### 5. **Text Effects Network Fetch During Export**

**Location:** `src/core/render/rasterizer.ts` lines 428-460

If a text effect definition is missing from cache during export, the rasterizer attempts to fetch it:

```typescript
store
  .fetchDefinitionOnlyById(layer.styleId)
  .then(() => {
    /* invalidate cache and redraw */
  })
  .catch((err) => console.error(`Failed to load text effect`));
```

This causes:

- Network latency blocking frame render
- Retry attempts if fetch fails
- Inconsistent export times depending on cache state

---

## Solutions

### Solution 1: Parallel Frame Rendering (10x Faster)

**Concept:** Render N frames ahead in parallel, queue them for FFmpeg

```typescript
// NEW: Parallel rendering with buffer
const RENDER_BATCH_SIZE = 10; // Render 10 frames ahead
const frameBuffer: Array<{ index: number; imageData: ImageData }> = [];

// Producer: Render frames in parallel
const renderPromises = [];
for (let i = 0; i < Math.min(RENDER_BATCH_SIZE, frameTimes.length); i++) {
  renderPromises.push(renderFrame(i));
}

// Consumer: Write frames to FFmpeg as they complete
for (let i = 0; i < frameTimes.length; i++) {
  const frame = await renderPromises[i];
  await invoke("write_export_frame", frame.imageData);

  // Start next frame render (keep N frames in flight)
  if (i + RENDER_BATCH_SIZE < frameTimes.length) {
    renderPromises.push(renderFrame(i + RENDER_BATCH_SIZE));
  }
}
```

**Expected speedup:** 5-10x faster (limited by FFmpeg encoding speed, not render)

---

### Solution 2: Text Effect Persistent Cache

**Problem:** Effects stored only in memory (`useEffectsStore.definitions`)

**Solution:** IndexedDB persistent cache with memory fallback

```typescript
// NEW: Persistent effect cache
class TextEffectCache {
  private memoryCache: Map<string, EffectDefinition> = new Map();
  private db: IDBDatabase;

  async get(id: string): Promise<EffectDefinition | null> {
    // 1. Check memory first (fast)
    if (this.memoryCache.has(id)) return this.memoryCache.get(id);

    // 2. Check IndexedDB (persistent)
    const cached = await this.getFromIndexedDB(id);
    if (cached) {
      this.memoryCache.set(id, cached); // Warm memory cache
      return cached;
    }

    return null;
  }

  async set(id: string, definition: EffectDefinition): Promise<void> {
    // Store in both memory and IndexedDB
    this.memoryCache.set(id, definition);
    await this.setInIndexedDB(id, definition);
  }
}
```

**Benefits:**

- Effects persist across app restarts
- No network fetch during export (already on disk)
- Professional app behavior (like Premiere, After Effects)

---

### Solution 3: Close Export Modal While Exporting

**Current:** Modal blocks user from continuing work

**Solution:** Background export with notification

```typescript
// NEW: Detached export process
interface ExportJob {
  id: string;
  status: 'exporting' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  outputPath: string;
  startTime: number;
}

// Store export jobs globally
const exportJobsStore = create<{
  jobs: Map<string, ExportJob>;
  activeJobId: string | null;
}>(...);

// Start export in background
const jobId = startBackgroundExport({...config});

// Close modal immediately
onClose();

// Show progress notification/badge
<ExportProgressIndicator jobId={jobId} />
```

**User experience:**

- Click "Start Export" → modal closes
- Small progress indicator in corner (like Chrome downloads)
- Notification when complete
- Can start multiple exports (queue)

---

### Solution 4: Enable DevTools in Production

**Current:** DevTools disabled in production builds

**Location:** `src-tauri/tauri.conf.json` or main window setup

**Solution:** Add keyboard shortcut to toggle DevTools

```typescript
// In Tauri config or window setup
{
  "devtools": true, // Enable in production

  // Or add keyboard shortcut
  "shortcuts": {
    "F12": "toggle_devtools"
  }
}
```

**Alternative:** Use Tauri's built-in DevTools toggle:

```rust
// src-tauri/src/main.rs
#[cfg(not(debug_assertions))]
window.open_devtools(); // Enable in release mode
```

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 hours)

1. ✅ **Text Effect Persistent Cache** - Implement IndexedDB storage
2. ✅ **Close Export Modal** - Detach export process
3. ✅ **Enable DevTools** - Add production toggle

### Phase 2: Performance (4-6 hours)

4. **Parallel Frame Rendering** - Batch render with buffer
5. **Video Pool Optimization** - Smart seeking, frame reuse

### Phase 3: Polish (2-4 hours)

6. **Export Queue System** - Multiple concurrent exports
7. **Hardware Acceleration** - GPU-optimized rendering path

---

## Expected Results After Fixes

| Metric                       | Before             | After Phase 1       | After Phase 2 |
| ---------------------------- | ------------------ | ------------------- | ------------- |
| 60s video export time        | 90s                | 85s                 | 15-20s        |
| Text effect load (first use) | Network fetch      | Disk read (instant) | Same          |
| User workflow interruption   | Blocked until done | Can continue work   | Same          |
| DevTools access              | Not available      | F12 toggle          | Same          |

---

## Code Files to Modify

1. `src/lib/videoExport.ts` - Add parallel rendering
2. `src/features/text-effects/cache/persistentCache.ts` - New file
3. `src/features/text-effects/store/effectsStore.ts` - Integrate persistent cache
4. `src/store/exportJobsStore.ts` - New file for background jobs
5. `src/components/ui/ExportDialog.tsx` - Detach export process
6. `src/components/ui/ExportProgressIndicator.tsx` - New file
7. `src-tauri/tauri.conf.json` - Enable devtools

---

## Notes

- Parallel rendering limited by GPU memory (safe batch size: 10-20 frames)
- FFmpeg encoding is CPU-bound and can't be parallelized per-stream
- Bottleneck shifts from render → encode after optimization
- Consider hardware encoders (NVENC, VideoToolbox) for 50%+ speedup
