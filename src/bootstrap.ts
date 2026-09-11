import { bootMantleRuntime, type MantleRuntime } from '@aotter/mantle-runtime'

import { createIndexedDbAssetRepository } from './adapters/indexeddb/asset-repository.ts'
import { createIndexedDbCharacterDraftRepository } from './adapters/indexeddb/character-draft-repository.ts'
import { createCharacterWorkspaceRepository } from './adapters/indexeddb/character-workspace-repository.ts'
import { createIndexedDbCharacterCollectionRepository } from './adapters/indexeddb/character-collection-repository.ts'
import { createIndexedDbCharacterLibraryRepository } from './adapters/indexeddb/character-library-repository.ts'
import { exportCharacterLibraryZip, readCharacterLibraryZip } from './adapters/zip/character-library.ts'
import type { CharacterLibrarySnapshot } from './core/application/character-library.ts'
import { createIndexedDbMantleStorageAdapter } from './adapters/indexeddb/mantle-storage.ts'
import { createWorldLibraryService } from './core/application/world-library.ts'
import { createStoryboardService } from './core/application/storyboard.ts'
import { createWebMcpController, readWorkspaceView } from './adapters/webmcp/controller.ts'
import { CHARACTER_A_POSE_GUIDANCE, MODEL_SHEET_REVIEW, CHARACTER_BACKGROUND_GUIDANCE, CHARACTER_NAVIGATION_GUIDANCE, CHARACTER_VISUAL_REVIEW } from './core/application/character-agent-guidance.ts'
import { AUTHORING_NAMESPACE } from './core/application/authoring.ts'
import {
  CHARACTER_ALIGN_MODES,
  CHARACTER_GENERATION_CANVAS,
  CHARACTER_REFERENCE_VIEWS,
  type CharacterReferenceView,
  type CharacterReferenceMetadata,
  type CharacterReference,
  CHARACTER_RESIZE_MODES,
  CHARACTER_RIG,
  NO_CHARACTER_NORMALIZATION,
  type CharacterAssetInspection,
  type CharacterAssetTarget,
  type CharacterDraft,
  type CharacterNormalization,
  type CharacterProfilePatch,
  type CharacterVariantGroup,
  type CharacterVariantLayer,
  type CharacterVariantTransform,
} from './core/domain/character.ts'
import {
  CHARACTER_CREATION_GROUPS,
  REQUIRED_CHARACTER_TARGETS,
  activateCharacterVariant,
  deactivateCharacterVariant,
  migrateLegacyCharacterLibrary,
  hasCurrentCharacterLayer,
  isCharacterDraftAssetCurrent,
  characterAssetPlacement,
  characterAssetInspectionRejection,
  characterRegistrationFrame,
  resolveCharacterDraftAtlasSources,
  resolveCharacterDraftLayers,
  resolveCharacterDraftPlacements,
  resolveCharacterDraftReferenceLayers,
  resolveCharacterAssetSources,
  setCharacterVariantTransform,
  transformCharacterBounds,
  updateCharacterProfile,
  saveCharacterDraftAsset,
} from './core/application/character-creation.ts'
import { updateCharacterModelSheet, characterModelSheet, withCharacterModelSheet, modelSheetReferences, setModelSheetReference, validateReferenceId, isTurnaroundView } from './core/application/character-model-sheet.ts'
import { changeCharacterAppearance, type CharacterAppearanceCommand } from './core/application/character-appearances.ts'
import { createCharacterEditor } from './core/application/character-editor.ts'
import { highConfidenceCharacterAutoFit, inspectCharacterAssetOwnership, measureCharacterMaskAlignment, measureProtectedRegionDelta, planCharacterAlignment, planCharacterResize, suggestCharacterFit, suggestCharacterVisualRegistration } from './core/application/character-alignment.ts'
import { inspectCharacterImage, readCharacterAlphaMask, readCharacterPixels, readCharacterVisualSample, renderCharacterCanvasDownscale, renderCharacterCompositeBlob, renderCharacterThumbnail, renderCharacterCompositeDataUrl, renderCharacterEditMaskDataUrl, renderStitchedCharacterEditBlob } from './adapters/browser/character-image.ts'
import { requestPersistentStorage } from './adapters/browser/storage-persistence.ts'
import { createCharacterWorkspaceEvents } from './adapters/browser/character-workspace-events.ts'
import { exportCharacterDraftZip, readCharacterDraftZip } from './adapters/zip/character-draft.ts'
import { DEFAULT_CHARACTER_COLLECTION, type CharacterCollectionProfile } from './core/domain/character-collection.ts'
import { compileAuthoringBackbone } from './core/mantle/backbone.ts'

const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read character asset'))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

const pngFromDataUrl = (dataUrl: string) => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match || dataUrl.length > 7_100_000) throw new Error('Expected a PNG data URL under 5 MiB')
  return new Blob([Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0))], { type: 'image/png' })
}
const describeReference = ({ asset, ...reference }: CharacterReference) => ({
  ...reference, filename: asset.filename, sha256: asset.inspection.sha256, width: asset.inspection.width, height: asset.inspection.height,
})
const modelSheetPath = (id: string, referenceId?: string) => `/characters/${encodeURIComponent(id)}/model-sheet${referenceId ? `/${encodeURIComponent(referenceId)}` : ''}`
const describeAppearances = (character: CharacterDraft) => ({
  activeAppearanceId: character.activeAppearanceId ?? null,
  autoSave: 'current-appearance',
  appearances: (character.appearances ?? []).map(({ id, label, selected, modelSheet }) => ({ id, label, selected,
    referenceCount: Object.keys(modelSheetReferences(modelSheet)).length })),
})
const describeModelSheet = (character: CharacterDraft) => ({
  appearanceId: character.activeAppearanceId ?? null,
  heightCm: character.modelSheet?.heightCm ?? null,
  views: Object.fromEntries(Object.entries(characterModelSheet(character).views).map(([id, reference]) => [id, describeReference(reference)])),
  references: Object.fromEntries(Object.entries(characterModelSheet(character).references ?? {}).map(([id, reference]) => [id, describeReference(reference)])),
})
const MODEL_SHEET_POLICY = {
  tool: 'update_character_model_sheet', views: CHARACTER_REFERENCE_VIEWS,
  input: { mediaType: 'image/png', maxBytes: 5 * 1024 * 1024, maxWidth: 4096, maxHeight: 4096, background: 'opaque or transparent', preserveOriginalCanvas: true },
  instruction: 'Four full-body turnaround slots share one Appearance and pose. Appearance starts in A-pose. Save as captures the current front for the new Appearance; visually review it. Add new keeps the shared base body but starts with no selected variants or references. Existing reference images are preserved. Supplement with independent head, structure (T-pose/raised arm), expression, detail and style references. Preserve identity, outfit and proportions. Left/right mean the character’s own sides. New unseen designs are proposals to record in notes, not established canon. Height in cm is optional; never infer it from image pixels. Guides use fractions of the original image height, head above feet; calibrate visually and exclude hats and held props. Reference art does not change appearance layers.',
}
interface ModelSheetInput extends CharacterReferenceMetadata {
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
  expectedAssetSha256?: string | null
}

type CharacterBounds = NonNullable<CharacterAssetInspection['visibleBounds']>
type CharacterAlignmentMeasurement = ReturnType<typeof measureCharacterMaskAlignment>

const CHARACTER_ASSET_POLICY = {
  workflow: {
    inspectBeforeMutation: true,
    exactRevisionAndAssetSha256: 'required',
    canonicalBodyBeforeDerivedLayers: 'required',
    navigation: CHARACTER_NAVIGATION_GUIDANCE,
    visualReview: CHARACTER_VISUAL_REVIEW,
  },
  input: {
    mediaType: 'image/png',
    finalCanvas: { ...CHARACTER_RIG.canvas },
    visiblePixels: 'required',
    canvasEdge: { body: 'reject', expression: 'reject', outfit: 'reject', prop: 'warning' },
    alpha: {
      required: true,
      websiteRemovesBackground: false,
      opaqueInput: 'reject',
      instruction: CHARACTER_BACKGROUND_GUIDANCE,
      preparation: {
        default: 'solid-background-then-remove',
        generateOn: 'one flat high-contrast color absent from the subject',
        avoid: ['gradient', 'shadow', 'glow', 'texture', 'cropped silhouette'],
        beforeSubmission: ['discover a permitted background-removal tool, image editor, or local image-processing CLI/library', 'remove the solid background without cropping or reframing', 'verify real alpha and inspect edges on light and dark backgrounds', 'submit RGBA PNG'],
      },
    },
  },
  layers: {
    body: { content: 'complete-character-skin', pose: 'a-pose', instruction: CHARACTER_A_POSE_GUIDANCE },
    expression: { content: 'complete-whole-head-only', outsideHeadOwnership: 'transparent', referenceOverlap: 'required' },
    outfit: {
      content: 'complete-dressed-character-skin',
      clothingOnlyOverlay: 'reject',
      referenceSilhouetteCompatibility: 'required',
      exactCanonicalPixelCoverage: 'not-required',
      preserve: ['pose', 'body center', 'head position', 'foot line'],
    },
    prop: { content: 'independent-transparent-overlay' },
  },
} as const

/** The one deterministic alignment reference per group, read from the shared registration frame. */
const characterReferenceBounds = (
  frame: ReturnType<typeof characterRegistrationFrame>,
  group: CharacterVariantGroup,
): CharacterBounds | undefined =>
  group === 'expression' ? frame.headEnvelope?.bounds : group === 'outfit' ? frame.bodyBounds : undefined

/** What a submission may and should ask the website to normalize, from the same geometry submission validates against. */
const characterNormalizationContract = (alignAvailable: boolean) => ({
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

const CHARACTER_WEBMCP_TRIGGERS = [
  'inspect-workspace',
  'inspect-storyboard',
  'update-storyboard',
  'export-storyboard',
  'update-collection-profile',
  'navigate-character',
  'inspect-character-contract',
  'update-character-profile',
  'update-character-model-sheet',
  'replace-character-asset',
  'repair-character-asset',
  'set-character-variant-selection',
  'set-character-variant-transform',
  'undo-character-change',
  'redo-character-change',
] as const

export function createApplication(document: Document) {
  const storyboards = createStoryboardService()
  const worldLibrary = createWorldLibraryService()
  const legacyCharacterDrafts = createIndexedDbCharacterDraftRepository()
  const browser = document.defaultView
  // Legacy migration spans asset staging, Mantle creation and legacy cleanup. Serialize it with
  // backup/restore across tabs so cleanup cannot delete a just-restored legacy identity.
  const withLibraryLock = <T>(task: () => Promise<T>): Promise<T> => browser?.navigator.locks
    ? browser.navigator.locks.request('aozu-character-library', task) : task()
  const characterChanges = createCharacterWorkspaceEvents(browser && 'BroadcastChannel' in browser
    ? new browser.BroadcastChannel('aozu-character-workspaces')
    : null)
  // Only small, completed thumbnails survive navigation; originals and GPU textures belong to the editor.
  const thumbnails = new Map<string, Blob | null>()
  let thumbnailQueue = Promise.resolve()
  const authoringPlan = compileAuthoringBackbone()
  let authoringRuntime: Promise<MantleRuntime> | undefined
  const invokeContext = { user: null, staff: null, env: {} }

  const getAuthoringRuntime = () => authoringRuntime ??= bootMantleRuntime({
    plan: authoringPlan,
    storage: createIndexedDbMantleStorageAdapter(AUTHORING_NAMESPACE),
    handlers: {
      'companion.inspect-workspace': inspectWorkspace,
      'companion.inspect-storyboard': async (input) => {
        const { boardId, images } = input as { boardId?: string; images?: string[] }
        return { status: 'ok', data: await storyboards.inspect(boardId, images) }
      },
      'companion.update-storyboard': async (input) => {
        if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or discard local unsaved input before changing the storyboard')
        const board = await storyboards.update(input)
        return { status: 'ok', data: { boardId: board.id, revision: board.revision, frames: board.frames }, effects: { navigation: { path: `/storyboards/${board.id}`, mode: 'push', reason: 'Review the changed storyboard.' } } }
      },
      'companion.export-storyboard': async (input) => {
        const { boardId, expectedRevision } = input as { boardId: string; expectedRevision: number }
        const blob = await storyboards.export(boardId, expectedRevision)
        const url = URL.createObjectURL(blob), link = document.createElement('a')
        link.href = url; link.download = `storyboard-${boardId}.zip`; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        return { status: 'ok', data: { filename: link.download, bytes: blob.size, revision: expectedRevision, downloadStarted: true } }
      },
      'companion.update-collection-profile': updateCollectionProfile,
      'companion.navigate-character': navigateCharacter,
      'companion.update-character-profile': updateProfile,
      'companion.update-character-model-sheet': (input) => updateModelSheet(input),
      'companion.set-character-variant-selection': setCharacterSelection,
      'companion.create-local-companion': storyModeUnavailable,
      'companion.inspect-experience-contract': storyModeUnavailable,
      'companion.submit-experience-candidate': storyModeUnavailable,
      'companion.inspect-character-contract': inspectCharacterContract,
      'companion.replace-character-asset': replaceCharacterAssetTool,
      'companion.repair-character-asset': repairCharacterAssetTool,
      'companion.set-character-variant-transform': setCharacterTransform,
      'companion.undo-character-change': characterHistoryTool('undo'),
      'companion.redo-character-change': characterHistoryTool('redo'),
    },
  })
  const storedCharacterDrafts = createCharacterWorkspaceRepository(getAuthoringRuntime, createIndexedDbAssetRepository)
  const characterDrafts = {
    ...storedCharacterDrafts,
    async create(draft: CharacterDraft) {
      const record = await storedCharacterDrafts.create(draft)
      characterChanges.publish({ characterId: record.character.id, revision: record.version })
      return record
    },
    async put(draft: CharacterDraft, expectedVersion: number) {
      const persisted = await storedCharacterDrafts.put(draft, expectedVersion)
      characterChanges.publish({ characterId: draft.id, revision: persisted.version })
      return persisted
    },
    async delete(characterId: string) {
      await storedCharacterDrafts.delete(characterId)
      characterChanges.publish({ characterId, revision: null })
    },
  }
  const editor = createCharacterEditor(characterDrafts, createIndexedDbAssetRepository, inspectCharacterImage, prepareAppearanceReferences)
  const collections = createIndexedDbCharacterCollectionRepository()
  const libraryRepository = createIndexedDbCharacterLibraryRepository()
  const webmcp = createWebMcpController(document, authoringPlan, CHARACTER_WEBMCP_TRIGGERS, async (trigger, input) =>
    (await getAuthoringRuntime()).invokeTrigger({ trigger, input, ctx: invokeContext }))

  function storyModeUnavailable(): never {
    throw new Error('Story mode is not available in this build')
  }

  let legacyCharactersMigrated: Promise<void> | undefined
  const migrateLegacyCharacters = () => legacyCharactersMigrated ??= withLibraryLock(async () => {
    if (!browser?.navigator.locks && (await legacyCharacterDrafts.list()).length) {
      throw new Error('Legacy Character migration requires Web Locks. Export the library and restore it in a browser with Web Locks support.')
    }
    await migrateLegacyCharacterLibrary(legacyCharacterDrafts, characterDrafts)
  }).catch((error) => {
    legacyCharactersMigrated = undefined
    throw error
  })

  const listCharacterDrafts = async () => {
    await migrateLegacyCharacters()
    return (await characterDrafts.list()).sort((left, right) => right.character.updatedAt - left.character.updatedAt || left.character.id.localeCompare(right.character.id))
  }

  const persisted = async <T>(record: Promise<{ character: T }>) => {
    const { character } = await record
    await requestPersistentStorage(browser?.navigator.storage)
    return character
  }
  const activeCharacter = () => {
    const { character, persistedRevision } = editor.store.getState()
    if (!character || persistedRevision === null) throw new Error('No Character is open')
    return { character, revision: persistedRevision }
  }
  const settledRevision = (what: string) => {
    const { persistedRevision, saveStatus, saveError } = editor.store.getState()
    if (saveStatus !== 'saved') throw new Error(`${what} is applied in the editor but not saved: ${saveError ?? saveStatus}`)
    return persistedRevision!
  }

  const application = {
    storyboards,
    worldLibrary,
    webmcp,
    editor,
    changeCharacterAppearance: applyCharacterAppearance,
    subscribeCharacterChanges: characterChanges.subscribe,
    async loadCharacterLibrary() {
      await migrateLegacyCharacters()
      return { collections: await collections.list(), characters: await storedCharacterDrafts.listSummaries() }
    },
    async characterReference(id: string) {
      const record = await storedCharacterDrafts.get(id)
      if (!record) throw new Error('Character no longer exists')
      return { ...record, png: await renderCharacterCompositeBlob(resolveCharacterDraftLayers(record.character)) }
    },
    loadCharacterThumbnail(id: string, previewKey: string, signal: AbortSignal): Promise<Blob | null> {
      const key = `${id}:${previewKey}`
      // ponytail: one thumbnail decode at a time; increase concurrency only if visible cards lag.
      const result = thumbnailQueue.then(async () => {
        signal.throwIfAborted()
        if (thumbnails.has(key)) return thumbnails.get(key)!
        const layers = await storedCharacterDrafts.getPreview(id, previewKey)
        signal.throwIfAborted()
        const blob = layers.length ? await renderCharacterThumbnail(layers, signal) : null
        signal.throwIfAborted()
        thumbnails.set(key, blob)
        if (thumbnails.size > 64) thumbnails.delete(thumbnails.keys().next().value!)
        return blob
      })
      thumbnailQueue = result.then(() => {}, () => {})
      return result
    },
    async createCollection(name: string) {
      const collection = await collections.create(name)
      characterChanges.publish({ characterId: collection.id, revision: null })
      await requestPersistentStorage(browser?.navigator.storage)
      return collection
    },
    async updateCollection(id: string, profile: CharacterCollectionProfile, version: number) {
      const result = await (await getAuthoringRuntime()).invokeProcedure({
        procedure: 'update-collection-profile', input: { collectionId: id, expectedRevision: version, ...profile }, ctx: invokeContext,
      })
      if (!result.ok) throw new Error(result.diagnostic.message ?? 'Collection could not be saved')
    },
    async deleteCollection(id: string, version: number) {
      await collections.delete(id, version)
      await worldLibrary.refresh()
      characterChanges.publish({ characterId: id, revision: null })
    },
    async assignCollection(characterId: string, collectionId: string | null) {
      await collections.assign(characterId, collectionId)
      characterChanges.publish({ characterId, revision: null })
    },
    exportCharacterLibrary: () => withLibraryLock(async () => {
      await editor.settle()
      if (editor.store.getState().saveStatus !== 'saved') throw new Error('Save or reload your unsaved Character before downloading the library')
      return exportCharacterLibraryZip(await libraryRepository.snapshot())
    }),
    prepareCharacterLibraryImport: (blob: Blob) => readCharacterLibraryZip(blob, inspectCharacterImage),
    importCharacterLibrary: (snapshot: CharacterLibrarySnapshot, mode: 'merge' | 'replace') => withLibraryLock(async () => {
      await editor.settle()
      if (editor.store.getState().saveStatus !== 'saved') throw new Error('Save or reload your unsaved Character before restoring the library')
      await libraryRepository.restore(snapshot, mode)
      await worldLibrary.refresh()
      const activeId = editor.store.getState().activeCharacterId
      if (activeId) await editor.close(activeId)
      legacyCharactersMigrated = undefined
      thumbnails.clear()
      characterChanges.publish({ characterId: 'character-library', revision: null })
      await requestPersistentStorage(browser?.navigator.storage)
    }),
    /** Save As: duplicates the active in-memory Character and switches to the copy. */
    saveCharacterAs: () => persisted(editor.saveAs().then((character) => ({ character }))),
    /** Copy: duplicates the latest saved library Character. */
    async copyCharacter(characterId: string) {
      return persisted(editor.duplicate((await editor.read(characterId)).character))
    },
    /** Read-only: the same high-confidence fit WebMCP reports, so the editor can explain it before applying. */
    characterFitSuggestion: (group: CharacterVariantGroup, variantId: string) =>
      characterFit(group, variantId).then(({ fit }) => fit),
    async autoFitCharacterVariant(group: CharacterVariantGroup, variantId: string) {
      const { revision, fit } = await characterFit(group, variantId)
      if (fit.status === 'aligned') return
      if (fit.status !== 'suggested') throw new Error('No high-confidence fit is available; use the visual alignment controls.')
      await editor.dispatch((current) => setCharacterVariantTransform(current, group, variantId, fit.transform), revision)
    },
    async replaceCharacterAsset(characterId: string, target: CharacterAssetTarget, blob: Blob) {
      await editor.open(characterId)
      const { character, revision } = activeCharacter()
      const current = character.variants.find(({ group, id }) => group === target.group && id === target.variantId)?.layers[target.layer]
      const result = await mutateCharacterAsset('replace', {
        ...target,
        characterId,
        expectedRevision: revision,
        expectedAssetSha256: current?.inspection.sha256 ?? null,
        filename: blob instanceof File ? blob.name : `${target.variantId}-${target.layer}.png`,
      }, blob, 'user')
      if (!result.data.accepted) throw new Error('rejection' in result.data ? result.data.rejection?.message : 'Character asset was rejected')
      return result.data
    },
    async replaceCharacterReference(characterId: string, referenceId: string, blob?: Blob, metadata: CharacterReferenceMetadata = {}) {
      await editor.open(characterId)
      const { character, revision } = activeCharacter()
      return updateModelSheet({ characterId, expectedRevision: revision, referenceId, ...metadata,
        ...(blob ? { filename: blob instanceof File ? blob.name : `${referenceId}.png` } : { fromAppearance: true }),
        expectedAssetSha256: modelSheetReferences(characterModelSheet(character))[referenceId]?.asset.inspection.sha256 ?? null,
      }, blob, 'user')
    },
    async deleteCharacter(characterId: string) {
      await editor.close(characterId)
      await characterDrafts.delete(characterId)
    },
    async exportCharacter(characterId: string) {
      await editor.settle()
      if (editor.store.getState().activeCharacterId === characterId) settledRevision('Character export')
      const { compileCharacterTextureAtlas } = await import('./adapters/browser/character-atlas.ts')
      const { character } = await editor.view(characterId)
      return exportCharacterDraftZip(character, await compileCharacterTextureAtlas(resolveCharacterDraftAtlasSources(character)))
    },
    exportCharacterPng: (character: CharacterDraft, preview?: { group: CharacterVariantGroup; id: string }) =>
      renderCharacterCompositeBlob(resolveCharacterDraftLayers(character, preview)),
    async importCharacter(blob: Blob) {
      const imported = await readCharacterDraftZip(blob, inspectCharacterImage)
      const duplicateIdentity = (await listCharacterDrafts()).some(({ character }) => character.packId === imported.draft.packId)
      return persisted(characterDrafts.create({
        ...imported.draft,
        id: crypto.randomUUID(),
        ...(duplicateIdentity ? { packId: `character-${crypto.randomUUID()}` } : {}),
        updatedAt: Date.now(),
      }))
    },
  }

  const characterFit = async (group: CharacterVariantGroup, variantId: string) => {
    const { character, revision } = activeCharacter()
    const variant = character.variants.find((candidate) => candidate.group === group && candidate.id === variantId)
    const layer = variant && CHARACTER_CREATION_GROUPS.find((candidate) => candidate.group === group)?.layers.find((candidate) => variant.layers[candidate])
    if (!variant || !layer) throw new Error('Character variant is empty or missing')
    const { fit } = await measureCharacterFit(character, { group, variantId, layer })
    return { revision, fit }
  }

  const categoryFor = (group: CharacterVariantGroup) => group === 'expression' ? 'expressions'
    : group === 'outfit' ? 'outfits' : group === 'prop' ? 'props' : 'expressions'
  const characterPath = (characterId: string, group: CharacterVariantGroup = 'expression', variantId?: string) =>
    `/characters/${encodeURIComponent(characterId)}/${categoryFor(group)}${variantId && group !== 'body' ? `/${encodeURIComponent(variantId)}` : ''}`
  const routeSelection = (path: string) => {
    const match = /^\/characters\/([^/]+)(?:\/(expressions|outfits|props|profile|model-sheet)(?:\/([^/]+))?)?$/.exec(path)
    if (!match) return null
    try {
      return { characterId: decodeURIComponent(match[1]!), category: match[2] ?? null, variantId: match[3] ? decodeURIComponent(match[3]) : null }
    } catch { return null }
  }
  const characterNextActions = (draft: CharacterDraft) => {
    const missing = REQUIRED_CHARACTER_TARGETS.filter((target) => !hasCurrentCharacterLayer(draft, target.group, target.variantId, target.layer))
    return missing.length ? missing.map((target) => ({
      tool: 'inspect_character_contract',
      required: true,
      reason: `Inspect ${target.group}/${target.variantId}/${target.layer} before filling it.`,
      input: { characterId: draft.id, ...target },
    })) : []
  }
  const historyStatus = () => {
    const { activeCharacterId, persistedRevision, saveStatus } = editor.store.getState()
    const { pastStates, futureStates } = editor.history.getState()
    return {
      characterId: activeCharacterId,
      revision: persistedRevision,
      appearanceId: editor.store.getState().character?.activeAppearanceId ?? null,
      canUndo: pastStates.length > 0 && saveStatus === 'saved',
      canRedo: futureStates.length > 0 && saveStatus === 'saved',
      saveStatus,
    }
  }

  async function updateCollectionProfile(rawInput: unknown) {
    const { collectionId, expectedRevision, ...patch } = rawInput as { collectionId: string; expectedRevision: number } & Partial<CharacterCollectionProfile>
    const book = (await collections.list()).find(({ id }) => id === collectionId)
    if (!book) throw new Error('Collection not found')
    if (collectionId === DEFAULT_CHARACTER_COLLECTION && patch.name !== undefined && patch.name !== book.name) throw new Error('The default collection name is fixed')
    await collections.update(collectionId, { name: book.name, description: book.description, backstory: book.backstory, ...patch }, expectedRevision)
    characterChanges.publish({ characterId: collectionId, revision: null })
    return { status: 'ok', data: { collection: (await collections.list()).find(({ id }) => id === collectionId) }, nextActions: [] }
  }

  const collectionFor = async (characterId: string) => {
    const books = await collections.list()
    const book = books.find(({ characterIds }) => characterIds.includes(characterId)) ?? books.find(({ id }) => id === DEFAULT_CHARACTER_COLLECTION)!
    return { id: book.id, name: book.name, description: book.description, backstory: book.backstory, revision: book.version }
  }

  async function inspectWorkspace(rawInput: unknown) {
    const { includeSnapshot = false } = rawInput as { includeSnapshot?: boolean }
    const route = browser?.location.pathname ?? '/'
    const view = readWorkspaceView(document)
    const books = await collections.list()
    const visualLibrary = await worldLibrary.load()
    const selectedRoute = routeSelection(route)
    const records = await listCharacterDrafts()
    const saved = records.find(({ character }) => character.id === selectedRoute?.characterId)
    const current = saved ? await editor.view(saved.character.id) : selectedRoute?.characterId === 'new' ? (await editor.open('new'), await editor.view('new')) : null
    const character = current?.character ?? null
    const renderSnapshot = async () => {
      const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason })
      if (view?.boardId) return unavailable('Use inspect_storyboard with boardId and explicit image IDs to view the original storyboard images.')
      if (view?.locationId || view?.photoId) {
        if (view.hasUncommittedInput) return unavailable('Finish or cancel local edits before requesting a snapshot.')
        const location = visualLibrary.locations.find((l) => l.id === view.locationId)
        const photo = visualLibrary.photos.find((p) => p.id === view.photoId)
        const image = photo?.image ?? location?.images.find((i) => i.purpose === 'design')?.image ?? location?.images[0]?.image
        if (!image) return unavailable('This setting has no image yet.')
        const dataUrl = await readDataUrl(await worldLibrary.image(image.sha256))
        if (browser?.location.pathname !== route || (await worldLibrary.load()).revision !== visualLibrary.revision) return unavailable('The source changed while loading; inspect again.')
        return { status: 'ready', source: photo ? 'album-photo' : 'location-setting', ...image, dataUrl }
      }
      if (!character || !current) return unavailable('No Character is open. Ask the user to open the Character they want feedback on.')
      if (view?.hasUncommittedInput) return unavailable('The view has uncommitted input. Finish or cancel the local edit, then inspect again.')
      const state = editor.store.getState()
      if (state.saveStatus !== 'saved') return unavailable('Character changes are not saved. Wait for saving, or resolve the save error, then inspect again.')
      if (view?.characterId !== character.id || view.revision !== current.version || state.activeCharacterId !== character.id
        || state.persistedRevision !== current.version || view.category !== selectedRoute?.category || view.viewedVariantId !== selectedRoute?.variantId) {
        return unavailable('The rendered view and Character revision do not match. Let the page finish rendering, then inspect again.')
      }
      if (view.category === 'model-sheet') {
        const referenceId = view.referenceView ?? selectedRoute?.variantId
        const reference = referenceId ? modelSheetReferences(characterModelSheet(character))[referenceId] : undefined
        if (!reference) return unavailable('Open a reference image or call inspect_character_contract with scope:model-sheet and images:[referenceId]. Request images:["appearance"] for the current Appearance separately.')
        return { status: 'ready' as const, source: 'model-sheet-reference', characterId: character.id, revision: current.version, referenceId,
          ...describeReference(reference), dataUrl: await readDataUrl(reference.asset.blob), instruction: MODEL_SHEET_REVIEW.instruction }
      }
      const preview = view.viewedVariantId ? character.variants.find((variant) =>
        variant.id === view.viewedVariantId && categoryFor(variant.group) === view.category && variant.group !== 'body'
      ) : undefined
      if (view.viewedVariantId && !preview) return unavailable('The viewed variant is no longer available. Inspect the current page again.')
      const layers = resolveCharacterDraftLayers(character, preview)
      if (!layers.length) return unavailable('This Character preview has no artwork to review yet.')
      const dataUrl = await renderCharacterCompositeDataUrl(layers)
      const latest = editor.store.getState()
      if (browser?.location.pathname !== route || JSON.stringify(readWorkspaceView(document)) !== JSON.stringify(view)
        || latest.character !== state.character || latest.persistedRevision !== current.version || latest.saveStatus !== 'saved') {
        return unavailable('The Character or page changed while rendering the snapshot. Inspect again for the current result.')
      }
      return {
        status: 'ready' as const,
        characterId: character.id,
        revision: current.version,
        source: 'current-view-composite',
        preview: preview ? { group: preview.group, id: preview.id } : null,
        layerIds: layers.map(({ id }) => id),
        mediaType: 'image/png',
        ...CHARACTER_RIG.canvas,
        dataUrl,
        instruction: 'Open or decode and view this PNG before giving visual feedback. It is the full current composition with real alpha, without Overlay/Difference/Align guides. Metadata or a base64 string alone is not visual evidence. Give the requested opinion; modify artwork only when the user asks.',
      }
    }
    const missingCharacterTargets = character ? REQUIRED_CHARACTER_TARGETS
      .filter((target) => !hasCurrentCharacterLayer(character, target.group, target.variantId, target.layer)) : REQUIRED_CHARACTER_TARGETS
    const navigation = [{ destination: 'home', path: '/' }, { destination: 'albums', path: '/albums' }, { destination: 'storyboards', path: '/storyboards' }, { destination: 'characters', path: '/collections' }, ...(character ? [
      { destination: 'character-expressions', path: characterPath(character.id, 'expression') },
      { destination: 'character-outfits', path: characterPath(character.id, 'outfit') },
      { destination: 'character-props', path: characterPath(character.id, 'prop') },
      { destination: 'character-profile', path: `/characters/${encodeURIComponent(character.id)}/profile` },
      { destination: 'character-model-sheet', path: `/characters/${encodeURIComponent(character.id)}/model-sheet` },
    ] : [])]
    const nextActions = character ? characterNextActions(character) : [{
      tool: 'navigate_character', required: false, reason: records.length ? 'Open a Character before editing its assets.' : 'Open a new Character workshop.', input: records.length ? { destination: 'characters' } : { destination: 'character-expressions', characterId: 'new' },
    }]
    return {
      status: 'ok',
      data: {
        route: { path: route, ...selectedRoute },
        view,
        contextFreshness: 'Snapshot at tool invocation, not a live subscription. Re-inspect after user navigation, panel/preview changes, and tool mutations. viewedVariantId is the variant being previewed; currentCharacter.selected is the applied composition. Uncommitted form, numeric, and drag inputs are not included in the Character contract; inspect the visible UI and let those edits settle before mutating.',
        storyboards: (await storyboards.inspect()).boards,
        currentStoryboard: view?.boardId ? await storyboards.inspect(view.boardId) : null,
        currentCollection: books.find(({ id }) => id === view?.collectionId) ?? null,
        collections: books,
        visualLibrary: { revision: visualLibrary.revision, albums: visualLibrary.albums, folders: visualLibrary.folders,
          locations: visualLibrary.locations.map(({ id, collectionId, parentId, name, tags }) => ({ id, collectionId, parentId, name, tags })),
          currentLocation: visualLibrary.locations.find((l) => l.id === view?.locationId) ?? null,
          currentPhoto: visualLibrary.photos.find((p) => p.id === view?.photoId) ?? null,
          currentAlbum: view?.albumId ? { album: visualLibrary.albums.find((a) => a.id === view.albumId), photos: visualLibrary.photos.filter((p) => p.albumId === view.albumId) } : null,
          currentFolder: visualLibrary.folders.find((f) => f.id === (view?.folderId ?? (view?.boardId ? visualLibrary.boardFolders[view.boardId] : null))) ?? null,
          policy: 'Location hierarchy supplies spatial/world context; local settings and conditions take precedence. Inspiration images are not adopted designs. Pinned storyboard references are snapshots and do not follow source edits.' },
        characters: records.map(({ character: draft, version }) => ({
          id: draft.id,
          name: draft.name,
          description: draft.description ?? '',
          revision: version,
          updatedAt: draft.updatedAt,
        })),
        currentCharacter: character && current ? {
          id: character.id,
          name: character.name,
          description: character.description ?? '',
          backstory: character.backstory ?? '',
          attributes: character.attributes ?? {},
          heightCm: character.modelSheet?.heightCm ?? null,
          modelSheet: describeModelSheet(character),
          collection: await collectionFor(character.id),
          revision: current.version,
          updatedAt: character.updatedAt,
          selected: character.selected,
          ...describeAppearances(character),
          missingTargets: missingCharacterTargets,
        } : null,
        ...(includeSnapshot ? { snapshot: await renderSnapshot() } : {}),
        history: historyStatus(),
        navigation,
        assetPolicy: view?.surface?.startsWith('storyboard') ? 'Storyboard PNG originals retain their dimensions and opacity. Use inspect_storyboard for exact selections, pinned references and source images.' : view?.category === 'model-sheet' ? MODEL_SHEET_POLICY : CHARACTER_ASSET_POLICY,
      },
      nextActions: view?.surface?.startsWith('storyboard') ? [{ tool: 'inspect_storyboard', required: false, reason: 'Inspect the storyboard and request exact image IDs before visual feedback.', input: view.boardId ? { boardId: view.boardId } : {} }] : view?.category === 'model-sheet' && character ? [{ tool: 'inspect_character_contract', required: false, reason: 'Inspect the reference task and explicitly request source images before generating art.', input: { characterId: character.id, scope: 'model-sheet', referenceId: view.referenceView ?? selectedRoute?.variantId ?? 'front' } }] : nextActions,
    }
  }

  async function navigateCharacter(rawInput: unknown) {
    const { destination, characterId, variantId, referenceId } = rawInput as {
      referenceId?: string
      destination: 'characters' | 'character-expressions' | 'character-outfits' | 'character-props' | 'character-model-sheet' | 'character-profile'
      characterId?: string
      variantId?: string
    }
    if (destination === 'characters') {
      return { status: 'ok', data: { destination, path: '/collections' }, nextActions: [], effects: { navigation: { path: '/collections', mode: 'push', reason: 'Open the Character library.' } } }
    }
    const character = characterId ? await editor.open(characterId) : null
    if (!character) throw new Error('A valid Character ID is required for this destination')
    if (destination === 'character-profile') {
      if (variantId || referenceId) throw new Error('Character profile has no variant or reference target')
      const path = `/characters/${encodeURIComponent(character.id)}/profile`
      return { status: 'ok', data: { path }, effects: { navigation: { path, mode: 'push', reason: 'Open Character profile with the current Appearance.' } } }
    }
    if (destination === 'character-model-sheet') {
      if (referenceId && !modelSheetReferences(characterModelSheet(character))[referenceId]) throw new Error('Reference not found; inspect the model sheet first')
      const path = modelSheetPath(character.id, referenceId)
      return { status: 'ok', data: { path }, effects: { navigation: { path, mode: 'push', reason: 'Open the Character model sheet.' } } }
    }
    const group = destination === 'character-expressions' ? 'expression' : destination === 'character-outfits' ? 'outfit' : 'prop'
    if (variantId && !character.variants.some((variant) => variant.group === group && variant.id === variantId)) throw new Error('Character variant not found')
    const path = characterPath(character.id, group, variantId)
    return { status: 'ok', data: { destination, characterId: character.id, variantId: variantId ?? null, path }, nextActions: [], effects: { navigation: { path, mode: 'push', reason: variantId ? 'Open the exact Character variant.' : 'Open the Character category.' } } }
  }

  async function updateProfile(rawInput: unknown) {
    const { characterId, expectedRevision, ...patch } = rawInput as CharacterProfilePatch & { characterId: string; expectedRevision: number }
    if (!Object.keys(patch).length) throw new Error('At least one Character profile field is required')
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before editing the Character profile')
    await editor.open(characterId)
    const changed = await editor.dispatch((character) => updateCharacterProfile(character, patch), expectedRevision)
    const character = activeCharacter().character
    const revision = settledRevision('Character profile')
    const path = `/characters/${encodeURIComponent(character.id)}/profile`
    return {
      status: 'ok',
      data: {
        characterId: character.id,
        profile: {
          name: character.name,
          description: character.description ?? '',
          backstory: character.backstory ?? '',
          attributes: character.attributes ?? {},
          heightCm: character.modelSheet?.heightCm ?? null,
        },
        revision,
        changed,
      },
      nextActions: characterNextActions(character),
      effects: { navigation: { path, mode: 'push', reason: 'Open the updated Character profile.' } },
    }
  }

  async function prepareAppearanceReferences(draft: CharacterDraft, previous: CharacterDraft | null): Promise<CharacterDraft> {
    const composition = (character: CharacterDraft) => JSON.stringify(resolveCharacterDraftPlacements(character).map(({ variant, layer, transform }) =>
      [variant.layers[layer]!.inspection.sha256, transform]))
    let result = draft
    for (const id of draft.appearances?.map((look) => look.id) ?? [undefined]) {
      const look = draft.appearances?.find((item) => item.id === id)
      const before = previous?.appearances?.find((item) => item.id === id)
      const current = { ...draft, activeAppearanceId: id, selected: look?.selected ?? draft.selected }
      const old = previous && { ...previous, activeAppearanceId: id, selected: before?.selected ?? previous.selected }
      const changed = Boolean(old && (!look || before) && composition(current) !== composition(old))
      // Add new deliberately supplies an empty sheet; only an uninitialized look gets an initial front.
      const opened = draft.activeAppearanceId === id && !look?.modelSheet && (previous?.activeAppearanceId !== id || !before && look)
      if (!changed && !opened) continue
      let sheet = characterModelSheet(current)
      const front = sheet.views.front
      // Older captured fronts already identify their own PNG as their source.
      const followsAppearance = front?.fromAppearance ?? (front?.asset.filename === 'front-appearance.png' && front.sourceSha256 === front.asset.inspection.sha256)
      const hasArt = resolveCharacterDraftLayers(current).length > 0
      if ((!front || followsAppearance) && hasArt) {
        const asset = await editor.stageAsset(await application.exportCharacterPng(current), 'front-appearance.png', front?.asset.source ?? 'user', undefined, 'reference')
        if (front?.asset.inspection.sha256 === asset.inspection.sha256) continue
        sheet = setModelSheetReference(sheet, 'front', { ...front, asset, fromAppearance: true, sourceSha256: asset.inspection.sha256, guides: undefined, needsReview: undefined })
      }
      if (changed) for (const [referenceId, reference] of Object.entries(modelSheetReferences(sheet))) {
        if (referenceId !== 'front' || !sheet.views.front?.fromAppearance || !hasArt) sheet = setModelSheetReference(sheet, referenceId, { ...reference, needsReview: true })
      }
      const updated = withCharacterModelSheet({ ...result, activeAppearanceId: id }, sheet)
      result = { ...updated, activeAppearanceId: draft.activeAppearanceId }
    }
    return result
  }

  async function applyCharacterAppearance(characterId: string, command: CharacterAppearanceCommand, expectedRevision: number) {
    await editor.open(characterId)
    const { character, revision } = activeCharacter()
    if (revision !== expectedRevision) throw new Error('Character changed; inspect it again')
    const next = changeCharacterAppearance(character, command)
    const changed = await editor.dispatch((current) => {
      if (current !== character) throw new Error('Character changed; inspect it again')
      return next
    }, expectedRevision)
    settledRevision('Appearance')
    return changed
  }

  async function setCharacterSelection(rawInput: unknown) {
    const { characterId, expectedRevision, group, variantId, active, appearance } = rawInput as {
      characterId: string
      expectedRevision: number
      group: 'expression' | 'outfit' | 'prop'
      variantId: string
      active: boolean
      appearance?: CharacterAppearanceCommand
    }
    if (appearance ? group !== undefined || variantId !== undefined || active !== undefined
      : !['expression', 'outfit', 'prop'].includes(group) || typeof variantId !== 'string' || typeof active !== 'boolean') throw new Error('Choose either appearance or group/variantId/active')
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before changing Appearance')
    await editor.open(characterId)
    const target = { group, id: variantId }
    const changed = appearance ? await applyCharacterAppearance(characterId, appearance, expectedRevision)
      : await editor.dispatch((character) => active
      ? activateCharacterVariant(character, target)
      : deactivateCharacterVariant(character, target), expectedRevision)
    const character = activeCharacter().character
    return {
      status: 'ok',
      data: {
        characterId: character.id,
        selected: character.selected,
        ...describeAppearances(character),
        modelSheet: describeModelSheet(character),
        revision: settledRevision('Character selection'),
        changed,
      },
      nextActions: characterNextActions(character),
      effects: { navigation: { path: characterPath(character.id, appearance ? 'expression' : group), mode: 'push', reason: 'Show the selected Character composition.' } },
    }
  }

  const measureCharacterFit = async (draft: CharacterDraft, target: Pick<CharacterAssetTarget, 'group' | 'variantId' | 'layer'>) => {
    const { asset, canonical, headRegistration, transform, alignmentReference, referenceTransform } = resolveCharacterAssetSources(draft, target)
    const measurement = asset ? measureCharacterMaskAlignment(
      target.group,
      alignmentReference ? await readCharacterAlphaMask(alignmentReference.blob) : null,
      await readCharacterAlphaMask(asset.blob),
      transform,
      referenceTransform,
    ) : null
    const visualFit = asset && canonical && target.group === 'expression' && headRegistration?.variant.id === target.variantId
      ? suggestCharacterVisualRegistration(await readCharacterVisualSample(canonical.blob), await readCharacterVisualSample(asset.blob), transform)
      : null
    const fit = suggestCharacterFit({
      measurement,
      visualFit,
      headAnchor: target.group === 'expression' && headRegistration?.variant.id === target.variantId,
    })
    return { measurement, visualFit, fit }
  }

  const characterTarget = async (draft: CharacterDraft, revision: number, rawInput: unknown) => {
    const input = rawInput as Partial<{ group: CharacterVariantGroup; variantId: string; layer: CharacterVariantLayer }>
    if (!input.group && !input.variantId && !input.layer) return null
    if (!input.group || !input.variantId || !input.layer) throw new Error('Character target requires group, variantId, and layer')
    const group = CHARACTER_CREATION_GROUPS.find(({ group }) => group === input.group)
    if (!group || !group.layers.includes(input.layer) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(input.variantId)) throw new Error('Unknown character asset target')
    if (input.group === 'body' && input.variantId !== 'base') throw new Error('The body group only supports body/base/body')
    const { asset, headRegistration, current, transform, alignmentReference, referenceTransform, editSource, editSourceTransform } = resolveCharacterAssetSources(draft, input as CharacterAssetTarget)
    const label = draft.variants.find(({ group, id }) => group === input.group && id === input.variantId)?.label ?? input.variantId
    const registrationFrame = characterRegistrationFrame(draft)
    const allowedOperations = [
      'replace' as const,
      ...(current && input.group === 'expression' ? ['repair' as const] : []),
      ...(current && input.group !== 'body' ? ['transform' as const] : []),
    ]
    const { measurement, visualFit, fit } = await measureCharacterFit(draft, input as CharacterAssetTarget)
    const currentBounds = asset?.inspection.visibleBounds ? transformCharacterBounds(asset.inspection.visibleBounds, transform) : undefined
    const overflow = currentBounds ? {
      left: Math.max(0, -currentBounds.x),
      top: Math.max(0, -currentBounds.y),
      right: Math.max(0, currentBounds.x + currentBounds.width - CHARACTER_RIG.canvas.width),
      bottom: Math.max(0, currentBounds.y + currentBounds.height - CHARACTER_RIG.canvas.height),
    } : undefined
    const placementLayers = resolveCharacterDraftReferenceLayers(draft, { group: input.group, id: input.variantId })
    const placement = characterAssetPlacement(input.group, input.layer)
    const lineage = input.group === 'body' ? 'establish-canonical'
      : input.group === 'expression' ? headRegistration ? 'derive-from-head-registration' : 'establish-head-registration'
        : input.group === 'outfit' ? 'replace-character-skin'
          : 'place-against-current-composite'
    const editableRegion = current && input.group === 'expression' ? registrationFrame.editableRegions.expression : undefined
    const referenceBounds = characterReferenceBounds(registrationFrame, input.group)
    const normalization = {
      ...characterNormalizationContract(Boolean(referenceBounds)),
      referenceVisibleBounds: referenceBounds ?? null,
    }
    const protectedRegionDelta = asset && editSource && editableRegion
      ? measureProtectedRegionDelta(
          await readCharacterPixels(editSource.blob, editSourceTransform),
          await readCharacterPixels(asset.blob, transform),
          editableRegion,
        )
      : null
    const reviewPath = characterPath(draft.id, input.group, input.variantId)
    const visualReview = input.group !== 'body' ? {
      ...CHARACTER_VISUAL_REVIEW,
      requiredAfterMutation: true,
      path: reviewPath,
      correctionTool: 'set_character_variant_transform',
      correctionScope: 'translation-and-uniform-scale-only',
      current: transform,
      axes: { x: 'right-positive', y: 'down-positive' },
      regenerateWhen: ['local deformation', 'wrong pose', 'identity drift', 'bad transparency'],
    } : { requiredAfterMutation: true, path: reviewPath, instruction: CHARACTER_A_POSE_GUIDANCE, checks: ['View the actual PNG: A-pose, complete silhouette, neutral face, identity and proportions.', 'Check real alpha and edges on light and dark backgrounds.'] }
    const replacementAction = {
      tool: 'replace_character_asset',
      required: !current,
      reason: current ? 'Replace this asset only when the user has a complete finished layer.' : 'Install the final exact-canvas RGBA target layer without preserving old pixels.',
      input: {
        characterId: draft.id,
        group: input.group,
        variantId: input.variantId,
        label,
        layer: input.layer,
        expectedRevision: revision,
        expectedAssetSha256: asset?.inspection.sha256 ?? null,
        normalization: normalization.recommended,
      },
    }
    const repairAction = current && input.group === 'expression' ? {
      tool: 'repair_character_asset',
      required: false,
      reason: 'Repair only the editable region of this existing asset; protected pixels remain byte-identical.',
      input: {
        characterId: draft.id,
        group: input.group,
        variantId: input.variantId,
        label,
        layer: input.layer,
        expectedRevision: revision,
        expectedAssetSha256: asset!.inspection.sha256,
        normalization: normalization.recommended,
      },
    } : null
    const maskFit = fit.status === 'suggested' && fit.source === 'mask-alignment'
    const fitActions = fit.status !== 'suggested' ? [] : [{
      tool: 'set_character_variant_transform',
      required: maskFit,
      reason: maskFit
        ? 'Apply the suggested absolute transform, then inspect the alpha-mask alignment again.'
        : 'Try the experimental native pixel-and-edge correlation fit, then visually review the head alignment view.',
      input: { characterId: draft.id, group: input.group, variantId: input.variantId, expectedRevision: revision, ...fit.transform },
    }]
    const mutationActions = repairAction ? [repairAction, replacementAction] : [replacementAction]
    const nextActions = !current ? [replacementAction]
      : maskFit ? fitActions
      : fitActions.length ? [...fitActions, ...mutationActions]
      : [...mutationActions, {
        tool: 'navigate_character', required: false,
        reason: input.group === 'body' ? 'Open the Character editor for canonical-body preflight.' : 'Open this exact variant for visual preflight.', input: {
          destination: `character-${categoryFor(input.group)}`, characterId: draft.id,
          ...(input.group === 'body' ? {} : { variantId: input.variantId }),
        },
      }]
    return {
      input: { group: input.group, variantId: input.variantId, layer: input.layer },
      allowedOperations,
      expectedRevision: revision,
      current: asset ? {
        filled: true,
        current,
        filename: asset.filename,
        sha256: asset.inspection.sha256,
        transform,
      } : { filled: false, current: false, transform },
      required: REQUIRED_CHARACTER_TARGETS.some((target) => target.group === input.group && target.variantId === input.variantId && target.layer === input.layer),
      acceptance: CHARACTER_ASSET_POLICY.layers[input.group],
      placement: { slot: placement.slot, slotOrder: CHARACTER_RIG.slots.find(({ id }) => id === placement.slot)!.order, layerOrder: placement.order },
      alignmentReference: alignmentReference ? {
        filename: alignmentReference.filename,
        sha256: alignmentReference.inspection.sha256,
        transform: referenceTransform ?? { x: 0, y: 0, scale: 1 },
        dataUrl: await readDataUrl(alignmentReference.blob),
      } : null,
      editSource: editSource ? {
        filename: editSource.filename,
        sha256: editSource.inspection.sha256,
        transform: editSourceTransform ?? { x: 0, y: 0, scale: 1 },
        coordinates: 'final-canvas',
        visibleBounds: editSource.inspection.visibleBounds && editSourceTransform
          ? transformCharacterBounds(editSource.inspection.visibleBounds, editSourceTransform)
          : editSource.inspection.visibleBounds,
        dataUrl: editSourceTransform ? await renderCharacterCompositeDataUrl([{
          id: 'edit-source', blobId: 'edit-source', slot: 'expression-head',
          slotOrder: 35, layerOrder: 0, transform: editSourceTransform, blob: editSource.blob,
        }]) : await readDataUrl(editSource.blob),
      } : null,
      editableRegion: editableRegion ? {
        ...editableRegion,
        mask: {
          filename: `${input.group}-${input.variantId}-${input.layer}-edit-mask.png`,
          mediaType: 'image/png',
          semantics: 'transparent-editable-opaque-protected',
          dataUrl: renderCharacterEditMaskDataUrl(editableRegion),
        },
      } : null,
      ownership: input.group === 'expression' ? {
        assetRole: 'whole-head',
        outside: 'transparent',
        bounds: registrationFrame.headEnvelope?.bounds ?? null,
      } : input.group === 'outfit' ? {
        assetRole: 'complete-character-skin',
        referenceSilhouetteCompatibility: 'required',
        exactCanonicalPixelCoverage: 'not-required',
      } : {
        assetRole: input.group === 'body' ? 'complete-character-skin' : 'prop-layer',
      },
      generationRecipe: {
        lineage,
        ...(input.group === 'body' ? { pose: 'a-pose', instruction: CHARACTER_A_POSE_GUIDANCE } : {}),
        method: 'reference-guided-generation',
        placementReference: placementLayers.length ? {
          layerCount: placementLayers.length,
          dataUrl: await renderCharacterCompositeDataUrl(placementLayers),
        } : null,
        preserveCanvasCoordinates: true,
        backgroundPreparation: CHARACTER_BACKGROUND_GUIDANCE,
        output: {
          generateAt: { ...CHARACTER_GENERATION_CANVAS },
          finalizeAt: { ...CHARACTER_RIG.canvas },
          rgba: true,
          realAlpha: true,
          content: input.group === 'body' || input.group === 'outfit' ? 'complete-character'
            : input.group === 'expression' ? 'complete-whole-head' : 'prop-layer',
        },
      },
      alignment: {
        mode: input.group === 'expression' ? 'whole-head-bounds'
          : input.group === 'outfit' ? 'pose-frame'
            : input.group === 'prop' ? 'composite-review'
              : 'establish-frame',
        transform,
        referenceBounds: measurement && 'metrics' in measurement && measurement.metrics && 'referenceBounds' in measurement.metrics
          ? measurement.metrics.referenceBounds : undefined,
        candidateBounds: currentBounds,
        overflow,
        measurement,
        protectedRegionDelta,
        autoFit: fit,
        visualFit,
        normalization,
        visualReview,
        registration: input.group === 'expression' ? {
          role: headRegistration?.variant.id === input.variantId ? 'head-anchor' : 'follower',
          anchorVariantId: headRegistration?.variant.id ?? null,
          calibration: headRegistration?.variant.id === input.variantId ? {
            status: 'visual-required',
            compareAgainst: 'canonical-body-default-head',
            tool: 'set_character_variant_transform',
            rebasesCurrentExpressions: true,
          } : null,
        } : null,
        reviewPath,
      },
      nextActions,
    }
  }

  async function inspectCharacterContract(rawInput: unknown) {
      const { characterId, scope = 'appearance', ...targetInput } = rawInput as { characterId: string; scope?: 'appearance' | 'model-sheet' }
      if (scope === 'model-sheet') return inspectModelSheetContract(rawInput)
      if (['referenceId', 'images', 'label', 'kind', 'viewpoint', 'pose', 'sourceSha256'].some((key) => key in targetInput)) throw new Error('Reference inputs require scope:model-sheet')
      const { character: draft, version } = await editor.view(characterId)
      const canonical = draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body
      const target = await characterTarget(draft, version, targetInput)
      return {
        status: 'ok',
        data: {
          collection: await collectionFor(draft.id),
          rig: CHARACTER_RIG,
          creationGroups: CHARACTER_CREATION_GROUPS,
          variants: draft.variants.map((variant) => ({
            group: variant.group,
            id: variant.id,
            label: variant.label,
            layers: CHARACTER_CREATION_GROUPS.find(({ group }) => group === variant.group)!.layers.map((layer) => ({
              layer,
              filled: Boolean(variant.layers[layer]),
              current: isCharacterDraftAssetCurrent(draft, variant, layer),
            })),
          })),
          character: {
            id: draft.id,
            name: draft.name,
            description: draft.description ?? '',
            backstory: draft.backstory ?? '',
            attributes: draft.attributes ?? {},
            heightCm: draft.modelSheet?.heightCm ?? null,
            selected: draft.selected,
            ...describeAppearances(draft),
            revision: version,
          },
          modelSheet: describeModelSheet(draft),
          modelSheetPolicy: MODEL_SHEET_POLICY,
          registrationFrame: characterRegistrationFrame(draft),
          canonicalReference: canonical ? {
            filename: canonical.filename,
            sha256: canonical.inspection.sha256,
            ...(target ? {} : { dataUrl: await readDataUrl(canonical.blob) }),
          } : null,
          productionBrief: [
            'Use collection.backstory as shared world context, together with the Character’s own profile. Do not overwrite personal backstory with collection context.',
            CHARACTER_A_POSE_GUIDANCE,
            'The canonical body is a visual reference, never an expression edit source. Replace the first expression with a head-only layer; the first accepted whole head establishes registration for later expressions.',
            'An outfit replaces the character-skin slot: replace it with the complete dressed character, never a clothing-only overlay. Preserve pose, body center, head position, and foot line. Generate props against the returned current composite.',
            'Generate at 1024×1536. When the inspected target recommends exact-aspect-downscale, request it during submission; otherwise finalize externally at the exact 512×768 canvas. Never crop, reframe, or stretch.',
            CHARACTER_BACKGROUND_GUIDANCE,
            'Use replace_character_asset for every outfit and any other complete finished layer; it never preserves old pixels. Use repair_character_asset only for an existing expression; transparent mask pixels are editable, opaque pixels are protected, and protectedRegionDelta must be 0.',
            'Submit only full-canvas RGBA PNG proposals, either already at 512×768 or with the explicit normalization allowed by the inspected target. The website never generates, removes backgrounds, or guesses geometry; expression repair alone uses the deterministic editable region.',
            'Expression layers contain only the whole aligned head, including the same fixed hairstyle and facial hair; every pixel outside head ownership must be transparent.',
            'No expression overlay means the default face baked into the body. Optional whole-head variants include happy, sad, angry, surprised, and sleepy; additional variants are allowed.',
            'Outfits are full-body variants. Props are independent, multi-select, full-canvas overlays and may contain front and back layers. A prop may be positioned anywhere, including on the head or in a hand.',
            'selected.props is the persisted bottom-to-top activation order within each front/back rig slot. Use set_character_variant_selection to add or remove variants: later-added props stack above earlier props; an already-active prop keeps its order; remove then add it to move it to the top.',
            CHARACTER_NAVIGATION_GUIDANCE,
            CHARACTER_VISUAL_REVIEW.instruction,
            CHARACTER_VISUAL_REVIEW.finish,
          ],
          assetPolicy: CHARACTER_ASSET_POLICY,
          target,
        },
        nextActions: target?.nextActions ?? characterNextActions(draft),
      }
  }

  type CharacterAssetMutationInput = {
    characterId: string
    group: CharacterVariantGroup
    variantId: string
    label: string
    layer: CharacterVariantLayer
    expectedRevision: number
    expectedAssetSha256: string | null
    filename: string
    dataUrl?: string
    normalization?: CharacterNormalization
  }

  async function inspectModelSheetContract(rawInput: unknown) {
    const { characterId, referenceId, images = [], scope: _scope, ...metadata } = rawInput as CharacterReferenceMetadata & { characterId: string; referenceId?: string; images?: string[]; scope: string }
    if (['group', 'variantId', 'layer'].some((key) => key in metadata)) throw new Error('Model-sheet references do not use Appearance group/variant/layer targets')
    if (referenceId) validateReferenceId(referenceId)
    const { character: draft, version } = await editor.view(characterId)
    const references = modelSheetReferences(characterModelSheet(draft))
    const current = referenceId ? references[referenceId] : undefined
    const sourceImages = await Promise.all(images.map(async (id) => {
      const asset = id === 'canonical' ? draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body : references[id]?.asset
      const blob = id === 'appearance' ? await application.exportCharacterPng(draft) : asset?.blob
      if (!blob || (id === 'appearance' && !resolveCharacterDraftLayers(draft).length)) throw new Error(`Source image ${id} is missing; inspect the model sheet or create Appearance first`)
      const inspection = asset?.inspection ?? await inspectCharacterImage(blob)
      return { id, filename: asset?.filename ?? 'appearance.png', sha256: inspection.sha256, width: inspection.width, height: inspection.height,
        ...(id === 'appearance' ? { selected: draft.selected } : {}), dataUrl: await readDataUrl(blob) }
    }))
    const submission = referenceId ? { characterId: draft.id, expectedRevision: version, referenceId, ...metadata,
      expectedAssetSha256: current?.asset.inspection.sha256 ?? null } : undefined
    const nextActions = submission ? [{ tool: 'update_character_model_sheet', required: false,
      reason: 'After generating and visually checking art, add filename/dataUrl and the source image hash to this template. For metadata-only edits, add notes or guides.', input: submission },
      ...(referenceId === 'front' ? [{ tool: 'update_character_model_sheet', required: false, reason: 'Capture the actual current Appearance into front without regenerating it; then visually review its pose.', input: { ...submission, fromAppearance: true } }] : [])] : []
    return { status: 'ok', data: {
      character: { id: draft.id, name: draft.name, description: draft.description ?? '', backstory: draft.backstory ?? '', attributes: draft.attributes ?? {}, heightCm: draft.modelSheet?.heightCm ?? null, revision: version, selected: draft.selected, ...describeAppearances(draft) },
      collection: await collectionFor(draft.id), modelSheet: describeModelSheet(draft), assetPolicy: MODEL_SHEET_POLICY,
      sourceImages, target: referenceId ? { referenceId, current: current ? describeReference(current) : null, ...metadata } : null,
      productionBrief: [
        'References belong to modelSheet.appearanceId. Edits automatically save into the current Appearance, including its expression/outfit/ordered props. Use set_character_variant_selection with appearance:{action:"save-as",id,label} BEFORE editing to keep the original look, appearance:{action:"create",id,label} for a new look with no selected variants or references, appearance:{action:"select",id} to switch, or appearance:{action:"delete",id} to remove a look and its references (keep at least one). Shared assets are retained. Switching waits for saving and starts a new Appearance undo session. Shared variant art affects all looks that use it. Captured fronts follow composition edits; existing other views are retained with needsReview:true after the composition changes. Inspect and visually compare them before replacing art or clearing needsReview. Default adopts legacy working art in memory; reads do not save. Save-as keeps the combination with a front and empty other views; create keeps the shared body/assets with no selected variants and an empty sheet.',
        'Use images:["appearance"] for the current composed outfit/expression/props; canonical is only the base body. Use stored reference IDs (for example front) for an established sheet baseline. Open/decode and actually view each source PNG before generating.',
        'Keep one consistent outfit and identity across the four turnaround views. Save as captures the new look’s front; use fromAppearance to explicitly fill or replace one. Add new leaves references empty until you add them or edit the composition. Do not create a second mandatory A-pose. T-pose and raised-arm images use separate supplemental IDs with kind:structure.',
        'Create only the reference requested: a complete full-body view, head angle sheet, expression sheet, pose, detail or palette sheet. Use label, kind, viewpoint and pose to identify it. New supplemental references require label and kind.',
        'Generate PNG with a neutral background that does not interfere with silhouette or color judgment, or a transparent background; choose according to the reference purpose. Use an appropriate original canvas, at most 4096 × 4096 and 5 MiB. No background removal or 512 × 768 normalization is needed for references. Do not fit a wide T-pose to the Appearance silhouette.',
        'Supply sourceSha256 from the image used as the primary source. Set optional heightCm through update_character_profile (null clears it); never put it in custom attributes. Height is a character property; image guides are y fractions from the top. Do not infer centimeters from pixels or calibrate a head/detail collage as full-body height.',
        'Landmark editing, automatic lineup and approval workflow are planned, not available tools. Do not add skeleton data or claim user approval in metadata.',
      ], visualReview: { ...MODEL_SHEET_REVIEW, path: modelSheetPath(draft.id, current ? referenceId : undefined) },
    }, nextActions }
  }

  async function updateModelSheet(rawInput: unknown, providedBlob?: Blob, source: 'user' | 'agent' = 'agent') {
    const input = rawInput as ModelSheetInput
    const { characterId, expectedRevision, view, referenceId = view, fromAppearance, remove, label, kind, viewpoint, pose, sourceSha256, needsReview } = input
    if (view !== undefined && (!isTurnaroundView(view) || (input.referenceId && input.referenceId !== view))) throw new Error('Use one referenceId; view is only an alias for a default turnaround slot')
    if (referenceId) validateReferenceId(referenceId)
    if (fromAppearance && (referenceId !== 'front' || input.dataUrl || providedBlob || input.filename || remove)) throw new Error('fromAppearance captures front only; omit file input and remove')
    if (remove && (input.dataUrl || providedBlob || input.notes !== undefined || input.guides !== undefined || label || kind || viewpoint || pose || sourceSha256 || needsReview !== undefined)) throw new Error('Remove cannot be combined with reference edits')
    const editsReference = input.notes !== undefined || input.guides !== undefined || input.dataUrl || providedBlob || fromAppearance || remove || label || kind || viewpoint || pose || sourceSha256 || needsReview !== undefined
    if (!editsReference) throw new Error('No model sheet changes supplied')
    if (!referenceId && editsReference) throw new Error('Choose a referenceId')
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before editing the model sheet')
    await editor.open(characterId)
    const { character, revision } = activeCharacter()
    if (revision !== expectedRevision) throw new Error('Character changed; inspect it again')
    const references = modelSheetReferences(characterModelSheet(character))
    const previous = referenceId ? references[referenceId] : undefined
    if ((input.dataUrl || providedBlob || fromAppearance || remove) && input.expectedAssetSha256 !== (previous?.asset.inspection.sha256 ?? null)) throw new Error('Reference changed; inspect its current hash again')
    if (referenceId && !isTurnaroundView(referenceId) && !previous && (!label?.trim() || !kind)) throw new Error('New supplemental references require label and kind')
    if (fromAppearance && !resolveCharacterDraftLayers(character).length) throw new Error('Create Appearance before capturing front')
    const blob = fromAppearance ? await application.exportCharacterPng(character) : providedBlob ?? (input.dataUrl ? pngFromDataUrl(input.dataUrl) : undefined)
    const filename = fromAppearance ? 'front-appearance.png' : input.filename
    if (blob && (!filename?.trim() || filename.length > 200)) throw new Error('A valid filename is required')
    if (sourceSha256 && !Object.values(references).some(({ asset }) => asset.inspection.sha256 === sourceSha256) &&
      !character.variants.some(({ layers }) => Object.values(layers).some((asset) => asset?.inspection.sha256 === sourceSha256)) &&
      (await inspectCharacterImage(await application.exportCharacterPng(character))).sha256 !== sourceSha256) throw new Error('Source image changed; inspect source images again')
    const asset = blob ? await editor.stageAsset(blob, filename!, source, undefined, 'reference') : undefined
    await editor.dispatch((current) => {
      if (current.id !== character.id) throw new Error('Active Character changed; inspect it again')
      let sheet = characterModelSheet(current)
      const reference = referenceId ? modelSheetReferences(sheet)[referenceId] : undefined
      if (referenceId && !asset && !reference) throw new Error('Add reference art before editing or removing it')
      if (referenceId) sheet = setModelSheetReference(sheet, referenceId, remove ? undefined : {
        ...reference, ...(asset ? { asset, guides: undefined, sourceSha256: undefined, fromAppearance: fromAppearance || undefined, needsReview: undefined } : {}),
        ...(needsReview !== undefined ? { needsReview } : {}),
        ...(label !== undefined ? { label } : {}), ...(kind !== undefined ? { kind } : {}),
        ...(viewpoint !== undefined ? { viewpoint } : {}), ...(pose !== undefined ? { pose } : {}),
        ...(sourceSha256 || fromAppearance ? { sourceSha256: fromAppearance ? asset!.inspection.sha256 : sourceSha256 } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.guides !== undefined ? { guides: input.guides ?? undefined } : {}),
      } as CharacterReference)
      return updateCharacterModelSheet(current, sheet)
    }, expectedRevision)
    const saved = activeCharacter().character
    const path = modelSheetPath(saved.id, remove ? undefined : referenceId)
    return { status: 'ok', data: { accepted: true, characterId: saved.id, revision: settledRevision('Model sheet'), modelSheet: describeModelSheet(saved), visualReview: { ...MODEL_SHEET_REVIEW, path } },
      nextActions: [{ tool: 'inspect_workspace', required: true, reason: 'View the actual submitted reference and follow visualReview before continuing.', input: { includeSnapshot: true } }],
      effects: { navigation: { path, mode: 'push', reason: 'Review the exact Character reference.' } } }
  }

  const replaceCharacterAssetTool = (rawInput: unknown) => mutateCharacterAsset('replace', rawInput as CharacterAssetMutationInput)
  const repairCharacterAssetTool = (rawInput: unknown) => mutateCharacterAsset('repair', rawInput as CharacterAssetMutationInput)

  async function mutateCharacterAsset(
    mode: 'replace' | 'repair',
    input: CharacterAssetMutationInput,
    providedBlob?: Blob,
    source: 'user' | 'agent' = 'agent',
  ) {
      const requested = input.normalization ?? NO_CHARACTER_NORMALIZATION
      const target: CharacterAssetTarget = {
        group: input.group,
        variantId: input.variantId,
        label: input.label,
        layer: input.layer,
      }
      const group = CHARACTER_CREATION_GROUPS.find(({ group }) => group === target.group)
      if (!group || !group.layers.includes(target.layer) || (target.group === 'body' && target.variantId !== 'base')) throw new Error('Unknown character asset target')
      // Targeting another Character settles the active queue and switches sessions before validation.
      await editor.open(input.characterId)
      const { character: current, revision } = activeCharacter()
      if (revision !== input.expectedRevision) throw new Error(`Character changed; expected revision ${input.expectedRevision}, current ${revision}`)
      const sources = resolveCharacterAssetSources(current, target)
      const assetSha256 = sources.asset?.inspection.sha256 ?? null
      if (assetSha256 !== input.expectedAssetSha256) throw new Error('Character asset changed; inspect the target again')
      if (mode === 'repair' && (target.group !== 'expression' || target.layer !== 'head' || !sources.current || !sources.editSource)) {
        throw new Error('Repair requires a current expression head; use replace_character_asset for outfits and complete layers')
      }
      if (!(target.group === 'body' && target.variantId === 'base' && target.layer === 'body') && !sources.canonical) throw new Error('Submit body/base/body before derived character assets')
      const { filename } = input
      const submitted = providedBlob ?? pngFromDataUrl(input.dataUrl ?? '')
      const submittedInspection = await inspectCharacterImage(submitted)
      const registrationFrame = characterRegistrationFrame(current)
      const editableRegion = mode === 'repair' ? registrationFrame.editableRegions.expression : undefined
      const referenceBounds = characterReferenceBounds(registrationFrame, target.group)
      const contract = characterNormalizationContract(Boolean(referenceBounds))
      const alignmentMode = target.group === 'expression' ? 'whole-head-bounds'
        : target.group === 'outfit' ? 'pose-frame'
          : target.group === 'prop' ? 'composite-review' : 'establish-frame'

      let resizeScale: number | null = null
      let resizedBounds: CharacterBounds | undefined
      let alignTransform: CharacterVariantTransform | null = null
      let alignedBounds: CharacterBounds | null = null
      let afterResize: CharacterAlignmentMeasurement | null = null
      let afterAlignment: CharacterAlignmentMeasurement | null = null
      let finalSize: { width: number; height: number } | null = null
      let protectedRegionDelta: ReturnType<typeof measureProtectedRegionDelta> = null
      let ownership: ReturnType<typeof inspectCharacterAssetOwnership> = { status: 'valid' }
      // No normalization happens silently: accepted and rejected submissions both report this.
      const report = () => {
        const bounds = alignedBounds ?? resizedBounds
        return {
          requested,
          applied: {
            resize: resizeScale === null ? 'none' as const : 'exact-aspect-downscale' as const,
            align: alignTransform ? 'reference-visible-bounds' as const : 'none' as const,
          },
          input: { width: submittedInspection.width, height: submittedInspection.height },
          final: finalSize,
          scale: resizeScale,
          transform: alignTransform,
          referenceVisibleBounds: referenceBounds ?? null,
          candidateVisibleBounds: { afterResize: resizedBounds ?? null, afterAlignment: alignedBounds },
          overflow: bounds ? {
            left: Math.max(0, -bounds.x),
            top: Math.max(0, -bounds.y),
            right: Math.max(0, bounds.x + bounds.width - CHARACTER_RIG.canvas.width),
            bottom: Math.max(0, bounds.y + bounds.height - CHARACTER_RIG.canvas.height),
          } : null,
          metrics: { afterResize, afterAlignment },
          protectedRegionDelta,
        }
      }
      const rejected = (reason: string, rejection?: { code: string; message: string }) => ({
        status: 'ok',
        data: {
          accepted: false,
          target,
          filename,
          ...(rejection ? { rejection } : {}),
          inspection: {
            width: submittedInspection.width,
            height: submittedInspection.height,
            genuineRgba: submittedInspection.genuineRgba,
            hasTransparentPixels: submittedInspection.hasTransparentPixels,
            visibleBounds: submittedInspection.visibleBounds,
            visiblePixelCount: submittedInspection.visiblePixelCount,
          },
          normalization: report(),
          alignment: { mode: alignmentMode, measurement: afterAlignment ?? afterResize },
          ownership,
        },
        nextActions: [{
          tool: mode === 'replace' ? 'replace_character_asset' : 'repair_character_asset',
          required: true,
          reason,
          input: {
            characterId: current.id,
            group: target.group,
            variantId: target.variantId,
            label: target.label,
            layer: target.layer,
            expectedRevision: revision,
            expectedAssetSha256: assetSha256,
            normalization: contract.recommended,
          },
        }],
      })

      // 1. Deterministic downscale first, so strict inspection and stitching only ever see the exact rig canvas.
      const resize = planCharacterResize(requested.resize, submittedInspection)
      if (!resize.ok) return rejected(resize.message, { code: resize.code, message: resize.message })
      resizeScale = resize.scale
      const resized = resize.scale === null ? submitted : await renderCharacterCanvasDownscale(submitted)
      const inspection = resize.scale === null ? submittedInspection : await inspectCharacterImage(resized)
      resizedBounds = inspection.visibleBounds
      finalSize = { width: inspection.width, height: inspection.height }
      const invalidAsset = characterAssetInspectionRejection(inspection)
      if (invalidAsset) return rejected(invalidAsset.message, invalidAsset)

      // 2. One uniform scale plus translation onto the reference bounds this contract published.
      const referenceMask = sources.alignmentReference ? await readCharacterAlphaMask(sources.alignmentReference.blob) : null
      const candidateMask = await readCharacterAlphaMask(resized)
      if (target.group === 'expression') {
        ownership = inspectCharacterAssetOwnership(target.group, candidateMask, { headBounds: registrationFrame.headEnvelope?.bounds })
        if (ownership.status === 'invalid' && ownership.code === 'EXPRESSION_NOT_HEAD_ONLY') return rejected(ownership.message, { code: ownership.code, message: ownership.message })
      }
      afterResize = measureCharacterMaskAlignment(target.group, referenceMask, candidateMask, undefined, sources.referenceTransform)
      const align = planCharacterAlignment(requested.align, target.group, inspection.visibleBounds, referenceBounds)
      if (!align.ok) return rejected(align.message, { code: align.code, message: align.message })
      if (align.transform) {
        alignTransform = align.transform
        alignedBounds = align.bounds ?? null
        afterAlignment = measureCharacterMaskAlignment(target.group, referenceMask, candidateMask, align.transform, sources.referenceTransform)
      }

      // 3. The existing safety diagnostics decide, on the normalized pixels.
      const alignment = afterAlignment ?? afterResize
      if (alignment.status === 'invalid') {
        const diagnostic = alignment.diagnostics[0]
        return rejected(diagnostic?.message ?? 'Regenerate the rejected character asset.', diagnostic && { code: diagnostic.code, message: diagnostic.message })
      }

      // A requested alignment is baked into the stitched pixels, so it never competes with a mask auto-fit.
      const autoFit = alignTransform ?? highConfidenceCharacterAutoFit(alignment)
      ownership = inspectCharacterAssetOwnership(target.group, candidateMask, {
        headBounds: registrationFrame.headEnvelope?.bounds,
        transform: autoFit ?? undefined,
      })
      if (ownership.status === 'invalid') return rejected(ownership.message, { code: ownership.code, message: ownership.message })
      const stitchedBlob = mode === 'repair' && sources.editSource && editableRegion
        ? await renderStitchedCharacterEditBlob(
            sources.editSource.blob,
            resized,
            editableRegion,
            sources.editSourceTransform,
            autoFit ?? undefined,
          )
        : null
      const savedBlob = stitchedBlob ?? resized
      const savedInspection = stitchedBlob ? await inspectCharacterImage(stitchedBlob) : inspection
      // Blob first; then one command (asset swap plus optional auto-fit) creates exactly one history frame.
      const asset = await editor.stageAsset(savedBlob, filename, source, savedInspection)
      await editor.dispatch((character) => {
        let placed = saveCharacterDraftAsset(character, target, asset)
        if (!stitchedBlob && autoFit && target.group !== 'body') placed = setCharacterVariantTransform(placed, target.group, target.variantId, autoFit)
        return activateCharacterVariant(placed, { group: target.group, id: target.variantId })
      }, input.expectedRevision)
      const draft = activeCharacter().character
      const savedRevision = settledRevision('Character asset')
      const savedVariant = draft.variants.find(({ group, id }) => group === target.group && id === target.variantId)!
      const specification = source === 'user' ? null : await characterTarget(draft, savedRevision, target)
      protectedRegionDelta = stitchedBlob && sources.editSource && editableRegion
        ? measureProtectedRegionDelta(
            await readCharacterPixels(sources.editSource.blob, sources.editSourceTransform),
            await readCharacterPixels(stitchedBlob),
            editableRegion,
          ) : null
      const path = characterPath(draft.id, target.group, target.variantId)
      return {
        status: 'ok',
        data: {
          accepted: true,
          target: { ...target, label: savedVariant.label },
          filename,
          byteLength: savedBlob.size,
          inspection: {
            width: savedInspection.width,
            height: savedInspection.height,
            genuineRgba: savedInspection.genuineRgba,
            hasTransparentPixels: savedInspection.hasTransparentPixels,
            visibleBounds: savedInspection.visibleBounds,
            visiblePixelCount: savedInspection.visiblePixelCount,
          },
          normalization: report(),
          alignment: specification?.alignment,
          operation: mode,
          ownership,
          compositor: stitchedBlob ? { applied: true, protectedRegionDelta } : { applied: false },
          autoFit: autoFit ? { applied: true, transform: autoFit, bakedIntoAsset: Boolean(stitchedBlob) } : { applied: false },
          revision: savedRevision,
        },
        nextActions: specification?.nextActions ?? characterNextActions(draft),
        effects: { navigation: { path, mode: 'push', reason: 'Open the accepted Character asset for visual review.' } },
      }
  }

  async function setCharacterTransform(rawInput: unknown) {
      const input = rawInput as {
        characterId: string
        group: CharacterVariantGroup
        variantId: string
        expectedRevision: number
        x: number
        y: number
        scale: number
      }
      await editor.open(input.characterId)
      const { character: current } = activeCharacter()
      const before = current.variants.find(({ group, id }) => group === input.group && id === input.variantId)?.transform ?? { x: 0, y: 0, scale: 1 }
      const calibratesHead = input.group === 'expression' && current.headRegistration?.variantId === input.variantId
      await editor.dispatch((character) => setCharacterVariantTransform(character, input.group, input.variantId, {
        x: input.x,
        y: input.y,
        scale: input.scale,
      }), input.expectedRevision)
      const draft = activeCharacter().character
      const revision = settledRevision('Character transform')
      const variant = draft.variants.find(({ group, id }) => group === input.group && id === input.variantId)!
      const firstLayer = CHARACTER_CREATION_GROUPS.find(({ group }) => group === input.group)!.layers.find((layer) => variant.layers[layer])!
      const specification = await characterTarget(draft, revision, { group: input.group, variantId: input.variantId, layer: firstLayer })
      const path = characterPath(draft.id, input.group, input.variantId)
      return {
        status: 'ok',
        data: {
          target: { group: input.group, variantId: input.variantId },
          before,
          after: variant.transform,
          rebasedVariantIds: calibratesHead ? draft.variants.filter((candidate) =>
            candidate.group === 'expression' && candidate.id !== input.variantId && isCharacterDraftAssetCurrent(draft, candidate, 'head')
          ).map(({ id }) => id) : [],
          revision,
          alignment: specification?.alignment,
        },
        nextActions: specification?.nextActions ?? characterNextActions(draft),
        effects: { navigation: { path, mode: 'push', reason: 'Open the adjusted Character variant for visual review.' } },
      }
  }

  function characterHistoryTool(direction: 'undo' | 'redo') {
    return async (rawInput: unknown) => {
      const input = rawInput as { characterId: string; expectedRevision: number }
      const state = editor.store.getState()
      const history = historyStatus()
      if (state.activeCharacterId !== input.characterId || !state.character) return { status: 'no_active_history', data: history }
      if (state.saveStatus !== 'saved') return { status: 'not_settled', data: history }
      if (state.persistedRevision !== input.expectedRevision) return { status: 'revision_conflict', data: history }
      if (!(direction === 'undo' ? history.canUndo : history.canRedo)) return { status: `nothing_to_${direction}`, data: history }
      await editor[direction]()
      settledRevision(`Character ${direction}`)
      const route = browser?.location.pathname ?? ''
      const path = routeSelection(route)?.characterId === input.characterId ? route : characterPath(input.characterId)
      return {
        status: 'ok',
        data: { ...historyStatus(), characterId: input.characterId },
        effects: { navigation: { path, mode: 'push', reason: `Review the Character after ${direction}.` } },
      }
    }
  }

  return application
}

export type Application = ReturnType<typeof createApplication>
