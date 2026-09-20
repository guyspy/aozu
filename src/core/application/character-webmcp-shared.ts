import type { createCharacterEditor } from './character-editor.ts'
import { characterModelSheet, modelSheetReferences } from './character-model-sheet.ts'
import { CHARACTER_REFERENCE_VIEWS, type CharacterDraft, type CharacterNormalization, type CharacterReference, type CharacterReferenceMetadata, type CharacterReferenceView, type CharacterVariantGroup, type CharacterVariantLayer } from '../domain/character.ts'
import type { CharacterAlignmentPoint } from './character-alignment.ts'

export const describeReference = ({ asset, ...reference }: CharacterReference) => ({
  ...reference,
  filename: asset.filename,
  sha256: asset.inspection.sha256,
  width: asset.inspection.width,
  height: asset.inspection.height,
})

export const modelSheetPath = (id: string, referenceId?: string) =>
  `/characters/${encodeURIComponent(id)}/model-sheet${referenceId ? `/${encodeURIComponent(referenceId)}` : ''}`

export const describeAppearances = (character: CharacterDraft) => ({
  activeAppearanceId: character.activeAppearanceId ?? null,
  autoSave: 'current-appearance',
  appearances: (character.appearances ?? []).map(({ id, label, selected, modelSheet }) => ({
    id,
    label,
    selected,
    referenceCount: Object.keys(modelSheetReferences(modelSheet)).length,
  })),
})

export const describeModelSheet = (character: CharacterDraft) => ({
  appearanceId: character.activeAppearanceId ?? null,
  heightCm: character.modelSheet?.heightCm ?? null,
  views: Object.fromEntries(Object.entries(characterModelSheet(character).views).map(([id, reference]) => [id, describeReference(reference)])),
  references: Object.fromEntries(Object.entries(characterModelSheet(character).references ?? {}).map(([id, reference]) => [id, describeReference(reference)])),
})

export const MODEL_SHEET_POLICY = {
  tool: 'update_character_model_sheet',
  views: CHARACTER_REFERENCE_VIEWS,
  input: { mediaType: 'image/png', maxBytes: 5 * 1024 * 1024, maxWidth: 4096, maxHeight: 4096, background: 'opaque or transparent', preserveOriginalCanvas: true },
  instruction: 'Four full-body turnaround slots share one Appearance and pose. Appearance starts in A-pose. Save as captures the current front for the new Appearance; visually review it. Add new keeps the shared base body but starts with no selected variants or references. Existing reference images are preserved. Supplement with independent head, structure (T-pose/raised arm), expression, detail and style references. Preserve identity, outfit and proportions. Left/right mean the character’s own sides. New unseen designs are proposals to record in notes, not established canon. Height in cm is optional; never infer it from image pixels. Guides use fractions of the original image height, head above feet; calibrate visually and exclude hats and held props. Reference art does not change appearance layers.',
} as const

export type ModelSheetInput = CharacterReferenceMetadata & {
  referenceId?: string
  fromAppearance?: boolean
  remove?: boolean
  characterId: string
  expectedRevision: number
  view?: CharacterReferenceView
  notes?: string
  guides?: CharacterReference['guides'] | null
  filename?: string
  dataUrl?: string
  dataSha256?: string
  expectedAssetSha256?: string | null
}

export type CharacterAssetMutationInput = {
  characterId: string
  group: CharacterVariantGroup
  variantId: string
  label: string
  layer: CharacterVariantLayer
  expectedRevision: number
  expectedAssetSha256: string | null
  filename: string
  dataUrl?: string
  dataSha256?: string
  normalization?: CharacterNormalization
  rebaseDerivedAssets?: boolean
  preflightPoints?: { referenceSha256: string; points: CharacterAlignmentPoint[] }
}

export type CharacterWebMcpDependencies = {
  document: Document
  editor: ReturnType<typeof createCharacterEditor>
  activeCharacter(): { character: CharacterDraft; revision: number }
  settledRevision(what: string): number
  characterNextActions(draft: CharacterDraft): unknown[]
  characterPath(characterId: string, group?: CharacterVariantGroup, variantId?: string): string
  collectionFor(characterId: string): Promise<{ id: string; name: string; description: string; backstory: string; revision: number }>
  historyStatus(): { canUndo: boolean; canRedo: boolean; saveStatus: string; revision: number | null }
  routeSelection(path: string): { characterId?: string } | null
  currentPath(): string
  exportCharacterPng(character: CharacterDraft): Promise<Blob>
}
