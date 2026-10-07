let isWarmed = false;

/**
 * Eliminate first-interaction hitches by scheduling background warming
 * of lazy workers and filterCacheManager during idle (via requestIdleCallback
 * or idle timer after initial launch / first frame paint).
 */
export function warmBackgroundWorkersAndCachesAtIdle(): void {
  if (isWarmed) return;
  isWarmed = true;

  const scheduleIdle =
    typeof window !== "undefined" && "requestIdleCallback" in window
      ? (window as any).requestIdleCallback.bind(window)
      : (cb: () => void) => setTimeout(cb, 1000);

  scheduleIdle(async () => {
    try {
      const { filterCacheManager } = await import(
        "@/features/filters/cache/filterCache"
      );
      await filterCacheManager.initialize();
    } catch (err) {
      console.debug("[IdleWarmup] filterCacheManager init error:", err);
    }
  });
}
