import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { HandIcon, MaximizeIcon, MinusIcon, PlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip'

type Point = { x: number; y: number }
const fit = { x: 0, y: 0, scale: 1 }
const zoom = (view: typeof fit, factor: number, from: Point, to = from) => {
  const scale = Math.max(0.5, Math.min(6, view.scale * factor))
  const ratio = scale / view.scale
  return { scale, x: to.x - (from.x - view.x) * ratio, y: to.y - (from.y - view.y) * ratio }
}
const center = (points: Point[]) => ({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length })
const distance = (points: Point[]) => points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0

/** View-only transforms. The renderer, authoring coordinates and PNG export keep their original canvas. */
export function CharacterViewport({ children, download, enabled, editing }: { children: ReactNode; download?: ReactNode; enabled: boolean; editing: boolean }) {
  const { t } = useTranslation()
  const [view, setView] = useState(fit)
  const [pan, setPan] = useState(!editing)
  const stage = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const at = (clientX: number, clientY: number) => {
    const bounds = stage.current!.getBoundingClientRect()
    return { x: clientX - bounds.left - bounds.width / 2, y: clientY - bounds.top - bounds.height / 2 }
  }
  useEffect(() => {
    const element = stage.current!
    const wheel = (event: WheelEvent) => {
      if (!enabled) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      if (event.ctrlKey || event.metaKey) {
        const point = at(event.clientX, event.clientY)
        setView((value) => zoom(value, Math.exp(-event.deltaY * unit / 100), point))
      } else setView((value) => ({ ...value, x: value.x - event.deltaX * unit, y: value.y - event.deltaY * unit }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [enabled])
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div className="character-stage-canvas relative">
    <div ref={stage} className={`absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring ${enabled && pan ? 'touch-none cursor-grab active:cursor-grabbing' : ''}`}
      role="region" aria-label={t('preview.title')} tabIndex={enabled ? 0 : undefined}
      onPointerDownCapture={(event) => {
        if (!enabled || (!pan && event.button !== 1) || (event.button !== 0 && event.button !== 1) || (event.target as HTMLElement).closest('button,input,label')) return
        event.preventDefault(); event.stopPropagation()
        if (pointers.current.size === 2) return
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        pointers.current.set(event.pointerId, at(event.clientX, event.clientY))
      }}
      onPointerMoveCapture={(event) => {
        if (!pointers.current.has(event.pointerId)) return
        event.stopPropagation()
        const before = [...pointers.current.values()]
        pointers.current.set(event.pointerId, at(event.clientX, event.clientY))
        const after = [...pointers.current.values()]
        const span = distance(before)
        setView((value) => zoom(value, span > 0 ? distance(after) / span : 1, center(before), center(after)))
      }}
      onPointerUpCapture={end} onPointerCancelCapture={end} onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (!enabled || event.target !== event.currentTarget) return
        const delta = { ArrowLeft: [-32, 0], ArrowRight: [32, 0], ArrowUp: [0, -32], ArrowDown: [0, 32] }[event.key]
        if (delta) setView((value) => ({ ...value, x: value.x + delta[0], y: value.y + delta[1] }))
        else if (event.key === '+' || event.key === '=') setView((value) => zoom(value, 1.25, { x: 0, y: 0 }))
        else if (event.key === '-') setView((value) => zoom(value, 0.8, { x: 0, y: 0 }))
        else if (event.key === '0') setView(fit)
        else return
        event.preventDefault()
      }}>
      <div className="character-viewport-transform absolute inset-0 flex items-center justify-center" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>{children}</div>
    </div>
    <div className="absolute left-2 top-2 flex flex-col items-center gap-1 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur-sm" role="group" aria-label={t('preview.controls')}>
      <TooltipProvider>{[
        { label: 'pan', icon: HandIcon, pressed: pan, run: () => setPan(!pan), disabled: !enabled },
        { label: 'zoomOut', icon: MinusIcon, run: () => setView((value) => zoom(value, 0.8, { x: 0, y: 0 })), disabled: !enabled || view.scale <= 0.5 },
        { label: 'zoomIn', icon: PlusIcon, run: () => setView((value) => zoom(value, 1.25, { x: 0, y: 0 })), disabled: !enabled || view.scale >= 6 },
        { label: 'fit', icon: MaximizeIcon, run: () => setView(fit), disabled: !enabled },
      ].map(({ label, icon: Icon, pressed, run, disabled }) => <Tooltip key={label}><TooltipTrigger asChild><Button type="button" size="icon" variant={pressed ? 'secondary' : 'outline'} aria-label={t(`preview.${label}`)} aria-pressed={pressed} disabled={disabled} onClick={run}><Icon /></Button></TooltipTrigger><TooltipContent>{t(`preview.${label}`)}</TooltipContent></Tooltip>)}</TooltipProvider>
      {download}
    </div>
  </div>
}
