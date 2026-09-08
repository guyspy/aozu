import { type CSSProperties } from 'react'

import { useBlobUrl } from '@/ui/useBlobUrl'

export function BlobImage({ blob, alt = '', className, style }: { blob: Blob; alt?: string; className: string; style?: CSSProperties }) {
  const src = useBlobUrl(blob)

  return src ? <img src={src} alt={alt} className={className} style={style} /> : null
}
