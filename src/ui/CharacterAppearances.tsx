import { useRef, useState, type ReactNode } from 'react'
import { CheckIcon, ChevronsUpDownIcon, PencilIcon, PlusIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { activeCharacterAppearance, type CharacterAppearanceCommand } from '@/core/application/character-appearances'
import type { CharacterDraft } from '@/core/domain/character'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/ui/components/ui/alert-dialog'

export function CharacterAppearances({ draft, change, busy, manage = false, children }: {
  draft: CharacterDraft
  change(command: CharacterAppearanceCommand): void
  busy: boolean
  manage?: boolean
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<{ action: 'save-as' | 'rename'; label: string }>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const active = activeCharacterAppearance(draft)
  const canDelete = (draft.appearances?.length ?? 0) > 1
  const closeForm = () => { setForm(undefined); requestAnimationFrame(() => trigger.current?.focus()) }
  const newLabel = (base: string) => {
    let label = base.slice(0, 80)
    for (let suffix = 2; draft.appearances?.some((look) => look.label === label); suffix++) {
      const ending = ` ${suffix}`
      label = `${base.slice(0, 80 - ending.length)}${ending}`
    }
    return label
  }
  return <section className="min-w-0 shrink-0" aria-label={t('modelSheet.appearances.title')} data-has-uncommitted-input={Boolean(form) || deleteOpen}>
    <div className="appearance-toolbar flex flex-wrap items-center gap-1">
      {form ? <form className="flex min-w-0 flex-1 basis-36 items-center gap-1" onSubmit={(event) => {
        event.preventDefault()
        change({ ...form, id: form.action === 'save-as' ? `look-${crypto.randomUUID().slice(0, 8)}` : active!.id })
        closeForm()
      }}>
        <Input autoFocus required maxLength={80} aria-label={t('modelSheet.appearances.name')} value={form.label} disabled={busy}
          onFocus={(event) => event.currentTarget.select()} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeForm() } }} />
        <Button type="button" size="icon" variant="ghost" aria-label={t('common.cancel')} onClick={closeForm} disabled={busy}><XIcon /></Button>
        <Button type="submit" size="icon" variant="ghost" aria-label={t(form.action === 'rename' ? 'modelSheet.appearances.rename' : 'modelSheet.appearances.save')} disabled={busy || !form.label.trim()}><CheckIcon /></Button>
      </form> : <DropdownMenu>
        <DropdownMenuTrigger asChild><Button ref={trigger} type="button" variant="outline" className="min-w-0 flex-1 basis-36 justify-between" aria-label={t('modelSheet.appearances.choose')} disabled={busy}>
          <span className="truncate">{active?.label}</span><ChevronsUpDownIcon className="text-muted-foreground" />
        </Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56 max-w-[calc(100vw-2rem)]">
          {manage && active && <><DropdownMenuItem onSelect={() => setForm({ action: 'rename', label: active.label })}><PencilIcon />{t('modelSheet.appearances.rename')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setForm({ action: 'save-as', label: newLabel(t('modelSheet.appearances.copyName', { name: active.label })) })}><SaveIcon />{t('modelSheet.appearances.saveNew')}</DropdownMenuItem>
            <DropdownMenuSeparator /></>}
          <DropdownMenuRadioGroup value={draft.activeAppearanceId} onValueChange={(id) => change({ action: 'select', id })}>
            {draft.appearances?.map(({ id, label }) => <DropdownMenuRadioItem key={id} value={id}><span className="truncate">{label}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          {manage && <>
            <DropdownMenuItem onSelect={() => {
              change({ action: 'create', id: `look-${crypto.randomUUID().slice(0, 8)}`, label: newLabel(t('modelSheet.appearances.newName')) })
            }}><PlusIcon />{t('modelSheet.appearances.addNew')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!canDelete} onSelect={() => setDeleteOpen(true)}><Trash2Icon />{t('modelSheet.appearances.delete')}</DropdownMenuItem>
            {!canDelete && <DropdownMenuLabel>{t('modelSheet.appearances.keepOne')}</DropdownMenuLabel>}
          </>}
        </DropdownMenuContent>
      </DropdownMenu>}
      {children}
    </div>
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent><AlertDialogHeader>
        <AlertDialogTitle>{t('modelSheet.appearances.deleteTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('modelSheet.appearances.deleteDescription', { name: active?.label })}</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter>
        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={busy || !canDelete} onClick={() => change({ action: 'delete', id: active!.id })}>{t('modelSheet.appearances.delete')}</AlertDialogAction>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </section>
}
