import { CHARACTER_REFERENCE_VIEWS, type CharacterAssetInspection, type CharacterDraft, type CharacterModelSheet } from '../domain/character.ts'

export const MAX_REFERENCE_DIMENSION = 4096
export const MAX_REFERENCE_BYTES = 5 * 1024 * 1024

export function validateReferenceInspection(image: CharacterAssetInspection) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
    image.width < 1 || image.height < 1 || image.width > MAX_REFERENCE_DIMENSION || image.height > MAX_REFERENCE_DIMENSION ||
    !Number.isSafeInteger(image.size) || image.size < 1 || image.size > MAX_REFERENCE_BYTES || !image.hasVisiblePixels ||
    !/^[0-9a-f]{64}$/.test(image.sha256)) throw new Error('Reference must be a visible PNG, up to 4096 × 4096 and 5 MiB')
}

/** Check dimensions before allocating a decoder; reference PNGs may be opaque and keep their original canvas. */
export async function validateReferencePng(blob: Blob) {
  const header = new Uint8Array(await blob.slice(0, 33).arrayBuffer())
  const view = new DataView(header.buffer)
  if (blob.type !== 'image/png' || blob.size < 33 || blob.size > MAX_REFERENCE_BYTES || header.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte) ||
    view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 ||
    view.getUint32(16) < 1 || view.getUint32(20) < 1 ||
    view.getUint32(16) > MAX_REFERENCE_DIMENSION || view.getUint32(20) > MAX_REFERENCE_DIMENSION) {
    throw new Error('Reference must be a PNG, up to 4096 × 4096 and 5 MiB')
  }
}

export function validateModelSheet(sheet: CharacterModelSheet<unknown>) {
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet) || !sheet.views || typeof sheet.views !== 'object' || Array.isArray(sheet.views) ||
    Object.keys(sheet).some((key) => !['heightCm', 'views'].includes(key)) ||
    (sheet.heightCm !== undefined && (!Number.isFinite(sheet.heightCm) || sheet.heightCm <= 0 || sheet.heightCm > 100_000))) throw new Error('Invalid model sheet or height')
  for (const [view, reference] of Object.entries(sheet.views)) {
    if (!(CHARACTER_REFERENCE_VIEWS as readonly string[]).includes(view) || !reference || typeof reference !== 'object' || Array.isArray(reference) || !reference.asset ||
      Object.keys(reference).some((key) => !['asset', 'notes', 'guides'].includes(key)) ||
      (reference.notes !== undefined && (typeof reference.notes !== 'string' || reference.notes.length > 1000))) throw new Error('Invalid model sheet view')
    const guides = reference.guides
    if (guides !== undefined && (!guides || typeof guides !== 'object' || Array.isArray(guides) ||
      Object.keys(guides).some((key) => !['head', 'feet'].includes(key)) ||
      !Number.isFinite(guides.head) || !Number.isFinite(guides.feet) || guides.head < 0 || guides.feet > 1 || guides.feet - guides.head < 0.01 - Number.EPSILON)) {
      throw new Error('Head and feet must be inside the image, with the head above the feet')
    }
  }
}

export function updateCharacterModelSheet(draft: CharacterDraft, modelSheet: CharacterModelSheet): CharacterDraft {
  validateModelSheet(modelSheet)
  for (const { asset } of Object.values(modelSheet.views)) validateReferenceInspection(asset.inspection)
  return JSON.stringify(draft.modelSheet ?? { views: {} }) === JSON.stringify(modelSheet) ? draft : { ...draft, modelSheet }
}
