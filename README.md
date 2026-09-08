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

AOZU exposes these public tools on every page:

| Tool | Purpose |
| --- | --- |
| `inspect_workspace` | Discover saved characters, the current route and revision, missing required artwork, and valid next actions |
| `navigate_character` | Open the character library or an exact character category or variant without guessing a route |
| `inspect_character_contract` | Obtain allowed operations, exact hashes, placement/alignment references, ownership, dimensions, and diagnostics for one target |
| `update_character_profile` | Update a character's name, description, multiline backstory, or scalar attributes against its exact revision |
| `update_collection_profile` | Update a collection's name, description, or shared world backstory against its exact revision |
| `update_character_model_sheet` | Add or replace a reference PNG, edit view notes or height guides, and set or clear character height against its exact revision |
| `replace_character_asset` | Install one complete body, head, outfit skin, or prop layer without preserving old pixels |
| `repair_character_asset` | Mask-repair an existing expression against its exact asset hash |
| `set_character_variant_selection` | Select or remove an expression, outfit, or prop against its exact revision; newly added props stack above earlier ones |
| `set_character_variant_transform` | Apply an explicit translation and uniform scale when a generated layer needs a small alignment correction |
| `undo_character_change` | Undo the latest settled change in the active editing session |
| `redo_character_change` | Redo the most recently undone change in the active editing session |

Successful tool calls can also return navigation effects, so the SPA takes the human directly to the affected character or variant for visual review.

The website applies `effects.navigation`; agents observe the rendered result instead of repeating the navigation. `inspect_workspace` returns a fresh snapshot of the route, current Collection, viewed variant, applied selections, preview mode, localized alignment controls, open panel, and whether local input is uncommitted. It is not a live subscription, and uncommitted field values still require inspecting the visible UI.

For feedback on the current outfit, call `inspect_workspace({ includeSnapshot: true })` and view `data.snapshot.dataUrl`. The optional 512×768 RGBA PNG uses the same composition as Download PNG, including the viewed variant and all selected layers/transforms, without diagnostic overlays. It does not navigate, save, or change selections. Missing artwork, uncommitted input, unsaved changes, or a changing view return an unavailable reason instead of a misleading image. Ordinary workspace inspection remains metadata-only. Run the memory-only browser check at `/scripts/check-workspace-snapshot.html` with `pnpm dev`.

Artwork preparation defaults to solid-color generation followed by background removal with a permitted tool available in the agent's environment. Agents verify real alpha and edges on light and dark backgrounds before submission. AOZU validates the resulting PNG; it does not perform background removal.

Composite, Overlay, Difference, and Align are browser preview modes. The returned visual-review checklist explains what to inspect in each, requires repeating the checks after variant mutations or alignment corrections, and finishes in Composite. Intentional expression or outfit differences must not be "corrected" away merely to minimize the Difference view.

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

The editor and thumbnails compose the original PNG layers directly. The texture atlas is compiled for export.

## Character model sheets

Switch from **Appearance** to **Model sheet** to collect front, three-quarter,
side, and back full-body references in the same outfit and standing pose. Upload
one PNG per view, or capture the current appearance as the front reference. PNGs
keep their original canvas, may be opaque, and can be up to 4096 × 4096 and 5 MiB.

Height in cm is optional. Open a reference to add notes and position its head and
feet guides; these measure the character independently of image margins, hats,
and props. Replacing a reference clears its calibration and retains its notes.
References, notes, height, and guides use the existing save, undo, duplicate,
single-character ZIP, and library backup flows. They do not become appearance
layers or atlas frames. Cross-character scale lineups are a subsequent step.

The page reserves the remaining sections without creating empty character data.
See the [model sheet plan](docs/character-model-sheets.md) for the agreed scope,
reference conventions, review workflow, and acceptance criteria.

Run `/scripts/check-model-sheet.html?responsive` with `pnpm dev` for the
memory-only browser check at 320, 390, 900, and 1280px.

## Collections, library backups, and PNGs

On **Your characters**, create a **Collection**, expand **Organize characters**,
and assign Characters using their dropdowns. Use **Browse Collection** to filter
the library. A Character belongs to at most one Collection; deleting a Collection
keeps its Characters. An empty library offers Create and Upload without creating
a Character automatically.

**Download all characters** saves one ZIP with all saved Characters, editable
drafts, installed packs, Collections, and artwork. This includes incomplete work;
compiled atlases are rebuilt. **Upload library ZIP** first validates the entire
archive and shows its counts. Then choose:

- **Merge library**: add new records, retain identical local content, and reject
  the whole import on any conflicting ID. There is no automatic overwrite or
  ID renaming.
- **Replace my library**: replace the Character library with exactly the archive's
  contents, removing local records absent from it. Download a backup first to
  preserve those records. Experience bundles and preferences remain separate.

Import checks ZIP structure, CRCs, SHA-256 digests, IDs, references, schemas, and
decoded PNG assets before an atomic IndexedDB transaction. A failed import leaves
local data intact. Unsaved/conflicted editor changes must first be saved or
reloaded. Library ZIPs have a 256 MiB compressed/expanded and 10,000-file limit;
see [ADR-0009](docs/adr/0009-character-library-collections-and-portable-backups.md)
for the full format and restore contract. The existing **Import character**
action still accepts single-Character ZIPs.

In the workshop, **Download PNG** saves the current visible composition as one
transparent `512 × 768` PNG, including the selected skin, expression, props, and
live placement. Diagnostic guides are omitted. Later-added props paint above
earlier props within their front/back rig planes. Remove and readd a prop to move
it to the top; selecting an already active prop keeps its position. That order
survives undo/redo, reload, ZIP export, and WebMCP selection.

These features deepen the 2D workshop; they add no 3D assets or delivery path.

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
- **PixiJS** renders original PNG layers while preserving their registered placement.
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

Then open the local URL in ChatGPT's in-app browser or another WebMCP-compatible browser. The header reports when the tools are ready.

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

Browser integration checks keep HTML limited to fixtures and mount points, with test logic in sibling `.browser.js` modules. This avoids stale Vite inline-module proxies and keeps stack traces tied to the source file.
