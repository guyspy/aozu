# Game-ready 3D characters and WebMCP

Date: 2026-09-05. Product direction: D排. This replaces the earlier rigid/voxel-first proposal.

## Decision

Deliver self-contained **glTF 2.0 GLB with a skinned humanoid**, using **VRM 1.0 humanoid bone semantics** as the primary bone map. Keep the layered PNG/Pixi workshop separate. Its canvas, painter order, whole-head overlays, and nine authoring tools are not a 3D contract. A voxel viewer is not evidence of a game-ready character pipeline.

Game-ready means an explicit skeleton hierarchy, joints, rest/bind transforms, inverse bind matrices, normalized vertex skin weights and joint indices, plus demonstrable skeletal animation. Morph targets must work alongside skinning. GLB is the delivery container; retain Blender or other authoring sources. A tiny procedural fixture proves the runtime mechanics, not production art quality or arbitrary avatar compatibility.

## Standards and production evidence

| Choice | Evidence and decision |
| --- | --- |
| GLB | glTF defines skins, joint attributes, inverse bind matrices, morph deltas and animation channels. Require embedded resources for the future import profile. [Khronos specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) |
| VRM humanoid — primary | Explicit semantic-to-node mapping and required/optional bones make a portable contract. Use names such as hips, spine, head, leftUpperArm, leftLowerArm, leftHand and their leg/right equivalents. Optional chest, neck, shoulders and fingers may enrich it. This spike uses the vocabulary, not the VRMC_vrm extension or a claim of VRM conformance. [Humanoid specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md) |
| Mixamo — upstream adapter | Useful auto-rigging and animation source. Convert and explicitly map exported joints to the primary semantics; names alone do not establish compatible rest transforms. [Adobe workflow](https://helpx.adobe.com/creative-cloud/help/mixamo-rigging-animation.html) |
| Unity Humanoid — engine adapter | Avatar mapping and T-pose configuration support animation retargeting. Keep this engine configuration outside the portable asset contract. [Unity Avatar configuration](https://docs.unity3d.com/Manual/ConfiguringtheAvatar.html) |
| Modular skeletal characters | Shared animation poses across body and garment meshes are established production practice; merging is an optimization with tradeoffs, not an initial requirement. [Epic modular characters](https://dev.epicgames.com/documentation/en-us/unreal-engine/working-with-modular-characters-in-unreal-engine) |

### Expressions preserve topology

Default to blend shapes (glTF morph targets). Define named presets mapping to mesh/target weights, with zero restoring neutral. VRM expressions combine morph bindings and material/texture-transform bindings, and define binary/override behavior for blink, gaze and mouth combinations. A later VRM adapter must implement these semantics rather than merely copy preset names. [VRM expressions](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md).

ARKit provides facial coefficient names suitable for tracking-to-rig mapping; it is not a mesh topology or skeleton standard. Production rigs need authored shapes and tested combinations, not just renamed targets. [Apple face anchor](https://developer.apple.com/documentation/arkit/arfaceanchor).

Ready Player Me documents ARKit-compatible morph targets and configurable morph exports. Treat this as a production precedent for a stable head mesh, facial shapes and visemes, not as a service dependency or evidence of current hosted availability. [RPM morph targets](https://docs.readyplayer.me/ready-player-me/api-reference/avatars/morph-targets).

Material presets can change face textures or colors. `KHR_materials_variants` selects preauthored material mappings; it does not deform facial geometry or create clothing. Defer extension support; a future importer must advertise supported bindings. Whole-head replacement is an exceptional asset-family operation, never the default expression mechanism. [Material variants](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_variants).

## Authorable wardrobe contract

Use template fit bodies, with versioned skeleton and body-fit identities. Agents can choose catalog garments, author mesh geometry against a supplied template, transfer/paint skin weights in a DCC, export, validate, then preview several poses. Retargeting motion does not fit clothes to a different body.

A proposed garment manifest contains asset hash/license, template body ID/version, skeleton signature (hierarchy + rest transforms), joint mapping, bind matrices, covered body regions, layer/exclusion rules and material presets. Garment and body meshes share the same runtime skeleton only after bind-space compatibility is verified. Hide explicitly authored body regions under clothing; do not guess triangle removal. Require bend/shoulder/hip pose checks and human clipping review. No universal wardrobe compatibility is implied.

Rigid props instead declare a semantic bone socket, local translation/rotation/scale, occupancy and compatible template. A sword follows a hand; a backpack follows a chest socket. These are spatial attachments, with no front/back painter-order semantics. Scale and pivots remain authored; camera framing must not move individual modules.

Future import gates: embedded buffers/textures, bounded bytes/vertices/joints/morphs, finite transforms, normalized weights, valid joint indices, inverse-bind agreement, supported extensions, hashes and explicit license. These are proposed AOZU policy, not properties guaranteed by a GLB suffix. The spike loads only its bundled trusted fixture; arbitrary uploads and a general validator are deferred.

## Minimal Mantle/WebMCP surface

Keep the existing Mantle alpha.14 backbone and Procedure → public MCP Trigger → handler flow. Share one observable preview state between UI and handlers, separate from PNG Character entries. Do not clone the nine 2D operations.

| Atom | Spike behavior | Later scope |
| --- | --- | --- |
| `inspect-3d-character` | Read fixture identity, bone semantics, morph/socket capabilities and session revision | Import diagnostics and fit catalog |
| `configure-3d-preview` | Set absolute happy weight, right-hand prop, animation and skeleton visibility with expected revision | Validated garment/material selections |

Both procedures are real backbone definitions and browser registrations. State is ephemeral, shared across 3D previews in this tab, reset on reload, and never mutates the selected PNG character. Mutation rejects unknown fields, stale revisions, nonfinite/out-of-range weights and invalid types. UI controls use the same state command. Rendering remains a browser adapter with no Three dependency in core.

Future persisted composition, inspect/import/validate and export procedures should be introduced only when their storage and conformance guarantees exist. The four Mantle atoms remain architectural building blocks, not a requirement for four UI tools.

## Bounded spike: prove and defer

Prove: GLTFLoader + OrbitControls; generated licensed GLB under public/glb; full minimum humanoid joint chains with bind matrices and blended skinning; an embedded skeletal clip; a happy face morph on a stable mesh; a right-hand socket prop that follows animation; optional SkeletonHelper; existing 2D|3D toggle displays this path without altering Pixi. [Three GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).

Check actual GLB loading, joint hierarchy and bind pose, normalized weights, numerical vertex deformation, morph movement and socket motion. Exercise procedure compilation, runtime invocation, schema rejection, revision conflict and browser tool registration. `scripts/check-*.ts` are the repository's executable checks; add the 3D check to `scripts/check.ts` and expose generation/focused checks as package scripts. Run `pnpm lint`, `pnpm test`, `pnpm build` before PR.

Defer: garment import/rendering and fit validation, arbitrary GLB upload, persistent 3D packs/compositions, engine retarget/export conformance, full VRM runtime, complete ARKit/viseme set, material variants, cloth simulation, sculpting, PNG dual representation and Mantle alpha.17. The UI must identify the shared demo and clothing deferral honestly.

Implementation and reproduction: [public/glb/README.md](../../public/glb/README.md).
