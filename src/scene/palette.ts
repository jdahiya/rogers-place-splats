import type { RGB } from '../util/math';

export interface Team {
  jersey: RGB;
  trim: RGB;
  pants: RGB;
  helmet: RGB;
  glove: RGB;
}

/** Ice markings. */
export const RED: RGB = [0.78, 0.07, 0.1];
export const BLUE: RGB = [0.06, 0.22, 0.62];

/** Edmonton at home: royal blue with orange yoke and stripes. */
export const HOME: Team = {
  jersey: [0.02, 0.17, 0.5],
  trim: [1, 0.33, 0.02],
  pants: [0.02, 0.08, 0.28],
  helmet: [0.02, 0.15, 0.45],
  glove: [0.02, 0.1, 0.32],
};

/** Winnipeg on the road: white with navy. */
export const AWAY: Team = {
  jersey: [0.93, 0.93, 0.94],
  trim: [0.02, 0.12, 0.3],
  pants: [0.02, 0.1, 0.26],
  helmet: [0.02, 0.1, 0.26],
  glove: [0.02, 0.12, 0.3],
};

export const OFFICIAL: Team = {
  jersey: [0.55, 0.55, 0.56],
  trim: [1, 0.4, 0.05],
  pants: [0.05, 0.05, 0.06],
  helmet: [0.05, 0.05, 0.06],
  glove: [0.05, 0.05, 0.06],
};

export const SKIN: readonly RGB[] = [
  [0.95, 0.78, 0.65], [0.87, 0.67, 0.52], [0.72, 0.52, 0.38], [0.55, 0.38, 0.26], [0.38, 0.25, 0.18],
];
export const HAIR: readonly RGB[] = [[0.08, 0.06, 0.05], [0.25, 0.16, 0.09], [0.6, 0.48, 0.3], [0.55, 0.55, 0.55]];
export const PANTS: readonly RGB[] = [[0.1, 0.1, 0.13], [0.14, 0.2, 0.32], [0.25, 0.23, 0.2], [0.06, 0.06, 0.07]];

/** What the crowd is wearing, by weight: mostly Edmonton blue and orange, a few Winnipeg fans. */
export const FAN_SHIRTS: readonly (readonly [number, RGB])[] = [
  [34, [0.02, 0.15, 0.45]],
  [30, [1, 0.34, 0.03]],
  [12, [0.9, 0.9, 0.92]],
  [12, [0.08, 0.08, 0.09]],
  [6, [0.45, 0.45, 0.47]],
  [4, [0.02, 0.12, 0.3]],
  [2, [0.2, 0.4, 0.3]],
];

export const CAR_PAINT: readonly RGB[] = [[0.1, 0.1, 0.12], [0.8, 0.8, 0.82], [0.55, 0.08, 0.08], [0.12, 0.2, 0.4], [0.4, 0.42, 0.45]];

/** Late-September leaves in Edmonton: mostly turned. */
export const LEAVES: readonly RGB[] = [[0.22, 0.36, 0.14], [0.78, 0.62, 0.12], [0.75, 0.35, 0.08], [0.55, 0.52, 0.12]];
