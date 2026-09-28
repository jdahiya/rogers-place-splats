// The building envelope, following photos of the finished arena: a teardrop plan (the seating drum
// plus a tail that sweeps down toward the east-southeast), a skin of bright reflective metal panels
// with a dark band sweeping around it, a glazed band under the roof edge, a white membrane roof,
// a glass podium, and Ford Hall as the glass atrium under the tail.
import { PI, clamp, smoothstep, type RGB } from '../util/math';
import { hash, pick, rng, rr, wpick } from '../util/random';
import { S, SC, blob, canvasPanel, ell, lightBlob, panel, type Color } from '../splats/primitives';
import { RR, SHELL, SX, SZ, roofY, sdRR, walk } from './arena';
import { FAN_SHIRTS, HAIR, PANTS, SKIN } from './palette';
import { drawFord, drawHallBanner, drawWordmark } from './screens';

// ---- Footprint ------------------------------------------------------------------------------

/** The tail: a tapering capsule from A (wide, joined to the drum) to B (the tip). */
const TAIL = { ax: 60, az: -10, ra: 44, bx: 122, bz: -44, rb: 6 };
const TAIL_LEN = Math.hypot(TAIL.bx - TAIL.ax, TAIL.bz - TAIL.az);
const TAIL_UX = (TAIL.bx - TAIL.ax) / TAIL_LEN, TAIL_UZ = (TAIL.bz - TAIL.az) / TAIL_LEN;
const BLEND = 18;

/** Position along the tail, 0 at A to 1 at B (clamped). */
function tailT(x: number, z: number): number {
  return clamp(((x - TAIL.ax) * TAIL_UX + (z - TAIL.az) * TAIL_UZ) / TAIL_LEN, 0, 1);
}

function sdTail(x: number, z: number): number {
  const t = tailT(x, z);
  const cx = TAIL.ax + TAIL_UX * TAIL_LEN * t, cz = TAIL.az + TAIL_UZ * TAIL_LEN * t;
  return Math.hypot(x - cx, z - cz) - (TAIL.ra + (TAIL.rb - TAIL.ra) * t);
}

/** Signed distance to the whole building outline (negative inside): drum smooth-joined to the tail. */
export function sdFootprint(x: number, z: number): number {
  const a = sdRR(x, z, SHELL), b = sdTail(x, z);
  const h = clamp(0.5 + (0.5 * (b - a)) / BLEND, 0, 1);
  return b + (a - b) * h - BLEND * h * (1 - h);
}

export const insideFootprint = (x: number, z: number): boolean => sdFootprint(x, z) < 0;

/** How far into the tail a point is (0 over the drum, rising to 1 at the tip). */
function tailness(x: number, z: number): number {
  return smoothstep(-6, 18, sdRR(x, z, SHELL)) * tailT(x, z);
}

/** Height of the roof edge / roof surface: the drum's dome, sweeping down along the tail. */
export function envelopeTop(x: number, z: number): number {
  const drum = sdRR(x, z, SHELL) < 0 ? roofY(x, z) : 40;
  const t = tailness(x, z);
  return drum - 26 * smoothstep(0.1, 1, t);
}

/** Top of the glass podium under the skin. */
function podiumTop(x: number, z: number, u: number): number {
  const t = tailness(x, z);
  if (t > 0.02) return 12 - 8 * smoothstep(0.55, 1, t); // Ford Hall's glass, dropping toward the tip
  // South entrance on 104 Avenue: the skin lifts over a tall glass wall.
  const e = Math.abs(u - 0.745);
  return e < 0.035 ? 20 : e < 0.05 ? 20 - ((e - 0.035) / 0.015) * 11 : 9;
}

/** Ford Hall: the part of the building outside the seating drum. */
export const inHall = (x: number, z: number): boolean => insideFootprint(x, z) && sdRR(x, z, SHELL) > 0.5;

// ---- Outline ----------------------------------------------------------------------------------

interface OutlinePoint { x: number; z: number; nx: number; nz: number; u: number }

interface Outline {
  pts: OutlinePoint[];
  /** Length of the whole outline in metres. */
  total: number;
}

/** Walks the outline at even spacing, from a polar scan around a point inside the teardrop. */
function outline(step: number): Outline {
  const cx = 20, cz = -6, samples = 4096, raw: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * PI, dx = Math.cos(a), dz = Math.sin(a);
    let lo = 0, hi = 220;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (sdFootprint(cx + dx * mid, cz + dz * mid) < 0) lo = mid;
      else hi = mid;
    }
    raw.push([cx + dx * lo, cz + dz * lo]);
  }
  const cum = [0];
  for (let i = 1; i <= samples; i++) {
    const [ax, az] = raw[i - 1]!, [bx, bz] = raw[i % samples]!;
    cum.push(cum[i - 1]! + Math.hypot(bx - ax, bz - az));
  }
  const total = cum[samples]!, n = Math.round(total / step), out: OutlinePoint[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = ((k + 0.5) / n) * total;
    while (cum[j + 1]! < s) j++;
    const f = (s - cum[j]!) / (cum[j + 1]! - cum[j]!);
    const [ax, az] = raw[j]!, [bx, bz] = raw[(j + 1) % samples]!;
    const x = ax + (bx - ax) * f, z = az + (bz - az) * f, e = 0.05;
    const gx = sdFootprint(x + e, z) - sdFootprint(x - e, z), gz = sdFootprint(x, z + e) - sdFootprint(x, z - e);
    const gl = Math.hypot(gx, gz) || 1;
    out.push({ x, z, nx: gx / gl, nz: gz / gl, u: s / total });
  }
  return { pts: out, total };
}

/** The outline point at arc length a (wrapping), interpolated between the ring's samples. */
function ringAt(ring: Outline, a: number): OutlinePoint {
  const n = ring.pts.length, pos = (((a / ring.total) * n - 0.5) % n + n) % n;
  const i = Math.floor(pos), f = pos - i, A = ring.pts[i]!, B = ring.pts[(i + 1) % n]!;
  const nx = A.nx + (B.nx - A.nx) * f, nz = A.nz + (B.nz - A.nz) * f, nl = Math.hypot(nx, nz) || 1;
  return { x: A.x + (B.x - A.x) * f, z: A.z + (B.z - A.z) * f, nx: nx / nl, nz: nz / nl, u: (((a / ring.total) % 1) + 1) % 1 };
}

// ---- Skin ---------------------------------------------------------------------------------------

const SILVER: RGB = [0.86, 0.88, 0.9];

/** Material of the skin at outline position u (0..1) and height y, on diamond panel (p, q). */
function skinMaterial(u: number, y: number, top: number, p: number, q: number): Color {
  // Dark recessed band sweeping around the building.
  const band = 24 + 7 * Math.sin(2 * PI * u + 1.3);
  if (Math.abs(y - band) < 1.6 && y < top - 4) return [0.05, 0.07, 0.1, 1, -0.25];
  // Glazed band under the roof edge on the north-east side.
  if (u > 0.08 && u < 0.46 && y > top - 6.5 && y < top - 1.4) return [0.1, 0.14, 0.2, 1, -0.2];
  // Satin metal (reflectance 0.3): each panel a slightly different silver.
  const b = 0.9 + (hash(p, q, 7) - 0.5) * 0.12;
  return [SILVER[0] * b, SILVER[1] * b, SILVER[2] * b, 1, -1.3];
}

/**
 * The skin as individual diamond panels. Each panel is a small grid of splats that share one
 * slightly tilted normal and one shade, so reflections break up panel by panel the way they do on
 * the real building. The pattern is laid out in (arc length, height) and closes seamlessly.
 */
function buildSkin(k: number): void {
  const ring = outline(0.25), L = ring.total;
  const period = L / Math.round(L / 2.2), half = period / 2; // the diamonds' diagonals
  const n = Math.max(2, Math.round(3 / k)), sigma = (0.42 * period) / n, maxY = 50;
  // Panel (p, q) covers (a + y) / period in [p, p + 1) and (a - y) / period in [q, q + 1).
  for (let p = 0; p < Math.ceil((L + maxY) / period); p++) {
    for (let q = Math.floor(-maxY / period) - 1; q < Math.ceil(L / period); q++) {
      const ac = half * (p + q + 1), yc = half * (p - q);
      if (ac < 0 || ac >= L || yc < -half || yc > maxY) continue;
      const tiltT = (hash(p, q, 11) - 0.5) * 0.16, tiltV = (hash(p, q, 13) - 0.5) * 0.16;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const P = p + (i + 0.5) / n, Q = q + (j + 0.5) / n, a = half * (P + Q), y = half * (P - Q);
          const o = ringAt(ring, a), top = envelopeTop(o.x, o.z), bottom = podiumTop(o.x, o.z, o.u);
          if (y < bottom || y > top) continue;
          // The skin bulges out between podium and roof and flares slightly at its lower lip.
          const height = top - bottom, t = (y - bottom) / height;
          const bulge = 3.2 * Math.sin(PI * t) + 1.8 * Math.pow(1 - t, 6);
          const slope = (3.2 * PI * Math.cos(PI * t) - 10.8 * Math.pow(1 - t, 5)) / height, vl = Math.hypot(slope, 1);
          // Surface frame: T along the outline, V up the skin, N = T × V; then tilt N for this panel.
          const tx = -o.nz, tz = o.nx, vx = (o.nx * slope) / vl, vy = 1 / vl, vz = (o.nz * slope) / vl;
          let nx = -tz * vy + tiltT * tx + tiltV * vx, ny = tz * vx - tx * vz + tiltV * vy, nz = tx * vy + tiltT * tz + tiltV * vz;
          const nl = Math.hypot(nx, ny, nz);
          nx /= nl; ny /= nl; nz /= nl;
          const d = tx * nx + tz * nz;
          let ux = tx - d * nx, uy = -d * ny, uz = tz - d * nz;
          const ul = Math.hypot(ux, uy, uz);
          ux /= ul; uy /= ul; uz /= ul;
          const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux; // N × U, so U × W = N
          // Panel edges a touch darker, which draws the diamond pattern.
          const edge = Math.max(Math.abs((2 * (i + 0.5)) / n - 1), Math.abs((2 * (j + 0.5)) / n - 1));
          const c = skinMaterial(o.u, y, top, p, q), shade = 1 - 0.14 * edge * edge;
          SC(o.x + o.nx * bulge, y, o.z + o.nz * bulge, ux, uy, uz, wx, wy, wz, sigma, sigma * vl, 0.04,
            [c[0]! * shade, c[1]! * shade, c[2]! * shade, c[3]!, c[4]!]);
        }
      }
    }
  }
  // Silver rim along the roof edge, a white soffit under the lower lip, and downlights in it.
  const step = 0.8 * k;
  for (const o of outline(step).pts) {
    const top = envelopeTop(o.x, o.z), bottom = podiumTop(o.x, o.z, o.u), tx = -o.nz, tz = o.nx;
    S(o.x, top + 0.1, o.z, tx, 0, tz, o.nx, 0, o.nz, step * 0.72, 0.6, 0.05, ...SILVER);
    S(o.x + o.nx * 0.9, bottom, o.z + o.nz * 0.9, tx, 0, tz, o.nx, 0, o.nz, step * 0.72, bottom > 9 ? 1.8 : 1.0, 0.04, 0.8, 0.81, 0.83);
  }
  for (const o of outline(4).pts) lightBlob(o.x + o.nx * 0.9, podiumTop(o.x, o.z, o.u) - 0.15, o.z + o.nz * 0.9, 0.12, 1, 0.9, 0.75, 3, 3);
}

// ---- Glass podium and concourse ---------------------------------------------------------------

function buildPodium(k: number): void {
  const gsp = 0.6 * k;
  let arc = 0;
  for (const p of outline(gsp).pts) {
    arc += gsp;
    const top = podiumTop(p.x, p.z, p.u), tx = -p.nz, tz = p.nx;
    const mullion = Math.floor(arc / 1.5) !== Math.floor((arc - gsp) / 1.5);
    for (let y = gsp / 2; y < top; y += gsp) {
      const transom = Math.abs(y - 4.5) < gsp * 0.5 || top - y < gsp * 0.5;
      if (mullion || transom) S(p.x, y, p.z, tx, 0, tz, 0, 1, 0, gsp * 0.62, gsp * 0.62, 0.03, 0.07, 0.08, 0.09, 0.95);
      else {
        const q = y / top;
        SC(p.x, y, p.z, tx, 0, tz, 0, 1, 0, gsp * 0.66, gsp * 0.66, 0.02, [0.1 + 0.06 * q, 0.14 + 0.07 * q, 0.2 + 0.1 * q, 0.45, -0.15]);
      }
    }
  }
  // "OILERS" lettering on the glass along 104 Avenue, in Oilers blue.
  const zFace = -(4.42 + 8.53 + SHELL) - 0.35;
  canvasPanel([-12, 1.2, zFace], [-1, 0, 0], [0, 1, 0], 34, 5.6, 0.12, drawWordmark, 1, 0.97);

  // The lit concourse behind the drum's glass.
  for (let x = -90; x < 90; x += 1.1 * k) {
    for (let z = -72; z < 72; z += 1.1 * k) {
      const d = sdRR(x, z, SHELL);
      if (d > -0.5 || d < -6.5) continue;
      S(x, 0.03, z, 1, 0, 0, 0, 0, 1, 0.8 * k, 0.8 * k, 0.03, 0.36, 0.3, 0.24);
      if (hash(Math.round(x / 3), Math.round(z / 3), 5) < 0.08) lightBlob(x, 8.4, z, 0.15, 1, 0.86, 0.62, 3, 5);
    }
  }
}

// ---- Roof ------------------------------------------------------------------------------------------

function buildRoof(k: number): void {
  const rs = 1.4 * k;
  for (let x = -90; x < 130; x += rs) {
    for (let z = -100; z < 75; z += rs) {
      const px = x + rr(0, rs), pz = z + rr(0, rs), sd = sdFootprint(px, pz);
      if (sd > 0) continue;
      const y = envelopeTop(px, pz);
      const gx = (envelopeTop(px + 1, pz) - envelopeTop(px - 1, pz)) / 2, gz = (envelopeTop(px, pz + 1) - envelopeTop(px, pz - 1)) / 2;
      const ul = Math.hypot(1, gx), ux = 1 / ul, uy = gx / ul;
      let vx = 0, vy = gz;
      const vz = 1, dot = vx * ux + vy * uy;
      vx -= dot * ux;
      vy -= dot * uy;
      const vlen = Math.hypot(vx, vy, vz);
      // White membrane with faint seams.
      const seam = ((px % 6) + 6) % 6 < 0.45, b = seam ? 0.78 : 0.9 * (0.96 + 0.04 * rng());
      S(px, y, pz, ux, uy, 0, vx / vlen, vy / vlen, vz / vlen, rs * 0.8, rs * 0.8, 0.08, b, b, b * 1.02);
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = rr(-35, 35), z = rr(-14, 14), y = roofY(x, z), w = rr(2, 5), d = rr(2, 4);
    panel(x - w / 2, y + 1.2, z - d / 2, 1, 0, 0, 0, 0, 1, w, d, 0.6, () => [0.62, 0.63, 0.65]);
    panel(x - w / 2, y, z - d / 2, 1, 0, 0, 0, 1, 0, w, 1.2, 0.6, () => [0.52, 0.53, 0.55]);
  }
}

// ---- Ford Hall ------------------------------------------------------------------------------------

/** The oval ceiling cove over the middle of Ford Hall, filled with downlights. */
const COVE = { cx: 90, cz: -12, a: 9, b: 13 };
const coveAt = (x: number, z: number): number => ((x - COVE.cx) / COVE.a) ** 2 + ((z - COVE.cz) / COVE.b) ** 2;
const hallCeiling = (x: number, z: number): number => Math.min(22, envelopeTop(x, z) - 4);

/** Circular floor inlay: a generic pastel terrazzo pattern. */
function inlay(dx: number, dz: number, r: number): Color {
  if (r > 7.2) return [0.34, 0.36, 0.4];
  const band = Math.floor(r / 1.2), wedge = Math.floor(((Math.atan2(dz, dx) + PI) / (2 * PI)) * 12);
  const tones: Color[] = [[0.62, 0.78, 0.86], [0.93, 0.88, 0.7], [0.72, 0.84, 0.76], [0.9, 0.78, 0.72], [0.8, 0.82, 0.9]];
  return tones[(band * 3 + wedge) % tones.length]!;
}

export function person(x: number, z: number, y0 = 0): void {
  ell(x, y0 + 0.45, z, 0.13, 0.42, 0.11, pick(PANTS));
  ell(x, y0 + 1.15, z, 0.2, 0.3, 0.13, wpick(FAN_SHIRTS));
  blob(x, y0 + 1.62, z, 0.1, ...pick(SKIN));
  blob(x, y0 + 1.68, z, 0.09, ...pick(HAIR));
}

function buildHall(k: number): void {
  // Floor and ceiling on a regular grid: jittered samples leave gaps that show the dark void above.
  const sp = 0.8 * k;
  for (let px = 55 + sp / 2; px < 130; px += sp) {
    for (let pz = -90 + sp / 2; pz < 40; pz += sp) {
      if (!inHall(px, pz)) continue;
      // Polished concrete floor with a circular inlay under the cove.
      const dx = px - COVE.cx, dz = pz - COVE.cz, r = Math.hypot(dx, dz);
      SC(px, 0.03, pz, 1, 0, 0, 0, 0, 1, sp * 0.66, sp * 0.66, 0.02, r < 7.5 ? inlay(dx, dz, r) : [0.62, 0.62, 0.6]);
      // White ceiling, 3 m higher inside the cove.
      const y = hallCeiling(px, pz) + (coveAt(px, pz) < 1 ? 3 : 0);
      S(px, y, pz, 1, 0, 0, 0, 0, 1, sp * 0.66, sp * 0.66, 0.05, 0.93, 0.93, 0.95);
    }
  }
  // The cove's rim, a white band rising 3 m, with an LED line along its lower edge.
  const rs = 0.4 * k;
  for (let t = 0; t < 2 * PI; t += rs / 11) {
    const x = COVE.cx + COVE.a * Math.cos(t), z = COVE.cz + COVE.b * Math.sin(t);
    if (!inHall(x, z)) continue;
    const tx = -COVE.a * Math.sin(t), tz = COVE.b * Math.cos(t), tl = Math.hypot(tx, tz), ceil = hallCeiling(x, z);
    for (let y = ceil + rs / 2; y < ceil + 3; y += rs) S(x, y, z, tx / tl, 0, tz / tl, 0, 1, 0, rs * 0.7, rs * 0.7, 0.03, 0.93, 0.93, 0.95);
  }
  for (let t = 0; t < 2 * PI; t += 0.015) {
    const x = COVE.cx + COVE.a * Math.cos(t), z = COVE.cz + COVE.b * Math.sin(t);
    if (inHall(x, z)) lightBlob(x, hallCeiling(x, z) - 0.05, z, 0.1, 0.95, 0.97, 1, 2.2, 1);
  }
  // Round downlights: a dense grid in the cove, a sparser one elsewhere.
  for (let x = 56; x < 130; x += 2.2) {
    for (let z = -90; z < 40; z += 2.2) {
      if (!inHall(x, z)) continue;
      const q = coveAt(x, z);
      if (q >= 0.8 && (Math.round(x / 2.2) % 2 || Math.round(z / 2.2) % 2)) continue;
      lightBlob(x, hallCeiling(x, z) + (q < 1 ? 3 : 0) - 0.08, z, 0.14, 1, 0.98, 0.94, 3, 3);
    }
  }
  // The seating drum's outer wall where it faces the hall: entrances to the concourse at ground
  // level, a white fascia, and dark metal panels above, all the way up to the roof.
  const ws = 0.6 * k;
  walk(SHELL, ws, (x, z, nx, nz, _s, _f, _L, a) => {
    if (sdFootprint(x + nx * 2, z + nz * 2) > -1) return;
    const top = envelopeTop(x + nx * 2, z + nz * 2) - 0.5, tx = -nz, tz = nx, portal = ((a % 10) + 10) % 10 < 6;
    for (let y = ws / 2; y < top; y += ws) {
      const c: Color = y < 4.2
        ? portal ? [0.85, 0.66, 0.44, 1, 1.15] : [0.2, 0.2, 0.22]
        : y < 4.9 ? [0.9, 0.9, 0.92] : Math.floor(y / 1.5) % 2 ? [0.3, 0.31, 0.33] : [0.27, 0.28, 0.3];
      SC(x, y, z, tx, 0, tz, 0, 1, 0, ws * 0.62, ws * 0.62, 0.03, c);
    }
  });
  // Video wall, and the big blue feature wall hung on the drum's south-east face.
  panel(85.9, 5.6, 4.3, 0, 0, -1, 0, 1, 0, 20.6, 9.8, 0.4, () => [0.02, 0.02, 0.025]);
  canvasPanel([86, 6, 4], [0, 0, -1], [0, 1, 0], 20, 9, 0.16 * Math.sqrt(k), drawFord, 1.4);
  const th = (35 * PI) / 180, R = RR + SHELL + 0.8, nx = Math.cos(th), nz = -Math.sin(th);
  const bx = SX + R * nx - 8 * nz, bz = -SZ + R * nz + 8 * nx; // 8 m back along the wall from centre
  canvasPanel([bx, 7, bz], [nz, 0, -nx], [0, 1, 0], 16, 9, 0.2, drawHallBanner, 1.2);
  // Escalators down to the lower concourse.
  for (let i = 0; i < 3; i++) {
    const z0 = -34 + i * 2.2;
    panel(70, 0.05, z0, 1, 0, 0, 0, 0, 1, 11, 1.4, 0.25, (_fu, fv) => (fv < 0.12 || fv > 0.88 ? [0.75, 0.77, 0.8] : [0.08, 0.08, 0.09]));
  }
  let n = 0;
  while (n < 110) {
    const x = rr(70, 118), z = rr(-50, 10);
    if (!inHall(x, z)) continue;
    person(x, z);
    n++;
  }
}

/** The whole envelope: skin, podium, roof and Ford Hall. */
export function buildEnvelope(k: number): void {
  buildSkin(k);
  buildPodium(k);
  buildRoof(k);
  buildHall(k);
}
