import { useWorldLibrary } from '@/ui/useWorldLibrary'
import { locationAncestors } from '@/core/domain/world-library'
import { HomePage } from '@/ui/pages/HomePage'
import { WorldLibraryPage } from '@/ui/pages/WorldLibraryPage'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'

import { DEFAULT_CHARACTER_COLLECTION } from '@/core/domain/character-collection'

import type { Application } from '@/bootstrap.ts'
import { AppHeader } from '@/ui/AppHeader'
import { CharacterLibraryTransfer } from '@/ui/CharacterLibraryTransfer'
import { CharacterDraftPage } from '@/ui/pages/CharacterDraftPage'
import { CharacterLibraryPage } from '@/ui/pages/CharacterLibraryPage'
import { StoryboardPage } from '@/ui/pages/StoryboardPage'
import { StatusPage } from '@/ui/pages/StatusPage'

function CharacterEditor({ application, refresh, savedRevision, webmcpReady }: { webmcpReady: boolean; application: Application; refresh(): Promise<void>; savedRevision?: number }) {
  const navigate = useNavigate()
  const { characterId, step } = useParams()
  if (!characterId) return <Navigate to="/" replace />
  return <CharacterDraftPage
    key={characterId}
    webmcpReady={webmcpReady}
    editor={application.editor}
    savedRevision={savedRevision}
    autoFitVariant={application.autoFitCharacterVariant}
    fitSuggestion={application.characterFitSuggestion}
    exportCharacter={() => application.exportCharacter(characterId)}
    exportCharacterPng={application.exportCharacterPng}
    replaceAsset={(target, blob) => application.replaceCharacterAsset(characterId, target, blob)}
    replaceReference={(id, blob, metadata) => application.replaceCharacterReference(characterId, id, blob, metadata)}
    changeAppearance={(command, revision) => application.changeCharacterAppearance(characterId, command, revision)}
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
  const world = useWorldLibrary(application.worldLibrary)
  const [webmcp, setWebmcp] = useState(application.webmcp.getState())
  const [library, setLibrary] = useState<Awaited<ReturnType<Application['loadCharacterLibrary']>>>()
  const [loadError, setLoadError] = useState(false)
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
  if (world.error) return <><AppHeader webmcp={webmcp} /><StatusPage>{world.error}</StatusPage></>
  if (!library || !world.library) return <><AppHeader webmcp={webmcp} /><StatusPage>{t('startup.loading')}</StatusPage></>

  const editing = /^\/characters\/[^/]+/.test(location.pathname)
  const characterId = editing ? decodeURIComponent(location.pathname.split('/')[2] ?? '') : undefined
  const character = library.characters.find(({ id }) => id === characterId)
  const characterBook = library.collections.find(({ characterIds }) => characterId && characterIds.includes(characterId))?.id ?? DEFAULT_CHARACTER_COLLECTION
  const parts = location.pathname.split('/').filter(Boolean)
  const place = parts[2] === 'locations' ? world.library.locations.find((l) => l.id === parts[3]) : undefined
  const boardFolder = parts[0] === 'storyboards' ? world.library.boardFolders[parts[1]] : undefined
  const backPath = editing ? `/collections/${characterBook}`
    : place ? `/collections/${place.collectionId}/locations${locationAncestors(world.library, place.id).at(-2) ? `/${place.parentId}` : ''}`
    : parts[0] === 'collections' && parts[2] === 'locations' ? `/collections/${parts[1]}`
    : parts[0] === 'collections' && parts[1] ? '/collections'
    : parts[0] === 'albums' && parts[2] === 'photos' ? `/albums/${parts[1]}`
    : parts[0] === 'albums' && parts[1] ? '/albums'
    : parts[0] === 'storyboards' && parts[1] ? (boardFolder ? `/storyboards/folders/${boardFolder}` : '/storyboards')
    : parts.length ? '/' : undefined

  const libraryPage = <CharacterLibraryPage
    characters={library.characters}
    loadThumbnail={application.loadCharacterThumbnail}
    collections={library.collections}
    locationCounts={Object.fromEntries(library.collections.map((c) => [c.id, world.library!.locations.filter((l) => l.collectionId === c.id).length]))}
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
  const worldPage = <WorldLibraryPage key={location.pathname} service={application.worldLibrary} library={world.library} collections={library.collections} />
  const storyPage = <StoryboardPage key={location.pathname} service={application.storyboards} worldService={application.worldLibrary} world={world.library} collections={library.collections} application={application} characters={library.characters} />
  return <>
    <AppHeader
      webmcp={webmcp}
      title={character?.name}
      onBack={backPath ? () => navigate(backPath) : undefined}
    />
    <Routes>
      <Route index element={<HomePage application={application} world={world.library} collections={library.collections} characters={library.characters} />} />
      <Route path="/storyboards" element={storyPage} />
      <Route path="/storyboards/:boardId" element={storyPage} />
      <Route path="/storyboards/folders/:folderId" element={storyPage} />
      <Route path="/albums" element={worldPage} />
      <Route path="/albums/:albumId" element={worldPage} />
      <Route path="/albums/:albumId/photos/:photoId" element={worldPage} />
      <Route path="/collections/:collectionId/locations" element={worldPage} />
      <Route path="/collections/:collectionId/locations/:locationId" element={worldPage} />
      <Route path="/collections" element={libraryPage} />
      <Route path="/collections/:collectionId" element={libraryPage} />
      <Route path="/characters/:characterId" element={<Navigate to="expressions" replace />} />
      <Route path="/characters/:characterId/:step" element={<CharacterEditor webmcpReady={webmcp.status === 'ready'} application={application} refresh={refresh} savedRevision={character?.revision} />} />
      <Route path="/characters/:characterId/:step/:variantId" element={<CharacterEditor webmcpReady={webmcp.status === 'ready'} application={application} refresh={refresh} savedRevision={character?.revision} />} />
      <Route path="*" element={<StatusPage>404 · {t('navigation.notFound')}</StatusPage>} />
    </Routes>
  </>
}
