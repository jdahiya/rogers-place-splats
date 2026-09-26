// Checks dist/sort.wasm against a plain JavaScript ordering: every index must
// appear exactly once, and depths must be non-decreasing to within one bucket.
// Usage: npm run build && npm test
import { readFile } from 'node:fs/promises';

const BUCKETS = 1 << 20;
const bytes = await readFile(new URL('../dist/sort.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, { env: { abort: () => { throw new Error('abort'); } } });
const { memory, sort, heapBase } = instance.exports;

const n = 400_000;
const base = (heapBase() + 15) & ~15;
const pos = base, keys = pos + n * 12, counts = keys + n * 4, out = counts + BUCKETS * 4;
const need = out + n * 4;
if (need > memory.buffer.byteLength) memory.grow(Math.ceil((need - memory.buffer.byteLength) / 65536));

const P = new Float32Array(memory.buffer, pos, n * 3);
for (let i = 0; i < P.length; i++) P[i] = Math.random() * 1600 - 800;
const row = [0.3, -0.5, 0.81, 12.5];

const t0 = performance.now();
sort(n, pos, keys, counts, out, ...row);
const ms = performance.now() - t0;

const order = new Uint32Array(memory.buffer, out, n);
const seen = new Uint8Array(n);
const depth = (i) => row[0] * P[i * 3] + row[1] * P[i * 3 + 1] + row[2] * P[i * 3 + 2] + row[3];
let lo = Infinity, hi = -Infinity;
for (let i = 0; i < n; i++) { const z = depth(i); lo = Math.min(lo, z); hi = Math.max(hi, z); }
const bucket = (hi - lo) / (BUCKETS - 1);
let prev = -Infinity, worst = 0, missing = 0;
for (let k = 0; k < n; k++) {
  const i = order[k];
  seen[i]++;
  const z = depth(i);
  if (z < prev) worst = Math.max(worst, prev - z);
  prev = Math.max(prev, z);
}
for (let i = 0; i < n; i++) if (seen[i] !== 1) missing++;

// Depth is computed in f32 inside the module; allow for that rounding on top of one bucket.
const f32Slack = Math.max(Math.abs(lo), Math.abs(hi)) * 1e-6;
console.log(`sorted ${n.toLocaleString()} splats in ${ms.toFixed(1)} ms`);
console.log(`index errors: ${missing}, worst inversion ${worst.toFixed(5)} (bucket ${bucket.toFixed(5)} + f32 slack ${f32Slack.toFixed(5)})`);
if (missing || worst > bucket + f32Slack) {
  console.error('sort check failed');
  process.exit(1);
}
console.log('sort check passed');
