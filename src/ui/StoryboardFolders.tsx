import { ChevronsUpDownIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import type { WorldLibraryService } from '@/core/application/world-library'
import type { WorldLibrary, StoryFolder } from '@/core/domain/world-library'
import type { CharacterCollection } from '@/core/domain/character-collection'
import { WorkspaceSheet } from '@/ui/Workspace'
import { Button } from '@/ui/components/ui/button'
import { Sheet } from '@/ui/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/ui/components/ui/alert-dialog'

export function StoryboardFolders({ service, library, collections, folderId, boardId, disabled }: {
  service: WorldLibraryService
  library: WorldLibrary
  collections: CharacterCollection[]
  folderId?: string
  boardId?: string
  disabled?: boolean
}) {
  const { t } = useTranslation(), text = (key: string) => t(`world.${key}`), navigate = useNavigate()
  const folder = library.folders.find((item) => item.id === (boardId ? library.boardFolders[boardId] : folderId))
  const [editing, setEditing] = useState<{ value: StoryFolder; snapshot: WorldLibrary }>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(''); try { await task() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const edit = (value?: StoryFolder) => setEditing({ snapshot: structuredClone(library), value: value ?? { id: crypto.randomUUID(), name: '', description: '', synopsis: '', direction: '', collectionIds: [], updatedAt: 0 } })
  const selected = boardId ? library.boardFolders[boardId] ?? 'unfiled' : folderId ?? 'all'
  const choose = (id: string) => {
    if (!boardId) { navigate(id === 'all' ? '/storyboards' : `/storyboards/folders/${id}`); return }
    void run(async () => {
      const next = structuredClone(library)
      if (id === 'unfiled') delete next.boardFolders[boardId]
      else next.boardFolders[boardId] = id
      await service.save(next)
    })
  }
  const remove = () => run(async () => {
    if (!folder) return
    const next = structuredClone(library)
    next.folders = next.folders.filter((item) => item.id !== folder.id)
    next.boardFolders = Object.fromEntries(Object.entries(next.boardFolders).filter(([, id]) => id !== folder.id))
    await service.save(next); setDeleteOpen(false); navigate('/storyboards')
  })

  return <>
    <div className="story-folder-toolbar" data-has-uncommitted-input={Boolean(editing) || deleteOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="outline" className="min-w-0 justify-between" aria-label={text('folder')} disabled={busy || disabled}>
          <span className="truncate">{selected === 'all' ? text('allBoards') : selected === 'unfiled' ? text('unfiled') : folder?.name}</span><ChevronsUpDownIcon className="text-muted-foreground" />
        </Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56 max-w-[calc(100vw-2rem)]">
          {!boardId && folder && <><DropdownMenuItem onSelect={() => edit(folder)}><PencilIcon />{text('edit')}</DropdownMenuItem><DropdownMenuSeparator /></>}
          <DropdownMenuRadioGroup value={selected} onValueChange={choose}>
            {!boardId && <DropdownMenuRadioItem value="all">{text('allBoards')}</DropdownMenuRadioItem>}
            <DropdownMenuRadioItem value="unfiled">{text('unfiled')}</DropdownMenuRadioItem>
            {library.folders.map((item) => <DropdownMenuRadioItem key={item.id} value={item.id}><span className="truncate">{item.name}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          {!boardId && <><DropdownMenuItem onSelect={() => edit()}><PlusIcon />{text('createFolder')}</DropdownMenuItem>{folder && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}><Trash2Icon />{text('remove')}</DropdownMenuItem></>}</>}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <p role="alert" className="story-error">{error}</p>}
    </div>
    <Sheet open={Boolean(editing)} onOpenChange={(open) => { if (!open && !busy) setEditing(undefined) }}>
      <WorkspaceSheet title={text('folder')} closeLabel={text('close')} aria-describedby={undefined}>
        {editing && <form className="world-form" onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void run(async () => {
            const next = structuredClone(editing.snapshot)
            const value = { ...editing.value, name: String(data.get('name')).trim(), description: String(data.get('description')), synopsis: String(data.get('synopsis')), direction: String(data.get('direction')), collectionIds: data.getAll('collections').map(String), updatedAt: Date.now() }
            next.folders = [...next.folders.filter((item) => item.id !== value.id), value]
            await service.save(next); setEditing(undefined); navigate(`/storyboards/folders/${value.id}`)
          })
        }}>
          {(['name', 'description', 'synopsis', 'direction'] as const).map((key) => <label key={key}>{text(key)}{key === 'name' ? <input name={key} defaultValue={editing.value[key]} required maxLength={120} disabled={busy} /> : <textarea name={key} defaultValue={editing.value[key]} maxLength={8000} disabled={busy} />}</label>)}
          <fieldset><legend>{text('linkedCollections')}</legend>{collections.map((collection) => <label className="world-checkbox" key={collection.id}><input type="checkbox" name="collections" value={collection.id} defaultChecked={editing.value.collectionIds.includes(collection.id)} disabled={busy} />{collection.id === 'default' ? text('defaultCollection') : collection.name}</label>)}</fieldset>
          <Button disabled={busy}>{text('save')}</Button>
          {error && <p role="alert" className="story-error">{error}</p>}
        </form>}
      </WorkspaceSheet>
    </Sheet>
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{text('remove')}</AlertDialogTitle><AlertDialogDescription>{folder?.name}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{text('cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => void remove()}>{text('remove')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>
}
