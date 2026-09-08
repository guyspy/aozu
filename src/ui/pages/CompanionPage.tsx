import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { StageProjection } from '@/core/domain/companion.ts'
import type { CharacterTextureAtlas, ResolvedCharacterLayer } from '@/core/domain/character.ts'
import type { ResolvedSceneLayer } from '@/core/domain/scene.ts'
import { CharacterViewport } from '@/ui/CharacterViewport'
import { SceneRenderer } from '@/ui/SceneRenderer'
import { Button } from '@/ui/components/ui/button'
import { Separator } from '@/ui/components/ui/separator'

export function CompanionPage({ companionName, stage, dialogue, pendingTurns, character, characterAtlas, scene, onAction, onText }: {
  companionName: string
  stage: StageProjection
  dialogue?: string
  pendingTurns: number
  character?: Array<ResolvedCharacterLayer & { blob: Blob }>
  characterAtlas?: CharacterTextureAtlas
  scene?: Array<ResolvedSceneLayer & { blob: Blob }>
  onAction(actionId: string): Promise<void>
  onText(text: string): Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')

  return <div className="bg-muted/30">
    <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-5xl flex-col px-4">
      <section aria-label={t('main.stageTitle')} className="flex min-h-0 flex-1 items-center justify-center py-6">
        <div className="flex aspect-2/3 max-h-[65svh] w-full max-w-sm items-center justify-center rounded-3xl bg-background shadow-sm">
          <SceneRenderer label={t('main.sceneLabel', { name: stage.title })} layers={scene ?? []}>
            {character ? <CharacterViewport label={companionName} layers={character} atlas={characterAtlas} className="size-full rounded-none border-0 bg-transparent" /> : <div className="grid size-full place-items-center p-6 text-center text-muted-foreground">
              <div><h1 id="stage-title" className="text-base font-medium text-foreground">{stage.title}</h1><p className="mt-1 text-sm">{stage.narrative}</p></div>
            </div>}
          </SceneRenderer>
        </div>
      </section>

      <Separator />

      <section aria-labelledby="dialogue-title" className="py-4">
        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <h2 id="dialogue-title" className="font-heading text-sm font-medium">{t('main.dialogueTitle')}</h2>
          {dialogue && <p className="mt-2 text-sm text-foreground">{dialogue}</p>}
          {pendingTurns > 0 && <p className="mt-2 text-sm text-muted-foreground">{t('main.waitingForAgent')}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {stage.actions.map((action) => <Button key={action.id} variant="outline" disabled={busy || stage.status !== 'active'} onClick={async () => {
              setBusy(true)
              try { await onAction(action.id) } finally { setBusy(false) }
            }}>{action.label}</Button>)}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={async (event) => {
            event.preventDefault()
            if (!text.trim() || busy || stage.status !== 'active') return
            setBusy(true)
            try { await onText(text); setText('') } finally { setBusy(false) }
          }}>
            <label htmlFor="companion-message" className="sr-only">{t('main.messageLabel')}</label>
            <input
              id="companion-message"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={t('main.messagePlaceholder')}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <Button type="submit" disabled={busy || !text.trim() || stage.status !== 'active'}>{t('main.send')}</Button>
          </form>
        </div>
      </section>
    </main>
  </div>
}
