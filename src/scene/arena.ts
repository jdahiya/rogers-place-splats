// Arena geometry in metres: y up, rink centred on the origin, long axis on x (east is +x, north is +z).
// Every bowl ring is an offset d of the rink's rounded rectangle, so rows stay parallel to the boards.
import { HALF_PI, clamp } from '../util/math';

/** NHL sheet: 200 ft × 85 ft with 28 ft corner radius. */
export const RA = 30.48;
export const RB = 12.95;
export const RR = 8.53;
export const SX = RA - RR;
export const SZ = RB - RR;
/** Offset of the building's outer wall from the boards. */
export const SHELL = 50;

export type WalkFn = (x: number, z: number, nx: number, nz: number, seg: number, f: number, segLength: number, arc: number) => void;

/** Length of segment s (0..7) of the ring at offset d: even segments are straight, odd ones are corner arcs. */
export function segLen(d: number, s: number): number {
  if (s & 1) return (RR + d) * HALF_PI;
  return s % 4 === 0 ? 2 * SZ : 2 * SX;
}

const pt = { x: 0, z: 0, nx: 0, nz: 0 };

function pointOn(d: number, s: number, f: number): void {
  const R = RR + d;
  switch (s) {
    case 0: pt.x = SX + R; pt.z = -SZ + 2 * SZ * f; pt.nx = 1; pt.nz = 0; return;
    case 2: pt.x = SX - 2 * SX * f; pt.z = SZ + R; pt.nx = 0; pt.nz = 1; return;
    case 4: pt.x = -SX - R; pt.z = SZ - 2 * SZ * f; pt.nx = -1; pt.nz = 0; return;
    case 6: pt.x = -SX + 2 * SX * f; pt.z = -SZ - R; pt.nx = 0; pt.nz = -1; return;
  }
  const th = ((s - 1) / 2) * HALF_PI + f * HALF_PI;
  const cx = s === 1 || s === 7 ? SX : -SX;
  const cz = s === 1 || s === 3 ? SZ : -SZ;
  pt.nx = Math.cos(th);
  pt.nz = Math.sin(th);
  pt.x = cx + R * pt.nx;
  pt.z = cz + R * pt.nz;
}

/** Visits evenly spaced points around the ring at offset d, with the outward normal. */
export function walk(d: number, step: number, cb: WalkFn): void {
  let acc = 0;
  for (let s = 0; s < 8; s++) {
    const L = segLen(d, s), n = Math.max(1, Math.round(L / step));
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n;
      pointOn(d, s, f);
      cb(pt.x, pt.z, pt.nx, pt.nz, s, f, L, acc + f * L);
    }
    acc += L;
  }
}

/** The point at arc length a around the ring at offset d (wrapping, as walk() counts it), with its outward normal. */
export function ringPoint(d: number, a: number): { x: number; z: number; nx: number; nz: number } {
  const total = perimeter(d);
  let rest = ((a % total) + total) % total;
  for (let s = 0; s < 8; s++) {
    const L = segLen(d, s);
    if (rest <= L || s === 7) {
      pointOn(d, s, Math.min(1, rest / L));
      break;
    }
    rest -= L;
  }
  return { x: pt.x, z: pt.z, nx: pt.nx, nz: pt.nz };
}

export function perimeter(d: number): number {
  let L = 0;
  for (let s = 0; s < 8; s++) L += segLen(d, s);
  return L;
}

/** Signed distance from (x, z) to the ring at offset d (negative inside). */
export function sdRR(x: number, z: number, d: number): number {
  const qx = Math.abs(x) - SX, qz = Math.abs(z) - SZ;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - (RR + d);
}

/** Height of the domed roof. */
export function roofY(x: number, z: number): number {
  const t = clamp(-sdRR(x, z, SHELL) / 55, 0, 1);
  return 40 + 8 * (1 - (1 - t) * (1 - t));
}

/** Height of the interior ceiling, 3 m under the roof. */
export const ceilY = (x: number, z: number): number => roofY(x, z) - 3;

/** Seating bowl profile, filled in when the bowl is built. Used to make the structure under the seats solid for ray tracing. */
export interface BowlProfile {
  lower: number[];
  upper: number[];
  dLowEnd: number;
  yWalk: number;
  dF: number;
  /** Height of the upper bowl's first row. */
  yU0: number;
  d0U: number;
  dUEnd: number;
  yTop: number;
  dBack: number;
}

export const bowl: BowlProfile = { lower: [], upper: [], dLowEnd: 0, yWalk: 0, dF: 0, yU0: 0, d0U: 0, dUEnd: 0, yTop: 0, dBack: 0 };

function structureTop(d: number, ceil: number): number {
  const b = bowl;
  if (!b.lower.length) return -1;
  if (d < b.dLowEnd) return b.lower[Math.min(b.lower.length - 1, Math.floor((d - 1.8) / 0.86))]! - 0.6;
  if (d < b.dF + 0.3) return b.yWalk - 0.6;
  if (d < b.d0U) return b.yU0 - 0.6;
  if (d < b.dUEnd) return b.upper[Math.min(b.upper.length - 1, Math.floor((d - b.d0U) / 0.8))]! - 0.6;
  if (d < b.dBack + 0.3) return b.yTop - 0.6;
  return ceil - 0.3;
}

/**
 * True for points inside the building's solid structure: under the seating, behind the back
 * walls, and between the ceiling and the roof. The splats only show surfaces, so without this
 * the ray tracer would see light leaking through the hollow spaces behind them.
 */
export function isStructure(x: number, y: number, z: number): boolean {
  if (y < 0 || sdRR(x, z, SHELL - 0.5) >= 0) return false;
  const ceil = ceilY(x, z);
  if (y > ceil + 0.6) return y < roofY(x, z) - 0.6;
  const d = sdRR(x, z, 0);
  if (d < 1.9) return false;
  if (d > 43.3 && y < 9.3) return false; // the ground-floor concourse stays open
  return y < structureTop(d, ceil);
}
