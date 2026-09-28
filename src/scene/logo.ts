// The official Oilers logo (the NHL's SVGs, one version for light backgrounds and one for dark),
// rasterised once so the video boards, banners and centre ice can draw it.
import dark from '../assets/EDM_dark.svg';
import light from '../assets/EDM_light.svg';
import { setLogo } from './screens';

const W = 960, H = 640; // the SVGs' viewBox

async function rasterise(svg: string): Promise<HTMLCanvasElement> {
  // Give the SVG an intrinsic size: some browsers won't draw one to a canvas without it.
  const sized = svg.replace('<svg ', `<svg width="${W}" height="${H}" `);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable.');
  ctx.drawImage(img, 0, 0, W, H);
  return cv;
}

/** Bounds of the artwork's visible pixels. Throws if the canvas can't be read back. */
function artBounds(cv: HTMLCanvasElement): { sx: number; sy: number; sw: number; sh: number } {
  const px = cv.getContext('2d')!.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3]! < 8) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error('The logo rendered blank.');
  return { sx: x0, sy: y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1 };
}

/** Loads the logo for the scene's drawings; if anything fails they fall back to lettering. */
export async function loadLogo(): Promise<void> {
  try {
    const [onLight, onDark] = await Promise.all([rasterise(light), rasterise(dark)]);
    // Reading both back also proves neither canvas is tainted, which would break the splat builder.
    const bounds = artBounds(onLight);
    artBounds(onDark);
    setLogo({ light: onLight, dark: onDark, ...bounds });
  } catch {
    setLogo(null);
  }
}
