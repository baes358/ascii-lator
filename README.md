# ascii-lator

Interactive ASCII-particle photo renderer. Drop in a JPG/PNG and it becomes
15–30k luminous monospace glyphs that spring, repel, and burst under the
cursor.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (defaults to http://localhost:5173). Drop an image
on the canvas — or click the dashed area, or use the **upload** button in the
panel.

`npm run build` produces a static bundle in `dist/`.

## Controls

| Control     | Effect                                                          |
| ----------- | ---------------------------------------------------------------- |
| density     | particle count (6k–30k). Recomputes the sampling grid live.     |
| color       | `original` samples photo color · `monochrome` uses luminance · `accent` tints by lum |
| accent      | hex color used in accent mode                                    |
| ramp        | the character set, ordered light → heavy                         |
| cursor      | push particles away within `repelRadius`                         |
| click / tap | radial burst that settles back to home                           |

## Architecture

```
src/
  glyphAtlas.js     — packs ramp into a NearestFilter atlas texture
  imageSampler.js   — decode → downscale grid → luminance → flat typed arrays
  particleSystem.js — one InstancedMesh, CPU spring/repel/burst, no per-frame allocs
  shaders/
    particle.vert   — atlas UV from aGlyph, applies aOffset, color modes
    particle.frag   — atlas sample, additive emit on dark background
  interaction.js    — pointer → normalized image space, click bursts
  controls.js       — panel UI wiring
  main.js           — wiring + RAF loop + resize + file load
```

All particle data lives in flat `Float32Array`s allocated once at
`MAX_PARTICLES`. The physics loop in `particleSystem.update()` mutates them
in place — no allocations per frame.

The mesh is a single `InstancedBufferGeometry` over a unit plane; world
position is computed in the vertex shader from `aHome + aOffset` scaled by
the `uScale` uniform. Result is one draw call regardless of particle count.

### GPU/FBO physics seam

`particleSystem.update()` is the only place that touches CPU-side state.
To swap in GPU/FBO physics, replace its body with a render-to-texture pass
that ping-pongs position+velocity FBOs, then bind those textures in the
particle vertex shader to sample `aOffset` instead of reading from an
instanced attribute. Nothing else (atlas, sampler, interaction, controls,
main) needs to change.

## Tunables

All in `src/particleSystem.js` (`PHYSICS` export):

| constant       | default | meaning                                            |
| -------------- | ------- | -------------------------------------------------- |
| stiffness      | 55      | spring force pulling particles toward home         |
| damping        | 6.5     | velocity damping (higher = settles faster)         |
| repelRadius    | 0.22    | mouse push radius (normalized — image half = 1)    |
| repelStrength  | 2.2     | mouse push force                                   |
| burstRadius    | 1.6     | click burst radius                                 |
| burstStrength  | 6.0     | click burst impulse                                |
| scatterMin/Max | 1.6/3.2 | fly-in scatter shell                               |
| maxSpeed       | 12.0    | velocity clamp to keep things stable               |

Atlas / scale tuning lives in `src/main.js`:

| constant       | default | meaning                                            |
| -------------- | ------- | -------------------------------------------------- |
| MAX_PARTICLES  | 30000   | persistent buffer size; density slider caps here   |
| MAX_DPR        | 1.5     | render pixel ratio cap                             |
| DEFAULT_RAMP   | ` .:-=+*#%@` | bright cells map to dense glyphs (high index) |

## Performance

- **One draw call.** `InstancedBufferGeometry` over a single unit plane.
  Verify in the browser profiler (Frames → render → draw calls).
- **No per-frame allocation.** The physics loop only mutates pre-allocated
  typed arrays; `aOffset.needsUpdate = true` triggers a single GPU upload.
- **DPR capped at 1.5.** Bumps quality on retina without paying the 4×
  fragment cost of devicePixelRatio=2.
- **RAF pauses on tab hide** via `visibilitychange`.
- **Mobile:** drop density to ~8–10k. The slider goes down to 6k.
