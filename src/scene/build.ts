import { reseed } from '../util/random';
import { buildReflections, resetReflections } from '../splats/primitives';
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
  buildInterior(k);
  buildReflections(0.5, 2.2);
  const interiorEnd = store.count;
  const buildings = buildExterior(k);
  return { count: store.count, interiorEnd, buildings };
}
