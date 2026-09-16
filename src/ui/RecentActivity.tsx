import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import type { Application } from '@/bootstrap'
import type { WorldLibrary } from '@/core/domain/world-library'
import type { CharacterLibraryItem } from '@/ui/pages/CharacterLibraryPage'

export function RecentActivity({ application, world, characters }: { application: Application; world: WorldLibrary; characters: CharacterLibraryItem[] }) {
  const { t } = useTranslation(), text = (key: string) => t(`world.${key}`)
  const [boards, setBoards] = useState<Array<{ id: string; name: string; updatedAt: number }>>([]), [error, setError] = useState('')
  useEffect(() => { let live = true; void application.storyboards.list().then((items) => { if (live) setBoards(items) }, (caught) => { if (live) setError(String(caught)) }); return () => { live = false } }, [application])
  const recent = [
    ...characters.map((item) => ({ ...item, path: `/characters/${item.id}/expressions`, kind: text('characters') })),
    ...world.locations.map((item) => ({ ...item, path: `/collections/${item.collectionId}/locations/${item.id}`, kind: text('locations') })),
    ...world.photos.map((item) => ({ ...item, path: `/albums/${item.albumId}/photos/${item.id}`, kind: text('albums') })),
    ...boards.map((item) => ({ ...item, path: `/storyboards/${item.id}`, kind: text('storyboards') })),
  ].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  return <section className="world-section"><h2>{text('recent')}</h2><div className="world-recent">{recent.map((item) => <Link key={item.path} to={item.path}><span>{item.kind}</span><strong>{item.name}</strong></Link>)}</div>{!recent.length && <p>{text('noRecent')}</p>}{error && <p role="alert" className="story-error">{error}</p>}</section>
}
