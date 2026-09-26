// Progressive ray-traced lighting. A texture holds one light value per splat; each frame a band of
// rows is re-traced within the frame budget and blended in, so lighting refines over a few passes
// and then stops costing anything until the sun, the lights or the scene change.
import fullscreenVert from './shaders/fullscreen.vert';
import lightingFrag from './shaders/lighting.frag';
import { compile, must, uniforms } from './gl';
import type { GridData } from './voxels';
import type { SunState } from '../world/sun';
import type { LightRig } from '../world/show';

/** Interior splats are stored first, so the two bands can be refreshed separately. */
export type Band = 'int' | 'ext';

export interface RayBudget {
  /** Rows of 1024 splats to trace this frame. */
  rows: number;
  rays: number;
  lightSamples: number;
  steps: number;
}

interface GridTexture {
  data: GridData;
  tex: WebGLTexture;
}

export class Lighting {
  readonly tex: WebGLTexture;
  ready = false;
  rows = 1;
  interiorRows = 0;

  private readonly fb: WebGLFramebuffer;
  private readonly program: WebGLProgram;
  private readonly u;
  private readonly empty: WebGLVertexArrayObject;
  private fine: GridTexture | null = null;
  private coarse: GridTexture | null = null;
  private count = 0;
  private frame = 0;
  private readonly cdf = new Float32Array(16);
  private readonly cycles: Record<Band, number> = { int: 0, ext: 0 };
  private readonly cursor: Record<Band, number> = { int: 0, ext: 0 };
  /** Completed passes since the band's inputs last changed; drives the running average. */
  private readonly passes: Record<Band, number> = { int: 0, ext: 0 };

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = compile(gl, fullscreenVert, lightingFrag);
    this.u = uniforms(gl, this.program, [
      'u_tex', 'u_gridIn', 'u_gridOut', 'u_inMin', 'u_inInv', 'u_outMin', 'u_outInv', 'u_vIn', 'u_vOut',
      'u_n', 'u_frame', 'u_rays', 'u_steps', 'u_lights', 'u_lightSamples', 'u_sun', 'u_sunCol', 'u_sky', 'u_ambient',
      'u_lightPos', 'u_lightCol', 'u_lightDir', 'u_lightCdf', 'u_lightTotal',
    ] as const);
    this.tex = must(gl.createTexture(), 'a texture');
    this.fb = must(gl.createFramebuffer(), 'a framebuffer');
    this.empty = must(gl.createVertexArray(), 'a vertex array');
  }

  /** Allocates the light texture for a new scene and fills it with neutral light (1.0). */
  reset(count: number, interiorCount: number): void {
    const gl = this.gl;
    this.count = count;
    this.rows = Math.max(1, Math.ceil(count / 1024));
    this.interiorRows = Math.ceil(interiorCount / 1024);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.clearColor(0.5, 0.5, 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cycles.int = this.cycles.ext = 0;
    this.passes.int = this.passes.ext = 0;
    this.cursor.int = 0;
    this.cursor.ext = this.interiorRows;
    this.ready = false;
  }

  setGrids(fine: GridData, coarse: GridData): void {
    this.fine = this.upload(fine, this.fine);
    this.coarse = this.upload(coarse, this.coarse);
    this.ready = true;
  }

  disable(): void {
    this.ready = false;
  }

  /**
   * Queues `cycles` full passes over a band. `fresh` discards the old lighting outright (new scene);
   * otherwise the old result is kept as a starting point and blended toward the new one.
   */
  kick(band: Band | 'all', cycles: number, fresh = false): void {
    for (const b of band === 'all' ? (['int', 'ext'] as const) : [band]) {
      this.cycles[b] = Math.max(this.cycles[b], cycles);
      this.passes[b] = fresh ? 0 : Math.min(this.passes[b], 1);
    }
  }

  get active(): boolean {
    return this.ready && (this.cycles.int > 0 || this.cycles.ext > 0);
  }

  /** Full passes still queued, for display. */
  get pending(): number {
    return this.cycles.int + this.cycles.ext;
  }

  /**
   * Traces up to budget.rows rows; returns the number of splats evaluated. Each pass is blended in
   * as a running average (1/n), but never below minBlend so moving lights still show up promptly.
   */
  step(dataTex: WebGLTexture, budget: RayBudget, sun: SunState, rig: LightRig, minBlendInterior: number, minBlendExterior: number): number {
    if (!this.active || !this.fine || !this.coarse) return 0;
    const gl = this.gl, u = this.u;
    const bands = (['int', 'ext'] as const).filter((b) => this.cycles[b] > 0);
    const perBand = Math.max(1, Math.floor(budget.rows / bands.length));

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dataTex);
    gl.uniform1i(u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.fine.tex);
    gl.uniform1i(u.u_gridIn, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.coarse.tex);
    gl.uniform1i(u.u_gridOut, 2);
    gl.activeTexture(gl.TEXTURE0);
    const f = this.fine.data, c = this.coarse.data;
    gl.uniform3f(u.u_inMin, f.x0, f.y0, f.z0);
    gl.uniform3f(u.u_inInv, 1 / (f.nx * f.v), 1 / (f.ny * f.v), 1 / (f.nz * f.v));
    gl.uniform3f(u.u_outMin, c.x0, c.y0, c.z0);
    gl.uniform3f(u.u_outInv, 1 / (c.nx * c.v), 1 / (c.ny * c.v), 1 / (c.nz * c.v));
    gl.uniform1f(u.u_vIn, f.v);
    gl.uniform1f(u.u_vOut, c.v);
    gl.uniform1i(u.u_n, this.count);
    gl.uniform1i(u.u_rays, budget.rays);
    gl.uniform1i(u.u_steps, budget.steps);
    gl.uniform1i(u.u_lights, rig.count);
    gl.uniform1i(u.u_lightSamples, budget.lightSamples);
    gl.uniform3fv(u.u_sun, sun.dir);
    gl.uniform3fv(u.u_sunCol, sun.color);
    gl.uniform3fv(u.u_sky, sun.sky);
    gl.uniform3fv(u.u_ambient, rig.ambient);
    gl.uniform4fv(u.u_lightPos, rig.pos);
    gl.uniform3fv(u.u_lightCol, rig.color);
    gl.uniform4fv(u.u_lightDir, rig.dir);
    let total = 0;
    for (let i = 0; i < rig.count; i++) {
      total += rig.pos[i * 4 + 3]!;
      this.cdf[i] = total;
    }
    gl.uniform1fv(u.u_lightCdf, this.cdf);
    gl.uniform1f(u.u_lightTotal, total || 1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    gl.bindVertexArray(this.empty);
    let traced = 0;
    for (const band of bands) {
      const lo = band === 'int' ? 0 : this.interiorRows;
      const hi = band === 'int' ? this.interiorRows : this.rows;
      if (hi <= lo) {
        this.cycles[band] = 0;
        continue;
      }
      let left = Math.min(perBand, hi - lo);
      while (left > 0 && this.cycles[band] > 0) {
        const cur = this.cursor[band], n = Math.min(left, hi - cur);
        const minBlend = band === 'int' ? minBlendInterior : minBlendExterior;
        gl.blendColor(0, 0, 0, Math.max(minBlend, 1 / (this.passes[band] + 1)));
        gl.viewport(0, cur, 1024, n);
        gl.uniform1i(u.u_frame, this.frame++);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        traced += n;
        left -= n;
        this.cursor[band] = cur + n;
        if (this.cursor[band] >= hi) {
          this.cursor[band] = lo;
          this.cycles[band]--;
          this.passes[band]++;
        }
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return traced * 1024;
  }

  private upload(g: GridData, old: GridTexture | null): GridTexture {
    const gl = this.gl;
    if (old) gl.deleteTexture(old.tex);
    const tex = must(gl.createTexture(), 'a 3D texture');
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, g.nx, g.ny, g.nz, 0, gl.RGBA, gl.UNSIGNED_BYTE, g.rgba);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    // Keep the grid's shape, not its voxels; the GPU has those now.
    return { data: { ...g, rgba: new Uint8Array(0) }, tex };
  }
}
