# Rogers Place Splats

A 3D Gaussian splat viewer for Rogers Place, home of the Edmonton Oilers. It covers the outside of the building (the metal skin, the Ford Hall atrium, the plaza and the downtown blocks around it) and the inside (the ice, both seating bowls, the suites, the centre-hung scoreboard and the rafter banners).

It's one HTML file with no build step and no dependencies.

- **Rendering:** WebGL2, with each splat drawn as an anisotropic 2D Gaussian projected from its 3D covariance (EWA splatting).
- **Sorting:** a hand-assembled WebAssembly module sorts splats back to front with a 16-bit counting sort. It runs in a Web Worker, and a plain-JS fallback takes over if WebAssembly is unavailable.
- **Scene:** generated procedurally at load time from the arena's real layout: the NHL 200 × 85 ft sheet with its markings, 26 lower-bowl rows, 22 upper-bowl rows, the retired numbers and the Stanley Cup years. It is not a photographic capture.

## Run it

Any static file server works. One is included:

```bash
node tools/serve.mjs 8080
```

Then open http://localhost:8080.

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

The station buttons jump between views, and **Play tour** flies from the street, through Ford Hall, into the bowl and up to the rafters. **Light / Standard / Dense** sets the splat count (about 0.5M, 1M and 2M).

## Loading a real capture

Drop a `.ply` (standard 3D Gaussian Splatting output) or `.splat` file on the page, or use **Open .ply / .splat**. Captures from Polycam, Scaniverse, Luma, Postshot or the reference 3DGS trainer all work. Use **Flip** if the capture comes in upside down.

To build a photographic version of the arena, capture your own photos or video and train a splat from them. Don't use photos scraped from the web; they belong to their photographers.

## Rebuilding the WebAssembly sort

`tools/build_wasm.mjs` assembles the module byte by byte, checks it against a reference sort and writes `tools/sort.wasm.b64`. Paste that string into `WASM_B64` in `index.html`.

```bash
node tools/build_wasm.mjs
```

## Not affiliated

This is an independent fan project. It is not affiliated with or endorsed by the Edmonton Oilers, Oilers Entertainment Group, ICE District or Rogers. It uses no logos.
