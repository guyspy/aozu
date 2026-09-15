import './workspace.css'
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react'
import { ChevronsUpDownIcon, PanelRightOpenIcon, PlusIcon, Redo2Icon, Undo2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { Link } from 'react-router'
import { cn } from '@/ui/lib/utils'

/** Minimum content width for a usable preview and 22rem inspector. */
const SPLIT_MIN_WIDTH = 852

export function Workspace({ header, className, children, ...props }: ComponentProps<'main'> & { header?: ReactNode }) {
  return <main className={cn('workspace-panel', className)} {...props}>
    {header}
    <div className="workspace-body">{children}</div>
  </main>
}
/** A full-column sheet inside a workspace. `paper` renders it as artwork on a desk rather than app chrome. */
export function WorkspaceSurface({ surface, className, ...props }: ComponentProps<'section'> & { surface?: 'paper' }) {
  return <section data-workspace-surface={surface} className={cn('workspace-surface', className)} {...props} />
}
export function WorkspaceToolbar({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('workspace-toolbar', className)} {...props} />
}
export function WorkspaceScroll({ surface, className, ...props }: ComponentProps<'div'> & { surface?: 'paper' }) {
  return <div tabIndex={0} data-workspace-surface={surface} className={cn('workspace-scroll', className)} {...props} />
}
export function WorkspaceAdd({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('workspace-add', className)} {...props} />
}

/** Same document surface in a Radix portal; content alone scrolls. */
export function WorkspaceSheet({ children, title, surface, className, ...props }: Omit<ComponentProps<typeof SheetContent>, 'title'> & { title: ReactNode; surface?: 'paper' }) {
  return <SheetContent className={cn('workspace-sheet', className)} {...props}>
    <SheetTitle className="workspace-sheet-title">{title}</SheetTitle>
    <WorkspaceScroll surface={surface}>{children}</WorkspaceScroll>
  </SheetContent>
}

/**
 * One tile in a grid: a preview of a fixed shape, its name, and optional secondary text or a corner control.
 * Pass the grid's own card class for that grid's frame; `to` makes the tile a link, `onClick` a button.
 */
export function WorkspaceCard({ label, meta, action, aspect = '1', to, onClick, role, className, children, ...props }: Omit<ComponentProps<'button'>, 'children'> & {
  label: ReactNode
  meta?: ReactNode
  action?: ReactNode
  aspect?: string
  to?: string
  children: ReactNode
}) {
  const body = <>
    <span className="workspace-card-preview" style={{ aspectRatio: aspect }}>{children}</span>
    <span className="workspace-card-label">{label}</span>
    {meta !== undefined && <span className="workspace-card-meta">{meta}</span>}
  </>
  return <div role={role} className={cn('workspace-card', className)}>
    {to ? <Link to={to} className="workspace-card-open" aria-label={props['aria-label']} title={props.title}>{body}</Link>
      : onClick ? <button type="button" className="workspace-card-open" onClick={onClick} {...props}>{body}</button>
      : <span className="workspace-card-open" {...props}>{body}</span>}
    {action}
  </div>
}

/** The "add one" tile that closes a grid; the same card with a plus where the preview would be. */
export function WorkspaceAddCard({ label, className, watermark, ...props }: Omit<ComponentProps<'button'>, 'children'> & { label: string; aspect?: string; watermark?: ReactNode }) {
  return <WorkspaceCard aria-label={label} title={label} label={label} className={cn('workspace-add-card', className)} {...props}>
    {watermark && <span className="workspace-add-watermark">{watermark}</span>}
    <PlusIcon className="size-8" />
  </WorkspaceCard>
}

/** The icon actions that belong to a whole document; sits beside its tabs. */
export function WorkspaceActions({ className, ...props }: ComponentProps<'div'>) {
  return <div role="group" className={cn('workspace-actions flex shrink-0 items-center gap-1', className)} {...props} />
}

export function WorkspaceMenuSelect({ label, value, disabled, triggerRef, children }: {
  label: string
  value: ReactNode
  disabled?: boolean
  triggerRef?: Ref<HTMLButtonElement>
  children: ReactNode
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button ref={triggerRef} type="button" variant="outline" className="min-w-0 flex-1 basis-36 justify-between" aria-label={label} disabled={disabled}>
      <span className="truncate">{value}</span><ChevronsUpDownIcon className="text-muted-foreground" />
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-56 max-w-[calc(100vw-2rem)]">{children}</DropdownMenuContent>
  </DropdownMenu>
}

/** The same local history controls below a document's tabs. */
export function WorkspaceHistoryActions({ undoLabel, redoLabel, canUndo, canRedo, onUndo, onRedo, hidden }: {
  undoLabel: string
  redoLabel: string
  canUndo: boolean
  canRedo: boolean
  onUndo(): void
  onRedo(): void
  hidden?: boolean
}) {
  const action = (label: string, enabled: boolean, run: () => void, icon: ReactNode) => <Tooltip><TooltipTrigger asChild>
    <Button type="button" size="icon" variant="ghost" aria-label={label} disabled={!enabled} onClick={run}>{icon}</Button>
  </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
  return <div className={cn('flex gap-1', hidden && 'invisible')} inert={hidden || undefined} aria-hidden={hidden || undefined}><TooltipProvider>
    {action(undoLabel, canUndo, onUndo, <Undo2Icon />)}
    {action(redoLabel, canRedo, onRedo, <Redo2Icon />)}
  </TooltipProvider></div>
}

/** Document tabs along the panel's top edge; children become the actions that belong to the whole document. */
export function WorkspaceTabs<Id extends string>({ label, items, active, onSelect, className, children }: {
  label: string
  items: readonly { id: Id; label: string }[]
  active: Id
  onSelect(id: Id): void
  className?: string
  children?: ReactNode
}) {
  return <div className={cn('workspace-tabs-bar', className)}>
    <nav className="workspace-tabs" aria-label={label}>
      {items.map(({ id, label: text }) => <Button key={id} type="button" className="workspace-tab"
        variant={id === active ? 'secondary' : 'ghost'} aria-current={id === active ? 'page' : undefined}
        onClick={() => onSelect(id)}>{text}</Button>)}
    </nav>
    {children}
  </div>
}

/**
 * Two columns whose stacking follows the split's own width, so a workspace stays correct inside any shell.
 * Stacked, the aside moves into a drawer and the split renders its trigger; `aside` receives that state.
 */
export function WorkspaceSplit({ aside, asideLabel, defaultAsideOpen = false, openKey, className, children, ...props }: Omit<ComponentProps<'div'>, 'children'> & {
  aside?: ReactNode | ((stacked: boolean) => ReactNode)
  asideLabel?: string
  defaultAsideOpen?: boolean
  /** Reopening state resets to `defaultAsideOpen` whenever this changes, for example on a different document or tab. */
  openKey?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const split = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)
  const [open, setOpen] = useState(defaultAsideOpen)
  const [seen, setSeen] = useState(`${openKey}:${stacked}`)
  if (`${openKey}:${stacked}` !== seen) {
    setSeen(`${openKey}:${stacked}`)
    setOpen(defaultAsideOpen)
  }
  useLayoutEffect(() => {
    const element = split.current
    if (!element) return
    // Measured before paint so the first frame already picks the right column count.
    setStacked(element.clientWidth < SPLIT_MIN_WIDTH)
    const observer = new ResizeObserver(([entry]) => setStacked(entry.contentRect.width < SPLIT_MIN_WIDTH))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const content = typeof aside === 'function' ? aside(stacked) : aside

  return <Sheet open={Boolean(aside) && stacked && open} onOpenChange={setOpen}>
    <div ref={split} data-split={!aside ? 'single' : stacked ? 'stacked' : 'wide'} data-aside={!stacked ? 'inline' : open ? 'drawer-open' : 'drawer-closed'}
      className={cn('workspace-split', className)} {...props}>
      {aside && stacked && <SheetTrigger asChild><Button type="button" size="icon" variant="outline" className="workspace-split-trigger"
        aria-label={asideLabel} title={asideLabel}><PanelRightOpenIcon /></Button></SheetTrigger>}
      <div className="workspace-main">{children}</div>
      {aside && (stacked
        ? <SheetContent className="workspace-aside-drawer" closeLabel={t('common.close')} aria-describedby={undefined}>
          <SheetTitle className="sr-only">{asideLabel}</SheetTitle>
          {content}
        </SheetContent>
        : content)}
    </div>
  </Sheet>
}
