import { BookOpenIcon, BookTextIcon, ChevronDownIcon, EllipsisIcon, FolderInputIcon, PlusIcon } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import type { CharacterDraft } from '@/core/domain/character'
import { DEFAULT_CHARACTER_COLLECTION, type CharacterCollection, type CharacterCollectionProfile } from '@/core/domain/character-collection'
import { CharacterLibraryTransfer, type CharacterLibraryTransferProps } from '@/ui/CharacterLibraryTransfer'
import { AozuIcon } from '@/ui/AozuIcon'
import { RenderStatus } from '@/ui/CharacterRenderer'
import { useBlobUrl } from '@/ui/useBlobUrl'
import { DataControls } from '@/ui/DataControls'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/ui/components/ui/sheet'

export type CharacterLibraryItem = Pick<CharacterDraft, 'id' | 'name' | 'updatedAt'> & {
  previewKey: string
}

type LoadThumbnail = (id: string, previewKey: string, signal: AbortSignal) => Promise<Blob | null>
function CharacterCardPortrait({ character, loadThumbnail }: { character: CharacterLibraryItem; loadThumbnail: LoadThumbnail }) {
  const host = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<{ key: string; blob?: Blob | null; failed?: boolean }>()
  const key = `${character.id}:${character.previewKey}`
  useEffect(() => {
    const controller = new AbortController()
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      observer.disconnect()
      void loadThumbnail(character.id, character.previewKey, controller.signal).then(
        (blob) => { if (!controller.signal.aborted) setResult({ key, blob }) },
        () => { if (!controller.signal.aborted) setResult({ key, failed: true }) },
      )
    })
    if (host.current) observer.observe(host.current)
    return () => { controller.abort(); observer.disconnect() }
  }, [character.id, character.previewKey, key, loadThumbnail])
  const current = result?.key === key ? result : undefined
  const src = useBlobUrl(current?.blob ?? undefined)
  return <div ref={host} className="relative aspect-2/3 w-full overflow-hidden rounded-3xl border bg-muted/40" role="img" aria-label={character.name}>
    {src ? <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
      : current?.blob === null ? <div className="character-empty-placeholder absolute inset-0 p-8"><img src="/assets/placeholders/companion-body-faint.webp" alt="" /></div>
        : <RenderStatus failed={current?.failed} />}
  </div>
}

export function CharacterLibraryPage({ characters, loadThumbnail, collections, locationCounts, createCollection, updateCollection, deleteCollection, assignCollection, openCharacter, importCharacter, refresh, ...transfer }: CharacterLibraryTransferProps & {
  characters: CharacterLibraryItem[]
  loadThumbnail: LoadThumbnail
  collections: CharacterCollection[]
  locationCounts: Record<string, number>
  createCollection(name: string): Promise<CharacterCollection>
  updateCollection(id: string, profile: CharacterCollectionProfile, version: number): Promise<void>
  deleteCollection(id: string, version: number): Promise<void>
  assignCollection(characterId: string, collectionId: string): Promise<void>
  openCharacter(id: string): void
  importCharacter(blob: Blob): Promise<void>
  refresh(): Promise<void>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { collectionId } = useParams()
  const book = collections.find(({ id }) => id === collectionId)
  const [panel, setPanel] = useState<'create' | 'profile' | 'move' | 'backup' | 'import' | 'delete'>()
  const [editing, setEditing] = useState<CharacterCollection>()
  const [profile, setProfile] = useState<CharacterCollectionProfile>({ name: '', description: '', backstory: '' })
  const [moving, setMoving] = useState<CharacterLibraryItem>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const nameOf = (value: CharacterCollection) => value.id === DEFAULT_CHARACTER_COLLECTION ? t('books.default') : value.name
  const openPanel = (next: typeof panel) => { setError(undefined); setPanel(next) }
  const createBook = () => { setMoving(undefined); setProfile({ name: '', description: '', backstory: '' }); openPanel('create') }
  const editBook = (value: CharacterCollection) => { setEditing(value); setProfile({ name: value.name, description: value.description, backstory: value.backstory }); openPanel('profile') }
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setError(undefined)
    try { await task(); await refresh(); setPanel(undefined) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); await refresh() }
    finally { setBusy(false) }
  }
  const visible = book ? characters.filter(({ id }) => book.characterIds.includes(id)) : []
  const cardsRef = useRef<HTMLDivElement>(null)
  const hasCards = visible.length > 0
  useLayoutEffect(() => {
    const grid = cardsRef.current
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!grid || reducedMotion.matches) return
    // The original nine-card fan is an entrance; larger collections stay immediately usable in the grid.
    const cards = Array.from(grid.children).slice(0, 9) as HTMLElement[]
    const rects = cards.map((card) => card.getBoundingClientRect())
    const middle = (cards.length - 1) / 2
    const center = (Math.min(...rects.map(({ left }) => left)) + Math.max(...rects.map(({ right }) => right))) / 2
    const spread = Math.min(48, Math.max(0, (grid.clientWidth - rects[0].width) / Math.max(1, cards.length - 1)))
    const animations = cards.map((card, index) => {
      const rect = rects[index], offset = index - middle
      const x = center - rect.left - rect.width / 2, y = rects[0].top - rect.top
      return card.animate([
        { transform: `translate(${x}px, ${y + 20}px) scale(0.85)`, opacity: 0 },
        { transform: `translate(${x + offset * spread}px, ${y + Math.abs(offset) * 7}px) rotate(${offset * 4.25}deg) scale(0.9)`, opacity: 1, offset: 0.4 },
        { transform: 'none', opacity: 1 },
      ], { duration: 740, delay: index * 35, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' })
    })
    const cancel = () => animations.forEach((animation) => animation.cancel())
    reducedMotion.addEventListener('change', cancel)
    return () => { cancel(); reducedMotion.removeEventListener('change', cancel) }
  }, [book?.id, hasCards])
  if (collectionId && !book) return <Navigate to={`/collections/${DEFAULT_CHARACTER_COLLECTION}`} replace />
  const menuItem = 'book-menu-item'

  return <main className="card-library mx-auto w-full max-w-6xl p-4 sm:p-6"
    data-workspace-view={book ? 'collection' : 'collections'} data-collection-id={book?.id}
    data-panel={panel} data-has-uncommitted-input={panel === 'profile' || panel === 'create'}>

    <div className="book-toolbar">
      <div className="min-w-0">
        {book ? <DropdownMenu.Root><DropdownMenu.Trigger asChild>
          <button type="button" className="book-switcher" aria-label={t('books.switch')}><BookOpenIcon aria-hidden="true" /><h1>{nameOf(book)}</h1><ChevronDownIcon className="size-4 shrink-0" aria-hidden="true" /></button>
        </DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="book-menu" align="start" sideOffset={8}>
          {collections.map((value) => <DropdownMenu.Item key={value.id} className={menuItem} onSelect={() => navigate(`/collections/${value.id}`)}>{nameOf(value)}{value.id === book.id && <span aria-hidden="true">✓</span>}</DropdownMenu.Item>)}
          <DropdownMenu.Separator className="my-1 border-t" />
          <DropdownMenu.Item className={menuItem} onSelect={createBook}><PlusIcon />{t('books.create')}</DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => navigate('/collections')}><BookOpenIcon />{t('books.all')}</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root> : <h1 className="font-heading text-2xl font-semibold sm:text-3xl">{t('books.shelf')}</h1>}
        <p className="mt-1 text-sm text-muted-foreground">{t(book ? 'books.characterCount' : 'books.bookCount', { count: book ? visible.length : collections.length })}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button onClick={() => book ? navigate('/characters/new/expressions') : createBook()}><PlusIcon />{t(book ? 'characters.new' : 'books.create')}</Button>
        <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button variant="outline" size="icon" aria-label={t('books.actions')}><EllipsisIcon /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="book-menu" align="end" sideOffset={8}>
          {book && <DropdownMenu.Item className={menuItem} onSelect={() => editBook(book)}><BookTextIcon />{t('books.profile')}</DropdownMenu.Item>}
          <DropdownMenu.Item className={menuItem} onSelect={() => openPanel('import')}>{t('data.import')}</DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => openPanel('backup')}>{t('library.backupTitle')}</DropdownMenu.Item>
          {book && book.id !== DEFAULT_CHARACTER_COLLECTION && <DropdownMenu.Item className={`${menuItem} text-destructive`} onSelect={() => { setEditing(book); openPanel('delete') }}>{t('books.delete')}</DropdownMenu.Item>}
        </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
      </div>
    </div>

    {book && <nav className="world-tabs"><Link aria-current="page" to={`/collections/${book.id}`}>{t('world.characters')}</Link><Link to={`/collections/${book.id}/locations`}>{t('world.locations')}</Link></nav>}
    {book ? <>
      {book.description && <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{book.description}</p>}
      {book.backstory ? <details className="book-world mb-5"><summary><BookTextIcon className="size-4" />{t('books.world')}</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{book.backstory}</p><Button className="mt-3" variant="outline" onClick={() => editBook(book)}>{t('books.editWorld')}</Button></details>
        : <Button className="mb-4" size="sm" variant="ghost" onClick={() => editBook(book)}><BookTextIcon />{t('books.world')}</Button>}
      <section className="book-page" aria-label={nameOf(book)}>
        {visible.length ? <div key={book.id} ref={cardsRef} className="book-card-grid" role="list">
          {visible.map((character) => <article key={character.id} role="listitem" className="book-character-card">
            <button type="button" className="companion-card-open" aria-label={`${t('characters.edit')} ${character.name}`} onClick={() => openCharacter(character.id)}>
              <span className="companion-card-portrait"><CharacterCardPortrait character={character} loadThumbnail={loadThumbnail} /></span>
              <span className="companion-card-name">{character.name}</span>
            </button>
            <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button className="book-card-action" variant="ghost" size="icon" aria-label={t('books.characterActions', { name: character.name })}><EllipsisIcon /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="book-menu" align="end" sideOffset={4}>
              <DropdownMenu.Item className={menuItem} onSelect={() => openCharacter(character.id)}>{t('characters.edit')}</DropdownMenu.Item>
              <DropdownMenu.Item className={menuItem} onSelect={() => { setMoving(character); openPanel('move') }}><FolderInputIcon />{t('books.move')}</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
          </article>)}
        </div> : <div className="book-empty"><AozuIcon name="book" className="size-20" /><h2 className="font-heading text-xl">{t('books.empty')}</h2><p className="max-w-sm text-sm text-muted-foreground">{t(book.id === DEFAULT_CHARACTER_COLLECTION ? 'books.emptyDefault' : 'books.emptyCustom')}</p><Button variant="outline" onClick={() => book.id === DEFAULT_CHARACTER_COLLECTION ? navigate('/characters/new/expressions') : navigate(`/collections/${DEFAULT_CHARACTER_COLLECTION}`)}>{t(book.id === DEFAULT_CHARACTER_COLLECTION ? 'characters.new' : 'books.browseDefault')}</Button></div>}
      </section>
    </> : <section className="bookshelf-grid" aria-label={t('books.shelf')}>
      {collections.map((value) => <Link key={value.id} to={`/collections/${value.id}`} className="collection-cover">
        <AozuIcon name="book" className="collection-cover-seal" />
        <h2>{nameOf(value)}</h2>
        <p>{t('books.characterCount', { count: value.characterIds.length })} · {t('world.locations')} {locationCounts[value.id] ?? 0}</p>
        {value.description && <span className="line-clamp-2 text-sm">{value.description}</span>}
      </Link>)}
    </section>}

    <Sheet open={Boolean(panel)} onOpenChange={(open) => { if (!open && !busy) setPanel(undefined) }}>
      <SheetContent className="book-panel overflow-y-auto p-5 sm:p-6" closeLabel={t('common.close')} aria-describedby={undefined} onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>
        <SheetTitle className="pr-8 text-xl">{t(panel === 'create' ? 'books.create' : panel === 'move' ? 'books.move' : panel === 'backup' ? 'library.backupTitle' : panel === 'import' ? 'data.import' : panel === 'delete' ? 'books.delete' : 'books.profile')}</SheetTitle>
        {(panel === 'create' || panel === 'profile') && <form className="book-profile-form" onSubmit={(event) => { event.preventDefault(); void run(async () => {
          if (panel === 'create') {
            const created = await createCollection(profile.name)
            if (moving) await assignCollection(moving.id, created.id)
            navigate(`/collections/${created.id}`)
          } else if (editing) await updateCollection(editing.id, profile, editing.version)
        }) }}>
          {(panel === 'create' || editing?.id !== DEFAULT_CHARACTER_COLLECTION) && <label>{t('books.name')}<input autoFocus required maxLength={100} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} disabled={busy} /></label>}
          {panel === 'profile' && <><label>{t('books.description')}<textarea rows={3} maxLength={500} value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} disabled={busy} /></label>
          <label>{t('books.world')}<textarea rows={11} maxLength={8000} value={profile.backstory} onChange={(event) => setProfile({ ...profile, backstory: event.target.value })} disabled={busy} /><span className="text-xs font-normal text-muted-foreground">{t('books.worldHint')}</span></label></>}
          {panel === 'create' && <p className="text-sm text-muted-foreground">{t('books.createHint')}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" type="button" disabled={busy} onClick={() => setPanel(undefined)}>{t('common.cancel')}</Button><Button disabled={busy || !profile.name.trim()} type="submit">{t(busy ? 'data.busy' : panel === 'create' ? 'books.create' : 'books.save')}</Button></div>
        </form>}
        {panel === 'move' && moving && <div className="grid gap-2"><p className="mb-3 text-sm">{moving.name}</p>{collections.map((value) => <Button key={value.id} variant="outline" className="justify-start" disabled={busy || value.characterIds.includes(moving.id)} onClick={() => void run(() => assignCollection(moving.id, value.id))}><BookOpenIcon />{nameOf(value)}</Button>)}<Button className="mt-2 justify-start" variant="ghost" onClick={() => { setProfile({ name: '', description: '', backstory: '' }); openPanel('create') }}><PlusIcon />{t('books.create')}</Button></div>}
        {panel === 'delete' && editing && <><p>{t('books.deleteHint', { name: nameOf(editing) })}</p><Button variant="destructive" disabled={busy} onClick={() => void run(async () => { await deleteCollection(editing.id, editing.version); navigate(`/collections/${DEFAULT_CHARACTER_COLLECTION}`) })}>{t(busy ? 'data.busy' : 'books.delete')}</Button></>}
        {panel === 'backup' && <CharacterLibraryTransfer {...transfer} />}
        {panel === 'import' && <><p className="text-sm text-muted-foreground">{t('books.importHint')}</p><DataControls prepareImport={importCharacter} /></>}
        {error && <div role="alert" className="text-sm text-destructive">{error}{panel === 'profile' && editing && <Button variant="link" onClick={() => { const latest = collections.find(({ id }) => id === editing.id); if (latest) editBook(latest) }}>{t('characterDraft.status.reload')}</Button>}</div>}
      </SheetContent>
    </Sheet>
  </main>
}
