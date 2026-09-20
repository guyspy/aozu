import { bootMantleRuntime, type MantleRuntime } from '@aotter/mantle-runtime'

import { createIndexedDbAssetRepository } from './adapters/indexeddb/asset-repository.ts'
import { createIndexedDbCharacterDraftRepository } from './adapters/indexeddb/character-draft-repository.ts'
import { createCharacterWorkspaceRepository } from './adapters/indexeddb/character-workspace-repository.ts'
import { createIndexedDbCharacterCollectionRepository } from './adapters/indexeddb/character-collection-repository.ts'
import { createIndexedDbCharacterLibraryRepository } from './adapters/indexeddb/character-library-repository.ts'
import { exportCharacterLibraryZip, readCharacterLibraryZip } from './adapters/zip/character-library.ts'
import type { CharacterLibrarySnapshot } from './core/application/character-library.ts'
import { createIndexedDbMantleStorageAdapter } from './adapters/indexeddb/mantle-storage.ts'
import { createWorldLibraryService, unreferencedMention, validateAlbumComposition, type AlbumCharacterSource, type WorldLibraryCommand } from './core/application/world-library.ts'
import { exportLibraryArchive, importLibraryArchive } from './core/application/library-archive.ts'
import { createStoryboardService } from './core/application/storyboard.ts'
import type { SettingSnapshot } from './core/domain/storyboard.ts'
import { createWebMcpController, readWorkspaceView } from './adapters/webmcp/controller.ts'
import { blobFromDataUrl } from './adapters/webmcp/png-transfer.ts'
import { AUTHORING_NAMESPACE } from './core/application/authoring.ts'
import {
  type CharacterReferenceMetadata,
  type CharacterAssetTarget,
  type CharacterDraft,
  type CharacterVariantGroup,
} from './core/domain/character.ts'
import {
  REQUIRED_CHARACTER_TARGETS,
  migrateLegacyCharacterLibrary,
  hasCurrentCharacterLayer,
  resolveCharacterDraftAtlasSources,
  resolveCharacterDraftLayers,
  resolveCharacterDraftPlacements,
  setCharacterVariantTransform,
} from './core/application/character-creation.ts'
import { characterModelSheet, withCharacterModelSheet, modelSheetReferences, setModelSheetReference } from './core/application/character-model-sheet.ts'
import type { CharacterAppearanceCommand } from './core/application/character-appearances.ts'
import { createCharacterEditor } from './core/application/character-editor.ts'
import { createCharacterWebMcpHandlers } from './core/application/character-webmcp-handlers.ts'
import { createWorkspaceInspector } from './core/application/workspace-inspection.ts'
import { inspectCharacterImage, renderCharacterCompositeBlob, renderCharacterThumbnail } from './adapters/browser/character-image.ts'
import { requestPersistentStorage } from './adapters/browser/storage-persistence.ts'
import { createCharacterWorkspaceEvents } from './adapters/browser/character-workspace-events.ts'
import { exportCharacterDraftZip, readCharacterDraftZip } from './adapters/zip/character-draft.ts'
import { DEFAULT_CHARACTER_COLLECTION, type CharacterCollectionProfile } from './core/domain/character-collection.ts'
import { compileAuthoringBackbone } from './core/mantle/backbone.ts'
const CHARACTER_WEBMCP_TRIGGERS = [
  'inspect-workspace',
  'inspect-storyboard',
  'update-storyboard',
  'navigate-workspace',
  'update-library',
  'export-library',
  'import-library',
  'inspect-character-contract',
  'update-character-profile',
  'update-character-variant-metadata',
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
  let characterHandlers!: ReturnType<typeof createCharacterWebMcpHandlers>

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
        const command = input as { action: string; source?: string; title?: string; setting?: SettingSnapshot; settings?: SettingSnapshot[] }
        if (command.action === 'pin-setting' || command.action === 'add-candidate') await validateStoryboardSources(command)
        const board = await storyboards.update(input)
        return { status: 'ok', data: { boardId: board.id, revision: board.revision, frames: board.frames }, effects: { navigation: { path: `/storyboards/${board.id}`, mode: 'push', reason: 'Review the changed storyboard.' } } }
      },
      'companion.navigate-workspace': navigateWorkspace,
      'companion.update-library': updateLibrary,
      'companion.export-library': exportLibrary,
      'companion.import-library': importLibrary,
      'companion.update-collection-profile': updateCollectionProfile,
      'companion.update-character-profile': (input) => characterHandlers.updateProfile(input),
      'companion.update-character-variant-metadata': (input) => characterHandlers.updateVariantMetadata(input),
      'companion.update-character-model-sheet': (input) => characterHandlers.updateModelSheet(input),
      'companion.set-character-variant-selection': (input) => characterHandlers.setCharacterSelection(input),
      'companion.create-local-companion': storyModeUnavailable,
      'companion.inspect-experience-contract': storyModeUnavailable,
      'companion.submit-experience-candidate': storyModeUnavailable,
      'companion.inspect-character-contract': (input) => characterHandlers.inspectCharacterContract(input),
      'companion.replace-character-asset': (input) => characterHandlers.replaceCharacterAssetTool(input),
      'companion.repair-character-asset': (input) => characterHandlers.repairCharacterAssetTool(input),
      'companion.set-character-variant-transform': (input) => characterHandlers.setCharacterTransform(input),
      'companion.undo-character-change': (input) => characterHandlers.characterHistoryTool('undo')(input),
      'companion.redo-character-change': (input) => characterHandlers.characterHistoryTool('redo')(input),
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
    changeCharacterAppearance: (characterId: string, command: CharacterAppearanceCommand, expectedRevision: number) =>
      characterHandlers.applyCharacterAppearance(characterId, command, expectedRevision),
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
      const collection = await collections.create({ name, description: '', backstory: '' })
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
      characterHandlers.characterFit(group, variantId).then(({ fit }) => fit),
    async autoFitCharacterVariant(group: CharacterVariantGroup, variantId: string) {
      const { revision, fit } = await characterHandlers.characterFit(group, variantId)
      if (fit.status === 'aligned') return
      if (fit.status !== 'suggested') throw new Error('No high-confidence fit is available; use the visual alignment controls.')
      await editor.dispatch((current) => setCharacterVariantTransform(current, group, variantId, fit.transform), revision)
    },
    async replaceCharacterAsset(characterId: string, target: CharacterAssetTarget, blob: Blob, options: { rebaseDerivedAssets?: boolean; expectedRevision?: number } = {}) {
      await editor.open(characterId)
      const { character, revision } = activeCharacter()
      const current = character.variants.find(({ group, id }) => group === target.group && id === target.variantId)?.layers[target.layer]
      const result = await characterHandlers.mutateCharacterAsset('replace', {
        ...target,
        characterId,
        expectedRevision: options.expectedRevision ?? revision,
        rebaseDerivedAssets: options.rebaseDerivedAssets,
        expectedAssetSha256: current?.inspection.sha256 ?? null,
        filename: blob instanceof File ? blob.name : `${target.variantId}-${target.layer}.png`,
      }, blob, 'user')
      if (!('accepted' in result.data) || !result.data.accepted) throw new Error('rejection' in result.data ? result.data.rejection?.message : 'Character asset was rejected')
      return result.data
    },
    async replaceCharacterReference(characterId: string, referenceId: string, blob?: Blob, metadata: CharacterReferenceMetadata = {}) {
      await editor.open(characterId)
      const { character, revision } = activeCharacter()
      return characterHandlers.updateModelSheet({ characterId, expectedRevision: revision, referenceId, ...metadata,
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
    /** The one complete-archive contract, shared by the Library tree and the import/export tools. */
    archiveServices: () => archiveServices(),
  }

  async function validateStoryboardSources(command: { action: string; source?: string; title?: string; setting?: SettingSnapshot; settings?: SettingSnapshot[] }) {
    const settings = command.action === 'pin-setting' ? command.setting ? [command.setting] : [] : command.settings ?? []
    const [records, world] = await Promise.all([listCharacterDrafts(), worldLibrary.load()])
    for (const setting of settings) {
      if (setting.kind === 'character') {
        const record = records.find(({ character }) => character.id === setting.sourceId); if (!record) throw new Error('Character source not found')
        if (!setting.sha256 || setting.revision !== record.version || setting.sha256 !== (await inspectCharacterImage(await application.exportCharacterPng(record.character))).sha256) throw new Error(`${record.character.name} changed or its Appearance hash is incorrect; inspect_character_contract again`)
      } else if (setting.revision !== world.revision) throw new Error('World source changed; inspect_workspace again')
      else if (setting.kind === 'location' && !world.locations.some(({ id }) => id === setting.sourceId)) throw new Error('Location source not found')
      else if (setting.kind === 'photo' && !world.photos.some(({ id }) => id === setting.sourceId)) throw new Error('Photo source not found')
    }
    if (command.action !== 'add-candidate') return
    const text = `${command.title ?? ''}\n${command.source ?? ''}`
    const pinned = (kind: SettingSnapshot['kind'], sourceId: string) => settings.some((setting) => setting.kind === kind && setting.sourceId === sourceId)
    const missingCharacter = unreferencedMention(text, records.map(({ character }) => ({ name: character.name, referenced: pinned('character', character.id), value: character })))
    if (missingCharacter) throw new Error(`${missingCharacter.name} is defined in AOZU and requires a Character setting ref`)
    const missingLocation = unreferencedMention(text, world.locations.map((location) => ({ name: location.name, referenced: pinned('location', location.id), value: location })))
    if (missingLocation) throw new Error(`${missingLocation.name} is defined in AOZU and requires a Location setting ref`)
    const missingCondition = unreferencedMention(text, world.locations.flatMap((location) => location.conditions.map((condition) => ({ name: condition.name, referenced: pinned('location', location.id), value: condition }))))
    if (missingCondition) throw new Error(`${missingCondition.name} is defined in AOZU and requires its Location setting ref`)
    const missingPhoto = unreferencedMention(text, world.photos.map((photo) => ({ name: photo.name, referenced: pinned('photo', photo.id), value: photo })))
    if (missingPhoto) throw new Error(`${missingPhoto.name} is defined in AOZU and requires an Album Photo setting ref`)
  }

  const categoryFor = (group: CharacterVariantGroup) => group === 'expression' ? 'expressions'
    : group === 'outfit' ? 'wardrobe' : group === 'hair' ? 'hair' : group === 'headwear' ? 'headwear' : group === 'prop' ? 'props' : 'expressions'
  const characterPath = (characterId: string, group: CharacterVariantGroup = 'expression', variantId?: string) =>
    `/characters/${encodeURIComponent(characterId)}/${categoryFor(group)}${variantId && group !== 'body' ? `/${encodeURIComponent(variantId)}` : ''}`
  const routeSelection = (path: string) => {
    const match = /^\/characters\/([^/]+)(?:\/(expressions|wardrobe|hair|headwear|props|profile|model-sheet)(?:\/([^/]+))?)?$/.exec(path)
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
    return {
      status: 'ok',
      data: { collection: (await collections.list()).find(({ id }) => id === collectionId) },
      nextActions: [],
      effects: { navigation: { path: `/collections/${encodeURIComponent(collectionId)}/profile`, mode: 'push', reason: 'Review the updated Collection.' } },
    }
  }

  const collectionFor = async (characterId: string) => {
    const books = await collections.list()
    const book = books.find(({ characterIds }) => characterIds.includes(characterId)) ?? books.find(({ id }) => id === DEFAULT_CHARACTER_COLLECTION)!
    return { id: book.id, name: book.name, description: book.description, backstory: book.backstory, revision: book.version }
  }

  characterHandlers = createCharacterWebMcpHandlers({
    document,
    editor,
    activeCharacter,
    settledRevision,
    characterNextActions,
    characterPath,
    collectionFor,
    historyStatus,
    routeSelection,
    currentPath: () => browser?.location.pathname ?? '',
    exportCharacterPng: (character) => renderCharacterCompositeBlob(resolveCharacterDraftLayers(character)),
  })

  const inspectWorkspace = createWorkspaceInspector({
    document,
    currentPath: () => browser?.location.pathname ?? '/',
    collections,
    worldLibrary,
    storyboards,
    editor,
    listCharacterDrafts,
    routeSelection,
    characterPath,
    characterNextActions,
    collectionFor,
    historyStatus,
  })

  async function navigateWorkspace(rawInput: unknown) {
    const { resource, id, view, itemId } = rawInput as { resource: string; id?: string; view?: string; itemId?: string }
    const exact = (value: string | undefined, what: string) => { if (!value) throw new Error(`${what} ID is required`); return encodeURIComponent(value) }
    const allow = (views: string[] = [], items = false) => {
      if (view && !views.includes(view)) throw new Error(`Unsupported ${resource} view`)
      if (itemId && !items) throw new Error(`${resource} does not support itemId`)
    }
    let path = '/'
    if (resource === 'collections') { allow(); path = '/collections' }
    else if (resource === 'collection') {
      allow(['characters', 'profile', 'locations'])
      const collection = (await collections.list()).find((item) => item.id === id); if (!collection) throw new Error('Collection not found')
      path = `/collections/${exact(id, 'Collection')}${view && view !== 'characters' ? `/${view}` : ''}`
    } else if (resource === 'location') {
      allow(['setting-images', 'profile', 'conditions'], view === 'conditions')
      const location = (await worldLibrary.load()).locations.find((item) => item.id === id); if (!location) throw new Error('Location not found')
      if (itemId && view !== 'conditions') throw new Error('itemId requires the Conditions view')
      if (view === 'conditions' && itemId && !location.conditions.some((condition) => condition.id === itemId)) throw new Error('Condition not found')
      path = `/collections/${encodeURIComponent(location.collectionId)}/locations/${exact(id, 'Location')}${view && view !== 'setting-images' ? `/${view}${view === 'conditions' && itemId ? `/${encodeURIComponent(itemId)}` : ''}` : ''}`
    } else if (resource === 'albums') { allow(); path = '/albums' }
    else if (resource === 'album') {
      allow()
      if (!(await worldLibrary.load()).albums.some((item) => item.id === id)) throw new Error('Album not found')
      path = `/albums/${exact(id, 'Album')}`
    } else if (resource === 'photo') {
      allow()
      const photo = (await worldLibrary.load()).photos.find((item) => item.id === id); if (!photo) throw new Error('Photo not found')
      path = `/albums/${encodeURIComponent(photo.albumId)}/photos/${exact(id, 'Photo')}`
    } else if (resource === 'storyboards') { allow(); path = '/storyboards' }
    else if (resource === 'story-book') {
      allow()
      if (!(await worldLibrary.load()).storyBooks.some((item) => item.id === id)) throw new Error('Story book not found')
      path = `/storyboards/books/${exact(id, 'Story book')}`
    } else if (resource === 'storyboard') {
      allow(['storyboard', 'details'])
      await storyboards.get(exact(id, 'Storyboard'))
      path = `/storyboards/${exact(id, 'Storyboard')}${view === 'details' ? '/details' : ''}`
    } else if (resource === 'character') {
      const variantViews = ['expressions', 'wardrobe', 'hair', 'headwear', 'props']
      allow([...variantViews, 'profile', 'model-sheet'], [...variantViews, 'model-sheet'].includes(view ?? 'expressions'))
      const characterId = exact(id, 'Character'), character = await editor.open(id!)
      if (view === 'model-sheet' && itemId && !modelSheetReferences(characterModelSheet(character))[itemId]) throw new Error('Reference not found')
      if (variantViews.includes(view ?? 'expressions') && itemId) {
        const group = view === 'wardrobe' ? 'outfit' : view === 'hair' ? 'hair' : view === 'headwear' ? 'headwear' : view === 'props' ? 'prop' : 'expression'
        if (!character.variants.some((variant) => variant.group === group && variant.id === itemId)) throw new Error('Character variant not found')
      }
      path = `/characters/${characterId}/${view ?? 'expressions'}${itemId ? `/${encodeURIComponent(itemId)}` : ''}`
    } else if (resource === 'home') allow()
    else throw new Error('Unsupported workspace resource')
    return { status: 'ok', data: { resource, id: id ?? null, path }, nextActions: [], effects: { navigation: { path, mode: 'push', reason: 'Open the requested workspace resource.' } } }
  }

  async function updateLibrary(rawInput: unknown) {
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before changing the Library')
    const input = rawInput as Record<string, unknown> & { resource: string; action: string; id?: string; expectedRevision?: number; collectionId?: string; collectionIds?: string[] }
    if (input.resource === 'collection') {
      if (input.action === 'create') {
        const collection = await collections.create({ name: String(input.name ?? ''), description: String(input.description ?? ''), backstory: String(input.backstory ?? '') }); characterChanges.publish({ characterId: collection.id, revision: null })
        return { status: 'ok', data: { resource: input.resource, action: input.action, id: collection.id, revision: collection.version }, effects: { navigation: { path: `/collections/${collection.id}`, mode: 'push', reason: 'Open the created Collection.' } } }
      }
      if (!input.id || input.expectedRevision === undefined) throw new Error('Collection ID and expectedRevision are required')
      if (input.action === 'update') return updateCollectionProfile({ collectionId: input.id, expectedRevision: input.expectedRevision, ...Object.fromEntries(Object.entries({ name: input.name, description: input.description, backstory: input.backstory }).filter(([, value]) => value !== undefined)) })
      if (input.action !== 'delete') throw new Error('Unsupported Collection action')
      await collections.delete(input.id, input.expectedRevision); await worldLibrary.refresh(); characterChanges.publish({ characterId: input.id, revision: null })
      return { status: 'ok', data: { resource: input.resource, action: input.action, id: input.id }, effects: { navigation: { path: '/collections', mode: 'push', reason: 'Return to Collections.' } } }
    }
    if (input.resource === 'character') {
      if (!input.id || input.expectedRevision === undefined) throw new Error('Character ID and expectedRevision are required')
      const record = (await listCharacterDrafts()).find(({ character }) => character.id === input.id); if (!record) throw new Error('Character not found')
      if (record.version !== input.expectedRevision) throw new Error('Character changed elsewhere; inspect and try again')
      if (input.action === 'move') {
        await collections.assign(input.id, input.collectionId ?? null); characterChanges.publish({ characterId: input.id, revision: record.version })
        const collectionId = input.collectionId ?? DEFAULT_CHARACTER_COLLECTION
        return { status: 'ok', data: { resource: input.resource, action: input.action, id: input.id, collectionId }, effects: { navigation: { path: `/collections/${encodeURIComponent(collectionId)}`, mode: 'push', reason: 'Review the Character in its Collection.' } } }
      }
      if (input.action !== 'delete') throw new Error('Unsupported Character action')
      await application.deleteCharacter(input.id); characterChanges.publish({ characterId: input.id, revision: null })
      return { status: 'ok', data: { resource: input.resource, action: input.action, id: input.id }, effects: { navigation: { path: '/collections', mode: 'push', reason: 'Return to Collections.' } } }
    }
    if (input.expectedRevision === undefined) throw new Error('expectedRevision is required')
    if (input.resource === 'storyboard-book' && input.action === 'move') await storyboards.get(String(input.boardId ?? ''))
    const knownCollections = await collections.list()
    if (input.resource === 'location' && input.collectionId && !knownCollections.some(({ id }) => id === input.collectionId)) throw new Error('Collection not found')
    if (input.resource === 'story-book' && Array.isArray(input.collectionIds) && input.collectionIds.some((id) => !knownCollections.some((collection) => collection.id === id))) throw new Error('Collection not found')
    const before = input.resource === 'location' || input.resource === 'photo' ? await worldLibrary.load() : undefined
    const originalLocation = input.resource === 'location' && input.id ? before?.locations.find((item) => item.id === input.id) : undefined
    // A deleted Photo is gone from the result, so remember the album it is being removed from.
    const originalPhotoAlbum = input.resource === 'photo' && input.id ? before?.photos.find((item) => item.id === input.id)?.albumId : undefined
    const { expectedRevision, ...command } = input
    const result = await worldLibrary.update(command as unknown as WorldLibraryCommand, expectedRevision)
    const changedLocation = result.library.locations.find((item) => item.id === (command.resource === 'condition' ? input.locationId : result.id))
    const changedPhoto = result.library.photos.find((item) => item.id === result.id)
    const path = command.resource === 'album' ? (command.action === 'delete' ? '/albums' : `/albums/${result.id}`)
      : command.resource === 'photo' ? (changedPhoto ? `/albums/${changedPhoto.albumId}/photos/${changedPhoto.id}` : originalPhotoAlbum ? `/albums/${originalPhotoAlbum}` : '/albums')
      : command.resource === 'location' ? (command.action === 'delete' ? `/collections/${originalLocation?.collectionId ?? 'default'}/locations${originalLocation?.parentId ? `/${originalLocation.parentId}` : ''}` : `/collections/${input.collectionId ?? result.library.locations.find((item) => item.id === result.id)?.collectionId ?? 'default'}/locations/${result.id}`)
      : command.resource === 'condition' && changedLocation ? `/collections/${changedLocation.collectionId}/locations/${changedLocation.id}/conditions${command.action === 'delete' ? '' : `/${result.id}`}`
      : command.resource === 'reference' ? `/collections/${result.library.locations.find((item) => item.id === input.locationId)?.collectionId ?? 'default'}/locations/${input.locationId}${input.conditionId ? `/conditions/${input.conditionId}` : ''}`
      : command.resource === 'story-book' ? (command.action === 'delete' ? '/storyboards' : `/storyboards/books/${result.id}`)
      : command.resource === 'storyboard-book' ? `/storyboards/${input.boardId}` : undefined
    return { status: 'ok', data: { resource: input.resource, action: input.action, id: result.id, revision: result.library.revision }, ...(path ? { effects: { navigation: { path, mode: 'push', reason: 'Review the changed Library resource.' } } } : {}) }
  }

  const archiveServices = () => ({
    exportCharacters: application.exportCharacterLibrary,
    prepareCharacters: application.prepareCharacterLibraryImport,
    importCharacters: (snapshot: CharacterLibrarySnapshot) => application.importCharacterLibrary(snapshot, 'merge'),
    world: worldLibrary,
    storyboards,
  })
  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return { filename, bytes: blob.size, downloadStarted: true }
  }
  async function exportLibrary(rawInput: unknown) {
    const { resource, id, expectedRevision } = rawInput as { resource: string; id?: string; expectedRevision?: number }
    let blob: Blob, filename: string
    if (resource === 'library') { blob = await exportLibraryArchive(archiveServices()); filename = 'aozu-library.zip' }
    else if (resource === 'world') { blob = await worldLibrary.export(); filename = 'aozu-world-library.zip' }
    else if (resource === 'storyboard') {
      if (!id || expectedRevision === undefined) throw new Error('Storyboard ID and expectedRevision are required')
      const board = await storyboards.get(id); blob = await storyboards.export(id, expectedRevision); filename = `${board.name}.zip`
    } else if (resource === 'character') {
      if (!id || expectedRevision === undefined) throw new Error('Character ID and expectedRevision are required')
      const record = (await listCharacterDrafts()).find(({ character }) => character.id === id); if (!record) throw new Error('Character not found')
      if (record.version !== expectedRevision) throw new Error('Character changed elsewhere; inspect and try again')
      blob = await application.exportCharacter(id); filename = `${record.character.name}.zip`
    } else if (resource === 'photo') {
      const photo = (await worldLibrary.load()).photos.find((item) => item.id === id); if (!photo) throw new Error('Photo not found')
      blob = await worldLibrary.image(photo.image.sha256); filename = photo.image.filename
    } else throw new Error('Unsupported export resource')
    return { status: 'ok', data: { resource, id: id ?? null, ...download(blob, filename) } }
  }
  async function importLibrary(rawInput: unknown) {
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before importing')
    const input = rawInput as { resource: string; dataUrl: string; filename?: string; albumId?: string; locationId?: string; conditionId?: string; collectionId?: string; name?: string; label?: string; description?: string; source?: string; purpose?: 'inspiration' | 'design'; characterSources?: AlbumCharacterSource[]; sourceLocationId?: string; sourceConditionId?: string; prompt?: string }
    const { resource, dataUrl, filename, albumId, locationId, conditionId, collectionId } = input
    const blob = blobFromDataUrl(dataUrl)
    if (resource === 'library') { await importLibraryArchive(blob, archiveServices()); return { status: 'ok', data: { resource, imported: true }, effects: { navigation: { path: '/collections', mode: 'push', reason: 'Review the imported Library.' } } } }
    if (resource === 'world') { const library = await worldLibrary.import(blob, await worldLibrary.load()); return { status: 'ok', data: { resource, revision: library.revision }, effects: { navigation: { path: '/albums', mode: 'push', reason: 'Review the imported world Library.' } } } }
    if (resource === 'storyboard') { const board = await storyboards.import(blob); return { status: 'ok', data: { resource, id: board.id, revision: board.revision }, effects: { navigation: { path: `/storyboards/${board.id}`, mode: 'push', reason: 'Review the imported Storyboard.' } } } }
    if (resource === 'character') {
      if (collectionId && !(await collections.list()).some((collection) => collection.id === collectionId)) throw new Error('Collection not found')
      const character = await application.importCharacter(blob); if (collectionId) await collections.assign(character.id, collectionId)
      return { status: 'ok', data: { resource, id: character.id }, effects: { navigation: { path: `/characters/${character.id}/expressions`, mode: 'push', reason: 'Review the imported Character.' } } }
    }
    if (resource === 'image') {
      if (!blob.type.startsWith('image/')) throw new Error('Image import requires PNG, JPEG, or WebP')
      if (Boolean(albumId) === Boolean(locationId)) throw new Error('Choose exactly one image destination: albumId or locationId')
      const current = await worldLibrary.load(), file = new File([blob], filename ?? 'image.png', { type: blob.type })
      if (locationId) {
        const result = await worldLibrary.uploadSetting(current, locationId, file, input.label ?? input.name ?? file.name, input.purpose ?? 'design', conditionId, input.source ?? '')
        const location = result.library.locations.find((item) => item.id === locationId)!
        return { status: 'ok', data: { resource, kind: 'location-setting', id: result.id, revision: result.library.revision }, effects: { navigation: { path: `/collections/${location.collectionId}/locations/${location.id}`, mode: 'push', reason: 'Review the imported setting image.' } } }
      }
      if (!current.albums.some((item) => item.id === albumId)) throw new Error('Album not found')
      const records = await listCharacterDrafts(), requested = new Set((input.characterSources ?? []).map(({ characterId }) => characterId))
      const characters = await Promise.all(records.map(async (record) => {
        const { character, version: revision } = record
        return { id: character.id, name: character.name, revision, sha256: requested.has(character.id) ? (await inspectCharacterImage(await application.exportCharacterPng(character))).sha256 : '' }
      }))
      const source = validateAlbumComposition(input, characters, current.locations)
      const library = await worldLibrary.upload(current, albumId!, [file], undefined, { name: input.name, description: input.description, source }), photo = library.photos.at(-1)!
      return { status: 'ok', data: { resource, kind: 'album-photo', id: photo.id, revision: library.revision }, effects: { navigation: { path: `/albums/${albumId}/photos/${photo.id}`, mode: 'push', reason: 'Review the imported composed photo.' } } }
    }
    throw new Error('Unsupported import resource')
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
        const asset = await editor.stageAsset(await renderCharacterCompositeBlob(resolveCharacterDraftLayers(current)), 'front-appearance.png', front?.asset.source ?? 'user', undefined, 'reference')
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


  return application
}

export type Application = ReturnType<typeof createApplication>
