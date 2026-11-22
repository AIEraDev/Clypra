/**
 * spatialIndex.ts — 1D Temporal Interval Tree for Clypra Evaluator & Timeline Engine
 *
 * Responsibilities:
 *   1. Sub-millisecond O(log N + K) point lookups for active clips at `time`.
 *   2. O(1) retrieval of overall timeline `maxEndTime`.
 *   3. Zero-heap-allocation querying via caller-supplied output buffers.
 *   4. Boundary tolerance support (default 1e-4s = 0.1ms) for IEEE-754 precision drift.
 *   5. Range queries [startTime, endTime] for timeline viewport windowing.
 */

export interface TimelineIntervalItem {
  id: string;
  startTime: number;
  duration: number;
  [key: string]: any;
}

interface IntervalTreeNode<T extends TimelineIntervalItem> {
  item: T;
  start: number;
  end: number;
  maxEnd: number;
  left: IntervalTreeNode<T> | null;
  right: IntervalTreeNode<T> | null;
}

export const DEFAULT_BOUNDARY_TOLERANCE_SECS = 1e-4; // 0.1ms tolerance

/**
 * Augmented Interval Tree structured as a balanced binary search tree ordered by `startTime`.
 * Each node maintains `maxEnd`, the maximum end timestamp across its entire subtree.
 */
export class TimelineIntervalTree<T extends TimelineIntervalItem> {
  private root: IntervalTreeNode<T> | null = null;
  private readonly _count: number;
  private readonly _maxEndTime: number;

  constructor(items: readonly T[] = []) {
    this._count = items.length;
    if (items.length === 0) {
      this.root = null;
      this._maxEndTime = 0;
      return;
    }

    // Sort items by startTime ascending. For ties, longer durations appear first.
    const sorted = items.slice().sort((a, b) => {
      const diff = a.startTime - b.startTime;
      if (Math.abs(diff) > 1e-7) return diff;
      return (b.startTime + b.duration) - (a.startTime + a.duration);
    });

    this.root = this.buildBalancedTree(sorted, 0, sorted.length - 1);
    this._maxEndTime = this.root ? this.root.maxEnd : 0;
  }

  /** Total number of indexed intervals. */
  get count(): number {
    return this._count;
  }

  /** Maximum end timestamp across all indexed intervals in O(1). */
  get maxEndTime(): number {
    return this._maxEndTime;
  }

  /**
   * Queries all intervals active at `time`.
   * An interval is considered active when:
   *   item.startTime <= time + tolerance && time < (item.startTime + item.duration)
   *
   * @param time Point in timeline seconds to query.
   * @param tolerance Optional boundary tolerance in seconds (default 1e-4s = 0.1ms).
   * @param out Optional reusable output array to eliminate heap allocations.
   * @returns Array containing all active items overlapping `time`.
   */
  queryPoint(
    time: number,
    tolerance: number = DEFAULT_BOUNDARY_TOLERANCE_SECS,
    out?: T[],
  ): T[] {
    const results = out ?? [];
    if (out) {
      out.length = 0;
    }

    if (!this.root || this._count === 0) {
      return results;
    }

    this.searchPoint(this.root, time, tolerance, results);
    return results;
  }

  /**
   * Queries all intervals overlapping a time range [startTime, endTime].
   * An interval [s, e] overlaps the range if:
   *   s <= endTime + tolerance && e >= startTime - tolerance
   *
   * @param startTime Range start in seconds.
   * @param endTime Range end in seconds.
   * @param tolerance Optional boundary tolerance in seconds.
   * @param out Optional reusable output array.
   */
  queryRange(
    startTime: number,
    endTime: number,
    tolerance: number = DEFAULT_BOUNDARY_TOLERANCE_SECS,
    out?: T[],
  ): T[] {
    const results = out ?? [];
    if (out) {
      out.length = 0;
    }

    if (!this.root || this._count === 0 || startTime > endTime) {
      return results;
    }

    this.searchRange(this.root, startTime, endTime, tolerance, results);
    return results;
  }

  private buildBalancedTree(
    items: T[],
    left: number,
    right: number,
  ): IntervalTreeNode<T> | null {
    if (left > right) return null;

    const mid = (left + right) >> 1;
    const item = items[mid];
    const start = item.startTime;
    const end = item.startTime + item.duration;

    const leftNode = this.buildBalancedTree(items, left, mid - 1);
    const rightNode = this.buildBalancedTree(items, mid + 1, right);

    let maxEnd = end;
    if (leftNode && leftNode.maxEnd > maxEnd) {
      maxEnd = leftNode.maxEnd;
    }
    if (rightNode && rightNode.maxEnd > maxEnd) {
      maxEnd = rightNode.maxEnd;
    }

    return {
      item,
      start,
      end,
      maxEnd,
      left: leftNode,
      right: rightNode,
    };
  }

  private searchPoint(
    node: IntervalTreeNode<T> | null,
    time: number,
    tolerance: number,
    out: T[],
  ): void {
    if (!node) return;

    // Prune subtree: if the maximum end in this subtree ended before `time`,
    // no interval in this subtree can reach `time`.
    if (node.maxEnd < time) {
      return;
    }

    // 1. Search left child if its maximum end time reaches or exceeds `time`
    if (node.left && node.left.maxEnd >= time) {
      this.searchPoint(node.left, time, tolerance, out);
    }

    // 2. Check current node overlap
    // Active if: start <= time + tolerance && time < end
    if (node.start <= time + tolerance && time < node.end) {
      out.push(node.item);
    }

    // 3. Search right child if it can contain overlapping intervals.
    // Right subtree has start >= node.start. If node.start > time + tolerance,
    // all right descendants have start > time + tolerance and cannot overlap.
    if (node.right && node.start <= time + tolerance) {
      this.searchPoint(node.right, time, tolerance, out);
    }
  }

  private searchRange(
    node: IntervalTreeNode<T> | null,
    startTime: number,
    endTime: number,
    tolerance: number,
    out: T[],
  ): void {
    if (!node) return;

    // Subtree ends before range starts
    if (node.maxEnd < startTime - tolerance) {
      return;
    }

    // Search left child if it could reach range start
    if (node.left && node.left.maxEnd >= startTime - tolerance) {
      this.searchRange(node.left, startTime, endTime, tolerance, out);
    }

    // Check current node overlap with range
    // Overlap: s <= endTime + tolerance && e >= startTime - tolerance
    if (node.start <= endTime + tolerance && node.end >= startTime - tolerance) {
      out.push(node.item);
    }

    // Search right child if its intervals can start before range ends
    if (node.right && node.start <= endTime + tolerance) {
      this.searchRange(node.right, startTime, endTime, tolerance, out);
    }
  }
}
