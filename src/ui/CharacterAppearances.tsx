import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activeCharacterAppearance, sameCharacterSelection, type CharacterAppearanceCommand } from '@/core/application/character-appearances'
import type { CharacterDraft } from '@/core/domain/character'
import { Button } from '@/ui/components/ui/button'

export function CharacterAppearances({ draft, change, busy, manage = false }: {
  draft: CharacterDraft
  change(command: CharacterAppearanceCommand): void
  busy: boolean
  manage?: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<{ action: 'save' | 'rename'; label: string }>()
  const active = activeCharacterAppearance(draft)
  const modified = active && !sameCharacterSelection(draft.selected, active.selected)
  return <section className="min-w-0 shrink-0" aria-label={t('modelSheet.appearances.title')} data-has-uncommitted-input={Boolean(form)}>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-0 flex-1 basis-full items-center gap-2 text-sm font-semibold">
        {t('modelSheet.appearances.title')}
        <select className="min-w-0 flex-1 rounded border bg-background p-2" aria-label={t('modelSheet.appearances.choose')}
          value={draft.activeAppearanceId ?? ''} disabled={busy || Boolean(form) || !draft.appearances?.length}
          onChange={(event) => change({ action: 'select', id: event.currentTarget.value })}>
          {!active && <option value="" disabled>{t('modelSheet.appearances.unnamed')}</option>}
          {draft.appearances?.map(({ id, label }) => <option key={id} value={id}>{label}{manage && id === active?.id && modified ? ` · ${t('modelSheet.appearances.modified')}` : ''}</option>)}
        </select>
      </label>
      {manage && <Button type="button" size="sm" variant="outline" disabled={busy || Boolean(form)} onClick={() => setForm({ action: 'save', label: '' })}>{t('modelSheet.appearances.saveNew')}</Button>}
      {manage && active && <Button type="button" size="sm" variant="ghost" disabled={busy || Boolean(form)} onClick={() => setForm({ action: 'rename', label: active.label })}>{t('modelSheet.appearances.rename')}</Button>}
    </div>
    {form ? <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault()
      const id = form.action === 'save' ? `look-${crypto.randomUUID().slice(0, 8)}` : active!.id
      const command = { ...form, id }
      change(command)
      setForm(undefined)
    }}>
      <label className="grid min-w-0 flex-1 gap-1 text-sm">{t('modelSheet.appearances.name')}
        <input autoFocus required maxLength={80} className="min-w-0 rounded border bg-background p-2" value={form.label}
          onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === 'Escape') setForm(undefined) }} />
      </label>
      <Button type="submit" size="sm" disabled={busy || !form.label.trim()}>{t('modelSheet.appearances.save')}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setForm(undefined)}>{t('common.cancel')}</Button>
    </form> : manage && modified && <p className="mt-2 text-xs text-muted-foreground">{t('modelSheet.appearances.modifiedHint')}
      <button type="button" className="ml-2 underline" disabled={busy} onClick={() => change({ action: 'select', id: active.id })}>{t('modelSheet.appearances.restore')}</button>
    </p>}
  </section>
}
