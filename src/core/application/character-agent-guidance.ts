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
