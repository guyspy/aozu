import type { ComponentProps } from 'react'
import { AozuIcon, type AozuIconName } from '@/ui/AozuIcon'
import { WorkspaceAddCard, WorkspaceCard } from '@/ui/Workspace'
import { cn } from '@/ui/lib/utils'

export function LibraryBookCard({ icon, className, ...props }: Omit<ComponentProps<typeof WorkspaceCard>, 'children'> & { icon: AozuIconName }) {
  return <WorkspaceCard className={cn('collection-cover', className)} {...props}><AozuIcon name={icon} className="collection-cover-seal" /></WorkspaceCard>
}

export function CollectionBookCard(props: Omit<ComponentProps<typeof LibraryBookCard>, 'icon'>) {
  return <LibraryBookCard icon="collections" {...props} />
}

export function WatermarkAddCard({ icon, ...props }: ComponentProps<typeof WorkspaceAddCard> & { icon: AozuIconName }) {
  return <WorkspaceAddCard watermark={<AozuIcon name={icon} />} {...props} />
}
