import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AozuIcon } from '@/ui/AozuIcon'
import type { Application } from '@/bootstrap'
import type { WorldLibrary } from '@/core/domain/world-library'
import type { CharacterCollection } from '@/core/domain/character-collection'
import type { CharacterLibraryItem } from '@/ui/pages/CharacterLibraryPage'
import { Button } from '@/ui/components/ui/button'

export function HomePage({ application, world, collections, characters }: { application: Application; world: WorldLibrary; collections: CharacterCollection[]; characters: CharacterLibraryItem[] }) {
  const { t } = useTranslation(), text = (key: string) => t(`world.${key}`)
  const [boards, setBoards] = useState<Array<{ id: string; name: string; updatedAt: number }>>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; void application.storyboards.list().then((boards) => { if (live) setBoards(boards) }, (e) => { if (live) setError(String(e)) }); return () => { live = false } }, [application])
  const recent = [
    ...characters.map((c) => ({ ...c, path: `/characters/${c.id}/expressions`, kind: text('characters') })),
    ...world.locations.map((l) => ({ ...l, path: `/collections/${l.collectionId}/locations/${l.id}`, kind: text('locations') })),
    ...world.photos.map((p) => ({ ...p, path: `/albums/${p.albumId}/photos/${p.id}`, kind: text('albums') })),
    ...boards.map((b) => ({ ...b, path: `/storyboards/${b.id}`, kind: text('storyboards') })),
  ].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(''); try { await task() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  return <main className="world-workspace" data-workspace-view="home"><header className="world-heading"><div><p className="world-eyebrow">AOZU</p><h1>{text('home')}</h1><p>{text('homeHint')}</p></div></header><section className="world-home-grid">{[
    { key: 'collections', icon: 'collections' as const, count: collections.length, action: 'createCharacter', path: '/characters/new/expressions' },
    { key: 'albums', icon: 'albums' as const, count: world.albums.length, action: 'addImages', path: '/albums/default' },
    { key: 'storyboards', icon: 'storyboards' as const, count: boards.length, action: 'createStoryboard', path: '/storyboards?create=1' },
  ].map(({ key, icon, count, action, path }) => <article className="world-home-card collection-cover" key={key}><Link to={`/${key}`}><AozuIcon name={icon} className="home-seal" /><h2>{text(key)}</h2><p>{text(`${key}Hint`)}</p><span>{count}</span></Link><Link className="world-shortcut" to={path}>＋ {text(action)}</Link></article>)}</section><section className="world-section"><h2>{text('recent')}</h2><div className="world-recent">{recent.map((item) => <Link key={item.path} to={item.path}><span>{item.kind}</span><strong>{item.name}</strong></Link>)}</div>{!recent.length && <p>{text('noRecent')}</p>}</section><details className="world-section"><summary>{text('archive')}</summary><p>{text('importHint')}</p><div className="world-actions"><Button variant="outline" disabled={busy} onClick={() => void run(async () => { const url = URL.createObjectURL(await application.worldLibrary.export()), a = document.createElement('a'); a.href = url; a.download = 'aozu-images-settings.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000) })}>{text('export')}</Button><label className="world-upload">{text('import')}<input type="file" accept=".zip" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => { await application.worldLibrary.import(file, world) }) }} /></label></div></details>{error && <p role="alert" className="story-error">{error}</p>}</main>
}
