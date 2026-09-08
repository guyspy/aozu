import { useTranslation } from 'react-i18next'

import { Button } from '@/ui/components/ui/button'
import { RENDER_MODES, useRenderMode } from '@/ui/render-mode'

export function RenderModeToggle() {
  const { t } = useTranslation()
  const [mode, setMode] = useRenderMode()
  return (
    <div className="inline-flex rounded-lg border bg-muted/50 p-0.5" role="group" aria-label={t('common.renderMode.label')}>
      {RENDER_MODES.map((value) => (
        <Button
          key={value}
          type="button"
          size="xs"
          variant={mode === value ? 'secondary' : 'ghost'}
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
        >
          {t(`common.renderMode.${value}`)}
        </Button>
      ))}
    </div>
  )
}
