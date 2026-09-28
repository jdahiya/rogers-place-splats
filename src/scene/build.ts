import { reseed } from '../util/random';
import { buildReflections, resetReflections, setImageSpacing } from '../splats/primitives';
import { resetAsset, store } from '../splats/store';
import { buildExterior, type Box } from './exterior';
import { buildInterior } from './interior';

export interface SceneInfo {
  count: number;
  /** Splats [0, interiorEnd) are inside the arena, including their ice reflections. */
  interiorEnd: number;
  buildings: Box[];
}

/**
 * Generates the whole scene into the shared splat store.
 * density scales splat count: 1 ≈ one million splats.
 */
export function buildScene(density: number): SceneInfo {
  store.count = 0;
  resetAsset();
  reseed(7);
  resetReflections();
  const k = 1 / Math.sqrt(density);
  // Images (the logo) are splatted at their own pixel count on Ultra. Lighter settings stop small
  // ones where splats would get finer than this many metres apart, which no screen could show.
  setImageSpacing(density >= 3 ? 0 : density >= 2 ? 0.006 : density >= 1 ? 0.012 : 0.04);
  buildInterior(k);
  buildReflections(0.5, 2.2);
  const interiorEnd = store.count;
  const buildings = buildExterior(k);
  return { count: store.count, interiorEnd, buildings };
}
