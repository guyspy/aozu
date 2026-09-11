import { Workspace, WorkspaceToolbar } from '@/ui/Workspace'
import { Input } from '@/ui/components/ui/input'
import { ArrowLeftIcon, CircleSlash2Icon, CopyIcon, Layers2Icon, LoaderCircleIcon, MoveHorizontalIcon, MoveVerticalIcon, PanelRightOpenIcon, PencilIcon, PlusIcon, Redo2Icon, ScalingIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useStore } from 'zustand'

import { CHARACTER_CREATION_GROUPS, REQUIRED_CHARACTER_TARGETS, activateCharacterVariant, characterDraftAtlasKey, characterRegistrationFrame, clearCharacterVariantSelection, deactivateCharacterVariant, isCharacterDraftAssetCurrent, resolveCharacterDraftLayers, resolveCharacterDraftReferenceLayers, setCharacterVariantTransform, transformCharacterBounds, updateCharacterProfile } from '@/core/application/character-creation.ts'
import type { CharacterFitSuggestion } from '@/core/application/character-alignment.ts'
import type { CharacterEditor } from '@/core/application/character-editor.ts'
import { IDENTITY_CHARACTER_TRANSFORM, type CharacterAssetTarget, type CharacterDraft, type CharacterDraftVariant, type CharacterVariantGroup, type CharacterVariantLayer, type CharacterVariantTransform, type CharacterReferenceMetadata } from '@/core/domain/character.ts'
import { CharacterModelSheet } from '@/ui/CharacterModelSheet'
import { activeCharacterAppearance } from '@/core/application/character-appearances'
import { CharacterViewport } from '@/ui/CharacterViewport'
import { CharacterAppearances } from '@/ui/CharacterAppearances'
import type { CharacterAppearanceCommand } from '@/core/application/character-appearances'
import { AozuIcon, type AozuIconName } from '@/ui/AozuIcon'
import { CharacterAssetThumbnail, CharacterRenderer, CharacterSlotPlaceholder } from '@/ui/CharacterRenderer'
import { Button } from '@/ui/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/ui/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { DataControls } from '@/ui/DataControls'
import { StatusPage } from '@/ui/pages/StatusPage'

type CharacterCategoryId = 'expressions' | 'outfits' | 'props'
type CharacterCategory = { id: CharacterCategoryId; group: CharacterVariantGroup; icon: AozuIconName }

const characterCategories: CharacterCategory[] = [
  { id: 'expressions', group: 'expression', icon: 'expressions' },
  { id: 'outfits', group: 'outfit', icon: 'outfits' },
  { id: 'props', group: 'prop', icon: 'props' },
]
const categoryForGroup = (group: CharacterVariantGroup) => characterCategories.find((category) => category.group === group)!.id
const expressionIcons = ['happy', 'sad', 'angry', 'surprised', 'sleepy']
const expressionPlaceholder = (variantId: string) => `/assets/expression-placeholders/${expressionIcons.includes(variantId) ? variantId : 'happy'}.webp`
// Expressions have portrait art; outfits and props reuse their category icon; the base body keeps its silhouette mask.
const CharacterVariantPlaceholder = ({ group, variantId, label }: { group: CharacterVariantGroup; variantId: string; label?: string }) => group === 'expression'
  ? <img className="expression-placeholder" src={expressionPlaceholder(variantId)} alt={label ?? ''} />
  : group === 'body'
    ? <CharacterSlotPlaceholder src="/assets/character-slots/body-base.webp" label={label} />
    : <AozuIcon name={group === 'prop' ? 'props' : 'outfits'} className="is-placeholder" />
const variantKey = ({ group, id }: Pick<CharacterDraftVariant, 'group' | 'id'>) => `${group}:${id}`
const describe = (error: unknown) => error instanceof Error ? error.message : String(error)
const sameTransform = (left: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM, right: CharacterVariantTransform) =>
  left.x === right.x && left.y === right.y && left.scale === right.scale
const withVariant = (source: CharacterDraft, target: Pick<CharacterDraftVariant, 'group' | 'id'>, patch: Partial<CharacterDraftVariant>): CharacterDraft => ({
  ...source,
  variants: source.variants.map((variant) => variant.group === target.group && variant.id === target.id ? { ...variant, ...patch } : variant),
})
const fitNumber = (value: number | null) => value === null ? '—' : `${Math.round(value * 10_000) / 10_000}`
const fitMetrics = (t: (key: string) => string, suggestion: Extract<CharacterFitSuggestion, { status: 'suggested' }>) => [
  ...(['iou', 'footLine', 'match'] as const).flatMap((field) => {
    const key = field === 'iou' ? 'iou' : field === 'footLine' ? 'footLineDelta' : 'score'
    const before = suggestion.before[key]
    const after = suggestion.after[key]
    return before === null || after === null ? [] : [`${t(`characterDraft.transform.${field}`)} ${fitNumber(before)} → ${fitNumber(after)}`]
  }),
  `x ${suggestion.transform.x} · y ${suggestion.transform.y} · ×${suggestion.transform.scale}`,
]

const isTextEntry = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

type ProfileAttributeForm = { key: string; type: 'string' | 'number' | 'boolean'; value: string }
type ProfileForm = { heightCm: string; name: string; description: string; backstory: string; attributes: ProfileAttributeForm[] }
const profileFormFor = (draft: CharacterDraft): ProfileForm => ({
  heightCm: draft.modelSheet?.heightCm?.toString() ?? '',
  name: draft.name,
  description: draft.description ?? '',
  backstory: draft.backstory ?? '',
  attributes: Object.entries(draft.attributes ?? {}).map(([key, value]) => ({ key, type: typeof value as ProfileAttributeForm['type'], value: String(value) })),
})

export function CharacterDraftPage({ webmcpReady = false, editor, savedRevision, autoFitVariant, fitSuggestion, exportCharacter, exportCharacterPng, collectionControl, replaceAsset, replaceReference, changeAppearance, saveAs, deleteCharacter }: {
  webmcpReady?: boolean
  editor: CharacterEditor
  savedRevision?: number
  autoFitVariant(group: CharacterVariantGroup, variantId: string): Promise<void>
  fitSuggestion(group: CharacterVariantGroup, variantId: string): Promise<CharacterFitSuggestion>
  collectionControl?: ReactNode
  exportCharacter(): Promise<Blob>
  exportCharacterPng(draft: CharacterDraft, preview?: Pick<CharacterDraftVariant, 'group' | 'id'>): Promise<Blob>
  replaceAsset(target: CharacterAssetTarget, blob: Blob): Promise<unknown>
  replaceReference(referenceId: string, blob?: Blob, metadata?: CharacterReferenceMetadata): Promise<unknown>
  changeAppearance(command: CharacterAppearanceCommand, revision: number): Promise<unknown>
  saveAs(): Promise<CharacterDraft>
  deleteCharacter(): Promise<void>
}) {
  const { t } = useTranslation()
  const [copiedPrompt, setCopiedPrompt] = useState('')
  const [startOpen, setStartOpen] = useState(true)
  const navigate = useNavigate()
  const { characterId, step, variantId } = useParams()
  const isModelSheet = step === 'model-sheet'
  const isProfile = step === 'profile'
  const activeMode = isModelSheet ? 'model-sheet' : isProfile ? 'profile' : 'expressions'
  const category = isModelSheet || isProfile ? characterCategories[0] : characterCategories.find(({ id }) => id === step)
  const activeCharacterId = useStore(editor.store, (state) => state.activeCharacterId)
  const character = useStore(editor.store, (state) => state.character)
  const saveStatus = useStore(editor.store, (state) => state.saveStatus)
  const persistedRevision = useStore(editor.store, (state) => state.persistedRevision)
  const saveError = useStore(editor.store, (state) => state.saveError)
  const canUndo = useStore(editor.history, (state) => state.pastStates.length > 0) && saveStatus === 'saved'
  const canRedo = useStore(editor.history, (state) => state.futureStates.length > 0) && saveStatus === 'saved'
  const [loadError, setLoadError] = useState<{ characterId: string; message: string }>()
  // In-progress text, numeric, or drag edits render locally until one commit; keyed to the committed value they started from.
  const [local, setLocal] = useState<{ base: CharacterDraft; value: CharacterDraft }>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [fit, setFit] = useState<{ key: string; value: CharacterFitSuggestion }>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 899px)').matches)
  const [workbenchOpen, setWorkbenchOpen] = useState(narrow && isProfile)
  const panelContext = `${characterId}:${activeMode}:${narrow}`
  const [previousPanelContext, setPreviousPanelContext] = useState(panelContext)
  if (panelContext !== previousPanelContext) {
    setPreviousPanelContext(panelContext)
    setWorkbenchOpen(narrow && isProfile)
  }
  const [profileForm, setProfileForm] = useState<ProfileForm>()
  const [alignmentMode, setAlignmentMode] = useState<'composite' | 'overlay' | 'difference' | 'diagnostic'>('overlay')
  const drag = useRef<{
    group: CharacterVariantGroup
    variantId: string
    pointerId: number
    startX: number
    startY: number
    width: number
    height: number
    origin: CharacterVariantTransform
    current: CharacterVariantTransform
  } | undefined>(undefined)
  const refreshingRevision = useRef<number | undefined>(undefined)
  const newSession = useRef(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 899px)')
    const update = () => { setNarrow(media.matches) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let live = true
    editor.open(characterId ?? '').then(() => { if (live) newSession.current = characterId === 'new' }).catch((caught: unknown) => { if (live) setLoadError({ characterId: characterId ?? '', message: describe(caught) }) })
    return () => { live = false }
  }, [editor, characterId])
  useEffect(() => {
    if (newSession.current && characterId === 'new' && activeCharacterId && activeCharacterId !== 'new') {
      navigate(`/characters/${encodeURIComponent(activeCharacterId)}/${step ?? 'expressions'}${variantId ? `/${encodeURIComponent(variantId)}` : ''}`, { replace: true })
    }
  }, [activeCharacterId, characterId, navigate, step, variantId])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isProfile || !(event.metaKey || event.ctrlKey) || isTextEntry(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z') { event.preventDefault(); void (event.shiftKey ? editor.redo() : editor.undo()) }
      else if (key === 'y' && event.ctrlKey) { event.preventDefault(); void editor.redo() }
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (editor.store.getState().saveStatus !== 'saved') event.preventDefault() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('beforeunload', onBeforeUnload) }
  }, [editor, isProfile])

  const committed = activeCharacterId === characterId ? character ?? undefined : undefined
  const draft = local && local.base === committed ? local.value : committed
  const externalRevision = persistedRevision !== null && savedRevision !== undefined && savedRevision > persistedRevision ? savedRevision : undefined
  useEffect(() => {
    if (activeCharacterId !== characterId || !externalRevision || saveStatus !== 'saved' || local || profileForm || refreshingRevision.current === externalRevision) return
    refreshingRevision.current = externalRevision
    void editor.reload()
      .catch((caught) => setError(describe(caught)))
      .finally(() => { if (refreshingRevision.current === externalRevision) refreshingRevision.current = undefined })
  }, [activeCharacterId, characterId, editor, externalRevision, local, profileForm, saveStatus])
  const assetKey = useMemo(() => committed ? characterDraftAtlasKey(committed) : undefined, [committed])
  const fitGroup = !isModelSheet && (category?.group === 'expression' || category?.group === 'outfit') ? category.group : undefined
  const fitKey = committed && assetKey && variantId && fitGroup ? `${fitGroup}:${variantId}:${assetKey}` : undefined
  useEffect(() => {
    if (!fitKey || !fitGroup || !variantId) return
    let active = true
    void fitSuggestion(fitGroup, variantId)
      .then((value) => { if (active) setFit({ key: fitKey, value }) })
      .catch(() => { if (active) setFit({ key: fitKey, value: { status: 'unavailable' } }) })
    return () => { active = false }
  }, [fitKey, fitGroup, variantId, fitSuggestion])
  const suggestion = fit && fitKey && fit.key === fitKey ? fit.value : undefined

  if (!step || step === 'identity' || step === 'accessories') return <Navigate to={`/characters/${encodeURIComponent(characterId ?? '')}/expressions`} replace />
  if (!category) return <Navigate to={`/characters/${encodeURIComponent(characterId ?? '')}/expressions`} replace />
  if (loadError && loadError.characterId === characterId) return <StatusPage>
    {loadError.message}
    {activeCharacterId && activeCharacterId !== characterId && <><br /><Button variant="link" onClick={() => navigate(`/characters/${encodeURIComponent(activeCharacterId)}/expressions`)}>{t('characterDraft.backToActive', { name: character?.name })}</Button></>}
  </StatusPage>
  if (!draft) return <StatusPage>{t('startup.loading')}</StatusPage>
  const exportName = draft.name.trim() || 'character'

  const edit = (value: CharacterDraft) => { if (committed) setLocal({ base: committed, value }) }
  const revert = () => setLocal(undefined)
  const commit = (produce: (current: CharacterDraft) => CharacterDraft) => {
    setError(undefined)
    setLocal(undefined)
    try { void editor.dispatch(produce) } catch (caught) { setError(describe(caught)) }
  }
  const textKeys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') revert()
  }

  const baseVariant = draft.variants.find(({ group, id }) => group === 'body' && id === 'base')
  const hasBase = Boolean(baseVariant && isCharacterDraftAssetCurrent(draft, baseVariant, 'body'))
  const visibleVariants = category ? draft.variants.filter(({ group }) => category.group === group) : []
  const selectedVariant = visibleVariants.find((variant) => variant.id === variantId)
  if (!isModelSheet && variantId && !selectedVariant) return <Navigate to={`/characters/${encodeURIComponent(draft.id)}/${category.id}`} replace />
  const previewLayers = resolveCharacterDraftLayers(draft, selectedVariant)
  const referenceLayers = selectedVariant ? resolveCharacterDraftReferenceLayers(draft, selectedVariant) : []
  const registration = characterRegistrationFrame(draft)
  const selectedPrimaryLayer = selectedVariant && (selectedVariant.group === 'prop' ? selectedVariant.layers.front ? 'front' : 'back' : CHARACTER_CREATION_GROUPS.find(({ group }) => group === selectedVariant.group)!.layers[0])
  const selectedAsset = selectedVariant && selectedPrimaryLayer ? selectedVariant.layers[selectedPrimaryLayer] : undefined
  const referenceBounds = selectedVariant?.group === 'expression' ? registration.head?.bounds
    : selectedVariant?.group === 'outfit' ? registration.bodyBounds : undefined
  const selectedTransform = selectedVariant?.transform ?? IDENTITY_CHARACTER_TRANSFORM
  const candidateBounds = selectedAsset?.inspection.visibleBounds ? transformCharacterBounds(selectedAsset.inspection.visibleBounds, selectedTransform) : undefined
  const draggable = selectedVariant?.group === 'expression' && Boolean(selectedAsset)
  const commitTransform = (target: Pick<CharacterDraftVariant, 'group' | 'id'>, transform: CharacterVariantTransform) => commit((current) => {
    const variant = current.variants.find((candidate) => candidate.group === target.group && candidate.id === target.id)
    return !variant || sameTransform(variant.transform, transform) ? current : setCharacterVariantTransform(current, target.group, target.id, transform)
  })
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable || !selectedVariant) return
    const bounds = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      group: selectedVariant.group,
      variantId: selectedVariant.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
      origin: selectedTransform,
      current: selectedTransform,
    }
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId || !committed) return
    const next = {
      ...active.origin,
      x: Math.max(-512, Math.min(512, Math.round(active.origin.x + (event.clientX - active.startX) / active.width * 512))),
      y: Math.max(-768, Math.min(768, Math.round(active.origin.y + (event.clientY - active.startY) / active.height * 768))),
    }
    active.current = next
    edit(withVariant(committed, { group: active.group, id: active.variantId }, { transform: next }))
  }
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    drag.current = undefined
    event.currentTarget.releasePointerCapture(event.pointerId)
    commitTransform({ group: active.group, id: active.variantId }, active.current)
  }
  const selectedId = (group: CharacterVariantGroup) => {
    if (group === 'body') return undefined
    if (group === 'expression') return draft.selected.expression
    if (group === 'outfit') return draft.selected.outfit
    return undefined
  }
  const selectVariant = (variant: CharacterDraftVariant) => commit((current) => activateCharacterVariant(current, variant))
  const clearVariant = (group: CharacterVariantGroup) => commit((current) => clearCharacterVariantSelection(current, group))
  const isSelected = (variant: CharacterDraftVariant) => variant.group === 'prop' ? draft.selected.props.includes(variant.id) : selectedId(variant.group) === variant.id
  const toggleVariant = (variant: CharacterDraftVariant) => {
    if (variant.group !== 'prop' || !isSelected(variant)) return selectVariant(variant)
    commit((current) => deactivateCharacterVariant(current, variant))
  }
  const hasSelection = (group: CharacterVariantGroup) => group === 'prop' ? Boolean(draft.selected.props.length) : Boolean(selectedId(group))
  const addVariant = (group: CharacterVariantGroup) => {
    const count = draft.variants.filter((variant) => variant.group === group).length + 1
    const variant: CharacterDraftVariant = {
      group,
      id: `${group}-${crypto.randomUUID().slice(0, 8)}`,
      label: `${t(`characterDraft.groups.${group}.variantName`)} ${count}`,
      layers: {},
    }
    commit((current) => ({ ...current, variants: [...current.variants, variant] }))
    navigate(`/characters/${encodeURIComponent(draft.id)}/${categoryForGroup(group)}/${encodeURIComponent(variant.id)}`)
  }
  const fileInput = (variant: CharacterDraftVariant, layer: CharacterVariantLayer) => {
    const targetKey = `${variantKey(variant)}:${layer}`
    return <input className="sr-only" type="file" accept="image/png" disabled={Boolean(busy)} onChange={async (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        setBusy(targetKey); setError(undefined)
        try {
          await replaceAsset({ group: variant.group, variantId: variant.id, label: variant.label, layer }, file)
        } catch (caught) {
          setError(describe(caught))
        } finally {
          setBusy(undefined); event.target.value = ''
        }
      }} />
  }
  const runBusy = async (key: string, task: () => Promise<unknown>) => {
    setBusy(key); setError(undefined)
    try { await task() } catch (caught) { setError(describe(caught)) } finally { setBusy(undefined) }
  }
  const iconAction = (label: string, icon: ComponentType<{ className?: string }>, enabled: boolean, run: () => void) => {
    const Icon = icon
    return <Tooltip><TooltipTrigger asChild><Button type="button" size="icon" variant="ghost" aria-label={label} disabled={!enabled} onClick={run}><Icon /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
  }

  const saveProfile = () => {
    if (!profileForm) return
    const rows = profileForm.attributes.filter(({ key }) => key.trim())
    const keys = rows.map(({ key }) => key.trim())
    if (new Set(keys).size !== keys.length) { setError('Character attribute names must be unique'); return }
    const attributes = Object.fromEntries(rows.map(({ key, type, value }) => [
      key.trim(),
      type === 'number' ? value.trim() ? Number(value) : Number.NaN : type === 'boolean' ? value === 'true' : value,
    ]))
    const patch = { heightCm: profileForm.heightCm.trim() ? Number(profileForm.heightCm) : null, name: profileForm.name, description: profileForm.description, backstory: profileForm.backstory, attributes }
    try { updateCharacterProfile(draft, patch) }
    catch (caught) { setError(describe(caught)); return }
    commit((current) => updateCharacterProfile(current, patch))
    setProfileForm(undefined)
  }

  const saveFeedback = <span role="status" title={saveError} className={`ml-1 text-xs ${saveStatus === 'failed' || saveStatus === 'conflict' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {t(persistedRevision === 0 && saveStatus === 'saved' ? 'books.unsaved' : `characterDraft.status.${externalRevision ? 'conflict' : saveStatus}`)}
              {externalRevision && <> · <button type="button" className="underline" onClick={() => { setLocal(undefined); setProfileForm(undefined); void runBusy('reload', () => editor.reload()) }}>{t('characterDraft.status.reload')}</button></>}
              {saveStatus === 'failed' && <> · <button type="button" className="underline" onClick={() => void editor.retry()}>{t('characterDraft.status.retry')}</button></>}
              {!externalRevision && saveStatus === 'conflict' && <> · <button type="button" className="underline" onClick={() => void runBusy('reload', () => editor.reload())}>{t('characterDraft.status.reload')}</button> / <button type="button" className="underline" onClick={() => void runBusy('save-as', saveAs)}>{t('characterDraft.saveAs')}</button></>}
            </span>

  const characterActions = <div className="character-actions flex shrink-0 items-center gap-1" role="group" aria-label={t('characterDraft.characterActions')}>
    <TooltipProvider>
      {collectionControl}
      <Tooltip><TooltipTrigger asChild><Button size="icon" variant="outline" aria-label={busy === 'save-as' ? t('characterDraft.savingAs') : t('characterDraft.saveAs')} disabled={Boolean(busy) || !draft.name.trim()} onClick={() => void runBusy('save-as', saveAs)}>{busy === 'save-as' ? <LoaderCircleIcon className="animate-spin" /> : <CopyIcon />}</Button></TooltipTrigger><TooltipContent>{t('characterDraft.saveAs')}</TooltipContent></Tooltip>
      <DataControls exportData={exportCharacter} exportFilename={`${exportName}.zip`} exportIconOnly exportLabel={t('characterDraft.downloadZip')} />
      <Tooltip><TooltipTrigger asChild><Button size="icon" variant="outline" aria-label={t('characters.delete')} disabled={Boolean(busy)} onClick={() => setDeleteOpen(true)}><Trash2Icon /></Button></TooltipTrigger><TooltipContent>{t('characters.delete')}</TooltipContent></Tooltip>
    </TooltipProvider>
  </div>

  const workbench = <section className="doll-workbench rounded-2xl border bg-background" aria-label={t('characterDraft.customizeTitle')}>
        <div className="workbench-lockable">
        <div className="workbench-body" inert={!hasBase ? true : undefined} aria-hidden={!hasBase}>
        <SheetTitle className="sr-only">{t('characterDraft.customizeTitle')}</SheetTitle>
        <Tabs value={category.id} onValueChange={(id) => navigate(`/characters/${encodeURIComponent(draft.id)}/${id}`)} className="min-h-0 flex-1 gap-0">
        {!selectedVariant && <TabsList aria-label={t('characterDraft.categorySwitcher')} className="workbench-tabs grid w-full grid-cols-3">
          {characterCategories.map(({ id, icon }) => <TabsTrigger key={id} value={id} className="min-w-0">
            <AozuIcon name={icon} />
            <span>{t(`characterDraft.categories.${id}`)}</span>
          </TabsTrigger>)}
        </TabsList>}

        <TabsContent value={category.id} className="workbench-content min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!selectedVariant && <>
          <div className="variant-grid">
            <button type="button" aria-label={t('characterDraft.none')} title={t('characterDraft.none')} aria-pressed={!hasSelection(category.group)} className={`variant-card ${!hasSelection(category.group) ? 'is-selected' : ''}`} onClick={() => clearVariant(category.group)}>
              <span className="variant-preview"><CircleSlash2Icon className="size-1/3 text-muted-foreground" /></span><span className="variant-label">{t('characterDraft.none')}</span>
            </button>
            {visibleVariants.map((variant) => {
              const group = CHARACTER_CREATION_GROUPS.find(({ group }) => group === variant.group)!
              const thumbnailLayer = variant.layers.front && isCharacterDraftAssetCurrent(draft, variant, 'front')
                ? 'front'
                : group.layers.find((layer) => isCharacterDraftAssetCurrent(draft, variant, layer))
              const thumbnail = thumbnailLayer ? variant.layers[thumbnailLayer] : undefined
              const selected = isSelected(variant)
              return <div key={variantKey(variant)} className={`variant-card ${selected ? 'is-selected' : ''}`}>
                <button type="button" aria-label={variant.label} title={variant.label} aria-pressed={selected} className="block w-full" onClick={() => toggleVariant(variant)}>
                  <span className={`variant-preview ${variant.group === 'expression' ? 'is-expression' : ''}`}>{thumbnail
                    ? <CharacterAssetThumbnail blob={thumbnail.blob} bounds={thumbnail.inspection.visibleBounds} label={variant.label} />
                    : <CharacterVariantPlaceholder group={variant.group} variantId={variant.id} label={variant.label} />}</span><span className="variant-label">{variant.label}</span>
                </button>
                <Button type="button" variant="outline" size="icon" title={t('characterDraft.editVariant', { name: variant.label })} className="variant-edit" aria-label={t('characterDraft.editVariant', { name: variant.label })} onClick={() => navigate(`/characters/${encodeURIComponent(draft.id)}/${category.id}/${encodeURIComponent(variant.id)}`)}><PencilIcon /></Button>
              </div>
            })}
            <button type="button" title={t(`characterDraft.groups.${category.group}.add`)} className="variant-card add-variant" aria-label={t(`characterDraft.groups.${category.group}.add`)} onClick={() => addVariant(category.group)}>
              <span className="variant-preview"><PlusIcon className="size-6" /></span><span className="variant-label">{t(`characterDraft.groups.${category.group}.add`)}</span>
            </button>
          </div>
        </>}

        {selectedVariant && (() => {
          const group = CHARACTER_CREATION_GROUPS.find(({ group }) => group === selectedVariant.group)!
          const layeredAccessory = selectedVariant.group === 'prop'
          const primaryLayer = layeredAccessory ? 'front' : group.layers[0]
          const primaryAsset = isCharacterDraftAssetCurrent(draft, selectedVariant, primaryLayer) ? selectedVariant.layers[primaryLayer] : undefined
          const behindAsset = layeredAccessory && isCharacterDraftAssetCurrent(draft, selectedVariant, 'back') ? selectedVariant.layers.back : undefined
          const required = REQUIRED_CHARACTER_TARGETS.some((target) => target.group === selectedVariant.group && target.variantId === selectedVariant.id)
          const transform = selectedVariant.transform ?? IDENTITY_CHARACTER_TRANSFORM
          const changeTransform = (field: keyof CharacterVariantTransform, value: number) => {
            if (!Number.isFinite(value)) return
            edit(withVariant(draft, selectedVariant, { transform: { ...transform, [field]: value } }))
          }
          return <>
            <div className="variant-editor-heading">
              <Button type="button" size="icon" variant="ghost" aria-label={t('characterDraft.backToVariants')} onClick={() => navigate(`/characters/${encodeURIComponent(draft.id)}/${category.id}`)}><ArrowLeftIcon /></Button>
              <input
                aria-label={t('characterDraft.variantLabel')}
                className="min-w-0"
                value={selectedVariant.label}
                onChange={(event) => edit(withVariant(draft, selectedVariant, { label: event.target.value }))}
                onBlur={(event) => {
                  const label = event.currentTarget.value.trim()
                  commit((current) => {
                  const variant = current.variants.find((candidate) => candidate.group === selectedVariant.group && candidate.id === selectedVariant.id)
                  return !variant || !label || variant.label === label ? current : withVariant(current, variant, { label })
                  })
                }}
                onKeyDown={textKeys}
              />
              {required && <span className="required-status">{t('characterDraft.required')}</span>}
            </div>
            {(primaryAsset || behindAsset) && <TooltipProvider><div className="transform-grid" aria-label={t('characterDraft.transform.label')}>
              {([['x', MoveHorizontalIcon], ['y', MoveVerticalIcon], ['scale', ScalingIcon]] as const).map(([field, Icon]) => <Tooltip key={field}><TooltipTrigger asChild><label className="relative min-w-0 text-muted-foreground">
                <Icon className="pointer-events-none mx-auto mb-1 size-4 sm:absolute sm:left-2 sm:top-1/2 sm:mb-0 sm:-translate-y-1/2" aria-hidden="true" />
                <span className="sr-only">{t(`characterDraft.transform.${field}`)}</span>
                <input
                  type="number"
                  step={field === 'scale' ? 0.01 : 1}
                  min={field === 'scale' ? 0.25 : field === 'x' ? -512 : -768}
                  max={field === 'scale' ? 4 : field === 'x' ? 512 : 768}
                  aria-label={t(`characterDraft.transform.${field}`)}
                  className="w-full min-w-0 rounded-md border bg-background px-1 text-center text-foreground sm:pl-7"
                  value={transform[field]}
                  onChange={(event) => changeTransform(field, Number(event.target.value))}
                  onBlur={(event) => {
                    const value = Number(event.currentTarget.value)
                    if (!Number.isFinite(value)) return revert()
                    commit((current) => {
                      const variant = current.variants.find((candidate) => candidate.group === selectedVariant.group && candidate.id === selectedVariant.id)
                      if (!variant) return current
                      const next = { ...(variant.transform ?? IDENTITY_CHARACTER_TRANSFORM), [field]: value }
                      return sameTransform(variant.transform, next) ? current : setCharacterVariantTransform(current, variant.group, variant.id, next)
                    })
                  }}
                  onKeyDown={textKeys}
                />
              </label></TooltipTrigger><TooltipContent>{t(`characterDraft.transform.${field}`)}</TooltipContent></Tooltip>)}
              {suggestion?.status === 'suggested' && <div className="col-span-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 w-full"
                  disabled={Boolean(busy)}
                  onClick={() => void runBusy('auto-fit', () => autoFitVariant(selectedVariant.group, selectedVariant.id))}
                >{t('characterDraft.transform.applySuggestedFit')}</Button>
                <p className="mt-1 text-[9px] leading-3 text-muted-foreground sm:text-[10px]">
                  {t(`characterDraft.transform.fitSource.${suggestion.source}`)} · {fitMetrics(t, suggestion).join(' · ')}
                </p>
              </div>}
              {suggestion && suggestion.status !== 'suggested' && <p className="col-span-3 text-[9px] leading-3 text-muted-foreground sm:text-[10px]">
                {t(suggestion.status === 'aligned' ? 'characterDraft.transform.fitAligned' : 'characterDraft.transform.fitUnavailable')}
              </p>}
            </div></TooltipProvider>}
            <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="asset-upload-card">
              <span className="asset-upload-preview">{primaryAsset
                ? <CharacterAssetThumbnail blob={primaryAsset.blob} bounds={primaryAsset.inspection.visibleBounds} />
                : <CharacterVariantPlaceholder group={selectedVariant.group} variantId={selectedVariant.id} />}</span>
              <span>{t(layeredAccessory ? 'characterDraft.layers.primary' : `characterDraft.layers.${primaryLayer}`)}</span>
              {fileInput(selectedVariant, primaryLayer)}
            </label>
            {layeredAccessory && <label className="asset-upload-card">
              <span className="asset-upload-preview">{behindAsset
                ? <CharacterAssetThumbnail blob={behindAsset.blob} bounds={behindAsset.inspection.visibleBounds} />
                : <Layers2Icon className="size-8 text-muted-foreground" />}</span>
              <span>{t('characterDraft.layers.behindOptional')}</span>
              {fileInput(selectedVariant, 'back')}
            </label>}
            </div>
          </>
        })()}

        {error && narrow && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        </TabsContent>
        </Tabs>
        </div>
        {!hasBase && <div className="workbench-lock" role="status"><p>{t('characterDraft.missingRequired')}</p></div>}
        </div>
      </section>

  const profile = <section id="character-profile" className="character-profile-panel rounded-2xl border bg-background">
          {narrow && <SheetTitle className="sr-only">{t('characterDraft.profile.title')}</SheetTitle>}
          {error && narrow && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {profileForm ? <>
            <div className="character-profile-heading"><div><span>{t('characterDraft.profile.title')}</span><strong>{draft.name}</strong></div></div>
            <label><span>{t('characterDraft.profile.name')}</span><input maxLength={80} value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} /></label>
            <label><span>{t('characterDraft.profile.description')}</span><textarea maxLength={500} rows={3} value={profileForm.description} onChange={(event) => setProfileForm({ ...profileForm, description: event.target.value })} /></label>
            <label className="min-h-0"><span>{t('characterDraft.profile.backstory')}</span><textarea className="min-h-28 flex-1" maxLength={8000} value={profileForm.backstory} onChange={(event) => setProfileForm({ ...profileForm, backstory: event.target.value })} /></label>
            <div className="character-attributes-editor">
              <div className="character-profile-heading"><span>{t('characterDraft.profile.attributes')}</span><Button type="button" size="sm" variant="ghost" disabled={profileForm.attributes.length >= 32} onClick={() => setProfileForm({ ...profileForm, attributes: [...profileForm.attributes, { key: '', type: 'string', value: '' }] })}><PlusIcon /> {t('characterDraft.profile.add')}</Button></div>
              <label className="grid gap-1"><span>{t('modelSheet.height')}</span><Input aria-label={t('modelSheet.height')} type="number" min="0.1" max="100000" step="0.1" placeholder={t('modelSheet.unknownHeight')} value={profileForm.heightCm} onChange={(event) => setProfileForm({ ...profileForm, heightCm: event.currentTarget.value })} /></label>
              {profileForm.attributes.map((attribute, index) => <div className="character-attribute-row" key={index}>
                <input aria-label={t('characterDraft.profile.attributeName', { index: index + 1 })} placeholder={t('characterDraft.profile.name')} maxLength={40} value={attribute.key} onChange={(event) => setProfileForm({ ...profileForm, attributes: profileForm.attributes.map((row, rowIndex) => rowIndex === index ? { ...row, key: event.target.value } : row) })} />
                <select aria-label={t('characterDraft.profile.attributeType', { index: index + 1 })} value={attribute.type} onChange={(event) => {
                  const type = event.target.value as ProfileAttributeForm['type']
                  setProfileForm({ ...profileForm, attributes: profileForm.attributes.map((row, rowIndex) => rowIndex === index ? { ...row, type, value: type === 'boolean' ? 'true' : type === 'number' ? '0' : row.value } : row) })
                }}><option value="string">{t('characterDraft.profile.text')}</option><option value="number">{t('characterDraft.profile.number')}</option><option value="boolean">{t('characterDraft.profile.boolean')}</option></select>
                {attribute.type === 'boolean' ? <select aria-label={t('characterDraft.profile.attributeValue', { index: index + 1 })} value={attribute.value} onChange={(event) => setProfileForm({ ...profileForm, attributes: profileForm.attributes.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row) })}><option value="true">{t('characterDraft.profile.yes')}</option><option value="false">{t('characterDraft.profile.no')}</option></select> : <input aria-label={t('characterDraft.profile.attributeValue', { index: index + 1 })} type={attribute.type === 'number' ? 'number' : 'text'} maxLength={attribute.type === 'string' ? 200 : undefined} placeholder={t('characterDraft.profile.value')} value={attribute.value} onChange={(event) => setProfileForm({ ...profileForm, attributes: profileForm.attributes.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row) })} />}
                <Button type="button" size="icon" variant="ghost" aria-label={t('characterDraft.profile.removeAttribute', { index: index + 1 })} onClick={() => setProfileForm({ ...profileForm, attributes: profileForm.attributes.filter((_, rowIndex) => rowIndex !== index) })}><Trash2Icon /></Button>
              </div>)}
            </div>
            <div className="mt-auto flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setProfileForm(undefined)}>{t('common.cancel')}</Button><Button type="button" onClick={saveProfile}>{t('characterDraft.profile.update')}</Button></div>
          </> : <>
            <div className="character-profile-heading"><div><span>{t('characterDraft.profile.title')}</span><h2>{draft.name}</h2></div><Button type="button" size="icon" variant="ghost" aria-label={t('characterDraft.profile.edit')} onClick={() => { setError(undefined); setProfileForm(profileFormFor(draft)) }}><PencilIcon /></Button></div>
            <p className="character-profile-description">{draft.description || t('characterDraft.profile.noDescription')}</p>
            <div><h3>{t('characterDraft.profile.backstory')}</h3><p className="character-profile-backstory">{draft.backstory || t('characterDraft.profile.noBackstory')}</p></div>
            <div className="character-profile-attributes"><h3>{t('characterDraft.profile.attributes')}</h3><dl><div><dt>{t('modelSheet.height')}</dt><dd>{draft.modelSheet?.heightCm === undefined ? t('modelSheet.unknownHeight') : `${draft.modelSheet.heightCm} cm`}</dd></div>{Object.entries(draft.attributes ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'boolean' ? value ? t('characterDraft.profile.yes') : t('characterDraft.profile.no') : value}</dd></div>)}</dl></div>
          </>}
        </section>

  const appearanceControls = <CharacterAppearances key={`${draft.id}:${draft.activeAppearanceId ?? ''}`} draft={draft}
    manage={!isModelSheet && !isProfile && !selectedVariant} busy={Boolean(busy) || saveStatus !== 'saved' || Boolean(local || profileForm)}
    change={(command) => void runBusy('appearance', async () => {
      await changeAppearance(command, persistedRevision!)
      revert()
      if (variantId) navigate(`/characters/${encodeURIComponent(draft.id)}/${isModelSheet ? 'model-sheet' : isProfile ? 'profile' : category.id}`)
    })}>
    <div className={`flex gap-1 ${isProfile ? 'invisible' : ''}`} inert={isProfile} aria-hidden={isProfile || undefined}><TooltipProvider>
      {iconAction(t('characterDraft.undo'), Undo2Icon, canUndo && !busy && !local, () => void editor.undo())}
      {iconAction(t('characterDraft.redo'), Redo2Icon, canRedo && !busy && !local, () => void editor.redo())}
    </TooltipProvider></div>
    {saveFeedback}
  </CharacterAppearances>

  return <Sheet open={narrow && workbenchOpen} onOpenChange={setWorkbenchOpen}><div className="draft-workshop-shell">
    <Workspace className="draft-workshop mx-auto flex h-full w-full max-w-6xl flex-col p-[0.85rem] sm:p-6"
      data-workspace-view="character" data-character-id={draft.id} data-character-revision={persistedRevision} data-category={isModelSheet ? 'model-sheet' : isProfile ? 'profile' : category.id}
      data-variant-id={isModelSheet ? variantId : selectedVariant?.id} data-preview-mode={selectedAsset ? alignmentMode : 'composite'}
      data-panel={isProfile ? 'profile' : narrow && workbenchOpen ? 'workbench' : undefined}
      data-has-uncommitted-input={Boolean((local && local.base === committed) || profileForm)}>
      <WorkspaceToolbar className="character-workspace-bar"><nav className="character-workspace-tabs" aria-label={t('modelSheet.mode')}>
        {(['expressions', 'profile', 'model-sheet'] as const).map((mode) => <Button key={mode} type="button" className="character-workspace-tab" variant={mode === activeMode ? 'secondary' : 'ghost'} aria-current={mode === activeMode ? 'page' : undefined}
          onClick={() => { revert(); setProfileForm(undefined); navigate(`/characters/${encodeURIComponent(draft.id)}/${mode}`) }}>{t(mode === 'model-sheet' ? 'modelSheet.title' : mode === 'profile' ? 'characterDraft.profile.title' : 'modelSheet.appearance')}</Button>)}
      </nav>{characterActions}</WorkspaceToolbar>
      {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
      {isModelSheet ? <>
        <CharacterModelSheet draft={draft} edit={edit} commit={commit} revert={revert} busy={Boolean(busy)} error={error} saveFeedback={saveFeedback}
          appearanceSelector={appearanceControls}
          referenceId={variantId} openReference={(id) => { revert(); navigate(`/characters/${encodeURIComponent(draft.id)}/model-sheet${id ? `/${encodeURIComponent(id)}` : ''}`) }}
          upload={(id, file, metadata) => void runBusy('reference', async () => { await replaceReference(id, file, metadata); revert(); navigate(`/characters/${encodeURIComponent(draft.id)}/model-sheet/${encodeURIComponent(id)}`) })} />
      </> :
      <div className="draft-workshop-grid mt-2 min-h-0 flex-1 sm:mt-3">
      <section className="character-stage-panel rounded-2xl border bg-background">
        <div className="character-stage-preview">
        <div className="flex shrink-0 items-start gap-1"><div className="min-w-0 flex-1">{appearanceControls}</div>
          {narrow && <SheetTrigger asChild><Button type="button" size="icon" variant="outline" aria-label={t(isProfile ? 'characterDraft.profile.title' : 'characterDraft.customizeTitle')} title={t(isProfile ? 'characterDraft.profile.title' : 'characterDraft.customizeTitle')}><PanelRightOpenIcon /></Button></SheetTrigger>}
        </div>
        <CharacterViewport key={`${draft.id}:${draft.activeAppearanceId}:${variantId ?? ''}`} enabled={hasBase} editing={draggable}
          download={previewLayers.length > 0 && <DataControls exportData={() => exportCharacterPng(draft, selectedVariant)} exportFilename={`${exportName}_${activeCharacterAppearance(draft)?.label ?? 'Default'}.png`} exportIconOnly exportLabel={t('characterDraft.downloadPng')} />}>
          {baseVariant && !hasBase ? <label
            className="character-stage-upload aspect-2/3 h-full max-h-full max-w-full"
            aria-label={t('characterDraft.missingRequired')}
            title={t('characterDraft.missingRequired')}
          >
            <CharacterRenderer label={draft.name} layers={previewLayers} />
            {fileInput(baseVariant, 'body')}
          </label> : <div
            className={`aspect-2/3 h-full max-h-full max-w-full ${draggable ? 'cursor-move touch-none' : ''}`}
            title={draggable ? t('characterDraft.transform.dragHead') : undefined}
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          ><CharacterRenderer
                label={draft.name}
                layers={previewLayers}
                referenceLayers={referenceLayers}
                mode={selectedVariant && selectedAsset ? alignmentMode : 'composite'}
                candidateBounds={candidateBounds}
                referenceBounds={referenceBounds}
                footLine={registration.footLine}
              /></div>}
        </CharacterViewport>
        {!hasBase && baseVariant && <Dialog open={startOpen} onOpenChange={setStartOpen}><DialogContent className="max-h-[calc(100svh-2rem)] overflow-auto sm:max-w-md" closeLabel={t('common.close')} data-character-start>
          <DialogTitle className="pr-10">{t(webmcpReady ? 'characterDraft.start.title' : 'characterDraft.start.desktopTitle')}</DialogTitle>
          <DialogDescription>{t(webmcpReady ? 'characterDraft.start.agentHelp' : 'characterDraft.start.manualHelp')}</DialogDescription>
          {webmcpReady && <p className="mb-3 max-h-28 overflow-auto select-all text-sm text-muted-foreground">{t('characterDraft.start.agentPrompt')}</p>}
          <div className="flex flex-wrap gap-2">
            {webmcpReady ? <Button type="button" size="sm" disabled={Boolean(busy)} onClick={() => void runBusy('copy-prompt', async () => {
              const prompt = t('characterDraft.start.agentPrompt')
              await navigator.clipboard.writeText(prompt)
              setCopiedPrompt(prompt)
            })}><CopyIcon />{t(copiedPrompt === t('characterDraft.start.agentPrompt') ? 'characterDraft.start.copied' : 'characterDraft.start.copy')}</Button>
              : <Button asChild size="sm"><a href={`https://chatgpt.com/codex/deeplink?url=${encodeURIComponent(window.location.href)}`}>{t('characterDraft.start.chatgpt')}</a></Button>}
            {!webmcpReady && <Button type="button" size="sm" variant="ghost" onClick={() => setStartOpen(false)}>{t('characterDraft.start.continueBrowser')}</Button>}
          </div>
        </DialogContent></Dialog>}
        {selectedVariant && selectedAsset && <div className="alignment-switch" aria-label={t('characterDraft.alignment.label')}>
          {(['composite', 'overlay', 'difference', 'diagnostic'] as const).map((mode) => <Button key={mode} type="button" size="sm" data-alignment-mode={mode} aria-pressed={alignmentMode === mode} variant={alignmentMode === mode ? 'secondary' : 'ghost'} onClick={() => setAlignmentMode(mode)}>{t(`characterDraft.alignment.${mode}`)}</Button>)}
        </div>}
        </div>
      </section>

      {narrow ? <SheetContent className="character-workbench-drawer gap-0 p-0" closeLabel={t('common.close')} aria-describedby={undefined}>
        {isProfile ? profile : workbench}
      </SheetContent> : isProfile ? profile : workbench}
      </div>}
    </Workspace>
    <AlertDialog open={deleteOpen} onOpenChange={(open) => { if (!busy) setDeleteOpen(open) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('characters.deleteTitle')}</AlertDialogTitle><AlertDialogDescription>{t('characters.deleteDescription', { name: draft.name })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={Boolean(busy)}>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={Boolean(busy)} onClick={(event) => {
          event.preventDefault()
          void runBusy('delete', deleteCharacter)
        }}>{t('characters.delete')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div></Sheet>
}
