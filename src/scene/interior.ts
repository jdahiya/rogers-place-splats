// The inside of the arena: ice, boards and glass, players, seating bowls, suites,
// ribbon boards, the centre-hung scoreboard, rafters and banners.
import { HALF_PI, PI, type RGB, type Vec3 } from '../util/math';
import { hash, pick, rng, rr, wpick } from '../util/random';
import { glow, setJitter } from '../splats/store';
import { S, SC, blob, canvasPanel, ell, lightBlob, line, panel, rasterize, reflectFrom, type Color } from '../splats/primitives';
import { RA, RB, RR, SX, SZ, bowl, ceilY, perimeter, sdRR, walk } from './arena';
import { AWAY, BLUE, FAN_SHIRTS, HAIR, HOME, OFFICIAL, PANTS, RED, SKIN, type Team } from './palette';
import { drawClock, drawCup, drawEmblem, drawRetired, drawScore, drawStrip } from './screens';

// ---- Ice --------------------------------------------------------------------

function buildIce(k: number): void {
  const sp = 0.26 * k;
  for (let x = -RA; x < RA; x += sp) {
    for (let z = -RB; z < RB; z += sp) {
      const px = x + sp * (0.5 + (rng() - 0.5) * 0.6), pz = z + sp * (0.5 + (rng() - 0.5) * 0.6);
      if (sdRR(px, pz, 0) > -0.03) continue;
      // The lights focus on the middle of the sheet; the ends and corners fall off a little.
      const fall = 1.03 - 0.07 * (px / RA) ** 2 - 0.05 * (pz / RB) ** 2;
      const v = (0.94 + 0.05 * rng() - (rng() < 0.06 ? 0.05 : 0)) * fall;
      // Slightly translucent so the blurred reflections underneath show through.
      S(px, 0, pz, 1, 0, 0, 0, 0, 1, sp * 0.72, sp * 0.72, 0.01, 0.88 * v, 0.93 * v, 0.97 * v, 0.72);
    }
  }
  canvasPanel([-3.4, 0.006, 3.4], [1, 0, 0], [0, 0, -1], 6.8, 6.8, 0.07, drawEmblem, 1, 0.85);
  const old = setJitter(0.03);
  stripeX(0, 0.305, RED);
  stripeX(7.77, 0.305, BLUE);
  stripeX(-7.77, 0.305, BLUE);
  stripeX(27.13, 0.06, RED);
  stripeX(-27.13, 0.06, RED);
  ring(0, 0, 4.57, 0.06, BLUE);
  disk(0, 0, 0.16, BLUE);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      ring(sx * 21.03, sz * 6.71, 4.57, 0.06, RED);
      disk(sx * 21.03, sz * 6.71, 0.305, RED);
      disk(sx * 9.14, sz * 6.71, 0.305, RED);
    }
  }
  crease(27.13, 1);
  crease(-27.13, -1);
  ring(0, RB, 3.05, 0.06, RED, PI, 2 * PI);
  setJitter(old);
}

/** A painted line across the rink at x0. */
function stripeX(x0: number, w: number, c: RGB): void {
  const ax = Math.abs(x0);
  const zm = ax <= SX ? RB : SZ + Math.sqrt(Math.max(RR * RR - (ax - SX) ** 2, 0));
  const st = 0.12, rows = Math.max(1, Math.round(w / 0.1)), rw = w / rows;
  for (let z = -zm + st / 2; z < zm - 0.05; z += st) {
    for (let r = 0; r < rows; r++) S(x0 - w / 2 + rw * (r + 0.5), 0.012, z, 0, 0, 1, 1, 0, 0, st * 0.62, rw * 0.5, 0.004, ...c, 0.97);
  }
}

function ring(cx: number, cz: number, r: number, w: number, c: RGB, a0 = 0, a1 = 2 * PI): void {
  const n = Math.ceil(((a1 - a0) * r) / 0.1), seg = ((a1 - a0) * r) / n;
  for (let i = 0; i < n; i++) {
    const th = a0 + ((i + 0.5) / n) * (a1 - a0), cs = Math.cos(th), sn = Math.sin(th);
    S(cx + r * cs, 0.013, cz + r * sn, -sn, 0, cs, cs, 0, sn, seg * 0.62, w * 0.5, 0.004, ...c, 0.97);
  }
}

function disk(cx: number, cz: number, r: number, c: RGB): void {
  const st = Math.min(0.07, r * 0.6);
  for (let x = -r; x <= r; x += st) {
    for (let z = -r; z <= r; z += st) {
      if (x * x + z * z <= r * r) S(cx + x, 0.014, cz + z, 1, 0, 0, 0, 0, 1, st * 0.65, st * 0.65, 0.004, ...c, 0.97);
    }
  }
}

/** Goal crease: a light-blue half disc on the centre side of the goal line. */
function crease(gx: number, s: number): void {
  const r = 1.83, st = 0.1;
  for (let x = -r; x <= 0; x += st) {
    for (let z = -r; z <= r; z += st) {
      if (x * x + z * z <= r * r) S(gx + s * x, 0.011, z, 1, 0, 0, 0, 0, 1, st * 0.65, st * 0.65, 0.004, 0.5, 0.74, 0.95, 0.9);
    }
  }
  ring(gx, 0, r, 0.06, RED, s > 0 ? HALF_PI : -HALF_PI, s > 0 ? 3 * HALF_PI : HALF_PI);
}

// ---- Boards and glass -------------------------------------------------------------

/** Dasher-board advertising: mostly white panels with coloured blocks and text-like bands. */
function boardAd(h: number, lu: number, v: number): RGB {
  const band = v > 0.3 && v < 0.72 && lu > 0.12 && lu < 0.88;
  const text = band && v > 0.38 && v < 0.64 && Math.sin(lu * 120) > -0.2;
  const white: RGB = [0.94, 0.94, 0.95];
  switch (Math.floor(h * 6)) {
    case 0:
    case 1: return text ? [0.1, 0.18, 0.42] : white;
    case 2: return text ? white : [1, 0.33, 0.03];
    case 3: return band ? (text ? [0.02, 0.12, 0.3] : [1, 0.36, 0.05]) : [0.03, 0.14, 0.36];
    case 4: return text ? [0.8, 0.1, 0.12] : white;
    default: return text ? white : [0.08, 0.08, 0.1];
  }
}

function buildBoards(k: number): void {
  const done = reflectFrom();
  const st = 0.14 * k;
  walk(0.06, st, (x, z, nx, nz, _s, _f, _L, a) => {
    const tx = -nz, tz = nx, pi = Math.floor(a / 5.4), h = hash(pi, 7, 3), lu = a / 5.4 - pi;
    for (let y = st * 0.5; y < 1.07; y += st) {
      const c: RGB = y < 0.2 ? [0.93, 0.78, 0.15] : boardAd(h, lu, (y - 0.2) / 0.8);
      S(x, y, z, tx, 0, tz, 0, 1, 0, st * 0.7, st * 0.7, 0.03, ...c);
    }
    S(x, 1.09, z, tx, 0, tz, nx, 0, nz, st * 0.7, 0.1, 0.03, 0.14, 0.2, 0.36);
  });
  const gs = 0.55 * k;
  walk(0.08, gs, (x, z, nx, nz, s) => {
    const tx = -nz, tz = nx, H = s === 2 || s === 6 ? 2.44 : 3.1;
    for (let y = 1.15 + gs * 0.5; y < 1.12 + H; y += gs) S(x, y, z, tx, 0, tz, 0, 1, 0, gs * 0.7, gs * 0.7, 0.01, 0.78, 0.88, 0.96, 0.05);
    S(x, 1.12 + H, z, tx, 0, tz, 0, 1, 0, gs * 0.6, 0.02, 0.01, 0.85, 0.92, 1, 0.4);
  });
  walk(0.08, 2.4, (x, z, _nx, _nz, s) => {
    const H = s === 2 || s === 6 ? 2.44 : 3.1;
    line(x, 1.12, z, x, 1.12 + H, z, 0.02, 0.12, 0.6, 0.7, 0.78, 0.25);
  });
  done();
  // Rubber flooring between the boards and the first row.
  for (const d of [0.45, 1.0, 1.5]) walk(d, 0.35, (x, z, nx, nz) => S(x, 0.02, z, -nz, 0, nx, nx, 0, nz, 0.25, 0.3, 0.02, 0.06, 0.06, 0.07));
}

// ---- Nets and players -------------------------------------------------------------

function goal(s: number): void {
  const gx = s * 27.13, bx = gx + s * 1.1, c: RGB = [0.85, 0.08, 0.08];
  line(gx, 0, -0.915, gx, 1.22, -0.915, 0.03, 0.06, ...c);
  line(gx, 0, 0.915, gx, 1.22, 0.915, 0.03, 0.06, ...c);
  line(gx, 1.22, -0.915, gx, 1.22, 0.915, 0.03, 0.06, ...c);
  line(gx, 0.03, -0.915, bx, 0.03, -0.6, 0.025, 0.08, ...c);
  line(bx, 0.03, -0.6, bx, 0.03, 0.6, 0.025, 0.08, ...c);
  line(bx, 0.03, 0.6, gx, 0.03, 0.915, 0.025, 0.08, ...c);
  for (let a = 0.05; a < 1; a += 0.1) {
    const x = gx + (bx - gx) * a, top = 1.22 + (0.7 - 1.22) * a, hw = 0.915 + (0.6 - 0.915) * a;
    for (let z = -hw; z <= hw; z += 0.1) blob(x, top, z, 0.05, 0.95, 0.95, 0.95, 0.25);
    for (let y = 0.05; y < top; y += 0.1) {
      blob(x, y, -hw, 0.05, 0.95, 0.95, 0.95, 0.25);
      blob(x, y, hw, 0.05, 0.95, 0.95, 0.95, 0.25);
    }
  }
  for (let z = -0.6; z <= 0.6; z += 0.1) for (let y = 0.05; y < 0.7; y += 0.1) blob(bx, y, z, 0.05, 0.95, 0.95, 0.95, 0.25);
}

function skater(x: number, z: number, th: number, T: Team, goalie = false): void {
  const fx = Math.cos(th), fz = Math.sin(th), rx = -fz, rz = fx, g = goalie ? 1.35 : 1;
  const at = (f: number, r: number, y: number): Vec3 => [x + fx * f + rx * r, y, z + fz * f + rz * r];
  const pads: RGB = [0.92, 0.92, 0.94];
  let p: Vec3;
  for (const sd of [-1, 1]) {
    p = at(0, 0.14 * sd * g, 0.06);
    S(...p, fx, 0, fz, 0, 1, 0, 0.16, 0.05, 0.05, 0.05, 0.05, 0.06);
    p = at(0, 0.14 * sd * g, goalie ? 0.35 : 0.42);
    S(...p, fx, 0, fz, 0, 1, 0, 0.09 * g, goalie ? 0.3 : 0.26, 0.09 * g, ...(goalie ? pads : T.jersey));
  }
  const h = goalie ? -0.15 : 0;
  p = at(0, 0, 0.85 + h);
  S(...p, rx, 0, rz, 0, 1, 0, 0.22 * g, 0.17, 0.15 * g, ...T.pants);
  const lean = goalie ? 0.5 : 0.35, vl = Math.hypot(lean, 1);
  const vx = (fx * lean) / vl, vy = 1 / vl, vz = (fz * lean) / vl;
  p = at(0.12, 0, 1.28 + h);
  S(...p, rx, 0, rz, vx, vy, vz, 0.25 * g, 0.28, 0.16 * g, ...T.jersey);
  p = at(0.04, 0, 1.02 + h);
  S(...p, rx, 0, rz, vx, vy, vz, 0.24 * g, 0.04, 0.16 * g, ...T.trim);
  p = at(0.18, 0, 1.52 + h);
  S(...p, rx, 0, rz, vx, vy, vz, 0.25 * g, 0.05, 0.15 * g, ...T.trim);
  for (const sd of [-1, 1]) {
    const a = at(0.2, 0.25 * sd * g, 1.45 + h), b = at(0.45, 0.2 * sd * g, 1.05 + h);
    line(...a, ...b, 0.07 * g, 0.12, ...T.jersey);
    blob(...b, 0.07 * g, ...T.glove);
  }
  p = at(0.28, 0, 1.72 + h * 1.2);
  blob(...p, goalie ? 0.14 : 0.11, ...(goalie ? pads : T.helmet));
  const hand = at(0.5, 0.1, 1.0 + h), blade = at(1.4, 0.25, 0.05);
  line(...hand, ...blade, 0.025, 0.1, 0.08, 0.08, 0.09);
  S(blade[0], 0.05, blade[2], fx, 0, fz, 0, 1, 0, 0.14, 0.04, 0.02, 0.9, 0.9, 0.9);
}

function buildPlayers(): void {
  const done = reflectFrom();
  const toward = (x: number, z: number, tx: number, tz: number): number => Math.atan2(tz - z, tx - x);
  const puck: [number, number] = [24.6, 0.9];
  S(puck[0], 0.015, puck[1], 1, 0, 0, 0, 0, 1, 0.04, 0.04, 0.01, 0.02, 0.02, 0.02);
  for (const [x, z] of [[22.2, 3.4], [18.6, -5.2], [24.4, -2.6], [12.8, 6.4], [9.6, -6]] as const) {
    skater(x, z, toward(x, z, ...puck) + rr(-0.3, 0.3), HOME);
  }
  skater(-26.3, 0, 0, HOME, true);
  skater(26.3, 0, PI, AWAY, true);
  for (const [x, z] of [[23.2, 1.4], [20.4, -3.4], [15.4, 4.6], [11.2, -2.2], [7.4, 5.2]] as const) {
    skater(x, z, toward(x, z, ...puck) + rr(-0.4, 0.4), AWAY);
  }
  for (const [x, z] of [[20.5, 10], [3, -9.5], [8.4, 11.2]] as const) skater(x, z, toward(x, z, ...puck), OFFICIAL);
  goal(1);
  goal(-1);
  done();
}

function seated(x: number, y: number, z: number, T: Team): void {
  ell(x, y + 0.55, z, 0.2, 0.12, 0.22, T.pants);
  ell(x, y + 0.95, z, 0.22, 0.28, 0.14, T.jersey);
  blob(x, y + 1.35, z, 0.11, ...T.helmet);
}

function buildBenches(): void {
  for (let x = -14; x < 14; x += 0.35) {
    if (Math.abs(x) < 2.6) continue;
    for (let dz = 0.2; dz < 2.6; dz += 0.35) S(x, 0.12, -(RB + dz), 1, 0, 0, 0, 0, 1, 0.25, 0.25, 0.02, 0.06, 0.06, 0.07);
    S(x, 0.6, -(RB + 2.6), 1, 0, 0, 0, 1, 0, 0.2, 0.35, 0.03, 0.05, 0.05, 0.06);
  }
  for (let x = -13.2; x < -3; x += 0.9) seated(x, 0.1, -(RB + 1.5), HOME);
  for (let x = 3.5; x < 13.5; x += 0.9) seated(x, 0.1, -(RB + 1.5), AWAY);
  for (let x = -5.5; x < 5.5; x += 0.35) {
    for (let dz = 0.2; dz < 2.4; dz += 0.35) S(x, 0.12, RB + dz, 1, 0, 0, 0, 0, 1, 0.25, 0.25, 0.02, 0.07, 0.07, 0.08);
  }
  seated(-3.4, 0.1, RB + 1.2, AWAY);
  seated(-2.6, 0.1, RB + 1.2, OFFICIAL);
}

// ---- Seating ------------------------------------------------------------------

/** One seat and, usually, a fan in it. Local frame: outward normal n, tangent t along the row. */
function seat(x: number, y: number, z: number, nx: number, nz: number, occ: number, dim: number): void {
  const tx = -nz, tz = nx;
  const at = (dn: number, dy: number, dt = 0): Vec3 => [x + nx * dn + tx * dt, y + dy, z + nz * dn + tz * dt];
  let p = at(-0.05, 0.44);
  S(...p, tx, 0, tz, nx, 0, nz, 0.2, 0.17, 0.03, 0.1 * dim, 0.1 * dim, 0.11 * dim);
  p = at(0.18, 0.72);
  S(...p, tx, 0, tz, 0, 1, 0, 0.2, 0.2, 0.03, 0.11 * dim, 0.11 * dim, 0.12 * dim);
  if (rng() > occ) return;

  const m = (c: RGB, k = 1): Vec3 => [c[0] * dim * k, c[1] * dim * k, c[2] * dim * k];
  const shirt = m(wpick(FAN_SHIRTS)), pants = m(pick(PANTS), 0.8), skin = m(pick(SKIN));
  const stand = rng() < 0.07 ? 0.42 : 0;
  if (!stand) {
    p = at(-0.2, 0.5);
    S(...p, tx, 0, tz, nx, 0, nz, 0.17, 0.2, 0.08, ...pants);
  }
  p = at(-0.42 + stand * 0.9, 0.25 + stand * 0.4);
  S(...p, tx, 0, tz, 0, 1, 0, 0.15, 0.2 + stand * 0.5, 0.08, ...pants);
  const ty = 0.92 + stand, tn = 0.05 - stand * 0.3;
  p = at(tn, ty);
  S(...p, tx, 0, tz, 0, 1, 0, 0.18, 0.24, 0.12, ...shirt);
  const cheering = rng() < 0.05;
  for (const sd of [-1, 1]) {
    if (cheering) {
      p = at(tn, ty + 0.55, sd * 0.2);
      S(...p, 0, 1, 0, tx, 0, tz, 0.22, 0.05, 0.05, ...shirt);
    } else {
      p = at(tn - 0.08, ty - 0.08, sd * 0.24);
      S(...p, tx, 0, tz, 0, 1, 0, 0.055, 0.2, 0.06, ...shirt);
    }
  }
  p = at(tn - 0.03, ty + 0.4);
  blob(...p, 0.1, ...skin);
  p = at(tn + 0.01, ty + 0.46);
  if (rng() < 0.2) blob(...p, 0.095, ...shirt);
  else blob(...p, 0.085, ...m(pick(HAIR)));
  // A few phones held up, glowing.
  if (rng() < 0.03) {
    glow(2.2);
    p = at(tn - 0.28, ty + 0.1);
    blob(...p, 0.045, 0.75, 0.85, 1);
    glow(1);
  }
}

interface TierSpec {
  d0: number;
  y0: number;
  depth: number;
  rows: number;
  rise: (row: number) => number;
  stepT: number;
  occ: number;
  dim: number;
  /** How much darker the back row is than the front (lights aim at the ice). */
  fall: number;
  /** Sections per ring segment; each section starts with an aisle. */
  secN: readonly number[];
  aisle: number;
  skip?: (row: number, x: number, z: number, seg: number) => boolean;
  portal?: (row: number, seg: number, section: number, w: number, secL: number) => boolean;
}

/** A tier of rows. Returns the tread height of each row. */
function tier(o: TierSpec): number[] {
  const heights: number[] = [];
  let y = o.y0;
  for (let r = 0; r < o.rows; r++) {
    const rise = o.rise(r);
    if (r > 0) y += rise;
    heights.push(y);
    const d = o.d0 + r * o.depth, dim = o.dim * (1 - (o.fall * r) / o.rows);
    walk(d, o.stepT, (x, z, nx, nz) => S(x, y - rise * 0.5, z, -nz, 0, nx, 0, 1, 0, o.stepT * 0.7, rise * 0.55, 0.03, 0.15 * dim, 0.15 * dim, 0.17 * dim));
    for (const fd of [0.22, 0.64]) {
      walk(d + o.depth * fd, o.stepT, (x, z, nx, nz) => S(x, y, z, -nz, 0, nx, nx, 0, nz, o.stepT * 0.7, o.depth * 0.28, 0.03, 0.2 * dim, 0.2 * dim, 0.22 * dim));
    }
    walk(d + o.depth * 0.45, 0.52, (x, z, nx, nz, s, f, L) => {
      const sn = o.secN[s]!, ff = f * sn, section = Math.floor(ff), secL = L / sn, w = (ff - section) * secL;
      const tx = -nz, tz = nx;
      if (w < o.aisle) {
        S(x, y + 0.01, z, tx, 0, tz, nx, 0, nz, 0.3, o.depth * 0.45, 0.02, 0.36 * dim, 0.36 * dim, 0.38 * dim);
        S(x - nx * o.depth * 0.42, y + 0.02, z - nz * o.depth * 0.42, tx, 0, tz, nx, 0, nz, 0.3, 0.03, 0.01, 0.75, 0.64, 0.22);
        return;
      }
      if (o.skip?.(r, x, z, s)) return;
      if (o.portal?.(r, s, section, w, secL)) {
        S(x, y + 0.5, z, tx, 0, tz, 0, 1, 0, 0.32, 0.65, 0.05, 0.015, 0.015, 0.02);
        S(x, y + 0.02, z, tx, 0, tz, nx, 0, nz, 0.32, o.depth * 0.5, 0.03, 0.02, 0.02, 0.025);
        return;
      }
      seat(x, y, z, nx, nz, o.occ, dim);
    });
  }
  return heights;
}

/** Both seating bowls, the suite level and the ribbon boards. Returns the offset of the back wall. */
function buildBowl(k: number): number {
  const stepT = 0.36 * k;
  const lower = tier({
    d0: 1.8, y0: 0.55, depth: 0.86, rows: 26, rise: (r) => 0.3 + 0.011 * r, stepT, occ: 0.9, dim: 0.97, fall: 0.2,
    secN: [1, 3, 5, 3, 1, 3, 5, 3], aisle: 1.1,
    // Team benches and the penalty boxes cut into the first rows.
    skip: (r, x, _z, s) => r < 3 && ((s === 6 && Math.abs(x) < 14.5) || (s === 2 && Math.abs(x) < 6)),
    portal: (r, s, section, w, secL) =>
      r >= 12 && r <= 17 && Math.abs(w - secL * 0.55) < 1.5 && (s === 2 || s === 6 ? section % 2 === 1 : s & 1 ? section === 1 : false),
  });
  const dLowEnd = 1.8 + 26 * 0.86, yWalk = lower[lower.length - 1]! + 0.55;
  walk(dLowEnd, stepT, (x, z, nx, nz) => S(x, yWalk - 0.28, z, -nz, 0, nx, 0, 1, 0, stepT * 0.7, 0.3, 0.03, 0.14, 0.14, 0.16));
  for (const dd of [0.4, 1.1, 1.8]) {
    walk(dLowEnd + dd, stepT, (x, z, nx, nz) => S(x, yWalk, z, -nz, 0, nx, nx, 0, nz, stepT * 0.7, 0.4, 0.03, 0.23, 0.23, 0.25));
  }

  // Suite level: glass-fronted boxes with warm interiors.
  const dF = dLowEnd + 2.2, yU0 = 18.0, sp = 0.3 * k;
  walk(dF, sp, (x, z, nx, nz, _s, _f, _L, a) => {
    const tx = -nz, tz = nx, si = Math.floor(a / 4.2), lu = a / 4.2 - si;
    for (let y = yWalk + sp / 2; y < 16.3; y += sp) {
      let c: Color;
      if (y < yWalk + 1.0) c = [0.5, 0.6, 0.7, 0.25];
      else if (y < 14.9 && lu > 0.06 && lu < 0.94) {
        const t = (y - yWalk - 1.0) / (14.9 - yWalk - 1.0), shade = hash(si, Math.floor(lu * 6), 9);
        c = t > 0.85 ? [0.95, 0.8, 0.55, 1, 1.4] : shade < 0.25 ? [0.18, 0.12, 0.1] : [0.5 + t * 0.15, 0.38 + t * 0.1, 0.26];
      } else if (y > 15.3 && y < 15.5) c = [0.9, 0.9, 1, 1, 1.6];
      else c = [0.07, 0.07, 0.08];
      SC(x, y, z, tx, 0, tz, 0, 1, 0, sp * 0.7, sp * 0.7, 0.03, c);
    }
  });

  // LED ribbon board on the upper-bowl fascia.
  {
    const done = reflectFrom();
    const dR = dF - 0.2, Lr = perimeter(dR), stA = 0.14 * Math.sqrt(k), rows = 11, h = 1.1, y0 = 16.3;
    const W = Math.round(Lr / stA);
    const px = rasterize(W, rows, drawStrip);
    const old = setJitter(0.02);
    glow(1.45);
    walk(dR, stA, (x, z, nx, nz, _s, _f, _L, a) => {
      const col = Math.min(W - 1, Math.floor((a / Lr) * W)), tx = -nz, tz = nx;
      for (let j = 0; j < rows; j++) {
        const q = (j * W + col) * 4, y = y0 + (1 - (j + 0.5) / rows) * h;
        S(x, y, z, tx, 0, tz, 0, 1, 0, stA * 0.64, (h / rows) * 0.64, 0.02, px[q]! / 255, px[q + 1]! / 255, px[q + 2]! / 255);
      }
    });
    glow(1);
    setJitter(old);
    done();
  }
  walk(dF + 0.3, 0.4 * k, (x, z, nx, nz) => {
    for (let y = 17.5; y < 18.9; y += 0.4) S(x, y, z, -nz, 0, nx, 0, 1, 0, 0.3, 0.3, 0.02, 0.35, 0.45, 0.55, 0.18);
  });

  // Upper bowl: 22 steeper rows.
  const d0U = dF + 0.8;
  const upper = tier({
    d0: d0U, y0: yU0, depth: 0.8, rows: 22, rise: (r) => 0.52 + 0.012 * r, stepT, occ: 0.84, dim: 0.86, fall: 0.3,
    secN: [1, 3, 6, 3, 1, 3, 6, 3], aisle: 1.1,
  });
  const dUEnd = d0U + 22 * 0.8, yTop = upper[upper.length - 1]! + 0.6;
  for (const dd of [0.4, 1.1]) walk(dUEnd + dd, stepT, (x, z, nx, nz) => S(x, yTop, z, -nz, 0, nx, nx, 0, nz, stepT * 0.7, 0.4, 0.03, 0.12, 0.12, 0.13));

  // Back wall with glowing openings into the upper concourse.
  const dBack = dUEnd + 1.6, wsp = 0.5 * k;
  walk(dBack, wsp, (x, z, nx, nz, _s, _f, _L, a) => {
    const top = ceilY(x, z), open = a % 18 < 5;
    for (let y = yTop; y < top + 0.3; y += wsp) {
      const lit = open && y > yTop + 0.4 && y < yTop + 3.6;
      SC(x, y, z, -nz, 0, nx, 0, 1, 0, wsp * 0.72, wsp * 0.72, 0.04, lit ? [0.62, 0.46, 0.3, 1, 1.15] : [0.08, 0.08, 0.095]);
    }
  });

  Object.assign(bowl, { lower, upper, dLowEnd, yWalk, dF, d0U, dUEnd, yTop, dBack });
  return dBack;
}

// ---- Roof, scoreboard, banners -------------------------------------------------------

function buildRoofInterior(k: number, dBack: number): void {
  const sp = 1.3 * k, lim = SX + RR + dBack + 1;
  for (let x = -lim; x < lim; x += sp) {
    for (let z = -lim; z < lim; z += sp) {
      const px = x + rr(0, sp), pz = z + rr(0, sp);
      if (sdRR(px, pz, dBack + 0.3) > 0) continue;
      const c = sdRR(px, pz, 4) < 0 ? 0.1 : 0.06;
      S(px, ceilY(px, pz), pz, 1, 0, 0, 0, 0, 1, sp * 0.78, sp * 0.78, 0.05, c, c * 1.05, c * 1.2);
    }
  }
  const steel: RGB = [0.3, 0.31, 0.33];
  for (let x = -72; x <= 72; x += 8) {
    let zm = 0;
    while (sdRR(x, zm + 1, dBack) < 0) zm += 1;
    if (zm < 3) continue;
    const top = (z: number): number => ceilY(x, z) - 0.4, bottom = (z: number): number => ceilY(x, z) - 2.6;
    for (let z = -zm; z < zm; z += 2) {
      const z2 = Math.min(z + 2, zm);
      line(x, top(z), z, x, top(z2), z2, 0.07, 0.5, ...steel);
      line(x, bottom(z), z, x, bottom(z2), z2, 0.07, 0.5, ...steel);
      line(x, bottom(z), z, x, top(z2), z2, 0.05, 0.5, ...steel);
    }
  }
  const done = reflectFrom();
  for (const d of [-3, 5, 13]) {
    walk(d, 0.4, (x, z, nx, nz) => S(x, 38, z, -nz, 0, nx, nx, 0, nz, 0.28, 0.35, 0.03, 0.22, 0.23, 0.25));
    walk(d, 2.4, (x, z) => lightBlob(x, 37.6, z, 0.16, 1, 0.98, 0.93, 3.2, 4.5));
  }
  done();
}

function buildScoreboard(k: number): void {
  const done = reflectFrom();
  const x0 = 6.6, z0 = 3.6, y0 = 19.8, y1 = 27.2, sp = 0.11 * Math.sqrt(k);
  const black = (): Color => [0.03, 0.03, 0.035];
  panel(-x0, y0, z0 - 0.08, 1, 0, 0, 0, 1, 0, 2 * x0, y1 - y0, 0.3, black);
  panel(x0, y0, -z0 + 0.08, -1, 0, 0, 0, 1, 0, 2 * x0, y1 - y0, 0.3, black);
  panel(x0 - 0.08, y0, z0, 0, 0, -1, 0, 1, 0, 2 * z0, y1 - y0, 0.3, black);
  panel(-x0 + 0.08, y0, -z0, 0, 0, 1, 0, 1, 0, 2 * z0, y1 - y0, 0.3, black);
  panel(-x0, y1, -z0, 1, 0, 0, 0, 0, 1, 2 * x0, 2 * z0, 0.4, black);
  panel(-x0, y0, -z0, 1, 0, 0, 0, 0, 1, 2 * x0, 2 * z0, 0.4, black);
  const ys = y0 + 0.35, hs = y1 - y0 - 0.7;
  canvasPanel([-6.3, ys, z0], [1, 0, 0], [0, 1, 0], 12.6, hs, sp, drawScore, 1.5);
  canvasPanel([6.3, ys, -z0], [-1, 0, 0], [0, 1, 0], 12.6, hs, sp, drawScore, 1.5);
  canvasPanel([x0, ys, 3.3], [0, 0, -1], [0, 1, 0], 6.6, hs, sp, drawClock, 1.5);
  canvasPanel([-x0, ys, -3.3], [0, 0, 1], [0, 1, 0], 6.6, hs, sp, drawClock, 1.5);
  // Ring board under the main box.
  const rx = 5.2, rz = 2.8, ry = 18.9, rh = 0.8, rs = 0.1;
  canvasPanel([-rx, ry, rz], [1, 0, 0], [0, 1, 0], 2 * rx, rh, rs, drawStrip, 1.5);
  canvasPanel([rx, ry, -rz], [-1, 0, 0], [0, 1, 0], 2 * rx, rh, rs, drawStrip, 1.5);
  canvasPanel([rx, ry, rz], [0, 0, -1], [0, 1, 0], 2 * rz, rh, rs, drawStrip, 1.5);
  canvasPanel([-rx, ry, -rz], [0, 0, 1], [0, 1, 0], 2 * rz, rh, rs, drawStrip, 1.5);
  panel(-rx, ry, -rz, 1, 0, 0, 0, 0, 1, 2 * rx, 2 * rz, 0.4, black);
  line(-rx, ry + rh, 0, -rx, y0, 0, 0.1, 0.2, 0.05, 0.05, 0.06);
  line(rx, ry + rh, 0, rx, y0, 0, 0.1, 0.2, 0.05, 0.05, 0.06);
  glow(2.5);
  for (let x = -x0; x <= x0; x += 0.8) {
    blob(x, y1 + 0.05, z0, 0.06, 1, 1, 1);
    blob(x, y1 + 0.05, -z0, 0.06, 1, 1, 1);
  }
  glow(1);
  done();
  for (const [cx, cz] of [[-x0, -z0], [x0, -z0], [-x0, z0], [x0, z0]] as const) {
    line(cx, y1, cz, cx, ceilY(cx, cz) - 2.6, cz, 0.02, 0.3, 0.2, 0.2, 0.22, 0.6);
  }
}

function buildBanners(k: number): void {
  const sp = 0.065 * Math.sqrt(k), W = 2.6, H = 5.0, yb = 28.5;
  const hang = (x: number, z0: number, z1: number): void => {
    line(x, yb + H, z0, x, ceilY(x, z0) - 2.6, z0, 0.012, 0.3, 0.4, 0.4, 0.42, 0.6);
    line(x, yb + H, z1, x, ceilY(x, z1) - 2.6, z1, 0.012, 0.3, 0.4, 0.4, 0.42, 0.6);
  };
  // Retired numbers over the east end, Stanley Cup years over the west end.
  [3, 4, 7, 9, 11, 17, 31, 99].forEach((n, i) => {
    const zc = -11.55 + i * 3.3;
    canvasPanel([48, yb, zc - W / 2], [0, 0, 1], [0, 1, 0], W, H, sp, drawRetired(n));
    hang(48, zc - W / 2, zc + W / 2);
  });
  [1984, 1985, 1987, 1988, 1990].forEach((year, i) => {
    const zc = -8 + i * 4;
    canvasPanel([-48, yb, zc + W / 2], [0, 0, -1], [0, 1, 0], W, H, sp, drawCup(year));
    hang(-48, zc - W / 2, zc + W / 2);
  });
}

/** k scales splat spacing: 1 / sqrt(density). */
export function buildInterior(k: number): void {
  buildIce(k);
  buildBoards(k);
  buildPlayers();
  buildBenches();
  const dBack = buildBowl(k);
  buildRoofInterior(k, dBack);
  buildScoreboard(k);
  buildBanners(k);
}
