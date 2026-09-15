import { Workspace, WorkspaceSheet } from '@/ui/Workspace'
import { CollectionBookCard } from '@/ui/LibraryCards'
import { FolderInputIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { Sheet } from '@/ui/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
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
import { CollectionActions, CollectionProfileAction } from '@/ui/CollectionActions'
import { LibraryExplorer } from '@/ui/LibraryExplorer'
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
      <Tooltip><TooltipTrigger asChild><Button size="icon" variant="outline" aria-label={t('books.move')} onClick={() => { setError(''); setMoving(true) }}><FolderInputIcon /></Button></TooltipTrigger><TooltipContent>{t('books.move')}</TooltipContent></Tooltip>
      <Sheet open={moving} onOpenChange={(open) => { if (!busy) setMoving(open) }}><WorkspaceSheet title={t('books.move')}  aria-describedby={undefined}>
        <div className="collection-move-grid mt-6">{collections.map((collection) => <CollectionBookCard key={collection.id} label={collection.id === DEFAULT_CHARACTER_COLLECTION ? t('books.default') : collection.name} disabled={busy || collection.characterIds.includes(characterId)} onClick={async () => {
          setBusy(true); setError('')
          try { await application.assignCollection(characterId, collection.id); await refresh(); setMoving(false) }
          catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
          finally { setBusy(false) }
        }} />)}</div>
        {error && <p role="alert" className="mt-4 text-destructive">{error}</p>}
      </WorkspaceSheet></Sheet>
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
  // Storyboards load inside their page, so it reports the open board's name for the header.
  const [boardTitle, setBoardTitle] = useState<string>()
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
  if (loadError) return <><AppHeader webmcp={webmcp} /><Workspace>
    <p role="alert">{t('startup.error')}</p>
    <CharacterLibraryTransfer
      exportLibrary={application.exportCharacterLibrary}
      prepareLibraryImport={application.prepareCharacterLibraryImport}
      importLibrary={async (snapshot, mode) => { await application.importCharacterLibrary(snapshot, mode); await refresh() }}
    />
  </Workspace></>
  if (world.error) return <><AppHeader webmcp={webmcp} /><StatusPage>{world.error}</StatusPage></>
  if (!library || !world.library) return <><AppHeader webmcp={webmcp} /><StatusPage>{t('startup.loading')}</StatusPage></>

  const editing = /^\/characters\/[^/]+/.test(location.pathname)
  const characterId = editing ? decodeURIComponent(location.pathname.split('/')[2] ?? '') : undefined
  const character = library.characters.find(({ id }) => id === characterId)
  const characterBook = library.collections.find(({ characterIds }) => characterId && characterIds.includes(characterId))?.id ?? DEFAULT_CHARACTER_COLLECTION
  const parts = location.pathname.split('/').filter(Boolean)
  const place = parts[2] === 'locations' ? world.library.locations.find((l) => l.id === parts[3]) : undefined
  const collection = parts[0] === 'collections' && parts[1] ? library.collections.find((c) => c.id === parts[1]) : undefined
  const album = parts[0] === 'albums' && parts[1] ? world.library.albums.find((a) => a.id === parts[1]) : undefined
  const photo = album && parts[2] === 'photos' ? world.library.photos.find((pic) => pic.id === parts[3] && pic.albumId === album.id) : undefined
  const named = (value: { id: string; name: string }, fallback: string) => value.id === 'default' ? t(fallback) : value.name
  // The header names the document being worked on; list pages stay on the product name.
  const documentTitle = character?.name ?? place?.name ?? photo?.name
    ?? (album ? named(album, 'world.defaultAlbum') : undefined)
    ?? (collection ? named(collection, 'world.defaultCollection') : undefined)
    ?? (parts[0] === 'storyboards' ? boardTitle : undefined)
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
    addCrumb(t('library.collections'), '/collections')
    const id = editing ? characterBook : parts[1]
    const crumbCollection = library.collections.find((c) => c.id === id)
    if (crumbCollection) addCrumb(named(crumbCollection, 'world.defaultCollection'), `/collections/${id}`)
    if (parts[2] === 'locations') {
      addCrumb(t('world.locations'), `/collections/${id}/locations`)
      if (place) for (const ancestor of locationAncestors(world.library, place.id)) addCrumb(ancestor.name, `/collections/${id}/locations/${ancestor.id}`)
      if (place && parts[4]) addCrumb(t(`world.${parts[4] === 'profile' ? 'locationProfile' : 'conditions'}`), location.pathname)
    }
    if (editing) addCrumb(character?.name ?? t('world.createCharacter'), location.pathname)
  } else if (parts[0] === 'albums') {
    addCrumb(t('world.albums'), '/albums')
    if (album) addCrumb(named(album, 'world.defaultAlbum'), `/albums/${album.id}`)
    if (photo) addCrumb(photo.name, location.pathname)
  }

  const collectionActions = <CollectionActions
    collection={collection}
    deleteCollection={application.deleteCollection}
    importCharacter={async (blob) => {
      const imported = await application.importCharacter(blob)
      await refresh()
      navigate(`/characters/${encodeURIComponent(imported.id)}/expressions`)
    }}
    refresh={refresh}
  />
  const collectionProfileAction = collection && <CollectionProfileAction collection={collection} updateCollection={application.updateCollection} refresh={refresh} />
  const libraryPage = <CharacterLibraryPage
    characters={library.characters}
    loadThumbnail={application.loadCharacterThumbnail}
    collections={library.collections}
    createCollection={async (name) => { const book = await application.createCollection(name); await refresh(); return book }}
    openCharacter={(id) => navigate(`/characters/${encodeURIComponent(id)}/expressions`)}
    refresh={refresh}
    actions={collectionActions}
    profileAction={collectionProfileAction}
  />
  const worldPage = <WorldLibraryPage key={place ? `location:${place.id}` : photo ? `photo:${photo.id}` : album ? `album:${album.id}` : location.pathname} actions={collectionActions} service={application.worldLibrary} library={world.library} collections={library.collections} />
  const storyPage = <StoryboardPage key={location.pathname.replace(/\/details$/, '')} setTitle={setBoardTitle} service={application.storyboards} worldService={application.worldLibrary} world={world.library} collections={library.collections} application={application} characters={library.characters} />
  return <>
    <AppHeader
      webmcp={webmcp}
      title={documentTitle}
      onBack={backPath ? () => navigate(backPath) : undefined}
      actions={<LibraryExplorer application={application} world={world.library} collections={library.collections} characters={library.characters} refresh={refresh} />}
    />
    {crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
    <Routes>
      <Route index element={<HomePage application={application} world={world.library} collections={library.collections} characters={library.characters} />} />
      <Route path="/storyboards" element={storyPage} />
      <Route path="/storyboards/:boardId" element={storyPage} />
      <Route path="/storyboards/:boardId/details" element={storyPage} />
      <Route path="/storyboards/folders/:folderId" element={storyPage} />
      <Route path="/albums" element={worldPage} />
      <Route path="/albums/:albumId" element={worldPage} />
      <Route path="/albums/:albumId/photos/:photoId" element={worldPage} />
      <Route path="/collections/:collectionId/profile" element={libraryPage} />
      <Route path="/collections/:collectionId/locations" element={worldPage} />
      <Route path="/collections/:collectionId/locations/:locationId" element={worldPage} />
      <Route path="/collections/:collectionId/locations/:locationId/profile" element={worldPage} />
      <Route path="/collections/:collectionId/locations/:locationId/conditions" element={worldPage} />
      <Route path="/collections/:collectionId/locations/:locationId/conditions/:conditionId" element={worldPage} />
      <Route path="/collections" element={libraryPage} />
      <Route path="/collections/:collectionId" element={libraryPage} />
      <Route path="/characters/:characterId" element={<Navigate to="expressions" replace />} />
      <Route path="/characters/:characterId/:step" element={<CharacterEditor collections={library.collections} webmcpReady={webmcp.status === 'ready'} application={application} refresh={refresh} savedRevision={character?.revision} />} />
      <Route path="/characters/:characterId/:step/:variantId" element={<CharacterEditor collections={library.collections} webmcpReady={webmcp.status === 'ready'} application={application} refresh={refresh} savedRevision={character?.revision} />} />
      <Route path="*" element={<StatusPage>404 · {t('navigation.notFound')}</StatusPage>} />
    </Routes>
  </>
}
