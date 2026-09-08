import { ImagePlusIcon, RulerIcon } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { updateCharacterModelSheet, characterModelSheet, withCharacterModelSheet, modelSheetReferences, setModelSheetReference, isTurnaroundView } from '@/core/application/character-model-sheet'
import { CHARACTER_REFERENCE_VIEWS, CHARACTER_REFERENCE_KINDS, type CharacterDraft, type CharacterReference, type CharacterReferenceMetadata } from '@/core/domain/character'
import { DataControls } from '@/ui/DataControls'
import { BlobImage } from '@/ui/BlobImage'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/ui/components/ui/sheet'

export function CharacterModelSheet({ draft, edit, commit, revert, upload, appearanceSelector, busy, error, saveFeedback, referenceId: view, openReference }: {
  draft: CharacterDraft
  edit(draft: CharacterDraft): void
  commit(produce: (current: CharacterDraft) => CharacterDraft): void
  revert(): void
  upload(id: string, file: File, metadata?: CharacterReferenceMetadata): void
  referenceId?: string
  openReference(id?: string): void
  appearanceSelector: ReactNode
  busy: boolean
  error?: string
  saveFeedback: ReactNode
}) {
  const { t } = useTranslation()
  const trigger = useRef<HTMLButtonElement>(null)
  const sheet = characterModelSheet(draft)
  const references = modelSheetReferences(sheet)
  const reference = view ? references[view] : undefined
  const calibratable = !reference?.kind || ['full-body', 'structure'].includes(reference.kind)
  const guides = reference?.guides ?? { head: 0.1, feet: 0.9 }
  const label = (id: string) => references[id]?.label ?? (isTurnaroundView(id) ? t(`modelSheet.views.${id}`) : id)
  const change = (patch: Partial<CharacterReference>) => {
    if (view && reference) edit(withCharacterModelSheet(draft, setModelSheetReference(sheet, view, { ...reference, ...patch })))
  }
  const fileInput = (id: string) => <input type="file" accept="image/png" disabled={busy}
    aria-label={t('modelSheet.uploadView', { view: label(id) })}
    onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) upload(id, file) }} />

  const card = (id: string, index: number) => {
    const item = references[id]
    const size = item?.asset.inspection
    return <article key={id} className={`model-sheet-card${size && size.width > size.height ? ' col-span-2' : ''}`}>
      <h3><span className="text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>{label(id)}</h3>
      {item ? <button type="button" className="model-sheet-art" style={{ aspectRatio: item.asset.inspection.width / item.asset.inspection.height }} aria-label={t('modelSheet.openView', { view: label(id) })} onClick={(event) => { trigger.current = event.currentTarget; revert(); openReference(id) }}>
        <BlobImage blob={item.asset.blob} alt={label(id)} className="size-full object-contain" />
      </button> : <label className="model-sheet-art model-sheet-empty"><ImagePlusIcon className="size-6" /><span>{t('modelSheet.add')}</span>{fileInput(id)}</label>}
      <p className="model-sheet-state">{item && !isTurnaroundView(id) ? [item.kind && t(`modelSheet.kinds.${item.kind}`), item.viewpoint, item.pose].filter(Boolean).join(' · ') : t(item ? item.guides ? 'modelSheet.calibrated' : 'modelSheet.uncalibrated' : 'modelSheet.missing')}</p>
      {item?.needsReview && <p className="text-sm font-medium text-amber-900">{t('modelSheet.needsReview')}</p>}
      {item?.notes && <p className="line-clamp-2 text-sm text-muted-foreground">{item.notes}</p>}
    </article>
  }

  return <section className="model-sheet min-h-0 flex-1 overflow-auto" aria-label={t('modelSheet.title')} data-reference-view={view}>
    <div className="model-sheet-toolbar">
      <div><h2 className="font-heading text-xl font-semibold">{draft.name} · {t('modelSheet.fullBody')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('modelSheet.count', { count: Object.keys(sheet.views).length })}</p></div>
      <div className="min-w-0 flex-1 basis-48">{appearanceSelector}</div>
      <label className="model-sheet-height"><span><RulerIcon className="size-4" />{t('modelSheet.height')}</span>
        <input type="number" min="0.1" max="100000" step="0.1" placeholder={t('modelSheet.unknownHeight')}
          value={sheet.heightCm ?? ''} onChange={(event) => {
            const heightCm = event.currentTarget.value === '' ? undefined : event.currentTarget.valueAsNumber
            if (heightCm === undefined || Number.isFinite(heightCm)) edit(withCharacterModelSheet(draft, { ...sheet, heightCm }))
          }} onBlur={(event) => {
            if (!event.currentTarget.checkValidity()) { event.currentTarget.reportValidity(); return }
            const heightCm = event.currentTarget.value === '' ? undefined : event.currentTarget.valueAsNumber
            commit((current) => updateCharacterModelSheet(current, { ...characterModelSheet(current), heightCm }))
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') revert() }} />
      </label>
    </div>
    <p className="mb-4 text-sm text-muted-foreground">{t('modelSheet.brief')}</p>
    <div className="model-sheet-grid">{CHARACTER_REFERENCE_VIEWS.map(card)}</div>
    <p className="mt-4 text-xs leading-5 text-muted-foreground">{t('modelSheet.scaleNote')}</p>
    <section className="mt-8 border-t pt-6" aria-labelledby="model-sheet-more-title">
      <h2 id="model-sheet-more-title" className="font-heading text-xl font-semibold">{t('modelSheet.planned.title')}</h2>
      <p className="mb-4 mt-2 text-sm text-muted-foreground">{t('modelSheet.moreHelp')}</p>
      <div className="model-sheet-grid">{Object.keys(sheet.references ?? {}).map(card)}</div>
      <details className="my-4 rounded-lg border p-3">
        <summary className="cursor-pointer font-semibold">{t('modelSheet.add')}</summary>
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          const file = data.get('file')
          if (!(file instanceof File) || !file.size) return
          upload(`ref-${crypto.randomUUID().slice(0, 8)}`, file, {
            label: String(data.get('label')).trim(), kind: String(data.get('kind')) as CharacterReferenceMetadata['kind'],
            ...(data.get('viewpoint') ? { viewpoint: String(data.get('viewpoint')) } : {}),
            ...(data.get('pose') ? { pose: String(data.get('pose')) } : {}),
          })
        }}>
          <label className="grid gap-1">{t('modelSheet.label')}<input className="min-w-0 rounded border p-2" name="label" required maxLength={80} /></label>
          <label className="grid gap-1">{t('modelSheet.kind')}<select className="rounded border p-2" name="kind" defaultValue="structure">{CHARACTER_REFERENCE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`modelSheet.kinds.${kind}`)}</option>)}</select></label>
          <label className="grid gap-1">{t('modelSheet.viewpoint')}<input className="min-w-0 rounded border p-2" name="viewpoint" maxLength={80} /></label>
          <label className="grid gap-1">{t('modelSheet.pose')}<input className="min-w-0 rounded border p-2" name="pose" maxLength={80} /></label>
          <input className="min-w-0 max-w-full" type="file" name="file" accept="image/png" required aria-label={t('modelSheet.add')} />
          <Button type="submit" disabled={busy}>{t('modelSheet.add')}</Button>
        </form>
      </details>
      <div className="mt-6 flex flex-wrap items-center gap-3"><span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">{t('modelSheet.planned.status')}</span></div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {(['landmarks', 'lineup'] as const).map((section) => <li key={section} className="rounded-xl border border-dashed p-4">
          <h3 className="font-semibold">{t(`modelSheet.planned.sections.${section}.title`)}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t(`modelSheet.planned.sections.${section}.description`)}</p>
        </li>)}
      </ul>
    </section>
    <Sheet open={Boolean(view && reference)} onOpenChange={(open) => { if (!open) { revert(); openReference() } }}>
      <SheetContent className="model-sheet-detail overflow-y-auto p-5 sm:p-8" closeLabel={t('common.close')} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
        {view && reference && <>
          <SheetTitle>{draft.name} · {label(view)}</SheetTitle>
          <SheetDescription>{t(calibratable ? 'modelSheet.calibrateHelp' : 'modelSheet.moreHelp')}</SheetDescription>
          <div className="model-sheet-calibration" style={{ aspectRatio: `${reference.asset.inspection.width} / ${reference.asset.inspection.height}`, width: `min(100%, ${55 * reference.asset.inspection.width / reference.asset.inspection.height}svh)` }}>
            <BlobImage blob={reference.asset.blob} alt={label(view)} className="size-full object-contain" />
            {calibratable && (['head', 'feet'] as const).map((line) => <div key={line} className={`model-sheet-guide is-${line}`} style={{ top: `${guides[line] * 100}%` }}><span>{t(`modelSheet.${line}`)}</span></div>)}
          </div>
          <form className="grid gap-4" onSubmit={(event) => {
            event.preventDefault()
            commit((current) => {
              if (current.activeAppearanceId !== draft.activeAppearanceId || modelSheetReferences(characterModelSheet(current))[view]?.asset.inspection.sha256 !== reference.asset.inspection.sha256) throw new Error('Reference changed; reopen it before saving')
              return updateCharacterModelSheet(current, setModelSheetReference(characterModelSheet(current), view, { ...reference, ...(calibratable ? { guides } : {}) }))
            })
          }}>
            {calibratable && (['head', 'feet'] as const).map((line) => <label key={line} className="grid grid-cols-[4rem_1fr_3rem] items-center gap-3">
              <span>{t(`modelSheet.${line}`)}</span><input type="range" min={line === 'head' ? 0 : Math.round(guides.head * 100) + 1} max={line === 'head' ? Math.round(guides.feet * 100) - 1 : 100} step="1" value={Math.round(guides[line] * 100)} onChange={(event) => change({ guides: { ...guides, [line]: Number(event.currentTarget.value) / 100 } })} />
              <output className="text-right tabular-nums">{Math.round(guides[line] * 100)}%</output>
            </label>)}
            {(['label', 'viewpoint', 'pose'] as const).map((field) => <label key={field} className="grid gap-1">{t(`modelSheet.${field}`)}<input className="min-w-0 rounded border p-2" maxLength={80} value={reference[field] ?? ''} onChange={(event) => change({ [field]: event.currentTarget.value || undefined })} /></label>)}
            <label className="grid gap-2"><span>{t('modelSheet.notes')}</span><textarea rows={3} maxLength={1000} value={reference.notes ?? ''} onChange={(event) => change({ notes: event.currentTarget.value })} className="rounded-lg border bg-background p-3" /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={reference.needsReview ?? false} onChange={(event) => change({ needsReview: event.currentTarget.checked })} />{t('modelSheet.needsReview')}</label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="model-sheet-replace">{t('modelSheet.replace')}{fileInput(view)}</label>
              <Button type="submit" disabled={busy}>{t('modelSheet.saveReference')}</Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <DataControls exportData={async () => reference.asset.blob} exportFilename={reference.asset.filename} exportIconOnly exportLabel={t('modelSheet.download')} />
              <Button type="button" variant="ghost" disabled={busy} onClick={() => { commit((current) => {
                if (current.activeAppearanceId !== draft.activeAppearanceId || modelSheetReferences(characterModelSheet(current))[view]?.asset.inspection.sha256 !== reference.asset.inspection.sha256) throw new Error('Reference changed; reopen it before removing')
                return updateCharacterModelSheet(current, setModelSheetReference(characterModelSheet(current), view))
              }); openReference() }}>{t('modelSheet.remove')}</Button>
            </div>
            {error && <p role="alert" className="text-destructive">{error}</p>}
            {saveFeedback}
          </form>
        </>}
      </SheetContent>
    </Sheet>
  </section>
}
