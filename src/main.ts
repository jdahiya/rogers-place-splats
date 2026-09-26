// Entry point: builds the scene, runs the frame loop and wires up the interface.
import { Camera } from './camera/camera';
import { Controls } from './camera/controls';
import { Flight, VIEWS, type ViewName } from './camera/stations';
import { Governor, type Knobs } from './perf/governor';
import { PerfPanel } from './perf/panel';
import { PowerModel } from './perf/power';
import { PerfStats } from './perf/stats';
import { GpuTimer } from './perf/timer';
import { Lighting } from './render/lighting';
import { Renderer } from './render/renderer';
import { buildVoxelGrids } from './render/voxels';
import { SHELL, roofY, sdRR } from './scene/arena';
import { buildScene } from './scene/build';
import { FONT } from './scene/screens';
import { Sorter } from './sort/sorter';
import { flipScene, parsePly, parseSplat } from './splats/importers';
import { store } from './splats/store';
import { byId, nextPaint, toast } from './util/dom';
import type { RGB, Vec3 } from './util/math';
import { GoalShow, LightRig } from './world/show';
import { clockLabel, sunAt } from './world/sun';

const IS_PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

/** Starting points per device class; the governor adapts from here to hold 60 fps or more. */
const PROFILE = IS_PHONE
  ? {
      knobs: { scale: 0.8, minScale: 0.5, maxScale: 1, dpr: 1.5, rtRows: 16, rtMin: 2, rtMax: 64, minPx: 0, bloom: true },
      rays: { rays: 2, lightSamples: 1, steps: 28 },
      voxel: { fine: 2, coarse: 8 },
      cycles: 8,
      density: 0.5,
    }
  : {
      knobs: { scale: 1, minScale: 0.5, maxScale: 1, dpr: 1.5, rtRows: 96, rtMin: 8, rtMax: 512, minPx: 0, bloom: true },
      rays: { rays: 3, lightSamples: 2, steps: 56 },
      voxel: { fine: 1, coarse: 4 },
      cycles: 12,
      density: 1.1,
    };

const canvas = byId<HTMLCanvasElement>('view');
const renderer = createRenderer();
const gl = renderer.gl;
const lighting = new Lighting(gl);
const camera = new Camera();
const flight = new Flight();
const show = new GoalShow();
const rig = new LightRig();
const timer = new GpuTimer(gl);
const power = new PowerModel(IS_PHONE);
const governor = new Governor({ ...PROFILE.knobs } satisfies Knobs);
const stats = new PerfStats(power);

let sun = sunAt(1145);
let density = PROFILE.density;
let custom = false;
let rtEnabled = true;
let autoSpin = !IS_PHONE;
let running = false;
let idleFrames = 0;
let lastRaf = 0;
let lastRender = 0;
let forceRender = true;
let sortArrived = false;
let frameSeed = 0;
let idleSampler = 0;
let sceneW = 1;
let sceneH = 1;
const lastView = new Float64Array(8).fill(NaN);

function createRenderer(): Renderer {
  try {
    return new Renderer(canvas);
  } catch (err) {
    byId('loading-msg').textContent = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

const sorter = new Sorter(
  (order, ms) => {
    renderer.setOrder(order);
    stats.sortResult(ms);
    sortArrived = true;
    wake();
  },
  () => {
    byId('st-sortlabel').textContent = sorter.backend === 'wasm' ? 'Sort · wasm' : 'Sort · js';
  },
);

const controls = new Controls(canvas, camera, { interact: userTookOver, wake });

const panel = new PerfPanel(
  stats,
  governor,
  power,
  timer,
  () => ({
    lighting: !rtEnabled
      ? 'Off'
      : !lighting.ready
        ? custom ? 'Off for captures (their lighting is baked in)' : 'Preparing'
        : lighting.active ? `Refining · ${lighting.pending} passes queued` : 'Converged, idle',
    rays: `${PROFILE.rays.rays} ambient + ${PROFILE.rays.lightSamples} shadow, up to ${PROFILE.rays.steps} steps`,
    drawn: renderer.drawCount,
    sceneW,
    sceneH,
    sort: `${sorter.backend === 'wasm' ? 'WebAssembly' : sorter.backend === 'js' ? 'JavaScript' : 'Starting'} · ${sorter.lastMs.toFixed(1)} ms`,
  }),
  {
    pacing: (p) => {
      governor.pacing = p;
      wake();
    },
    adaptive: (on) => {
      governor.adaptive = on;
      if (!on) Object.assign(governor.knobs, PROFILE.knobs, { bloom: governor.bloomWanted });
      forceRender = true;
      wake();
    },
    lighting: (on) => {
      rtEnabled = on;
      if (on) lighting.kick('all', PROFILE.cycles);
      forceRender = true;
      wake();
    },
    bloom: (on) => {
      governor.bloomWanted = on;
      governor.knobs.bloom = on;
      forceRender = true;
      wake();
    },
    opened: (open) => {
      if (open) wake();
      else window.clearInterval(idleSampler);
    },
  },
);

// ---- Frame loop ---------------------------------------------------------------------

/** Starts the loop if it's asleep. Anything that changes the picture calls this. */
function wake(): void {
  idleFrames = 0;
  if (running) return;
  running = true;
  lastRaf = 0;
  window.clearInterval(idleSampler);
  requestAnimationFrame(frame);
}

/** Nothing is changing: stop drawing so the GPU (and battery) can rest. */
function sleep(): void {
  running = false;
  if (panel.open) idleSampler = window.setInterval(() => sample(performance.now()), 250);
}

function sample(now: number): void {
  if (!stats.tick(now)) return;
  const s = stats.latest;
  byId('st-fps').textContent = s.idle ? 'idle' : Number.isFinite(s.fps) ? `${Math.round(s.fps)} fps` : '–';
  byId('st-sort').textContent = sorter.lastMs ? `${sorter.lastMs.toFixed(1)} ms` : '–';
  panel.update();
}

function resizeCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, governor.knobs.dpr);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    forceRender = true;
  }
  camera.fov = canvas.clientWidth < canvas.clientHeight ? (72 * Math.PI) / 180 : Math.PI / 3;
}

/** Haze: warm arena haze indoors, horizon-coloured air outdoors. */
function atmosphere(eye: Vec3): { color: RGB; density: number } {
  if (custom) return { color: [0, 0, 0], density: 0 };
  const inside = sdRR(eye[0], eye[2], SHELL - 0.5) < 0 && eye[1] < roofY(eye[0], eye[2]) - 0.5 && eye[1] > -1;
  if (inside) return show.active ? { color: [0.07, 0.07, 0.09], density: 0.006 } : { color: [0.16, 0.15, 0.17], density: 0.0035 };
  const h = sun.horizon;
  return { color: [h[0] * 0.75, h[1] * 0.75, h[2] * 0.75], density: 0.0011 };
}

function frame(now: number): void {
  if (!running) return;
  if (lastRaf) governor.noteRaf(now - lastRaf);
  const dt = lastRaf ? Math.min(0.1, (now - lastRaf) / 1000) : 1 / 60;
  lastRaf = now;
  const cpuStart = performance.now();

  resizeCanvas();
  const flying = flight.update(camera, now);
  if (flying === 'ended') {
    setTour(false);
    setStation('upper');
  }
  if (flying === 'idle' && autoSpin) camera.yaw += dt * 0.05;
  const keyMoved = controls.update(dt);
  if (show.update(now)) lighting.kick('int', PROFILE.cycles);
  if (show.active) lighting.kick('int', 2);

  const k = governor.knobs;
  sceneW = Math.max(1, Math.round(canvas.width * k.scale));
  sceneH = Math.max(1, Math.round(canvas.height * k.scale));
  const v = camera.compute(sceneW, sceneH);
  sorter.request(v.depthRow);

  const key = [v.eye[0], v.eye[1], v.eye[2], v.fwd[0], v.fwd[1], v.fwd[2], sceneW, sceneH];
  let moved = false;
  for (let i = 0; i < 8 && !moved; i++) moved = !(Math.abs(key[i]! - lastView[i]!) < 1e-6);
  const relighting = rtEnabled && lighting.active;
  const busy = forceRender || moved || sortArrived || relighting || flying === 'moving' || autoSpin || keyMoved || show.active;
  if (!busy) {
    sample(now);
    if (++idleFrames > 45) sleep();
    else requestAnimationFrame(frame);
    return;
  }
  idleFrames = 0;
  if (!governor.shouldRender(now, lastRender)) {
    requestAnimationFrame(frame);
    return;
  }

  timer.begin();
  let relit = 0;
  if (relighting) {
    show.rig(now, rig);
    relit = lighting.step(
      renderer.dataTex,
      { rows: k.rtRows, rays: PROFILE.rays.rays, lightSamples: PROFILE.rays.lightSamples + (show.active ? 1 : 0), steps: PROFILE.rays.steps },
      sun,
      rig,
      show.active ? 0.4 : 0.08,
      0.08,
    );
  }
  const air = atmosphere(v.eye);
  frameSeed = (frameSeed + 1) % 997;
  renderer.render(
    {
      view: v.view, proj: v.proj, focal: v.focal, right: v.right, up: v.up, fwd: v.fwd, tanHalf: v.tanHalf, aspect: v.aspect,
      sun: sun.dir, day: sun.day, dusk: sun.dusk, nightGlow: sun.nightGlow,
      fogColor: air.color, fogDensity: air.density,
      lightTex: rtEnabled && lighting.ready ? lighting.tex : null,
      minPx: k.minPx, bloom: k.bloom, seed: frameSeed,
    },
    sceneW, sceneH, canvas.width, canvas.height,
  );
  timer.end();
  timer.poll((ms) => {
    stats.gpuResult(ms);
    governor.gpuSample(ms);
  });

  // Only back-to-back frames count toward frame time; a pause is not a slow frame.
  const gap = now - lastRender;
  const interval = lastRender && gap < 70 ? gap : NaN;
  lastRender = now;
  stats.frameRendered(interval, performance.now() - cpuStart, power.estimateGpuMs(renderer.drawCount, sceneW * sceneH, relit));
  if (Number.isFinite(interval)) governor.record(interval);
  governor.evaluate(now, relighting);
  sample(now);
  for (let i = 0; i < 8; i++) lastView[i] = key[i]!;
  forceRender = false;
  sortArrived = false;
  requestAnimationFrame(frame);
}

// ---- Scenes ---------------------------------------------------------------------------

function showLoading(title: string, message: string): void {
  byId('loading-title').textContent = title;
  byId('loading-msg').textContent = message;
  byId('loading').hidden = false;
}

async function buildArena(): Promise<void> {
  showLoading('Placing splats', 'Building the arena…');
  await nextPaint();
  const t0 = performance.now();
  governor.knobs.dpr = !IS_PHONE && density >= 2 ? 2 : 1.5;
  const scene = buildScene(density);
  custom = false;
  setCustomUi(false);
  renderer.upload(store);
  lighting.reset(store.count, scene.interiorEnd);
  byId('loading-msg').textContent = 'Voxelising the scene for ray tracing…';
  await nextPaint();
  const grids = buildVoxelGrids(store, scene.buildings, PROFILE.voxel.fine, PROFILE.voxel.coarse, gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number);
  lighting.setGrids(grids.fine, grids.coarse);
  lighting.kick('all', PROFILE.cycles, true);
  sorter.load(store.pos.slice(0, store.count * 3), store.count);
  byId('st-n').textContent = store.count.toLocaleString('en-CA');
  byId('loading').hidden = true;
  forceRender = true;
  wake();
  toast(`${store.count.toLocaleString('en-CA')} splats in ${((performance.now() - t0) / 1000).toFixed(1)} s. Lighting refines over the next few seconds.`, 4200);
}

async function loadCapture(file: File): Promise<void> {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.ply') && !name.endsWith('.splat')) {
    toast('Open a .ply or .splat file.');
    return;
  }
  showLoading('Loading capture', `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`);
  await nextPaint();
  try {
    const buf = await file.arrayBuffer();
    if (name.endsWith('.ply')) {
      parsePly(buf);
      flipScene();
    } else parseSplat(buf);
    if (!store.count) throw new Error('No splats found in that file.');
    custom = true;
    setCustomUi(true);
    renderer.upload(store);
    lighting.reset(store.count, 0);
    sorter.load(store.pos.slice(0, store.count * 3), store.count);
    frameCapture();
    byId('st-n').textContent = store.count.toLocaleString('en-CA');
    toast(`${store.count.toLocaleString('en-CA')} splats loaded. Use Flip if it looks upside down.`, 5000);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'That file could not be read.', 5000);
    await buildArena();
  }
  byId('loading').hidden = true;
  forceRender = true;
  wake();
}

/** Points the camera at the middle of a loaded capture, ignoring stray outliers. */
function frameCapture(): void {
  const n = Math.min(store.count, 20000), axes: number[][] = [[], [], []];
  for (let i = 0; i < n; i++) {
    const j = Math.floor((i / n) * store.count);
    for (let a = 0; a < 3; a++) axes[a]!.push(store.pos[j * 3 + a]!);
  }
  const q = (a: number[], p: number): number => a[Math.floor(p * (a.length - 1))]!;
  for (const a of axes) a.sort((x, y) => x - y);
  const centre: Vec3 = [q(axes[0]!, 0.5), q(axes[1]!, 0.5), q(axes[2]!, 0.5)];
  const extent = Math.max(...axes.map((a) => q(a, 0.95) - q(a, 0.05))) || 5;
  userTookOver();
  camera.target = centre;
  camera.dist = extent * 1.2;
  camera.pitch = -0.3;
  camera.yaw = -Math.PI / 2;
}

// ---- Interface --------------------------------------------------------------------------

function userTookOver(): void {
  autoSpin = false;
  if (flight.touring) setTour(false);
  flight.stop();
  setStation(null);
}

function setStation(name: ViewName | null): void {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
}

function setTour(on: boolean): void {
  const b = byId('tour');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Stop tour' : 'Play tour';
}

function setCustomUi(on: boolean): void {
  byId('stations').classList.toggle('custom', on);
  byId('flip').hidden = !on;
  byId('back').hidden = !on;
  byId('subtitle').textContent = on ? 'Your capture' : 'Gaussian splats · outside and in';
}

function syncDensity(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.q) === density)));
}

function updateClock(): void {
  const label = clockLabel(sun.minutes);
  byId('tod-out').textContent = label;
  byId('tod').setAttribute('aria-valuetext', label);
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    const name = b.dataset.view as ViewName;
    autoSpin = name === 'aerial' && !IS_PHONE;
    setTour(false);
    flight.goTo(camera, name, performance.now());
    setStation(name);
    wake();
  }),
);

byId('tour').addEventListener('click', () => {
  if (flight.touring) {
    flight.stop();
    setTour(false);
  } else {
    autoSpin = false;
    flight.startTour(performance.now());
    setTour(true);
    setStation(null);
  }
  wake();
});

byId('goal').addEventListener('click', () => {
  if (custom) return;
  show.trigger(performance.now());
  lighting.kick('int', 2);
  toast('Goal! EDM 3, WPG 1', 2500);
  wake();
});

const tod = byId<HTMLInputElement>('tod');
tod.addEventListener('input', () => {
  sun = sunAt(Number(tod.value));
  updateClock();
  lighting.kick('ext', PROFILE.cycles);
  forceRender = true;
  wake();
});

document.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) =>
  b.addEventListener('click', () => {
    density = Number(b.dataset.q);
    syncDensity();
    void buildArena();
  }),
);

byId<HTMLInputElement>('file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement, file = input.files?.[0];
  if (file) void loadCapture(file);
  input.value = '';
});

byId('flip').addEventListener('click', () => {
  flipScene();
  renderer.upload(store);
  sorter.load(store.pos.slice(0, store.count * 3), store.count);
  forceRender = true;
  wake();
});

byId('back').addEventListener('click', () => {
  void buildArena().then(() => {
    flight.goTo(camera, 'aerial', performance.now());
    setStation('aerial');
    wake();
  });
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  byId('drop').hidden = false;
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    byId('drop').hidden = true;
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  byId('drop').hidden = true;
  const file = e.dataTransfer?.files[0];
  if (file) void loadCapture(file);
});

window.addEventListener('resize', () => {
  forceRender = true;
  wake();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    forceRender = true;
    wake();
  }
});

async function start(): Promise<void> {
  if (IS_PHONE) byId('q-ultra').hidden = true;
  syncDensity();
  camera.setEyeLook(...VIEWS.aerial);
  setStation('aerial');
  updateClock();
  void power.connectBattery();
  wake();
  try {
    await Promise.race([document.fonts.load(`800 40px ${FONT}`), new Promise((resolve) => setTimeout(resolve, 2500))]);
  } catch {
    // Fall back to the system font for the scoreboard text.
  }
  await buildArena();
}

void start();
