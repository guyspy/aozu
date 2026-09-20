import { ArrowLeftIcon, BotIcon, CopyIcon, LanguagesIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { AozuIcon } from '@/ui/AozuIcon'
import { Button } from '@/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/ui/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import type { WebMcpState } from '@/adapters/webmcp/controller.ts'
import { LANGUAGES } from '@/ui/i18n'
import type { ReactNode } from 'react'

type AppHeaderProps = {
  webmcp: WebMcpState
  title?: string
  onBack?: () => void
  actions?: ReactNode
}

export function AppHeader({ webmcp, title, onBack, actions }: AppHeaderProps) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const label = t(`main.webmcp.${webmcp.status}`, { count: webmcp.toolCount })
  const webmcpReady = webmcp.status === 'ready'
  const guidePrompt = `${t('main.webmcp.guideVerify')} ${t('main.webmcp.guidePrompt')}`
  const color = webmcp.status === 'ready' ? 'bg-emerald-500' : webmcp.status === 'registering' ? 'bg-amber-500'
    : webmcp.status === 'failed' ? 'bg-red-500' : 'bg-muted-foreground/50'

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <nav
        aria-label={t('navigation.primary')}
        className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 px-3 sm:px-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {onBack && <Button type="button" size="icon" variant="ghost" onClick={onBack} aria-label={t('common.back')}><ArrowLeftIcon /></Button>}
          <Link to="/" aria-label={t('navigation.home')} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2">
            <AozuIcon name="book" />
            {!title && <span className="font-heading text-lg font-semibold">{t('common.productName')}</span>}
          </Link>
          {title && <h1 className="truncate font-heading text-lg font-semibold">{title}</h1>}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-2">
          {actions}
          <Select value={i18n.resolvedLanguage ?? 'en'} onValueChange={(code) => void i18n.changeLanguage(code)}>
            <SelectTrigger size="sm" aria-label={t('common.language')} className="h-9 w-12 justify-center gap-0 px-1 sm:h-7 sm:w-auto sm:gap-1.5 sm:px-2">
              <span className="text-xs font-semibold sm:hidden">{(i18n.resolvedLanguage ?? 'en').split('-').at(-1)?.toUpperCase()}</span>
              <LanguagesIcon aria-hidden="true" className="hidden sm:block" />
              <span className="hidden sm:inline"><SelectValue /></span>
            </SelectTrigger>
            <SelectContent align="end">
              {LANGUAGES.map(({ code, label: name }) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog onOpenChange={(open) => { if (!open) { setCopied(false); setCopyError('') } }}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="ghost" aria-label={`WebMCP. ${label}`} title={webmcp.error ?? label} className="relative h-9 w-9 gap-1.5 px-0 text-xs text-muted-foreground sm:h-8 sm:w-auto sm:px-2">
                <BotIcon className="size-4 sm:hidden" aria-hidden="true" />
                <span className={`absolute right-1 top-1 size-2 rounded-full sm:static ${color}`} aria-hidden="true" />
                <span className="hidden sm:inline">WebMCP</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg" closeLabel={t('common.close')}>
              <DialogTitle>{webmcpReady || webmcp.status === 'registering' ? t('main.webmcp.guideTitle') : label}</DialogTitle>
              <DialogDescription>{webmcpReady ? t('main.webmcp.guideDescription') : webmcp.status === 'registering' ? label : t('main.webmcp.guideUnavailable')}</DialogDescription>
              {webmcpReady && <>
                <div className="max-h-64 select-text overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{guidePrompt}</div>
                <Button type="button" onClick={() => void navigator.clipboard.writeText(guidePrompt).then(() => { setCopied(true); setCopyError('') }, (caught: unknown) => setCopyError(caught instanceof Error ? caught.message : String(caught)))}>
                  <CopyIcon />{t(copied ? 'characterDraft.start.copied' : 'characterDraft.start.copy')}
                </Button>
              </>}
              {copyError && <p role="alert" className="text-sm text-destructive">{t('data.error')} {copyError}</p>}
            </DialogContent>
          </Dialog>
        </div>
      </nav>
    </header>
  )
}
