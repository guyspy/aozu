import { Breadcrumbs } from '@/ui/Breadcrumbs'
import { WorldPicture } from '@/ui/WorldPicture'
import { StoryboardSettingPicker } from '@/ui/StoryboardSettingPicker'
import type { Application } from '@/bootstrap'
import type { CharacterLibraryItem } from '@/ui/pages/CharacterLibraryPage'
import type { WorldLibraryService } from '@/core/application/world-library'
import type { WorldLibrary } from '@/core/domain/world-library'
import type { CharacterCollection } from '@/core/domain/character-collection'
import { StoryboardFolders } from '@/ui/StoryboardFolders'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { StoryboardService } from '@/core/application/storyboard'
import type { BoardCommand, Storyboard } from '@/core/domain/storyboard'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/ui/components/ui/sheet'
import { Button } from '@/ui/components/ui/button'
import { useBlobUrl } from '@/ui/useBlobUrl'

function Picture({ service, id, alt }: { service: StoryboardService; id?: string | null; alt: string }) {
  const [result, setResult] = useState<{ id: string; blob?: Blob; failed?: boolean }>()
  useEffect(() => { let live = true; if (id) void service.image(id).then((blob) => { if (live) setResult({ id, blob }) }, () => { if (live) setResult({ id, failed: true }) }); return () => { live = false } }, [service, id])
  const current = result?.id === id ? result : undefined
  const url = useBlobUrl(current?.blob)
  return <div className="story-picture">{url ? <img src={url} alt={alt} loading="lazy" /> : <span>{current?.failed ? '⚠' : '＋'}</span>}</div>
}

export function StoryboardPage({ service, worldService, world, collections, application, characters }: { service: StoryboardService; worldService: WorldLibraryService; world: WorldLibrary; collections: CharacterCollection[]; application: Application; characters: CharacterLibraryItem[] }) {
  const { t } = useTranslation()
  const text = (key: string) => t(`storyboard.${key}`)
  const { boardId, folderId } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const pendingPhoto = world.photos.find((p) => p.id === search.get('photo'))
  const photoQuery = pendingPhoto ? `?photo=${pendingPhoto.id}` : ''
  const [boards, setBoards] = useState<Storyboard[]>([])
  const [board, setBoard] = useState<Storyboard>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [frameId, setFrameId] = useState('')
  const [settings, setSettings] = useState<BoardCommand>()
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
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(''); try { await task() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const update = async (command: BoardCommand, blob?: Blob) => {
    if (!board) throw new Error('Storyboard not loaded')
    const next = await service.update({ boardId: board.id, expectedRevision: board.revision, ...command }, blob)
    setBoard(next); return next
  }
  const dirty = Boolean(draft || settings)
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
    if (!draft && !settings) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [draft, settings])
  const uploadInput = (target?: string) => <label className="story-upload">{text(target ? 'addCandidates' : 'importFrames')}<input type="file" accept="image/png" multiple disabled={busy || dirty} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void upload(files, target) }} /></label>
  const move = (id: string, offset: number) => run(async () => { if (!board) return; const order = board.frames.map((f) => f.id), from = order.indexOf(id), to = from + offset; if (to < 0 || to >= order.length) return; [order[from], order[to]] = [order[to], order[from]]; await update({ action: 'reorder', order }) })
  if (folderId && folderId !== 'unfiled' && !world.folders.some((f) => f.id === folderId)) return <main className="world-workspace"><p role="alert">404</p></main>
  const folder = world.folders.find((f) => f.id === (folderId ?? (boardId && world.boardFolders[boardId])))
  const crumbs = [{ label: t('world.storyboards'), path: '/storyboards' }]
  if (folder) crumbs.push({ label: folder.name, path: `/storyboards/folders/${folder.id}` })
  else if (folderId === 'unfiled') crumbs.push({ label: t('world.unfiled'), path: '/storyboards/folders/unfiled' })
  if (boardId) crumbs.push({ label: board?.name ?? text('working'), path: `/storyboards/${boardId}` })
  return <><Breadcrumbs items={crumbs} /><main className="story-workspace" data-workspace-view={boardId ? 'storyboard' : 'storyboards'} data-board-id={boardId} data-folder-id={folderId} data-board-revision={board?.revision} data-frame-id={frameId || undefined} data-panel={frameId ? 'frame' : undefined} data-has-uncommitted-input={dirty} data-compared-image-ids={compare.join(',')} data-candidate-id={compare.length === 1 ? compare[0] : frame?.selected ?? undefined}>
    <StoryboardFolders service={worldService} library={world} collections={collections} folderId={folderId} boardId={boardId} disabled={busy || dirty} />
    <header className="story-heading"><div><p className="story-eyebrow">AOZU · STORYBOARD</p><h1>{board?.name ?? text('title')}</h1><p>{text('hint')}</p></div>{board && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || dirty || !board.past.length} onClick={() => void run(async () => { await update({ action: 'undo' }) })}>{text('undo')}</Button><Button variant="outline" disabled={busy || dirty || !board.future.length} onClick={() => void run(async () => { await update({ action: 'redo' }) })}>{text('redo')}</Button><Button disabled={busy || dirty} onClick={() => void run(async () => { const blob = await service.export(board.id, board.revision), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${board.name}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000) })}>{text('export')}</Button></div>}</header>
    {pendingPhoto && <section className="world-section"><h2>{pendingPhoto.name}</h2><WorldPicture service={worldService} hash={pendingPhoto.image.sha256} alt={pendingPhoto.name} />{board ? <Button disabled={busy || dirty} onClick={() => void run(async () => {
      const blob = await worldService.png(pendingPhoto.image)
      const next = await update({ action: 'add-frame', title: pendingPhoto.name, filename: `${pendingPhoto.name}.png`.slice(0, 200), source: `album:${pendingPhoto.albumId}/${pendingPhoto.id} · ${pendingPhoto.image.sha256} · ${pendingPhoto.source}`.slice(0, 2000) }, blob)
      open(next.frames.at(-1)!.id); setSearch({})
    })}>{t('world.useInStoryboard')}</Button> : <p>{t('world.storyboardsHint')}</p>}</section>}
    {error && <p role="alert" className="story-error">{error}</p>}
    {busy && <p role="status">{text('working')}</p>}
    {!boardId ? <><form className="story-create" onSubmit={(e) => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name')); void run(async () => { const created = await service.update({ action: 'create', name }); try { if (folderId && folderId !== 'unfiled') await worldService.save({ ...world, boardFolders: { ...world.boardFolders, [created.id]: folderId } }) } finally { navigate(`/storyboards/${created.id}${photoQuery}`) } }) }}><input disabled={busy} name="name" aria-label={text('name')} placeholder={text('name')} maxLength={120} required /><Button disabled={busy}>{text('create')}</Button><label className="story-upload">{text('importZip')}<input type="file" accept=".zip" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => { const created = await service.import(file); try { if (folderId && folderId !== 'unfiled') await worldService.save({ ...world, boardFolders: { ...world.boardFolders, [created.id]: folderId } }) } finally { navigate(`/storyboards/${created.id}${photoQuery}`) } }) }} /></label></form><section className="story-library">{boards.filter((b) => !folderId || (folderId === 'unfiled' ? !world.boardFolders[b.id] : world.boardFolders[b.id] === folderId)).map((b) => <Link key={b.id} to={`/storyboards/${b.id}${photoQuery}`}><Picture service={service} id={b.frames.find((f) => f.selected)?.selected} alt={b.name} /><div><h2>{b.name}</h2><p>{b.frames.length} {text('frames')}</p></div></Link>)}</section>{!boards.length && <p className="story-empty">{text('empty')}</p>}</> : !board ? <p>{text('working')}</p> : <>
      <details className="story-settings"><summary>{text('settings')}</summary><form onSubmit={(e) => { e.preventDefault(); if (settings) void run(async () => { await update(settings); setSettings(undefined) }) }}><label>{text('name')}<input disabled={busy} value={settings?.name ?? board.name} required maxLength={120} onChange={(e) => setSettings({ action: 'rename', expectedRevision: board.revision, ...settings, name: e.target.value })} /></label><label>{text('notes')}<textarea disabled={busy} value={settings?.notes ?? board.notes} maxLength={8000} onChange={(e) => setSettings({ action: 'rename', expectedRevision: board.revision, ...settings, notes: e.target.value })} /></label><div className="flex gap-2"><Button disabled={busy || !settings}>{text('save')}</Button>{settings && <Button type="button" variant="outline" onClick={() => setSettings(undefined)}>{text('cancel')}</Button>}</div></form></details>
      <div className="story-toolbar"><div className="flex flex-wrap gap-2"><Button disabled={busy || dirty} onClick={() => void run(async () => { const next = await update({ action: 'add-frame', title: text('newFrame') }); open(next.frames.at(-1)!.id) })}>＋ {text('addFrame')}</Button>{uploadInput()}</div></div>
      <section className="story-grid" aria-label={text('frames')}>
        {board.frames.map((f, index) => <article key={f.id} draggable={!busy && !dirty} onDragStart={(e) => { setDragged(f.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.id) }} onDragOver={(e) => { if (dragged && !dirty) e.preventDefault() }} onDragEnd={() => setDragged('')} onDrop={(e) => { e.preventDefault(); if (!dragged || dragged === f.id || busy || dirty) return; const order = board.frames.map((item) => item.id); order.splice(order.indexOf(dragged), 1); order.splice(order.indexOf(f.id), 0, dragged); setDragged(''); void run(async () => { await update({ action: 'reorder', order }) }) }} className={`story-card ${frameId === f.id ? 'active' : ''}`}><button className="story-card-open" disabled={dirty} onClick={(event) => { trigger.current = event.currentTarget; open(f.id) }}><div className="story-card-caption"><span>{String(index + 1).padStart(2, '0')}</span><span className={`story-review ${f.review}`}>{text(f.review)}</span></div><Picture service={service} id={f.selected} alt={f.title} /><h2>{f.title}</h2><p>{f.selected ? `${f.candidates.length} ${text('candidates')}` : text('noSelection')}</p></button><div className="story-card-footer"><Button size="sm" variant="ghost" aria-label={`${text('previous')} ${f.title}`} disabled={busy || dirty || index === 0} onClick={() => void move(f.id, -1)}>←</Button><span>{f.duration ? `${f.duration}s` : '—'}</span><Button size="sm" variant="ghost" aria-label={`${text('next')} ${f.title}`} disabled={busy || dirty || index === board.frames.length - 1} onClick={() => void move(f.id, 1)}>→</Button></div>{f.transition && <p className="story-transition">↳ {f.transition}</p>}</article>)}
        {!board.frames.length && <div className="story-empty">{text('emptyFrames')}</div>}
      </section>
      <Sheet open={Boolean(frame)} onOpenChange={(isOpen) => { if (!isOpen && !busy) { if (dirty) setError(text('unsaved')); else open('') } }}>
      <SheetContent className="story-drawer model-sheet-detail overflow-y-auto p-5 sm:p-8" closeLabel={text('close')} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }} onEscapeKeyDown={(event) => { if (busy || dirty) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy || dirty) event.preventDefault() }}>
      {frame && <><SheetTitle className="pr-8 text-xl">{frame.title}</SheetTitle><SheetDescription>{text('detailHint')}</SheetDescription>
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
        <StoryboardSettingPicker application={application} world={world} collections={collections} characters={characters} frame={frame} disabled={busy || dirty} pin={update} />
        <h3>{text('references')}</h3><p className="text-sm text-muted-foreground">{text('referenceHint')}</p>
        {frame.references.map((ref) => <div key={ref.imageId} className="story-reference"><Picture service={service} id={ref.imageId} alt={ref.purpose} /><p>{ref.purpose}</p><label><input type="checkbox" checked={compare.includes(ref.imageId)} disabled={!compare.includes(ref.imageId) && compare.length >= 2} onChange={(e) => setCompare(e.target.checked ? [...compare, ref.imageId] : compare.filter((id) => id !== ref.imageId))} />{text('compare')}</label>{board.frames.some((f) => f.candidates.includes(ref.imageId) && f.selected !== ref.imageId) && <p className="story-warning">{text('referenceChanged')}</p>}<Button size="sm" variant="ghost" disabled={busy || dirty} onClick={() => void run(async () => { await update({ action: 'reference', frameId, imageId: ref.imageId, remove: true }) })}>{text('unpin')}</Button></div>)}
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await update({ action: 'reference', frameId, imageId: reference, purpose }); setReference(''); setPurpose('') }) }}><label>{text('referenceImage')}<select disabled={busy} required value={reference} onChange={(e) => setReference(e.target.value)}><option value="">{text('choose')}</option>{board.images.map((image) => <option key={image.id} value={image.id}>{image.filename} · {image.id.slice(0, 6)}</option>)}</select></label><label>{text('purpose')}<input disabled={busy} required maxLength={2000} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label><Button variant="outline" disabled={busy || dirty || !reference || !purpose.trim()}>{text('pin')}</Button></form>
        <Button variant="ghost" disabled={busy || dirty} onClick={() => void run(async () => { await update({ action: 'remove-frame', frameId }); open('') })}>{text('removeFrame')}</Button><p className="text-xs text-muted-foreground">{text('undoHint')}</p>
      </div></div></>}
      </SheetContent></Sheet>
    </>}
  </main></>
}
