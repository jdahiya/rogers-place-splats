// Outside the arena: the metal skin and roof, Ford Hall, the plaza, streets and downtown blocks.
import { PI, type RGB } from '../util/math';
import { hash, pick, rng, rr, wpick } from '../util/random';
import { glow } from '../splats/store';
import { S, SC, blob, canvasPanel, ell, lightBlob, line, panel, type Color } from '../splats/primitives';
import { RR, SHELL, SX, roofY, sdRR, segLen, walk } from './arena';
import { CAR_PAINT, FAN_SHIRTS, HAIR, LEAVES, PANTS, SKIN } from './palette';
import { drawFord, drawScore } from './screens';

/** Footprint of a solid building, used by the ray tracer. */
export interface Box {
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
}

// ---- Arena shell ----------------------------------------------------------------

function buildShell(k: number): void {
  const starts: number[] = [];
  let acc = 0;
  for (let s = 0; s < 8; s++) {
    starts.push(acc);
    acc += segLen(SHELL, s);
  }
  const total = acc;
  const arcAt = (s: number, f: number): number => starts[s]! + f * segLen(SHELL, s);
  // The south entrance: the skin lifts to expose a tall glass wall.
  const skinBottom = (s: number, f: number): number => {
    if (s !== 6) return 9;
    const e = Math.abs(f - 0.5);
    return e < 0.18 ? 22 : e < 0.24 ? 22 - ((e - 0.18) / 0.06) * 13 : 9;
  };
  const offsetAt = (t: number): number => SHELL + 3.2 * Math.sin(PI * t) + 1.8 * Math.pow(1 - t, 6);
  const skinColor = (a: number, y: number, t: number): Color => {
    const band = Math.floor(y / 1.8), lv = y / 1.8 - band, shift = (band & 1) * 2.25;
    const pi = Math.floor((a + shift) / 4.5), lu = (a + shift) / 4.5 - pi;
    const w = (a / total) * 14 + t * 1.6, fw = w - Math.floor(w);
    // Diagonal glass slashes through the metal.
    if (fw < 0.1 && t > 0.1 && t < 0.93) return hash(pi, band, 5) < 0.3 ? [0.85, 0.62, 0.36, 1, 1.5] : [0.07, 0.1, 0.15 + 0.1 * t];
    if (lu < 0.025 || lv < 0.05) return [0.3, 0.32, 0.35];
    if (t < 0.035) return [1, 0.4, 0.08, 1, 2.2]; // LED strip along the lower lip
    const b = 0.66 + hash(pi, band, 1) * 0.16, tint = hash(pi, band, 2) - 0.5, up = Math.pow(1 - t, 4);
    return [
      b * (0.97 + tint * 0.04) * (0.72 + 0.28 * t) + 0.15 * up,
      b * 0.99 * (0.74 + 0.28 * t) + 0.07 * up,
      b * (1.03 - tint * 0.04) * (0.8 + 0.28 * t) + 0.02 * up,
    ];
  };

  // Metal skin, bulging outward between the ground-floor glass and the roof.
  const sv = 0.8 * k, sh = 0.8 * k, rows = Math.round(31 / sv);
  for (let j = 0; j < rows; j++) {
    const t = (j + 0.5) / rows, y = 9 + 31 * t, d = offsetAt(t);
    const dd = 3.2 * PI * Math.cos(PI * t) - 10.8 * Math.pow(1 - t, 5), vl = Math.hypot(dd, 31);
    walk(d, sh, (x, z, nx, nz, s, f) => {
      if (y < skinBottom(s, f)) return;
      SC(x, y, z, -nz, 0, nx, (nx * dd) / vl, 31 / vl, (nz * dd) / vl, sh * 0.72, ((sv * vl) / 31) * 0.72, 0.05, skinColor(arcAt(s, f), y, t));
    });
  }
  // Soffit under the skin's lower lip, with downlights.
  walk(SHELL + 0.9, 0.8 * k, (x, z, nx, nz, s, f) => {
    const y = skinBottom(s, f);
    S(x, y, z, -nz, 0, nx, nx, 0, nz, 0.55, y > 9 ? 1.8 : 1.0, 0.04, 0.33, 0.29, 0.25);
  });
  walk(SHELL + 0.9, 4, (x, z, _nx, _nz, s, f) => lightBlob(x, skinBottom(s, f) - 0.15, z, 0.12, 1, 0.85, 0.6, 3, 3));

  // Ground-floor curtain wall.
  const gsp = 0.6 * k;
  walk(SHELL, gsp, (x, z, nx, nz, s, f) => {
    const a = arcAt(s, f), top = skinBottom(s, f), tx = -nz, tz = nx;
    const mullion = Math.floor(a / 1.5) !== Math.floor((a - gsp) / 1.5);
    for (let y = gsp / 2; y < top; y += gsp) {
      const transom = Math.abs(y - 4.5) < gsp * 0.5 || top - y < gsp * 0.5;
      if (mullion || transom) S(x, y, z, tx, 0, tz, 0, 1, 0, gsp * 0.62, gsp * 0.62, 0.03, 0.07, 0.08, 0.09, 0.95);
      else {
        const q = y / top;
        S(x, y, z, tx, 0, tz, 0, 1, 0, gsp * 0.66, gsp * 0.66, 0.02, 0.1 + 0.06 * q, 0.14 + 0.07 * q, 0.2 + 0.1 * q, 0.5);
      }
    }
  });
  // The lit concourse behind the glass.
  for (const d of [44.5, 46, 47.5, 49]) walk(d, 1.1 * k, (x, z, nx, nz) => S(x, 0.03, z, -nz, 0, nx, nx, 0, nz, 0.8 * k, 0.8, 0.03, 0.36, 0.3, 0.24));
  walk(47.5, 3, (x, z) => lightBlob(x, 8.4, z, 0.15, 1, 0.86, 0.62, 3, 5));
  walk(43.5, 1.0 * k, (x, z, nx, nz, _s, _f, _L, a) => {
    const sign = hash(Math.floor(a / 8), 3, 3);
    for (let y = 0.5; y < 9; y += 1.0 * k) {
      let c: Color = [0.3, 0.25, 0.2];
      if (y > 5 && y < 6.5 && sign < 0.5) c = sign < 0.2 ? [1, 0.45, 0.1, 1, 1.4] : sign < 0.35 ? [0.95, 0.95, 0.9, 1, 1.4] : [0.15, 0.35, 0.8, 1, 1.4];
      SC(x, y, z, -nz, 0, nx, 0, 1, 0, 0.7 * k, 0.7 * k, 0.04, c);
    }
  });

  // Roof dome.
  const rs = 1.5 * k, lim = SX + RR + SHELL;
  for (let x = -lim; x < lim; x += rs) {
    for (let z = -lim; z < lim; z += rs) {
      const px = x + rr(0, rs), pz = z + rr(0, rs), sd = sdRR(px, pz, SHELL);
      if (sd > 0) continue;
      const y = roofY(px, pz);
      const gx = (roofY(px + 1, pz) - roofY(px - 1, pz)) / 2, gz = (roofY(px, pz + 1) - roofY(px, pz - 1)) / 2;
      const ul = Math.hypot(1, gx), ux = 1 / ul, uy = gx / ul;
      let vx = 0, vy = gz;
      const vz = 1, dot = vx * ux + vy * uy;
      vx -= dot * ux;
      vy -= dot * uy;
      const vlen = Math.hypot(vx, vy, vz);
      const seam = -sd % 7 < 0.5, b = seam ? 0.46 : 0.6 * (0.88 + 0.12 * rng());
      S(px, y, pz, ux, uy, 0, vx / vlen, vy / vlen, vz / vlen, rs * 0.8, rs * 0.8, 0.08, b, b * 1.03, b * 1.1);
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = rr(-35, 35), z = rr(-14, 14), y = roofY(x, z), w = rr(2, 5), d = rr(2, 4);
    panel(x - w / 2, y + 1.2, z - d / 2, 1, 0, 0, 0, 0, 1, w, d, 0.6, () => [0.42, 0.43, 0.45]);
    panel(x - w / 2, y, z - d / 2, 1, 0, 0, 0, 1, 0, w, 1.2, 0.6, () => [0.34, 0.35, 0.37]);
  }
}

// ---- Ford Hall ----------------------------------------------------------------------

/** The glass atrium on the east end. */
const FH = { x0: 66, x1: 108, z0: -42, z1: 30, h: 30 };

export function inFordHall(x: number, z: number): boolean {
  return x > FH.x0 && x < FH.x1 && z > FH.z0 && z < FH.z1;
}

const outsideShell = (x: number, z: number): boolean => sdRR(x, z, SHELL) > 0.5;

function fhGlass(y: number): Color {
  const q = y / FH.h;
  return [0.3 + 0.25 * q, 0.38 + 0.2 * q, 0.48 + 0.2 * q, 0.12];
}

/** Thin mullion grid on a Ford Hall wall running from (ax, az) to (bx, bz). */
function mullions(ax: number, az: number, bx: number, bz: number): void {
  const L = Math.hypot(bx - ax, bz - az), M: RGB = [0.12, 0.13, 0.15];
  for (let s = 0; s <= L; s += 3) {
    const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L;
    if (outsideShell(x, z)) line(x, 0, z, x, FH.h, z, 0.04, 0.3, ...M, 0.85);
  }
  for (let y = 3; y < FH.h; y += 3) {
    for (let s = 0; s < L; s += 3) {
      const t0 = s / L, t1 = Math.min(s + 3, L) / L;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      if (outsideShell(x0, z0)) line(x0, y, z0, ax + (bx - ax) * t1, y, az + (bz - az) * t1, 0.035, 0.3, ...M, 0.8);
    }
  }
}

export function person(x: number, z: number, y0 = 0): void {
  ell(x, y0 + 0.45, z, 0.13, 0.42, 0.11, pick(PANTS));
  ell(x, y0 + 1.15, z, 0.2, 0.3, 0.13, wpick(FAN_SHIRTS));
  blob(x, y0 + 1.62, z, 0.1, ...pick(SKIN));
  blob(x, y0 + 1.68, z, 0.09, ...pick(HAIR));
}

function buildFordHall(k: number): void {
  const gs = 0.55 * k, { x0, x1, z0, z1, h } = FH;
  panel(x1, 0, z0, 0, 0, 1, 0, 1, 0, z1 - z0, h, gs, (_fu, _fv, _x, y) => fhGlass(y));
  panel(x0, 0, z0, 1, 0, 0, 0, 1, 0, x1 - x0, h, gs, (_fu, _fv, x, y, z) => (outsideShell(x, z) ? fhGlass(y) : null));
  panel(x0, 0, z1, 1, 0, 0, 0, 1, 0, x1 - x0, h, gs, (_fu, _fv, x, y, z) => (outsideShell(x, z) ? fhGlass(y) : null));
  mullions(x1, z0, x1, z1);
  mullions(x0, z0, x1, z0);
  mullions(x0, z1, x1, z1);
  panel(x0, h, z0, 1, 0, 0, 0, 0, 1, x1 - x0, z1 - z0, 1.0 * k, (_fu, _fv, x, _y, z) =>
    !outsideShell(x, z) ? null : (x - x0) % 6 < 1.0 ? [0.25, 0.33, 0.45, 0.7] : [0.5, 0.52, 0.56], 0.05);
  panel(x0, 0.03, z0, 1, 0, 0, 0, 0, 1, x1 - x0, z1 - z0, 0.8 * k, (_fu, _fv, x, _y, z) => {
    if (!outsideShell(x, z)) return null;
    const warm = Math.max(0, 1 - Math.hypot((x - 90) / 18, z / 20));
    return [0.44 + 0.3 * warm, 0.42 + 0.08 * warm, 0.39 + 0.05 * warm];
  });
  // The big video wall facing the plaza.
  panel(85.9, 3.6, 16.4, 0, 0, -1, 0, 1, 0, 32.8, 14.8, 0.4, () => [0.02, 0.02, 0.025]);
  canvasPanel([86, 4, 16], [0, 0, -1], [0, 1, 0], 32, 14, 0.18 * Math.sqrt(k), drawFord, 1.5);
  for (let x = 70; x < 107; x += 6) {
    for (let z = -40; z < 29; z += 6) if (outsideShell(x, z)) lightBlob(x, h - 0.8, z, 0.18, 1, 0.88, 0.65, 3, 6);
  }
  let n = 0;
  while (n < 90) {
    const x = rr(88, 106), z = rr(-40, 28);
    if (!outsideShell(x, z)) continue;
    person(x, z);
    n++;
  }
}

// ---- Streets and city ---------------------------------------------------------------

/** Roads running north-south sit at these x; roads running east-west at these z. */
const XR = [-250, -108, 158, 300];
const ZR = [-240, -103, 102, 240];
const ROAD_HALF = 8;
const PLAZA = { x0: 108, x1: 145, z0: -90, z1: 90 };

function groundColor(x: number, z: number): RGB {
  let best = 1e9, alongX = false, centre = 0;
  for (const r of XR) {
    const d = Math.abs(x - r);
    if (d < best) { best = d; alongX = true; centre = r; }
  }
  for (const r of ZR) {
    const d = Math.abs(z - r);
    if (d < best) { best = d; alongX = false; centre = r; }
  }
  if (best < ROAD_HALF) {
    const across = alongX ? x - centre : z - centre, along = alongX ? z : x;
    const crossing = (alongX ? ZR : XR).find((r) => Math.abs(along - r) < ROAD_HALF + 5);
    if (crossing !== undefined && Math.abs(along - crossing) > ROAD_HALF + 1 && ((across % 1.2) + 1.2) % 1.2 < 0.6) return [0.72, 0.72, 0.7];
    if (Math.abs(across) < 0.2) return [0.75, 0.6, 0.15];
    if (Math.abs(Math.abs(across) - 4) < 0.15 && ((along % 6) + 6) % 6 < 3) return [0.7, 0.7, 0.68];
    return [0.1, 0.105, 0.115];
  }
  if (best < ROAD_HALF + 4.5) return [0.36, 0.36, 0.37];
  if (x > PLAZA.x0 && x < PLAZA.x1 && z > PLAZA.z0 && z < PLAZA.z1) {
    const px = ((x % 1.5) + 1.5) % 1.5, pz = ((z % 1.5) + 1.5) % 1.5;
    return px < 0.1 || pz < 0.1 ? [0.34, 0.33, 0.32] : [0.47, 0.46, 0.44];
  }
  if (sdRR(x, z, SHELL) < 12 && x > -108 && x < 158 && Math.abs(z) < 103) return [0.4, 0.4, 0.41];
  return [0.16, 0.165, 0.17];
}

function buildGround(k: number): void {
  const tiers: [number, number][] = [[200, 1.4 * k], [420, 3.2 * k], [900, 8 * k]];
  let inner = 0;
  for (const [extent, sp] of tiers) {
    for (let x = -extent; x < extent; x += sp) {
      for (let z = -extent; z < extent; z += sp) {
        if (Math.abs(x + sp / 2) < inner && Math.abs(z + sp / 2) < inner) continue;
        const px = x + rr(0, sp), pz = z + rr(0, sp);
        if (sdRR(px, pz, SHELL) < 0.5 || inFordHall(px, pz)) continue;
        const c = groundColor(px, pz), fade = extent > 420 ? 0.7 : 1;
        S(px, 0, pz, 1, 0, 0, 0, 0, 1, sp * 0.74, sp * 0.74, 0.05, c[0] * fade, c[1] * fade, c[2] * fade);
      }
    }
    inner = extent;
  }
}

type Facade = 'glass' | 'brick' | 'stantec';

function building(boxes: Box[], cx: number, cz: number, w: number, dp: number, h: number, style: Facade, id: number, k: number): void {
  boxes.push({ cx, cz, w, d: dp, h });
  const far = Math.hypot(cx, cz) > 260, sp = (far ? 2.6 : 1.3) * (style === 'stantec' ? 0.9 : 1) * k;
  const glass = style !== 'brick';
  const facade: RGB = style === 'brick' ? [0.42, 0.3, 0.24] : style === 'stantec' ? [0.14, 0.2, 0.27] : [0.28, 0.3, 0.33];
  const litShare = style === 'stantec' ? 0.3 : 0.17;
  const wall = (side: number) => (fu: number, _fv: number, _x: number, y: number): Color => {
    const floor = Math.floor(y / 3.6), fy = y / 3.6 - floor, col = Math.floor((fu * (side & 1 ? dp : w)) / 2.6);
    if (style === 'stantec' && y > h - 14) return fy < 0.3 || col % 3 === 0 ? [0.95, 0.97, 1, 1, 1.8] : [0.25, 0.32, 0.42];
    if (y < 5) return [0.85, 0.7, 0.5, 1, 1.3];
    if (fy < (glass ? 0.2 : 0.4)) return facade;
    if (hash(id * 7 + side, floor, col) < litShare) return hash(id, floor, col) < 0.7 ? [0.95, 0.78, 0.5, 1, 1.6] : [0.82, 0.88, 0.98, 1, 1.6];
    const q = y / h;
    return glass ? [0.12 + 0.2 * q, 0.16 + 0.2 * q, 0.24 + 0.24 * q] : [0.12, 0.13, 0.16];
  };
  panel(cx - w / 2, 0, cz - dp / 2, 1, 0, 0, 0, 1, 0, w, h, sp, wall(0));
  panel(cx + w / 2, 0, cz - dp / 2, 0, 0, 1, 0, 1, 0, dp, h, sp, wall(1));
  panel(cx + w / 2, 0, cz + dp / 2, -1, 0, 0, 0, 1, 0, w, h, sp, wall(2));
  panel(cx - w / 2, 0, cz + dp / 2, 0, 0, -1, 0, 1, 0, dp, h, sp, wall(3));
  panel(cx - w / 2, h, cz - dp / 2, 1, 0, 0, 0, 0, 1, w, dp, sp * 1.4, () => [0.2, 0.2, 0.22]);
  if (h > 90) lightBlob(cx, h + 1.5, cz, 0.35, 1, 0.1, 0.05, 3, 3);
}

function buildCity(k: number, boxes: Box[]): void {
  const towers = [
    { x: 40, z: -160, w: 32, d: 32, h: 251, style: 'stantec' as const },
    { x: -160, z: -150, w: 52, d: 34, h: 116, style: 'glass' as const },
    { x: 205, z: 60, w: 32, d: 32, h: 165, style: 'glass' as const },
  ];
  let id = 1;
  for (const t of towers) building(boxes, t.x, t.z, t.w, t.d, t.h, t.style, id++, k);
  const XB = [-420, -250, -108, 158, 300, 420], ZB = [-420, -240, -103, 102, 240, 420];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (i === 2 && j === 2) continue; // the arena block
      const bx0 = XB[i]! + 14, bx1 = XB[i + 1]! - 14, bz0 = ZB[j]! + 14, bz1 = ZB[j + 1]! - 14;
      const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
      for (const [lx0, lx1] of [[bx0, mx - 4], [mx + 4, bx1]] as const) {
        for (const [lz0, lz1] of [[bz0, mz - 4], [mz + 4, bz1]] as const) {
          if (rng() < 0.15) continue;
          const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2;
          const clash = towers.some((t) => Math.abs(t.x - cx) < (t.w + lx1 - lx0) / 2 + 4 && Math.abs(t.z - cz) < (t.d + lz1 - lz0) / 2 + 4);
          if (clash) continue;
          const w = (lx1 - lx0) * rr(0.6, 0.95), d = (lz1 - lz0) * rr(0.6, 0.95);
          // Keep the south-east block low so the aerial view and tour can see the arena.
          const low = i === 3 && j === 1;
          const h = low ? rr(8, 18) : rng() < 0.12 ? rr(80, 140) : 12 + Math.pow(rng(), 2.2) * 60;
          building(boxes, cx, cz, w, d, h, rng() < 0.35 ? 'brick' : 'glass', id++, k);
        }
      }
    }
  }
}

function tree(x: number, z: number, s: number): void {
  line(x, 0, z, x, 2.6 * s, z, 0.12 * s, 0.4, 0.2, 0.14, 0.1);
  const base = pick(LEAVES);
  for (let i = 0; i < 9; i++) {
    const c = rng() < 0.7 ? base : pick(LEAVES);
    blob(x + rr(-1.4, 1.4) * s, rr(3, 5.4) * s, z + rr(-1.4, 1.4) * s, rr(0.8, 1.2) * s, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8);
  }
}

function lamp(x: number, z: number): void {
  line(x, 0, z, x, 8, z, 0.08, 0.5, 0.15, 0.15, 0.17);
  lightBlob(x, 8.1, z, 0.25, 1, 0.85, 0.6, 3, 5);
  // Pool of light on the pavement; emissive so it fades out in daylight.
  glow(1.25);
  S(x, 0.06, z, 1, 0, 0, 0, 0, 1, 4, 4, 0.02, 1, 0.72, 0.42, 0.12);
  glow(1);
}

function car(x: number, z: number, ux: number, uz: number): void {
  const c = pick(CAR_PAINT), px = -uz, pz = ux;
  S(x, 0.7, z, ux, 0, uz, 0, 1, 0, 2.0, 0.4, 0.85, ...c);
  S(x - ux * 0.2, 1.3, z - uz * 0.2, ux, 0, uz, 0, 1, 0, 1.1, 0.3, 0.72, 0.05, 0.06, 0.08);
  for (const sd of [-1, 1]) {
    lightBlob(x + ux * 2.2 + px * 0.7 * sd, 0.7, z + uz * 2.2 + pz * 0.7 * sd, 0.12, 1, 0.97, 0.85, 3, 4);
    glow(2.5);
    blob(x - ux * 2.2 + px * 0.7 * sd, 0.75, z - uz * 2.2 + pz * 0.7 * sd, 0.1, 1, 0.08, 0.05);
    glow(1);
  }
}

function buildStreetLife(k: number): void {
  for (const rz of [-103, 102]) {
    for (let x = -240; x < 290; x += 10) {
      if (XR.some((r) => Math.abs(x - r) < ROAD_HALF + 6)) continue;
      for (const sd of [-1, 1]) {
        if (x % 20 === 0) tree(x, rz + sd * (ROAD_HALF + 2.5), rr(0.9, 1.2));
        else if (x % 30 === 0) lamp(x, rz + sd * (ROAD_HALF + 3.8));
      }
    }
  }
  for (const rx of [-108, 158]) {
    for (let z = -230; z < 230; z += 10) {
      if (ZR.some((r) => Math.abs(z - r) < ROAD_HALF + 6)) continue;
      for (const sd of [-1, 1]) {
        if (z % 20 === 0) tree(rx + sd * (ROAD_HALF + 2.5), z, rr(0.9, 1.2));
        else if (z % 30 === 0) lamp(rx + sd * (ROAD_HALF + 3.8), z);
      }
    }
  }
  for (let x = PLAZA.x0 + 4; x < PLAZA.x1; x += 12) for (const z of [-80, -55, 55, 80]) tree(x, z, 1.1);
  for (let x = PLAZA.x0 + 6; x < PLAZA.x1; x += 14) for (const z of [-40, 40]) lamp(x, z);
  for (let i = 0; i < 70; i++) {
    const alongX = rng() < 0.5, road = alongX ? pick(ZR) : pick(XR), dir = rng() < 0.5 ? 1 : -1;
    const along = rr(-300, 300), lane = dir * (rng() < 0.5 ? 2 : 6);
    if ((alongX ? XR : ZR).some((q) => Math.abs(along - q) < ROAD_HALF + 3)) continue;
    if (Math.abs(along) > 260 && rng() < 0.6) continue;
    if (alongX) car(along, road + lane, dir, 0);
    else car(road - lane, along, 0, dir);
  }
  // Watch-party crowd in front of the outdoor screen, plus people around the plaza and sidewalks.
  for (let i = 0; i < 320; i++) person(rr(112, 138), rr(-24, 24) * Math.sqrt(rng()));
  for (let i = 0; i < 90; i++) person(rr(PLAZA.x0, PLAZA.x1), rr(PLAZA.z0, PLAZA.z1));
  for (let i = 0; i < 60; i++) {
    const rz = pick([-103, 102]);
    person(rr(-100, 150), rz + (rng() < 0.5 ? -1 : 1) * rr(ROAD_HALF + 1, ROAD_HALF + 4));
  }
  panel(141.9, 4.6, -10.4, 0, 0, 1, 0, 1, 0, 20.8, 11.8, 0.4, () => [0.02, 0.02, 0.025]);
  canvasPanel([142, 5, -10], [0, 0, 1], [0, 1, 0], 20, 11, 0.2 * Math.sqrt(k), drawScore, 1.5);
  line(142.3, 0, -9, 142.3, 5, -9, 0.2, 0.3, 0.12, 0.12, 0.13);
  line(142.3, 0, 9, 142.3, 5, 9, 0.2, 0.3, 0.12, 0.12, 0.13);
}

/** Builds everything outside and returns the solid building footprints for the ray tracer. */
export function buildExterior(k: number): Box[] {
  const boxes: Box[] = [];
  buildShell(k);
  buildFordHall(k);
  buildGround(k);
  buildCity(k, boxes);
  buildStreetLife(k);
  return boxes;
}
