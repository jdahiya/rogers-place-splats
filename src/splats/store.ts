import { HALF_ONE, toHalf } from '../util/half';
import { rng } from '../util/random';

/**
 * Structure-of-arrays storage for every splat in the scene.
 *
 *   pos  xyz position
 *   cov  upper triangle of the 3D covariance: xx xy xz yy yz zz
 *   col  RGBA8 colour
 *   em   half-float brightness gain; above 1 the splat is emissive and skips lighting
 *   nrm  octahedral surface normal (2 × 8 bits), 0 when the splat has no clear facing
 */
export class SplatStore {
  count = 0;
  capacity = 0;
  pos = new Float32Array(0);
  cov = new Float32Array(0);
  col = new Uint8Array(0);
  em = new Uint16Array(0);
  nrm = new Uint16Array(0);

  reserve(extra: number): void {
    const need = this.count + extra;
    if (need <= this.capacity) return;
    const cap = Math.max(this.capacity * 2, need, 1 << 17);
    const n = this.count;
    const pos = new Float32Array(cap * 3);
    pos.set(this.pos.subarray(0, n * 3));
    const cov = new Float32Array(cap * 6);
    cov.set(this.cov.subarray(0, n * 6));
    const col = new Uint8Array(cap * 4);
    col.set(this.col.subarray(0, n * 4));
    const em = new Uint16Array(cap);
    em.set(this.em.subarray(0, n));
    const nrm = new Uint16Array(cap);
    nrm.set(this.nrm.subarray(0, n));
    this.pos = pos;
    this.cov = cov;
    this.col = col;
    this.em = em;
    this.nrm = nrm;
    this.capacity = cap;
  }
}

export const store = new SplatStore();

// Emission state, applied to every splat written until changed.
let gainBits = HALF_ONE;
let normalBits = 0;
let jitter = 0.07;

/** Sets the brightness gain for following splats. 1 is a lit surface; above 1 glows and blooms. */
export function glow(gain: number): void {
  gainBits = gain === 1 ? HALF_ONE : toHalf(gain);
}

/** Sets the random colour variation for following splats and returns the previous amount. */
export function setJitter(amount: number): number {
  const old = jitter;
  jitter = amount;
  return old;
}

export function setNormalBits(bits: number): void {
  normalBits = bits;
}

const byte = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

/** Appends one splat from its covariance terms. Most code uses the shaped helpers in primitives.ts. */
export function put(
  x: number, y: number, z: number,
  xx: number, xy: number, xz: number, yy: number, yz: number, zz: number,
  r: number, g: number, b: number, a: number,
): void {
  const s = store;
  if (s.count >= s.capacity) s.reserve(1);
  const i = s.count++;
  const p = i * 3, c = i * 6, q = i * 4;
  s.pos[p] = x;
  s.pos[p + 1] = y;
  s.pos[p + 2] = z;
  s.cov[c] = xx;
  s.cov[c + 1] = xy;
  s.cov[c + 2] = xz;
  s.cov[c + 3] = yy;
  s.cov[c + 4] = yz;
  s.cov[c + 5] = zz;
  const j = 1 + (rng() - 0.5) * jitter;
  s.col[q] = byte(r * j);
  s.col[q + 1] = byte(g * j);
  s.col[q + 2] = byte(b * j);
  s.col[q + 3] = byte(a);
  s.em[i] = gainBits;
  s.nrm[i] = normalBits;
}
