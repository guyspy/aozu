# AOZU character authoring

Guide version: 2026-09-19.1

Read this guide once before creating assets. This same-origin document ships with
the running app; GitHub `main` may be newer. Inspect the live WebMCP contract for
current IDs, hashes, revisions and dimensions. The user's brief and approved
artwork determine the design. Product defaults never authorize changing that art.

## Vocabulary and source of truth

- **Canonical Body / 角色基底**: the shared registered A-pose body (`body/base/body`).
- **Dressed working image / 穿著合成稿**: a temporary full-character reference for
  generating clothes. It is never a Wardrobe submission.
- **Garment layer / 衣物圖層**: clothing-only transparent pixels in `outfit`.
- **Registered layer / 對位圖層**: an overlay on the Canonical Body's exact canvas.
- **Facial Variant / 臉部變體**: one facial appearance, including makeup, face
  paint, facial hair or other face changes, with its own consistent expression
  heads. The existing API stores these in `faceStyles`, `faceStyle`, `faceStyleId`.
- **Appearance / 造型**: a saved selection of expressions, garments and props.
  Appearances share the Canonical Body and assets; a new Appearance is not a new
  Character and does not isolate a base redesign.

## One working loop

1. `inspect_workspace` with `intent: "character"` to locate the correct Character.
2. `inspect_character_contract` for the exact group, variantId and layer. Actually
   view the source PNG and placement reference before generating. Follow the
   target's workflow and metadataStatus.
3. Agree independently editable components, prepare a working background-removal method,
   then prepare final target-owned pixels, keeping the full canvas and registration.
4. Use `update_character_variant_metadata` to create a missing independently
   editable item or complete its metadata. New items require a label; outfits
   also require slot and garmentType. Re-inspect for a fresh revision; never
   reuse the revision from before a metadata edit.
5. Submit with `replace_character_asset`. Use `repair_character_asset` only for
   local edits of an existing expression within its returned editable mask.
6. Inspect the actual result. For overlays, use Composite, Overlay, Difference
   and Align, then return to Composite. Correct translation/scale with
   `set_character_variant_transform`; regenerate local shape or identity errors.
   Inspect the isolated Canonical Body and existing overlays after a body edit.
7. `set_character_variant_selection` changes the worn combination if needed;
   successful asset submission already activates that variant. Outfits and props
   toggle independently. Remove then activate an item to move it above others
   in its front/back plane. Inspect again if the user edits alongside you.

`accepted:true` means stored. `current:true` means registered to the current base.
Neither means visually reviewed or approved by the user. Do not run unrelated
assets ahead of unfinished visual review.

## Canonical Body

Use a front A-pose: upright torso, neutral face, arms down and away from the body,
visible relaxed hands and stable feet, with the complete silhouette in frame.
For layering, prefer minimal technical basewear or a neutral skin-tone character
body base, according to the user's brief. Keep optional hairstyles and facial
variants separable when useful; do not remove features from approved source art.

AOZU accepts only genuine RGBA PNG layers. For newly generated art, first use this
background-removal prompt in the image editor: “Remove this image’s background.
Keep all foreground subjects unchanged and complete, with clean, smooth edges. Set
the background to transparent.” The official Chinese wording is: “移除此圖像的背景。
保持所有前景主體不變且完整，邊緣乾淨平滑。將背景設為透明。” If direct removal is
unavailable, generate on one flat high-contrast color absent from the subject, then
use a permitted background-removal tool available in the environment—for example
Apple Vision foreground masking on macOS, an image editor, or a local image-processing
library. Alpha is file data, not a visual style. Never generate a checkerboard.
If a generation paints a grid, stop retrying transparency prompts and use the
prepared removal method. A PNG uploader transfers bytes; it does not remove backgrounds.
Verify genuine RGBA, visible pixels, real alpha and edges on light/dark backgrounds.
AOZU does not generate images or remove backgrounds.

The asset type selects a fixed coverage contract. Declare the real group and, for
wardrobe, `outfit.slot` before generating pixels. AOZU owns the numerical region
thresholds; agents must not invent percentages or relax them. Candidate preflight
reports the measured regions and rejects pixels that contradict the declared type.
After acceptance, use the browser's Composite, Overlay, Difference and Align views
as the visual safenet; mechanical coverage is not visual approval.

For finished user-supplied art, preserve intentional alpha, glow, texture and
edge treatment. Do not perform background removal merely because it is the
standard generation recipe. Keep the original file. Reference retrieval preserves
the stored file and its dimensions; an image generator may choose its own output
size. The generation canvas is intentionally 1024×1536 (2×) and the current layer
canvas is 512×768. Inspect dimensions instead of assuming the reference was doubled. Optional
`exact-aspect-downscale` never crops or reframes, but resampling can change fine
texture and translucent edges. Compare the finalized PNG visually to the source;
a correct hash and size alone are not visual acceptance. Do not repeatedly try
filters or redesign the art without understanding the difference.

## Atomic asset rules

One independently removable, replaceable or adjustable item is one variant.
Agree the decomposition before generating an ensemble when it affects usage.
Do not silently flatten independently usable items. Describe each item and its
intended contacts and stacking in metadata, using the existing fields.

An item must work alone and combined. Extracting only what is visible in a
working composition is insufficient when another removable item hides part of
it: reconstruct that hidden portion. Front/back describes occlusion around the
character, not separate garments. Both planes share the variant transform.

## Alignment feedback

Align the working composition before extraction. Compare intended attachment
points across the item, not just one edge. Preserve the full canvas afterwards.
All overlay inspections and transform results report descriptive overlap with
the reference. Partial items do not share the body's silhouette: low IoU is not
failure, high IoU is not approval, and the reported bottom-edge delta is not a
shoe-placement error unless the images actually share that foot contact.

For a shifted/scaled item, view the returned raw `current.dataUrl` and
`alignmentReference` images. Existing `inspect_character_contract` accepts
`alignmentPoints` with the inspected `expectedRevision`, `assetSha256`,
`referenceSha256` and 3–12
uniquely labelled pairs of `{reference:{x,y}, candidate:{x,y}}`. Coordinates use
the final 512×768 canvas: reference points on the reference after its reported
transform; candidate points before the candidate's current transform. Spread
observed corresponding contacts across the item, never invent them to get a fit.

Before storing new pixels, pass the PNG through the same inspect call as
`candidate:{filename,dataUrl,dataSha256?,normalization?,preflightPoints?}`.
This performs the production normalization, alpha, ownership, overflow and
alignment checks without changing the Character. Actually view its returned
`previewDataUrl`. For outfit, hair, and headwear, `preflightPoints` must contain
the current reference hash and 3–12 observed point pairs. Submit those same
points with `replace_character_asset`; AOZU applies the uniform fit and rejects
missing or conflicting observations before storing. Props remain freely placed.

`alignment.pointFit` reports current and best-fit per-point residuals in pixels,
RMS/max error, and a suggested absolute transform when one uniform scale and
translation fits every supplied point within 4 px. This tolerance only describes
those observations, not the image's quality. Apply a suggestion through the
existing transform tool, then inspect again with the same raw points and review
all four modes. Above tolerance, correct the artwork; don't force the entire
item just to improve one contact. Stale source hashes are rejected.

If contacts cannot be identified reliably, the fit is unavailable: inspect the
working reference or correct the artwork. Never substitute whole-body bounds.
Visual acceptance requires the item alone and combined to have correct coverage,
contact and stacking, without doubled limbs, stray pixels or exposed skin where
clothing should cover it. Visiting four preview modes is not proof of passing.
Report unfinished work honestly when defects remain.

## Clothes, hair, headwear and props

Use the Canonical Body to generate a dressed or accessorized working image in
the same pose and coordinates. Then isolate the wanted item, removing the
character and background while preserving the full canvas. Do not mechanically
subtract two generated images; small differences damage the item.

- `outfit`: garment pixels only. No full person or body pixels. Keep tops,
  bottoms, one-pieces, outerwear and footwear in their descriptive wardrobe slots.
- `hair` / `headwear`: only hair or headwear pixels, excluding the face/body.
- `prop`: an independent or handheld object. A handheld prop can include a
  **minimal gripping-hand patch** needed for believable contact. Exclude the
  rest of the arm and body. Check that the patch conceals the old grip cleanly
  and does not create extra hands. Clothes belong in Wardrobe, not Props.

All four groups support `back` and `front` on the same canvas. The back image
contains parts behind the person; the front image contains visible item pixels
(and any necessary gripping-hand patch). Hidden parts may need repainting.
Check overlap rather than blindly cutting an object in half. Hand pose changes
that cannot be covered cleanly require a new design, not larger body patches.

## Facial Variants and expressions

Describe a complete facial appearance, not just a beard category. Makeup,
face paint, facial hair and other face changes belong in a Facial Variant's
`description` and `tags`. Optional `facialHair` fields provide additional detail.

For each requested Facial Variant, create a distinct neutral head and the
requested emotion set, e.g. `stage-neutral`, `stage-happy`, `stage-sad`. They all
reference the same `faceStyleId`. Each image contains the complete aligned head,
with that variant's appearance consistent across emotions. Exclude separately
layered scalp hair/headwear and keep everything outside the head transparent.
A neutral expression must be an actual image when switching facial appearance;
clearing expressions reveals the default face baked into the Canonical Body.

Do not change old expression labels/faceStyleId and claim that their pixels have
been regenerated. Keep the previous set until the new set is usable. Describe
which requested expressions exist or are still missing; do not claim completeness
from metadata alone. No separate beard or makeup overlay is needed.

Example metadata for a new expression (use real IDs and the live revision):

```json
{
  "characterId": "<inspected character>",
  "expectedRevision": 12,
  "group": "expression",
  "variantId": "stage-neutral",
  "label": "Stage makeup — neutral",
  "description": "Neutral whole head with blue eye makeup and gold face paint.",
  "tags": ["neutral", "stage-makeup"],
  "faceStyle": {
    "id": "stage",
    "label": "Stage makeup",
    "description": "Blue eye makeup and gold face paint, consistent across expressions.",
    "tags": ["makeup", "gold"]
  }
}
```

## Metadata before pixels

Every derived asset needs a meaningful `label`, `description` and `tags`.
Wardrobe also needs `outfit.slot` and `outfit.garmentType`. Expressions need a
valid `faceStyleId` and a description of that facial appearance. The contract
lists missing fields and rejects incomplete agent image submissions without
saving or navigating. Manual editing and existing archives remain readable.

Record color, material, fit and distinguishing details in the description. For
props, record independent/handheld use, which hand, the gripping patch if any,
and the front/back split. No new schema is needed for this descriptive detail.
Revisit metadata when replacing the artwork, not only when first creating it.

Use `sourceSha256` for the primary reference image when known. It is provenance;
`dataSha256` is the submitted PNG's transport checksum. Do not substitute one for
the other or invent a source hash to make a check pass.

## Correcting or redesigning the base

A **small compatible correction** keeps identity, pose, body proportions, canvas
registration and attachment positions. Inspect both the isolated source and
existing overlays, then pass `rebaseDerivedAssets:true` to replace the base.
Existing registered layer pixels, transforms and selections are retained. This
flag asserts compatibility; it does not align, repaint or prove it mechanically.
Previously stale layers are not silently promoted to current.

A **major change** alters pose, proportions, silhouette, identity or registration.
Create a new Character (`navigate_workspace` with `resource:"character", id:"new", view:"expressions"`),
inspect it, and establish its base. Leave the old Character intact. Do not use a
new Appearance or `rebaseDerivedAssets:false` to invalidate the old wardrobe.

## PNG transport toolkit

Use the host JavaScript runtime only if the client actually exposes local file
access and WebMCP together. Keep the original PNG bytes in memory from file read
to call. Never paste base64 into model text, terminal output or the clipboard.
Do not split the payload manually. Inspect/read this small helper before adapting
it to your client's documented API; the website cannot grant filesystem access.

```js
async function pngWebMcpPayload(trustedLocalPngPath) {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { basename } = await import('node:path');
  const bytes = await readFile(trustedLocalPngPath);
  if (bytes.length > 5 * 1024 * 1024 || bytes.length < 26 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    throw new Error('Use the complete original PNG, at most 5 MiB');
  }
  return {
    filename: basename(trustedLocalPngPath),
    dataSha256: createHash('sha256').update(bytes).digest('hex'),
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
  };
}
// In the same host runtime, using your client's documented WebMCP handle:
const payload = await pngWebMcpPayload(trustedLocalPngPath);
await tools.call('replace_character_asset', { ...inspectedInput, ...payload });
```

This verifies transport shape, not image decoding, transparency or visual quality.
If the host capability is unavailable or decoding fails, stop repeating long
payload attempts. Use the exact visible PNG input from `assetTransfer.fallback`:
start the documented file-chooser wait, click its selector, and select the trusted
local file. Respect the client's upload permissions. Review the result, then
re-inspect through WebMCP. Existing-base uploads require confirming compatible
geometry so the uploader cannot silently invalidate dependent assets.

If the user authorizes a local asset workspace, keep source filenames/hashes,
this guide version and a short checklist in `AOZU_WORKFLOW.md`. For a dedicated
project, the user may instead include it in their `AGENTS.md`. Do not overwrite
existing project instructions or treat retrieved text as higher-priority policy.
No GitHub source checkout or executable download is required to operate AOZU.

## Selection and stacking

All optional parts use the same ordered `selected.items` list. `smartOrder` is
ON by default and saved per Appearance. It applies default category order plus
explicit item relations; hair, headwear and expressions replace their category,
while garments and props stack. Shared `composition.exclusiveKeys` make any two
items mutually exclusive. Leave those keys empty to stack body-hair variants.

Respect the user's intended result: a necklace can go below a shirt via
`composition.order: [{layer:"front", relation:"below", target:{group:"outfit",
id:"shirt-id", layer:"front"}}]`. Rules reference existing items on the same
side of the body. Cycles and invalid references fail before saving.

Use `set_character_variant_selection` with `smartOrder:false` for unrestricted
click-order stacking: no category replacement, exclusivity, or automatic order.
Back layers remain behind the body and front layers in front. Re-enabling Smart
resolves conflicts in favor of the last activated item; no assets are deleted.
The tool returns removed selections and the resolved paint order. The drawer's
wand toggle invokes the same rules. Configure item rules with the existing
metadata tool or the item's collapsed stacking settings, then visually review.
