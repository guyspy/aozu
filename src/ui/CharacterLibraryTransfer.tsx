import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CharacterLibrarySnapshot } from '@/core/application/character-library.ts'
import { DataControls } from '@/ui/DataControls'
import { Button } from '@/ui/components/ui/button'

export interface CharacterLibraryTransferProps {
  exportLibrary(): Promise<Blob>
  prepareLibraryImport(blob: Blob): Promise<CharacterLibrarySnapshot>
  importLibrary(snapshot: CharacterLibrarySnapshot, mode: 'merge' | 'replace'): Promise<void>
}

export function CharacterLibraryTransfer({ exportLibrary, prepareLibraryImport, importLibrary }: CharacterLibraryTransferProps) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<CharacterLibrarySnapshot>()
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState(false)
  return <section className="mt-8 rounded-2xl border bg-background p-5" aria-labelledby="library-transfer-title">
    <h2 id="library-transfer-title" className="font-heading text-xl font-medium">{t('library.backupTitle')}</h2>
    <p className="mt-2 text-muted-foreground">{t('library.backupDescription')}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <DataControls exportData={exportLibrary} exportFilename="aozu-character-library.zip" exportLabel={t('library.download')} />
      {!pending && <DataControls importLabel={t('library.upload')} prepareImport={async (blob) => {
        setDone(false); setError(undefined); setPending(undefined); setMode('merge')
        setPending(await prepareLibraryImport(blob))
      }} />}
    </div>
    {pending && <div className="mt-4 grid gap-3 rounded-lg border p-4" aria-label={t('library.reviewImport')}>
      <p>{t('library.importCounts', {
        characters: pending.entries.filter((entry) => entry.collection === 'character-workspaces').length + pending.legacyDrafts.length,
        packs: pending.entries.filter((entry) => entry.collection === 'character-packs').length,
        collections: pending.entries.filter((entry) => entry.collection === 'character-collections').length,
      })}</p>
      <label className="grid gap-1 text-sm">{t('library.importMode')}
        <select className="rounded-md border bg-background px-3 py-2" value={mode} disabled={busy} onChange={(event) => setMode(event.target.value as 'merge' | 'replace')}>
          <option value="merge">{t('library.merge')}</option>
          <option value="replace">{t('library.replace')}</option>
        </select>
      </label>
      <p className={mode === 'replace' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{t(`library.${mode}Description`)}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} variant={mode === 'replace' ? 'destructive' : 'default'} onClick={() => {
          setBusy(true); setError(undefined)
          void importLibrary(pending, mode).then(() => { setPending(undefined); setDone(true) })
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
            .finally(() => setBusy(false))
        }}>{busy ? t('data.busy') : t(mode === 'replace' ? 'library.confirmReplace' : 'library.confirmMerge')}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>{t('common.cancel')}</Button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {done && <p role="status" className="mt-3 text-sm text-muted-foreground">{t('library.imported')}</p>}
  </section>
}
