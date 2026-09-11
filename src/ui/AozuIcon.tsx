import type { HTMLAttributes } from 'react'

export type AozuIconName = 'collections' | 'albums' | 'storyboards' | 'archive' | 'book' | 'expressions' | 'import' | 'outfits' | 'profile' | 'props'

export function AozuIcon({ name, className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { name: AozuIconName }) {
  return <span className={`aozu-icon ${className}`.trim()} aria-hidden="true" {...props}>
    <img src={`/assets/aozu-icons/${name}.${['collections', 'albums', 'storyboards'].includes(name) ? 'png' : 'webp'}`} alt="" />
  </span>
}
