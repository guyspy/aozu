import assert from 'node:assert/strict'

import {
  fitCharacterBoundsTransform,
  inspectCharacterAssetOwnership,
  measureCharacterMaskAlignment,
  planCharacterAlignment,
  planCharacterResize,
  suggestCharacterFit,
  type CharacterAlphaMask,
} from '../src/core/application/character-alignment.ts'
import { characterAssetInspectionRejection, validateCharacterAssetInspection } from '../src/core/application/character-creation.ts'
import { CHARACTER_GENERATION_CANVAS, CHARACTER_RIG } from '../src/core/domain/character.ts'

const canvas = CHARACTER_RIG.canvas
const bounds = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const inspected = (width: number, height: number, genuineRgba = true) => ({ width, height, genuineRgba })
const rejection = (result: ReturnType<typeof planCharacterResize> | ReturnType<typeof planCharacterAlignment>) => {
  assert.equal(result.ok, false)
  return result as { ok: false; code: string; message: string }
}

// The generation size is the rig canvas doubled, so the offered downscale is always exact.
assert.deepEqual(CHARACTER_GENERATION_CANVAS, { width: canvas.width * 2, height: canvas.height * 2 })

// Exact-canvas submissions are untouched whether or not normalization is requested.
assert.deepEqual(planCharacterResize('none', inspected(canvas.width, canvas.height)), { ok: true, scale: null })
assert.deepEqual(planCharacterResize('exact-aspect-downscale', inspected(canvas.width, canvas.height)), { ok: true, scale: null })

// A genuine-RGBA generation-size candidate downscales onto the exact canvas only when it is requested.
assert.deepEqual(
  planCharacterResize('exact-aspect-downscale', inspected(CHARACTER_GENERATION_CANVAS.width, CHARACTER_GENERATION_CANVAS.height)),
  { ok: true, scale: 0.5 },
)
assert.deepEqual(planCharacterResize('exact-aspect-downscale', inspected(768, 1152)), { ok: true, scale: 0.6667 })
// Without the request the oversized candidate is left alone, and strict inspection rejects it.
assert.deepEqual(planCharacterResize('none', inspected(CHARACTER_GENERATION_CANVAS.width, CHARACTER_GENERATION_CANVAS.height)), { ok: true, scale: null })
assert.throws(() => validateCharacterAssetInspection({
  width: CHARACTER_GENERATION_CANVAS.width,
  height: CHARACTER_GENERATION_CANVAS.height,
  hasTransparentPixels: true,
  hasVisiblePixels: true,
  genuineRgba: true,
  visibleBounds: bounds(10, 10, 900, 1400),
  visiblePixelCount: 1000,
  size: 1000,
  sha256: 'a'.repeat(64),
}), /512×768/)

const validInspection = {
  width: canvas.width, height: canvas.height, hasTransparentPixels: true, hasVisiblePixels: true, genuineRgba: true,
  visibleBounds: bounds(10, 10, 100, 100), visiblePixelCount: 1000, size: 1000, sha256: 'a'.repeat(64),
}
assert.equal(characterAssetInspectionRejection(validInspection), null)
assert.equal(characterAssetInspectionRejection({ ...validInspection, hasTransparentPixels: false })?.code, 'OPAQUE_BACKGROUND')
assert.equal(characterAssetInspectionRejection({ ...validInspection, hasVisiblePixels: false })?.code, 'MISSING_VISIBLE_PIXELS')
assert.equal(characterAssetInspectionRejection({ ...validInspection, genuineRgba: false })?.code, 'INVALID_RGBA')
assert.equal(characterAssetInspectionRejection({ ...validInspection, size: 6 * 1024 * 1024 })?.code, 'INVALID_FILE_SIZE')

// Wrong aspect, upscaling, and images without real alpha are rejected instead of cropped, stretched, or repaired.
assert.equal(rejection(planCharacterResize('exact-aspect-downscale', inspected(1024, 1024))).code, 'NORMALIZATION_REQUIRES_EXACT_ASPECT')
assert.equal(rejection(planCharacterResize('exact-aspect-downscale', inspected(256, 384))).code, 'NORMALIZATION_CANNOT_UPSCALE')
assert.equal(rejection(planCharacterResize('exact-aspect-downscale', inspected(1024, 1535))).code, 'NORMALIZATION_REQUIRES_EXACT_ASPECT')
assert.equal(rejection(planCharacterResize('exact-aspect-downscale', inspected(1024, 1536, false))).code, 'NORMALIZATION_REQUIRES_GENUINE_RGBA')

// Bounds fitting is one uniform scale plus translation: the shorter axis never stretches to fill.
const fitted = fitCharacterBoundsTransform(bounds(100, 200, 100, 200), bounds(20, 40, 50, 50))
assert.deepEqual(fitted, { scale: 2, x: 60, y: 120 })
assert.equal(fitted.scale, 2)

// Reference alignment is opt-in, and only for the two groups with a deterministic reference.
assert.deepEqual(planCharacterAlignment('none', 'expression', bounds(0, 0, 10, 10), bounds(0, 0, 20, 20)), { ok: true, transform: null })
assert.equal(rejection(planCharacterAlignment('reference-visible-bounds', 'prop', bounds(0, 0, 10, 10), bounds(0, 0, 20, 20))).code, 'ALIGNMENT_TARGET_NOT_SUPPORTED')
assert.equal(rejection(planCharacterAlignment('reference-visible-bounds', 'body', bounds(0, 0, 10, 10), bounds(0, 0, 20, 20))).code, 'ALIGNMENT_TARGET_NOT_SUPPORTED')
assert.equal(rejection(planCharacterAlignment('reference-visible-bounds', 'expression', bounds(0, 0, 10, 10), undefined)).code, 'ALIGNMENT_REFERENCE_UNAVAILABLE')
assert.equal(rejection(planCharacterAlignment('reference-visible-bounds', 'outfit', bounds(60, 80, 200, 400), bounds(40, 20, 300, 600))).code, 'ALIGNMENT_TARGET_NOT_SUPPORTED')

// Report the bounds produced by the rounded transform, not idealized reference coordinates.
assert.deepEqual(
  planCharacterAlignment('reference-visible-bounds', 'expression', bounds(7, 11, 123, 234), bounds(20, 30, 100, 190)),
  {
    ok: true,
    transform: { scale: 0.812, x: 14.3162, y: 21.0684 },
    bounds: { x: 20.0002, y: 30.0004, width: 99.876, height: 190.008 },
  },
)

// A reference that would push visible pixels off the canvas is rejected, never clamped.
assert.equal(
  rejection(planCharacterAlignment('reference-visible-bounds', 'expression', bounds(0, 0, 10, 10), bounds(10, 10, 200, 200))).code,
  'ALIGNMENT_TRANSFORM_OUT_OF_RANGE',
)

const mask = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }): CharacterAlphaMask => {
  const alpha = new Uint8Array(canvas.width * canvas.height)
  for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) alpha[row * canvas.width + column] = 255
  return { width: canvas.width, height: canvas.height, alpha }
}
const head = bounds(200, 100, 100, 120)

assert.equal(inspectCharacterAssetOwnership('expression', mask(head), { headBounds: head }).status, 'valid')
const fullBodyExpression = inspectCharacterAssetOwnership('expression', mask(bounds(150, 100, 220, 600)), { headBounds: head })
assert.equal(fullBodyExpression.status, 'invalid')
assert.equal(fullBodyExpression.status === 'invalid' && fullBodyExpression.code, 'EXPRESSION_NOT_HEAD_ONLY')
const shiftedHead = inspectCharacterAssetOwnership('expression', mask({ ...head, x: 0 }), { headBounds: head })
assert.equal(shiftedHead.status === 'invalid' && shiftedHead.code, 'PIXELS_OUTSIDE_LAYER_OWNERSHIP')
const completeSkin = mask(bounds(150, 80, 220, 650))
const garment = mask(bounds(150, 300, 220, 180))
assert.equal(inspectCharacterAssetOwnership('outfit', completeSkin, { bodyMask: completeSkin }).status, 'invalid')
assert.equal(inspectCharacterAssetOwnership('outfit', garment, { bodyMask: completeSkin }).status, 'unverified')
assert.equal(measureCharacterMaskAlignment('outfit', completeSkin, garment).status, 'unverified')
// One shared read of the existing diagnostics decides the fit the editor offers and WebMCP reports.
assert.deepEqual(suggestCharacterFit({ measurement: measureCharacterMaskAlignment('expression', mask(head), mask(head)) }), { status: 'aligned' })
assert.deepEqual(suggestCharacterFit({ measurement: measureCharacterMaskAlignment('expression', null, mask(head)) }), { status: 'unavailable' })
assert.deepEqual(suggestCharacterFit({}), { status: 'unavailable' })

const drifted = measureCharacterMaskAlignment('expression', mask(head), mask({ ...head, x: head.x + 30 }))
assert.equal(drifted.status, 'misaligned')
const suggested = suggestCharacterFit({ measurement: drifted })
assert.equal(suggested.status, 'suggested')
assert.equal(suggested.status === 'suggested' && suggested.source, 'mask-alignment')
assert.deepEqual(suggested.status === 'suggested' && suggested.transform, { scale: 1, x: -30, y: 0 })
assert.equal(suggested.status === 'suggested' && suggested.after.iou! > suggested.before.iou!, true)

// A visual-correlation suggestion reports its own before/after score; without one the head anchor reads as aligned.
const visualFit = { method: 'native-grayscale-edge-correlation' as const, score: 0.7, currentScore: 0.5, improvement: 0.2, suggestedTransform: { x: 3, y: -4, scale: 0.9 } }
const visual = suggestCharacterFit({ measurement: drifted, visualFit, headAnchor: true })
assert.equal(visual.status === 'suggested' && visual.source, 'visual-correlation')
assert.deepEqual(visual.status === 'suggested' && [visual.before.score, visual.after.score], [0.5, 0.7])
assert.deepEqual(suggestCharacterFit({ visualFit: { ...visualFit, suggestedTransform: null }, headAnchor: true }), { status: 'aligned' })

console.log('character normalization: ok')
