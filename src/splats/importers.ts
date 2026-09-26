// Loads trained splat captures: 3D Gaussian Splatting .ply files and the compact .splat format.
import { setJitter, put, store } from './store';

const SH_C0 = 0.28209479177387814;

function covFromQuat(w: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, out: Float64Array): void {
  const l = Math.hypot(w, x, y, z) || 1;
  w /= l; x /= l; y /= l; z /= l;
  const R = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  const M = [R[0]! * sx, R[1]! * sy, R[2]! * sz, R[3]! * sx, R[4]! * sy, R[5]! * sz, R[6]! * sx, R[7]! * sy, R[8]! * sz];
  const [a, b, c, d, e, f, g, h, i] = M as [number, number, number, number, number, number, number, number, number];
  out[0] = a * a + b * b + c * c;
  out[1] = a * d + b * e + c * f;
  out[2] = a * g + b * h + c * i;
  out[3] = d * d + e * e + f * f;
  out[4] = d * g + e * h + f * i;
  out[5] = g * g + h * h + i * i;
}

const TYPE_SIZE: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8,
};

/** Binary little-endian .ply with 3DGS properties (f_dc_*, opacity, scale_*, rot_*), or a coloured point cloud. */
export function parsePly(buf: ArrayBuffer): void {
  const bytes = new Uint8Array(buf);
  const marker = 'end_header\n';
  let end = -1;
  for (let i = 0; i < Math.min(bytes.length, 65536) && end < 0; i++) {
    let hit = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker.charCodeAt(j)) {
        hit = false;
        break;
      }
    }
    if (hit) end = i + marker.length;
  }
  if (end < 0) throw new Error('This .ply has no readable header.');
  const header = new TextDecoder().decode(bytes.subarray(0, end));
  if (!/format binary_little_endian/.test(header)) throw new Error('Only binary little-endian .ply files are supported.');

  let count = 0, inVertex = false, stride = 0;
  const props = new Map<string, { off: number; type: string }>();
  for (const raw of header.split('\n')) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === 'element') {
      inVertex = p[1] === 'vertex';
      if (inVertex) count = Number(p[2]);
    } else if (p[0] === 'property' && inVertex) {
      if (p[1] === 'list') throw new Error('List properties in the vertex element are not supported.');
      props.set(p[2]!, { off: stride, type: p[1]! });
      stride += TYPE_SIZE[p[1]!] ?? 4;
    }
  }
  if (!props.has('x')) throw new Error('This .ply has no vertex positions.');

  const dv = new DataView(buf, end);
  const read = (i: number, name: string): number => {
    const pr = props.get(name)!;
    const o = i * stride + pr.off;
    switch (pr.type) {
      case 'float': case 'float32': return dv.getFloat32(o, true);
      case 'double': case 'float64': return dv.getFloat64(o, true);
      case 'uchar': case 'uint8': return dv.getUint8(o);
      case 'char': case 'int8': return dv.getInt8(o);
      case 'short': case 'int16': return dv.getInt16(o, true);
      case 'ushort': case 'uint16': return dv.getUint16(o, true);
      case 'int': case 'int32': return dv.getInt32(o, true);
      default: return dv.getUint32(o, true);
    }
  };

  const gaussian = props.has('f_dc_0') && props.has('scale_0') && props.has('rot_0');
  const cov = new Float64Array(6);
  store.count = 0;
  store.reserve(count);
  const old = setJitter(0);
  for (let i = 0; i < count; i++) {
    const x = read(i, 'x'), y = read(i, 'y'), z = read(i, 'z');
    if (gaussian) {
      covFromQuat(read(i, 'rot_0'), read(i, 'rot_1'), read(i, 'rot_2'), read(i, 'rot_3'),
        Math.exp(read(i, 'scale_0')), Math.exp(read(i, 'scale_1')), Math.exp(read(i, 'scale_2')), cov);
      const a = props.has('opacity') ? 1 / (1 + Math.exp(-read(i, 'opacity'))) : 1;
      put(x, y, z, cov[0]!, cov[1]!, cov[2]!, cov[3]!, cov[4]!, cov[5]!,
        0.5 + SH_C0 * read(i, 'f_dc_0'), 0.5 + SH_C0 * read(i, 'f_dc_1'), 0.5 + SH_C0 * read(i, 'f_dc_2'), a);
    } else {
      const r = props.has('red') ? read(i, 'red') / 255 : 0.8;
      const g = props.has('green') ? read(i, 'green') / 255 : 0.8;
      const b = props.has('blue') ? read(i, 'blue') / 255 : 0.8;
      put(x, y, z, 0.0004, 0, 0, 0.0004, 0, 0.0004, r, g, b, 1);
    }
  }
  setJitter(old);
}

/** The 32-byte-per-splat format: position f32×3, scale f32×3, RGBA u8×4, rotation u8×4. */
export function parseSplat(buf: ArrayBuffer): void {
  const n = Math.floor(buf.byteLength / 32);
  const f = new Float32Array(buf, 0, n * 8), u = new Uint8Array(buf), cov = new Float64Array(6);
  store.count = 0;
  store.reserve(n);
  const old = setJitter(0);
  for (let i = 0; i < n; i++) {
    const r = i * 32 + 28, c = i * 32 + 24;
    covFromQuat((u[r]! - 128) / 128, (u[r + 1]! - 128) / 128, (u[r + 2]! - 128) / 128, (u[r + 3]! - 128) / 128,
      f[i * 8 + 3]!, f[i * 8 + 4]!, f[i * 8 + 5]!, cov);
    put(f[i * 8]!, f[i * 8 + 1]!, f[i * 8 + 2]!, cov[0]!, cov[1]!, cov[2]!, cov[3]!, cov[4]!, cov[5]!,
      u[c]! / 255, u[c + 1]! / 255, u[c + 2]! / 255, u[c + 3]! / 255);
  }
  setJitter(old);
}

/** Photo pipelines usually produce y-down scenes; this rotates 180° about x. */
export function flipScene(): void {
  const s = store;
  for (let i = 0; i < s.count; i++) {
    s.pos[i * 3 + 1] = -s.pos[i * 3 + 1]!;
    s.pos[i * 3 + 2] = -s.pos[i * 3 + 2]!;
    s.cov[i * 6 + 1] = -s.cov[i * 6 + 1]!;
    s.cov[i * 6 + 2] = -s.cov[i * 6 + 2]!;
  }
}
