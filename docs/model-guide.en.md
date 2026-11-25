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

Only **FBX** and **GLB** are supported. Export .max, .obj, .c4d or .skp to FBX first.

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

**The library is still small**: it knows 4 lights from the 3d66 model library (one beam, one wash, one strobe, one LED bar) and 3 furniture models, so most types need you to pick. **Want your usual fixtures recognised automatically? Send one fixture model to us** (contact at the bottom of the page); we work out its lens and add it to the library, so everyone gets it recognised from then on.

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

---

## Troubleshooting

Bugs or feature requests? Contact: **stageviewer.app@outlook.com**

- **Screens are white**: “Embed Media” was off — export again with it on.
- **People are the wrong size**: wrong export units — use centimeters or meters.
- **Machinery does not move**: “Animation” was off, or the keyframes are on a part inside the group instead of the group itself.
- **A fixture was not recognised**: choose its role in the confirm step. If copies of the same fixture were modelled separately (not copied), they may show up as different types — choose a role for each.
- **Browsers**: Chrome, Edge or Firefox from the last two years; Safari 16.4+ (iOS 16.4+ on iPhone).
