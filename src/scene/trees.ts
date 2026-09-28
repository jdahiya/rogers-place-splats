// Individually shaped trees: a tapered trunk, primary branches, and a crown built from many small
// leaf clusters, so each tree has its own silhouette. Late-September Edmonton: elms and ashes turning
// yellow and orange, plus blue-green spruce.
import type { RGB, Vec3 } from '../util/math';
import { pick, rng, rr } from '../util/random';
import { S, line } from '../splats/primitives';
import { LEAVES } from './palette';

const BARK: RGB = [0.22, 0.16, 0.11];
const SPRUCE: readonly RGB[] = [[0.1, 0.2, 0.13], [0.12, 0.24, 0.16], [0.09, 0.17, 0.12]];

/** A small flat cluster of leaves facing a random direction. */
function leafCluster(x: number, y: number, z: number, size: number, c: RGB): void {
  // Random orthonormal frame for the cluster's plane.
  const a = rng() * Math.PI * 2, b = Math.acos(2 * rng() - 1);
  const nx = Math.sin(b) * Math.cos(a), ny = Math.cos(b), nz = Math.sin(b) * Math.sin(a);
  let ux = -nz, uy = 0, uz = nx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const shade = 0.75 + 0.35 * rng();
  S(x, y, z, ux, uy, uz, vx, vy, vz, size, size * rr(0.5, 0.9), size * 0.15, c[0] * shade, c[1] * shade, c[2] * shade, 0.95);
}

/** Deciduous street tree: trunk, 4–6 branches, and a rounded, irregular crown of leaf clusters. */
function broadleaf(x: number, z: number, s: number): void {
  const height = rr(6, 9) * s, fork = height * rr(0.35, 0.45);
  line(x, 0, z, x, fork, z, 0.14 * s, 0.25, ...BARK);
  const base = pick(LEAVES);
  const crownY = fork + (height - fork) * 0.55, crownR = rr(2.2, 3.2) * s;
  const tips: Vec3[] = [];
  const branches = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rr(-0.3, 0.3), reach = crownR * rr(0.6, 0.9);
    const tip: Vec3 = [x + Math.cos(a) * reach, crownY + rr(-0.5, 1.5) * s, z + Math.sin(a) * reach];
    line(x, fork, z, ...tip, 0.06 * s, 0.25, ...BARK);
    tips.push(tip);
  }
  // Leaf clusters fill an irregular ellipsoid, denser toward the outside, gathered around branch tips.
  const clusters = Math.round(140 * s);
  for (let i = 0; i < clusters; i++) {
    const tip = tips[i % tips.length]!;
    const r = Math.cbrt(rng()) * 0.9 + 0.1;
    const a = rng() * Math.PI * 2, b = Math.acos(2 * rng() - 1);
    const px = (tip[0] + x) / 2 + Math.sin(b) * Math.cos(a) * crownR * r;
    const py = crownY + Math.cos(b) * crownR * 0.75 * r + 0.4 * s;
    const pz = (tip[2] + z) / 2 + Math.sin(b) * Math.sin(a) * crownR * r;
    const c = rng() < 0.78 ? base : pick(LEAVES);
    leafCluster(px, py, pz, rr(0.18, 0.32) * s, c);
  }
}

/** Spruce: straight trunk with whorls of needle sprays, narrowing to a point. */
function spruce(x: number, z: number, s: number): void {
  const height = rr(8, 12) * s;
  line(x, 0, z, x, height, z, 0.1 * s, 0.3, ...BARK);
  for (let y = 0.9 * s; y < height; y += 0.45 * s) {
    const t = y / height, radius = (1 - t) * 2.4 * s + 0.2 * s;
    const sprays = Math.max(4, Math.round(10 * (1 - t) + 3));
    for (let i = 0; i < sprays; i++) {
      const a = (i / sprays) * Math.PI * 2 + rng(), r = radius * rr(0.5, 1);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, py = y - r * 0.25;
      const c = pick(SPRUCE);
      // Needles droop outward: long axis along the spray.
      const dx = Math.cos(a), dz = Math.sin(a), l = Math.hypot(dx, 0.3, dz);
      S(px, py, pz, dx / l, -0.3 / l, dz / l, -dz, 0, dx, r * 0.45 + 0.1, 0.18 * s, 0.06 * s, ...c, 0.95);
    }
  }
}

/** One tree at (x, z); s scales it, kind defaults to a mix weighted toward broadleaf street trees. */
export function tree(x: number, z: number, s = 1, kind?: 'broadleaf' | 'spruce'): void {
  if ((kind ?? (rng() < 0.2 ? 'spruce' : 'broadleaf')) === 'spruce') spruce(x, z, s);
  else broadleaf(x, z, s);
}
