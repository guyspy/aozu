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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip'
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

function TreeChildren({ children }: { children: ReactNode }) {
  return <div className="library-tree-children">{children}</div>
}

function TreeDetails({ initialOpen, label, children }: { initialOpen: boolean; label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen)
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{label}</summary><TreeChildren>{children}</TreeChildren></details>
}

type ExplorerProps = {
  application: Application
  world: WorldLibrary
  collections: CharacterCollection[]
  characters: CharacterLibraryItem[]
  refresh(): Promise<void>
}

/**
 * Mounted only while the drawer is open, so no route change pays for the storyboard read
 * or for building the tree behind a closed drawer.
 */
function ExplorerBody({ application, world, collections, characters, refresh, close }: ExplorerProps & { close(): void }) {
  const { t } = useTranslation(), text = (key: string) => t(`world.${key}`), { pathname } = useLocation()
  const [boards, setBoards] = useState<Awaited<ReturnType<Application['storyboards']['list']>>>([]), [error, setError] = useState('')
  const loadBoards = useCallback(() => application.storyboards.list().then(setBoards, (caught) => setError(String(caught))), [application])
  useEffect(() => { void loadBoards(); return application.storyboards.subscribe(() => void loadBoards()) }, [application, loadBoards])
  const services = application.archiveServices()
  const locations = (parentId: string | null, collectionId: string): ReactNode => world.locations.filter((place) => place.collectionId === collectionId && place.parentId === parentId).map((place) => {
    const path = `/collections/${collectionId}/locations/${place.id}`
    return <TreeDetails key={place.id} initialOpen={pathname.includes(place.id)} label={place.name}>
      <TreeLink to={path}>{text('images')}</TreeLink>
      <TreeLink to={`${path}/profile`}>{text('locationProfile')}</TreeLink>
      <TreeDetails initialOpen={pathname.includes(`${place.id}/conditions`)} label={text('conditions')}>
        {place.conditions.map((condition) => <TreeLink key={condition.id} to={`${path}/conditions/${condition.id}`}>{condition.name}</TreeLink>)}
      </TreeDetails>
      {locations(place.id, collectionId)}
    </TreeDetails>
  })
  const storyboardLinks = (book?: string) => boards.filter((board) => world.boardBooks[board.id] === book).map((board) => <TreeLink key={board.id} to={`/storyboards/${board.id}`} action={<Button size="icon" variant="ghost" aria-label={t('storyboard.export')} onClick={() => void application.storyboards.export(board.id, board.revision).then((blob) => save(blob, `${board.name}.zip`), (caught) => setError(String(caught)))}><DownloadIcon /></Button>}>{board.name}</TreeLink>)

  return <WorkspaceScroll>
    <section className="mb-3 rounded-lg border bg-muted/40 p-3" aria-label={text('localOnly')}>
      <div className="font-medium">{text('localOnly')}</div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text('localOnlyDescription')}</p>
    </section>
    <section className="library-tree-transfer">
      <DataControls exportData={() => exportLibraryArchive(services)} exportFilename="aozu-library.zip" exportLabel={text('downloadComplete')} importLabel={text('importComplete')} prepareImport={async (blob) => { await importLibraryArchive(blob, services); await refresh(); await loadBoards() }} />
    </section>
    <nav className="library-tree" aria-label={text('library')} onClick={(event) => { if ((event.target as Element).closest('a')) close() }}>
      <TreeDetails initialOpen={pathname.startsWith('/collections') || pathname.startsWith('/characters')} label={<><AozuIcon name="collections" />{t('books.shelf')}</>}>
        {collections.map((collection) => <TreeDetails key={collection.id} initialOpen={pathname.includes(`/collections/${collection.id}`) || collection.characterIds.some((id) => pathname.includes(id))} label={collection.id === 'default' ? t('books.default') : collection.name}>
          <TreeLink to={`/collections/${collection.id}`}>{text('characters')}</TreeLink>
          <TreeChildren>{characters.filter((character) => collection.characterIds.includes(character.id)).map((character) => <TreeLink key={character.id} to={`/characters/${character.id}/expressions`} action={<Button size="icon" variant="ghost" aria-label={t('data.export')} onClick={() => void application.exportCharacter(character.id).then((blob) => save(blob, `${character.name}.zip`), (caught) => setError(String(caught)))}><DownloadIcon /></Button>}>{character.name}</TreeLink>)}</TreeChildren>
          <TreeLink to={`/collections/${collection.id}/locations`}>{text('locations')}</TreeLink><TreeChildren>{locations(null, collection.id)}</TreeChildren>
        </TreeDetails>)}
      </TreeDetails>
      <TreeDetails initialOpen={pathname.startsWith('/albums')} label={<><AozuIcon name="albums" />{text('albums')}</>}>{world.albums.map((album) => <TreeLink key={album.id} to={`/albums/${album.id}`}>{album.id === 'default' ? text('defaultAlbum') : album.name}</TreeLink>)}</TreeDetails>
      <TreeDetails initialOpen={pathname.startsWith('/storyboards')} label={<><AozuIcon name="storyboards" />{text('storyboards')}</>}>
        {boards.some((board) => !world.boardBooks[board.id]) && <TreeDetails initialOpen={pathname.includes('/books/unfiled') || boards.some((board) => !world.boardBooks[board.id] && pathname.includes(board.id))} label={text('unfiled')}>
          {storyboardLinks()}
        </TreeDetails>}
        {world.storyBooks.map((book) => <TreeDetails key={book.id} initialOpen={pathname.includes(book.id)} label={book.name}>{storyboardLinks(book.id)}</TreeDetails>)}
      </TreeDetails>
    </nav>
    {error && <p role="alert" className="story-error">{error}</p>}
  </WorkspaceScroll>
}

export function LibraryExplorer(props: ExplorerProps) {
  const { t } = useTranslation(), text = (key: string) => t(`world.${key}`)
  const [open, setOpen] = useState(false)

  return <>
    <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" aria-label={`${text('library')}. ${text('localOnly')}`} className="h-9 w-9 px-0 sm:w-auto sm:px-3" onClick={() => setOpen(true)}><FolderTreeIcon /><span className="hidden sm:inline">{text('library')}</span></Button></TooltipTrigger><TooltipContent>{text('localOnly')}</TooltipContent></Tooltip></TooltipProvider>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="library-explorer" closeLabel={t('common.close')} aria-describedby={undefined}>
        <SheetTitle>{text('library')}</SheetTitle>
        {open && <ExplorerBody {...props} close={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  </>
}
