import { useEffect, useState } from 'react'
import type { WorldLibraryService } from '@/core/application/world-library'
import { useBlobUrl } from '@/ui/useBlobUrl'
import { RenderStatus } from '@/ui/CharacterRenderer'
export function WorldPicture({ service, hash, alt }: { service: WorldLibraryService; hash?: string; alt: string }) {
  const [result, setResult] = useState<{ hash: string; blob?: Blob; failed?: boolean }>()
  useEffect(() => { let live = true; if (hash) void service.image(hash).then((blob) => { if (live) setResult({ hash, blob }) }, () => { if (live) setResult({ hash, failed: true }) }); return () => { live = false } }, [hash, service])
  const current = result?.hash === hash ? result : undefined, url = useBlobUrl(current?.blob)
  return <div className="world-picture">{url ? <img src={url} alt={alt} loading="lazy" /> : hash ? <RenderStatus failed={current?.failed} /> : <span aria-hidden="true">◇</span>}</div>
}
