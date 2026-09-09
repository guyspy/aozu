import { ChevronDownIcon, ImagePlusIcon } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { updateCharacterModelSheet, characterModelSheet, withCharacterModelSheet, modelSheetReferences, setModelSheetReference, isTurnaroundView } from '@/core/application/character-model-sheet'
import { CHARACTER_REFERENCE_VIEWS, CHARACTER_REFERENCE_KINDS, type CharacterDraft, type CharacterReference, type CharacterReferenceMetadata } from '@/core/domain/character'
import { DataControls } from '@/ui/DataControls'
import { BlobImage } from '@/ui/BlobImage'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { Textarea } from '@/ui/components/ui/textarea'
import { Slider } from '@/ui/components/ui/slider'
import { Checkbox } from '@/ui/components/ui/checkbox'
import { Badge } from '@/ui/components/ui/badge'
import { Card } from '@/ui/components/ui/card'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/ui/components/ui/collapsible'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/ui/components/ui/select'
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
  const fileInput = (id: string) => <Input className="hidden" type="file" accept="image/png" disabled={busy}
    aria-label={t('modelSheet.uploadView', { view: label(id) })}
    onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) upload(id, file) }} />

  const card = (id: string, index: number) => {
    const item = references[id]
    const size = item?.asset.inspection
    return <Card key={id} className={`model-sheet-card${size && size.width > size.height ? ' col-span-2' : ''}`}>
      <h3><span className="text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>{label(id)}</h3>
      {item ? <Button type="button" variant="ghost" className="model-sheet-art h-auto p-0" style={{ aspectRatio: item.asset.inspection.width / item.asset.inspection.height }} aria-label={t('modelSheet.openView', { view: label(id) })} onClick={(event) => { trigger.current = event.currentTarget; revert(); openReference(id) }}>
        <BlobImage blob={item.asset.blob} alt={label(id)} className="size-full object-contain" />
      </Button> : <><Button type="button" variant="ghost" className="model-sheet-art model-sheet-empty h-auto p-0" disabled={busy} aria-label={t('modelSheet.uploadView', { view: label(id) })} onClick={(event) => event.currentTarget.parentElement?.querySelector('input')?.click()}><ImagePlusIcon className="size-6" /><span>{t('modelSheet.add')}</span></Button>{fileInput(id)}</>}
      {item?.notes && <p className="line-clamp-2 wrap-anywhere text-sm text-muted-foreground">{item.notes}</p>}
    </Card>
  }

  return <section className="model-sheet mt-2 min-h-0 flex-1 overflow-hidden rounded-2xl border bg-background sm:mt-3" aria-label={t('modelSheet.title')} data-reference-view={view}>
    <div className="model-sheet-toolbar draft-workshop-grid shrink-0">
      <div className="min-w-0">{appearanceSelector}</div>
    </div>
    <div className="model-sheet-content mt-3 min-h-0 flex-1 overflow-auto">
    <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="font-heading text-xl font-semibold">{t('modelSheet.fullBody')}</h2>
      <p className="text-sm text-muted-foreground">{t('modelSheet.count', { count: Object.keys(sheet.views).length })}</p>
    </div>
    <div className="model-sheet-grid">{CHARACTER_REFERENCE_VIEWS.map(card)}</div>
    <section className="mt-12" aria-labelledby="model-sheet-more-title">
      <h2 id="model-sheet-more-title" className="mb-6 font-heading text-xl font-semibold">{t('modelSheet.planned.title')}</h2>
      <div className="model-sheet-grid">{Object.keys(sheet.references ?? {}).map((id, index) => card(id, CHARACTER_REFERENCE_VIEWS.length + index))}</div>
      <Collapsible className="my-8">
        <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="w-full justify-between">{t('modelSheet.add')}<ChevronDownIcon /></Button></CollapsibleTrigger>
        <CollapsibleContent>
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
          <Label className="grid gap-1">{t('modelSheet.label')}<Input name="label" required maxLength={80} /></Label>
          <Label className="grid gap-1">{t('modelSheet.kind')}<Select name="kind" defaultValue="structure"><SelectTrigger className="w-full" aria-label={t('modelSheet.kind')}><SelectValue /></SelectTrigger><SelectContent>{CHARACTER_REFERENCE_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{t(`modelSheet.kinds.${kind}`)}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1">{t('modelSheet.viewpoint')}<Input name="viewpoint" maxLength={80} /></Label>
          <Label className="grid gap-1">{t('modelSheet.pose')}<Input name="pose" maxLength={80} /></Label>
          <Input className="min-w-0 max-w-full" type="file" name="file" accept="image/png" required aria-label={t('modelSheet.add')} />
          <Button type="submit" disabled={busy}>{t('modelSheet.add')}</Button>
        </form>
      </CollapsibleContent>
      </Collapsible>
      <div className="mt-6 flex flex-wrap items-center gap-3"><Badge variant="outline">{t('modelSheet.planned.status')}</Badge></div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {(['landmarks', 'lineup'] as const).map((section) => <li key={section}><Card className="h-full gap-1 bg-transparent p-0 ring-0">
          <h3 className="font-semibold">{t(`modelSheet.planned.sections.${section}.title`)}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t(`modelSheet.planned.sections.${section}.description`)}</p>
        </Card></li>)}
      </ul>
    </section>
    </div>
    <Sheet open={Boolean(view && reference)} onOpenChange={(open) => { if (!open) { revert(); openReference() } }}>
      <SheetContent className="model-sheet-detail overflow-y-auto p-5 sm:p-8" closeLabel={t('common.close')} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
        {view && reference && <>
          <SheetTitle>{draft.name} · {label(view)}</SheetTitle>
          {reference.kind && <p className="model-sheet-state">{t(`modelSheet.kinds.${reference.kind}`)}</p>}
          <SheetDescription>{t(calibratable ? 'modelSheet.calibrateHelp' : 'modelSheet.moreHelp')}</SheetDescription>
          <p className="text-sm text-muted-foreground">{t('modelSheet.brief')}</p>
          <p className="text-xs text-muted-foreground">{t('modelSheet.scaleNote')}</p>
          {calibratable && <p className="model-sheet-state">{t(reference.guides ? 'modelSheet.calibrated' : 'modelSheet.uncalibrated')}</p>}
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
            {calibratable && (['head', 'feet'] as const).map((line) => <Label key={line} className="grid grid-cols-[4rem_1fr_3rem] items-center gap-3">
              <span>{t(`modelSheet.${line}`)}</span><Slider aria-label={t(`modelSheet.${line}`)} min={line === 'head' ? 0 : Math.round(guides.head * 100) + 1} max={line === 'head' ? Math.round(guides.feet * 100) - 1 : 100} step={1} value={[Math.round(guides[line] * 100)]} onValueChange={([value]) => change({ guides: { ...guides, [line]: value / 100 } })} />
              <output className="text-right tabular-nums">{Math.round(guides[line] * 100)}%</output>
            </Label>)}
            {(['label', 'viewpoint', 'pose'] as const).map((field) => <Label key={field} className="grid gap-1">{t(`modelSheet.${field}`)}<Input maxLength={80} value={reference[field] ?? ''} onChange={(event) => change({ [field]: event.currentTarget.value || undefined })} /></Label>)}
            <Label className="grid gap-2"><span>{t('modelSheet.notes')}</span><Textarea rows={3} maxLength={1000} value={reference.notes ?? ''} onChange={(event) => change({ notes: event.currentTarget.value })} /></Label>
            <Label className="flex items-center gap-2"><Checkbox checked={reference.needsReview ?? false} onCheckedChange={(checked) => change({ needsReview: checked === true })} />{t('modelSheet.needsReview')}</Label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative"><Button type="button" variant="outline" disabled={busy} onClick={(event) => event.currentTarget.parentElement?.querySelector('input')?.click()}>{t('modelSheet.replace')}</Button>{fileInput(view)}</div>
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
