import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { WorkspaceTabs } from '@/ui/Workspace'
import type { ReactNode } from 'react'

export function LibraryTabs({ active, children }: { active: 'collections' | 'albums' | 'storyboards'; children?: ReactNode }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  return <WorkspaceTabs label={t('navigation.library')} active={active} items={[
    { id: 'collections', label: t('library.collections') },
    { id: 'albums', label: t('world.albums') },
    { id: 'storyboards', label: t('world.storyboards') },
  ]} onSelect={(id) => navigate(`/${id}`)}>{children}</WorkspaceTabs>
}
