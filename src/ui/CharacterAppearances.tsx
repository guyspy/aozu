import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activeCharacterAppearance, changeCharacterAppearance, sameCharacterSelection } from '@/core/application/character-appearances'
import type { CharacterDraft } from '@/core/domain/character'
import { Button } from '@/ui/components/ui/button'

export function CharacterAppearances({ draft, commit, busy }: {
  draft: CharacterDraft
  commit(produce: (current: CharacterDraft) => CharacterDraft): void
  busy: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<{ action: 'save' | 'rename'; label: string }>()
  const active = activeCharacterAppearance(draft)
  const modified = active && !sameCharacterSelection(draft.selected, active.selected)
  return <section className="mb-3 shrink-0 rounded-lg border p-3" aria-label={t('modelSheet.appearances.title')} data-has-uncommitted-input={Boolean(form)}>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
        {t('modelSheet.appearances.title')}
        <select className="min-w-0 flex-1 rounded border bg-background p-2" aria-label={t('modelSheet.appearances.choose')}
          value={draft.activeAppearanceId ?? ''} disabled={busy || Boolean(form) || !draft.appearances?.length}
          onChange={(event) => { const id = event.currentTarget.value; commit((current) => changeCharacterAppearance(current, { action: 'select', id })) }}>
          {!active && <option value="">{t('modelSheet.appearances.unnamed')}</option>}
          {draft.appearances?.map(({ id, label }) => <option key={id} value={id}>{label}{id === active?.id && modified ? ` · ${t('modelSheet.appearances.modified')}` : ''}</option>)}
        </select>
      </label>
      <Button type="button" size="sm" variant="outline" disabled={busy || Boolean(form)} onClick={() => setForm({ action: 'save', label: '' })}>{t('modelSheet.appearances.saveNew')}</Button>
      {active && <Button type="button" size="sm" variant="ghost" disabled={busy || Boolean(form)} onClick={() => setForm({ action: 'rename', label: active.label })}>{t('modelSheet.appearances.rename')}</Button>}
    </div>
    {form ? <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault()
      const id = form.action === 'save' ? `look-${crypto.randomUUID().slice(0, 8)}` : active!.id
      const command = { ...form, id }
      commit((current) => changeCharacterAppearance(current, command))
      setForm(undefined)
    }}>
      <label className="grid min-w-0 flex-1 gap-1 text-sm">{t('modelSheet.appearances.name')}
        <input autoFocus required maxLength={80} className="min-w-0 rounded border bg-background p-2" value={form.label}
          onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === 'Escape') setForm(undefined) }} />
      </label>
      <Button type="submit" size="sm" disabled={busy || !form.label.trim()}>{t('modelSheet.appearances.save')}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setForm(undefined)}>{t('common.cancel')}</Button>
    </form> : <p className="mt-2 text-xs text-muted-foreground">{t(modified ? 'modelSheet.appearances.modifiedHint' : 'modelSheet.appearances.hint')}
      {modified && <button type="button" className="ml-2 underline" disabled={busy} onClick={() => commit((current) => changeCharacterAppearance(current, { action: 'select', id: active.id }))}>{t('modelSheet.appearances.restore')}</button>}
    </p>}
  </section>
}
