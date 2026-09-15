import { DownloadIcon, FolderTreeIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'

import type { Application } from '@/bootstrap'
import type { CharacterCollection } from '@/core/domain/character-collection'
import type { WorldLibrary } from '@/core/domain/world-library'
import type { CharacterLibraryItem } from '@/ui/pages/CharacterLibraryPage'
import { exportLibraryArchive, importLibraryArchive } from '@/core/application/library-archive'
import { AozuIcon } from '@/ui/AozuIcon'
import { DataControls } from '@/ui/DataControls'
import { WorkspaceScroll } from '@/ui/Workspace'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/ui/components/ui/sheet'
import { cn } from '@/ui/lib/utils'

const save = async (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function TreeLink({ to, children, action }: { to: string; children: ReactNode; action?: ReactNode }) {
  const { pathname } = useLocation()
  return <div className={cn('library-tree-row', pathname === to && 'active')}><Link to={to}>{children}</Link>{action}</div>
}

function TreeDetails({ initialOpen, children }: { initialOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen)
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>{children}</details>
}

export function LibraryExplorer({ application, world, collections, characters, refresh }: {
  application: Application
  world: WorldLibrary
  collections: CharacterCollection[]
  characters: CharacterLibraryItem[]
  refresh(): Promise<void>
}) {
  const { t } = useTranslation(), text = (key: string) => t(`world.${key}`), { pathname } = useLocation()
  const [open, setOpen] = useState(false), [boards, setBoards] = useState<Awaited<ReturnType<Application['storyboards']['list']>>>([]), [error, setError] = useState('')
  const loadBoards = useCallback(() => application.storyboards.list().then(setBoards, (caught) => setError(String(caught))), [application])
  useEffect(() => { void loadBoards(); return application.storyboards.subscribe(() => void loadBoards()) }, [application, loadBoards])
  const services = {
    exportCharacters: application.exportCharacterLibrary,
    prepareCharacters: application.prepareCharacterLibraryImport,
    importCharacters: (snapshot: Awaited<ReturnType<Application['prepareCharacterLibraryImport']>>) => application.importCharacterLibrary(snapshot, 'merge'),
    world: application.worldLibrary,
    storyboards: application.storyboards,
  }
  const go = () => setOpen(false)
  const locations = (parentId: string | null, collectionId: string): ReactNode => world.locations.filter((place) => place.collectionId === collectionId && place.parentId === parentId).map((place) => <TreeDetails key={place.id} initialOpen={pathname.includes(place.id)}><summary>{place.name}</summary><TreeLink to={`/collections/${collectionId}/locations/${place.id}`}>{text('settings')}</TreeLink><div className="library-tree-children">{locations(place.id, collectionId)}</div></TreeDetails>)
  const storyboardLinks = (folder?: string) => boards.filter((board) => world.boardFolders[board.id] === folder).map((board) => <TreeLink key={board.id} to={`/storyboards/${board.id}`} action={<Button size="icon" variant="ghost" aria-label={t('storyboard.export')} onClick={() => void application.storyboards.export(board.id, board.revision).then((blob) => save(blob, `${board.name}.zip`), (caught) => setError(String(caught)))}><DownloadIcon /></Button>}>{board.name}</TreeLink>)

  return <>
    <Button type="button" variant="ghost" onClick={() => setOpen(true)}><FolderTreeIcon />{text('library')}</Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="library-explorer" closeLabel={t('common.close')} aria-describedby={undefined}>
        <SheetTitle>{text('library')}</SheetTitle>
        <WorkspaceScroll>
          <section className="library-tree-transfer">
            <DataControls exportData={() => exportLibraryArchive(services)} exportFilename="aozu-library.zip" exportLabel={text('downloadComplete')} importLabel={text('importComplete')} prepareImport={async (blob) => { await importLibraryArchive(blob, services); await refresh(); await loadBoards() }} />
          </section>
          <nav className="library-tree" aria-label={text('library')} onClick={(event) => { if ((event.target as Element).closest('a')) go() }}>
            <TreeDetails initialOpen={pathname.startsWith('/collections') || pathname.startsWith('/characters')}><summary><AozuIcon name="collections" />{t('library.collections')}</summary>
              <div className="library-tree-children">{collections.map((collection) => <TreeDetails key={collection.id} initialOpen={pathname.includes(`/collections/${collection.id}`) || collection.characterIds.some((id) => pathname.includes(id))}><summary>{collection.id === 'default' ? text('defaultCollection') : collection.name}</summary><div className="library-tree-children">
                <TreeLink to={`/collections/${collection.id}`}>{text('characters')}</TreeLink>
                <div className="library-tree-children">{characters.filter((character) => collection.characterIds.includes(character.id)).map((character) => <TreeLink key={character.id} to={`/characters/${character.id}/expressions`} action={<Button size="icon" variant="ghost" aria-label={t('data.export')} onClick={() => void application.exportCharacter(character.id).then((blob) => save(blob, `${character.name}.zip`), (caught) => setError(String(caught)))}><DownloadIcon /></Button>}>{character.name}</TreeLink>)}</div>
                <TreeLink to={`/collections/${collection.id}/locations`}>{text('locations')}</TreeLink><div className="library-tree-children">{locations(null, collection.id)}</div>
              </div></TreeDetails>)}</div>
            </TreeDetails>
            <TreeDetails initialOpen={pathname.startsWith('/albums')}><summary><AozuIcon name="albums" />{text('albums')}</summary><div className="library-tree-children">{world.albums.map((album) => <TreeLink key={album.id} to={`/albums/${album.id}`}>{album.id === 'default' ? text('defaultAlbum') : album.name}</TreeLink>)}</div></TreeDetails>
            <TreeDetails initialOpen={pathname.startsWith('/storyboards')}><summary><AozuIcon name="storyboards" />{text('storyboards')}</summary><div className="library-tree-children">
              <TreeDetails initialOpen={pathname.includes('/folders/unfiled') || boards.some((board) => !world.boardFolders[board.id] && pathname.includes(board.id))}><summary>{text('unfiled')}</summary><div className="library-tree-children">
                {storyboardLinks()}
              </div></TreeDetails>
              {world.folders.map((folder) => <TreeDetails key={folder.id} initialOpen={pathname.includes(folder.id)}><summary>{folder.name}</summary><div className="library-tree-children">{storyboardLinks(folder.id)}</div></TreeDetails>)}
            </div></TreeDetails>
          </nav>
          {error && <p role="alert" className="story-error">{error}</p>}
        </WorkspaceScroll>
      </SheetContent>
    </Sheet>
  </>
}
