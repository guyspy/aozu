import {
  CHARACTER_ALIGN_MODES,
  CHARACTER_GENERATION_CANVAS,
  CHARACTER_RESIZE_MODES,
  CHARACTER_RIG,
  type CharacterVariantGroup,
  type CharacterVariantLayer,
} from '../domain/character.ts'
import {
  CHARACTER_A_POSE_GUIDANCE,
  CHARACTER_BACKGROUND_GUIDANCE,
  CHARACTER_BACKGROUND_REMOVAL_PROMPT,
  CHARACTER_LAYER_GUIDANCE,
  CHARACTER_NAVIGATION_GUIDANCE,
  CHARACTER_VISUAL_REVIEW,
} from './character-agent-guidance.ts'

export type CharacterAssetLane = {
  layers: readonly CharacterVariantLayer[]
  addable: boolean
  content: string
  instruction: string
  ownership?: string
  layerOwnership?: Readonly<Partial<Record<CharacterVariantLayer, string>>>
}

/** One source of truth for every independently editable Character asset lane. */
export const CHARACTER_ASSET_LANES: Readonly<Record<CharacterVariantGroup, CharacterAssetLane>> = {
  body: {
    layers: ['body'], addable: false, content: 'canonical-body', instruction: CHARACTER_A_POSE_GUIDANCE,
  },
  expression: {
    layers: ['head'], addable: true, content: 'complete-whole-head-only', instruction: CHARACTER_LAYER_GUIDANCE.expression,
    ownership: 'All pixels outside the head are transparent; reference overlap is required.',
  },
  outfit: {
    layers: ['back', 'front'], addable: true, content: 'garment-only-transparent-overlay', instruction: CHARACTER_LAYER_GUIDANCE.outfit,
    ownership: 'Character pixels are rejected. Preserve the exact canonical canvas and registration.',
    layerOwnership: { back: 'Only parts genuinely behind the body.', front: 'Visible garment surface.' },
  },
  hair: {
    layers: ['back', 'front'], addable: true, content: 'hair-only-transparent-overlay', instruction: CHARACTER_LAYER_GUIDANCE.hair,
    ownership: 'Character pixels are rejected.',
    layerOwnership: { back: 'Hair behind the head.', front: 'Hair over the head.' },
  },
  headwear: {
    layers: ['back', 'front'], addable: true, content: 'headwear-only-transparent-overlay', instruction: CHARACTER_LAYER_GUIDANCE.headwear,
    ownership: 'Character pixels are rejected.',
    layerOwnership: { back: 'Parts behind the head.', front: 'Visible headwear.' },
  },
  prop: {
    layers: ['back', 'front'], addable: true, content: 'object-with-optional-gripping-hand-patch', instruction: CHARACTER_LAYER_GUIDANCE.prop,
    layerOwnership: { back: 'Parts genuinely behind the body.', front: 'Visible object and optional minimal gripping-hand patch.' },
  },
}

export const CHARACTER_CREATION_GROUPS = Object.entries(CHARACTER_ASSET_LANES).map(([group, lane]) => ({
  group: group as CharacterVariantGroup,
  layers: lane.layers,
  addable: lane.addable,
}))

export const CHARACTER_ASSET_PREPARATION = {
  mediaType: 'image/png',
  finalCanvas: { ...CHARACTER_RIG.canvas },
  visiblePixels: 'required',
  alpha: {
    required: true,
    websiteRemovesBackground: false,
    opaqueInput: 'reject',
    instruction: CHARACTER_BACKGROUND_GUIDANCE,
    preparation: {
      default: 'new-art-only-solid-background-then-remove',
      suppliedArt: 'Preserve requested alpha, glow and edge treatment; skip background removal for finished transparent art.',
      generateOn: 'one flat high-contrast color absent from the subject',
      avoid: ['painted checkerboard', 'cropped silhouette'],
      beforeSubmission: [
        'discover a permitted background-removal tool, image editor, or local image-processing CLI/library (for example Apple Vision foreground masking on macOS)',
        'remove the solid background without cropping or reframing',
        'verify real alpha and inspect edges on light and dark backgrounds',
        'submit genuine RGBA PNG; AOZU rejects indexed or opaque PNGs',
      ],
    },
  },
} as const

export const CHARACTER_ASSET_POLICY = {
  workflow: {
    inspectBeforeMutation: true,
    exactRevisionAndAssetSha256: 'required',
    canonicalBodyBeforeDerivedLayers: 'required',
    navigation: CHARACTER_NAVIGATION_GUIDANCE,
    visualReview: CHARACTER_VISUAL_REVIEW,
  },
  input: {
    ...CHARACTER_ASSET_PREPARATION,
    canvasEdge: { body: 'reject', expression: 'reject', outfit: 'reject', hair: 'reject', headwear: 'reject', prop: 'warning' },
  },
  lanes: CHARACTER_ASSET_LANES,
} as const

export const characterNormalizationContract = (alignAvailable: boolean) => ({
  allowed: { resize: CHARACTER_RESIZE_MODES, align: alignAvailable ? CHARACTER_ALIGN_MODES : (['none'] as const) },
  recommended: {
    resize: 'exact-aspect-downscale' as const,
    align: alignAvailable ? 'reference-visible-bounds' as const : 'none' as const,
  },
  generateAt: { ...CHARACTER_GENERATION_CANVAS },
  finalizeAt: { ...CHARACTER_RIG.canvas },
  requirements: [
    CHARACTER_BACKGROUND_GUIDANCE,
    `Default submissions must already be exactly ${CHARACTER_RIG.canvas.width}×${CHARACTER_RIG.canvas.height}.`,
    `"exact-aspect-downscale" accepts only genuine RGBA at the exact ${CHARACTER_RIG.canvas.width}:${CHARACTER_RIG.canvas.height} aspect and at least that size; it never upscales, crops, or reframes.`,
    alignAvailable
      ? '"reference-visible-bounds" fits the candidate alpha bounds onto the returned reference bounds with one uniform scale plus translation, and is rejected if it would leave the canvas.'
      : 'Alignment normalization is unavailable for this target; submit exact-canvas pixels that already match the returned geometry.',
  ],
})

export const CHARACTER_VARIANT_METADATA_TOOL_GUIDANCE = `Create or update one independently editable item before submitting pixels. If the variant does not exist, this command creates it for every addable lane when label is supplied; body/base is fixed. Required metadata is label, description and tags. Outfits also require slot and garmentType; the slot selects AOZU's coverage contract. Facial Variants use faceStyle/faceStyleId and complete expression heads. Omitted fields stay unchanged. Do not combine independently removable items without user agreement. ${CHARACTER_NAVIGATION_GUIDANCE}`

export const CHARACTER_REPLACE_ASSET_TOOL_GUIDANCE = `Replace one target-owned genuine RGBA PNG layer. First inspect_workspace, then inspect_character_contract with group, variantId and layer; create required metadata; compose on the Canonical Body and isolate only the target item on the original canvas. For new art, use this exact background-removal prompt on the isolated item: “${CHARACTER_BACKGROUND_REMOVAL_PROMPT}” Check actual alpha: a painted checkerboard is opaque RGB, so stop retrying prompts and use a real local background remover before submission. Inspect back and front separately when the item crosses the character; hanging hair behind the head, neck or shoulders belongs in back, while crown and face-overlapping strands belong in front. Preflight each PNG through inspect_character_contract candidate, then submit with the same preflightPoints for outfit, hair and headwear. Follow assetPolicy.lanes and its coverageContract; never submit the full-character working image or invent coverage percentages. Review Composite, Overlay, Difference and Align after each accepted layer. Use rebaseDerivedAssets:true only for compatible small base corrections. Accepted means stored, not visually approved. ${CHARACTER_NAVIGATION_GUIDANCE}`
