# Viking warrior — skinned animation showcase

`demo-viking.glb` is original procedural **demo art**, dedicated to the public domain
under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). No external models,
textures or animation data were used. Generator code uses the repository's Apache-2.0
license. Reproduce both bundled fixtures with `pnpm generate:glb`.

The stylized muscular male warrior has an iron helmet with nasal guard, a braided
red beard, fitted chest/shoulder armor, leather skirt, bracers and boots. This is
readable runtime demonstration art, not a finished production character or a claim
of historical accuracy. Source: [generate-viking.ts](../../scripts/generate-viking.ts).

## Local demo

1. Run `pnpm install`, then `pnpm dev`; open the local URL printed by Vite.
2. Open or create a character and select **3D** in the header. A fresh library creates
   an empty character automatically; no PNG upload is needed to use the 3D demo.
3. Pick a **Clip**, **Pause/Play**, or **Restart**. Toggle **Loop** off to play once and
   hold the final pose. Drag to orbit and scroll to zoom, including for facial details.
4. Toggle **Armor** and **Helmet** independently. Choose **Weapon**: none, axe or sword.
   The right hand opens when empty and curls around the grip when equipped.
5. Choose **Face**: neutral, happy or angry. **Pose & playback** contains expression
   strength, speed, crossfade duration and a pose slider that seeks and pauses.
6. Toggle **Bones** to inspect the rig. Return to **2D** for the existing PNG/Pixi editor.

The demo is shared across previews in this tab and resets on reload. It does not
convert, modify or persist into the selected 2D character. Each mounted viewer has
its own mixer clock; configuration and explicit seek commands are shared, not a
frame-synchronized multiplayer timeline. Playback state reports the requested
mode; a completed non-looping action holds its last pose until Restart/seek.

## Embedded asset contract

| Feature | Authored data |
| --- | --- |
| Rig | 47 joints: 17 humanoid joints plus 30 finger joints, using VRM humanoid semantic names; normalized blended weights and inverse bind matrices |
| Body animations | `idle` (3s), `walk` (1.2s, in place), `battle-ready` (2s), `attack` (1.2s), `cheer` (2s), `wave` (2s) |
| Hand poses | `hands-open`, `hands-grip` (1s constant clips); finger-only bindings layered alongside the body clip by AnimationMixer; right-hand grip, left hand open |
| Expressions | `happy` and `angry` morph targets on the stable body mesh; neutral sets both to zero; preset strength 0–1 |
| Armor/helmet | `VikingArmor`, `VikingHelmet`: separate skinned meshes using the exact body skeleton and bind space; visibility toggles |
| Weapons | `VikingAxe`, `VikingSword`: rigid authored meshes under `rightHandSocket`, a child of the `rightHand` bone; one visible weapon or none |
| Delivery | Self-contained glTF 2.0 GLB, roughly 1.70 MB, 19,013 indexed vertices, no textures or external resources |

The spare sword is authored at zero scale so a generic GLB viewer initially shows
only the axe. The browser restores its scale and controls equipment visibility.

Body clips key all 17 body joints, so a previous animation cannot leave a limb in
an unintended pose. The two hand clips use disjoint finger bindings. Facial morphs
are independent of both. All motion/poses live in the GLB; the browser uses Three
`AnimationMixer` and action weights for bounded crossfades, including rapid switches.
Pausing and speed 0 freeze the current pose and fade. A paused clip switch shows its
first pose immediately. Explicit seek cancels the fade and samples the chosen clip.

This is plain glTF, not a VRM file. The spike loads only this trusted bundled asset.
Arbitrary imports, garment fitting to other rigs, production clipping guarantees,
retargeting, root-motion extraction, physics, cloth simulation, export and persisted
3D compositions remain outside this demo. Inspect bent poses when producing final art.

## WebMCP (Mantle alpha.14, no package version changes)

The two existing public tools are extended through the normal Mantle Procedure →
Trigger → handler registration. The human controls call the same application command.

- **`inspect_3d_character({})`** returns asset identity, clip/expression/equipment
  catalogs, hand-pose mapping, playback semantics and current state/revision.
- **`configure_3d_preview({...})`** applies one atomic configuration. Pass the latest
  `expectedRevision` from inspect; omitted fields retain their current settings.

| Field | Accepted values |
| --- | --- |
| `expectedRevision` | Required nonnegative integer matching the current revision |
| `clipName` | `idle`, `walk`, `battle-ready`, `attack`, `cheer`, `wave` |
| `playing`, `loop` | Booleans |
| `timeScale` | Finite number 0–3; 0 freezes playback |
| `crossfade` | Finite number 0–2, seconds at 1× playback, applied on the next playing clip switch |
| `seek` | Finite number 0–1, fraction of the selected clip; explicit command, not live telemetry; 0 restarts |
| `armor`, `helmet`, `skeleton` | Booleans |
| `weapon` | `none`, `axe`, `sword`; automatically selects the matching embedded finger clip |
| `expression` | `neutral`, `happy`, `angry` |
| `expressionWeight` | Finite number 0–1; neutral always zeroes both morphs |

After inspecting, replace `0` with the returned revision:

```json
{
  "expectedRevision": 0,
  "clipName": "battle-ready",
  "playing": true,
  "loop": true,
  "timeScale": 0.8,
  "crossfade": 0.35,
  "armor": true,
  "helmet": true,
  "weapon": "axe",
  "expression": "angry",
  "expressionWeight": 0.9
}
```

To hold an exact pose, inspect again and send `clipName: "attack"`, `seek: 0.45`,
`playing: false` with the new revision. To replay it, send `seek: 0`, `playing: true`.
Unknown fields and names, stale revisions, invalid types, nonfinite/out-of-range
numbers and 2D slot fields are rejected without changing state or notifying viewers.
The earlier spike's `happy`/`prop` fields have been replaced by the explicit
expression and equipment catalog; there are no silent compatibility aliases.
The UI works in browsers without WebMCP.

## Original fixture and verification

`demo-humanoid.glb` remains the original small 17-joint baseline, generated by
[generate-skinned-humanoid.ts](../../scripts/generate-skinned-humanoid.ts), also CC0.
It contains a `wave` clip and `happy` morph; the UI now loads the Viking instead.

`pnpm check:3d` loads both binaries with GLTFLoader and verifies the Viking's joint
hierarchy, shared skeleton, bind transforms, weights, deformation for every body
clip, finger-pose deformation, socket following, morph isolation, playback/seek/
crossfade behavior, disposal, closed schemas and real Mantle/WebMCP invocation.
It is included in `pnpm test`. Required gates: `pnpm lint`, `pnpm test`, `pnpm build`.
See [research and review](../../docs/research/3d-character-standards-and-webmcp.md).

Both generated GLBs were also checked with Khronos glTF Validator 2.0.0-dev.3.10:
zero errors, warnings, infos or hints. The runtime check guards the corrected leaf
node, buffer target and unused joint-index export rules without adding a dependency.
