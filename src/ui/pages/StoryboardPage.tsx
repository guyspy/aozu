import { WorkspaceSheet, Workspace, WorkspaceActions, WorkspaceAddCard, WorkspaceCard, WorkspaceHistoryActions, WorkspaceScroll, WorkspaceSurface, WorkspaceTabs } from '@/ui/Workspace'
import { LibraryTabs } from '@/ui/LibraryTabs'
import { LibraryBookCard, WatermarkAddCard } from '@/ui/LibraryCards'
import { Breadcrumbs } from '@/ui/Breadcrumbs'
import { StoryboardSettingPicker } from '@/ui/StoryboardSettingPicker'
import type { Application } from '@/bootstrap'
import type { CharacterLibraryItem } from '@/ui/pages/CharacterLibraryPage'
import type { WorldLibraryService } from '@/core/application/world-library'
import type { StoryBook, WorldLibrary } from '@/core/domain/world-library'
import type { CharacterCollection } from '@/core/domain/character-collection'
import { StoryboardBookMove } from '@/ui/StoryboardBooks'
import { useEffect, useRef, useState } from 'react'
import { useMatch, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { StoryboardService } from '@/core/application/storyboard'
import type { BoardCommand, Storyboard } from '@/core/domain/storyboard'
import { Sheet, SheetDescription } from '@/ui/components/ui/sheet'
import { Button } from '@/ui/components/ui/button'
import { useBlobUrl } from '@/ui/useBlobUrl'
import { DataControls } from '@/ui/DataControls'
import { ImportIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip'

function Picture({ service, id, alt }: { service: StoryboardService; id?: string | null; alt: string }) {
  const [result, setResult] = useState<{ id: string; blob?: Blob; failed?: boolean }>()
  useEffect(() => { let live = true; if (id) void service.image(id).then((blob) => { if (live) setResult({ id, blob }) }, () => { if (live) setResult({ id, failed: true }) }); return () => { live = false } }, [service, id])
  const current = result?.id === id ? result : undefined
  const url = useBlobUrl(current?.blob)
  return <div className="story-picture">{url ? <img src={url} alt={alt} loading="lazy" /> : <span>{current?.failed ? '⚠' : '＋'}</span>}</div>
}

export function StoryboardPage({ service, worldService, world, collections, application, characters, setTitle }: { service: StoryboardService; worldService: WorldLibraryService; world: WorldLibrary; collections: CharacterCollection[]; application: Application; characters: CharacterLibraryItem[]; setTitle(name?: string): void }) {
  const { t } = useTranslation()
  const text = (key: string) => t(`storyboard.${key}`)
  const { boardId, bookId } = useParams()
  const book = world.storyBooks.find((item) => item.id === (bookId ?? (boardId && world.boardBooks[boardId])))
  const navigate = useNavigate()
  const [boards, setBoards] = useState<Storyboard[]>([])
  const [board, setBoard] = useState<Storyboard>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [frameId, setFrameId] = useState('')
  const [settings, setSettings] = useState<BoardCommand>()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [dragged, setDragged] = useState('')
  const [draft, setDraft] = useState<BoardCommand>()
  const [compare, setCompare] = useState<string[]>([])
  const [source, setSource] = useState('')
  const [reference, setReference] = useState('')
  const [purpose, setPurpose] = useState('')
  useEffect(() => {
    let live = true
    const refresh = () => void Promise.all([service.list(), boardId ? service.get(boardId) : undefined]).then(([list, current]) => { if (live) { setBoards(list); setBoard(current) } }, (e) => { if (live) setError(String(e)) })
    refresh(); const unsubscribe = service.subscribe(refresh)
    return () => { live = false; unsubscribe() }
  }, [service, boardId])
  const [creating, setCreating] = useState(false)
  const [editingBook, setEditingBook] = useState<StoryBook | 'new'>()
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(''); try { await task() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const update = async (command: BoardCommand, blob?: Blob) => {
    if (!board) throw new Error('Storyboard not loaded')
    const next = await service.update({ boardId: board.id, expectedRevision: board.revision, ...command }, blob)
    setBoard(next); return next
  }
  const settingsDirty = Boolean(settings && board && (settings.name !== board.name || settings.notes !== board.notes))
  const dirty = Boolean(draft || settingsDirty)
  const details = Boolean(useMatch('/storyboards/:boardId/details'))
  const frame = board?.frames.find((f) => f.id === frameId)
  const open = (id: string) => { setFrameId(id); setDraft(undefined); setCompare([]); setReference(''); setPurpose('') }
  const upload = (files: File[], target?: string) => run(async () => {
    if (!board) return
    let current = board
    for (const file of files) {
      let id = target
      if (!id) { current = await service.update({ action: 'add-frame', boardId: current.id, expectedRevision: current.revision, title: file.name.replace(/\.png$/i, '') }); id = current.frames.at(-1)!.id }
      current = await service.update({ action: 'add-candidate', boardId: current.id, expectedRevision: current.revision, frameId: id, filename: file.name, source }, file)
      setBoard(current)
    }
  })
  useEffect(() => {
    setTitle(board?.name ?? book?.name)
    return () => setTitle(undefined)
  }, [board?.name, book?.name, setTitle])
  useEffect(() => {
    if (!draft && !settings) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [draft, settings])
  const uploadInput = (target?: string) => <label className="story-upload">{text(target ? 'addCandidates' : 'importFrames')}<input type="file" accept="image/png" multiple disabled={busy || dirty} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void upload(files, target) }} /></label>
  const move = (id: string, offset: number) => run(async () => { if (!board) return; const order = board.frames.map((f) => f.id), from = order.indexOf(id), to = from + offset; if (to < 0 || to >= order.length) return; [order[from], order[to]] = [order[to], order[from]]; await update({ action: 'reorder', order }) })
  if (bookId && bookId !== 'unfiled' && !world.storyBooks.some((item) => item.id === bookId)) return <Workspace className="world-workspace"><p role="alert">404</p></Workspace>
  const crumbs = [{ label: t('world.storyboards'), path: '/storyboards' }]
  if (book) crumbs.push({ label: book.name, path: `/storyboards/books/${book.id}` })
  else if (bookId === 'unfiled' || (boardId && !world.boardBooks[boardId])) crumbs.push({ label: t('world.unfiled'), path: '/storyboards/books/unfiled' })
  if (boardId) crumbs.push({ label: board?.name ?? text('working'), path: `/storyboards/${boardId}` })
  const documentActions = board && <WorkspaceActions>
    <StoryboardBookMove service={worldService} library={world} boardId={board.id} disabled={busy || dirty} />
    <DataControls exportData={() => service.export(board.id, board.revision)} exportFilename={`${board.name}.zip`} exportLabel={text('export')} exportIconOnly />
    <TooltipProvider><Tooltip><TooltipTrigger asChild><Button asChild type="button" size="icon" variant="outline" aria-label={text('importFrames')} disabled={busy || dirty}>
      <label><ImportIcon /><input className="sr-only" type="file" accept="image/png" multiple disabled={busy || dirty} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files) }} /></label>
    </Button></TooltipTrigger><TooltipContent>{text('importFrames')}</TooltipContent></Tooltip></TooltipProvider>
  </WorkspaceActions>
  return <><Breadcrumbs items={crumbs} /><Workspace header={!boardId ? <LibraryTabs active="storyboards" /> : board ? <WorkspaceTabs label={text('workspace')} active={details ? 'details' : 'frames'}
    items={[{ id: 'frames', label: text('workspace') }, { id: 'details', label: text('settings') }] as const}
    onSelect={(tab) => navigate(`/storyboards/${board.id}${tab === 'details' ? '/details' : ''}`)}>{documentActions}</WorkspaceTabs> : undefined}
    className="story-workspace" data-workspace-view={boardId ? 'storyboard' : bookId ? 'story-book' : 'storyboards'} data-board-id={boardId} data-book-id={bookId} data-board-revision={board?.revision} data-frame-id={frameId || undefined} data-panel={frameId ? 'frame' : undefined} data-has-uncommitted-input={dirty || Boolean(editingBook)} data-compared-image-ids={compare.join(',')} data-candidate-id={compare.length === 1 ? compare[0] : frame?.selected ?? undefined}>
<WorkspaceSurface surface={boardId && !details ? 'paper' : undefined} className={boardId ? 'story-document' : 'workspace-scroll'}>
    {!boardId && <h1 className="sr-only">{text('title')}</h1>}
    {!boardId && bookId && <div className="character-profile-heading"><div className="min-w-0"><h2>{book?.name ?? t('world.unfiled')}</h2>{book?.description && <p>{book.description}</p>}</div>{book && <Button type="button" size="icon" variant="ghost" aria-label={t('world.edit')} onClick={() => setEditingBook(book)}><PencilIcon /></Button>}</div>}
    {board && !details &&
      <div className="story-history-toolbar flex min-w-0 flex-wrap items-center gap-1"><WorkspaceHistoryActions undoLabel={text('undo')} redoLabel={text('redo')} canUndo={!busy && !dirty && Boolean(board.past.length)} canRedo={!busy && !dirty && Boolean(board.future.length)}
        onUndo={() => void run(async () => { await update({ action: 'undo' }) })} onRedo={() => void run(async () => { await update({ action: 'redo' }) })} />
        <span role="status" className="ml-1 text-xs text-muted-foreground">{dirty ? text('unsavedStatus') : text('saved')}</span></div>}

    {error && <p role="alert" className="story-error">{error}</p>}
    {busy && <p role="status">{text('working')}</p>}
    {!boardId ? !bookId ? <section className="bookshelf-grid">{boards.some((item) => !world.boardBooks[item.id]) && <LibraryBookCard icon="storyboards" to="/storyboards/books/unfiled" label={t('world.unfiled')} />}{world.storyBooks.map((item) => <LibraryBookCard key={item.id} icon="storyboards" to={`/storyboards/books/${item.id}`} label={item.name} />)}<WatermarkAddCard className="collection-cover" icon="storyboards" label={t('world.createStoryBook')} onClick={() => { setEditingBook('new'); setError('') }} /></section> : <section className="storyboard-list">{boards.filter((item) => bookId === 'unfiled' ? !world.boardBooks[item.id] : world.boardBooks[item.id] === bookId).map((item, index) => <WorkspaceCard className="storyboard-list-card" key={item.id} to={`/storyboards/${item.id}`} label={item.name}><span aria-hidden>{String(index + 1).padStart(2, '0')}</span></WorkspaceCard>)}<WorkspaceAddCard className="storyboard-list-card" label={text('create')} onClick={() => { setCreating(true); setError('') }} /></section> : !board ? <p>{text('working')}</p> : details ?
      <WorkspaceScroll className="story-details"><div className="book-profile flex flex-col gap-4" aria-label={text('settings')}>
        <div className="character-profile-heading"><div className="min-w-0"><span>{text('settings')}</span><h2>{board.name}</h2></div><Button type="button" size="icon" variant="ghost" aria-label={text('editDetails')} onClick={() => { setSettings({ action: 'rename', name: board.name, notes: board.notes }); setDetailsOpen(true) }}><PencilIcon /></Button></div>
        <div><h3 className="font-heading text-lg font-semibold">{text('notes')}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{board.notes || text('emptyNotes')}</p></div>
      </div></WorkspaceScroll> : <>
      <WorkspaceScroll className="story-paper"><section className="story-grid" aria-label={text('frames')}>
        {board.frames.map((f, index) => <article key={f.id} draggable={!busy && !dirty} onDragStart={(e) => { setDragged(f.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.id) }} onDragOver={(e) => { if (dragged && !dirty) e.preventDefault() }} onDragEnd={() => setDragged('')} onDrop={(e) => { e.preventDefault(); if (!dragged || dragged === f.id || busy || dirty) return; const order = board.frames.map((item) => item.id); order.splice(order.indexOf(dragged), 1); order.splice(order.indexOf(f.id), 0, dragged); setDragged(''); void run(async () => { await update({ action: 'reorder', order }) }) }} className={`story-card ${frameId === f.id ? 'active' : ''}`}><button className="story-card-open" disabled={dirty} onClick={(event) => { trigger.current = event.currentTarget; open(f.id) }}><div className="story-card-caption"><span>{String(index + 1).padStart(2, '0')}</span><span className={`story-review ${f.review}`}>{text(f.review)}</span></div><Picture service={service} id={f.selected} alt={f.title} /></button><div className="story-frame-text"><h2><button className="story-title-open" disabled={dirty} onClick={(event) => { trigger.current = event.currentTarget; open(f.id) }}>{f.title}</button></h2><p>{f.selected ? `${f.candidates.length} ${text('candidates')}` : text('noSelection')}</p><div className="story-card-footer"><Button size="sm" variant="ghost" aria-label={`${text('previous')} ${f.title}`} disabled={busy || dirty || index === 0} onClick={() => void move(f.id, -1)}>←</Button><span>{f.duration ? `${f.duration}s` : '—'}</span><Button size="sm" variant="ghost" aria-label={`${text('next')} ${f.title}`} disabled={busy || dirty || index === board.frames.length - 1} onClick={() => void move(f.id, 1)}>→</Button></div>{f.notes && <p className="story-frame-notes">{f.notes}</p>}{f.transition && <p className="story-transition">↳ {f.transition}</p>}</div></article>)}
        <WorkspaceAddCard className="story-card story-add-card" aspect="16 / 9" label={text('addFrame')} disabled={busy || dirty}
          onClick={() => void run(async () => { const next = await update({ action: 'add-frame', title: text('newFrame') }); open(next.frames.at(-1)!.id) })} />
      </section>
      </WorkspaceScroll>
      <Sheet open={Boolean(frame)} onOpenChange={(isOpen) => { if (!isOpen && !busy) { if (dirty) setError(text('unsaved')); else open('') } }}>
      <WorkspaceSheet title={frame?.title} surface="paper" className="story-drawer" closeLabel={text('close')} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }} onEscapeKeyDown={(event) => { if (busy || dirty) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy || dirty) event.preventDefault() }}>
      {frame && <><SheetDescription>{text('detailHint')}</SheetDescription>
      {error && <p role="alert" className="story-error">{error}</p>}
      {busy && <p role="status">{text('working')}</p>}
      <div className="story-detail-grid"><div>
        <div className="story-large-preview"><Picture service={service} id={frame.selected} alt={frame.title} /></div><div className="story-candidates">{frame.candidates.map((id) => <article key={id}><Picture service={service} id={id} alt={board.images.find((i) => i.id === id)?.filename ?? ''} /><p>{board.images.find((i) => i.id === id)?.filename}</p><Button size="sm" variant={frame.selected === id ? 'default' : 'outline'} disabled={busy || dirty || frame.selected === id} onClick={() => void run(async () => { await update({ action: 'select', frameId, imageId: id }) })}>{text(frame.selected === id ? 'selected' : 'select')}</Button><label><input type="checkbox" checked={compare.includes(id)} disabled={!compare.includes(id) && compare.length >= 2} onChange={(e) => setCompare(e.target.checked ? [...compare, id] : compare.filter((v) => v !== id))} />{text('compare')}</label></article>)}</div>
        {compare.length > 0 && <div className="story-compare">{compare.map((id) => <figure key={id}><Picture service={service} id={id} alt={text('compare')} /><figcaption>{board.images.find((image) => image.id === id)?.filename}</figcaption></figure>)}</div>}
        <label className="story-source">{text('source')}<input disabled={busy} value={source} onChange={(e) => setSource(e.target.value)} maxLength={2000} placeholder={text('sourceHint')} /></label>{uploadInput(frameId)}
      </div><div className="story-form">
        <form onSubmit={(e) => { e.preventDefault(); if (draft) void run(async () => { await update(draft); setDraft(undefined) }) }}>
          <label>{text('shotTitle')}<input disabled={busy} value={draft?.title ?? frame.title} maxLength={160} required onChange={(e) => setDraft({ action: 'edit-frame', frameId, expectedRevision: board.revision, ...draft, title: e.target.value })} /></label>
          <label>{text('notes')}<textarea disabled={busy} rows={3} maxLength={8000} value={draft?.notes ?? frame.notes} onChange={(e) => setDraft({ action: 'edit-frame', frameId, expectedRevision: board.revision, ...draft, notes: e.target.value })} /></label>
          <label>{text('transition')}<textarea disabled={busy} rows={3} maxLength={8000} value={draft?.transition ?? frame.transition} onChange={(e) => setDraft({ action: 'edit-frame', frameId, expectedRevision: board.revision, ...draft, transition: e.target.value })} /></label>
          <label>{text('duration')}<input disabled={busy} type="number" min="0.1" max="600" step="0.1" value={(draft && 'duration' in draft ? draft.duration : frame.duration) ?? ''} onChange={(e) => setDraft({ action: 'edit-frame', frameId, expectedRevision: board.revision, ...draft, duration: e.target.value ? Number(e.target.value) : null })} /></label>
          <div className="flex gap-2"><Button disabled={busy || !draft}>{text('save')}</Button>{draft && <Button type="button" variant="outline" onClick={() => setDraft(undefined)}>{text('cancel')}</Button>}</div>
        </form>
        <div className="flex flex-wrap gap-2">{(['draft', 'needs-work', 'confirmed'] as const).map((review) => <Button key={review} size="sm" variant={frame.review === review ? 'default' : 'outline'} disabled={busy || dirty || (review === 'confirmed' && !frame.selected)} onClick={() => void run(async () => { await update({ action: 'edit-frame', frameId, review }) })}>{text(review)}</Button>)}</div>
        <StoryboardSettingPicker application={application} world={world} collections={collections} characters={characters} collectionIds={book?.collectionIds} frame={frame} disabled={busy || dirty} pin={update} />
        <h3>{text('references')}</h3><p className="text-sm text-muted-foreground">{text('referenceHint')}</p>
        {frame.references.map((ref) => <div key={ref.imageId} className="story-reference"><Picture service={service} id={ref.imageId} alt={ref.purpose} /><p>{ref.purpose}</p><label><input type="checkbox" checked={compare.includes(ref.imageId)} disabled={!compare.includes(ref.imageId) && compare.length >= 2} onChange={(e) => setCompare(e.target.checked ? [...compare, ref.imageId] : compare.filter((id) => id !== ref.imageId))} />{text('compare')}</label>{board.frames.some((f) => f.candidates.includes(ref.imageId) && f.selected !== ref.imageId) && <p className="story-warning">{text('referenceChanged')}</p>}<Button size="sm" variant="ghost" disabled={busy || dirty} onClick={() => void run(async () => { await update({ action: 'reference', frameId, imageId: ref.imageId, remove: true }) })}>{text('unpin')}</Button></div>)}
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await update({ action: 'reference', frameId, imageId: reference, purpose }); setReference(''); setPurpose('') }) }}><label>{text('referenceImage')}<select disabled={busy} required value={reference} onChange={(e) => setReference(e.target.value)}><option value="">{text('choose')}</option>{board.images.map((image) => <option key={image.id} value={image.id}>{image.filename} · {image.id.slice(0, 6)}</option>)}</select></label><label>{text('purpose')}<input disabled={busy} required maxLength={2000} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label><Button variant="outline" disabled={busy || dirty || !reference || !purpose.trim()}>{text('pin')}</Button></form>
        <Button variant="ghost" disabled={busy || dirty} onClick={() => void run(async () => { await update({ action: 'remove-frame', frameId }); open('') })}>{text('removeFrame')}</Button><p className="text-xs text-muted-foreground">{text('undoHint')}</p>
      </div></div></>}
      </WorkspaceSheet></Sheet>
    </>}
  </WorkspaceSurface>
    {board && <Sheet open={detailsOpen} onOpenChange={(open) => { if (!busy) { setDetailsOpen(open); if (!open) setSettings(undefined) } }}>
      <WorkspaceSheet title={text('settings')} closeLabel={text('close')} aria-describedby={undefined}>
        <form className="book-profile-form" onSubmit={(e) => { e.preventDefault(); if (settings && settingsDirty) void run(async () => { await update(settings); setSettings(undefined); setDetailsOpen(false) }) }}>
          <label>{text('name')}<input autoFocus disabled={busy} value={settings?.name ?? board.name} required maxLength={120} onChange={(e) => setSettings({ action: 'rename', ...settings, name: e.target.value })} /></label>
          <label>{text('notes')}<textarea disabled={busy} rows={11} value={settings?.notes ?? board.notes} maxLength={8000} onChange={(e) => setSettings({ action: 'rename', ...settings, notes: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => { setSettings(undefined); setDetailsOpen(false) }}>{text('cancel')}</Button><Button disabled={busy || !settingsDirty}>{text('save')}</Button></div>
        </form>
      </WorkspaceSheet>
    </Sheet>}
    <Sheet open={creating} onOpenChange={(open) => { if (!open && !busy) setCreating(false) }}>
      <WorkspaceSheet title={text('create')}  closeLabel={text('close')} aria-describedby={undefined} onEscapeKeyDown={(e) => { if (busy) e.preventDefault() }} onPointerDownOutside={(e) => { if (busy) e.preventDefault() }}>

        <form className="book-profile-form" onSubmit={(e) => {
          e.preventDefault()
          const name = String(new FormData(e.currentTarget).get('name'))
          void run(async () => {
            const created = await service.update({ action: 'create', name })
            try { if (bookId && bookId !== 'unfiled') await worldService.update({ resource: 'storyboard-book', action: 'move', boardId: created.id, bookId }, world.revision) }
            finally { setCreating(false); navigate(`/storyboards/${created.id}`) }
          })
        }}>
          <label>{text('name')}<input autoFocus required name="name" maxLength={120} disabled={busy} /></label>
          <div className="flex justify-end gap-2"><Button variant="ghost" type="button" disabled={busy} onClick={() => setCreating(false)}>{t('common.cancel')}</Button><Button disabled={busy} type="submit">{text('create')}</Button></div>
          {error && <p role="alert" className="story-error">{error}</p>}
        </form>
      </WorkspaceSheet>
    </Sheet>
    <Sheet open={Boolean(editingBook)} onOpenChange={(open) => { if (!open && !busy) setEditingBook(undefined) }}>
      <WorkspaceSheet title={t('world.storyBook')} closeLabel={text('close')} aria-describedby={undefined}>
        {editingBook && <form className="book-profile-form" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget)
          void run(async () => {
            const current = editingBook === 'new' ? undefined : editingBook
            const result = await worldService.update({ resource: 'story-book', action: current ? 'update' : 'create', id: current?.id, name: String(data.get('name')), description: String(data.get('description')), synopsis: String(data.get('synopsis')), direction: String(data.get('direction')), collectionIds: data.getAll('collections').map(String) }, world.revision)
            setEditingBook(undefined); navigate(`/storyboards/books/${result.id}`)
          })
        }}>
          <label>{t('world.name')}<input autoFocus name="name" required maxLength={120} defaultValue={editingBook === 'new' ? '' : editingBook.name} disabled={busy} /></label>
          <label>{t('world.description')}<textarea name="description" maxLength={8000} defaultValue={editingBook === 'new' ? '' : editingBook.description} disabled={busy} /></label>
          <label>{t('world.synopsis')}<textarea name="synopsis" maxLength={8000} defaultValue={editingBook === 'new' ? '' : editingBook.synopsis} disabled={busy} /></label>
          <label>{t('world.direction')}<textarea name="direction" maxLength={8000} defaultValue={editingBook === 'new' ? '' : editingBook.direction} disabled={busy} /></label>
          <fieldset><legend>{t('world.linkedCollections')}</legend>{collections.map((collection) => <label className="world-checkbox" key={collection.id}><input type="checkbox" name="collections" value={collection.id} defaultChecked={editingBook !== 'new' && editingBook.collectionIds.includes(collection.id)} disabled={busy} />{collection.id === 'default' ? t('world.defaultCollection') : collection.name}</label>)}</fieldset>
          <div className="flex justify-between gap-2">{editingBook !== 'new' ? <Button type="button" variant="destructive" disabled={busy} onClick={() => { if (window.confirm(`${t('world.remove')} ${editingBook.name}?`)) void run(async () => { await worldService.update({ resource: 'story-book', action: 'delete', id: editingBook.id }, world.revision); setEditingBook(undefined); navigate('/storyboards') }) }}><Trash2Icon />{t('world.remove')}</Button> : <span />}<Button disabled={busy}>{t('world.save')}</Button></div>
          {error && <p role="alert" className="story-error">{error}</p>}
        </form>}
      </WorkspaceSheet>
    </Sheet>
  </Workspace></>
}
