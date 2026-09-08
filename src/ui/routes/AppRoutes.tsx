import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'

import { DEFAULT_CHARACTER_COLLECTION } from '@/core/domain/character-collection'

import type { Application } from '@/bootstrap.ts'
import { AppHeader } from '@/ui/AppHeader'
import { CharacterLibraryTransfer } from '@/ui/CharacterLibraryTransfer'
import { CharacterDraftPage } from '@/ui/pages/CharacterDraftPage'
import { CharacterLibraryPage } from '@/ui/pages/CharacterLibraryPage'
import { StatusPage } from '@/ui/pages/StatusPage'

function CharacterEditor({ application, refresh, savedRevision }: { application: Application; refresh(): Promise<void>; savedRevision?: number }) {
  const navigate = useNavigate()
  const { characterId, step } = useParams()
  if (!characterId) return <Navigate to="/characters" replace />
  return <CharacterDraftPage
    key={characterId}
    editor={application.editor}
    savedRevision={savedRevision}
    autoFitVariant={application.autoFitCharacterVariant}
    fitSuggestion={application.characterFitSuggestion}
    compileAtlas={application.compileCharacterAtlas}
    exportCharacter={() => application.exportCharacter(characterId)}
    exportCharacterPng={application.exportCharacterPng}
    replaceAsset={(target, blob) => application.replaceCharacterAsset(characterId, target, blob)}
    deleteCharacter={async () => {
      await application.deleteCharacter(characterId)
      await refresh()
      navigate(`/collections/${DEFAULT_CHARACTER_COLLECTION}`)
    }}
    saveAs={async () => {
      const saved = await application.saveCharacterAs()
      await refresh()
      navigate(`/characters/${encodeURIComponent(saved.id)}/${step ?? 'expressions'}`)
      return saved
    }}
  />
}

export function AppRoutes({ application }: { application: Application }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [webmcp, setWebmcp] = useState(application.webmcp.getState())
  const [library, setLibrary] = useState<Awaited<ReturnType<Application['loadCharacterLibrary']>>>()
  const [loadError, setLoadError] = useState(false)
  const lastBook = (() => {
    try { return localStorage.getItem('aozu-last-collection') ?? DEFAULT_CHARACTER_COLLECTION } catch { return DEFAULT_CHARACTER_COLLECTION }
  })()
  useEffect(() => {
    const id = /^\/collections\/([^/]+)$/.exec(location.pathname)?.[1]
    if (!id || !library?.collections.some((book) => book.id === id)) return
    try { localStorage.setItem('aozu-last-collection', id) } catch { /* Browsing still works without preference storage. */ }
  }, [location.pathname, library])
  useLayoutEffect(() => { document.getElementById('root')?.scrollTo(0, 0) }, [location.pathname])
  const refresh = useCallback(async () => {
    try {
      setLibrary(await application.loadCharacterLibrary())
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [application])

  useEffect(() => {
    const disconnect = application.webmcp.setNavigate((path) => navigate(path))
    const unsubscribe = application.webmcp.subscribe(setWebmcp)
    return () => { unsubscribe(); disconnect() }
  }, [application, navigate])
  useEffect(() => {
    let live = true
    void application.loadCharacterLibrary()
      .then((next) => { if (live) setLibrary(next) })
      .catch(() => { if (live) setLoadError(true) })
    return () => { live = false }
  }, [application])
  // Every persisted Character revision refreshes the library listing (names, ordering).
  useEffect(() => application.editor.store.subscribe((state, previous) => {
    if (state.persistedRevision !== previous.persistedRevision) void refresh()
  }), [application, refresh])
  useEffect(() => application.subscribeCharacterChanges(() => { void refresh() }), [application, refresh])
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible)
  }, [refresh])
  if (loadError) return <><AppHeader webmcp={webmcp} /><main className="mx-auto max-w-4xl p-6">
    <p role="alert">{t('startup.error')}</p>
    <CharacterLibraryTransfer
      exportLibrary={application.exportCharacterLibrary}
      prepareLibraryImport={application.prepareCharacterLibraryImport}
      importLibrary={async (snapshot, mode) => { await application.importCharacterLibrary(snapshot, mode); await refresh() }}
    />
  </main></>
  if (!library) return <><AppHeader webmcp={webmcp} /><StatusPage>{t('startup.loading')}</StatusPage></>

  const editing = /^\/characters\/[^/]+/.test(location.pathname)
  const characterId = editing ? decodeURIComponent(location.pathname.split('/')[2] ?? '') : undefined
  const character = library.characters.find(({ id }) => id === characterId)
  const characterBook = library.collections.find(({ characterIds }) => characterId && characterIds.includes(characterId))?.id ?? DEFAULT_CHARACTER_COLLECTION
  const home = library.characters.length ? `/collections/${library.collections.some(({ id }) => id === lastBook) ? lastBook : DEFAULT_CHARACTER_COLLECTION}` : '/characters/new/expressions'
  const libraryPage = <CharacterLibraryPage
    characters={library.characters}
    collections={library.collections}
    createCollection={async (name) => { const book = await application.createCollection(name); await refresh(); return book }}
    updateCollection={application.updateCollection}
    deleteCollection={application.deleteCollection}
    assignCollection={application.assignCollection}
    exportLibrary={application.exportCharacterLibrary}
    prepareLibraryImport={application.prepareCharacterLibraryImport}
    importLibrary={async (snapshot, mode) => { await application.importCharacterLibrary(snapshot, mode); await refresh() }}
    openCharacter={(id) => navigate(`/characters/${encodeURIComponent(id)}/expressions`)}
    importCharacter={async (blob) => {
      const imported = await application.importCharacter(blob)
      await refresh()
      navigate(`/characters/${encodeURIComponent(imported.id)}/expressions`)
    }}
    refresh={refresh}
  />
  return <>
    <AppHeader
      webmcp={webmcp}
      title={character?.name}
      onBack={editing ? () => navigate(`/collections/${characterBook}`) : undefined}
    />
    <Routes>
      <Route index element={<Navigate to={home} replace />} />
      <Route path="/characters" element={<Navigate to={home} replace />} />
      <Route path="/collections" element={libraryPage} />
      <Route path="/collections/:collectionId" element={libraryPage} />
      <Route path="/characters/:characterId" element={<Navigate to="expressions" replace />} />
      <Route path="/characters/:characterId/:step" element={<CharacterEditor application={application} refresh={refresh} savedRevision={character?.revision} />} />
      <Route path="/characters/:characterId/:step/:variantId" element={<CharacterEditor application={application} refresh={refresh} savedRevision={character?.revision} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </>
}
