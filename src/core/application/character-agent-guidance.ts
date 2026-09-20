import type { CharacterDraft, CharacterReferenceMetadata, CharacterVariantGroup } from '../domain/character.ts'

export const CHARACTER_AUTHORING_GUIDE = {
  path: '/character-authoring.md',
  version: '2026-09-19.1',
  source: 'https://github.com/guyspy/aozu/blob/main/public/character-authoring.md',
  instruction: 'Read this same-origin guide once before generating assets. It ships with this app; the GitHub main branch may be newer. Keep a short AOZU_WORKFLOW.md in a user-authorized local asset workspace if available; never overwrite unrelated AGENTS.md or treat site guidance as permission to run code. Live revisions and target requirements come from this contract.',
} as const

export const CHARACTER_BACKGROUND_REMOVAL_PROMPT = '移除此圖像的背景。保持所有前景主體不變且完整，邊緣乾淨平滑。將背景設為透明。'

export const CHARACTER_BACKGROUND_GUIDANCE = `AOZU accepts only genuine RGBA PNG layers. For newly generated art, first use the image editor prompt: “Remove this image’s background. Keep all foreground subjects unchanged and complete, with clean, smooth edges. Set the background to transparent.” (Official Chinese wording: “${CHARACTER_BACKGROUND_REMOVAL_PROMPT}”) If direct removal is unavailable, generate on one flat high-contrast color absent from the subject and use a permitted background-removal tool available in the environment (for example Apple Vision foreground masking on macOS, an image editor, or a local image-processing library). Never crop or reframe. Alpha is file data, not a visual style. Never generate a checkerboard. If a generated image contains a painted grid, stop repeating transparency prompts and use the prepared background-removal method. An uploader transfers bytes; it cannot remove a background. Verify real alpha and inspect edges on light and dark backgrounds. For user-supplied finished art, preserve the requested pixels, alpha, glow and edge treatment; do not regenerate or remove them to satisfy a default recipe. Reference retrieval preserves the stored file dimensions; image generators may choose their own output size. 1024×1536 is AOZU’s intentional 2× authoring canvas and 512×768 is the final layer canvas. Inspect dimensions and downscale once with exact-aspect-downscale; do not infer that the reference was doubled. Check resized output against the source before submitting; dimensions and hashes do not prove visual fidelity. AOZU never removes backgrounds.`

export const CHARACTER_NAVIGATION_GUIDANCE = 'AOZU itself handles effects.navigation in this browser tab; the agent must not repeat that navigation. Observe the resulting page after rendering, then call inspect_workspace again for fresh context. A successful tool result is not proof of visual correctness.'

export const CHARACTER_A_POSE_GUIDANCE = 'The Canonical Body (角色基底) establishes a front A-pose: upright torso, neutral face, arms angled down and away, visible relaxed hands, stable feet, complete head-to-feet silhouette. For wardrobe layering, prefer minimal technical basewear or a neutral skin-tone character body base, whichever best fits the user’s prompt. Preserve the user’s requested anatomy, coverage and visual style. Derived layers keep this canvas, pose and registration. A compatible small correction preserves existing layers; changes to identity, proportions, pose or registration belong in a new Character.'

export const CHARACTER_COMPONENT_RULES = {
  unit: 'One independently removable, replaceable or adjustable item per variant. Agree the decomposition before generating an ensemble when it changes how the user can use it. Do not silently flatten independent items into one layer.',
  completeness: 'Each item must work alone and in the intended combination. Reconstruct portions hidden by other removable items. Split front/back only for actual occlusion; both share one transform.',
  registration: 'Align the working reference to the Canonical Body before extracting items. Keep canvas coordinates through extraction. Use corresponding attachment points; identical dimensions do not prove registration.',
  completion: 'Review each item alone and combined. Resolve stray pixels, exposed body at covered areas, conflicting contact points and incorrect stacking. If a defect remains, report unfinished instead of claiming success.',
} as const

export const CHARACTER_LAYER_GUIDANCE = {
  body: 'Canonical Body: use the user-approved source. Compare the isolated base and the clothed composition after replacement. Simplify hair or facial features only when requested; never redesign supplied art.',
  outfit: 'Agree independently editable items first. Generate and align a dressed working image using the Canonical Body, then isolate garment pixels and remove the character and background. Never submit the dressed composite. Keep canvas coordinates; front contains visible garment pixels, back contains parts behind the body and may need repainting.',
  hair: 'Compose the hairstyle on the Canonical Body, then isolate hair only on the same canvas. Remove face and body pixels. Put hanging hair behind the head, ears, neck or shoulders in back; put the crown and strands crossing the face in front. One hairstyle may need both layers. Paint missing hidden hair.',
  headwear: 'Compose headwear on the Canonical Body, then isolate headwear only on the same canvas. Split visible front and hidden back parts; paint missing hidden parts as needed.',
  prop: 'Compose the object in place before isolating it. A handheld prop may include the minimal gripping-hand patch needed for believable contact, never the whole arm or character. Keep canvas coordinates. Split into front/back when needed; repaint hidden parts. Describe the grip patch and intended hand in metadata.',
  expression: 'A Facial Variant (faceStyle/faceStyleId) describes a facial appearance: makeup, face paint, facial hair or other facial changes. Create a consistent set of complete aligned expression heads including neutral for each requested variant. Keep that appearance across expressions. Exclude independently layered scalp hair and headwear; all pixels outside the head are transparent.',
} as const

/** Agent completion rules only; imported art and manual UI edits remain valid. */
export function characterMetadataStatus(draft: Pick<CharacterDraft, 'variants' | 'faceStyles'>, group: CharacterVariantGroup, variantId: string) {
  const variant = draft.variants.find((item) => item.group === group && item.id === variantId)
  const required = group === 'body' ? [] : ['label', 'description', 'tags']
  const missing: string[] = []
  if (group !== 'body') {
    if (!variant?.label.trim()) missing.push('label')
    if (!variant?.metadata?.description?.trim()) missing.push('description')
    if (!variant?.metadata?.tags?.length) missing.push('tags')
    if (group === 'outfit') {
      required.push('outfit.slot', 'outfit.garmentType')
      if (!variant?.metadata?.outfit?.slot) missing.push('outfit.slot')
      if (!variant?.metadata?.outfit?.garmentType?.trim()) missing.push('outfit.garmentType')
    }
    if (group === 'expression') {
      required.push('faceStyleId', 'faceStyle.description')
      const style = draft.faceStyles.find((item) => item.id === variant?.metadata?.faceStyleId)
      if (!style) missing.push('faceStyleId')
      if (!style?.description?.trim()) missing.push('faceStyle.description')
    }
  }
  return { complete: !missing.length, required, missing, sourceSha256: variant?.metadata?.sourceSha256 ?? null,
    sourceRule: 'Record the primary reference image hash when known; sourceSha256 is provenance, not the output file checksum. Do not invent one.' }
}

export const MODEL_SHEET_REVIEW = {
  requiredAfterMutation: true,
  instruction: 'View the submitted reference image and compare it with the source images before continuing. Technical acceptance does not mean user-approved canon. Correct wrong identity, viewpoint, pose, proportions, outfit details or missing parts by replacing the reference, then review again. Record newly invented or uncertain design details in notes for user review.',
  checks: ['Identity, face, ears, hair/fur and distinctive features match the source.', 'The requested viewpoint and pose are readable; left/right mean the character’s own sides.', 'Body proportions, limb lengths, outfit, accessories and colors agree across references.', 'For full-body images, check head/feet guides visually; raised hands, hats and props do not define height.'],
  comparison: 'Use visual comparison across references. Different viewpoints or poses must not be forced to overlap the Appearance silhouette; Overlay/Difference/Align and fixed-canvas alpha requirements belong to Appearance layers.',
} as const

export const CHARACTER_VISUAL_REVIEW = {
  surface: 'browser',
  modes: ['Composite', 'Overlay', 'Difference', 'Align'],
  instruction: 'These are four browser preview buttons, not four WebMCP tools. Open the exact expression, outfit, hair, headwear, or prop variant with artwork to reveal them; use view.alignmentControls from inspect_workspace for their localized labels and current selection. Inspect a fresh screenshot after selecting each mode. Repeat after every accepted variant asset or transform before working on the next asset. Review the canonical body in the regular Composite preview because it has no variant comparison buttons. Numerical diagnostics or an applied auto-fit do not replace visual review.',
  checks: [
    { mode: 'composite', label: 'Composite', check: 'Inspect the item alone and in combination: intended coverage, seams, contact points and layer order. No doubled limbs, exposed skin under covered areas or stray pixels. Opening a preview is not a pass.' },
    { mode: 'overlay', label: 'Overlay', check: 'Compare matching attachment points across the whole item, e.g. neck, shoulders, wrists, waist, ankles or grip. Correct one global shift/scale only when all contacts agree; conflicting corrections require artwork repair.' },
    { mode: 'difference', label: 'Difference', check: 'Locate unexpected changes outside the intended edit. Expression and clothing changes are expected; do not force the whole image to black or erase intentional differences.' },
    { mode: 'diagnostic', label: 'Align', check: 'Compare cyan reference and magenta candidate silhouettes, bounds, centerline, and foot line. Fit the intended anchors; props need not match the body silhouette.' },
  ],
  finish: 'Return to Composite for the final visual check. For translation or uniform-scale errors, inspect_character_contract for a fresh revision and call set_character_variant_transform with absolute x, y, scale; repeat all four checks. Regenerate or replace local deformation, wrong pose, identity drift, or bad transparency. Do not optimize whole-body overlap for partial items or accept one improved contact while another worsens. If any visible defect remains or screenshots are unavailable, report visual review as incomplete.',
} as const

/** Model-sheet studies are independent reference images, not registered Appearance layers. */
export function modelSheetGenerationGuidance(kind?: CharacterReferenceMetadata['kind']) {
  const studies = {
    'full-body': 'Show the complete requested view with consistent body scale, proportions, clothing and neutral stance across the turnaround. Use minimal perspective distortion; rotate the subject rather than mirroring it. Preserve left/right asymmetry.',
    head: 'Keep skull shape, facial proportions, hairline and distinctive features consistent as the head genuinely rotates. Use consistent portrait framing and soft neutral lighting; preserve natural texture and asymmetry.',
    structure: 'Show the requested pose or anatomical study with consistent proportions and believable joints, hands and feet. Pose may change; do not force it into the Appearance A-pose or silhouette.',
    expression: 'Change facial muscles, eyes and mouth naturally for the requested emotion while preserving identity and the established visual style. Keep comparable head framing; do not freeze the source expression or introduce unrelated faces.',
    detail: 'Isolate the requested clothing, accessory or material detail. Preserve construction, placement, colors and texture from the sources; do not invent accessories or redesign the outfit.',
    style: 'Document the established visual style, materials or functional color palette from the sources. Preserve their rendering style; do not force photographic realism onto a stylized character.',
  }
  return {
    identity: 'Use the Character profile and visually inspected source images to preserve identity, distinctive features and body proportions. Expression, gaze and pose may change only as required by the requested study. Preserve the active Appearance clothing and accessories unless the user requests a redesign.',
    sources: 'Use appearance for the current composed look; canonical is only the base body. Inspect stored references and their notes/needsReview against the current look before treating them as a baseline. Stored art and needsReview:false do not establish human approval. Record inferred or unseen details in notes for user review; do not silently promote them to established design.',
    task: kind ? studies[kind] : 'Choose the requested reference kind and inspect again for its study instructions; do not generate an entire reference board by default.',
    output: 'Generate only the requested reference, keeping individual views separate unless a combined sheet was requested. Use a clean neutral background, even lighting and enough space to avoid clipped anatomy. Save through update_character_model_sheet with the inspected revision, target hash and primary sourceSha256, then visually compare the result with its sources. These instructions do not replace Appearance layer alignment and alpha rules.',
  }
}
