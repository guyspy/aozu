import { useEffect, useRef } from 'react'

import { DEFAULT_DEMO_VOX_URL } from '@/ui/render-mode'
import { cn } from '@/ui/lib/utils'

export function VoxViewer({
  label,
  className,
  src = DEFAULT_DEMO_VOX_URL,
  controls = true,
}: {
  label: string
  className?: string
  src?: string
  controls?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let destroy = () => {}
    void (async () => {
      const { mountVoxCharacterViewer } = await import('@/adapters/browser/vox-character-viewer')
      if (disposed || !host.current) return
      const mounted = await mountVoxCharacterViewer(host.current, { src, controls })
      if (disposed) return mounted.destroy()
      destroy = mounted.destroy
    })().catch((error: unknown) => {
      console.error('Voxel character render failed', error)
    })
    return () => {
      disposed = true
      destroy()
    }
  }, [src, controls])

  return (
    <div className={cn('relative aspect-2/3 w-full overflow-hidden rounded-3xl border bg-muted/40', className)} role="img" aria-label={label}>
      <div ref={host} className="absolute inset-0" />
    </div>
  )
}
