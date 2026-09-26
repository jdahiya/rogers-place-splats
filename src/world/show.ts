// Arena lighting: the fixed LED rig over the ice, and the goal celebration with moving spotlights.
import type { Vec3 } from '../util/math';

export const MAX_LIGHTS = 16;

/** Light list in the layout the lighting shader expects. */
export class LightRig {
  count = 0;
  /** xyz + intensity */
  readonly pos = new Float32Array(MAX_LIGHTS * 4);
  readonly color = new Float32Array(MAX_LIGHTS * 3);
  /** spot direction xyz + cos(cone); w below -1 marks an omni light */
  readonly dir = new Float32Array(MAX_LIGHTS * 4);
  ambient: Vec3 = [0.3, 0.29, 0.31];

  add(p: Vec3, intensity: number, c: Vec3, spot: Vec3 | null = null, cosCone = -2): void {
    if (this.count >= MAX_LIGHTS) return;
    const i = this.count++;
    this.pos.set([p[0], p[1], p[2], intensity], i * 4);
    this.color.set(c, i * 3);
    this.dir.set(spot ? [spot[0], spot[1], spot[2], cosCone] : [0, -1, 0, -2], i * 4);
  }
}

const SPOT_COLORS: Vec3[] = [[1, 0.35, 0.05], [0.15, 0.35, 1], [1, 1, 1]];

export class GoalShow {
  active = false;
  private start = 0;
  readonly seconds = 10;

  trigger(now: number): void {
    this.active = true;
    this.start = now;
  }

  /** Returns true on the frame the show ends. */
  update(now: number): boolean {
    if (this.active && now - this.start > this.seconds * 1000) {
      this.active = false;
      return true;
    }
    return false;
  }

  /** Fills the rig for this moment: house lights normally, dimmed with sweeping spots during a celebration. */
  rig(now: number, out: LightRig): void {
    out.count = 0;
    // House lights: ten fixtures spread over the whole sheet, hung just under the catwalks.
    const house = this.active ? 0.012 : 0.095;
    for (const x of [-28, -14, 0, 14, 28]) for (const z of [-10, 10]) out.add([x, 33.5, z], house, [1, 0.97, 0.92]);
    out.ambient = this.active ? [0.07, 0.07, 0.09] : [0.32, 0.31, 0.33];
    if (!this.active) return;
    const t = (now - this.start) / 1000;
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3 + t * 0.8;
      const p: Vec3 = [Math.cos(a) * 30, 37.5, Math.sin(a) * 18];
      const target: Vec3 = [Math.cos(t * 0.9 + k * 1.7) * 38, 6 + 5 * Math.sin(t * 1.3 + k), Math.sin(t * 0.7 + k * 2.3) * 26];
      const d: Vec3 = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
      const l = Math.hypot(...d);
      out.add(p, 1.0, SPOT_COLORS[k % 3]!, [d[0] / l, d[1] / l, d[2] / l], 0.968);
    }
  }
}
