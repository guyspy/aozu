import {
  CHARACTER_GENERATION_CANVAS,
  CHARACTER_RIG,
  IDENTITY_CHARACTER_TRANSFORM,
  validateCharacterVariantTransform,
  type CharacterAlignMode,
  type CharacterResizeMode,
  type CharacterVariantGroup,
  type CharacterVariantTransform,
} from '../domain/character.ts'
import type { CharacterEditableRegion } from './character-creation.ts'

export interface CharacterAlphaMask {
  width: number
  height: number
  alpha: Uint8Array
}

export interface CharacterVisualSample {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

type Bounds = { x: number; y: number; width: number; height: number }
type MaskStats = { bounds?: Bounds; visiblePixels: number; edgeTouchPixels: number; center?: { x: number; y: number } }

const round = (value: number) => Math.round(value * 10_000) / 10_000

export type CharacterAlignmentPoint = { label: string; reference: { x: number; y: number }; candidate: { x: number; y: number } }

/** Fit observed corresponding points, never a partial overlay's bounds to a whole body. */
export function measureCharacterPointAlignment(points: CharacterAlignmentPoint[], current: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 12 || new Set(points.map((point) => point?.label)).size !== points.length) throw new Error('Supply 3–12 uniquely labelled corresponding points')
  for (const point of points) {
    if (typeof point.label !== 'string' || !point.label.trim() || point.label.length > 80) throw new Error('Every alignment point needs a meaningful label')
    for (const position of [point.reference, point.candidate]) {
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.x > CHARACTER_RIG.canvas.width || position.y < 0 || position.y > CHARACTER_RIG.canvas.height) throw new Error('Alignment points must use the 512×768 canvas coordinates')
    }
  }
  const mean = (side: 'reference' | 'candidate', axis: 'x' | 'y') => points.reduce((sum, point) => sum + point[side][axis], 0) / points.length
  const reference = { x: mean('reference', 'x'), y: mean('reference', 'y') }
  const candidate = { x: mean('candidate', 'x'), y: mean('candidate', 'y') }
  let variance = 0, covariance = 0
  for (const point of points) for (const axis of ['x', 'y'] as const) {
    const delta = point.candidate[axis] - candidate[axis]
    variance += delta ** 2
    covariance += delta * (point.reference[axis] - reference[axis])
  }
  if (variance / points.length < 16 ** 2) throw new Error('Spread alignment points across the item; clustered points cannot establish scale')
  const scale = covariance / variance
  const fitted = { scale: round(scale), x: round(reference.x - candidate.x * scale), y: round(reference.y - candidate.y * scale) }
  const residuals = (transform: CharacterVariantTransform) => {
    const errors = points.map((point) => ({ label: point.label,
      dx: round(point.candidate.x * transform.scale + transform.x - point.reference.x),
      dy: round(point.candidate.y * transform.scale + transform.y - point.reference.y),
    }))
    return { points: errors, rms: round(Math.sqrt(errors.reduce((sum, point) => sum + point.dx ** 2 + point.dy ** 2, 0) / errors.length)),
      max: round(Math.max(...errors.map((point) => Math.hypot(point.dx, point.dy)))) }
  }
  const before = residuals(current), after = residuals(fitted)
  let supported = true
  try { validateCharacterVariantTransform(fitted) } catch { supported = false }
  const status = !supported || after.max > 4 ? 'needs-artwork-correction' : before.max <= 4 ? 'within-tolerance' : 'suggested'
  return { status, basis: 'agent-observed-correspondences', tolerancePx: 4, before, after,
    suggestedTransform: status === 'suggested' ? fitted : null,
    instruction: 'These residuals measure supplied points, not image truth. Verify the correspondence on both images and all unmeasured attachment points. Re-inspect with the same raw candidate points after applying a transform. Conflicting residuals require correcting artwork, not forcing overlap.' }
}

const characterEditWeight = (region: CharacterEditableRegion, x: number, y: number) => {
  const shape = region.shape
  const distance = (1 - Math.hypot((x - shape.cx) / shape.rx, (y - shape.cy) / shape.ry)) * Math.min(shape.rx, shape.ry)
  return Math.max(0, Math.min(1, distance / 4))
}

export function measureProtectedRegionDelta(
  reference: CharacterVisualSample,
  candidate: CharacterVisualSample,
  region: CharacterEditableRegion,
) {
  if (reference.width !== candidate.width || reference.height !== candidate.height) return null
  let changedPixels = 0
  let comparedPixels = 0
  for (let y = 0; y < reference.height; y++) for (let x = 0; x < reference.width; x++) {
    const rigX = (x + 0.5) * CHARACTER_RIG.canvas.width / reference.width
    const rigY = (y + 0.5) * CHARACTER_RIG.canvas.height / reference.height
    if (characterEditWeight(region, rigX, rigY) > 0) continue
    const index = (y * reference.width + x) * 4
    comparedPixels++
    if ([0, 1, 2, 3].some((channel) => reference.rgba[index + channel] !== candidate.rgba[index + channel])) changedPixels++
  }
  return {
    protectedChangeRatio: round(comparedPixels ? changedPixels / comparedPixels : 0),
    changedPixels,
    comparedPixels,
    sample: { width: reference.width, height: reference.height },
  }
}

export function stitchCharacterEditPixels(
  reference: CharacterVisualSample,
  candidate: CharacterVisualSample,
  region: CharacterEditableRegion,
): CharacterVisualSample {
  if (reference.width !== candidate.width || reference.height !== candidate.height) throw new Error('Character edit images must use the same canvas')
  const rgba = new Uint8ClampedArray(reference.rgba)
  for (let y = 0; y < reference.height; y++) for (let x = 0; x < reference.width; x++) {
    const weight = characterEditWeight(
      region,
      (x + 0.5) * CHARACTER_RIG.canvas.width / reference.width,
      (y + 0.5) * CHARACTER_RIG.canvas.height / reference.height,
    )
    if (!weight) continue
    const index = (y * reference.width + x) * 4
    if (weight === 1) {
      rgba.set(candidate.rgba.subarray(index, index + 4), index)
      continue
    }
    const referenceAlpha = reference.rgba[index + 3]! / 255
    const candidateAlpha = candidate.rgba[index + 3]! / 255
    const alpha = referenceAlpha * (1 - weight) + candidateAlpha * weight
    for (let channel = 0; channel < 3; channel++) rgba[index + channel] = alpha
      ? Math.round((reference.rgba[index + channel]! * referenceAlpha * (1 - weight) + candidate.rgba[index + channel]! * candidateAlpha * weight) / alpha)
      : 0
    rgba[index + 3] = Math.round(alpha * 255)
  }
  return { width: reference.width, height: reference.height, rgba }
}

const maskStats = (mask: CharacterAlphaMask): MaskStats => {
  let minX = mask.width
  let minY = mask.height
  let maxX = -1
  let maxY = -1
  let visiblePixels = 0
  let edgeTouchPixels = 0
  let sumX = 0
  let sumY = 0
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x]! <= 16) continue
      visiblePixels++
      sumX += x
      sumY += y
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      if (x === 0 || y === 0 || x === mask.width - 1 || y === mask.height - 1) edgeTouchPixels++
    }
  }
  return {
    visiblePixels,
    edgeTouchPixels,
    ...(visiblePixels ? {
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      center: { x: sumX / visiblePixels, y: sumY / visiblePixels },
    } : {}),
  }
}

const transformMask = (mask: CharacterAlphaMask, transform: CharacterVariantTransform): CharacterAlphaMask => {
  if (transform.x === 0 && transform.y === 0 && transform.scale === 1) return mask
  const alpha = new Uint8Array(mask.width * mask.height)
  for (let y = 0; y < mask.height; y++) {
    const sourceY = Math.round((y - transform.y) / transform.scale)
    if (sourceY < 0 || sourceY >= mask.height) continue
    for (let x = 0; x < mask.width; x++) {
      const sourceX = Math.round((x - transform.x) / transform.scale)
      if (sourceX >= 0 && sourceX < mask.width) alpha[y * mask.width + x] = mask.alpha[sourceY * mask.width + sourceX]!
    }
  }
  return { ...mask, alpha }
}

export function inspectCharacterAssetOwnership(
  group: CharacterVariantGroup,
  candidate: CharacterAlphaMask,
  options: {
    headBounds?: Bounds
    bodyMask?: CharacterAlphaMask
    transform?: CharacterVariantTransform
  } = {},
) {
  if (group === 'expression') {
    const placed = transformMask(candidate, options.transform ?? IDENTITY_CHARACTER_TRANSFORM)
    const bounds = options.headBounds
    if (!bounds) return {
      status: 'invalid' as const,
      code: 'HEAD_OWNERSHIP_UNAVAILABLE',
      message: 'A canonical body is required before a whole-head expression can be submitted.',
    }
    const candidateBounds = maskStats(candidate).bounds
    if (candidateBounds && (candidateBounds.width > bounds.width * 1.5 || candidateBounds.height > bounds.height * 1.5)) return {
      status: 'invalid' as const,
      code: 'EXPRESSION_NOT_HEAD_ONLY',
      message: 'Expression artwork is too large to be a whole-head layer; submit the head only with transparent pixels elsewhere.',
      candidateBounds,
      headBounds: bounds,
    }
    const margin = Math.max(6, Math.ceil(Math.max(bounds.width, bounds.height) * 0.04))
    const left = Math.floor(bounds.x - margin)
    const top = Math.floor(bounds.y - margin)
    const right = Math.ceil(bounds.x + bounds.width + margin)
    const bottom = Math.ceil(bounds.y + bounds.height + margin)
    let visiblePixels = 0
    let pixelsOutsideOwnership = 0
    for (let y = 0; y < placed.height; y++) for (let x = 0; x < placed.width; x++) {
      if (placed.alpha[y * placed.width + x]! <= 16) continue
      visiblePixels++
      if (x < left || x >= right || y < top || y >= bottom) pixelsOutsideOwnership++
    }
    return pixelsOutsideOwnership ? {
      status: 'invalid' as const,
      code: 'PIXELS_OUTSIDE_LAYER_OWNERSHIP',
      message: `Expression must contain only the whole head; ${pixelsOutsideOwnership} visible pixels are outside its ownership bounds.`,
      pixelsOutsideOwnership,
      visiblePixels,
      bounds: { x: left, y: top, width: right - left, height: bottom - top },
    } : {
      status: 'valid' as const,
      pixelsOutsideOwnership,
      visiblePixels,
      bounds: { x: left, y: top, width: right - left, height: bottom - top },
    }
  }
  if (['outfit', 'hair', 'headwear'].includes(group) && options.bodyMask) {
    const placed = transformMask(candidate, options.transform ?? IDENTITY_CHARACTER_TRANSFORM)
    let bodyPixels = 0
    let overlayPixels = 0
    let overlapPixels = 0
    let headPixels = 0
    for (let index = 0; index < placed.alpha.length; index++) {
      const body = options.bodyMask.alpha[index]! > 16
      const overlay = placed.alpha[index]! > 16
      if (body) bodyPixels++
      if (overlay) {
        overlayPixels++
        const x = index % placed.width, y = Math.floor(index / placed.width)
        if (options.headBounds && x >= options.headBounds.x && x < options.headBounds.x + options.headBounds.width && y >= options.headBounds.y && y < options.headBounds.y + options.headBounds.height) headPixels++
      }
      if (body && overlay) overlapPixels++
    }
    const bodyCoverage = bodyPixels ? overlapPixels / bodyPixels : 0
    const overlayCoverage = overlayPixels ? overlapPixels / overlayPixels : 0
    const headCoverage = options.headBounds ? headPixels / (options.headBounds.width * options.headBounds.height) : null
    if (bodyCoverage >= 0.85 && overlayCoverage >= 0.75 && (group !== 'outfit' || headCoverage === null || headCoverage >= 0.25)) return {
      status: 'invalid' as const,
      code: 'OVERLAY_CONTAINS_COMPLETE_CHARACTER',
      message: 'This looks like a complete dressed character. Submit only the garment or style pixels on the registered transparent canvas; never put body pixels or the dressed intermediate in this slot.',
      bodyCoverage,
      overlayCoverage, headCoverage,
      overlapPixels,
    }
    return { status: 'unverified' as const, bodyCoverage, overlayCoverage, headCoverage, overlapPixels,
      message: 'No complete-character heuristic triggered. Pixel ownership and visual alignment still require review.' }
  }
  return { status: 'valid' as const }
}

const compareMasks = (reference: CharacterAlphaMask, candidate: CharacterAlphaMask) => {
  let intersection = 0
  let union = 0
  let referencePixels = 0
  let candidatePixels = 0
  for (let index = 0; index < reference.alpha.length; index++) {
    const expected = reference.alpha[index]! > 16
    const actual = candidate.alpha[index]! > 16
    if (expected) referencePixels++
    if (actual) candidatePixels++
    if (expected && actual) intersection++
    if (expected || actual) union++
  }
  const referenceStats = maskStats(reference)
  const candidateStats = maskStats(candidate)
  return {
    iou: round(union ? intersection / union : 0),
    referenceCoverage: round(referencePixels ? intersection / referencePixels : 0),
    candidateCoverage: round(candidatePixels ? intersection / candidatePixels : 0),
    centerDelta: referenceStats.center && candidateStats.center ? {
      x: round(candidateStats.center.x - referenceStats.center.x),
      y: round(candidateStats.center.y - referenceStats.center.y),
    } : null,
    footLineDelta: referenceStats.bounds && candidateStats.bounds
      ? candidateStats.bounds.y + candidateStats.bounds.height - referenceStats.bounds.y - referenceStats.bounds.height
      : null,
    referenceBounds: referenceStats.bounds,
    candidateBounds: candidateStats.bounds,
    edgeTouchPixels: candidateStats.edgeTouchPixels,
  }
}

/** One uniform scale plus translation fitting `candidate` visible bounds onto `reference` bounds. Never stretches an axis. */
export function fitCharacterBoundsTransform(reference: Bounds, candidate: Bounds): CharacterVariantTransform {
  const scale = Math.min(reference.width / candidate.width, reference.height / candidate.height)
  return {
    scale: round(scale),
    x: round(reference.x - candidate.x * scale),
    y: round(reference.y - candidate.y * scale),
  }
}

const suggestedTransform = (reference: CharacterAlphaMask, candidate: CharacterAlphaMask): CharacterVariantTransform | null => {
  const expected = maskStats(reference).bounds
  const actual = maskStats(candidate).bounds
  return expected && actual ? fitCharacterBoundsTransform(expected, actual) : null
}

export function measureCharacterMaskAlignment(
  group: CharacterVariantGroup,
  reference: CharacterAlphaMask | null,
  candidate: CharacterAlphaMask,
  transform: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM,
  referenceTransform: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM,
) {
  if (candidate.width !== CHARACTER_RIG.canvas.width || candidate.height !== CHARACTER_RIG.canvas.height) {
    return { status: 'invalid' as const, diagnostics: [{ code: 'INVALID_CANVAS', severity: 'error' as const, message: 'Candidate mask must use the 512×768 rig canvas.' }] }
  }
  const rawStats = maskStats(candidate)
  if (rawStats.edgeTouchPixels && group !== 'prop') {
    return {
      status: 'invalid' as const,
      diagnostics: [{ code: 'ALPHA_TOUCHES_CANVAS_EDGE', severity: 'error' as const, message: `${rawStats.edgeTouchPixels} visible alpha pixels touch the canvas edge.` }],
    }
  }
  if (group === 'body') {
    return {
      status: 'aligned' as const,
      metrics: { candidateBounds: rawStats.bounds, edgeTouchPixels: rawStats.edgeTouchPixels },
      diagnostics: rawStats.edgeTouchPixels ? [{ code: 'ALPHA_TOUCHES_CANVAS_EDGE', severity: 'warning' as const, message: `${rawStats.edgeTouchPixels} visible alpha pixels touch the canvas edge; verify that this is intentional.` }] : [],
    }
  }
  if (group !== 'expression') return {
    status: 'unverified' as const,
    metrics: reference ? compareMasks(transformMask(reference, referenceTransform), transformMask(candidate, transform)) : { candidateBounds: rawStats.bounds, edgeTouchPixels: rawStats.edgeTouchPixels },
    comparison: 'partial-overlay-to-reference: overlap is descriptive only; center and bottom-edge deltas are not attachment errors. Never maximize whole-body IoU for a partial item.',
    diagnostics: [{ code: 'OVERLAY_VISUAL_REVIEW_REQUIRED', severity: 'warning' as const, message: 'Registered overlays are verified in the browser Composite, Overlay, Difference, and Align views; their alpha shape must not be fitted to the body silhouette.' }],
  }
  if (!reference) return {
    status: 'unverified' as const,
    metrics: { candidateBounds: rawStats.bounds, edgeTouchPixels: rawStats.edgeTouchPixels },
    diagnostics: [{ code: 'REGISTRATION_REQUIRED', severity: 'warning' as const, message: 'Establish the first whole-head registration visually before auto-fitting later expressions.' }],
  }
  const expected = transformMask(reference, referenceTransform)
  const current = compareMasks(expected, transformMask(candidate, transform))
  const suggestion = suggestedTransform(expected, candidate)
  const suggested = suggestion ? compareMasks(expected, transformMask(candidate, suggestion)) : current
  const best = suggested.iou > current.iou ? suggested : current
  const structurallyValid = best.iou >= 0.65 && best.referenceCoverage >= 0.75 && best.candidateCoverage >= 0.75
  if (!structurallyValid) {
    return {
      status: 'invalid' as const,
      metrics: current,
      suggestedMetrics: suggested,
      suggestedTransform: suggestion,
      diagnostics: [{
        code: 'EXPRESSION_MUST_INCLUDE_COMPLETE_HEAD',
        severity: 'error' as const,
        message: 'Expression must be a complete whole-head replacement aligned to the canonical head.',
      }],
    }
  }
  const centered = current.centerDelta && Math.abs(current.centerDelta.x) <= 12 && Math.abs(current.centerDelta.y) <= 12
  const aligned = current.iou >= 0.85 && centered
  return {
    status: aligned ? 'aligned' as const : 'misaligned' as const,
    metrics: current,
    suggestedMetrics: suggested,
    suggestedTransform: suggestion,
    diagnostics: aligned ? [] : [{ code: 'ALIGNMENT_DRIFT', severity: 'warning' as const, message: 'Candidate structure is valid but its registration drifts from the canonical reference.' }],
  }
}

export function highConfidenceCharacterAutoFit(
  alignment: ReturnType<typeof measureCharacterMaskAlignment> | null | undefined,
): CharacterVariantTransform | null {
  if (alignment?.status !== 'misaligned' || !alignment.suggestedTransform || !('suggestedMetrics' in alignment)) return null
  const metrics = alignment.suggestedMetrics
  const centered = metrics.centerDelta && Math.abs(metrics.centerDelta.x) <= 4 && Math.abs(metrics.centerDelta.y) <= 4
  return centered && metrics.iou >= 0.85 && metrics.referenceCoverage >= 0.85 && metrics.candidateCoverage >= 0.85 && metrics.edgeTouchPixels === 0
    ? alignment.suggestedTransform : null
}

const correlation = (count: number, sumA: number, sumB: number, sumAA: number, sumBB: number, sumAB: number) => {
  const denominator = Math.sqrt((count * sumAA - sumA * sumA) * (count * sumBB - sumB * sumB))
  return denominator > 0 ? (count * sumAB - sumA * sumB) / denominator : -1
}

const visualChannels = ({ width, height, rgba }: CharacterVisualSample) => {
  const gray = new Float32Array(width * height)
  const alpha = new Uint8Array(width * height)
  for (let pixel = 0, source = 0; pixel < gray.length; pixel++, source += 4) {
    gray[pixel] = rgba[source]! * 0.2126 + rgba[source + 1]! * 0.7152 + rgba[source + 2]! * 0.0722
    alpha[pixel] = rgba[source + 3]!
  }
  const edge = new Float32Array(gray.length)
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x
    edge[index] = Math.abs(gray[index + 1]! - gray[index - 1]!) + Math.abs(gray[index + width]! - gray[index - width]!)
  }
  return { gray, alpha, edge }
}

export function suggestCharacterVisualRegistration(
  body: CharacterVisualSample,
  candidate: CharacterVisualSample,
  current: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM,
) {
  // ponytail: this coarse visual correlation only suggests transforms; add semantic landmarks if cross-style failures persist.
  if (body.width !== candidate.width || body.height !== candidate.height) return null
  const reference = visualChannels(body)
  const source = visualChannels(candidate)
  const points: Array<{ x: number; y: number; gray: number; edge: number }> = []
  let minX = candidate.width
  let minY = candidate.height
  let maxX = -1
  for (let y = 0; y < candidate.height; y++) for (let x = 0; x < candidate.width; x++) if (source.alpha[y * candidate.width + x]! > 32) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x)
  }
  for (let y = 1; y < candidate.height - 1; y += 2) for (let x = 1; x < candidate.width - 1; x += 2) {
    const index = y * candidate.width + x
    if (source.alpha[index]! <= 32) continue
    points.push({ x, y, gray: source.gray[index]!, edge: source.edge[index]! })
  }
  if (points.length < 64) return null
  let bodyMinX = body.width
  let bodyMaxX = -1
  for (let y = 0; y < body.height; y++) for (let x = 0; x < body.width; x++) if (reference.alpha[y * body.width + x]! > 32) {
    bodyMinX = Math.min(bodyMinX, x); bodyMaxX = Math.max(bodyMaxX, x)
  }
  if (bodyMaxX < bodyMinX) return null
  const ratioX = body.width / CHARACTER_RIG.canvas.width
  const ratioY = body.height / CHARACTER_RIG.canvas.height
  const score = (transform: CharacterVariantTransform) => {
    let count = 0
    let grayA = 0; let grayB = 0; let grayAA = 0; let grayBB = 0; let grayAB = 0
    let edgeA = 0; let edgeB = 0; let edgeAA = 0; let edgeBB = 0; let edgeAB = 0
    for (const point of points) {
      const x = Math.round(transform.x * ratioX + point.x * transform.scale)
      const y = Math.round(transform.y * ratioY + point.y * transform.scale)
      if (x < 0 || y < 0 || x >= body.width || y >= body.height) continue
      const index = y * body.width + x
      const bodyGray = reference.gray[index]!
      const bodyEdge = reference.edge[index]!
      count++; grayA += point.gray; grayB += bodyGray; grayAA += point.gray * point.gray; grayBB += bodyGray * bodyGray; grayAB += point.gray * bodyGray
      edgeA += point.edge; edgeB += bodyEdge; edgeAA += point.edge * point.edge; edgeBB += bodyEdge * bodyEdge; edgeAB += point.edge * bodyEdge
    }
    if (count < points.length * 0.8) return -1
    return correlation(count, grayA, grayB, grayAA, grayBB, grayAB) * 0.65
      + correlation(count, edgeA, edgeB, edgeAA, edgeBB, edgeAB) * 0.35
  }
  const sourceCenterX = (minX + maxX) / 2
  const bodyCenterX = (bodyMinX + bodyMaxX) / 2
  let best = { transform: current, score: score(current) }
  const evaluate = (scale: number, centerX: number, topY: number) => {
    const transform = {
      scale: round(scale),
      x: round((centerX - sourceCenterX * scale) / ratioX),
      y: round((topY - minY * scale) / ratioY),
    }
    const value = score(transform)
    if (value > best.score) best = { transform, score: value }
  }
  for (let scale = 0.25; scale <= 1.0001; scale += 0.05) {
    for (let center = bodyCenterX - 8; center <= bodyCenterX + 8; center += 2) {
      for (let top = 0; top <= body.height / 3; top += 2) evaluate(scale, center, top)
    }
  }
  const coarse = best.transform
  const coarseCenter = coarse.x * ratioX + sourceCenterX * coarse.scale
  const coarseTop = coarse.y * ratioY + minY * coarse.scale
  for (let scale = Math.max(0.25, coarse.scale - 0.04); scale <= Math.min(1, coarse.scale + 0.0401); scale += 0.01) {
    for (let center = coarseCenter - 2; center <= coarseCenter + 2; center += 0.5) {
      for (let top = coarseTop - 2; top <= coarseTop + 2; top += 0.5) evaluate(scale, center, top)
    }
  }
  const currentScore = score(current)
  const improvement = best.score - currentScore
  return {
    method: 'native-grayscale-edge-correlation' as const,
    score: round(best.score),
    currentScore: round(currentScore),
    improvement: round(improvement),
    suggestedTransform: best.score >= 0.4 && improvement >= 0.08 ? best.transform : null,
  }
}

type NormalizationRejection = { ok: false; code: string; message: string }
const reject = (code: string, message: string): NormalizationRejection => ({ ok: false, code, message })

/**
 * Pure: the deterministic whole-canvas downscale for one inspected candidate. Only genuine RGBA images with the
 * exact rig aspect and at least the rig canvas size qualify; upscaling and reframing are never offered.
 * `scale: null` means no resize happens, and strict inspection still rejects a non-canvas candidate.
 */
export function planCharacterResize(
  mode: CharacterResizeMode,
  inspection: { width: number; height: number; genuineRgba: boolean },
): { ok: true; scale: number | null } | NormalizationRejection {
  const canvas = CHARACTER_RIG.canvas
  const { width, height, genuineRgba } = inspection
  if (mode !== 'exact-aspect-downscale' || (width === canvas.width && height === canvas.height)) return { ok: true, scale: null }
  if (!genuineRgba) return reject('NORMALIZATION_REQUIRES_GENUINE_RGBA', 'Only genuine RGBA images can be normalized; a painted transparency grid is not alpha.')
  if (width * canvas.height !== height * canvas.width) {
    return reject('NORMALIZATION_REQUIRES_EXACT_ASPECT', `Normalization needs the exact ${canvas.width}:${canvas.height} canvas aspect; ${width}×${height} would have to be cropped.`)
  }
  if (width < canvas.width || height < canvas.height) {
    return reject('NORMALIZATION_CANNOT_UPSCALE', `Normalization never upscales; generate at ${CHARACTER_GENERATION_CANVAS.width}×${CHARACTER_GENERATION_CANVAS.height} instead of ${width}×${height}.`)
  }
  return { ok: true, scale: round(canvas.width / width) }
}

/**
 * Pure: the one uniform scale plus translation that fits an already-canvas-sized candidate onto the contract's
 * deterministic reference bounds. Body establishment and props stay explicit-canvas submissions.
 */
export function planCharacterAlignment(
  mode: CharacterAlignMode,
  group: CharacterVariantGroup,
  candidateBounds: Bounds | undefined,
  referenceBounds: Bounds | undefined,
): { ok: true; transform: CharacterVariantTransform | null; bounds?: Bounds } | NormalizationRejection {
  if (mode !== 'reference-visible-bounds') return { ok: true, transform: null }
  if (group !== 'expression') {
    return reject('ALIGNMENT_TARGET_NOT_SUPPORTED', 'Reference-bounds alignment applies only to whole-head expression targets. Registered overlays must keep their authored canvas position.')
  }
  if (!referenceBounds || !candidateBounds) {
    return reject('ALIGNMENT_REFERENCE_UNAVAILABLE', 'This target has no deterministic reference visible bounds; submit an exact-canvas asset instead.')
  }
  const transform = fitCharacterBoundsTransform(referenceBounds, candidateBounds)
  try {
    validateCharacterVariantTransform(transform)
  } catch {
    return reject('ALIGNMENT_TRANSFORM_OUT_OF_RANGE', 'The fitted alignment transform is outside the supported canvas range.')
  }
  const bounds = {
    x: round(transform.x + candidateBounds.x * transform.scale),
    y: round(transform.y + candidateBounds.y * transform.scale),
    width: round(candidateBounds.width * transform.scale),
    height: round(candidateBounds.height * transform.scale),
  }
  if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > CHARACTER_RIG.canvas.width || bounds.y + bounds.height > CHARACTER_RIG.canvas.height) {
    return reject('ALIGNMENT_LEAVES_CANVAS', 'The fitted alignment transform would move visible pixels outside the canvas.')
  }
  return { ok: true, transform, bounds }
}

export type CharacterFitMetrics = { iou: number | null; footLineDelta: number | null; score: number | null }
export type CharacterFitSuggestion =
  | { status: 'aligned' }
  | { status: 'unavailable' }
  | {
      status: 'suggested'
      source: 'mask-alignment' | 'visual-correlation'
      confidence: 'high'
      transform: CharacterVariantTransform
      before: CharacterFitMetrics
      after: CharacterFitMetrics
    }

const fitMetrics = (
  metrics: ReturnType<typeof compareMasks> | { candidateBounds?: Bounds; edgeTouchPixels: number } | undefined,
  score: number | null,
): CharacterFitMetrics => ({
  iou: metrics && 'iou' in metrics ? metrics.iou : null,
  footLineDelta: metrics && 'footLineDelta' in metrics ? metrics.footLineDelta : null,
  score,
})

/**
 * The one high-confidence fit both the editor's `Apply suggested fit` action and the WebMCP results offer,
 * read straight from the existing alignment diagnostics. No new scoring, and marginal suggestions stay unavailable.
 */
export function suggestCharacterFit({ measurement, visualFit, headAnchor }: {
  measurement?: ReturnType<typeof measureCharacterMaskAlignment> | null
  visualFit?: ReturnType<typeof suggestCharacterVisualRegistration> | null
  headAnchor?: boolean
}): CharacterFitSuggestion {
  const metrics = measurement && 'metrics' in measurement ? measurement.metrics : undefined
  if (visualFit?.suggestedTransform) {
    return {
      status: 'suggested',
      source: 'visual-correlation',
      confidence: 'high',
      transform: visualFit.suggestedTransform,
      before: fitMetrics(metrics, visualFit.currentScore),
      after: fitMetrics(undefined, visualFit.score),
    }
  }
  if ((headAnchor && visualFit) || measurement?.status === 'aligned') return { status: 'aligned' }
  const transform = highConfidenceCharacterAutoFit(measurement)
  if (!transform) return { status: 'unavailable' }
  return {
    status: 'suggested',
    source: 'mask-alignment',
    confidence: 'high',
    transform,
    before: fitMetrics(metrics, null),
    after: fitMetrics(measurement && 'suggestedMetrics' in measurement ? measurement.suggestedMetrics : undefined, null),
  }
}
