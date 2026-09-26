// Camera stations (fixed viewpoints), smooth flights between them, and the guided tour.
import { catmullRom, easeInOutCubic, lerp3, type Vec3 } from '../util/math';
import type { Camera } from './camera';

/** [eye, look-at] pairs. */
export const VIEWS = {
  aerial: [[235, 150, -215], [10, 8, 0]],
  plaza: [[168, 5.5, -44], [90, 12, 0]],
  ford: [[102, 4, -34], [84, 11, 0]],
  // Press-level main camera, where the TV broadcast's wide shot is taken from.
  broadcast: [[0, 21, -37], [0, 0, 4]],
  centre: [[0, 16, 34], [0, 3, 0]],
  rink: [[0.5, 2.5, -15.6], [12, 0.6, -2]],
  lower: [[34, 10, -20], [0, 1, 0]],
  upper: [[-60, 31, 26], [0, 4, 0]],
  rafters: [[2, 30, 14], [48, 31, 0]],
} satisfies Record<string, [Vec3, Vec3]>;

export type ViewName = keyof typeof VIEWS;

interface Leg {
  eye: Vec3;
  look: Vec3;
  seconds: number;
}

/** Street, through Ford Hall, into the bowl, down to the ice and up to the rafters. */
const TOUR: Leg[] = [
  { eye: [235, 150, -215], look: [10, 8, 0], seconds: 6 },
  { eye: [210, 60, -140], look: [90, 12, 0], seconds: 5 },
  { eye: [150, 6, -30], look: [90, 10, -5], seconds: 4.5 },
  { eye: [104, 6, -30], look: [70, 8, -26], seconds: 4 },
  { eye: [62, 30, -28], look: [0, 5, 0], seconds: 5 },
  { eye: [34, 10, -20], look: [0, 1, 0], seconds: 5 },
  { eye: [0.5, 2.5, -15.6], look: [10, 1, -4], seconds: 5 },
  { eye: [-12, 4, 6], look: [-27, 0.8, 0], seconds: 4.5 },
  { eye: [-20, 14, 16], look: [0, 23.5, 0], seconds: 5 },
  { eye: [2, 30, 14], look: [48, 31, 0], seconds: 5 },
  { eye: [-60, 31, 26], look: [0, 4, 0], seconds: 0 },
];

interface Transition {
  e0: Vec3;
  l0: Vec3;
  e1: Vec3;
  l1: Vec3;
  t0: number;
  ms: number;
}

export type FlightState = 'idle' | 'moving' | 'ended';

export class Flight {
  private transition: Transition | null = null;
  private tourStart = -1;

  get touring(): boolean {
    return this.tourStart >= 0;
  }

  goTo(cam: Camera, name: ViewName, now: number): void {
    this.tourStart = -1;
    const [e1, l1] = VIEWS[name];
    const e0 = cam.eye(), l0: Vec3 = [...cam.target];
    const distance = Math.hypot(e1[0] - e0[0], e1[1] - e0[1], e1[2] - e0[2]);
    this.transition = { e0, l0, e1, l1, t0: now, ms: Math.min(3.4, Math.max(1.2, distance / 70)) * 1000 };
  }

  startTour(now: number): void {
    this.transition = null;
    this.tourStart = now;
  }

  stop(): void {
    this.transition = null;
    this.tourStart = -1;
  }

  update(cam: Camera, now: number): FlightState {
    if (this.tourStart >= 0) return this.tourStep(cam, now);
    const tr = this.transition;
    if (!tr) return 'idle';
    const t = Math.min(1, (now - tr.t0) / tr.ms), s = easeInOutCubic(t);
    cam.setEyeLook(lerp3(tr.e0, tr.e1, s), lerp3(tr.l0, tr.l1, s));
    if (t >= 1) this.transition = null;
    return 'moving';
  }

  private tourStep(cam: Camera, now: number): FlightState {
    let t = (now - this.tourStart) / 1000, i = 0;
    while (i < TOUR.length - 1 && t > TOUR[i]!.seconds) {
      t -= TOUR[i]!.seconds;
      i++;
    }
    if (i >= TOUR.length - 1) {
      this.tourStart = -1;
      const last = TOUR[TOUR.length - 1]!;
      cam.setEyeLook(last.eye, last.look);
      return 'ended';
    }
    const u = t / TOUR[i]!.seconds;
    const leg = (j: number): Leg => TOUR[Math.min(Math.max(j, 0), TOUR.length - 1)]!;
    cam.setEyeLook(
      catmullRom(leg(i - 1).eye, leg(i).eye, leg(i + 1).eye, leg(i + 2).eye, u),
      catmullRom(leg(i - 1).look, leg(i).look, leg(i + 1).look, leg(i + 2).look, u),
    );
    return 'moving';
  }
}
