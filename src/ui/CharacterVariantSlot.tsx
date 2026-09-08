import { PencilIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Shared workshop card for PNG variants and embedded 3D equipment. */
export function CharacterVariantSlot({ label, selected, expression, onToggle, children, edit }: {
  label: string
  selected: boolean
  expression?: boolean
  onToggle(): void
  children: ReactNode
  edit?: { label: string; onClick(): void }
}) {
  return <div className={`variant-card ${selected ? 'is-selected' : ''}`}>
    <button type="button" aria-label={label} title={label} aria-pressed={selected} className="block w-full" onClick={onToggle}>
      <span className={`variant-preview ${expression ? 'is-expression' : ''}`}>{children}</span>
      <span className="variant-label">{label}</span>
    </button>
    {edit && <button type="button" title={edit.label} className="variant-edit" aria-label={edit.label} onClick={edit.onClick}><PencilIcon className="size-4" /></button>}
  </div>
}
