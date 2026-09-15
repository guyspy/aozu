import { WorkspaceSheet } from '@/ui/Workspace'
import { ImportIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { DEFAULT_CHARACTER_COLLECTION, type CharacterCollection, type CharacterCollectionProfile } from '@/core/domain/character-collection'
import { DataControls } from '@/ui/DataControls'
import { WorkspaceActions } from '@/ui/Workspace'
import { Button } from '@/ui/components/ui/button'
import { Sheet } from '@/ui/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip'

/**
 * The actions that belong to a whole setting collection, for the tabs of every view of one.
 * Collection tabs live in two pages, so these travel with the collection rather than with either page.
 */
export function CollectionActions({ collection, deleteCollection, importCharacter, refresh }: {
  collection?: CharacterCollection
  deleteCollection(id: string, version: number): Promise<void>
  importCharacter(blob: Blob): Promise<void>
  refresh(): Promise<void>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [panel, setPanel] = useState<'import' | 'delete'>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const name = collection && collection.id === DEFAULT_CHARACTER_COLLECTION ? t('books.default') : collection?.name ?? ''
  const open = (next: typeof panel) => { setError(undefined); setPanel(next) }
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setError(undefined)
    try { await task(); await refresh(); setPanel(undefined) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); await refresh() }
    finally { setBusy(false) }
  }
  const action = (label: string, icon: typeof ImportIcon, click: () => void) => {
    const Icon = icon
    return <Tooltip><TooltipTrigger asChild><Button size="icon" variant="outline" aria-label={label} onClick={click}><Icon /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
  }

  return <>
    <WorkspaceActions aria-label={t('books.actions')}><TooltipProvider>
      {action(t('data.import'), ImportIcon, () => open('import'))}
      {collection && collection.id !== DEFAULT_CHARACTER_COLLECTION && action(t('books.delete'), Trash2Icon, () => open('delete'))}
    </TooltipProvider></WorkspaceActions>
    <Sheet open={Boolean(panel)} onOpenChange={(next) => { if (!next && !busy) setPanel(undefined) }}>
      <WorkspaceSheet title={t(panel === 'import' ? 'data.import' : 'books.delete')} closeLabel={t('common.close')} aria-describedby={undefined}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>

        {panel === 'delete' && collection && <><p>{t('books.deleteHint', { name })}</p><Button variant="destructive" disabled={busy} onClick={() => void run(async () => { await deleteCollection(collection.id, collection.version); navigate(`/collections/${DEFAULT_CHARACTER_COLLECTION}`) })}>{t(busy ? 'data.busy' : 'books.delete')}</Button></>}
        {panel === 'import' && <><p className="text-sm text-muted-foreground">{t('books.importHint')}</p><DataControls prepareImport={importCharacter} /></>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </WorkspaceSheet>
    </Sheet>
  </>
}

export function CollectionProfileAction({ collection, updateCollection, refresh }: {
  collection: CharacterCollection
  updateCollection(id: string, profile: CharacterCollectionProfile, version: number): Promise<void>
  refresh(): Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const fields = () => ({ name: collection.name, description: collection.description, backstory: collection.backstory })
  const [profile, setProfile] = useState<CharacterCollectionProfile>(fields)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return <>
    <Button type="button" size="icon" variant="ghost" aria-label={t('books.editWorld')} onClick={() => { setProfile(fields()); setError(undefined); setOpen(true) }}><PencilIcon /></Button>
    <Sheet open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
      <WorkspaceSheet title={t('books.profile')} closeLabel={t('common.close')} aria-describedby={undefined}>
        <form className="book-profile-form" onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(undefined); void updateCollection(collection.id, profile, collection.version).then(refresh).then(() => setOpen(false)).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught))).finally(() => setBusy(false)) }}>
          {collection.id !== DEFAULT_CHARACTER_COLLECTION && <label>{t('books.name')}<input autoFocus required maxLength={100} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} disabled={busy} /></label>}
          <label>{t('books.description')}<textarea rows={3} maxLength={500} value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} disabled={busy} /></label>
          <label>{t('books.world')}<textarea rows={11} maxLength={8000} value={profile.backstory} onChange={(event) => setProfile({ ...profile, backstory: event.target.value })} disabled={busy} /><span className="text-xs font-normal text-muted-foreground">{t('books.worldHint')}</span></label>
          <div className="flex justify-end gap-2"><Button variant="ghost" type="button" disabled={busy} onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button disabled={busy || !profile.name.trim()} type="submit">{t(busy ? 'data.busy' : 'books.save')}</Button></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </WorkspaceSheet>
    </Sheet>
  </>
}
