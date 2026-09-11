import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

export function Breadcrumbs({ items }: { items: Array<{ label: string; path: string }> }) {
  const { t } = useTranslation()
  return <nav className="app-breadcrumb world-breadcrumb" aria-label={t('navigation.breadcrumb')}><ol>
    {[{ label: t('navigation.home'), path: '/' }, ...items].map((item, index) => <li key={item.path}>
      {index > 0 && <span aria-hidden="true">›</span>}
      {index === items.length ? <span aria-current="page">{item.label}</span> : <Link to={item.path}>{item.label}</Link>}
    </li>)}
  </ol></nav>
}
