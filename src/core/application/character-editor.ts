import { temporal } from 'zundo'
import { createStore } from 'zustand/vanilla'

import {
  characterAssetScope,
  type CharacterAssetInspection,
  type CharacterDraft,
  type CharacterDraftAsset,
} from '../domain/character.ts'
import { copyCharacter, createCharacterDraft, migrateCharacterDraft, validateCharacterAssetInspection } from './character-creation.ts'
import { validateReferenceInspection, validateReferencePng } from './character-model-sheet.ts'
import { restoreCharacterAppearance, sameAppearanceEdit, saveCurrentCharacterAppearance, withDefaultCharacterAppearance } from './character-appearances.ts'
import {
  CharacterRevisionConflict,
  type AssetRepositoryFactory,
  type CharacterDraftRepository,
  type CharacterRecord,
} from './ports.ts'

export type CharacterSaveStatus = 'saved' | 'saving' | 'failed' | 'conflict'

export interface CharacterEditorState {
  activeCharacterId: string | null
  /** The only temporally tracked field. Blob references are shared, never cloned. */
  character: CharacterDraft | null
  /** Latest successfully persisted Mantle entry version. Always set together with `persistedUpdatedAt`. */
  persistedRevision: number | null
  /** `updatedAt` of the same settled entry snapshot `persistedRevision` came from. */
  persistedUpdatedAt: number | null
  saveStatus: CharacterSaveStatus
  saveError?: string
}

export const CHARACTER_HISTORY_LIMIT = 50

const describe = (error: unknown) => error instanceof Error ? error.message : String(error)
const idle: CharacterEditorState = { activeCharacterId: null, character: null, persistedRevision: null, persistedUpdatedAt: null, saveStatus: 'saved', saveError: undefined }

/**
 * One autosaving command lifecycle shared by React and WebMCP. Each dispatch writes one prepared snapshot;
 * Appearance edits add one history frame, while profile edits and navigation stay outside that history.
 */
export function createCharacterEditor(
  characters: CharacterDraftRepository,
  assets: AssetRepositoryFactory,
  inspect: (blob: Blob) => Promise<CharacterAssetInspection>,
  prepare: (draft: CharacterDraft, previous: CharacterDraft | null) => Promise<CharacterDraft> = async (draft) => draft,
) {
  const store = createStore<CharacterEditorState>()(temporal(() => idle, {
    limit: CHARACTER_HISTORY_LIMIT,
    partialize: (state) => ({ character: state.character }),
    equality: (past, current) => Boolean(sameAppearanceEdit(past.character, current.character)),
  }))
  const history = store.temporal
  // ponytail: one write chain; only one Character is active, so per-Character queues collapse to this.
  let queue: Promise<void> = Promise.resolve()
  let switchQueue: Promise<void> = Promise.resolve()
  let saveSequence = 0
  let persistedCharacter: CharacterDraft | null = null

  const settle = async () => {
    let current: Promise<void>
    do { current = queue; await current } while (current !== queue)
  }
  const blocked = () => {
    const { character, saveStatus } = store.getState()
    return Boolean(character) && (saveStatus === 'failed' || saveStatus === 'conflict')
  }

  /** Pure read: hydrates and migrates in memory only; never writes or bumps the Mantle version. */
  const read = async (characterId: string): Promise<CharacterRecord> => {
    const record = await characters.get(characterId)
    if (!record) throw new Error('Character not found')
    const character = withDefaultCharacterAppearance(migrateCharacterDraft(record.character))
    const variants = await Promise.all(character.variants.map(async (variant) => ({
      ...variant,
      layers: Object.fromEntries(await Promise.all(Object.entries(variant.layers).map(async ([layer, asset]) =>
        [layer, asset && !asset.inspection.visibleBounds ? { ...asset, inspection: await inspect(asset.blob) } : asset]))),
    })))
    return { character: { ...character, variants }, version: record.version }
  }

  const activate = ({ character, version }: CharacterRecord) => {
    character = withDefaultCharacterAppearance(character)
    persistedCharacter = character
    store.setState({ activeCharacterId: character.id, character, persistedRevision: version, persistedUpdatedAt: character.updatedAt, saveStatus: 'saved', saveError: undefined })
    history.getState().clear()
  }

  const persist = (snapshot: CharacterDraft) => {
    const sequence = ++saveSequence
    const run = queue.then(async () => {
      const { activeCharacterId, character, persistedRevision, saveStatus } = store.getState()
      if (snapshot.packId !== character?.packId || persistedRevision === null || saveStatus === 'conflict') return
      store.setState({ saveStatus: 'saving', saveError: undefined })
      try {
        const prepared = await prepare(snapshot, persistedCharacter)
        let version: number, updatedAt: number
        if (persistedRevision === 0) {
          const saved = await characters.create(prepared)
          version = saved.version; updatedAt = saved.character.updatedAt
          // Mantle assigns the permanent ID on the first edit. History and queued edits keep the same pack identity.
          history.getState().pause()
          store.setState({ activeCharacterId: saved.character.id, character: { ...store.getState().character!, id: saved.character.id } })
          history.getState().resume()
        } else {
          const saved = await characters.put({ ...prepared, id: activeCharacterId! }, persistedRevision)
          version = saved.version; updatedAt = saved.updatedAt
        }
        persistedCharacter = prepared
        if (sequence === saveSequence && prepared !== snapshot) {
          history.getState().pause()
          store.setState({ character: { ...prepared, id: store.getState().activeCharacterId! } })
          history.getState().resume()
        }
        store.setState({ persistedRevision: version, persistedUpdatedAt: updatedAt,
          ...(sequence === saveSequence ? { saveStatus: 'saved' as const, saveError: undefined } : {}) })
      } catch (error) {
        store.setState({ saveStatus: error instanceof CharacterRevisionConflict ? 'conflict' : 'failed', saveError: describe(error) })
      }
    })
    queue = run
    return run
  }

  const switchTo = async (characterId: string) => {
    await settle()
    const current = store.getState()
    if (current.activeCharacterId === characterId && current.character) return current.character
    if (blocked()) throw new Error(`"${current.character!.name}" has unsaved changes. Retry, reload, or save it as a new Character first.`)
    const record = characterId === 'new'
      ? { character: createCharacterDraft(undefined, 'new'), version: 0 }
      : await read(characterId)
    activate(record)
    return store.getState().character!
  }

  /** Copies stay distinguishable in the library: `<name> copy`, then the smallest free numeric suffix. */
  const createCopy = async (source: CharacterDraft) => {
    const names = (await characters.list()).map(({ character }) => character.name)
    return characters.create(copyCharacter(source, names))
  }

  const step = (direction: 'undo' | 'redo') => {
    const current = store.getState().character
    const { pastStates, futureStates, undo, redo } = history.getState()
    if (!current || store.getState().saveStatus !== 'saved' || !(direction === 'undo' ? pastStates : futureStates).length) return Promise.resolve(false)
    ;(direction === 'undo' ? undo : redo)()
    history.getState().pause()
    store.setState({ character: restoreCharacterAppearance(current, store.getState().character!), saveStatus: 'saving', saveError: undefined })
    history.getState().resume()
    return persist(store.getState().character!).then(() => true)
  }

  return {
    store,
    history,
    settle,
    read,
    /**
     * In-memory value for the active Character, otherwise a pure read of the saved one. Revision and `updatedAt`
     * are projected from the same settled entry snapshot, so the tracked Character's stale timestamp never leaks.
     */
    async view(characterId: string): Promise<CharacterRecord> {
      const { activeCharacterId, character, persistedRevision, persistedUpdatedAt } = store.getState()
      if (!(activeCharacterId === characterId && character && persistedRevision !== null)) return read(characterId)
      return {
        character: character.updatedAt === persistedUpdatedAt ? character : { ...character, updatedAt: persistedUpdatedAt! },
        version: persistedRevision,
      }
    },
    /** Opens a Character. Same ID is a no-op; switching waits for the queue and refuses to abandon a failed/conflicted session. */
    open(characterId: string) {
      const promise = switchQueue.then(() => switchTo(characterId))
      switchQueue = promise.then(() => undefined, () => undefined)
      return promise
    },
    /**
     * One logical command: validate, produce one immutable next Character, and queue one whole-snapshot write.
     * Returning the same reference is a no-op. Resolves after this snapshot's write settles (never rejects for write errors).
     */
    dispatch(produce: (character: CharacterDraft) => CharacterDraft, expectedRevision?: number): Promise<boolean> {
      const { character, persistedRevision, saveStatus } = store.getState()
      if (!character || persistedRevision === null) throw new Error('No Character is open')
      if (saveStatus === 'conflict') throw new CharacterRevisionConflict('Character changed elsewhere; reload it or save it as a new Character.')
      if (expectedRevision !== undefined && expectedRevision !== persistedRevision) {
        throw new CharacterRevisionConflict(`Character changed; expected revision ${expectedRevision}, current ${persistedRevision}`)
      }
      const next = saveCurrentCharacterAppearance(produce(character))
      if (next === character) return Promise.resolve(false)
      const switched = next.activeAppearanceId !== character.activeAppearanceId
      if (switched && saveStatus !== 'saved') throw new Error('Save or retry the current Appearance before switching')
      if (switched) history.getState().pause()
      store.setState({ character: next, saveStatus: 'saving', saveError: undefined })
      if (switched) {
        // ponytail: history belongs to the open Appearance session; switching resets it so shared art cannot be replayed across looks.
        history.getState().clear()
        history.getState().resume()
      }
      return persist(next).then(() => true)
    },
    undo: () => step('undo'),
    redo: () => step('redo'),
    /** Re-saves the current snapshot, not the one that first failed. */
    retry() {
      const { character, saveStatus } = store.getState()
      if (!character || saveStatus !== 'failed') return Promise.resolve()
      store.setState({ saveStatus: 'saving', saveError: undefined })
      return persist(character)
    },
    /** Discards the local session and loads the saved Character. */
    async reload() {
      const { activeCharacterId } = store.getState()
      if (!activeCharacterId) throw new Error('No Character is open')
      await settle()
      if (store.getState().persistedRevision === 0) { activate({ character: createCharacterDraft(undefined, 'new'), version: 0 }); return }
      const record = await read(activeCharacterId)
      activate(record)
      return record.character
    },
    /** Inspects, validates, and stores the Blob in the active Character's asset scope before any command runs. */
    async stageAsset(blob: Blob, filename: string, source: CharacterDraftAsset['source'], inspection?: CharacterAssetInspection, purpose: 'layer' | 'reference' = 'layer'): Promise<Omit<CharacterDraftAsset, 'canonicalSha256'>> {
      const { character } = store.getState()
      if (!character) throw new Error('No Character is open')
      if (purpose === 'reference') await validateReferencePng(blob)
      const inspected = inspection ?? await inspect(blob)
      if (purpose === 'reference') validateReferenceInspection(inspected)
      else validateCharacterAssetInspection(inspected)
      const repository = assets(characterAssetScope(character.packId))
      if (!await repository.get(inspected.sha256)) await repository.put(inspected.sha256, blob)
      return { blob, filename, source, inspection: inspected }
    },
    /** Shared duplication primitive: new Character ID and pack scope, asset bytes copied into it. Outside history. */
    duplicate: (source: CharacterDraft) => createCopy(source),
    /** Save As: duplicates the in-memory value and makes the copy the active session. */
    async saveAs() {
      await settle()
      const { character } = store.getState()
      if (!character) throw new Error('No Character is open')
      const record = await createCopy(character)
      activate(record)
      return record.character
    },
    /** Ends the session for a Character about to be deleted. */
    async close(characterId: string) {
      if (store.getState().activeCharacterId !== characterId) return
      await settle()
      store.setState(idle)
      history.getState().clear()
    },
  }
}

export type CharacterEditor = ReturnType<typeof createCharacterEditor>
