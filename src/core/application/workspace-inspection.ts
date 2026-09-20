import { readWorkspaceView } from '../../adapters/webmcp/controller.ts'
import { readDataUrl } from '../../adapters/webmcp/png-transfer.ts'
import { renderCharacterCompositeDataUrl } from '../../adapters/browser/character-image.ts'
import { CHARACTER_AUTHORING_GUIDE, MODEL_SHEET_REVIEW } from './character-agent-guidance.ts'
import { CHARACTER_ASSET_POLICY } from './character-asset-policy.ts'
import { REQUIRED_CHARACTER_TARGETS, hasCurrentCharacterLayer, resolveCharacterDraftLayers } from './character-creation.ts'
import { characterModelSheet, modelSheetReferences } from './character-model-sheet.ts'
import { describeAppearances, describeModelSheet, describeReference, MODEL_SHEET_POLICY } from './character-webmcp-shared.ts'
import { CHARACTER_RIG, type CharacterDraft, type CharacterVariantGroup } from '../domain/character.ts'
import type { createCharacterEditor } from './character-editor.ts'
import type { createIndexedDbCharacterCollectionRepository } from '../../adapters/indexeddb/character-collection-repository.ts'
import type { createWorldLibraryService } from './world-library.ts'
import type { createStoryboardService } from './storyboard.ts'

type CharacterRecord = { character: CharacterDraft; version: number }
type WorkspaceInspectorDependencies = {
  document: Document
  currentPath(): string
  collections: ReturnType<typeof createIndexedDbCharacterCollectionRepository>
  worldLibrary: ReturnType<typeof createWorldLibraryService>
  storyboards: ReturnType<typeof createStoryboardService>
  editor: ReturnType<typeof createCharacterEditor>
  listCharacterDrafts(): Promise<CharacterRecord[]>
  routeSelection(path: string): { characterId?: string; category?: string | null; variantId?: string | null } | null
  characterPath(characterId: string, group?: CharacterVariantGroup, variantId?: string): string
  characterNextActions(draft: CharacterDraft): unknown[]
  collectionFor(characterId: string): Promise<{ id: string; name: string; description: string; backstory: string; revision: number }>
  historyStatus(): unknown
}

const categoryFor = (group: CharacterVariantGroup) => group === 'expression' ? 'expressions'
  : group === 'outfit' ? 'wardrobe' : group === 'hair' ? 'hair' : group === 'headwear' ? 'headwear' : group === 'prop' ? 'props' : 'expressions'

export function createWorkspaceInspector(dependencies: WorkspaceInspectorDependencies) {
  const { document, currentPath, collections, worldLibrary, storyboards, editor, listCharacterDrafts, routeSelection, characterPath, characterNextActions, collectionFor, historyStatus } = dependencies
  async function inspectWorkspace(rawInput: unknown) {
    const { includeSnapshot = false, resource, id, images = [], intent } = rawInput as { includeSnapshot?: boolean; resource?: string; id?: string; images?: string[]; intent?: 'character' | 'world' | 'storyboard' }
    if (images.length > 5 || new Set(images).size !== images.length) throw new Error('Request at most five distinct Library images')
    const route = currentPath()
    const view = readWorkspaceView(document)
    const books = await collections.list()
    const visualLibrary = await worldLibrary.load()
    if (resource && !id) throw new Error(`${resource} ID is required`)
    const exists = resource === 'collection' ? books.some((item) => item.id === id)
      : resource === 'album' ? visualLibrary.albums.some((item) => item.id === id)
      : resource === 'photo' ? visualLibrary.photos.some((item) => item.id === id)
      : resource === 'location' ? visualLibrary.locations.some((item) => item.id === id)
      : resource === 'story-book' ? visualLibrary.storyBooks.some((item) => item.id === id) : true
    if (!exists) throw new Error(`${resource} not found`)
    const locationId = resource === 'location' ? id : view?.locationId
    const albumId = resource === 'album' ? id : view?.albumId
    const photoId = resource === 'photo' ? id : view?.photoId
    const bookId = resource === 'story-book' ? id : view?.bookId ?? (view?.boardId ? visualLibrary.boardBooks[view.boardId] : undefined)
    const requestedImages = await Promise.all(images.map(async (imageId) => {
      const photo = visualLibrary.photos.find((item) => item.id === imageId)
      const reference = visualLibrary.locations.flatMap((location) => [...location.images, ...location.conditions.flatMap((condition) => condition.images)]).find((item) => item.id === imageId)
      const image = photo?.image ?? reference?.image; if (!image) throw new Error(`Library image not found: ${imageId}`)
      return { id: imageId, ...image, dataUrl: await readDataUrl(await worldLibrary.image(image.sha256)) }
    }))
    const selectedRoute = routeSelection(route)
    const records = await listCharacterDrafts()
    const saved = records.find(({ character }) => character.id === selectedRoute?.characterId)
    const current = saved ? await editor.view(saved.character.id) : selectedRoute?.characterId === 'new' ? (await editor.open('new'), await editor.view('new')) : null
    const character = current?.character ?? null
    const renderSnapshot = async () => {
      const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason })
      if (view?.boardId) return unavailable('Use inspect_storyboard with boardId and explicit image IDs to view the original storyboard images.')
      if (locationId || photoId) {
        if (view?.hasUncommittedInput) return unavailable('Finish or cancel local edits before requesting a snapshot.')
        const location = visualLibrary.locations.find((l) => l.id === locationId)
        const photo = visualLibrary.photos.find((p) => p.id === photoId)
        const image = photo?.image ?? location?.images.find((i) => i.purpose === 'design')?.image ?? location?.images[0]?.image
        if (!image) return unavailable('This setting has no image yet.')
        const dataUrl = await readDataUrl(await worldLibrary.image(image.sha256))
        if (currentPath() !== route || (await worldLibrary.load()).revision !== visualLibrary.revision) return unavailable('The source changed while loading; inspect again.')
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
      if (currentPath() !== route || JSON.stringify(readWorkspaceView(document)) !== JSON.stringify(view)
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
      { destination: 'character-wardrobe', path: characterPath(character.id, 'outfit') },
      { destination: 'character-hair', path: characterPath(character.id, 'hair') },
      { destination: 'character-headwear', path: characterPath(character.id, 'headwear') },
      { destination: 'character-props', path: characterPath(character.id, 'prop') },
      { destination: 'character-profile', path: `/characters/${encodeURIComponent(character.id)}/profile` },
      { destination: 'character-model-sheet', path: `/characters/${encodeURIComponent(character.id)}/model-sheet` },
    ] : [])]
    const nextActions = character ? characterNextActions(character) : [{
      tool: 'navigate_workspace', required: false, reason: records.length ? 'Open a Character before editing its assets.' : 'Open a new Character workshop.', input: records.length ? { resource: 'collections' } : { resource: 'character', id: 'new', view: 'expressions' },
    }]
    const requestedCollectionId = resource === 'collection' ? id : view?.collectionId
    const selectedCollection = books.find(({ id }) => id === requestedCollectionId)
    const worldContext = intent === 'world' || ['albums', 'locations', 'story-book'].includes(view?.surface ?? '') || ['collection', 'album', 'photo', 'location', 'story-book'].includes(resource ?? '')
    const worldNextActions = intent === 'world' && !selectedCollection ? books.map((book) => ({
      tool: 'inspect_workspace', required: true, reason: `Read ${book.name}'s backstory, Characters and Locations before creating world art.`, input: { intent: 'world', resource: 'collection', id: book.id },
    })) : [{ tool: 'navigate_workspace', required: false, reason: 'Open the selected Collection locations or another exact Library resource.', input: selectedCollection ? { resource: 'collection', id: selectedCollection.id, view: 'locations' } : { resource: 'albums' } }]
    return {
      status: 'ok',
      data: {
        route: { path: route, ...selectedRoute },
        view,
        contextFreshness: 'Snapshot at tool invocation, not a live subscription. Re-inspect after user navigation, panel/preview changes, and tool mutations. viewedVariantId is the variant being previewed; currentCharacter.selected is the applied composition. Uncommitted form, numeric, and drag inputs are not included in the Character contract; inspect the visible UI and let those edits settle before mutating.',
        storyboards: (await storyboards.inspect()).boards,
        currentStoryboard: view?.boardId ? await storyboards.inspect(view.boardId) : null,
        currentCollection: selectedCollection ?? null,
        collections: books,
        visualLibrary: { revision: visualLibrary.revision, albums: visualLibrary.albums, storyBooks: visualLibrary.storyBooks,
          locations: visualLibrary.locations.map(({ id, collectionId, parentId, name, tags }) => ({ id, collectionId, parentId, name, tags })),
          currentLocation: visualLibrary.locations.find((l) => l.id === locationId) ?? null,
          currentPhoto: visualLibrary.photos.find((p) => p.id === photoId) ?? null,
          currentAlbum: albumId ? { album: visualLibrary.albums.find((a) => a.id === albumId), photos: visualLibrary.photos.filter((p) => p.albumId === albumId) } : null,
          currentStoryBook: visualLibrary.storyBooks.find((item) => item.id === bookId) ?? null,
          requestedImages,
          policy: 'Location and Condition setting images are owned directly by that setting. Album photos are finished compositions built from Characters, Locations, situation prompts and Collection backstory. An Album photo is linked back to a Location only when explicitly requested. Pinned storyboard references are snapshots and do not follow source edits.' },
        ...(worldContext ? { worldWorkflow: selectedCollection ? {
          step: 'context-ready',
          collection: selectedCollection,
          characters: records.filter(({ character }) => selectedCollection.characterIds.includes(character.id)).map(({ character, version }) => ({ id: character.id, name: character.name, description: character.description ?? '', backstory: character.backstory ?? '', revision: version })),
          locations: visualLibrary.locations.filter((location) => location.collectionId === selectedCollection.id),
          instruction: 'Use this Collection backstory plus its Characters, Location hierarchy and Conditions before generating setting art or a finished Album photo. Undefined subjects may be invented freely. Every defined Character used in an Album photo must come from inspect_character_contract with scope:model-sheet and images:[appearance], and every defined Location or Condition must be passed as a source reference.',
        } : { step: 'choose-collection', instruction: 'Choose a Collection from nextActions and inspect it before generating world art.' } } : {}),
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
        assetPolicy: view?.surface?.startsWith('storyboard') ? 'Storyboard PNG originals retain their dimensions and opacity. Use inspect_storyboard for exact selections, pinned references and source images.' : worldContext ? 'PNG, JPEG and WebP are accepted up to 5 MiB and 4096×4096. Location and Condition images are direct setting assets. Album photos are finished compositions; record their Character, Location, situation prompt and Collection backstory provenance in description/source.' : view?.category === 'model-sheet' ? MODEL_SHEET_POLICY : CHARACTER_ASSET_POLICY,
        authoringGuide: CHARACTER_AUTHORING_GUIDE,
      },
      nextActions: view?.surface?.startsWith('storyboard') ? [{ tool: 'inspect_storyboard', required: false, reason: 'Inspect the storyboard and request exact image IDs before visual feedback.', input: view.boardId ? { boardId: view.boardId } : {} }] : worldContext ? worldNextActions : view?.category === 'model-sheet' && character ? [{ tool: 'inspect_character_contract', required: false, reason: 'Inspect the reference task and explicitly request source images before generating art.', input: { characterId: character.id, scope: 'model-sheet', referenceId: view.referenceView ?? selectedRoute?.variantId ?? 'front' } }] : nextActions,
    }
  }

  return inspectWorkspace
}
