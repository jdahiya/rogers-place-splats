// Hand-assembles a WebAssembly module exporting:
//   sort(n, posPtr, keysPtr, countsPtr, outPtr, a, b, c, d)
// depth_i = a*x + b*y + c*z + d  (view-space z), then a 16-bit counting sort,
// writing splat indices ascending by depth (far -> near) to outPtr.
import { writeFileSync } from 'node:fs';

const uleb = (v) => { const o = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (v) => { const o = []; for (;;) { const b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); } };
const f32 = (v) => [...new Uint8Array(new Float32Array([v]).buffer)];
const str = (s) => [...uleb(s.length), ...Buffer.from(s)];
const vec = (items) => [...uleb(items.length), ...items.flat()];
const section = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];

const I32 = 0x7f, F32 = 0x7d;
// params: 0 n,1 pos,2 keys,3 counts,4 out,5 a,6 b,7 c,8 d
// locals: 9 i,10 p,11 k,12 sum,13 t,14 addr, 15 z,16 min,17 max,18 scale
const [n, pos, keys, counts, out, A, B, C, D] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const [i, p, k, sum, t, addr, z, mn, mx, sc] = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

const get = (x) => [0x20, ...uleb(x)], set = (x) => [0x21, ...uleb(x)], tee = (x) => [0x22, ...uleb(x)];
const i32c = (v) => [0x41, ...sleb(v)], f32c = (v) => [0x43, ...f32(v)];
const i32load = [0x28, 2, 0], f32load = (off) => [0x2a, 2, ...uleb(off)], i32store = [0x36, 2, 0], f32store = [0x38, 2, 0];
const add = [0x6a], shl = [0x74], geu = [0x4f];
const fadd = [0x92], fsub = [0x93], fmul = [0x94], fdiv = [0x95], fmin = [0x96], fmax = [0x97];
const truncSatU = [0xfc, 0x01];
// for (var = 0; var < limit; var++) body
const forLoop = (v, limit, body) => [
  ...i32c(0), ...set(v),
  0x02, 0x40, 0x03, 0x40,
  ...get(v), ...limit, ...geu, 0x0d, 1,
  ...body,
  ...get(v), ...i32c(1), ...add, ...set(v),
  0x0c, 0, 0x0b, 0x0b,
];
const idx4 = (base, v) => [...get(base), ...get(v), ...i32c(2), ...shl, ...add];

const body = [
  // pass 1: view depth per splat, track range
  ...f32c(Infinity), ...set(mn), ...f32c(-Infinity), ...set(mx), ...get(pos), ...set(p),
  ...forLoop(i, get(n), [
    ...get(A), ...get(p), ...f32load(0), ...fmul,
    ...get(B), ...get(p), ...f32load(4), ...fmul, ...fadd,
    ...get(C), ...get(p), ...f32load(8), ...fmul, ...fadd,
    ...get(D), ...fadd, ...set(z),
    ...idx4(keys, i), ...get(z), ...f32store,
    ...get(mn), ...get(z), ...fmin, ...set(mn),
    ...get(mx), ...get(z), ...fmax, ...set(mx),
    ...get(p), ...i32c(12), ...add, ...set(p),
  ]),
  ...f32c(65535), ...get(mx), ...get(mn), ...fsub, ...fdiv, ...set(sc),
  // clear histogram
  ...forLoop(i, i32c(65536), [...idx4(counts, i), ...i32c(0), ...i32store]),
  // pass 2: quantise to 16-bit keys, histogram
  ...forLoop(i, get(n), [
    ...idx4(keys, i), ...tee(addr),
    ...get(addr), ...f32load(0), ...get(mn), ...fsub, ...get(sc), ...fmul, ...truncSatU, ...tee(k),
    ...i32store,
    ...idx4(counts, k), ...tee(addr), ...get(addr), ...i32load, ...i32c(1), ...add, ...i32store,
  ]),
  // exclusive prefix sum
  ...i32c(0), ...set(sum),
  ...forLoop(i, i32c(65536), [
    ...idx4(counts, i), ...tee(addr), ...i32load, ...set(t),
    ...get(addr), ...get(sum), ...i32store,
    ...get(sum), ...get(t), ...add, ...set(sum),
  ]),
  // pass 3: scatter indices
  ...forLoop(i, get(n), [
    ...idx4(keys, i), ...i32load, ...set(k),
    ...idx4(counts, k), ...tee(addr), ...i32load, ...set(t),
    ...idx4(out, t), ...get(i), ...i32store,
    ...get(addr), ...get(t), ...i32c(1), ...add, ...i32store,
  ]),
  0x0b,
];
const locals = vec([[...uleb(6), I32], [...uleb(4), F32]]);
const func = [...locals, ...body];

const mod = [
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ...section(1, vec([[0x60, ...vec([I32, I32, I32, I32, I32, F32, F32, F32, F32].map((x) => [x])), 0]])),
  ...section(3, vec([[0]])),
  ...section(5, vec([[0x00, 1]])),
  ...section(7, vec([[...str('memory'), 0x02, 0], [...str('sort'), 0x00, 0]])),
  ...section(10, vec([[...uleb(func.length), ...func]])),
];
const bytes = new Uint8Array(mod);
console.log('valid:', WebAssembly.validate(bytes), 'bytes:', bytes.length);

// test against a JS reference
const { instance } = await WebAssembly.instantiate(bytes);
const { memory, sort } = instance.exports;
const N = 200000;
const posPtr = 64, keysPtr = posPtr + N * 12, countsPtr = keysPtr + N * 4, outPtr = countsPtr + 65536 * 4;
memory.grow(Math.ceil((outPtr + N * 4) / 65536));
const P = new Float32Array(memory.buffer, posPtr, N * 3);
for (let j = 0; j < N * 3; j++) P[j] = Math.random() * 400 - 200;
const r = [0.3, -0.5, 0.81, 12.5];
let t0 = performance.now();
sort(N, posPtr, keysPtr, countsPtr, outPtr, ...r);
console.log('wasm ms', (performance.now() - t0).toFixed(2));
const o = new Uint32Array(memory.buffer, outPtr, N);
const seen = new Uint8Array(N);
let bad = 0, prev = -Infinity, maxInv = 0;
for (let j = 0; j < N; j++) {
  const q = o[j]; seen[q]++;
  const dz = r[0] * P[q * 3] + r[1] * P[q * 3 + 1] + r[2] * P[q * 3 + 2] + r[3];
  if (dz < prev) maxInv = Math.max(maxInv, prev - dz);
  prev = Math.max(prev, dz);
}
for (let j = 0; j < N; j++) if (seen[j] !== 1) bad++;
console.log('permutation errors', bad, 'max inversion (should be < bucket width ~', (600 / 65535).toFixed(4), ')', maxInv.toFixed(4));
writeFileSync(new URL('./sort.wasm.b64', import.meta.url), Buffer.from(bytes).toString('base64'));
