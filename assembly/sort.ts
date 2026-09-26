// Depth sort for Gaussian splats, compiled to WebAssembly with AssemblyScript.
//
// Splats are blended back to front, so every time the camera moves they are
// re-ordered by view-space depth. A 20-bit counting sort does this in four
// linear passes, which keeps a million-splat sort to a few milliseconds.

const BUCKETS: u32 = 1 << 20;

/** First free byte after the module's static data. The host lays out its buffers from here. */
export function heapBase(): usize {
  return __heap_base;
}

/**
 * Writes splat indices to `out`, farthest first.
 *
 * pos:    n × (x, y, z) as f32
 * keys:   n × 4 bytes of scratch space
 * counts: BUCKETS × 4 bytes of scratch space
 * out:    n × u32 result
 *
 * depth = a·x + b·y + c·z + d is the view-space z row of the view matrix;
 * the camera looks down -z, so smaller values are farther away.
 */
export function sort(n: u32, pos: usize, keys: usize, counts: usize, out: usize, a: f32, b: f32, c: f32, d: f32): void {
  let lo = f32.MAX_VALUE;
  let hi = -f32.MAX_VALUE;
  for (let i: u32 = 0; i < n; i++) {
    const p = pos + <usize>i * 12;
    const z = a * load<f32>(p) + b * load<f32>(p, 4) + c * load<f32>(p, 8) + d;
    store<f32>(keys + (<usize>i << 2), z);
    lo = min(lo, z);
    hi = max(hi, z);
  }

  const scale: f32 = hi > lo ? <f32>(BUCKETS - 1) / (hi - lo) : 0;
  memory.fill(counts, 0, <usize>BUCKETS << 2);

  // Quantise each depth to a bucket and count bucket sizes.
  for (let i: u32 = 0; i < n; i++) {
    const at = keys + (<usize>i << 2);
    const bucket = <u32>((load<f32>(at) - lo) * scale);
    store<u32>(at, bucket);
    const slot = counts + (<usize>bucket << 2);
    store<u32>(slot, load<u32>(slot) + 1);
  }

  // Exclusive prefix sum turns counts into each bucket's first output slot.
  let sum: u32 = 0;
  for (let i: u32 = 0; i < BUCKETS; i++) {
    const slot = counts + (<usize>i << 2);
    const size = load<u32>(slot);
    store<u32>(slot, sum);
    sum += size;
  }

  // Scatter indices into place; equal buckets keep their original order.
  for (let i: u32 = 0; i < n; i++) {
    const bucket = load<u32>(keys + (<usize>i << 2));
    const slot = counts + (<usize>bucket << 2);
    const at = load<u32>(slot);
    store<u32>(out + (<usize>at << 2), i);
    store<u32>(slot, at + 1);
  }
}
