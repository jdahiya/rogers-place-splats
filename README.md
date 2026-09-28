# Rogers Place Splats

A real-time 3D Gaussian splat model of Rogers Place, home of the Edmonton Oilers. It covers the outside of the building and the inside of the bowl, lit by progressive ray tracing. It runs in any browser with WebGL2, from phones to desktops.

**Live demo:** https://jdahiya.github.io/rogers-place-splats/

- **Outside:** the building's teardrop plan, modelled from photos: the seating drum and the tail that sweeps down toward the plaza, a skin of silver metal panels with its dark band, the white roof, and the glass podium with "OILERS" lettering. Under the tail is Ford Hall, with its oval ceiling cove, video wall and blue feature wall. Around it are the plaza watch party, street trees, traffic, and the downtown blocks, including Stantec Tower. A time-of-day slider moves the sun from morning to night.
- **Inside:** a regulation NHL sheet with its markings and the Oilers logo at centre ice, both seating bowls with about 25,000 fans, the suites, ribbon boards, the centre-hung scoreboard, retired numbers and Stanley Cup banners. **Goal!** runs a light show with moving spotlights.
- **Game state:** the scene is set during the 19 September 2026 pre-season game against Winnipeg. The **Broadcast** station sits at press level, where the TV wide shot comes from.

The model is procedural: it's generated at load time from the arena's real layout, not photographed. You can open a trained `.ply` or `.splat` capture in the same viewer (see below).

The Oilers logo on the video boards, ribbons, banners and centre ice is the team's official SVG from the NHL's logo server (`src/assets/`). It's rasterised once at load, at the SVG's own 960 × 640 size; if a browser can't draw it, the boards fall back to lettering.

## Images and lettering

Screens, ribbons and banners are 2D drawings turned into splats, normally one splat per pixel at the panel's spacing. That's too coarse for a logo, which would come out only 8 to 30 splats tall. So a drawing marks where it puts the logo, and that rectangle is redrawn at the artwork's own pixel count and splatted separately (`splatDrawing` in `src/splats/primitives.ts`). Flat colour merges into larger splats, so only the edges pay for fine ones: a logo costs about 80,000 splats at full resolution instead of roughly 250,000 at one per pixel.

| Setting | Logos |
| --- | --- |
| Ultra | Their full original pixel count everywhere |
| High | Full resolution, but small logos stop at 6 mm between splats |
| Standard | Full resolution, but small logos stop at 12 mm |
| Light | Logos stop at 40 mm between splats, to keep the load down on phones |

A logo 20 m away can't show detail finer than about a centimetre even on a 4K screen, so the caps only remove splats nobody could see. The screens outside (the plaza screen, Ford Hall's video wall and the "OILERS" glass lettering) are also splatted 2–4 times finer than their panels, which makes their lettering sharp. Inside an ice-reflection range the coarse pixels stay 3 cm behind the face for the reflection to copy, and the fine splats stay out of it.

## Detail and reflections

Apple describes the new Flyover views in Apple Maps on iOS 27 as capturing the shapes of individual trees and the way light reflects off glass towers. Apple hasn't published how it's rendered. The same two ideas are applied here:
- **Reflective glass and metal.** Glass (building windows, the podium, car windows) and metal (the arena's skin) reflect the sky along the mirrored view direction, weighted by Schlick's Fresnel term, so glints slide across surfaces as the camera moves. Metal tints its reflection with its own colour. Surfaces in shadow don't catch the sun.
- **Panel-by-panel skin.** The skin is laid out as individual diamond panels. Each panel is a small grid of splats sharing one slightly tilted normal and one shade of silver, so reflections break up panel by panel, as they do on the real building. It's 5 × 5 splats per panel on Standard, 3 × 3 on Light and 9 × 9 on Ultra.
- **The rest of the envelope.** The glass podium is a fine grid with slim mullions every 1.5 m, and a sill, transom and head. The soffit under the skin's lip is a lit white band. The roof membrane is a regular grid with seams every 6 m. The paving round the building and across the plaza is finer, with joints between the plaza's pavers. People have legs, arms and a head.
- **Individual trees.** Each street tree has its own trunk, branches and about 140 leaf clusters in an irregular crown, in late-September colours. The spruces have whorls of drooping needle sprays.
- **Cars** have clear-coated hoods, roofs and trunk lids that pick up reflections, raked glass, wheels, and head- and tail-lights.

## How it works

| Stage | Where | What it does |
| --- | --- | --- |
| Scene generation | `src/scene/` | Builds about 1.1M splats (Light) to 6.5M (Ultra): oriented discs, blobs, and 2D canvases (scoreboards, banners) rasterised into splats. |
| Depth sort | `assembly/sort.ts`, `src/sort/` | A 20-bit counting sort compiled to WebAssembly (AssemblyScript), running in a Web Worker. It orders splats back to front in a few milliseconds. |
| Splat rendering | `src/render/renderer.ts`, `shaders/splat.*` | Each 3D Gaussian is projected to an ellipse (see Projection below), shaded with its lighting and any sky reflection, and blended in sorted order into a half-float HDR buffer. |
| Path-traced lighting | `src/render/lighting.ts`, `voxels.ts`, `shaders/trace.glsl`, `cache.frag`, `lighting.frag` | Voxel grids are built from the splats, storing coverage, surface colour and emission: 1 m around the arena, 4 m for the city. A radiance cache traces direct light and bounce rays for every surface voxel; each full pass adds a bounce. Each splat then gathers from it: shadowed sun and arena lights, sky light, and multi-bounce indirect light, such as ice lighting the lower bowl or screens tinting the crowd. It refines progressively, then stops. |
| Post | `shaders/bloom-*.frag`, `composite.frag` | Bloom from emissive splats, a soft highlight roll-off, vignette and grain. |
| Performance | `src/perf/` | Adaptive quality, frame pacing, GPU timing, a power and battery estimate, and live charts. |

WebGL has no access to hardware ray-tracing cores, so the path tracing runs as ordinary GPU shader work: rays marched through the voxel grids. It's spread across frames within the frame budget, and once the result settles the cost drops to zero. It path-traces the lighting through the voxel scene; the splats themselves are still drawn by sorted rasterisation, not traced per pixel.

## Standards

Splat rendering follows the original paper and its reference rasteriser: Kerbl et al., *3D Gaussian Splatting for Real-Time Radiance Field Rendering*, SIGGRAPH 2023, [paper](https://arxiv.org/abs/2308.04079) and [code](https://github.com/graphdeco-inria/diff-gaussian-rasterization).

- **Projection:** the 3D covariance is projected with the Jacobian of the perspective divide. The centre is clamped to 1.3× the field of view first, and 0.3 px² is added to the 2D covariance. Splats closer than 0.2 m are culled. Captures open with this projection, the only one `KHR_gaussian_splatting` defines.
- **Tangential projection:** the generated arena uses the `tangential` projection mode from OpenUSD's 3D Gaussian splat schema, which is also RealityKit's default. Each Gaussian is projected orthographically onto the plane through its centre that faces the camera, and that plane is drawn as a real quad in 3D. Perspective-correct interpolation then evaluates the Gaussian exactly where each pixel's ray meets the plane, so a splat's footprint doesn't stretch toward the edges of a wide view or change as the camera turns. The 0.3 px² dilation is converted to the plane's scale. Switch between the two in the Performance panel.
- **Opacity:** alpha is min(0.99, opacity · G). Fragments under 1/255 are skipped, and each splat extends to 3σ. Quads also shrink to where alpha can still reach 1/255, which saves fill on faint splats.
- **Blending:** premultiplied back-to-front "over", which gives the same result as the reference's front-to-back blending with early termination.
- **Colour:** spherical harmonics up to degree 3, evaluated per splat for the camera direction, using the reference basis constants. Colour is c = max(Σ SH·Y + 0.5, 0).
- **Anti-aliased captures:** captures trained with anti-aliasing are shown with the matching opacity compensation. That's either the 3DGS `--antialiasing` mode, or [Mip-Splatting](https://github.com/autonomousvision/mip-splatting) with a 0.1 px² dilation. Choose it from the menu next to **Flip**; SPZ files that flag it switch it on automatically.
- **Sorting:** by camera distance, the [KHR_gaussian_splatting](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_gaussian_splatting) default. Turning the camera never needs a re-sort. View-depth sorting, as in the original rasteriser, is an option in the Performance panel.
- **Output:** captures are shown neutrally, with no bloom or tone curve, as display-referred colour. glTF captures with `lin_rec709_display` colour are sRGB-encoded after blending.

Supported capture formats:
- 3DGS `.ply`, including `f_rest` spherical harmonics
- `.splat`
- [Niantic SPZ](https://github.com/nianticlabs/spz) versions 1–4: gzip or per-stream zstd, both rotation encodings, and the anti-aliasing flag
- glTF 2.0 `.glb`, or `.gltf` with embedded buffers, using the ratified `KHR_gaussian_splatting` extension: xyzw rotations, linear scale and opacity, `SH_DEGREE_l_COEF_n`, colour space and node transforms

`npm test` round-trips each format.

Apple's WWDC26 RealityKit `GaussianSplatComponent` uses the same parameterisation: position, scale, rotation, opacity and SH up to degree 3, drawn back to front. Its defaults, depth sorting and tangential projection, are both available here. This viewer runs the same data on the web.

**Known differences:**
- The sort is global, not per-pixel, so splats can occasionally pop. [StopThePop](https://arxiv.org/abs/2402.00525)'s per-pixel sort isn't practical in WebGL2.
- Base colour is stored in 8 bits, so it clips above 1.
- SPZ degree-4 colour is truncated to degree 3.
- glTF sparse accessors and external `.bin` files aren't supported.

## Performance targets

60 fps is the floor, and the display's refresh rate is the ceiling. Every half second the governor checks recent frames and adjusts one setting, in this order: ray budget, render scale, skipping sub-pixel splats, then bloom. Below 60 fps it's allowed to cut deeper than it would just to reach a high refresh rate.

Battery use is kept down in three ways:
- **Rendering stops when nothing on screen changes.** No camera movement, no lighting work and no animation means no frames.
- **Battery saver mode** caps rendering at 60 fps on 120 Hz and faster screens.
- **Phones start lighter:** lower density, fewer rays, coarser voxels, and a lower render scale.

The **Performance** panel shows:
- Frame rate, GPU time (where the browser exposes a GPU timer), and estimated power and battery drain.
- 12-second charts of frame time and power.
- Every current setting.

Browsers don't report power draw, so watts are modelled from GPU and CPU load for a typical phone, laptop or desktop. Where the browser reports the battery level, a measured drain appears once the level drops.

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit |
| Right-drag / Shift-drag | Pan |
| Scroll | Zoom; keep scrolling to fly forward |
| W A S D / arrows | Move |
| Q / E | Down / up |
| Shift | Move faster |
| Pinch (touch) | Zoom and pan |

## Loading a real capture

Drop a `.ply`, `.splat`, `.spz`, `.glb` or `.gltf` capture on the page, or use **Open capture**. Captures from Polycam, Scaniverse, Luma, Postshot, Niantic tools or the reference 3DGS trainer all work.
- **Link straight to a capture:** add `?capture=<url>` to the page address. The file's server has to allow cross-origin reads.
- **Link to a view:** `?eye=x,y,z&look=x,y,z` opens at that camera position (metres, y up, centre ice at the origin), and `?time=HH:MM` sets the time of day. For example, `?eye=97,6,-24&look=86,24,-10` looks up at Ford Hall's ceiling cove.
- **Upside down?** Use **Flip**.
- **Lighting:** ray-traced lighting is off for captures, because their lighting is already baked into the photos.

## Development

Requires Node 20 or newer.

```bash
npm install
npm run build      # AssemblyScript -> dist/sort.wasm, TypeScript -> dist/main.js
npm run serve      # http://localhost:8080
```

`npm run dev` rebuilds on change, `npm run typecheck` runs `tsc`, and `npm test` checks the WebAssembly sort against a reference ordering.

`node tools/fetch-reference.mjs [--width=2048] [Category ...]` downloads openly licensed photos from Wikimedia Commons categories (the Rogers Place ones by default) into `reference/`, with a `CREDITS.csv` of authors and licences. It skips files it already has and backs off when rate-limited. The photos are visual reference for modelling. The folder is git-ignored and isn't part of the site.

```
assembly/sort.ts        WebAssembly depth sort (AssemblyScript)
src/main.ts             entry point: frame loop and UI wiring
src/scene/              arena geometry, interior, envelope and Ford Hall, exterior, trees, palettes, 2D screen art
src/assets/             the official Oilers logo (SVG)
src/splats/             splat storage, shape primitives, .ply/.splat import
src/render/             WebGL2 renderer, voxel grids, ray-traced lighting, GLSL shaders
src/sort/               sort worker and its main-thread client
src/camera/             orbit camera, input, stations and the guided tour
src/world/              sun position and sky, arena light rig and goal show
src/perf/               governor, GPU timer, power model, stats, charts, panel
tools/                  build script, dev server, sort check
```

Pushing to `main` builds and deploys the site to GitHub Pages (`.github/workflows/pages.yml`).

## Not affiliated

This is an independent fan project. It is not affiliated with or endorsed by the Edmonton Oilers, Oilers Entertainment Group, ICE District, Sportsnet or Rogers. It uses no team logos.
