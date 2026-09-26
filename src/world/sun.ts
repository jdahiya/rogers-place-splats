// Sun and sky over Edmonton in late September (sunrise about 07:35, sunset about 19:30).
import { PI, mixRGB, scale3, smoothstep, type Vec3 } from '../util/math';

export interface SunState {
  minutes: number;
  /** Degrees above the horizon; negative at night. */
  elevation: number;
  /** Unit vector toward the sun (x east, y up, z north). */
  dir: Vec3;
  color: Vec3;
  /** Outdoor ambient light from the sky. */
  sky: Vec3;
  day: number;
  dusk: number;
  /** 1 when outdoor lights should glow fully, 0 at midday. */
  nightGlow: number;
  horizon: Vec3;
}

const SUNRISE = 7.58;
const SUNSET = 19.5;
const PEAK_ELEVATION = 35;

export function sunAt(minutes: number): SunState {
  const h = minutes / 60;
  const phase = (h - SUNRISE) / (SUNSET - SUNRISE);
  const elevation = PEAK_ELEVATION * Math.sin(PI * phase);
  const azimuth = ((95 + 170 * phase) * PI) / 180; // from north, clockwise
  const el = (elevation * PI) / 180;
  const dir: Vec3 = [Math.sin(azimuth) * Math.cos(el), Math.sin(el), Math.cos(azimuth) * Math.cos(el)];
  const day = smoothstep(-4, 14, elevation);
  const dusk = (1 - smoothstep(3, 18, elevation)) * smoothstep(-9, -1, elevation);
  const color = scale3(mixRGB([1, 0.45, 0.2], [1, 0.95, 0.88], smoothstep(2, 22, elevation)), 1.2 * smoothstep(-1.5, 3, elevation));
  const sky = mixRGB(mixRGB([0.12, 0.13, 0.2], [0.72, 0.78, 0.9], day), [0.64, 0.56, 0.62], dusk * 0.7);
  const horizon = mixRGB(mixRGB([0.05, 0.055, 0.09], [0.7, 0.8, 0.92], day), [0.62, 0.4, 0.36], dusk);
  return { minutes, elevation, dir, color, sky, day, dusk, nightGlow: 1 - smoothstep(4, 18, elevation), horizon };
}

export function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
