# Model preparation guide

Turn your stage model into a web page you can explore in 3D: drop in the model, confirm a few settings, and download one html file. It opens with a double-click in any computer or phone browser — send it to the director or client by email or chat.

**Your model is never uploaded.** Everything happens in the browser on your own computer.

---

## 1. Export FBX (required)

In 3ds Max: **File → Export → Export**, choose **FBX**, then in the export settings:

| Setting | Choose | If you don't |
|---|---|---|
| Embed Media | **On** | Screen content and textures are missing; you get a plain white model |
| Animation | **On** when there are lifts or sliding screens, plus “Bake Animation” | The machinery cannot move |
| Units | Centimeters or meters | The model is the wrong size (people look like ants or giants) |
| File format | **Binary**, FBX 2014 or newer | ASCII files display, but lights cannot be detected or simplified |

Supported: **FBX, GLB, OBJ, 3DS, DAE**. **FBX or GLB is recommended**: only these two pack the textures into one file, and automatic fixture detection works with FBX only. Export .max, .c4d, .skp or .3dm to one of these first.

**Exporting from other programs:**

| Program | Export | Notes |
|---|---|---|
| 3ds Max | File → Export → FBX | Tick Embed Media, choose Binary |
| Maya | File → Export All → FBX | Tick Embed Media |
| Cinema 4D | File → Export → FBX | Tick embed textures |
| Blender | File → Export → glTF 2.0 (choose .glb) | GLB carries its textures — the easiest |
| SketchUp, Rhino, Vectorworks | Export FBX (or OBJ if FBX isn't available) | Textures may be separate files and show white on the page; use meters or centimeters |


## 2. Materials and screens

- **Screen content**: put the image on a Standard, Physical or VRay Light material; it is shown self-lit like a real screen.
- **VRay / Corona regular materials**: colour and reflection are kept, textures may be lost.
- **Texture size**: keep each texture under 2048 px; larger ones make the file big and slow to open on phones.

## 3. Lights and furniture

The page finds **repeated objects** in your model (the same light, the same chair) and you tell it what each one is. Anything you give a role becomes a simple shape (glowing lens, beam, simple furniture), which makes the file much smaller and gives the page a lights panel with a switch per group.

**Model it like this so they are found reliably:**

1. **One group per fixture**, and copy the same model for every fixture of the same type (fixtures from model libraries usually already are). Fixtures modelled separately instead of copied show up as different types.
2. **Group the lights by purpose**, e.g. “Top beams”, “Stage sides”, “Back wall”. **The outermost group name becomes the light switch name** on the page.

**In step 2 of the generator, each type gets one of three outcomes:**

| Case | Result |
|---|---|
| **Recognised** (filled in for you) | The fixture is in our library, so lens position, direction and size are exact — nothing to do |
| **You pick a role**: Beam / Wash / Strobe / LED bar / Chair / Stool / Table | The lens sits at the fixture centre with a default size; the beam is aimed automatically (floor lights point up, overhead lights face the audience), so the position is approximate |
| **Leave as is** | Shown exactly as modelled, but it does not glow, has no light switch and keeps the file larger. Use it for anything that is not a light or furniture, or when unsure |

**The library is still growing** and holds only a few models so far, so most types need you to pick. **Want your usual fixtures recognised automatically? Send one fixture model to us** (contact at the bottom of the page); we work out its lens and add it to the library, so everyone gets it recognised from then on.

A model with hundreds of fixtures can be over 1 GB — that is fine; after simplifying it is usually a few dozen MB.

## 4. Lifts, lifting screens, sliding screens, turntables (beta)

The generated page gets a “Machinery” panel with a slider for each moving part. Tested with Blender exports; 3ds Max exports are still being verified — please tell us if something does not move right.

### Animate it in 3ds Max

The page reads the animation and **works out what moves, which way and how far**, then adds a control slider for it.

1. **Group everything that moves together**: a screen that rises with its frame and truss goes in one group. Each **half of a sliding screen is its own group**.
2. **Give the group a clear name**, e.g. “Main screen L” or “Lift A”. The name appears in the control panel.
3. **Set two keyframes**:
   - **Frame 0**: where it is in the model now (how the page opens)
   - **Last frame**: the end of travel (fully raised, fully open, fully turned)
   - Animate the two halves of a sliding screen separately, in opposite directions
4. **When exporting**, tick “Animation” and “Bake Animation”.

The type comes from the direction: up/down is a **lift**, sideways is a **slide**, turning around the vertical axis is a **turntable**.

**Not supported**: deforming animation such as drapes or a soft screen rolling up — only whole-object moves and turns.

### Later: set it up by clicking in the page

For models without animation, clicking an object in the generator to set it up is planned but not built yet.

## 5. Audience side

The generator asks which side of the stage the audience is on — pick Front, Back, Left or Right by 3ds Max viewport. If the audience view shows the back of the stage, pick another side and generate again.

## 6. If the model is too big

The generated page is roughly the size of the FBX after lights and furniture are simplified. **Aim for under 50 MB** so it opens smoothly on phones; above 100 MB some phones may fail to open it.

**Easiest first: let the generator handle lights and furniture.** Give them a role in step 2 and hundreds of fixtures and seats are replaced with simple shapes. This usually saves the most, with no work in 3ds Max.

**Still too big? Check these in 3ds Max, in order:**

1. **Find the heaviest objects**: press **7** for viewport statistics and select objects to see their face counts, or use Utilities → Polygon Counter. A few things usually account for most of it: audience seating, plants and flowers, sculptures and decorations, imported CAD or scanned models.
2. **Delete what nobody sees**: backstage, under-stage and behind-screen structure, hidden or frozen old versions, unused lights, cameras and helpers. Export with **Export Selected** so only the parts to show are included.
3. **Reduce polygons**:
   - Add a **ProOptimizer** modifier to heavy decorations and lower vertices to 20–50% — as long as you can't see the difference in the viewport.
   - Set **TurboSmooth / MeshSmooth** iterations to 0 or 1 before exporting.
   - Lower the **sides** of cylinders, pipes and round truss (e.g. 32 → 12).
   - Lower **Interpolation Steps** on splines and text; fewer sides on renderable splines.
4. **Use simple truss**: detailed truss has hundreds of faces per section, and hundreds of sections add up. From a distance, boxes or low-poly truss look the same.
5. **Shrink textures**: no larger than 2048 px each; JPG rather than PNG for photos; remove bump/reflection maps the web page doesn't use. 1920 × 1080 is plenty for screen content.
6. **When exporting**: untick Cameras and Lights; untick Animation if there is no machinery.

Re-export, drop it into the generator again, and step 1 shows the new file size.

---

## Troubleshooting

Bugs or feature requests? Contact: **stageviewer.app@outlook.com**

- **Screens are white**: “Embed Media” was off — export again with it on.
- **Stage too big or too small (people the wrong size)**: in step 3 of the generator open “Stage too big or too small?”, pick the units you modelled in (millimetres, centimetres, metres, inches) and generate again. The page shows the stage size in the top-right corner to check against.
- **Machinery does not move**: “Animation” was off, or the keyframes are on a part inside the group instead of the group itself.
- **A fixture was not recognised**: choose its role in step 2 of the generator (“Check what was found”). If copies of the same fixture were modelled separately (not copied), they may show up as different types — choose a role for each.
- **Browsers**: Chrome, Edge or Firefox from the last two years; Safari 16.4+ (iOS 16.4+ on iPhone).
