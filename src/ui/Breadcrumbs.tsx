import { Fragment } from 'react'
import { HomeIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/ui/components/ui/breadcrumb'

export function Breadcrumbs({ items }: { items: Array<{ label: string; path: string }> }) {
  const { t } = useTranslation()
  return <Breadcrumb className="app-breadcrumb" aria-label={t('navigation.breadcrumb')}><BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink asChild><Link to="/" aria-label={t('navigation.home')} title={t('navigation.home')}><HomeIcon className="size-4" aria-hidden="true" /></Link></BreadcrumbLink></BreadcrumbItem>
    {items.map((item, index) => <Fragment key={item.path}>
      <BreadcrumbSeparator className={index === items.length - 1 ? undefined : 'hidden sm:inline-flex'} />
      <BreadcrumbItem className={index === items.length - 1 ? 'min-w-0' : 'hidden sm:inline-flex'}>{index === items.length - 1 ? <BreadcrumbPage className="truncate whitespace-nowrap">{item.label}</BreadcrumbPage> : <BreadcrumbLink asChild><Link to={item.path}>{item.label}</Link></BreadcrumbLink>}</BreadcrumbItem>
    </Fragment>)}
  </BreadcrumbList></Breadcrumb>
}
