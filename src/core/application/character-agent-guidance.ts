import type { CharacterReferenceMetadata } from '../domain/character.ts'

export const CHARACTER_BACKGROUND_GUIDANCE = 'Default to a two-step workflow: generate on one solid high-contrast background color absent from the subject (for example magenta or green), filling all empty canvas areas; then remove that color with an available background-removal tool, image editor, or local image-processing CLI/library permitted by your environment. Do not assume image generation produced transparency. Keep the full canvas and subject pixels; avoid gradients, background shadows, glow, texture, and cropped edges. Verify real alpha and inspect edges on light and dark backgrounds before submitting RGBA PNG. If no permitted removal tool is available, report the blocker instead of submitting opaque artwork. AOZU never removes backgrounds.'

export const CHARACTER_NAVIGATION_GUIDANCE = 'AOZU itself handles effects.navigation in this browser tab; the agent must not repeat that navigation. Observe the resulting page after rendering, then call inspect_workspace again for fresh context. A successful tool result is not proof of visual correctness.'

export const CHARACTER_A_POSE_GUIDANCE = 'The first Appearance body establishes a front A-pose: upright torso, neutral face, arms angled down and away from the torso, relaxed visible hands, stable feet, and the complete head-to-feet silhouette inside the canvas. This is the AOZU authoring convention, not a claim of skeleton compatibility. Preserve this pose and registration in derived outfits and expressions. Existing artwork is not automatically verified A-pose; review it visually before proposing a baseline change, which can make derived layers stale.'

export const MODEL_SHEET_REVIEW = {
  requiredAfterMutation: true,
  instruction: 'View the submitted reference image and compare it with the source images before continuing. Technical acceptance does not mean user-approved canon. Correct wrong identity, viewpoint, pose, proportions, outfit details or missing parts by replacing the reference, then review again. Record newly invented or uncertain design details in notes for user review.',
  checks: ['Identity, face, ears, hair/fur and distinctive features match the source.', 'The requested viewpoint and pose are readable; left/right mean the character’s own sides.', 'Body proportions, limb lengths, outfit, accessories and colors agree across references.', 'For full-body images, check head/feet guides visually; raised hands, hats and props do not define height.'],
  comparison: 'Use visual comparison across references. Different viewpoints or poses must not be forced to overlap the Appearance silhouette; Overlay/Difference/Align and fixed-canvas alpha requirements belong to Appearance layers.',
} as const

export const CHARACTER_VISUAL_REVIEW = {
  surface: 'browser',
  modes: ['Composite', 'Overlay', 'Difference', 'Align'],
  instruction: 'These are four browser preview buttons, not four WebMCP tools. Open the exact expression, outfit, or prop variant with artwork to reveal them; use view.alignmentControls from inspect_workspace for their localized labels and current selection. Inspect a fresh screenshot after selecting each mode. Repeat after every accepted variant asset or transform before working on the next asset. Review the canonical body in the regular Composite preview because it has no variant comparison buttons. Numerical diagnostics or an applied auto-fit do not replace visual review.',
  checks: [
    { mode: 'composite', label: 'Composite', check: 'Inspect the final composition: identity, expression, neck seam, pose, prop placement, and layer order.' },
    { mode: 'overlay', label: 'Overlay', check: 'Compare the translucent reference and candidate for doubled head contours, shifted anchors, scale, and foot-line drift.' },
    { mode: 'difference', label: 'Difference', check: 'Locate unexpected changes outside the intended edit. Expression and clothing changes are expected; do not force the whole image to black or erase intentional differences.' },
    { mode: 'diagnostic', label: 'Align', check: 'Compare cyan reference and magenta candidate silhouettes, bounds, centerline, and foot line. Fit the intended anchors; props need not match the body silhouette.' },
  ],
  finish: 'Return to Composite for the final visual check. For translation or uniform-scale errors, inspect_character_contract for a fresh revision and call set_character_variant_transform with absolute x, y, scale; repeat all four checks. Regenerate or replace local deformation, wrong pose, identity drift, or bad transparency. If browser screenshots are unavailable, report visual review as incomplete.',
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
