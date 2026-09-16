import { FolderInputIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorldLibraryService } from '@/core/application/world-library'
import type { WorldLibrary } from '@/core/domain/world-library'
import { WorkspaceSheet } from '@/ui/Workspace'
import { LibraryBookCard } from '@/ui/LibraryCards'
import { Button } from '@/ui/components/ui/button'
import { Sheet } from '@/ui/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip'

export function StoryboardBookMove({ service, library, boardId, disabled }: { service: WorldLibraryService; library: WorldLibrary; boardId: string; disabled?: boolean }) {
  const { t } = useTranslation(), text = (key: string) => t(`world.${key}`)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const selected = library.boardBooks[boardId]
  const choose = async (bookId?: string) => {
    setBusy(true); setError('')
    try { await service.update({ resource: 'storyboard-book', action: 'move', boardId, bookId }, library.revision); setOpen(false) }
    catch (caught) { setError(String(caught)) }
    finally { setBusy(false) }
  }
  return <>
    <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" size="icon" variant="outline" aria-label={text('moveToStoryBook')} disabled={disabled} onClick={() => setOpen(true)}><FolderInputIcon /></Button></TooltipTrigger><TooltipContent>{text('moveToStoryBook')}</TooltipContent></Tooltip></TooltipProvider>
    <Sheet open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}><WorkspaceSheet title={text('moveToStoryBook')} aria-describedby={undefined}>
      <div className="collection-move-grid mt-6">
        <LibraryBookCard icon="storyboards" label={text('unfiled')} disabled={busy || !selected} onClick={() => void choose()} />
        {library.storyBooks.map((book) => <LibraryBookCard key={book.id} icon="storyboards" label={book.name} disabled={busy || selected === book.id} onClick={() => void choose(book.id)} />)}
      </div>
      {error && <p role="alert" className="mt-4 text-destructive">{error}</p>}
    </WorkspaceSheet></Sheet>
  </>
}
