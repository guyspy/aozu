import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, CircleAlertIcon, DownloadIcon, LoaderCircleIcon } from 'lucide-react'

import { AozuIcon } from '@/ui/AozuIcon'
import { Button } from '@/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip'

export function DataControls({
  exportData,
  exportFilename = 'companion.zip',
  exportIconOnly = false,
  exportLabel,
  importLabel,
  prepareImport,
}: {
  exportData?(): Promise<Blob>
  exportFilename?: string
  exportIconOnly?: boolean
  exportLabel?: string
  importLabel?: string
  prepareImport?(blob: Blob): Promise<void>
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const downloadLabel = exportLabel ?? t('data.export')
  const statusLabel = status === 'error' ? `${t('data.error')}${error ? ` ${error}` : ''}` : status === 'idle' ? downloadLabel : t(`data.${status}`)
  useEffect(() => {
    if (!exportIconOnly || status !== 'done') return
    const timer = setTimeout(() => setStatus('idle'), 2_000)
    return () => clearTimeout(timer)
  }, [exportIconOnly, status])
  const run = async (task: () => Promise<void>) => {
    setStatus('busy'); setError('')
    try { await task(); setStatus('done') } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setStatus('error')
    }
  }

  return (
    <div className="grid gap-2">
      {exportData && <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant={prepareImport ? 'ghost' : 'outline'} size={exportIconOnly ? 'icon' : 'default'} className={prepareImport ? 'justify-start' : undefined} aria-label={status === 'busy' ? t('data.busy') : downloadLabel} disabled={status === 'busy'} onClick={() => void run(async () => {
        const url = URL.createObjectURL(await exportData())
        const link = document.createElement('a')
        link.href = url
        link.download = exportFilename
        document.body.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1_000)
      })}>{status === 'busy' ? <LoaderCircleIcon className="animate-spin" /> : exportIconOnly && status === 'done' ? <CheckIcon /> : exportIconOnly && status === 'error' ? <CircleAlertIcon className="text-destructive" /> : <DownloadIcon />}{exportIconOnly ? <span className="sr-only">{downloadLabel}</span> : downloadLabel}</Button></TooltipTrigger>{exportIconOnly && <TooltipContent>{statusLabel}</TooltipContent>}</Tooltip></TooltipProvider>}
      {prepareImport && <Button asChild variant={exportData ? 'ghost' : 'default'} className={exportData ? 'justify-start' : 'w-full'}>
        <label>
          <AozuIcon name="import" />
          {importLabel ?? t('data.import')}
          <input className="sr-only" type="file" accept=".zip,application/zip" disabled={status === 'busy'} onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void run(() => prepareImport(file))
          }} />
        </label>
      </Button>}
      {status !== 'idle' && <p role={status === 'error' ? 'alert' : 'status'} className={exportIconOnly ? 'sr-only' : `px-4 text-xs ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
        {statusLabel}
      </p>}
    </div>
  )
}
