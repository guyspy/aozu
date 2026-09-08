import { stitchCharacterEditPixels, type CharacterAlphaMask, type CharacterVisualSample } from '../../core/application/character-alignment.ts'
import type { CharacterEditableRegion } from '../../core/application/character-creation.ts'
import { CHARACTER_RIG, IDENTITY_CHARACTER_TRANSFORM, type CharacterAssetInspection, type CharacterVariantTransform, type ResolvedCharacterLayer } from '../../core/domain/character.ts'

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const pngBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(
  (blob) => blob ? resolve(blob) : reject(new Error('Could not encode character image')),
  'image/png',
))

const readCharacterPixelsAt = async (blob: Blob, width: number, height: number, transform: CharacterVariantTransform) => {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable')
  context.setTransform(
    transform.scale * width / CHARACTER_RIG.canvas.width,
    0,
    0,
    transform.scale * height / CHARACTER_RIG.canvas.height,
    transform.x * width / CHARACTER_RIG.canvas.width,
    transform.y * height / CHARACTER_RIG.canvas.height,
  )
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { width, height, rgba: context.getImageData(0, 0, width, height).data }
}

export function characterPixelStats(pixels: Uint8ClampedArray, width: number, height: number) {
  let transparent = false
  let visiblePixelCount = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) transparent = true
    if (pixels[index] > 0) {
      visiblePixelCount++
      const pixel = (index - 3) / 4
      const x = pixel % width
      const y = Math.floor(pixel / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    transparent,
    visiblePixelCount,
    ...(visiblePixelCount ? { visibleBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } } : {}),
  }
}

export async function inspectCharacterImage(blob: Blob): Promise<CharacterAssetInspection> {
  if (blob.type !== 'image/png') throw new Error('Character asset must be PNG')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const png = bytes.length > 25 && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const stats = characterPixelStats(pixels, canvas.width, canvas.height)
  return {
    width: canvas.width,
    height: canvas.height,
    hasTransparentPixels: stats.transparent,
    hasVisiblePixels: stats.visiblePixelCount > 0,
    genuineRgba: png && bytes[25] === 6,
    ...(stats.visibleBounds ? { visibleBounds: stats.visibleBounds } : {}),
    visiblePixelCount: stats.visiblePixelCount,
    size: blob.size,
    sha256: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))),
  }
}

export async function readCharacterAlphaMask(blob: Blob): Promise<CharacterAlphaMask> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const alpha = new Uint8Array(canvas.width * canvas.height)
  for (let source = 3, target = 0; source < pixels.length; source += 4, target++) alpha[target] = pixels[source]!
  return { width: canvas.width, height: canvas.height, alpha }
}

export async function readCharacterVisualSample(
  blob: Blob,
  transform: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM,
): Promise<CharacterVisualSample> {
  return readCharacterPixelsAt(blob, CHARACTER_RIG.canvas.width / 8, CHARACTER_RIG.canvas.height / 8, transform)
}

export async function readCharacterPixels(
  blob: Blob,
  transform: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM,
): Promise<CharacterVisualSample> {
  return readCharacterPixelsAt(blob, CHARACTER_RIG.canvas.width, CHARACTER_RIG.canvas.height, transform)
}

/**
 * Deterministic whole-canvas downscale onto the rig canvas. No crop, no reframe, no background work: the caller
 * has already proven the exact rig aspect, genuine alpha, and that this is a downscale.
 */
export async function renderCharacterCanvasDownscale(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = CHARACTER_RIG.canvas.width
  canvas.height = CHARACTER_RIG.canvas.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return pngBlob(canvas)
}

export async function renderStitchedCharacterEditBlob(
  reference: Blob,
  candidate: Blob,
  region: CharacterEditableRegion,
  referenceTransform: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM,
  candidateTransform: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM,
) {
  const stitched = stitchCharacterEditPixels(
    await readCharacterPixels(reference, referenceTransform),
    await readCharacterPixels(candidate, candidateTransform),
    region,
  )
  const canvas = document.createElement('canvas')
  canvas.width = stitched.width
  canvas.height = stitched.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.putImageData(new ImageData(new Uint8ClampedArray(stitched.rgba), stitched.width, stitched.height), 0, 0)
  return pngBlob(canvas)
}

const renderCharacterCompositeCanvas = async (
  layers: ReadonlyArray<ResolvedCharacterLayer & { blob: Blob }>,
  width: number = CHARACTER_RIG.canvas.width,
  signal?: AbortSignal,
) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = width * CHARACTER_RIG.canvas.height / CHARACTER_RIG.canvas.width
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  for (const { blob, transform } of layers) {
    signal?.throwIfAborted()
    const bitmap = await createImageBitmap(blob)
    try {
      signal?.throwIfAborted()
      context.save()
      try {
        const ratio = width / CHARACTER_RIG.canvas.width
        context.setTransform(transform.scale * ratio, 0, 0, transform.scale * ratio, transform.x * ratio, transform.y * ratio)
        context.drawImage(bitmap, 0, 0)
      } finally {
        context.restore()
      }
    } finally {
      bitmap.close()
    }
  }
  return canvas
}

/** The same resolved paint order and rig transforms used by the workshop preview, on transparent pixels. */
export async function renderCharacterCompositeBlob(
  layers: ReadonlyArray<ResolvedCharacterLayer & { blob: Blob }>,
): Promise<Blob> {
  if (!layers.length) throw new Error('Select character artwork before downloading PNG')
  return pngBlob(await renderCharacterCompositeCanvas(layers))
}

export async function renderCharacterCompositeDataUrl(
  layers: ReadonlyArray<ResolvedCharacterLayer & { blob: Blob }>,
) {
  return (await renderCharacterCompositeCanvas(layers)).toDataURL('image/png')
}

export function renderCharacterEditMaskDataUrl(region: CharacterEditableRegion) {
  const canvas = document.createElement('canvas')
  canvas.width = CHARACTER_RIG.canvas.width
  canvas.height = CHARACTER_RIG.canvas.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'destination-out'
  context.beginPath()
  context.ellipse(region.shape.cx, region.shape.cy, region.shape.rx, region.shape.ry, 0, 0, Math.PI * 2)
  context.fill()
  return canvas.toDataURL('image/png')
}

/** Library cards never retain full-resolution layers or create WebGL contexts. */
export async function renderCharacterThumbnail(layers: ReadonlyArray<ResolvedCharacterLayer & { blob: Blob }>, signal?: AbortSignal) {
  return pngBlob(await renderCharacterCompositeCanvas(layers, 160, signal))
}

const assetThumbnails = new WeakMap<Blob, Blob>()
let assetThumbnailQueue = Promise.resolve()
export function renderCharacterAssetThumbnail(blob: Blob, bounds?: CharacterAssetInspection['visibleBounds'], signal?: AbortSignal) {
  const result = assetThumbnailQueue.then(async () => {
    signal?.throwIfAborted()
    const cached = assetThumbnails.get(blob)
    if (cached) return cached
    const bitmap = await createImageBitmap(blob)
    try {
      signal?.throwIfAborted()
      const crop = bounds ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
      const ratio = Math.min(1, 160 / Math.max(crop.width, crop.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(crop.width * ratio))
      canvas.height = Math.max(1, Math.round(crop.height * ratio))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas is unavailable')
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
      const thumbnail = await pngBlob(canvas)
      signal?.throwIfAborted()
      assetThumbnails.set(blob, thumbnail)
      return thumbnail
    } finally { bitmap.close() }
  })
  assetThumbnailQueue = result.then(() => {}, () => {})
  return result
}
