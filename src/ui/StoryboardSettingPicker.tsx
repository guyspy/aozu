import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Application } from '@/bootstrap'
import type { WorldLibrary } from '@/core/domain/world-library'
import { locationAncestors } from '@/core/domain/world-library'
import type { CharacterCollection } from '@/core/domain/character-collection'
import type { CharacterLibraryItem } from '@/ui/pages/CharacterLibraryPage'
import type { BoardCommand, BoardFrame, SettingSnapshot } from '@/core/domain/storyboard'
import { WorldPicture } from '@/ui/WorldPicture'
import { Button } from '@/ui/components/ui/button'
export function StoryboardSettingPicker({ application, world, collections, characters, frame, disabled, pin }: { application: Application; world: WorldLibrary; collections: CharacterCollection[]; characters: CharacterLibraryItem[]; frame: BoardFrame; disabled: boolean; pin(command: BoardCommand, blob?: Blob): Promise<unknown> }) {
  const { t } = useTranslation(), text = (key: string) => t(`world.${key}`)
  const [kind, setKind] = useState<SettingSnapshot['kind']>('location'), [id, setId] = useState(''), [conditionId, setCondition] = useState(''), [imageId, setImage] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const location = world.locations.find((l) => l.id === id), condition = location?.conditions.find((c) => c.id === conditionId), photo = world.photos.find((p) => p.id === id)
  const images = [...(location?.images ?? []), ...(condition?.images ?? [])], image = images.find((i) => i.id === imageId)
  const run = async () => {
    setBusy(true); setError('')
    try {
      let setting: SettingSnapshot, blob: Blob | undefined, filename = 'reference.png', source = '', purpose = ''
      if (kind === 'character') {
        const { character, version: revision, png } = await application.characterReference(id)
        const collection = collections.find((c) => c.characterIds.includes(id))
        setting = { id: crypto.randomUUID(), kind, sourceId: id, revision, name: character.name, details: [character.description, character.backstory, ...Object.entries(character.attributes ?? {}).map(([key, value]) => `${key}: ${value}`), collection?.backstory].filter(Boolean).join('\n\n') }
        blob = png; source = `character:${id}@${revision}`
      } else if (kind === 'location') {
        if (!location) throw new Error('Choose a location')
        const collection = collections.find((c) => c.id === location.collectionId)
        setting = { id: crypto.randomUUID(), kind, sourceId: id, revision: world.revision, name: `${location.name}${condition ? ` · ${condition.name}` : ''}`, details: [location.description, `${text('consistency')}: ${location.consistency}`, condition && `${text('condition')}: ${condition.name}\n${condition.description}`, `${text('parent')}: ${locationAncestors(world, id).slice(0, -1).map((l) => `${l.name}: ${l.description}`).join(' / ')}`, collection?.backstory].filter(Boolean).join('\n\n') }
        if (image) { blob = await application.worldLibrary.png(image.image); source = `${image.source} · ${image.image.sha256}`; purpose = `${text(image.purpose)} · ${image.label}`; filename = `${image.label}.png` }
      } else {
        if (!photo) throw new Error('Choose an image')
        setting = { id: crypto.randomUUID(), kind, sourceId: id, revision: world.revision, name: photo.name, details: [photo.description, `${text('source')}: ${photo.source}`].filter(Boolean).join('\n\n') }
        blob = await application.worldLibrary.png(photo.image); source = `${photo.source} · album:${photo.albumId}/${photo.id} · ${photo.image.sha256}`; filename = `${photo.name}.png`; purpose = text('inspiration')
      }
      await pin({ action: 'pin-setting', frameId: frame.id, setting, filename: filename.slice(0, 200), source: source.slice(0, 2000), purpose }, blob)
      setId(''); setCondition(''); setImage('')
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section className="world-form"><h3>{text('context')}</h3><p>{text('contextHint')}</p>{frame.settings?.map((s) => <details key={s.id}><summary>{s.name} · v{s.revision}</summary><p className="whitespace-pre-wrap break-words text-sm">{s.details}</p><Button variant="ghost" size="sm" disabled={busy || disabled} onClick={() => void pin({ action: 'unpin-setting', frameId: frame.id, imageId: s.id }).catch((e) => setError(String(e)))}>{text('remove')}</Button></details>)}<label>{text('source')}<select value={kind} disabled={busy || disabled} onChange={(e) => { setKind(e.target.value as SettingSnapshot['kind']); setId(''); setCondition(''); setImage('') }}><option value="location">{text('locations')}</option><option value="character">{text('characters')}</option><option value="photo">{text('albums')}</option></select></label><label>{text('name')}<select value={id} disabled={busy || disabled} onChange={(e) => { setId(e.target.value); setCondition(''); setImage('') }}><option value="">—</option>{(kind === 'location' ? world.locations : kind === 'character' ? characters : world.photos).map((item) => <option key={item.id} value={item.id}>{kind === 'location' ? locationAncestors(world, item.id).map((l) => l.name).join(' / ') : item.name}</option>)}</select></label>{kind === 'location' && location && <><label>{text('condition')}<select value={conditionId} onChange={(e) => { setCondition(e.target.value); setImage('') }} disabled={busy || disabled}><option value="">{text('base')}</option>{location.conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>{text('chooseImage')}<select value={imageId} onChange={(e) => setImage(e.target.value)} disabled={busy || disabled}><option value="">—</option>{images.map((i) => <option key={i.id} value={i.id}>{i.label} · {text(i.purpose)}</option>)}</select></label></>}{(image || (kind === 'photo' && photo)) && <WorldPicture service={application.worldLibrary} hash={image?.image.sha256 ?? photo?.image.sha256} alt={image?.label ?? photo?.name ?? ''} />}<Button variant="outline" disabled={busy || disabled || !id} onClick={() => void run()}>{text(busy ? 'working' : 'pin')}</Button>{error && <p role="alert" className="story-error">{error}</p>}</section>
}
