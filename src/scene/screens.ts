// 2D drawings that become splats: video boards, ribbons, banners and the centre-ice emblem.
// The game state matches the 19 Sept 2026 pre-season game against Winnipeg.
import { PI } from '../util/math';

export const FONT = '"Saira Condensed", "Arial Narrow", sans-serif';

const font = (weight: number, px: number): string => `${weight} ${Math.max(6, Math.round(px))}px ${FONT}`;

/** The official Oilers logo in its versions for light and dark backgrounds, and the artwork's bounds. */
export interface LogoArt {
  light: CanvasImageSource;
  dark: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Null until loaded (see logo.ts); the drawings then fall back to lettering. */
let logo: LogoArt | null = null;

export function setLogo(art: LogoArt | null): void {
  logo = art;
}

/** Draws the logo centred on (cx, cy) at the given height. Returns false if it isn't loaded. */
function drawLogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, height: number, onDark = false): boolean {
  if (!logo) return false;
  const w = (height * logo.sw) / logo.sh;
  ctx.drawImage(onDark ? logo.dark : logo.light, logo.sx, logo.sy, logo.sw, logo.sh, cx - w / 2, cy - height / 2, w, height);
  return true;
}

/** "OILERS" in Oilers blue, as lettered on the arena's ground-floor glass. */
export function drawWordmark(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(800, H * 0.95);
  ctx.fillStyle = '#00205b';
  ctx.fillText('OILERS', W / 2, H * 0.54);
}

export function drawScore(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b1f4d');
  g.addColorStop(1, '#030814');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ff4c00';
  ctx.fillRect(0, 0, W, H * 0.22);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = font(800, H * 0.17);
  ctx.fillText('PRESEASON   10:29', W / 2, H * 0.12);
  ctx.fillStyle = '#dfe8f5';
  ctx.font = font(800, H * 0.16);
  ctx.fillText('EDM', W * 0.25, H * 0.37);
  ctx.fillText('WPG', W * 0.75, H * 0.37);
  drawLogo(ctx, W * 0.1, H * 0.68, H * 0.3, true);
  ctx.font = font(800, H * 0.46);
  ctx.fillStyle = '#ff7a33';
  ctx.fillText('2', W * 0.25, H * 0.69);
  ctx.fillStyle = '#fff';
  ctx.fillText('1', W * 0.75, H * 0.69);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(W * 0.5 - 0.5, H * 0.3, 1, H * 0.56);
  ctx.fillStyle = '#9fb3d1';
  ctx.font = font(600, H * 0.09);
  ctx.fillText('SEPT 19 · ROGERS PLACE', W / 2, H * 0.93);
}

/** The scoreboard's outward-leaning crown: an orange LED band. */
export function drawCrown(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ff5c1c');
  g.addColorStop(1, '#d63a08');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(800, H * 0.5);
  ctx.fillText('OILERS', W * 0.28, H * 0.54);
  ctx.fillText('EDM 2 · WPG 1', W * 0.72, H * 0.54);
}

/** The white LED ring under the scoreboard, with the score. */
export function drawScoreRing(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.fillStyle = '#eef2f6';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  ctx.font = font(800, H * 0.62);
  const items = ['EDM', '2', 'WPG', '1', 'PRESEASON', '10:29'];
  let x = H * 0.6, i = 0;
  while (x < W) {
    const text = items[i % items.length]!;
    ctx.fillStyle = i % items.length === 1 ? '#ff4c00' : '#0a1f52';
    ctx.fillText(text, x, H * 0.55);
    x += ctx.measureText(text).width + H * (i % 2 ? 1.6 : 0.6);
    i++;
  }
}

/** Big blue feature wall inside Ford Hall. No sponsor marks. */
export function drawHallBanner(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0d2a78');
  g.addColorStop(1, '#2d5fd0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, H * 0.78, W, H * 0.05);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, H * 0.86, W, H * 0.02);
}

export function drawClock(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.fillStyle = '#040a18';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1d4fbf';
  ctx.fillRect(0, 0, W, H * 0.2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = font(800, H * 0.15);
  ctx.fillText('PRESEASON', W / 2, H * 0.11);
  ctx.fillStyle = '#ffb347';
  ctx.font = font(800, H * 0.36);
  ctx.fillText('10:29', W / 2, H * 0.45);
  ctx.fillStyle = '#e9f1f7';
  ctx.font = font(700, H * 0.15);
  ctx.fillText('EDM 2 · WPG 1', W / 2, H * 0.78);
}

/** LED ribbon content; tiles horizontally across the whole canvas. */
export function drawStrip(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const blocks: [string, string, string][] = [
    ['#ff4c00', '#fff', 'EDM 2  ·  WPG 1'],
    ['#0a1f52', '#ff6a2a', 'PRESEASON'],
    ['#e9f1f7', '#0a1f52', 'OILERS'],
    ['#0a1f52', '#fff', "LET'S GO OILERS"],
  ];
  ctx.textBaseline = 'middle';
  ctx.font = font(800, H * 0.78);
  let x = 0, i = 0;
  while (x < W) {
    const [bg, fg, text] = blocks[i++ % blocks.length]!;
    const mark = text === 'OILERS' && !!logo ? H * 1.6 : 0;
    const w = ctx.measureText(text).width + H * 3 + mark;
    ctx.fillStyle = bg;
    ctx.fillRect(x, 0, w, H);
    if (mark) drawLogo(ctx, x + H * 1.5 + mark / 2 - H * 0.3, H / 2, H * 0.9);
    ctx.fillStyle = fg;
    ctx.fillText(text, x + H * 1.5 + mark, H * 0.55);
    x += w;
  }
}

export function drawFord(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#ff5a10');
  g.addColorStop(0.5, '#b8300b');
  g.addColorStop(1, '#071d4a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = -H; x < W; x += H * 0.5) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H * 0.6, 0);
    ctx.lineTo(x + H * 0.75, 0);
    ctx.lineTo(x + H * 0.15, H);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = font(800, H * 0.34);
  const shift = drawLogo(ctx, W * 0.14, H * 0.42, H * 0.56, true) ? W * 0.06 : 0;
  ctx.fillText('GAME NIGHT', W / 2 + shift, H * 0.38);
  ctx.font = font(700, H * 0.15);
  ctx.fillText('EDM  vs  WPG  ·  PRESEASON', W / 2, H * 0.73);
}

export function drawRetired(num: number) {
  return (ctx: CanvasRenderingContext2D, W: number, H: number): void => {
    ctx.fillStyle = '#062a66';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff4c00';
    ctx.fillRect(0, H * 0.05, W, H * 0.07);
    ctx.fillRect(0, H * 0.88, W, H * 0.07);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, H * 0.13, W, H * 0.015);
    ctx.fillRect(0, H * 0.855, W, H * 0.015);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(800, H * (num > 9 ? 0.4 : 0.46));
    ctx.fillText(String(num), W / 2, H * 0.5);
  };
}

export function drawCup(year: number) {
  return (ctx: CanvasRenderingContext2D, W: number, H: number): void => {
    ctx.fillStyle = '#ff4c00';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#062a66';
    ctx.fillRect(W * 0.07, H * 0.04, W * 0.86, H * 0.92);
    ctx.fillStyle = '#cfd6de';
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.18, W * 0.2, H * 0.05, 0, 0, PI);
    ctx.fill();
    ctx.fillRect(W * 0.45, H * 0.2, W * 0.1, H * 0.08);
    for (let i = 0; i < 4; i++) ctx.fillRect(W * (0.36 - i * 0.03), H * (0.28 + i * 0.05), W * (0.28 + i * 0.06), H * 0.045);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(800, H * 0.17);
    ctx.fillText(String(year), W / 2, H * 0.66);
    if (!drawLogo(ctx, W / 2, H * 0.84, H * 0.13, true)) {
      ctx.fillStyle = '#ff6a2a';
      ctx.font = font(700, H * 0.075);
      ctx.fillText('CHAMPIONS', W / 2, H * 0.82);
    }
  };
}

/** Centre-ice paint: the Oilers logo, or a plain ringed disc if the logo isn't available. */
export function drawEmblem(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2;
  ctx.clearRect(0, 0, W, H);
  if (drawLogo(ctx, cx, cy, H * 0.98)) return;
  ctx.fillStyle = 'rgba(20, 58, 150, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.93, 0, 2 * PI);
  ctx.fill();
  ctx.lineWidth = R * 0.08;
  ctx.strokeStyle = '#ff5a14';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.89, 0, 2 * PI);
  ctx.stroke();
  ctx.lineWidth = R * 0.035;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.72, 0, 2 * PI);
  ctx.stroke();
}
