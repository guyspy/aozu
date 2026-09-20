import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon, XIcon } from 'lucide-react'
import { CHARACTER_VARIANT_LAYERS, type CharacterDraftVariant, type CharacterItemComposition, type CharacterVariantLayer } from '@/core/domain/character'
import { sameItem } from '@/core/domain/character-composition'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'

/** Small optional controls; the same metadata command validates both UI and WebMCP edits. */
export function CharacterItemCompositionEditor({ item, items, onChange }: {
  item: CharacterDraftVariant; items: CharacterDraftVariant[]; onChange: (value: CharacterItemComposition) => void
}) {
  const { t } = useTranslation()
  const [layer, setLayer] = useState<CharacterVariantLayer>(item.group === 'expression' ? 'head' : 'front')
  const [relation, setRelation] = useState<'above' | 'below'>('above')
  const [targetKey, setTargetKey] = useState('')
  const composition = item.metadata?.composition ?? {}
  const targets = items.filter((other) => other.group !== 'body' && !sameItem(other, item)).flatMap((other) =>
    CHARACTER_VARIANT_LAYERS[other.group].filter((otherLayer) => (otherLayer === 'back') === (layer === 'back')).map((otherLayer) => ({
      key: `${other.group}:${other.id}:${otherLayer}`, label: `${other.label} · ${t(`characterDraft.composition.${otherLayer}`)}`,
      ref: { group: other.group, id: other.id, layer: otherLayer },
    })))
  const target = targets.find(({ key }) => key === targetKey)
  const rules = composition.order ?? []
  return <details className="variant-metadata mt-3" data-testid="item-composition">
    <summary>{t('characterDraft.composition.title')}</summary>
    <div className="grid gap-3 border-t p-3 text-sm">
      <p className="text-muted-foreground">{t('characterDraft.composition.help')}</p>
      <label className="grid gap-1"><span>{t('characterDraft.composition.exclusive')}</span>
        <Input key={composition.exclusiveKeys?.join(',')} aria-label={t('characterDraft.composition.exclusive')} defaultValue={composition.exclusiveKeys?.join(', ') ?? ''}
          onBlur={(event) => onChange({ ...composition, exclusiveKeys: [...new Set(event.target.value.split(',').map((value) => value.trim()).filter(Boolean))] })} />
      </label>
      {rules.map((rule, index) => <div className="flex items-center gap-2" key={index}>
        <span className="flex-1">{t(`characterDraft.composition.${rule.layer}`)} · {t(`characterDraft.composition.${rule.relation}`)} · {items.find((other) => sameItem(other, rule.target))?.label} · {t(`characterDraft.composition.${rule.target.layer}`)}</span>
        <Button size="icon" variant="ghost" aria-label={t('characterDraft.composition.remove')} onClick={() => onChange({ ...composition, order: rules.filter((_, i) => i !== index) })}><XIcon /></Button>
      </div>)}
      <div className="grid grid-cols-2 gap-2">
        <Select value={layer} onValueChange={(value) => { setLayer(value as CharacterVariantLayer); setTargetKey('') }}>
          <SelectTrigger aria-label={t('characterDraft.composition.layer')}><SelectValue /></SelectTrigger>
          <SelectContent>{CHARACTER_VARIANT_LAYERS[item.group].map((value) => <SelectItem key={value} value={value}>{t(`characterDraft.composition.${value}`)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={relation} onValueChange={(value) => setRelation(value as 'above' | 'below')}>
          <SelectTrigger aria-label={t('characterDraft.composition.relation')}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="above">{t('characterDraft.composition.above')}</SelectItem><SelectItem value="below">{t('characterDraft.composition.below')}</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 gap-2">
        <Select value={targetKey} onValueChange={setTargetKey}>
          <SelectTrigger className="min-w-0 flex-1" aria-label={t('characterDraft.composition.target')}><SelectValue placeholder={t('characterDraft.composition.target')} /></SelectTrigger>
          <SelectContent>{targets.map((value) => <SelectItem key={value.key} value={value.key}>{value.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="icon" variant="outline" aria-label={t('characterDraft.composition.add')} disabled={!target || rules.length >= 16}
          onClick={() => target && onChange({ ...composition, order: [...rules, { layer, relation, target: target.ref }] })}><PlusIcon /></Button>
      </div>
    </div>
  </details>
}
