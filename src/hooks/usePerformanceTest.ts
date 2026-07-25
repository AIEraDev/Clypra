/**
 * React Performance Testing Hooks
 *
 * Usage examples:
 *
 * 1. Track why a component re-renders:
 *    useWhyDidYouUpdate('MyComponent', { prop1, prop2, state1 });
 *
 * 2. Track component mount/unmount:
 *    useComponentLifecycle('MyComponent');
 *
 * 3. Measure render performance:
 *    const renderTime = useRenderTime('MyComponent');
 *
 * 4. Detect unnecessary re-renders:
 *    useRenderOptimization('MyComponent', dependencies);
 */

import { useEffect, useRef } from "react";

const DEBUG_KEY = "vireostudio.debug.performance";

function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage?.getItem(DEBUG_KEY) === "1";
}

/**
 * Hook to debug why a component re-rendered
 * Logs which props/state changed between renders
 */
export function useWhyDidYouUpdate(componentName: string, props: Record<string, any>): void {
  if (!isDebugEnabled()) return;

  const previousProps = useRef<Record<string, any> | undefined>(undefined);

  useEffect(() => {
    if (previousProps.current) {
      const allKeys = Object.keys({ ...previousProps.current, ...props });
      const changedProps: Record<string, { from: any; to: any }> = {};

      allKeys.forEach((key) => {
        if (previousProps.current![key] !== props[key]) {
          changedProps[key] = {
            from: previousProps.current![key],
            to: props[key],
          };
        }
      });

      if (Object.keys(changedProps).length > 0) {
        console.log(`🔄 [${componentName}] Re-render caused by:`, changedProps);
      }
    }

    previousProps.current = props;
  }); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Hook to track component lifecycle (mount/unmount)
 */
export function useComponentLifecycle(componentName: string): void {
  if (!isDebugEnabled()) return;

  const renderCount = useRef(0);
  const mountTime = useRef(Date.now());

  useEffect(() => {
    renderCount.current++;
    console.log(`🟢 [${componentName}] Mounted (render #${renderCount.current})`);

    return () => {
      const lifetime = Date.now() - mountTime.current;
      console.log(`🔴 [${componentName}] Unmounted after ${lifetime}ms (${renderCount.current} renders)`);
    };
  }, [componentName]);

  useEffect(() => {
    if (renderCount.current > 1) {
      console.log(`🔄 [${componentName}] Re-rendered (render #${renderCount.current})`);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Hook to measure component render time
 */
export function useRenderTime(componentName: string): number {
  if (!isDebugEnabled()) return 0;

  const renderStartTime = useRef(performance.now());
  const renderCount = useRef(0);

  useEffect(() => {
    const renderDuration = performance.now() - renderStartTime.current;
    renderCount.current++;

    const emoji = renderDuration < 16 ? "✅" : renderDuration < 50 ? "⚠️" : "🔴";
    const severity = renderDuration < 16 ? "Fast" : renderDuration < 50 ? "Slow" : "Very Slow";

    console.log(`${emoji} [${componentName}] Render #${renderCount.current}: ${renderDuration.toFixed(2)}ms (${severity})`);

    // Reset for next render
    renderStartTime.current = performance.now();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return performance.now() - renderStartTime.current;
}

/**
 * Hook to detect unnecessary re-renders
 * Warns when component re-renders but dependencies haven't changed
 */
export function useRenderOptimization(componentName: string, dependencies: any[]): void {
  if (!isDebugEnabled()) return;

  const renderCount = useRef(0);
  const previousDeps = useRef(dependencies);

  useEffect(() => {
    renderCount.current++;

    if (renderCount.current > 1) {
      const depsChanged = dependencies.some((dep, i) => dep !== previousDeps.current[i]);

      if (!depsChanged) {
        console.warn(`⚠️ [${componentName}] Unnecessary re-render detected! Dependencies unchanged.`);
      }
    }

    previousDeps.current = dependencies;
  }); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Hook to track expensive computations
 */
export function useExpensiveComputation<T>(name: string, computation: () => T, dependencies: any[]): T {
  if (!isDebugEnabled()) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRef(computation()).current;
  }

  const result = useRef<T | undefined>(undefined);
  const renderCount = useRef(0);

  useEffect(() => {
    const start = performance.now();
    result.current = computation();
    const duration = performance.now() - start;

    renderCount.current++;
    console.log(`⚡ [${name}] Computation #${renderCount.current}: ${duration.toFixed(2)}ms`);
  }, dependencies);

  return result.current as T;
}

/**
 * Hook to track state updates
 */
export function useStateTracker<T>(stateName: string, state: T): void {
  if (!isDebugEnabled()) return;

  const previousState = useRef<T>(state);
  const updateCount = useRef(0);

  useEffect(() => {
    if (previousState.current !== state) {
      updateCount.current++;
      console.log(`📝 [State:${stateName}] Update #${updateCount.current}:`, {
        from: previousState.current,
        to: state,
      });
      previousState.current = state;
    }
  }, [state, stateName]);
}

/**
 * Hook to profile a specific function call
 */
export function useProfiledFunction<T extends (...args: any[]) => any>(functionName: string, fn: T): T {
  if (!isDebugEnabled()) return fn;

  const callCount = useRef(0);

  return ((...args: any[]) => {
    const start = performance.now();
    const result = fn(...args);
    const duration = performance.now() - start;

    callCount.current++;

    if (duration > 5) {
      // Only log if takes more than 5ms
      console.log(`⏱️ [${functionName}] Call #${callCount.current}: ${duration.toFixed(2)}ms`);
    }

    return result;
  }) as T;
}

/**
 * Hook to detect memory leaks from effect cleanup
 */
export function useEffectCleanupTracker(componentName: string, effectName: string): void {
  if (!isDebugEnabled()) return;

  useEffect(() => {
    console.log(`🔷 [${componentName}:${effectName}] Effect setup`);

    return () => {
      console.log(`🔶 [${componentName}:${effectName}] Effect cleanup`);
    };
  }, [componentName, effectName]);
}
