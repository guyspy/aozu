import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { character3DPreview, type Preview3D } from '@/core/application/character-3d'
import { cn } from '@/ui/lib/utils'

export function GlbViewer({ label, className, controls = true }: { label: string; className?: string; controls?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Loading skinned humanoid…')
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
    }).catch(() => { if (!disposed) setStatus('Could not load the 3D demo. Switch to 2D or reload to retry.') })
    return () => { disposed = true; unsubscribe(); destroy() }
  }, [controls])
  const configure = (patch: Partial<Omit<Preview3D, 'revision'>>) => character3DPreview.configure({ expectedRevision: character3DPreview.getSnapshot().revision, ...patch })
  return (
    <div className={cn('relative flex aspect-2/3 w-full flex-col overflow-hidden rounded-3xl border bg-muted/40', className)} aria-label={`${label}: shared 3D demo`}>
      <div className="relative min-h-40 flex-1">
        <div ref={host} className="absolute inset-0" aria-label="Skinned humanoid preview" />
        {status && <p role="status" className="absolute inset-x-3 top-3 text-sm">{status}</p>}
      </div>
      <div className="space-y-2 border-t bg-background/90 p-3 text-xs">
        <p>Shared 3D demo · clothing deferred</p>
        {controls && <>
          <label className="flex items-center gap-2">Happy
            <input aria-label="Happy expression" className="min-w-0 flex-1" type="range" min="0" max="1" step="0.01" value={state.happy} onChange={e => configure({ happy: Number(e.target.value) })} />
            <output>{Math.round(state.happy * 100)}%</output>
          </label>
          <div className="flex flex-wrap gap-3">
            <label><input type="checkbox" checked={state.prop} onChange={e => configure({ prop: e.target.checked })} /> Hand prop</label>
            <label><input type="checkbox" checked={state.playing} onChange={e => configure({ playing: e.target.checked })} /> Wave</label>
            <label><input type="checkbox" checked={state.skeleton} onChange={e => configure({ skeleton: e.target.checked })} /> Bones</label>
          </div>
        </>}
      </div>
    </div>
  )
}
