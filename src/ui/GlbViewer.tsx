import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CHARACTER_3D_CLIPS, CHARACTER_3D_EXPRESSIONS, CHARACTER_3D_WEAPONS, character3DPreview, type Preview3DPatch } from '@/core/application/character-3d'
import { cn } from '@/ui/lib/utils'

export function GlbViewer({ label, className, controls = true }: { label: string; className?: string; controls?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Loading Viking warrior…')
  const state = useSyncExternalStore(character3DPreview.subscribe, character3DPreview.getSnapshot, character3DPreview.getSnapshot)
  useEffect(() => {
    let disposed = false
    let destroy = () => {}
    let unsubscribe = () => {}
    void import('@/adapters/browser/glb-character-viewer').then(async ({ mountGlbCharacterViewer }) => {
      if (disposed || !host.current) return
      const viewer = mountGlbCharacterViewer(host.current, character3DPreview.getSnapshot(), controls)
      destroy = viewer.destroy
      unsubscribe = character3DPreview.subscribe(() => viewer.setState(character3DPreview.getSnapshot()))
      await viewer.ready
      if (!disposed) setStatus('')
    }).catch(() => { if (!disposed) setStatus('Could not load the Viking demo. Reload to retry.') })
    return () => { disposed = true; unsubscribe(); destroy() }
  }, [controls])
  const configure = (patch: Preview3DPatch) => character3DPreview.configure({ expectedRevision: character3DPreview.getSnapshot().revision, ...patch })
  const selectClass = 'min-w-0 rounded-md border bg-background px-2 py-1 capitalize'
  return (
    <div className={cn('relative flex aspect-2/3 w-full flex-col overflow-hidden rounded-3xl border bg-muted/40', className)} aria-label={`${label}: shared Viking 3D demo`}>
      <div className="relative min-h-56 flex-1">
        <div ref={host} className="absolute inset-0" aria-label="Skinned Viking warrior preview" />
        {status && <p role="status" className="absolute inset-x-3 top-3 text-sm text-white">{status}</p>}
      </div>
      <div className="max-h-[55%] space-y-2 overflow-y-auto border-t bg-background/95 p-3 text-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-1"><strong>Viking warrior</strong><span className="text-muted-foreground">Shared demo · CC0 art</span></div>
        {controls && <>
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-36 flex-1 items-center gap-2">Clip
              <select aria-label="Animation clip" className={`${selectClass} flex-1`} value={state.clipName} onChange={e => configure({ clipName: e.target.value as typeof state.clipName })}>
                {CHARACTER_3D_CLIPS.map(name => <option key={name} value={name}>{name.replace('-', ' ')}</option>)}
              </select>
            </label>
            <button className="rounded-md border px-2 py-1" aria-label={state.playing ? 'Pause animation' : 'Play animation'} onClick={() => configure({ playing: !state.playing })}>{state.playing ? 'Pause' : 'Play'}</button>
            <button className="rounded-md border px-2 py-1" onClick={() => configure({ seek: 0, playing: true })}>Restart</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-40 flex-1 items-center gap-2">Weapon
              <select aria-label="Weapon" className={`${selectClass} flex-1`} value={state.weapon} onChange={e => configure({ weapon: e.target.value as typeof state.weapon })}>
                {CHARACTER_3D_WEAPONS.map(name => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label className="flex min-w-40 flex-1 items-center gap-2">Face
              <select aria-label="Expression" className={`${selectClass} flex-1`} value={state.expression} onChange={e => configure({ expression: e.target.value as typeof state.expression })}>
                {CHARACTER_3D_EXPRESSIONS.map(name => <option key={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label><input type="checkbox" checked={state.armor} onChange={e => configure({ armor: e.target.checked })} /> Armor</label>
            <label><input type="checkbox" checked={state.helmet} onChange={e => configure({ helmet: e.target.checked })} /> Helmet</label>
            <label><input type="checkbox" checked={state.loop} onChange={e => configure({ loop: e.target.checked })} /> Loop</label>
            <label><input type="checkbox" checked={state.skeleton} onChange={e => configure({ skeleton: e.target.checked })} /> Bones</label>
          </div>
          <p className="text-muted-foreground">{state.weapon === 'none' ? 'Open hand' : 'Weapon grip'} · Drag to orbit, scroll to zoom</p>
          <details>
            <summary className="cursor-pointer">Pose & playback</summary>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2">Speed
                <input aria-label="Animation speed" className="min-w-0 flex-1" type="range" min="0" max="3" step="0.1" value={state.timeScale} onChange={e => configure({ timeScale: Number(e.target.value) })} /><output>{state.timeScale.toFixed(1)}×</output>
              </label>
              <label className="flex items-center gap-2">Crossfade
                <input aria-label="Crossfade seconds" className="min-w-0 flex-1" type="range" min="0" max="2" step="0.05" value={state.crossfade} onChange={e => configure({ crossfade: Number(e.target.value) })} /><output>{state.crossfade.toFixed(2)}s</output>
              </label>
              <label className="flex items-center gap-2">Set pose
                <input aria-label="Pose within clip" className="min-w-0 flex-1" type="range" min="0" max="1" step="0.01" value={state.seek} onChange={e => configure({ seek: Number(e.target.value), playing: false })} /><output>{Math.round(state.seek * 100)}%</output>
              </label>
              <label className="flex items-center gap-2">Expression
                <input aria-label="Expression strength" className="min-w-0 flex-1" type="range" min="0" max="1" step="0.01" value={state.expressionWeight} onChange={e => configure({ expressionWeight: Number(e.target.value) })} /><output>{Math.round(state.expressionWeight * 100)}%</output>
              </label>
              <p className="text-muted-foreground">Set pose pauses at that point in the clip. Once holds the final pose; Restart plays again.</p>
            </div>
          </details>
        </>}
      </div>
    </div>
  )
}
