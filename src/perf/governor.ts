// Adaptive quality. 60 fps is the floor; the display's refresh rate is the ceiling.
// Every half second it looks at recent frames and moves one knob: ray budget first, then render
// scale, then skipping sub-pixel splats, then bloom. Below 60 fps it may go further than it will
// just to reach a high refresh rate.

export type Pacing = 'display' | 'floor' | 'saver';

export interface Knobs {
  /** Render-target scale relative to the canvas. */
  scale: number;
  minScale: number;
  maxScale: number;
  /** Device-pixel-ratio cap for the canvas. */
  dpr: number;
  /** Rows of 1024 splats re-lit per frame while lighting refines. */
  rtRows: number;
  rtMin: number;
  rtMax: number;
  /** Splats smaller than this many pixels are skipped. */
  minPx: number;
  bloom: boolean;
}

const COMMON_HZ = [48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
const FLOOR_FPS = 60;

export class Governor {
  pacing: Pacing = 'display';
  adaptive = true;
  bloomWanted = true;
  refreshHz = 60;
  lastChange = 'Starting up';

  private readonly deltas: number[] = [];
  private intervals: number[] = [];
  private gpuSum = 0;
  private gpuN = 0;
  private windowStart = 0;
  private coolUntil = 0;

  constructor(readonly knobs: Knobs) {}

  /** Target frame rate: the refresh rate when matching the display, otherwise 60. */
  get targetFps(): number {
    return this.pacing === 'display' ? Math.max(FLOOR_FPS, this.refreshHz) : FLOOR_FPS;
  }

  /** Every requestAnimationFrame delta, rendered or not, to learn the refresh rate. */
  noteRaf(delta: number): void {
    if (delta < 2 || delta > 60) return;
    this.deltas.push(delta);
    if (this.deltas.length > 120) this.deltas.shift();
    if (this.deltas.length >= 30 && this.deltas.length % 10 === 0) this.refreshHz = estimateHz(this.deltas);
  }

  /** Battery saver renders at most 60 frames a second, even on faster displays. */
  shouldRender(now: number, lastRender: number): boolean {
    if (this.pacing !== 'saver' || this.refreshHz <= 65) return true;
    return now - lastRender >= 1000 / FLOOR_FPS - 1.5;
  }

  record(interval: number): void {
    if (interval > 0 && interval < 250) this.intervals.push(interval);
  }

  gpuSample(ms: number): void {
    this.gpuSum += ms;
    this.gpuN++;
  }

  evaluate(now: number, rtActive: boolean): void {
    if (!this.windowStart) this.windowStart = now;
    if (now - this.windowStart < 450 || this.intervals.length < 12) return;
    const sorted = this.intervals.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const p90 = sorted[Math.floor(sorted.length * 0.9)]!;
    const gpu = this.gpuN ? this.gpuSum / this.gpuN : NaN;
    this.intervals = [];
    this.gpuSum = 0;
    this.gpuN = 0;
    this.windowStart = now;
    if (!this.adaptive) return;

    const floorMs = 1000 / FLOOR_FPS, targetMs = 1000 / this.targetFps;
    const timed = Number.isFinite(gpu);
    const belowFloor = median > floorMs * 1.06 || p90 > floorMs * 1.25;
    const belowTarget = timed ? gpu > targetMs * 0.9 : median > targetMs * 1.12;
    const roomy = timed ? gpu < targetMs * 0.55 && median < targetMs * 1.05 : median < targetMs * 1.04 && p90 < targetMs * 1.3;

    if (belowFloor) {
      this.lower(true, rtActive);
      if (p90 > 30) this.lower(true, rtActive);
      this.coolUntil = now + 3000;
    } else if (belowTarget && this.pacing === 'display' && this.targetFps > FLOOR_FPS) {
      this.lower(false, rtActive);
      this.coolUntil = now + 3000;
    } else if (roomy && now > this.coolUntil) {
      this.raise(rtActive);
      this.coolUntil = now + 1200;
    }
  }

  /** hard: allowed to trade more quality away, because we're under 60 fps. */
  private lower(hard: boolean, rtActive: boolean): void {
    const k = this.knobs;
    if (rtActive && k.rtRows > k.rtMin) {
      k.rtRows = Math.max(k.rtMin, Math.floor(k.rtRows / 2));
      this.lastChange = 'Lowered ray budget';
      return;
    }
    const scaleFloor = hard ? k.minScale : Math.max(k.minScale, 0.75);
    if (k.scale > scaleFloor + 1e-3) {
      k.scale = Math.max(scaleFloor, round2(k.scale - 0.1));
      this.lastChange = 'Lowered render scale';
      return;
    }
    if (k.minPx < (hard ? 2 : 0.5)) {
      k.minPx += 0.5;
      this.lastChange = 'Skipping sub-pixel splats';
      return;
    }
    if (hard && k.bloom) {
      k.bloom = false;
      this.lastChange = 'Bloom off';
    }
  }

  private raise(rtActive: boolean): void {
    const k = this.knobs;
    if (!k.bloom && this.bloomWanted) {
      k.bloom = true;
      this.lastChange = 'Bloom back on';
    } else if (k.minPx > 0) {
      k.minPx = Math.max(0, k.minPx - 0.5);
      this.lastChange = 'Restored fine splats';
    } else if (k.scale < k.maxScale - 1e-3) {
      k.scale = Math.min(k.maxScale, round2(k.scale + 0.1));
      this.lastChange = 'Raised render scale';
    } else if (rtActive && k.rtRows < k.rtMax) {
      k.rtRows = Math.min(k.rtMax, k.rtRows * 2);
      this.lastChange = 'Raised ray budget';
    }
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Refresh rate from the fastest quarter of frame deltas, snapped to common rates. */
function estimateHz(deltas: readonly number[]): number {
  const sorted = [...deltas].sort((a, b) => a - b);
  const hz = 1000 / sorted[Math.floor(sorted.length * 0.25)]!;
  for (const c of COMMON_HZ) if (Math.abs(hz - c) / c < 0.07) return c;
  return Math.round(hz);
}
