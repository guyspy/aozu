import { Workspace } from '@/ui/Workspace'
export function StatusPage({ children }: { children: React.ReactNode }) {
  return <Workspace className="workspace-status">
    <p className="text-center text-sm text-muted-foreground">{children}</p>
  </Workspace>
}
