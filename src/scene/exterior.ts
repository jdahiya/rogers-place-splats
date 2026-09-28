// Outside the arena: the envelope (see shell.ts), the plaza, streets, trees and downtown blocks.
import { TOUR, VIEWS } from '../camera/stations';
import { clamp, type RGB, type Vec3 } from '../util/math';
import { hash, pick, reseed, rng, rr } from '../util/random';
import { glow } from '../splats/store';
import { S, SC, blob, canvasPanel, lightBlob, line, panel, type Color } from '../splats/primitives';
import { buildEnvelope, person, sdFootprint } from './shell';
import { CAR_PAINT } from './palette';
import { drawScore } from './screens';
import { tree } from './trees';

/** Footprint of a solid building, used by the ray tracer. */
export interface Box {
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
}

/** Roads running north-south sit at these x; roads running east-west at these z. */
const XR = [-250, -108, 158, 300];
const ZR = [-240, -103, 102, 240];
const ROAD_HALF = 8;
const PLAZA = { x0: 108, x1: 145, z0: -90, z1: 90 };

const inPlaza = (x: number, z: number): boolean => x > PLAZA.x0 && x < PLAZA.x1 && z > PLAZA.z0 && z < PLAZA.z1;

/** The plaza and a 20 m apron round the building get finer paving than the rest of the ground. */
const inApron = (x: number, z: number): boolean => sdFootprint(x, z) < 20 || inPlaza(x, z);

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
  if (inPlaza(x, z)) return [0.47, 0.46, 0.44];
  if (sdFootprint(x, z) < 12 && x > -108 && x < 158 && Math.abs(z) < 103) return [0.4, 0.4, 0.41];
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
        // The building's own floors are built with it, and the apron below.
        if (sdFootprint(px, pz) < 0.5 || inApron(px, pz)) continue;
        const c = groundColor(px, pz), fade = extent > 420 ? 0.7 : 1;
        S(px, 0, pz, 1, 0, 0, 0, 0, 1, sp * 0.74, sp * 0.74, 0.05, c[0] * fade, c[1] * fade, c[2] * fade);
      }
    }
    inner = extent;
  }
  // The apron on a regular grid.
  const as = 0.55 * k;
  for (let x = -105 + as / 2; x < 150; x += as) {
    for (let z = -92 + as / 2; z < 92; z += as) {
      if (!inApron(x, z) || sdFootprint(x, z) < 0.5) continue;
      const c = groundColor(x, z);
      S(x, 0, z, 1, 0, 0, 0, 0, 1, as * 0.7, as * 0.7, 0.04, c[0], c[1], c[2]);
    }
  }
  // Joints between the plaza's large pavers, every 3 m each way (not on the lightest setting).
  if (k > 1.2) return;
  const js = 0.35 * k, joint: RGB = [0.34, 0.33, 0.32];
  for (let x = PLAZA.x0 + 1.5; x < PLAZA.x1; x += 3) {
    for (let z = PLAZA.z0 + js / 2; z < PLAZA.z1; z += js) if (sdFootprint(x, z) > 0.5) S(x, 0.02, z, 0, 0, 1, 1, 0, 0, js * 0.7, 0.05, 0.02, ...joint);
  }
  for (let z = PLAZA.z0 + 1.5; z < PLAZA.z1; z += 3) {
    for (let x = PLAZA.x0 + js / 2; x < PLAZA.x1; x += js) if (sdFootprint(x, z) > 0.5) S(x, 0.02, z, 1, 0, 0, 0, 0, -1, js * 0.7, 0.05, 0.02, ...joint);
  }
}

type Facade = 'glass' | 'brick' | 'stantec';

/**
 * A downtown building. Unlit windows are reflective glass (negative gain), lit ones glow, and
 * spandrels are plain facade.
 */
function building(boxes: Box[], cx: number, cz: number, w: number, dp: number, h: number, style: Facade, id: number, k: number): void {
  boxes.push({ cx, cz, w, d: dp, h });
  const far = Math.hypot(cx, cz) > 260, sp = (far ? 2.6 : 1.1) * (style === 'stantec' ? 0.85 : 1) * k;
  const glassy = style !== 'brick';
  const facade: RGB = style === 'brick' ? [0.42, 0.3, 0.24] : style === 'stantec' ? [0.14, 0.2, 0.27] : [0.28, 0.3, 0.33];
  const litShare = style === 'stantec' ? 0.3 : 0.17;
  const reflect = style === 'stantec' ? -0.22 : glassy ? -0.16 : -0.08;
  const wall = (side: number) => (fu: number, _fv: number, _x: number, y: number): Color => {
    const floor = Math.floor(y / 3.6), fy = y / 3.6 - floor, col = Math.floor((fu * (side & 1 ? dp : w)) / 2.6);
    if (style === 'stantec' && y > h - 14) return fy < 0.3 || col % 3 === 0 ? [0.95, 0.97, 1, 1, 1.8] : [0.25, 0.32, 0.42, 1, -0.3];
    if (y < 5) return [0.85, 0.7, 0.5, 1, 1.3];
    if (fy < (glassy ? 0.2 : 0.4)) return facade;
    if (hash(id * 7 + side, floor, col) < litShare) return hash(id, floor, col) < 0.7 ? [0.95, 0.78, 0.5, 1, 1.6] : [0.82, 0.88, 0.98, 1, 1.6];
    const q = y / h;
    return glassy ? [0.12 + 0.2 * q, 0.16 + 0.2 * q, 0.24 + 0.24 * q, 1, reflect] : [0.12, 0.13, 0.16, 1, reflect];
  };
  panel(cx - w / 2, 0, cz - dp / 2, 1, 0, 0, 0, 1, 0, w, h, sp, wall(0));
  panel(cx + w / 2, 0, cz - dp / 2, 0, 0, 1, 0, 1, 0, dp, h, sp, wall(1));
  panel(cx + w / 2, 0, cz + dp / 2, -1, 0, 0, 0, 1, 0, w, h, sp, wall(2));
  panel(cx - w / 2, 0, cz + dp / 2, 0, 0, -1, 0, 1, 0, dp, h, sp, wall(3));
  panel(cx - w / 2, h, cz - dp / 2, 1, 0, 0, 0, 0, 1, w, dp, sp * 1.4, () => [0.2, 0.2, 0.22]);
  if (h > 90) lightBlob(cx, h + 1.5, cz, 0.35, 1, 0.1, 0.05, 3, 3);
}

/** Points along the arena's south-east face that the aerial station looks down on. */
const FACADE: Vec3[] = [[112, 4, -44], [50, 4, -52], [-20, 4, -62]];

/**
 * Lines the camera must see or fly along unobstructed: the aerial station's sightlines to the
 * arena, and the tour's descent from the aerial view to street level.
 */
const CLEAR: [Vec3, Vec3][] = [
  ...FACADE.map((t): [Vec3, Vec3] => [VIEWS.aerial[0], t]),
  ...TOUR.slice(0, 2).map((leg, i): [Vec3, Vec3] => [leg.eye, TOUR[i + 1]!.eye]),
];

/**
 * Caps a downtown building's height below every clear line passing over or near it, so the
 * opening view and the tour show the arena rather than whatever block happens to stand in front.
 */
function belowClearLines(cx: number, cz: number, w: number, d: number, h: number): number {
  const reach = Math.hypot(w, d) / 2;
  for (const [[ex, ey, ez], [tx, ty, tz]] of CLEAR) {
    const dx = tx - ex, dz = tz - ez, len = Math.hypot(dx, dz);
    const f = ((cx - ex) * dx + (cz - ez) * dz) / (len * len), fc = clamp(f, 0, 1);
    if (Math.hypot(cx - ex - dx * fc, cz - ez - dz * fc) > reach + 16) continue;
    // The line's height where it passes over the building's lower side, less a margin.
    const lo = clamp(f - reach / len, 0, 1), hi = clamp(f + reach / len, 0, 1);
    h = Math.min(h, Math.max(8, Math.min(ey + (ty - ey) * lo, ey + (ty - ey) * hi) - 8));
  }
  return h;
}

function buildCity(k: number, boxes: Box[]): void {
  reseed(31); // the city doesn't change when the arena's own geometry does
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
          const h = belowClearLines(cx, cz, w, d, rng() < 0.12 ? rr(80, 140) : 12 + Math.pow(rng(), 2.2) * 60);
          building(boxes, cx, cz, w, d, h, rng() < 0.35 ? 'brick' : 'glass', id++, k);
        }
      }
    }
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

/**
 * A car heading along (ux, uz): body, clear-coated hood, roof and trunk lid that pick up sky
 * reflections, raked glass, wheels, head- and tail-lights, and a soft contact shadow.
 */
function car(x: number, z: number, ux: number, uz: number): void {
  const paint = pick(CAR_PAINT), px = -uz, pz = ux;
  const coat: Color = [...paint, 1, -0.06], glass: Color = [0.04, 0.05, 0.07, 1, -0.3];
  // a runs along the car (+ is the front), b across it.
  const cx = (a: number, b: number): number => x + ux * a + px * b;
  const cz = (a: number, b: number): number => z + uz * a + pz * b;
  /** A flat piece in the car's own frame, tilted by (da, dy) along its length. */
  const piece = (a: number, b: number, y: number, da: number, dy: number, la: number, lb: number, c: Color): void =>
    SC(cx(a, b), y, cz(a, b), ux * da, dy, uz * da, px, 0, pz, la, lb, 0.03, c);
  piece(0, 0, 0.03, 1, 0, 1.9, 0.85, [0.02, 0.02, 0.02, 0.55]);
  for (const a of [-1.5, -0.5, 0.5, 1.5]) S(cx(a, 0), 0.62, cz(a, 0), ux, 0, uz, px, 0, pz, 0.6, 0.55, 0.2, ...paint);
  piece(1.6, 0, 0.93, 1, 0, 0.4, 0.55, coat); // hood
  piece(-1.7, 0, 0.95, 1, 0, 0.35, 0.55, coat); // trunk lid
  piece(-0.2, 0, 1.42, 1, 0, 0.4, 0.52, coat); // roof
  piece(0.62, 0, 1.2, -0.852, 0.524, 0.32, 0.6, glass); // windscreen
  piece(-0.92, 0, 1.2, 0.747, 0.664, 0.25, 0.58, glass); // rear window
  for (const sd of [-1, 1]) {
    SC(cx(-0.1, 0.8 * sd), 1.2, cz(-0.1, 0.8 * sd), ux, 0, uz, 0, 1, 0, 0.62, 0.14, 0.03, glass);
    for (const a of [-1.35, 1.35]) S(cx(a, 0.82 * sd), 0.34, cz(a, 0.82 * sd), ux, 0, uz, 0, 1, 0, 0.24, 0.24, 0.1, 0.03, 0.03, 0.035);
    lightBlob(cx(2.2, 0.6 * sd), 0.72, cz(2.2, 0.6 * sd), 0.1, 1, 0.97, 0.85, 3, 4);
    glow(2.5);
    blob(cx(-2.25, 0.62 * sd), 0.8, cz(-2.25, 0.62 * sd), 0.09, 1, 0.08, 0.05);
    glow(1);
  }
}

function buildStreetLife(k: number): void {
  reseed(47);
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
  // The building's tail reaches into the plaza, so keep trees, lamps and people clear of it.
  const clear = (x: number, z: number, margin: number): boolean => sdFootprint(x, z) > margin;
  for (let x = PLAZA.x0 + 4; x < PLAZA.x1; x += 12) for (const z of [-80, -58, 55, 80]) if (clear(x, z, 4)) tree(x, z, 1.1, 'broadleaf');
  for (let x = PLAZA.x0 + 6; x < PLAZA.x1; x += 14) for (const z of [-40, 40]) if (clear(x, z, 2)) lamp(x, z);
  for (let i = 0; i < 70; i++) {
    const alongX = rng() < 0.5, road = alongX ? pick(ZR) : pick(XR), dir = rng() < 0.5 ? 1 : -1;
    const along = rr(-300, 300), lane = dir * (rng() < 0.5 ? 2 : 6);
    if ((alongX ? XR : ZR).some((q) => Math.abs(along - q) < ROAD_HALF + 3)) continue;
    if (Math.abs(along) > 260 && rng() < 0.6) continue;
    if (alongX) car(along, road + lane, dir, 0);
    else car(road - lane, along, 0, dir);
  }
  // Watch-party crowd in front of the outdoor screen, plus people around the plaza and sidewalks.
  for (let i = 0; i < 320; i++) {
    const x = rr(112, 138), z = rr(-24, 24) * Math.sqrt(rng());
    if (clear(x, z, 1.5)) person(x, z);
  }
  for (let i = 0; i < 90; i++) {
    const x = rr(PLAZA.x0, PLAZA.x1), z = rr(PLAZA.z0, PLAZA.z1);
    if (clear(x, z, 1)) person(x, z);
  }
  for (let i = 0; i < 60; i++) {
    const rz = pick([-103, 102]);
    person(rr(-100, 150), rz + (rng() < 0.5 ? -1 : 1) * rr(ROAD_HALF + 1, ROAD_HALF + 4));
  }
  panel(142.1, 4.6, -10.4, 0, 0, 1, 0, 1, 0, 20.8, 11.8, 0.4, () => [0.02, 0.02, 0.025]); // backing, behind the picture
  canvasPanel([142, 5, -10], [0, 0, 1], [0, 1, 0], 20, 11, 0.2 * Math.sqrt(k), drawScore, 1.5, 1, k > 1.2 ? 2 : 4);
  line(142.3, 0, -9, 142.3, 5, -9, 0.2, 0.3, 0.12, 0.12, 0.13);
  line(142.3, 0, 9, 142.3, 5, 9, 0.2, 0.3, 0.12, 0.12, 0.13);
}

/** Builds everything outside and returns the solid building footprints for the ray tracer. */
export function buildExterior(k: number): Box[] {
  const boxes: Box[] = [];
  buildEnvelope(k);
  buildGround(k);
  buildCity(k, boxes);
  buildStreetLife(k);
  return boxes;
}
