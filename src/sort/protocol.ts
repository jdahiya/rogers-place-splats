// Messages between the page and the sort worker.

export type SortRequest =
  | { type: 'boot'; wasmUrl: string }
  | { type: 'init'; n: number; pos: Float32Array }
  | { type: 'sort'; row: [number, number, number, number]; gen: number };

export type SortReply =
  | { type: 'booted'; wasm: boolean }
  | { type: 'sorted'; order: Uint32Array; ms: number; n: number; gen: number };
