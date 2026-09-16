import { WorkspaceSheet, Workspace, WorkspaceCard, WorkspaceProfileHeading, WorkspaceSurface, WorkspaceTabs, WorkspaceScroll } from '@/ui/Workspace'
import { LibraryTabs } from '@/ui/LibraryTabs'
import { CollectionBookCard, WatermarkAddCard } from '@/ui/LibraryCards'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'

import type { CharacterDraft } from '@/core/domain/character'
import { DEFAULT_CHARACTER_COLLECTION, type CharacterCollection } from '@/core/domain/character-collection'
import { AozuIcon } from '@/ui/AozuIcon'
import { RenderStatus } from '@/ui/CharacterRenderer'
import { useBlobUrl } from '@/ui/useBlobUrl'
import { Button } from '@/ui/components/ui/button'
import { Sheet } from '@/ui/components/ui/sheet'

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

export function CharacterLibraryPage({ characters, loadThumbnail, collections, createCollection, openCharacter, refresh, actions, profileAction, recent }: {
  characters: CharacterLibraryItem[]
  loadThumbnail: LoadThumbnail
  collections: CharacterCollection[]
  createCollection(name: string): Promise<CharacterCollection>
  openCharacter(id: string): void
  refresh(): Promise<void>
  actions: ReactNode
  profileAction?: ReactNode
  recent?: ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { collectionId } = useParams()
  const isProfile = useLocation().pathname.endsWith('/profile')
  const book = collections.find(({ id }) => id === collectionId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const nameOf = (value: CharacterCollection) => value.id === DEFAULT_CHARACTER_COLLECTION ? t('books.default') : value.name
  const createBook = () => { setError(undefined); setName(''); setCreating(true) }
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

  return <Workspace header={<>     {book && <WorkspaceTabs label={t('world.collection')} active={isProfile ? 'profile' : 'characters'}
      items={[{ id: 'characters', label: t('world.characters') }, { id: 'locations', label: t('world.locations') }, { id: 'profile', label: t('books.profile') }]}
      onSelect={(id) => navigate(`/collections/${book.id}${id === 'characters' ? '' : `/${id}`}`)}>{actions}</WorkspaceTabs>}
    {!book && <LibraryTabs active="collections" />}
 </>} className="card-library"
    data-workspace-view={book ? 'collection' : 'collections'} data-collection-id={book?.id}
    data-panel={isProfile ? 'profile' : creating ? 'create' : undefined} data-has-uncommitted-input={creating}>

    <WorkspaceSurface className="book-page" aria-label={book ? nameOf(book) : t('books.shelf')}>
    <WorkspaceScroll>
    {book && isProfile ? <div className="book-profile flex flex-col gap-4" aria-label={t('books.profile')}>
      <WorkspaceProfileHeading label={t('books.profile')} title={nameOf(book)} action={profileAction} />
      <p className="whitespace-pre-wrap text-sm leading-7">{book.description || t('books.noDescription')}</p>
      <div><h3 className="font-heading text-lg font-semibold">{t('books.world')}</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{book.backstory || t('books.noWorld')}</p></div>
    </div> : book ? <>
        {visible.length ? <div key={book.id} ref={cardsRef} className="book-card-grid" role="list">
          {visible.map((character) => <WorkspaceCard key={character.id} role="listitem" className="book-character-card" aspect="2 / 3"
            label={character.name} aria-label={`${t('characters.edit')} ${character.name}`} onClick={() => openCharacter(character.id)}>
            <CharacterCardPortrait character={character} loadThumbnail={loadThumbnail} />
          </WorkspaceCard>)}
          <WatermarkAddCard role="listitem" className="book-character-card" aspect="2 / 3" label={t('characters.new')} icon="book" onClick={() => navigate('/characters/new/expressions')} />
        </div> : <div className="book-empty"><AozuIcon name="book" className="size-20" /><h2 className="font-heading text-xl">{t('books.empty')}</h2><p className="max-w-sm text-sm text-muted-foreground">{t(book.id === DEFAULT_CHARACTER_COLLECTION ? 'books.emptyDefault' : 'books.emptyCustom')}</p><Button variant="outline" onClick={() => book.id === DEFAULT_CHARACTER_COLLECTION ? navigate('/characters/new/expressions') : navigate(`/collections/${DEFAULT_CHARACTER_COLLECTION}`)}>{t(book.id === DEFAULT_CHARACTER_COLLECTION ? 'characters.new' : 'books.browseDefault')}</Button></div>}
    </> : <section className="bookshelf-grid" aria-label={t('books.shelf')}>
      <h1 className="sr-only">{t('books.shelf')}</h1>
      {collections.map((value) => <CollectionBookCard key={value.id} to={`/collections/${value.id}`} label={nameOf(value)} />)}
      <WatermarkAddCard className="collection-cover" label={t('books.create')} icon="collections" onClick={createBook} />
    </section>}
    {!book && recent}
    </WorkspaceScroll>
    </WorkspaceSurface>
    <Sheet open={creating} onOpenChange={(open) => { if (!open && !busy) setCreating(false) }}>
      <WorkspaceSheet title={t('books.create')}  closeLabel={t('common.close')} aria-describedby={undefined} onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>

        <form className="book-profile-form" onSubmit={(event) => {
          event.preventDefault()
          void (async () => {
            setBusy(true); setError(undefined)
            try { const created = await createCollection(name); await refresh(); setCreating(false); navigate(`/collections/${created.id}`) }
            catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); await refresh() }
            finally { setBusy(false) }
          })()
        }}>
          <label>{t('books.name')}<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
          <p className="text-sm text-muted-foreground">{t('books.createHint')}</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" type="button" disabled={busy} onClick={() => setCreating(false)}>{t('common.cancel')}</Button><Button disabled={busy || !name.trim()} type="submit">{t(busy ? 'data.busy' : 'books.create')}</Button></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </WorkspaceSheet>
    </Sheet>
  </Workspace>
}
