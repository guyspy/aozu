import { useState, type ReactNode } from 'react'
import { CopyPlusIcon, PencilIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { activeCharacterAppearance, type CharacterAppearanceCommand } from '@/core/application/character-appearances'
import type { CharacterDraft } from '@/core/domain/character'
import { Button } from '@/ui/components/ui/button'

export function CharacterAppearances({ draft, change, busy, manage = false, children }: {
  draft: CharacterDraft
  change(command: CharacterAppearanceCommand): void
  busy: boolean
  manage?: boolean
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<{ action: 'save-as' | 'rename'; label: string }>()
  const active = activeCharacterAppearance(draft)
  return <section className="min-w-0 shrink-0" aria-label={t('modelSheet.appearances.title')} data-has-uncommitted-input={Boolean(form)}>
    <div className="appearance-toolbar flex flex-wrap items-center gap-1">
      <label className="flex min-w-0 flex-1 basis-36 items-center text-sm font-semibold">
        <select className="min-w-0 flex-1 rounded border bg-background p-2" aria-label={t('modelSheet.appearances.choose')}
          value={draft.activeAppearanceId ?? ''} disabled={busy || Boolean(form) || !draft.appearances?.length}
          onChange={(event) => change({ action: 'select', id: event.currentTarget.value })}>
          {!active && <option value="" disabled>{t('modelSheet.appearances.unnamed')}</option>}
          {draft.appearances?.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      {manage && <Button type="button" size="icon" variant="ghost" title={t('modelSheet.appearances.saveNewHelp')} aria-label={t('modelSheet.appearances.saveNew')} disabled={busy || Boolean(form)} onClick={() => setForm({ action: 'save-as', label: '' })}><CopyPlusIcon /></Button>}
      {manage && active && <Button type="button" size="icon" variant="ghost" title={t('modelSheet.appearances.rename')} aria-label={t('modelSheet.appearances.rename')} disabled={busy || Boolean(form)} onClick={() => setForm({ action: 'rename', label: active.label })}><PencilIcon /></Button>}
      {children}
    </div>
    {form && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault()
      const id = form.action === 'save-as' ? `look-${crypto.randomUUID().slice(0, 8)}` : active!.id
      const command = { ...form, id }
      change(command)
      setForm(undefined)
    }}>
      <label className="grid min-w-0 flex-1 gap-1 text-sm">{t('modelSheet.appearances.name')}
        <input autoFocus required maxLength={80} className="min-w-0 rounded border bg-background p-2" value={form.label}
          onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === 'Escape') setForm(undefined) }} />
      </label>
      <Button type="submit" size="sm" disabled={busy || !form.label.trim()}>{t(form.action === 'rename' ? 'modelSheet.appearances.rename' : 'modelSheet.appearances.save')}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setForm(undefined)}>{t('common.cancel')}</Button>
    </form>}
  </section>
}
