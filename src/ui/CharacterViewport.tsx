import { CharacterRenderer } from '@/ui/CharacterRenderer'
import { GlbViewer } from '@/ui/GlbViewer'
import { useRenderMode } from '@/ui/render-mode'
import type { CharacterTextureAtlas, CharacterVariantTransform } from '@/core/domain/character'

type Layer = { id: string; blob: Blob; slotOrder: number; layerOrder: number; transform?: CharacterVariantTransform }

export function CharacterViewport({
  label,
  layers,
  atlas,
  className,
  interactive = true,
}: {
  label: string
  layers: Layer[]
  atlas?: CharacterTextureAtlas
  className?: string
  interactive?: boolean
}) {
  const [mode] = useRenderMode()
  if (mode === '3d') return <GlbViewer label={label} className={className} controls={interactive} />
  return <CharacterRenderer label={label} layers={layers} atlas={atlas} className={className} />
}
