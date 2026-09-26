// Main-thread side of the sort worker: sends the camera's depth row when the view has moved
// enough to change the order, and hands back each finished order.
import type { SortReply, SortRequest } from './protocol';

export type DepthRow = readonly [number, number, number, number];

export class Sorter {
  backend: 'loading' | 'wasm' | 'js' = 'loading';
  lastMs = 0;

  private readonly worker: Worker;
  private busy = false;
  private gen = 0;
  private count = 0;
  private readonly sent = new Float64Array(4).fill(NaN);

  constructor(
    private readonly onSorted: (order: Uint32Array, ms: number) => void,
    private readonly onBackend: () => void,
  ) {
    this.worker = new Worker(new URL('./sort-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<SortReply>) => {
      const m = event.data;
      if (m.type === 'booted') {
        this.backend = m.wasm ? 'wasm' : 'js';
        this.onBackend();
        return;
      }
      this.busy = false;
      if (m.gen !== this.gen || m.n !== this.count) return; // stale: the scene changed meanwhile
      this.lastMs = m.ms;
      this.onSorted(m.order, m.ms);
    };
    this.post({ type: 'boot', wasmUrl: new URL('./sort.wasm', import.meta.url).href });
  }

  /** Hands the worker a new scene's positions (the buffer is transferred). */
  load(positions: Float32Array, count: number): void {
    this.gen++;
    this.count = count;
    this.sent.fill(NaN);
    this.post({ type: 'init', n: count, pos: positions }, [positions.buffer]);
  }

  /** Requests a re-sort if the view's depth row moved and no sort is in flight. */
  request(row: DepthRow): void {
    if (this.busy || !this.count) return;
    const s = this.sent;
    const still =
      Math.abs(row[0] - s[0]!) <= 0.002 && Math.abs(row[1] - s[1]!) <= 0.002 && Math.abs(row[2] - s[2]!) <= 0.002 && Math.abs(row[3] - s[3]!) <= 0.05;
    if (still) return;
    s.set(row);
    this.busy = true;
    this.post({ type: 'sort', row: [row[0], row[1], row[2], row[3]], gen: this.gen });
  }

  private post(message: SortRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }
}
