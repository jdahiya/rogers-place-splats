// Shaped splat helpers: oriented discs, blobs, lines, rectangles and rasterised canvases.
import type { Vec3 } from '../util/math';
import { rng } from '../util/random';
import { glow, put, setJitter, setNormalBits, store } from './store';

/** [r, g, b], [r, g, b, a] or [r, g, b, a, gain]. */
export type Color = readonly number[];
export type Draw2D = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/** Octahedral normal encoding into 2 × 8 bits; 0 is reserved for "no normal". */
export function octNormal(nx: number, ny: number, nz: number): number {
  const l = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
  let x = nx / l;
  let y = ny / l;
  if (nz < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  const qx = 1 + Math.round((x * 0.5 + 0.5) * 254);
  const qy = 1 + Math.round((y * 0.5 + 0.5) * 254);
  return qx | (qy << 8);
}

/**
 * Oriented splat: unit axes u (sigma su) and v (sigma sv); the normal u×v gets sigma sn.
 * Flat splats (sn well below su and sv) record their normal for lighting.
 */
export function S(
  x: number, y: number, z: number,
  ux: number, uy: number, uz: number,
  vx: number, vy: number, vz: number,
  su: number, sv: number, sn: number,
  r: number, g: number, b: number, a = 1,
): void {
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const A = su * su, B = sv * sv, C = sn * sn;
  setNormalBits(sn < 0.45 * Math.min(su, sv) ? octNormal(nx, ny, nz) : 0);
  put(
    x, y, z,
    A * ux * ux + B * vx * vx + C * nx * nx,
    A * ux * uy + B * vx * vy + C * nx * ny,
    A * ux * uz + B * vx * vz + C * nx * nz,
    A * uy * uy + B * vy * vy + C * ny * ny,
    A * uy * uz + B * vy * vz + C * ny * nz,
    A * uz * uz + B * vz * vz + C * nz * nz,
    r, g, b, a,
  );
  setNormalBits(0);
}

/** S() with a Color, honouring its optional alpha and gain. */
export function SC(
  x: number, y: number, z: number,
  ux: number, uy: number, uz: number,
  vx: number, vy: number, vz: number,
  su: number, sv: number, sn: number,
  c: Color,
): void {
  const gain = c[4] ?? 1;
  if (gain !== 1) glow(gain);
  S(x, y, z, ux, uy, uz, vx, vy, vz, su, sv, sn, c[0]!, c[1]!, c[2]!, c[3] ?? 1);
  if (gain !== 1) glow(1);
}

/** Round splat. */
export function blob(x: number, y: number, z: number, s: number, r: number, g: number, b: number, a = 1): void {
  const q = s * s;
  put(x, y, z, q, 0, 0, q, 0, q, r, g, b, a);
}

/** Axis-aligned ellipsoid. */
export function ell(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: Color, a = 1): void {
  put(x, y, z, sx * sx, 0, 0, sy * sy, 0, sz * sz, c[0]!, c[1]!, c[2]!, a);
}

/** A light source: bright emissive core plus a faint halo. */
export function lightBlob(x: number, y: number, z: number, s: number, r: number, g: number, b: number, gain = 3, halo = 4): void {
  glow(gain);
  blob(x, y, z, s, r, g, b);
  glow(gain * 0.6);
  blob(x, y, z, s * halo, r, g, b, 0.1);
  glow(1);
}

/** Chain of elongated splats from one point to another; w is the thickness sigma. */
export function line(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  w: number, step: number,
  r: number, g: number, b: number, a = 1,
): void {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz);
  if (L < 1e-6) return;
  const n = Math.max(1, Math.round(L / step));
  const ux = dx / L, uy = dy / L, uz = dz / L;
  let px: number, py: number, pz: number;
  if (Math.abs(uy) < 0.9) {
    px = -uz; py = 0; pz = ux;
  } else {
    px = 0; py = uz; pz = -uy;
  }
  const pl = Math.hypot(px, py, pz);
  px /= pl; py /= pl; pz /= pl;
  const s = L / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    S(x0 + dx * t, y0 + dy * t, z0 + dz * t, ux, uy, uz, px, py, pz, s * 0.6, w, w, r, g, b, a);
  }
}

/** Grid of splats over a rectangle from corner o along unit axes u and v. fn returns a Color or null to skip. */
export function panel(
  ox: number, oy: number, oz: number,
  ux: number, uy: number, uz: number,
  vx: number, vy: number, vz: number,
  w: number, h: number, sp: number,
  fn: (fu: number, fv: number, x: number, y: number, z: number) => Color | null,
  sn = 0.02,
): void {
  const nu = Math.max(1, Math.round(w / sp)), nv = Math.max(1, Math.round(h / sp));
  const su = w / nu, sv = h / nv;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const fu = (i + 0.5 + (rng() - 0.5) * 0.25) / nu;
      const fv = (j + 0.5 + (rng() - 0.5) * 0.25) / nv;
      const x = ox + ux * fu * w + vx * fv * h;
      const y = oy + uy * fu * w + vy * fv * h;
      const z = oz + uz * fu * w + vz * fv * h;
      const c = fn(fu, fv, x, y, z);
      if (c) SC(x, y, z, ux, uy, uz, vx, vy, vz, su * 0.66, sv * 0.66, sn, c);
    }
  }
}

/** Draws into an offscreen canvas and returns its RGBA pixels. */
export function rasterize(width: number, height: number, draw: Draw2D): Uint8ClampedArray {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is unavailable.');
  draw(ctx, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

/** One splat per pixel of a 2D drawing, laid on a rectangle (origin = bottom-left corner). */
export function canvasPanel(o: Vec3, u: Vec3, v: Vec3, w: number, h: number, sp: number, draw: Draw2D, gain = 1, alpha = 1): void {
  const nu = Math.max(2, Math.round(w / sp)), nv = Math.max(2, Math.round(h / sp));
  const px = rasterize(nu, nv, draw);
  const su = w / nu, sv = h / nv;
  const old = setJitter(0.02);
  glow(gain);
  for (let j = 0; j < nv; j++) {
    const fv = 1 - (j + 0.5) / nv;
    for (let i = 0; i < nu; i++) {
      const q = (j * nu + i) * 4;
      if (px[q + 3]! < 10) continue;
      const fu = (i + 0.5) / nu;
      S(
        o[0] + u[0] * fu * w + v[0] * fv * h,
        o[1] + u[1] * fu * w + v[1] * fv * h,
        o[2] + u[2] * fu * w + v[2] * fv * h,
        u[0], u[1], u[2], v[0], v[1], v[2],
        su * 0.64, sv * 0.64, 0.02,
        px[q]! / 255, px[q + 1]! / 255, px[q + 2]! / 255, (alpha * px[q + 3]!) / 255,
      );
    }
  }
  glow(1);
  setJitter(old);
}

// ---- Ice reflections -------------------------------------------------------

const mirrorRanges: [number, number][] = [];

export function resetReflections(): void {
  mirrorRanges.length = 0;
}

/** Marks the start of splats that should also appear mirrored in the ice; call the result to close the range. */
export function reflectFrom(): () => void {
  const start = store.count;
  return () => {
    mirrorRanges.push([start, store.count]);
  };
}

/** Appends a blurred, faded mirror image (y → -y) of every marked splat above the ice. */
export function buildReflections(fade: number, blur: number): void {
  for (const [start, end] of mirrorRanges) {
    for (let i = start; i < end; i++) if (store.pos[i * 3 + 1]! > 0.05) mirror(i, fade, blur);
  }
}

function mirror(i: number, fade: number, blur: number): void {
  const s = store;
  if (s.count >= s.capacity) s.reserve(1);
  const j = s.count++;
  const a = i * 3, b = j * 3, c = i * 6, d = j * 6;
  s.pos[b] = s.pos[a]!;
  s.pos[b + 1] = -s.pos[a + 1]!;
  s.pos[b + 2] = s.pos[a + 2]!;
  // Reflecting y flips the sign of the xy and yz covariance terms.
  s.cov[d] = s.cov[c]! * blur;
  s.cov[d + 1] = -s.cov[c + 1]! * blur;
  s.cov[d + 2] = s.cov[c + 2]! * blur;
  s.cov[d + 3] = s.cov[c + 3]! * blur;
  s.cov[d + 4] = -s.cov[c + 4]! * blur;
  s.cov[d + 5] = s.cov[c + 5]! * blur;
  for (let k = 0; k < 3; k++) s.col[j * 4 + k] = (s.col[i * 4 + k]! * 0.85) | 0;
  s.col[j * 4 + 3] = (s.col[i * 4 + 3]! * fade) | 0;
  s.em[j] = s.em[i]!;
  s.nrm[j] = s.nrm[i]!;
}
