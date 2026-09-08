# AOZU

**Build layered character assets with an AI agent—in the same browser workspace.**

[Try AOZU](https://companion.aozu.workers.dev) · [The WebMCP Challenge](https://webmcp.devpost.com/)

AOZU is an agent-native character workshop. A human directs the character and reviews the result; an AI agent creates and repairs artwork; the website supplies the shared state, visual constraints, validation, and reversible editing needed to make the assets work together.

## The problem

Image models can create compelling character art, but separate generations rarely form a reliable asset pack. Expressions drift away from the face, outfits change the pose, props miss their anchors, and apparent transparency may be painted into the image.

Giving an agent only a screenshot and a mouse leaves it guessing. AOZU instead exposes the character workspace as structured WebMCP tools.

## The website is the agent harness

WebMCP does not merely automate AOZU's buttons. It turns the website into the agent's visual execution harness: a stateful workspace that provides exact references and constraints, accepts controlled mutations, renders the outcome, and keeps each change reviewable.

```text
Inspect workspace
      ↓
Read the character contract and reference artwork
      ↓
Create or repair an asset
      ↓
Validate, normalize, and stitch deterministically
      ↓
Render in the shared editor
      ↓
Human review, adjustment, undo, or export
```

| Participant | Responsibility |
| --- | --- |
| Human | Starts the character, describes the creative intent, reviews the composition, and exports the result |
| Agent | Inspects contracts, creates or repairs artwork, submits assets, adjusts alignment, and navigates the editor |
| AOZU | Owns state, revision checks, protected pixels, deterministic processing, rendering, and persistence |

The agent generates the creative pixels with its available image tools. AOZU makes those pixels compatible, safe to apply, and usable as a layered character pack.

## WebMCP workflow

AOZU exposes nine public tools on every page:

| Tool | Purpose |
| --- | --- |
| `inspect_workspace` | Discover saved characters, the current route and revision, missing required artwork, and valid next actions |
| `navigate_character` | Open the character library or an exact character category or variant without guessing a route |
| `inspect_character_contract` | Obtain allowed operations, exact hashes, placement/alignment references, ownership, dimensions, and diagnostics for one target |
| `update_character_profile` | Update a character's name, description, multiline backstory, or scalar attributes against its exact revision |
| `replace_character_asset` | Install one complete body, head, outfit skin, or prop layer without preserving old pixels |
| `repair_character_asset` | Mask-repair an existing expression against its exact asset hash |
| `set_character_variant_transform` | Apply an explicit translation and uniform scale when a generated layer needs a small alignment correction |
| `undo_character_change` | Undo the latest settled change in the active editing session |
| `redo_character_change` | Redo the most recently undone change in the active editing session |

Successful tool calls can also return navigation effects, so the SPA takes the human directly to the affected character or variant for visual review.

## Deterministic safety boundary

Creative generation is probabilistic; accepting an asset does not have to be.

- Character revisions prevent stale agents or tabs from overwriting newer work.
- Source SHA-256 hashes bind repairs to the exact pixels the agent inspected.
- Inputs are checked for dimensions, genuine RGBA transparency, visible bounds, and canvas overflow.
- The workspace contract tells agents up front that expressions are whole heads and outfits are complete dressed character skins compatible with the canonical pose.
- Expression repairs are stitched into the inspected head; outfit replacements never preserve old pixels.
- Normalization happens only when the submission explicitly requests a supported deterministic operation.
- Invalid candidates are rejected instead of being silently reframed or accepted.
- Accepted changes are saved locally and opened in the editor for review.

AOZU deliberately does not generate images, infer missing transparency, recover painted checkerboards, or guess arbitrary geometry inside the website. Those boundaries keep the asset pipeline inspectable.

## Character packs

Characters are stored locally in IndexedDB and can be duplicated, edited, deleted, or exported without an account. A character ZIP contains:

- the editable full-canvas PNG source assets;
- `character-pack.json` with composition and registration metadata;
- a trimmed, lossless WebP texture atlas when the current layers can be compiled;
- TexturePacker/Pixi-compatible atlas JSON; and
- enough data to import the character back into AOZU.

The editor and thumbnails render from the same compiled atlas used by the export path.

## Architecture

```text
Human UI ─┐
          ├── Application / Mantle contracts ── IndexedDB
WebMCP ───┘                 │
                            └── validation, stitching, atlas rendering
```

- **Mantle** is the single source of truth for procedures, schemas, and the public capability catalog.
- A thin **WebMCP adapter** projects public Mantle procedures into browser tools and dispatches calls back through the same runtime.
- The **React SPA** and WebMCP tools share application and domain behavior rather than maintaining parallel business logic.
- **IndexedDB** keeps character metadata and image blobs browser-local.
- **PixiJS** renders trimmed atlas frames while preserving their registered placement.
- **Cloudflare Workers Static Assets** hosts the deployed SPA.

The dependency direction stays inward:

```text
UI / WebMCP → Application → Domain
                         ← ports ← IndexedDB / ZIP
```

## Run locally

Requirements: Node.js 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

Then open the local URL in ChatGPT's in-app browser or another WebMCP-compatible browser. The header reports whether the nine tools are ready.

```bash
pnpm lint
pnpm test
pnpm build
```

## Competition scope

This build focuses on stable character creation, visual editing, agent-assisted asset repair, and portable character packs. Story experiences are intentionally locked for this release and shown as coming soon.

Architecture decisions are recorded in [`docs/adr/`](./docs/adr/).

## License

Licensed under the [Apache License 2.0](./LICENSE).

### Game-ready 3D spike

The **2D | 3D** toggle previews a bundled skinned Viking GLB in the character
editor and shared viewports. Workshop slots select expressions, armor, helmet
and weapons; the preview controls animation, pose seeking and **Bones**.
The PNG/Pixi workshop remains independent. This shared tab-local demo does not
convert or persist the selected character. Library cards show static poses;
interactive viewers animate only while visible and playing.

Two additional Mantle/WebMCP procedures, `inspect_3d_character` and
`configure_3d_preview`, inspect/configure this demo with revision checks.
See the [research and deferred scope](docs/research/3d-character-standards-and-webmcp.md)
and [fixture license and reproduction](public/glb/README.md).
Run `pnpm generate:glb` to regenerate the CC0 fixture, `pnpm check:3d` for focused
checks, and `pnpm lint`, `pnpm test`, `pnpm build` for all required gates.
