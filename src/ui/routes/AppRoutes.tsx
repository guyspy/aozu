import { AozuIcon } from '@/ui/AozuIcon'
import { FolderInputIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/ui/components/ui/sheet'
import type { CharacterCollection } from '@/core/domain/character-collection'
import { Breadcrumbs } from '@/ui/Breadcrumbs'
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

function CharacterEditor({ application, collections, refresh, savedRevision, webmcpReady }: { collections: CharacterCollection[]; webmcpReady: boolean; application: Application; refresh(): Promise<void>; savedRevision?: number }) {
  const navigate = useNavigate()
  const { characterId, step } = useParams()
  const { t } = useTranslation()
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!characterId) return <Navigate to="/" replace />
  return <CharacterDraftPage
    key={characterId}
    collectionControl={characterId !== 'new' && <>
      <Button size="icon" variant="outline" aria-label={t('books.move')} title={t('books.move')} onClick={() => { setError(''); setMoving(true) }}><FolderInputIcon /></Button>
      <Sheet open={moving} onOpenChange={(open) => { if (!busy) setMoving(open) }}><SheetContent className="collection-move-sheet overflow-y-auto p-6" aria-describedby={undefined}><SheetTitle className="font-heading text-xl">{t('books.move')}</SheetTitle>
        <div className="collection-move-grid mt-6">{collections.map((collection) => <button type="button" className="collection-cover" key={collection.id} disabled={busy || collection.characterIds.includes(characterId)} onClick={async () => {
          setBusy(true); setError('')
          try { await application.assignCollection(characterId, collection.id); await refresh(); setMoving(false) }
          catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
          finally { setBusy(false) }
        }}><AozuIcon name="book" className="collection-cover-seal" /><span className="font-heading font-semibold">{collection.id === DEFAULT_CHARACTER_COLLECTION ? t('books.default') : collection.name}</span></button>)}</div>
        {error && <p role="alert" className="mt-4 text-destructive">{error}</p>}
      </SheetContent></Sheet>
    </>}
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

  const crumbs: Array<{ label: string; path: string }> = []
  const addCrumb = (label: string, path: string) => crumbs.push({ label, path })
  if (parts[0] === 'collections' || editing) {
    addCrumb(t('world.collections'), '/collections')
    const id = editing ? characterBook : parts[1]
    const collection = library.collections.find((c) => c.id === id)
    if (collection) addCrumb(id === 'default' ? t('world.defaultCollection') : collection.name, `/collections/${id}`)
    if (parts[2] === 'locations') {
      addCrumb(t('world.locations'), `/collections/${id}/locations`)
      if (place) for (const ancestor of locationAncestors(world.library, place.id)) addCrumb(ancestor.name, `/collections/${id}/locations/${ancestor.id}`)
    }
    if (editing) addCrumb(character?.name ?? t('world.createCharacter'), location.pathname)
  } else if (parts[0] === 'albums') {
    addCrumb(t('world.albums'), '/albums')
    const album = world.library.albums.find((a) => a.id === parts[1])
    if (album) addCrumb(album.id === 'default' ? t('world.defaultAlbum') : album.name, `/albums/${album.id}`)
    const photo = world.library.photos.find((p) => p.id === parts[3] && p.albumId === album?.id)
    if (photo) addCrumb(photo.name, location.pathname)
  }

  const libraryPage = <CharacterLibraryPage
    characters={library.characters}
    loadThumbnail={application.loadCharacterThumbnail}
    collections={library.collections}
    locationCounts={Object.fromEntries(library.collections.map((c) => [c.id, world.library!.locations.filter((l) => l.collectionId === c.id).length]))}
    createCollection={async (name) => { const book = await application.createCollection(name); await refresh(); return book }}
    updateCollection={application.updateCollection}
    deleteCollection={application.deleteCollection}
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
    {crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
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
      <Route path="/characters/:characterId/:step" element={<CharacterEditor collections={library.collections} webmcpReady={webmcp.status === 'ready'} application={application} refresh={refresh} savedRevision={character?.revision} />} />
      <Route path="/characters/:characterId/:step/:variantId" element={<CharacterEditor collections={library.collections} webmcpReady={webmcp.status === 'ready'} application={application} refresh={refresh} savedRevision={character?.revision} />} />
      <Route path="*" element={<StatusPage>404 · {t('navigation.notFound')}</StatusPage>} />
    </Routes>
  </>
}
