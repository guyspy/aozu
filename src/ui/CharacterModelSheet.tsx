import { ImagePlusIcon, RulerIcon } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { updateCharacterModelSheet } from '@/core/application/character-model-sheet'
import { CHARACTER_REFERENCE_VIEWS, type CharacterDraft, type CharacterReference, type CharacterReferenceView } from '@/core/domain/character'
import { BlobImage } from '@/ui/BlobImage'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/ui/components/ui/sheet'

export function CharacterModelSheet({ draft, edit, commit, revert, upload, useCurrent, busy, error, saveFeedback }: {
  draft: CharacterDraft
  edit(draft: CharacterDraft): void
  commit(produce: (current: CharacterDraft) => CharacterDraft): void
  revert(): void
  upload(view: CharacterReferenceView, file: File): void
  useCurrent?: () => void
  busy: boolean
  error?: string
  saveFeedback: ReactNode
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<CharacterReferenceView>()
  const trigger = useRef<HTMLButtonElement>(null)
  const sheet = draft.modelSheet ?? { views: {} }
  const reference = view ? sheet.views[view] : undefined
  const guides = reference?.guides ?? { head: 0.1, feet: 0.9 }
  const label = (id: CharacterReferenceView) => t(`modelSheet.views.${id}`)
  const change = (patch: Partial<CharacterReference>) => {
    if (view && reference) edit({ ...draft, modelSheet: { ...sheet, views: { ...sheet.views, [view]: { ...reference, ...patch } } } })
  }
  const fileInput = (id: CharacterReferenceView) => <input type="file" accept="image/png" disabled={busy}
    aria-label={t('modelSheet.uploadView', { view: label(id) })}
    onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) upload(id, file) }} />

  return <section className="model-sheet min-h-0 flex-1 overflow-auto" aria-label={t('modelSheet.title')} data-reference-view={view}>
    <div className="model-sheet-toolbar">
      <div><h2 className="font-heading text-xl font-semibold">{draft.name} · {t('modelSheet.fullBody')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('modelSheet.count', { count: Object.keys(sheet.views).length })}</p></div>
      <label className="model-sheet-height"><span><RulerIcon className="size-4" />{t('modelSheet.height')}</span>
        <input type="number" min="0.1" max="100000" step="0.1" placeholder={t('modelSheet.unknownHeight')}
          value={sheet.heightCm ?? ''} onChange={(event) => {
            const heightCm = event.currentTarget.value === '' ? undefined : event.currentTarget.valueAsNumber
            if (heightCm === undefined || Number.isFinite(heightCm)) edit({ ...draft, modelSheet: { ...sheet, heightCm } })
          }} onBlur={(event) => {
            if (!event.currentTarget.checkValidity()) { event.currentTarget.reportValidity(); return }
            const heightCm = event.currentTarget.value === '' ? undefined : event.currentTarget.valueAsNumber
            commit((current) => updateCharacterModelSheet(current, { ...current.modelSheet, views: current.modelSheet?.views ?? {}, heightCm }))
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') revert() }} />
      </label>
    </div>
    <p className="mb-4 text-sm text-muted-foreground">{t('modelSheet.brief')}</p>
    <div className="model-sheet-grid">
      {CHARACTER_REFERENCE_VIEWS.map((id, index) => {
        const item = sheet.views[id]
        return <article key={id} className="model-sheet-card">
          <h3><span className="text-muted-foreground">0{index + 1}</span>{label(id)}</h3>
          {item ? <button type="button" className="model-sheet-art" aria-label={t('modelSheet.openView', { view: label(id) })} onClick={(event) => { trigger.current = event.currentTarget; revert(); setView(id) }}>
            <BlobImage blob={item.asset.blob} alt={label(id)} className="size-full object-contain" />
          </button> : <label className="model-sheet-art model-sheet-empty"><ImagePlusIcon className="size-6" /><span>{t('modelSheet.add')}</span>{fileInput(id)}</label>}
          <p className="model-sheet-state">{t(item ? item.guides ? 'modelSheet.calibrated' : 'modelSheet.uncalibrated' : 'modelSheet.missing')}</p>
          {item?.notes && <p className="line-clamp-2 text-sm text-muted-foreground">{item.notes}</p>}
          {id === 'front' && !item && useCurrent && <Button type="button" variant="ghost" size="sm" className="mt-auto whitespace-normal" disabled={busy} onClick={useCurrent}>{t('modelSheet.useCurrent')}</Button>}
        </article>
      })}
    </div>
    <p className="mt-4 text-xs leading-5 text-muted-foreground">{t('modelSheet.scaleNote')}</p>
    <Sheet open={Boolean(view && reference)} onOpenChange={(open) => { if (!open) { revert(); setView(undefined) } }}>
      <SheetContent className="model-sheet-detail overflow-y-auto p-5 sm:p-8" closeLabel={t('common.close')} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
        {view && reference && <>
          <SheetTitle>{draft.name} · {label(view)}</SheetTitle>
          <SheetDescription>{t('modelSheet.calibrateHelp')}</SheetDescription>
          <div className="model-sheet-calibration" style={{ aspectRatio: `${reference.asset.inspection.width} / ${reference.asset.inspection.height}`, width: `min(100%, ${55 * reference.asset.inspection.width / reference.asset.inspection.height}svh)` }}>
            <BlobImage blob={reference.asset.blob} alt={label(view)} className="size-full object-contain" />
            {(['head', 'feet'] as const).map((line) => <div key={line} className={`model-sheet-guide is-${line}`} style={{ top: `${guides[line] * 100}%` }}><span>{t(`modelSheet.${line}`)}</span></div>)}
          </div>
          <form className="grid gap-4" onSubmit={(event) => {
            event.preventDefault()
            commit((current) => {
              if (current.modelSheet?.views[view]?.asset.inspection.sha256 !== reference.asset.inspection.sha256) throw new Error('Reference changed; reopen it before saving')
              return updateCharacterModelSheet(current, { ...current.modelSheet, views: { ...current.modelSheet.views, [view]: { ...reference, guides } } })
            })
          }}>
            {(['head', 'feet'] as const).map((line) => <label key={line} className="grid grid-cols-[4rem_1fr_3rem] items-center gap-3">
              <span>{t(`modelSheet.${line}`)}</span><input type="range" min={line === 'head' ? 0 : Math.round(guides.head * 100) + 1} max={line === 'head' ? Math.round(guides.feet * 100) - 1 : 100} step="1" value={Math.round(guides[line] * 100)} onChange={(event) => change({ guides: { ...guides, [line]: Number(event.currentTarget.value) / 100 } })} />
              <output className="text-right tabular-nums">{Math.round(guides[line] * 100)}%</output>
            </label>)}
            <label className="grid gap-2"><span>{t('modelSheet.notes')}</span><textarea rows={3} maxLength={1000} value={reference.notes ?? ''} onChange={(event) => change({ notes: event.currentTarget.value })} className="rounded-lg border bg-background p-3" /></label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="model-sheet-replace">{t('modelSheet.replace')}{fileInput(view)}</label>
              <Button type="submit" disabled={busy}>{t('modelSheet.saveReference')}</Button>
            </div>
            {error && <p role="alert" className="text-destructive">{error}</p>}
            {saveFeedback}
          </form>
        </>}
      </SheetContent>
    </Sheet>
  </section>
}
