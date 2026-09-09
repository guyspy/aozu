import { STORYBOARD_NAMESPACE, applyBoardCommand, validateStoryboard, type BoardCommand, type BoardImage, type Storyboard } from '../../core/domain/storyboard.ts'
import { ASSET_STORE, ENTRY_STORE, openCompanionDatabase, type StoredEntry } from './database.ts'

const key = (id: string): [string, string] => [STORYBOARD_NAMESPACE, id]
const project = (row: StoredEntry) => validateStoryboard(row.data.board)
const entry = (board: Storyboard): StoredEntry => ({ bundleId: STORYBOARD_NAMESPACE, id: board.id, collection: 'storyboards', data: { board }, status: 'published', authorId: null, version: board.revision, createdAt: board.updatedAt, updatedAt: board.updatedAt })
export function createStoryboardRepository() {
  return {
    async list() {
      const rows = await (await openCompanionDatabase()).getAllFromIndex(ENTRY_STORE, 'bundleId', STORYBOARD_NAMESPACE)
      return rows.map(project).sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async get(id: string) {
      const row = await (await openCompanionDatabase()).get(ENTRY_STORE, key(id))
      if (!row) throw new Error('Storyboard not found')
      return project(row)
    },
    async image(id: string) {
      const asset = await (await openCompanionDatabase()).get(ASSET_STORE, key(id))
      if (!asset) throw new Error('Storyboard image is missing')
      return asset.blob
    },
    async create(name: string, imported?: Storyboard, blobs: Map<string, Blob> = new Map()) {
      if (!name.trim() || name.length > 120) throw new Error('Storyboard name is required (120 characters maximum)')
      const board: Storyboard = validateStoryboard({ ...(imported ?? { notes: '', frames: [], images: [], past: [], future: [] }), id: crypto.randomUUID(), revision: 1, updatedAt: Date.now(), name: name.trim() })
      if (board.images.some((image) => !blobs.has(image.id))) throw new Error('Imported image is missing')
      const tx = (await openCompanionDatabase()).transaction([ENTRY_STORE, ASSET_STORE], 'readwrite')
      try {
      for (const image of board.images) {
        const blob = blobs.get(image.id)
        if (!blob) { tx.abort(); throw new Error('Imported image is missing') }
        await tx.objectStore(ASSET_STORE).put({ bundleId: STORYBOARD_NAMESPACE, id: image.id, blob })
      }
      await tx.objectStore(ENTRY_STORE).add(entry(board)); await tx.done
      return board
      } catch (error) { try { tx.abort() } catch { /* Already aborted. */ } await tx.done.catch(() => {}); throw error }
    },
    async update(command: BoardCommand, uploaded?: { image: BoardImage; blob: Blob }) {
      if (!command.boardId || command.expectedRevision === undefined) throw new Error('Board and expectedRevision are required')
      const tx = (await openCompanionDatabase()).transaction([ENTRY_STORE, ASSET_STORE], 'readwrite')
      try {
        const row = await tx.objectStore(ENTRY_STORE).get(key(command.boardId))
        if (!row || row.version !== command.expectedRevision) throw new Error('Storyboard changed elsewhere. Reload before saving; your input has not been applied.')
        const board = project(row)
        const next = applyBoardCommand(board, command, uploaded?.image)
        if (JSON.stringify(next) === JSON.stringify(board)) { await tx.done; return board }
        next.revision++; next.updatedAt = Date.now()
        validateStoryboard(next)
        if (uploaded) await tx.objectStore(ASSET_STORE).add({ bundleId: STORYBOARD_NAMESPACE, id: uploaded.image.id, blob: uploaded.blob })
        await tx.objectStore(ENTRY_STORE).put(entry(next)); await tx.done
        return next
      } catch (error) { try { tx.abort() } catch { /* Already aborted. */ } await tx.done.catch(() => {}); throw error }
    },
  }
}
