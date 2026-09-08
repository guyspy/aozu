import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CHARACTER_RIG, IDENTITY_CHARACTER_TRANSFORM, type CharacterAssetInspection, type CharacterTextureAtlas, type CharacterVariantTransform } from '@/core/domain/character'
import { CrossfadeBlobImage } from '@/ui/BlobImage'
import { cn } from '@/ui/lib/utils'

type Layer = { id: string; blob: Blob; slotOrder: number; layerOrder: number; transform?: CharacterVariantTransform }
type Bounds = NonNullable<CharacterAssetInspection['visibleBounds']>

const layerStyle = (layer: Layer, style?: CSSProperties): CSSProperties => {
  const transform = layer.transform ?? IDENTITY_CHARACTER_TRANSFORM
  return {
    zIndex: layer.slotOrder * 100 + layer.layerOrder,
    left: `${transform.x / CHARACTER_RIG.canvas.width * 100}%`,
    top: `${transform.y / CHARACTER_RIG.canvas.height * 100}%`,
    transform: `scale(${transform.scale})`,
    transformOrigin: 'top left',
    ...style,
  }
}

const Layers = ({ layers, style }: { layers: Layer[]; style?: CSSProperties }) => layers.map((layer) => <CrossfadeBlobImage
  key={`${layer.slotOrder}:${layer.layerOrder}`}
  blob={layer.blob}
  className="absolute size-full object-contain"
  style={layerStyle(layer, style)}
/>)

function RenderStatus({ failed = false }: { failed?: boolean }) {
  const { t } = useTranslation()
  return <span className="absolute inset-0 grid place-content-center text-muted-foreground" role={failed ? 'alert' : 'status'}>
    {failed ? <CircleAlertIcon className="mx-auto size-5" /> : <LoaderCircleIcon className="mx-auto size-5 animate-spin" />}
    <span className="sr-only">{t(failed ? 'startup.error' : 'startup.loading')}</span>
  </span>
}

/** Publish readiness only after Pixi has drawn; loading never paints the raw layers first. */
function AtlasLayers({ atlas, layers, onStatus }: { atlas: CharacterTextureAtlas; layers: Layer[]; onStatus(status: 'loading' | 'ready' | 'failed'): void }) {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<{ update(atlas: CharacterTextureAtlas, frameIds: readonly string[]): Promise<boolean>; destroy(): void }>(undefined)
  const latest = useRef({ atlas, frameIds: layers.map(({ id }) => id) })
  const frameIds = layers.map(({ id }) => id).join('\n')

  useEffect(() => {
    let disposed = false
    void (async () => {
      const { mountCharacterTextureAtlas } = await import('@/adapters/browser/pixi-character-atlas')
      if (disposed || !host.current) return
      const mounted = await mountCharacterTextureAtlas(host.current)
      if (disposed) return mounted.destroy()
      controller.current = mounted
      const rendered = await mounted.update(latest.current.atlas, latest.current.frameIds)
      if (disposed) return
      if (rendered) onStatus('ready')
    })().catch((error) => {
      console.error('Character atlas render failed', error)
      if (!disposed) onStatus('failed')
    })
    return () => {
      disposed = true
      controller.current?.destroy()
      controller.current = undefined
      onStatus('loading')
    }
  // onStatus is a stable setState from the parent.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let active = true
    latest.current = { atlas, frameIds: frameIds.split('\n') }
    void controller.current?.update(atlas, frameIds.split('\n')).then((rendered) => { if (active && rendered) onStatus('ready') }).catch((error) => {
      console.error('Character atlas update failed', error)
      if (active) onStatus('failed')
    })
    return () => { active = false }
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas, frameIds])

  return <div ref={host} aria-hidden="true" className="absolute inset-0" />
}

export function CharacterRenderer({ label, layers, atlas, loading = false, className }: { label: string; layers: Layer[]; atlas?: CharacterTextureAtlas; loading?: boolean; className?: string }) {
  const [canvasStatus, setCanvasStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const useCanvas = Boolean(atlas) && layers.length > 0
  return (
    <div className={cn('relative aspect-2/3 w-full overflow-hidden rounded-3xl border bg-muted/40', className)} role="img" aria-label={label}>
      {!layers.length && <div className="character-empty-placeholder absolute inset-0 p-8"><img src="/assets/placeholders/companion-body-faint.webp" alt="" /></div>}
      {layers.length > 0 && (loading || useCanvas
        ? (loading || canvasStatus !== 'ready') && <RenderStatus failed={!loading && canvasStatus === 'failed'} />
        : <Layers layers={layers} />)}
      {useCanvas && <AtlasLayers atlas={atlas!} layers={layers} onStatus={setCanvasStatus} />}
    </div>
  )
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

export function CharacterAlignmentRenderer({
  label,
  candidateLayers,
  referenceLayers,
  mode,
  candidateBounds,
  referenceBounds,
  footLine,
}: {
  label: string
  candidateLayers: Layer[]
  referenceLayers: Layer[]
  mode: 'composite' | 'overlay' | 'difference' | 'diagnostic'
  candidateBounds?: Bounds
  referenceBounds?: Bounds
  footLine?: number
}) {
  if (mode === 'composite') return <CharacterRenderer label={label} layers={candidateLayers} />
  const diagnostic = mode === 'diagnostic'
  const difference = mode === 'difference'
  return <div className="relative aspect-2/3 w-full overflow-hidden rounded-3xl border bg-muted/40" role="img" aria-label={label}>
    <Layers layers={referenceLayers} style={diagnostic
      ? { opacity: 0.65, filter: 'brightness(0) saturate(100%) invert(75%) sepia(94%) saturate(1454%) hue-rotate(128deg) brightness(103%) contrast(103%)', mixBlendMode: 'screen' }
      : { opacity: difference ? 1 : 0.45 }} />
    <Layers layers={candidateLayers} style={diagnostic
      ? { opacity: 0.65, filter: 'brightness(0) saturate(100%) invert(23%) sepia(97%) saturate(7478%) hue-rotate(312deg) brightness(111%) contrast(111%)', mixBlendMode: 'screen' }
      : { opacity: difference ? 1 : 0.65, ...(difference ? { mixBlendMode: 'difference' } : {}) }} />
    {diagnostic && <>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-foreground/30" />
      {footLine !== undefined && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/30" style={{ top: `${footLine / CHARACTER_RIG.canvas.height * 100}%` }} />}
      <BoundsBox bounds={referenceBounds} className="border-cyan-500" />
      <BoundsBox bounds={candidateBounds} className="border-fuchsia-500" />
    </>}
  </div>
}

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

export function CharacterAtlasFrameImage({ atlas, src, frameId, label = '' }: {
  atlas?: CharacterTextureAtlas
  src?: string
  frameId: string
  label?: string
}) {
  const [loaded, setLoaded] = useState<{ src: string; failed?: boolean }>()
  const frame = atlas?.data.frames[frameId]?.frame
  const ready = Boolean(frame && src && loaded?.src === src && !loaded.failed)
  const failed = Boolean((atlas && !frame) || (src && loaded?.src === src && loaded.failed))
  return <span className="relative flex size-full items-center justify-center overflow-hidden">
    {!ready && <RenderStatus failed={failed} />}
    {atlas && frame && src && <span className="relative block max-h-full max-w-full overflow-hidden" style={{ aspectRatio: `${frame.w}/${frame.h}`, ...(frame.w >= frame.h ? { width: '100%' } : { height: '100%' }) }}>
      <img
        src={src}
        alt={label}
        className="absolute max-w-none"
        onLoad={() => setLoaded({ src })}
        onError={() => setLoaded({ src, failed: true })}
        style={{
          visibility: ready ? 'visible' : 'hidden',
          width: `${atlas.data.meta.size.w / frame.w * 100}%`,
          height: `${atlas.data.meta.size.h / frame.h * 100}%`,
          maxHeight: 'none',
          left: `${-frame.x / frame.w * 100}%`,
          top: `${-frame.y / frame.h * 100}%`,
        }}
      />
    </span>}
  </span>
}
