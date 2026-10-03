import type { DynamicEffects } from "./Renderer.ts";

export interface AutoLevel extends DynamicEffects {
  /** Fraction of the capped pixel ratio. */
  scale: number;
}

/** Cheapest first: effects are only dropped once the resolution is already at its minimum. */
const LEVELS: AutoLevel[] = [
  { scale: 0.6, ao: false, bloom: false, shadowMapSize: 1024 },
  { scale: 0.6, ao: false, bloom: true, shadowMapSize: 1024 },
  { scale: 0.6, ao: false, bloom: true, shadowMapSize: 2048 },
  { scale: 0.6, ao: true, bloom: true, shadowMapSize: 2048 },
  { scale: 0.7, ao: true, bloom: true, shadowMapSize: 2048 },
  { scale: 0.8, ao: true, bloom: true, shadowMapSize: 2048 },
  { scale: 0.9, ao: true, bloom: true, shadowMapSize: 2048 },
  { scale: 1, ao: true, bloom: true, shadowMapSize: 2048 },
];

const WINDOW = 30;
const SETTLE_FRAMES = 20;
const UP_AFTER_MS = 3000;
const RETRY_MS = 15000;
const MAX_TARGET_FPS = 60;

/**
 * Dynamic resolution: keeps the frame rate at the display refresh rate (at most 60 fps) by stepping
 * through LEVELS. Steps down quickly when frames are late, and probes upwards slowly; a level that
 * failed soon after stepping up is blocked for a while (doubling each time) so it doesn't oscillate.
 * Uses GPU time when the timer query extension is available, otherwise frame intervals.
 */
export class AutoScaler {
  onChange?: (level: AutoLevel, scaleChanged: boolean) => void;
  level = LEVELS.length - 3;
  refreshHz = 60;
  private readonly intervals: number[] = [];
  private settle = SETTLE_FRAMES;
  private goodSince = 0;
  private raisedAt = 0;
  private readonly blockedUntil = new Map<number, number>();
  private readonly failures = new Map<number, number>();
  private readonly refreshSamples: number[] = [];
  private running = false;

  get scale(): number {
    return LEVELS[this.level]!.scale;
  }

  get current(): AutoLevel {
    return LEVELS[this.level]!;
  }

  get levels(): number {
    return LEVELS.length;
  }

  get targetFps(): number {
    return Math.min(this.refreshHz, MAX_TARGET_FPS);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.reset();
  }

  stop() {
    this.running = false;
  }

  private reset() {
    this.intervals.length = 0;
    this.settle = SETTLE_FRAMES;
    this.goodSince = performance.now();
  }

  /**
   * @param interval ms between this and the previous frame
   * @param gpuMs GPU time of a recent frame, or -1 if unknown
   * @param cpuMs JavaScript time of the previous frame
   */
  update(interval: number, gpuMs: number, cpuMs: number) {
    if (!this.running) return;
    if (interval <= 0 || interval > 250) return this.reset();
    this.measureRefresh(interval);
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    this.intervals.push(interval);
    if (this.intervals.length > WINDOW) this.intervals.shift();
    const now = performance.now();
    const budget = 1000 / this.targetFps;
    if (this.intervals.length < WINDOW) {
      const veryLate = this.intervals.length >= 10 && this.intervals.every((v) => v > budget * 1.5);
      if (veryLate && cpuMs < budget * 0.7) this.stepDown(now);
      return;
    }

    // Ignore the two worst frames so isolated hitches (GC, network, tab switches) don't count.
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const avg = sorted.slice(0, WINDOW - 2).reduce((s, v) => s + v, 0) / (WINDOW - 2);
    const late = sorted.filter((v) => v > budget * 1.5).length / WINDOW;
    const gpuKnown = gpuMs >= 0;
    const gpuBound = gpuKnown ? gpuMs > budget * 0.9 : cpuMs < budget * 0.7;
    const slow = (avg > budget * 1.1 || late > 0.2) && gpuBound;

    if (slow || (gpuKnown && gpuMs > budget * 0.95)) return this.stepDown(now);

    const good = avg < budget * 1.05 && late < 0.05 && (!gpuKnown || gpuMs < budget * 0.65);
    if (!good) this.goodSince = now;
    else if (now - this.goodSince > UP_AFTER_MS && this.level < LEVELS.length - 1) {
      const next = this.level + 1;
      if ((this.blockedUntil.get(next) ?? 0) > now) return;
      this.raisedAt = now;
      this.set(next);
    }
  }

  private stepDown(now: number) {
    if (this.level === 0) return;
    if (now - this.raisedAt < 4000) this.block(this.level, now);
    this.set(this.level - 1);
  }

  private block(level: number, now: number) {
    const failures = (this.failures.get(level) ?? 0) + 1;
    this.failures.set(level, failures);
    this.blockedUntil.set(level, now + RETRY_MS * 2 ** Math.min(failures - 1, 4));
  }

  private set(level: number) {
    level = Math.max(0, Math.min(LEVELS.length - 1, level));
    if (level === this.level) return;
    const scaleChanged = LEVELS[level]!.scale !== this.scale;
    this.level = level;
    this.reset();
    this.onChange?.(this.current, scaleChanged);
  }

  /** Display refresh rate from the fastest sustained frame intervals; slow frames can't lower it below 60. */
  private measureRefresh(interval: number) {
    const samples = this.refreshSamples;
    samples.push(interval);
    if (samples.length < 60) return;
    samples.sort((a, b) => a - b);
    const fast = samples[Math.floor(samples.length * 0.25)]!;
    samples.length = 0;
    this.refreshHz = Math.min(240, Math.max(this.refreshHz, Math.round(1000 / fast)));
  }
}
