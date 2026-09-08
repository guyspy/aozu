import { PlusIcon } from 'lucide-react'
import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { CharacterDraft, ResolvedCharacterLayer } from '@/core/domain/character.ts'
import type { CharacterCollection } from '@/core/domain/character-collection.ts'
import { CharacterLibraryTransfer, type CharacterLibraryTransferProps } from '@/ui/CharacterLibraryTransfer'
import { AozuIcon } from '@/ui/AozuIcon'
import { CharacterRenderer } from '@/ui/CharacterRenderer'
import { DataControls } from '@/ui/DataControls'
import { Button } from '@/ui/components/ui/button'

// Fan geometry from the Design branch: 48px spread, 7px sag, 4.25° per step from the middle card.
const FAN_SPREAD = 48
export type CharacterLibraryItem = Pick<CharacterDraft, 'id' | 'name' | 'updatedAt'> & {
  layers: Array<ResolvedCharacterLayer & { blob: Blob }>
}

export function CharacterLibraryPage({ characters, collections, createCollection, renameCollection, deleteCollection, assignCollection, createCharacter, openCharacter, importCharacter, refresh, ...transfer }: CharacterLibraryTransferProps & {
  characters: CharacterLibraryItem[]
  collections: CharacterCollection[]
  createCollection(name: string): Promise<void>
  renameCollection(id: string, name: string, version: number): Promise<void>
  deleteCollection(id: string, version: number): Promise<void>
  assignCollection(characterId: string, collectionId: string | null): Promise<void>
  createCharacter(): Promise<CharacterDraft>
  openCharacter(id: string): void
  importCharacter(blob: Blob): Promise<void>
  refresh(): Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [collectionId, setCollectionId] = useState('all')
  const [collectionName, setCollectionName] = useState('')
  // Overlapping, scaled cards make :hover unreliable (the raised card covers its neighbour), so the active
  // card is whichever rest-position band the pointer's x falls in — the card-game way.
  const [active, setActive] = useState<number>()

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true); setError(undefined)
    try { await task() }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }

  const selectedCollection = collections.find(({ id }) => id === collectionId)
  const membership = new Map(collections.flatMap((collection) => collection.characterIds.map((id) => [id, collection.id] as const)))
  const filtered = collectionId === 'all' || (collectionId !== 'uncollected' && !selectedCollection) ? characters
    : characters.filter(({ id }) => collectionId === 'uncollected' ? !membership.has(id) : membership.get(id) === collectionId)
  const fanned = filtered.slice(0, 9)
  const overflow = filtered.slice(9)
  const fanMiddle = (fanned.length - 1) / 2
  const pickActive = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const { left, width } = event.currentTarget.getBoundingClientRect()
    const index = Math.round((event.clientX - left - width / 2) / FAN_SPREAD + fanMiddle)
    setActive(Math.max(0, Math.min(fanned.length - 1, index)))
  }
  const fanState = (index: number) => active === undefined ? undefined : index === active ? 'active' : index < active ? 'before' : 'after'
  const card = (character: CharacterLibraryItem, style?: CSSProperties, fan?: 'active' | 'before' | 'after') => <article key={character.id} role="listitem" className="companion-card" data-fan={fan} style={style}>
    <button type="button" className="companion-card-open" aria-label={`${t('characters.edit')} ${character.name}`} onClick={() => openCharacter(character.id)}>
      <span className="companion-card-portrait"><CharacterRenderer label={character.name} layers={character.layers} /></span>
      <span className="companion-card-name">{character.name}</span>
    </button>
  </article>

  return <main className="mx-auto min-h-[calc(100svh-3.5rem)] w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <section className="forge-hero" aria-labelledby="characters-title">
      <div>
        <p className="forge-kicker"><AozuIcon name="archive" /> {t('characters.kicker')}</p>
        <h1 id="characters-title" className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">{t('characters.title')}</h1>
        <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">{t('characters.description')}</p>
      </div>
      <AozuIcon name="book" className="forge-seal" />
    </section>

    <section className="mt-8 rounded-2xl border p-5" aria-labelledby="collections-title">
      <h2 id="collections-title" className="font-heading text-xl font-medium">{t('library.collections')}</h2>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">{t('library.browse')}
          <select className="rounded-md border bg-background px-3 py-2" value={selectedCollection ? collectionId : collectionId === 'uncollected' ? 'uncollected' : 'all'} onChange={(event) => { setCollectionId(event.target.value); setActive(undefined) }}>
            <option value="all">{t('library.all')}</option>
            <option value="uncollected">{t('library.uncollected')}</option>
            {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
          </select>
        </label>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await createCollection(collectionName); setCollectionName('') }) }}>
          <label className="grid gap-1 text-sm">{t('library.collectionName')}
            <input className="rounded-md border bg-background px-3 py-2" maxLength={100} required value={collectionName} onChange={(event) => setCollectionName(event.target.value)} />
          </label>
          <Button disabled={busy || !collectionName.trim()} type="submit" variant="outline">{t('library.createCollection')}</Button>
          {selectedCollection && <Button disabled={busy || !collectionName.trim()} type="button" variant="outline" onClick={() => void run(async () => { await renameCollection(selectedCollection.id, collectionName, selectedCollection.version); setCollectionName('') })}>{t('library.renameCollection')}</Button>}
        </form>
        {selectedCollection && <Button disabled={busy} variant="ghost" onClick={() => void run(async () => { await deleteCollection(selectedCollection.id, selectedCollection.version); setCollectionId('all') })}>{t('library.deleteCollection')}</Button>}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{t('library.collectionDescription')}</p>
      {characters.length > 0 && <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">{t('library.organize')}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {characters.map((character) => <label key={character.id} className="grid gap-1 text-sm">{character.name}
            <select aria-label={t('library.assign', { name: character.name })} className="min-w-0 rounded-md border bg-background px-3 py-2" disabled={busy} value={membership.get(character.id) ?? ''} onChange={(event) => void run(() => assignCollection(character.id, event.target.value || null))}>
              <option value="">{t('library.uncollected')}</option>
              {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
            </select>
          </label>)}
        </div>
      </details>}
    </section>

    <section className="companion-vault mt-10" aria-labelledby="saved-characters-title">
      <div className="vault-heading">
        <h2 id="saved-characters-title" className="font-heading text-2xl font-medium">{t('characters.saved')}</h2>
        <span className="vault-count">{t('characters.count', { count: filtered.length })}</span>
      </div>
      {filtered.length === 0
        ? <p className="mt-4 px-2 leading-6 text-muted-foreground">{t('library.empty')}</p>
        : <div className="companion-fan-shell">
          <div className="companion-fan" role="list" aria-label={t('characters.saved')} onPointerMove={pickActive} onPointerLeave={() => setActive(undefined)}>
            {fanned.map((character, index) => {
              const offset = index - fanMiddle
              return card(character, { '--fan-i': index, '--fan-x': `${offset * FAN_SPREAD}px`, '--fan-y': `${Math.abs(offset) * 7}px`, '--fan-r': `${offset * 4.25}deg` } as CSSProperties, fanState(index))
            })}
          </div>
        </div>}
      {overflow.length > 0 && <details className="saved-overflow">
        <summary>{t('characters.more', { count: overflow.length })}</summary>
        <div className="companion-grid">{overflow.map((character) => card(character))}</div>
      </details>}
    </section>

    <div className="start-gates mt-8 grid gap-4 sm:grid-cols-2">
      <section className="start-gate rounded-2xl border bg-background p-5 shadow-sm">
        <div className="gate-icon"><AozuIcon name="book" /></div>
        <div className="min-w-0">
          <h2 className="font-heading text-xl font-medium">{t('characters.new')}</h2>
          <p className="mt-2 leading-6 text-muted-foreground">{t('characters.gates.create')}</p>
        </div>
        <Button className="gate-action" disabled={busy} onClick={() => void run(async () => openCharacter((await createCharacter()).id))}><PlusIcon aria-hidden="true" />{t('characters.new')}</Button>
      </section>
      <section className="start-gate rounded-2xl border bg-background p-5 shadow-sm">
        <div className="gate-icon"><AozuIcon name="import" /></div>
        <div className="min-w-0">
          <h2 className="font-heading text-xl font-medium">{t('data.import')}</h2>
          <p className="mt-2 leading-6 text-muted-foreground">{t('characters.gates.import')}</p>
        </div>
        <div className="gate-action"><DataControls prepareImport={async (blob) => { await importCharacter(blob); await refresh() }} /></div>
      </section>
    </div>

    <CharacterLibraryTransfer {...transfer} />

    <section className="parchment-notice mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5">
      <div className="min-w-0">
        <h2 className="font-heading text-xl font-medium">{t('characters.story.title')}</h2>
        <p className="mt-1 text-muted-foreground">{t('characters.story.description')}</p>
      </div>
      <Button disabled variant="secondary">{t('characters.story.comingSoon')}</Button>
    </section>
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

  </main>
}
