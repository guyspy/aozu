import type { ComponentProps } from 'react'
import { cn } from '@/ui/lib/utils'

export function Workspace({ className, ...props }: ComponentProps<'main'>) {
  return <main className={cn('workspace-panel', className)} {...props} />
}
export function WorkspaceToolbar({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('workspace-toolbar', className)} {...props} />
}
export function WorkspaceScroll({ className, ...props }: ComponentProps<'div'>) {
  return <div tabIndex={0} className={cn('workspace-scroll', className)} {...props} />
}
export function WorkspaceAdd({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('workspace-add', className)} {...props} />
}
