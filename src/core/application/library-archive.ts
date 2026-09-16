import { strToU8, zipSync } from 'fflate'

import { parseZipJson, readSafeZip } from '../../adapters/zip/archive.ts'
import type { CharacterLibrarySnapshot } from './character-library.ts'
import type { StoryboardService } from './storyboard.ts'
import type { WorldLibraryService } from './world-library.ts'

const limits = { archive: 512 * 1024 * 1024, expanded: 512 * 1024 * 1024, file: 280 * 1024 * 1024, files: 1100 }
interface Manifest { format: 'aozu-library'; version: 2; storyboards: string[]; boardBooks: Record<string, string> }
interface LegacyManifest { format: 'aozu-library'; version: 1; storyboards: string[]; boardFolders: Record<string, string> }
interface LibraryArchiveServices {
  exportCharacters(): Promise<Blob>
  prepareCharacters(blob: Blob): Promise<CharacterLibrarySnapshot>
  importCharacters(snapshot: CharacterLibrarySnapshot): Promise<void>
  world: Pick<WorldLibraryService, 'export' | 'importPreservingCollections' | 'load' | 'save'>
  storyboards: Pick<StoryboardService, 'list' | 'export' | 'import'>
}

export async function exportLibraryArchive(services: LibraryArchiveServices) {
  const [characters, world, boards] = await Promise.all([services.exportCharacters(), services.world.export(), services.storyboards.list()])
  const files: Record<string, Uint8Array> = {
    'characters.zip': new Uint8Array(await characters.arrayBuffer()),
    'world.zip': new Uint8Array(await world.arrayBuffer()),
  }
  for (const board of boards) files[`storyboards/${board.id}.zip`] = new Uint8Array(await (await services.storyboards.export(board.id, board.revision)).arrayBuffer())
  const library = await services.world.load()
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'aozu-library', version: 2, storyboards: boards.map(({ id }) => id), boardBooks: library.boardBooks } satisfies Manifest))
  const archive = zipSync(files, { level: 0 })
  readSafeZip(archive, accepts, limits)
  return new Blob([archive], { type: 'application/zip' })
}

const accepts = (path: string) => path === 'manifest.json' || path === 'characters.zip' || path === 'world.zip' || /^storyboards\/[a-zA-Z0-9_-]{1,100}\.zip$/.test(path)

export async function importLibraryArchive(blob: Blob, services: LibraryArchiveServices) {
  const files = readSafeZip(new Uint8Array(await blob.arrayBuffer()), accepts, limits)
  if (!files['manifest.json'] || !files['characters.zip'] || !files['world.zip']) throw new Error('Complete library archive is missing required files')
  const manifest = parseZipJson<Manifest | LegacyManifest>(files['manifest.json'], 'complete library manifest')
  if (!manifest || manifest.format !== 'aozu-library' || ![1, 2].includes(manifest.version) || !Array.isArray(manifest.storyboards)) throw new Error('Unsupported complete library archive')
  const boardBooks = manifest.version === 1 ? manifest.boardFolders : manifest.boardBooks
  if (!boardBooks || typeof boardBooks !== 'object') throw new Error('Unsupported complete library archive')
  const boardIds = new Set(manifest.storyboards)
  if (boardIds.size !== manifest.storyboards.length || manifest.storyboards.some((id) => !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) ||
    Object.keys(files).filter((path) => path.startsWith('storyboards/')).some((path) => !boardIds.delete(path.slice(12, -4))) || boardIds.size) throw new Error('Complete library storyboard manifest does not match its files')

  const characters = await services.prepareCharacters(new Blob([files['characters.zip']], { type: 'application/zip' }))
  await services.importCharacters(characters)
  const importedWorld = await services.world.importPreservingCollections(new Blob([files['world.zip']], { type: 'application/zip' }), await services.world.load())
  const boardMap: Record<string, string> = {}
  for (const sourceId of manifest.storyboards) {
    const board = await services.storyboards.import(new Blob([files[`storyboards/${sourceId}.zip`]], { type: 'application/zip' }))
    boardMap[board.sourceId] = board.id
  }
  const next = structuredClone(await services.world.load())
  for (const [sourceBoard, sourceBook] of Object.entries(boardBooks)) {
    const board = boardMap[sourceBoard], book = importedWorld.idMap[sourceBook]
    if (board && book) next.boardBooks[board] = book
  }
  if (JSON.stringify(next.boardBooks) !== JSON.stringify(importedWorld.library.boardBooks)) await services.world.save(next)
}
