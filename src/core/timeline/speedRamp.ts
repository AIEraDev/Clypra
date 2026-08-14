// src/core/timeline/speedRamp.ts
// Frontend Speed Ramping and Time-Remapping Interpolation Engine

import { evaluateCubicBezier, BEZIER_PRESETS } from "./bezier";

export interface SpeedKeyframePoint {
  time: number;
  speed: number;
  easing?: string;
  controlPoints?: [number, number, number, number];
}

export class SpeedRampTimeline {
  private keyframes: SpeedKeyframePoint[];

  constructor(keyframes: SpeedKeyframePoint[]) {
    this.keyframes = [...keyframes].sort((a, b) => a.time - b.time);
  }

  getSpeedAt(timelineTime: number): number {
    if (this.keyframes.length === 0) return 1.0;
    if (this.keyframes.length === 1 || timelineTime <= this.keyframes[0].time) {
      return Math.max(0.01, this.keyframes[0].speed);
    }
    if (timelineTime >= this.keyframes[this.keyframes.length - 1].time) {
      return Math.max(0.01, this.keyframes[this.keyframes.length - 1].speed);
    }

    for (let i = 0; i < this.keyframes.length - 1; i++) {
      const kStart = this.keyframes[i];
      const kEnd = this.keyframes[i + 1];

      if (timelineTime >= kStart.time && timelineTime <= kEnd.time) {
        const duration = kEnd.time - kStart.time;
        if (duration <= 1e-6) return kStart.speed;

        const progress = (timelineTime - kStart.time) / duration;
        const curve = kStart.controlPoints ?? (kStart.easing ? BEZIER_PRESETS[kStart.easing] : BEZIER_PRESETS.linear) ?? BEZIER_PRESETS.linear;
        const eased = evaluateCubicBezier(curve, progress);
        const speed = kStart.speed + (kEnd.speed - kStart.speed) * eased;
        return Math.max(0.01, speed);
      }
    }

    return 1.0;
  }

  timelineToSourceTime(timelineTime: number, initialTrimIn: number = 0): number {
    if (timelineTime <= 0) return initialTrimIn;

    const steps = Math.min(500, Math.max(10, Math.ceil(timelineTime * 60)));
    const dt = timelineTime / steps;
    let accumulated = 0;

    let prevSpeed = this.getSpeedAt(0);
    for (let i = 1; i <= steps; i++) {
      const curT = i * dt;
      const curSpeed = this.getSpeedAt(curT);
      accumulated += (prevSpeed + curSpeed) * 0.5 * dt;
      prevSpeed = curSpeed;
    }

    return initialTrimIn + accumulated;
  }
}
