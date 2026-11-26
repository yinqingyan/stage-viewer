# Stage Viewer

[中文](README.md) | **English**

Turn a 3D model into **a single html file**. Double-click it to explore the model in 3D in any computer or phone browser, or walk through it in first person. Send it by email or chat; the person opening it needs no software.

👉 **Use it online: <https://yinqingyan.github.io/stage-viewer/>**

- **Free and open source** (MIT)
- **Your model is never uploaded.** Everything runs in your own browser; the site's server never sees your file
- **The result is an offline file**, not a hosted link: nothing expires, no account, opens without a good connection

## What it does

It started as a tool for stage designers, but **it works with any 3D model**: stages, exhibition booths, buildings and interiors, landscapes, products, scenes. Anything you can export to one of these formats:

| Format | Notes |
|---|---|
| **FBX** (recommended) | Exported by 3ds Max, Maya, C4D and others. Tick “Embed Media” so textures come along. Automatic fixture detection works with FBX only |
| **GLB** (recommended) | glTF 2.0 binary from Blender and others. Textures are inside the file; the easiest option |
| OBJ, 3DS, DAE | Common from SketchUp, Rhino and others. Textures may be separate files and show white on the page |

The generated page offers:

- Preset views (front, left/right 45°, plan); drag to orbit and zoom with mouse or touch
- **Walk mode**: walk through the model in first person, sit down, check real sightlines
- **Director mode**: place camera positions and measure distances
- **Seat view**: click a seat to see the view from it, with the distance to the screen; one click for far left, far right and back row
- **Screenshot and orbit video**: save the current view as a high-resolution image, or record a 90° / 180° / 360° turn as a video, without the interface
- **Surfaces**: turn floors and decks into carpet, concrete, wood, dance floor or gloss in any colour; “Save as new file” keeps the look for whoever you send it to
- Screen-texture toggle and display settings; the model's size is shown in the top-right corner

## Extras for stage design

- **Lights and furniture are detected automatically.** Repeated fixtures and chairs are found and replaced with simple shapes (glowing lens, switchable beam), so a model with hundreds of fixtures shrinks to a few dozen MB. Unknown ones are guessed from their names (Sharpy, MegaPointe, “beam”, “strobe”…); the reference data covers 80 fixtures
- **Speakers are recognised.** Boxes named with a model (K2, GSL8, KS28…) become line arrays or subs, with show/hide per group. The reference data covers 60 speakers
- **Lifts, sliding screens, turntables** (beta): animation in the model becomes control sliders
- **Audience side**: pick front, back, left or right so the audience view faces the stage

For models that aren't stages, skip step 2 and generate straight away.

## How to use

1. Open <https://yinqingyan.github.io/stage-viewer/> and drop in your model
2. Check the lights, furniture and speakers it found (skip this for non-stage models)
3. Enter a project name and click “Generate and download” to get one html file

Export settings and troubleshooting are in the [model preparation guide](docs/model-guide.en.md), also built into the page: embedding textures, choosing units, making a big model smaller.

## Development

### Generate from the command line (Python 3 only)

```bash
python3 skill/stage-viewer/scripts/build_html.py model.fbx -c config.json -o out.html
python3 skill/stage-viewer/scripts/build_html.py model.fbx --inspect   # list parts, check textures are embedded
python3 skill/stage-viewer/scripts/build_html.py --show --title "Show name" -o blocking.html   # blocking/choreography version
```

Accepts .fbx, .glb, .obj, .3ds and .dae. Config fields are described in `skill/stage-viewer/SKILL.md`, with examples in `skill/stage-viewer/examples/`.

### Change features (Node.js)

```bash
npm install
node build.mjs        # build the viewer template and the generator page (dist/舞美生成器.html)
./deploy-pages.sh     # publish to GitHub Pages (gh-pages branch)
```

`build.mjs` bundles three.js and `src/` into the viewer template; the generator (or `build_html.py`) then injects the compressed model and config to produce the single html file.

### Layout

- `src/generator.html`, `src/generator.js`: the generator page
- `src/main.js`: viewer entry; `lights.js` lights, `machines.js` machinery, `props.js` furniture, `cameras.js` and `director.js` camera positions, `show.js` blocking, `i18n.js` Chinese/English
- `src/fbx.js`: reads FBX, finds repeated fixtures and furniture, builds the config, slims the model (byte-identical to `fbx_strip.py`)
- `src/guess.js`: guesses role and model from names
- `src/vendor/FBXLoader.js`: three.js FBX loader, patched (3ds Max / V-Ray materials, rotation animation, units)
- `docs/`: designer guides, fixture data (`fixtures-reference.json`), speaker data (`speakers-reference.json`), explainer videos
- `skill/stage-viewer/`: Python generator scripts and instructions for AI assistants
- `dev/`: helpers for test models and recording the explainer video

## License and contact

MIT, see [LICENSE](LICENSE). Includes [three.js](https://github.com/mrdoob/three.js) (MIT); `src/vendor/FBXLoader.js` is adapted from the three.js loader. The camera-position feature follows ideas from OpenShotDesigner (GPL) without using its code; please don't copy its code in future changes either.

Bugs or feature requests: **stageviewer.app@outlook.com**
