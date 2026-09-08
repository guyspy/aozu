import { bootMantleRuntime, type MantleRuntime } from '@aotter/mantle-runtime'

import { createIndexedDbAssetRepository } from './adapters/indexeddb/asset-repository.ts'
import { createIndexedDbCharacterDraftRepository } from './adapters/indexeddb/character-draft-repository.ts'
import { createCharacterWorkspaceRepository } from './adapters/indexeddb/character-workspace-repository.ts'
import { createIndexedDbCharacterCollectionRepository } from './adapters/indexeddb/character-collection-repository.ts'
import { createIndexedDbCharacterLibraryRepository } from './adapters/indexeddb/character-library-repository.ts'
import { exportCharacterLibraryZip, readCharacterLibraryZip } from './adapters/zip/character-library.ts'
import type { CharacterLibrarySnapshot } from './core/application/character-library.ts'
import { createIndexedDbMantleStorageAdapter } from './adapters/indexeddb/mantle-storage.ts'
import { createWebMcpController, readWorkspaceView } from './adapters/webmcp/controller.ts'
import { CHARACTER_BACKGROUND_GUIDANCE, CHARACTER_NAVIGATION_GUIDANCE, CHARACTER_VISUAL_REVIEW } from './core/application/character-agent-guidance.ts'
import { AUTHORING_NAMESPACE } from './core/application/authoring.ts'
import {
  CHARACTER_ALIGN_MODES,
  CHARACTER_GENERATION_CANVAS,
  CHARACTER_REFERENCE_VIEWS,
  type CharacterReferenceView,
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
  resolveCharacterDraftReferenceLayers,
  resolveCharacterAssetSources,
  setCharacterVariantTransform,
  transformCharacterBounds,
  updateCharacterProfile,
  saveCharacterDraftAsset,
} from './core/application/character-creation.ts'
import { updateCharacterModelSheet } from './core/application/character-model-sheet.ts'
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
const describeModelSheet = (character: CharacterDraft) => ({
  heightCm: character.modelSheet?.heightCm ?? null,
  views: Object.fromEntries(Object.entries(character.modelSheet?.views ?? {}).map(([view, { asset, ...reference }]) => [view, {
    ...reference, filename: asset.filename, sha256: asset.inspection.sha256, width: asset.inspection.width, height: asset.inspection.height,
  }])),
})
const MODEL_SHEET_POLICY = {
  tool: 'update_character_model_sheet', views: CHARACTER_REFERENCE_VIEWS,
  input: { mediaType: 'image/png', maxBytes: 5 * 1024 * 1024, maxWidth: 4096, maxHeight: 4096, background: 'opaque or transparent', preserveOriginalCanvas: true },
  instruction: 'One complete full-body reference per view, same outfit and relaxed standing pose. Preserve identity and proportions. Height in cm is optional; never infer it from image pixels. Guides use fractions of the original image height, head above feet; calibrate visually and exclude hats and held props. Reference art does not change appearance layers.',
}
interface ModelSheetInput {
  characterId: string
  expectedRevision: number
  heightCm?: number | null
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
    body: { content: 'complete-character-skin' },
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
  const editor = createCharacterEditor(characterDrafts, createIndexedDbAssetRepository, inspectCharacterImage)
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
    webmcp,
    editor,
    subscribeCharacterChanges: characterChanges.subscribe,
    async loadCharacterLibrary() {
      await migrateLegacyCharacters()
      return { collections: await collections.list(), characters: await storedCharacterDrafts.listSummaries() }
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
    async replaceCharacterReference(characterId: string, view: CharacterReferenceView, blob: Blob) {
      await editor.open(characterId)
      const { character, revision } = activeCharacter()
      return updateModelSheet({ characterId, expectedRevision: revision, view,
        filename: blob instanceof File ? blob.name : `${view}.png`,
        expectedAssetSha256: character.modelSheet?.views[view]?.asset.inspection.sha256 ?? null,
      }, blob, 'user')
    },
    async deleteCharacter(characterId: string) {
      await editor.close(characterId)
      await characterDrafts.delete(characterId)
    },
    async exportCharacter(characterId: string) {
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
    const match = /^\/characters\/([^/]+)(?:\/(expressions|outfits|props|model-sheet)(?:\/([^/]+))?)?$/.exec(path)
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
      canUndo: pastStates.length > 0 && saveStatus !== 'conflict',
      canRedo: futureStates.length > 0 && saveStatus !== 'conflict',
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
    const selectedRoute = routeSelection(route)
    const records = await listCharacterDrafts()
    const saved = records.find(({ character }) => character.id === selectedRoute?.characterId)
    const current = saved ? await editor.view(saved.character.id) : selectedRoute?.characterId === 'new' ? (await editor.open('new'), await editor.view('new')) : null
    const character = current?.character ?? null
    const renderSnapshot = async () => {
      const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason })
      if (view?.category === 'model-sheet') return unavailable('This page shows reference art. Read the visible model sheet and open a view for visual review; the appearance composite is a separate image.')
      if (!character || !current) return unavailable('No Character is open. Ask the user to open the Character they want feedback on.')
      if (view?.hasUncommittedInput) return unavailable('The view has uncommitted input. Finish or cancel the local edit, then inspect again.')
      const state = editor.store.getState()
      if (state.saveStatus !== 'saved') return unavailable('Character changes are not saved. Wait for saving, or resolve the save error, then inspect again.')
      if (view?.characterId !== character.id || view.revision !== current.version || state.activeCharacterId !== character.id
        || state.persistedRevision !== current.version || view.category !== selectedRoute?.category || view.viewedVariantId !== selectedRoute?.variantId) {
        return unavailable('The rendered view and Character revision do not match. Let the page finish rendering, then inspect again.')
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
    const navigation = [{ destination: 'characters', path: '/collections' }, ...(character ? [
      { destination: 'character-expressions', path: characterPath(character.id, 'expression') },
      { destination: 'character-outfits', path: characterPath(character.id, 'outfit') },
      { destination: 'character-props', path: characterPath(character.id, 'prop') },
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
        currentCollection: books.find(({ id }) => id === view?.collectionId) ?? null,
        collections: books,
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
          modelSheet: describeModelSheet(character),
          collection: await collectionFor(character.id),
          revision: current.version,
          updatedAt: character.updatedAt,
          selected: character.selected,
          missingTargets: missingCharacterTargets,
        } : null,
        ...(includeSnapshot ? { snapshot: await renderSnapshot() } : {}),
        history: historyStatus(),
        navigation,
        assetPolicy: view?.category === 'model-sheet' ? MODEL_SHEET_POLICY : CHARACTER_ASSET_POLICY,
      },
      nextActions: view?.category === 'model-sheet' ? [] : nextActions,
    }
  }

  async function navigateCharacter(rawInput: unknown) {
    const { destination, characterId, variantId } = rawInput as {
      destination: 'characters' | 'character-expressions' | 'character-outfits' | 'character-props' | 'character-model-sheet'
      characterId?: string
      variantId?: string
    }
    if (destination === 'characters') {
      return { status: 'ok', data: { destination, path: '/collections' }, nextActions: [], effects: { navigation: { path: '/collections', mode: 'push', reason: 'Open the Character library.' } } }
    }
    const character = characterId ? await editor.open(characterId) : null
    if (!character) throw new Error('A valid Character ID is required for this destination')
    if (destination === 'character-model-sheet') {
      const path = `/characters/${encodeURIComponent(character.id)}/model-sheet`
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
    await editor.open(characterId)
    const changed = await editor.dispatch((character) => updateCharacterProfile(character, patch), expectedRevision)
    const character = activeCharacter().character
    const revision = settledRevision('Character profile')
    const route = browser?.location.pathname ?? ''
    const path = routeSelection(route)?.characterId === character.id ? route : characterPath(character.id)
    return {
      status: 'ok',
      data: {
        characterId: character.id,
        profile: {
          name: character.name,
          description: character.description ?? '',
          backstory: character.backstory ?? '',
          attributes: character.attributes ?? {},
        },
        revision,
        changed,
      },
      nextActions: characterNextActions(character),
      effects: { navigation: { path, mode: 'push', reason: 'Open the updated Character profile.' } },
    }
  }

  async function setCharacterSelection(rawInput: unknown) {
    const { characterId, expectedRevision, group, variantId, active } = rawInput as {
      characterId: string
      expectedRevision: number
      group: 'expression' | 'outfit' | 'prop'
      variantId: string
      active: boolean
    }
    await editor.open(characterId)
    const target = { group, id: variantId }
    const changed = await editor.dispatch((character) => active
      ? activateCharacterVariant(character, target)
      : deactivateCharacterVariant(character, target), expectedRevision)
    const character = activeCharacter().character
    return {
      status: 'ok',
      data: {
        characterId: character.id,
        selected: character.selected,
        revision: settledRevision('Character selection'),
        changed,
      },
      nextActions: characterNextActions(character),
      effects: { navigation: { path: characterPath(character.id, group), mode: 'push', reason: 'Show the selected Character composition.' } },
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
    } : null
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
      const { characterId, ...targetInput } = rawInput as { characterId: string }
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
            selected: draft.selected,
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
            'The first body/base/body candidate establishes the canonical character and registration frame.',
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

  async function updateModelSheet(rawInput: unknown, providedBlob?: Blob, source: 'user' | 'agent' = 'agent') {
    const input = rawInput as ModelSheetInput
    const { characterId, expectedRevision, view } = input
    if (view !== undefined && !CHARACTER_REFERENCE_VIEWS.includes(view)) throw new Error('Unknown reference view')
    if (input.heightCm === undefined && input.notes === undefined && input.guides === undefined && !input.dataUrl && !providedBlob) throw new Error('No model sheet changes supplied')
    if (!view && (input.notes !== undefined || input.guides !== undefined || input.dataUrl || providedBlob)) throw new Error('Choose a reference view')
    await editor.open(characterId)
    const { character, revision } = activeCharacter()
    if (revision !== expectedRevision) throw new Error('Character changed; inspect it again')
    const previous = view ? character.modelSheet?.views[view] : undefined
    const blob = providedBlob ?? (input.dataUrl ? pngFromDataUrl(input.dataUrl) : undefined)
    if (blob && (input.expectedAssetSha256 !== (previous?.asset.inspection.sha256 ?? null) || !input.filename?.trim() || input.filename.length > 200)) throw new Error('Reference changed or filename is invalid; inspect it again')
    const asset = blob ? await editor.stageAsset(blob, input.filename!, source, undefined, 'reference') : undefined
    await editor.dispatch((current) => {
      if (current.id !== character.id) throw new Error('Active Character changed; inspect it again')
      const sheet = current.modelSheet ?? { views: {} }
      const reference = view ? sheet.views[view] : undefined
      if (view && !asset && !reference) throw new Error('Add reference art before setting its notes or guides')
      return updateCharacterModelSheet(current, {
        ...sheet,
        ...(input.heightCm !== undefined ? { heightCm: input.heightCm ?? undefined } : {}),
        views: view ? { ...sheet.views, [view]: {
          ...reference,
          ...(asset ? { asset, guides: undefined } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.guides !== undefined ? { guides: input.guides ?? undefined } : {}),
        } as CharacterReference } : sheet.views,
      })
    }, expectedRevision)
    const saved = activeCharacter().character
    const path = `/characters/${encodeURIComponent(saved.id)}/model-sheet`
    return { status: 'ok', data: { characterId: saved.id, revision: settledRevision('Model sheet'), modelSheet: describeModelSheet(saved) },
      effects: { navigation: { path, mode: 'push', reason: 'Review the Character model sheet.' } } }
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
