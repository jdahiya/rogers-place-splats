// Voxel grids for the ray tracer. Each voxel stores how much of it the splats cover (alpha)
// and how much light emissive splats give off inside it (RGB). Solid structure the splats only
// skin (under the seats, inside towers) is filled in so light can't leak through it.
import type { SplatStore } from '../splats/store';
import { SHELL, isStructure, roofY, sdRR } from '../scene/arena';
import type { Box } from '../scene/exterior';
import { fromHalf } from '../util/half';

export interface GridData {
  x0: number;
  y0: number;
  z0: number;
  /** Voxel edge length in metres. */
  v: number;
  nx: number;
  ny: number;
  nz: number;
  /** nx × ny × nz voxels, x fastest; RGB = emitted light, A = occupancy. */
  rgba: Uint8Array;
}

/** The fine grid covers the arena and Ford Hall; the coarse grid covers the city around it. */
const INSIDE: [number, number, number, number, number, number] = [-86, -1, -70, 110, 50, 70];
const OUTSIDE: [number, number, number, number, number, number] = [-320, 0, -320, 320, 260, 320];

interface Accum {
  x0: number; y0: number; z0: number; v: number; nx: number; ny: number; nz: number;
  occ: Float32Array; er: Float32Array; eg: Float32Array; eb: Float32Array; solid: Uint8Array;
}

function makeGrid(bounds: readonly number[], voxel: number, maxDim: number): Accum {
  const [x0, y0, z0, x1, y1, z1] = bounds as [number, number, number, number, number, number];
  let v = voxel;
  while (Math.max((x1 - x0) / v, (y1 - y0) / v, (z1 - z0) / v) > maxDim) v *= 1.25;
  const nx = Math.ceil((x1 - x0) / v), ny = Math.ceil((y1 - y0) / v), nz = Math.ceil((z1 - z0) / v), n = nx * ny * nz;
  return { x0, y0, z0, v, nx, ny, nz, occ: new Float32Array(n), er: new Float32Array(n), eg: new Float32Array(n), eb: new Float32Array(n), solid: new Uint8Array(n) };
}

const contains = (g: Accum, x: number, y: number, z: number): boolean =>
  x >= g.x0 && y >= g.y0 && z >= g.z0 && x < g.x0 + g.nx * g.v && y < g.y0 + g.ny * g.v && z < g.z0 + g.nz * g.v;

function index(g: Accum, x: number, y: number, z: number): number {
  const ix = Math.floor((x - g.x0) / g.v), iy = Math.floor((y - g.y0) / g.v), iz = Math.floor((z - g.z0) / g.v);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= g.nx || iy >= g.ny || iz >= g.nz) return -1;
  return ix + g.nx * (iy + g.ny * iz);
}

function splat(s: SplatStore, fine: Accum, coarse: Accum): void {
  for (let i = 0; i < s.count; i++) {
    const x = s.pos[i * 3]!, y = s.pos[i * 3 + 1]!, z = s.pos[i * 3 + 2]!;
    if (y < 0.15) continue; // floors don't cast shadows, and mirrored splats are virtual
    const g = contains(fine, x, y, z) ? fine : coarse;
    if (g === coarse && !contains(coarse, x, y, z)) continue;
    const c = i * 6;
    const xx = s.cov[c]!, xy = s.cov[c + 1]!, xz = s.cov[c + 2]!, yy = s.cov[c + 3]!, yz = s.cov[c + 4]!, zz = s.cov[c + 5]!;
    // Sum of the covariance's 2×2 principal minors ≈ (σ1σ2)² for a flat splat: its area.
    const area = 4 * Math.sqrt(Math.max(xx * yy - xy * xy + xx * zz - xz * xz + yy * zz - yz * yz, 0));
    const w = ((s.col[i * 4 + 3]! / 255) * area) / (g.v * g.v);
    if (w <= 0) continue;
    const gain = fromHalf(s.em[i]!);
    const emit = gain > 1.05 ? gain : 0;
    const er = (emit * s.col[i * 4]!) / 255, eg = (emit * s.col[i * 4 + 1]!) / 255, eb = (emit * s.col[i * 4 + 2]!) / 255;
    // Large splats spread over the voxels they span.
    const sx = Math.sqrt(xx), sy = Math.sqrt(yy), sz = Math.sqrt(zz);
    const mx = Math.min(3, Math.ceil((2 * sx) / g.v)), my = Math.min(3, Math.ceil((2 * sy) / g.v)), mz = Math.min(3, Math.ceil((2 * sz) / g.v));
    const share = w / (mx * my * mz);
    for (let a = 0; a < mx; a++) {
      for (let b = 0; b < my; b++) {
        for (let q = 0; q < mz; q++) {
          const k = index(g, x + ((a + 0.5) / mx - 0.5) * 2 * sx, y + ((b + 0.5) / my - 0.5) * 2 * sy, z + ((q + 0.5) / mz - 0.5) * 2 * sz);
          if (k < 0) continue;
          g.occ[k]! += share;
          if (emit) {
            g.er[k]! += er * share;
            g.eg[k]! += eg * share;
            g.eb[k]! += eb * share;
          }
        }
      }
    }
  }
}

function fillStructure(g: Accum): void {
  for (let iz = 0; iz < g.nz; iz++) {
    const z = g.z0 + (iz + 0.5) * g.v;
    for (let ix = 0; ix < g.nx; ix++) {
      const x = g.x0 + (ix + 0.5) * g.v;
      if (sdRR(x, z, SHELL - 0.5) >= 0) continue;
      for (let iy = 0; iy < g.ny; iy++) {
        if (isStructure(x, g.y0 + (iy + 0.5) * g.v, z)) g.solid[ix + g.nx * (iy + g.ny * iz)] = 1;
      }
    }
  }
}

function fillBoxes(g: Accum, boxes: readonly Box[]): void {
  const fill = (x0: number, x1: number, z0: number, z1: number, top: (x: number, z: number) => number): void => {
    const ix0 = Math.max(0, Math.floor((x0 - g.x0) / g.v)), ix1 = Math.min(g.nx - 1, Math.floor((x1 - g.x0) / g.v));
    const iz0 = Math.max(0, Math.floor((z0 - g.z0) / g.v)), iz1 = Math.min(g.nz - 1, Math.floor((z1 - g.z0) / g.v));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = g.x0 + (ix + 0.5) * g.v, z = g.z0 + (iz + 0.5) * g.v, h = top(x, z);
        for (let iy = 0; iy < g.ny && g.y0 + (iy + 0.5) * g.v < h; iy++) g.solid[ix + g.nx * (iy + g.ny * iz)] = 1;
      }
    }
  };
  for (const b of boxes) fill(b.cx - b.w / 2, b.cx + b.w / 2, b.cz - b.d / 2, b.cz + b.d / 2, () => b.h);
  // The arena as a solid block, for rays that start outside the fine grid.
  fill(-90, 90, -70, 70, (x, z) => (sdRR(x, z, SHELL) < 0 ? roofY(x, z) - 0.5 : -1));
}

function pack(g: Accum): GridData {
  const n = g.nx * g.ny * g.nz, rgba = new Uint8Array(n * 4);
  const byte = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);
  for (let k = 0; k < n; k++) {
    rgba[k * 4] = byte(g.er[k]! * 0.4);
    rgba[k * 4 + 1] = byte(g.eg[k]! * 0.4);
    rgba[k * 4 + 2] = byte(g.eb[k]! * 0.4);
    rgba[k * 4 + 3] = g.solid[k] ? 255 : byte(1 - Math.exp(-1.4 * g.occ[k]!));
  }
  return { x0: g.x0, y0: g.y0, z0: g.z0, v: g.v, nx: g.nx, ny: g.ny, nz: g.nz, rgba };
}

export function buildVoxelGrids(s: SplatStore, boxes: readonly Box[], fineVoxel: number, coarseVoxel: number, max3D: number): { fine: GridData; coarse: GridData } {
  const fine = makeGrid(INSIDE, fineVoxel, max3D), coarse = makeGrid(OUTSIDE, coarseVoxel, max3D);
  splat(s, fine, coarse);
  fillStructure(fine);
  fillBoxes(coarse, boxes);
  return { fine: pack(fine), coarse: pack(coarse) };
}
