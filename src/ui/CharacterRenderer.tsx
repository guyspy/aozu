import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CHARACTER_RIG, type CharacterAssetInspection } from '@/core/domain/character'
import type { CharacterRenderView, mountCharacterRenderer } from '@/adapters/browser/pixi-character-renderer'
import { renderCharacterAssetThumbnail } from '@/adapters/browser/character-image'
import { useBlobUrl } from '@/ui/useBlobUrl'
import { cn } from '@/ui/lib/utils'

type Bounds = NonNullable<CharacterAssetInspection['visibleBounds']>
type Status = 'loading' | 'ready' | 'failed'

export function RenderStatus({ failed = false, retry }: { failed?: boolean; retry?: () => void }) {
  const { t } = useTranslation()
  return <span className="absolute inset-0 grid place-content-center text-muted-foreground" role={failed ? 'alert' : 'status'}>
    {failed ? retry
      ? <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={retry} aria-label={t('characterDraft.status.retry')} title={t('characterDraft.status.retry')}><CircleAlertIcon className="mx-auto size-5" /></button>
      : <CircleAlertIcon className="mx-auto size-5" />
      : <LoaderCircleIcon className="mx-auto size-5 animate-spin" />}
    <span className="sr-only">{t(failed ? 'startup.error' : 'startup.loading')}</span>
  </span>
}

export function CharacterRenderer({ label, className, candidateBounds, referenceBounds, footLine, ...view }: CharacterRenderView & {
  label: string
  className?: string
  candidateBounds?: Bounds
  referenceBounds?: Bounds
  footLine?: number
}) {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<Awaited<ReturnType<typeof mountCharacterRenderer>>>(undefined)
  const latest = useRef(view)
  const [status, setStatus] = useState<Status>('loading')
  const [attempt, setAttempt] = useState(0)
  const [drawn, setDrawn] = useState<CharacterRenderView>()
  const sources = (value: CharacterRenderView) => [
    ...(value.atlas ? [value.atlas.image] : value.layers.map(({ blob }) => blob)),
    ...(value.mode && value.mode !== 'composite' ? value.referenceLayers?.map(({ blob }) => blob) ?? [] : []),
  ]
  const desired = sources(view)
  const previous = drawn ? sources(drawn) : []
  const ready = status === 'ready' && drawn?.atlas === view.atlas && desired.length === previous.length && desired.every((blob, i) => blob === previous[i])

  useEffect(() => {
    let disposed = false
    void (async () => {
      const { mountCharacterRenderer } = await import('@/adapters/browser/pixi-character-renderer')
      if (disposed || !host.current) return
      const mounted = await mountCharacterRenderer(host.current)
      if (disposed) return mounted.destroy()
      controller.current = mounted
      const next = latest.current
      if (await mounted.update(next) && !disposed) { setDrawn(next); setStatus('ready') }
    })().catch((error) => {
      console.error('Character render failed', error)
      if (!disposed) setStatus('failed')
    })
    return () => { disposed = true; controller.current?.destroy(); controller.current = undefined }
  }, [attempt])

  useLayoutEffect(() => {
    latest.current = view
    let active = true
    void controller.current?.update(view).then((rendered) => {
      if (active && rendered) { setDrawn(view); setStatus('ready') }
    }).catch((error) => {
      console.error('Character update failed', error)
      if (active) setStatus('failed')
    })
    return () => { active = false }
  // Depend on the inputs, not the rest object or readiness state.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [view.layers, view.referenceLayers, view.mode, view.atlas])

  return <div className={cn('relative aspect-2/3 w-full overflow-hidden rounded-3xl border bg-muted/40', className)} role="img" aria-label={label}>
    {!view.layers.length && <div className="character-empty-placeholder absolute inset-0 p-8"><img src="/assets/placeholders/companion-body-faint.webp" alt="" /></div>}
    {view.layers.length > 0 && !ready && <RenderStatus failed={status === 'failed'} retry={() => { setStatus('loading'); setAttempt((value) => value + 1) }} />}
    <div ref={host} aria-hidden="true" className="absolute inset-0" style={{ visibility: ready ? 'visible' : 'hidden' }} />
    {view.mode === 'diagnostic' && <>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-foreground/30" />
      {footLine !== undefined && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/30" style={{ top: `${footLine / CHARACTER_RIG.canvas.height * 100}%` }} />}
      <BoundsBox bounds={referenceBounds} className="border-cyan-500" />
      <BoundsBox bounds={candidateBounds} className="border-fuchsia-500" />
    </>}
  </div>
}

const BoundsBox = ({ bounds, className }: { bounds?: Bounds; className: string }) => bounds && <span
  aria-hidden="true"
  className={cn('pointer-events-none absolute border', className)}
  style={{
    left: `${bounds.x / CHARACTER_RIG.canvas.width * 100}%`,
    top: `${bounds.y / CHARACTER_RIG.canvas.height * 100}%`,
    width: `${bounds.width / CHARACTER_RIG.canvas.width * 100}%`,
    height: `${bounds.height / CHARACTER_RIG.canvas.height * 100}%`,
  }}
/>

export function CharacterSlotPlaceholder({ src, label }: { src: string; label?: string }) {
  return <div
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    className="character-slot-placeholder size-full"
    style={{
      WebkitMaskImage: `url("${src}")`,
      maskImage: `url("${src}")`,
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      WebkitMaskSize: 'contain',
      maskSize: 'contain',
    }}
  />
}

export function CharacterAssetThumbnail({ blob, bounds, label = '' }: { blob: Blob; bounds?: CharacterAssetInspection['visibleBounds']; label?: string }) {
  const [result, setResult] = useState<{ source: Blob; thumbnail?: Blob; failed?: boolean }>()
  const [visible, setVisible] = useState(false)
  const host = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setVisible(true); observer.disconnect() } })
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    void renderCharacterAssetThumbnail(blob, bounds, controller.signal).then(
      (thumbnail) => { if (!controller.signal.aborted) setResult({ source: blob, thumbnail }) },
      () => { if (!controller.signal.aborted) setResult({ source: blob, failed: true }) },
    )
    return () => controller.abort()
  }, [blob, bounds, visible])
  const current = result?.source === blob ? result : undefined
  const src = useBlobUrl(current?.thumbnail)
  return <span ref={host} className="relative flex size-full items-center justify-center overflow-hidden">
    {src ? <img src={src} alt={label} className="max-h-full max-w-full object-contain" /> : <RenderStatus failed={current?.failed} />}
  </span>
}
