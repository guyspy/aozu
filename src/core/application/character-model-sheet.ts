import { CHARACTER_REFERENCE_VIEWS, CHARACTER_REFERENCE_KINDS, type CharacterAssetInspection, type CharacterDraft, type CharacterModelSheet, type CharacterReference } from '../domain/character.ts'

export const MAX_REFERENCE_DIMENSION = 4096
export const MAX_REFERENCE_BYTES = 5 * 1024 * 1024
export const isTurnaroundView = (id: string): id is typeof CHARACTER_REFERENCE_VIEWS[number] => (CHARACTER_REFERENCE_VIEWS as readonly string[]).includes(id)
export const modelSheetReferences = <A>(sheet?: CharacterModelSheet<A>): Record<string, CharacterReference<A>> => ({ ...sheet?.views, ...sheet?.references })
/** Empty views stay empty for a new Appearance; never fall back to another outfit's references. */
export function characterModelSheet(draft: CharacterDraft): CharacterModelSheet {
  const appearance = draft.appearances?.find(({ id }) => id === draft.activeAppearanceId)
  return appearance ? { views: {}, ...appearance.modelSheet, heightCm: draft.modelSheet?.heightCm } : draft.modelSheet ?? { views: {} }
}
export function withCharacterModelSheet(draft: CharacterDraft, sheet: CharacterModelSheet): CharacterDraft {
  if (!draft.activeAppearanceId) return { ...draft, modelSheet: sheet }
  const { heightCm, ...references } = sheet
  return { ...draft, modelSheet: { ...draft.modelSheet, views: draft.modelSheet?.views ?? {}, heightCm },
    appearances: draft.appearances?.map((appearance) => appearance.id === draft.activeAppearanceId ? { ...appearance, modelSheet: references } : appearance) }
}
export function setModelSheetReference<A>(sheet: CharacterModelSheet<A>, id: string, reference?: CharacterReference<A>): CharacterModelSheet<A> {
  const key = isTurnaroundView(id) ? 'views' : 'references'
  const entries: Record<string, CharacterReference<A>> = { ...sheet[key] }
  if (reference) entries[id] = reference
  else delete entries[id]
  return { ...sheet, [key]: entries }
}
export function validateReferenceId(id: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id) || ['appearance', 'canonical', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid reference ID')
}

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
    Object.keys(sheet).some((key) => !['heightCm', 'views', 'references'].includes(key)) ||
    (sheet.heightCm !== undefined && (!Number.isFinite(sheet.heightCm) || sheet.heightCm <= 0 || sheet.heightCm > 100_000))) throw new Error('Invalid model sheet or height')
  if (Object.keys(sheet.views).some((id) => !isTurnaroundView(id)) || (sheet.references !== undefined &&
    (!sheet.references || typeof sheet.references !== 'object' || Array.isArray(sheet.references) || Object.keys(sheet.references).length > 100 || Object.keys(sheet.references).some(isTurnaroundView)))) throw new Error('Invalid supplemental references')
  for (const [id, reference] of Object.entries(modelSheetReferences(sheet))) {
    validateReferenceId(id)
    if (!reference || typeof reference !== 'object' || Array.isArray(reference) || !reference.asset ||
      Object.keys(reference).some((key) => !['asset', 'notes', 'guides', 'label', 'kind', 'viewpoint', 'pose', 'sourceSha256'].includes(key)) ||
      ['label', 'viewpoint', 'pose'].some((key) => { const value = reference[key as 'label']; return value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 80) }) ||
      (reference.kind !== undefined && !CHARACTER_REFERENCE_KINDS.includes(reference.kind)) ||
      (reference.sourceSha256 !== undefined && !/^[0-9a-f]{64}$/.test(reference.sourceSha256)) ||
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
  for (const { asset } of Object.values(modelSheetReferences(modelSheet))) validateReferenceInspection(asset.inspection)
  return JSON.stringify(characterModelSheet(draft)) === JSON.stringify(modelSheet) ? draft : withCharacterModelSheet(draft, modelSheet)
}
