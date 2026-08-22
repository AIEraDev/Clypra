import { describe, it, expect } from 'vitest';
import { HysteresisController } from '../hysteresis';
import { SpatialTier, DEFAULT_SRP_CONFIG } from '../types';

describe('HysteresisController — overshoot threshold', () => {
  it('does not commit without 10% overshoot past upper boundary', () => {
    let t = 0;
    const ctrl = new HysteresisController(SpatialTier.L0, DEFAULT_SRP_CONFIG, () => t);
    // L0 upper boundary is 0.5. 10% overshoot = 0.55.
    // Zoom to 0.52 — below overshoot threshold.
    const result = ctrl.update(0.52, SpatialTier.L1);
    expect(result).toBeNull();
    expect(ctrl.currentTier).toBe(SpatialTier.L0);
  });

  it('commits after 10% overshoot + 200ms debounce', () => {
    let t = 0;
    const ctrl = new HysteresisController(SpatialTier.L0, DEFAULT_SRP_CONFIG, () => t);
    // Zoom to 0.56 (>10% past 0.5 boundary) — triggers candidate update
    ctrl.update(0.56, SpatialTier.L1);
    expect(ctrl.candidateTier).toBe(SpatialTier.L1);
    // Before debounce expires
    t = 100;
    expect(ctrl.update(0.56, SpatialTier.L1)).toBeNull();
    // After 200ms
    t = 210;
    const committed = ctrl.update(0.56, SpatialTier.L1);
    expect(committed).toBe(SpatialTier.L1);
    expect(ctrl.currentTier).toBe(SpatialTier.L1);
  });

  it('does not commit without 10% overshoot past lower boundary', () => {
    let t = 0;
    const ctrl = new HysteresisController(SpatialTier.L1, DEFAULT_SRP_CONFIG, () => t);
    // L1 lower boundary is 0.5. 10% below = 0.45.
    // Zoom to 0.48 — above threshold, no commit.
    const result = ctrl.update(0.48, SpatialTier.L0);
    expect(result).toBeNull();
    expect(ctrl.currentTier).toBe(SpatialTier.L1);
  });

  it('resets candidate when zoom returns to safe zone', () => {
    let t = 0;
    const ctrl = new HysteresisController(SpatialTier.L0, DEFAULT_SRP_CONFIG, () => t);
    ctrl.update(0.56, SpatialTier.L1); // candidate = L1
    // Zoom back inside safe zone of L0
    ctrl.update(0.4, SpatialTier.L0);
    expect(ctrl.candidateTier).toBe(SpatialTier.L0);
  });
});

describe('HysteresisController — rate limiting', () => {
  it('allows max 1 commit per 200ms', () => {
    let t = 0;
    const ctrl = new HysteresisController(SpatialTier.L0, DEFAULT_SRP_CONFIG, () => t);
    // First commit
    ctrl.update(0.56, SpatialTier.L1);
    t = 210;
    ctrl.update(0.56, SpatialTier.L1); // commits L1
    // Immediately try to commit L2
    ctrl.update(1.5, SpatialTier.L2);
    t = 220; // only 10ms later — within rate limit window
    expect(ctrl.update(1.5, SpatialTier.L2)).toBeNull();
    t = 420; // 210ms after first commit
    const second = ctrl.update(1.5, SpatialTier.L2);
    expect(second).toBe(SpatialTier.L2);
  });
});

describe('HysteresisController — dead band (±5%)', () => {
  it('holds candidate within ±5% of boundary', () => {
    let t = 0;
    const ctrl = new HysteresisController(SpatialTier.L0, DEFAULT_SRP_CONFIG, () => t);
    // L0/L1 boundary at 0.5. Dead band high = 0.5 × 0.95 = 0.475.
    // Zoom to 0.48 — inside dead band, no candidate update.
    ctrl.update(0.48, SpatialTier.L0);
    expect(ctrl.candidateTier).toBe(SpatialTier.L0);
  });
});

describe('HysteresisController — reset', () => {
  it('force-resets to specified tier', () => {
    const ctrl = new HysteresisController(SpatialTier.L2);
    ctrl.reset(SpatialTier.L0);
    expect(ctrl.currentTier).toBe(SpatialTier.L0);
    expect(ctrl.candidateTier).toBe(SpatialTier.L0);
  });
});
