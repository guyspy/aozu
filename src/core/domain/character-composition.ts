import { CHARACTER_VARIANT_LAYERS, CHARACTER_OUTFIT_SLOTS, type CharacterItemRef, type CharacterLayerRef, type CharacterDraftVariant, type CharacterSelection } from './character.ts'

type Item = Omit<CharacterDraftVariant, 'layers'>
export const itemKey = ({ group, id }: CharacterItemRef) => `${group}:${id}`
export const sameItem = (a: CharacterItemRef, b: CharacterItemRef) => a.group === b.group && a.id === b.id
export const layerKey = (ref: CharacterLayerRef) => `${itemKey(ref)}:${ref.layer}`
export const itemSelected = (selected: CharacterSelection, item: CharacterItemRef) => selected.items.some((ref) => sameItem(ref, item))
export const exclusiveKeys = (item: Item) => [
  ...(['expression', 'hair', 'headwear'].includes(item.group) ? [`category:${item.group}`] : []),
  ...item.metadata?.composition?.exclusiveKeys ?? [],
]
export const itemsConflict = (a: Item, b: Item) => exclusiveKeys(a).some((key) => exclusiveKeys(b).includes(key))

export function selectItem(items: Item[], selected: CharacterSelection, target: CharacterItemRef, active: boolean): CharacterSelection {
  validateItemSelection(items, selected)
  const item = items.find((candidate) => sameItem(candidate, target))
  if (!item) throw new Error('Character variant not found')
  if (item.group === 'body') return selected
  if (itemSelected(selected, target) === active) return selected
  const next = selected.items.filter((ref) => !sameItem(ref, target) && (!active || !selected.smartOrder || !itemsConflict(item, items.find((candidate) => sameItem(candidate, ref))!)))
  if (active) next.push({ group: target.group, id: target.id })
  return { ...selected, items: next }
}

/** Re-enabling Smart applies last-activated-wins without deleting any assets. */
export function setSmartOrder(items: Item[], selected: CharacterSelection, enabled: boolean): CharacterSelection {
  validateItemSelection(items, selected)
  if (typeof enabled !== 'boolean') throw new Error('Smart order must be a boolean')
  if (selected.smartOrder === enabled) return selected
  if (!enabled) return { ...selected, smartOrder: false }
  return selected.items.reduce((next, item) => selectItem(items, next, item, true), { smartOrder: true, items: [] } as CharacterSelection)
}

export function validateItemSelection(items: Item[], selected: CharacterSelection) {
  if (!selected || typeof selected !== 'object' || Array.isArray(selected) || Object.keys(selected).some((key) => !['items', 'smartOrder'].includes(key)) || typeof selected.smartOrder !== 'boolean' ||
    !Array.isArray(selected.items) || selected.items.length > 100) throw new Error('Invalid Character item selection')
  const seen: Item[] = []
  for (const ref of selected.items) {
    if (!ref || typeof ref !== 'object' || Object.keys(ref).some((key) => !['group', 'id'].includes(key))) throw new Error('Invalid Character item selection')
    const item = items.find((candidate) => sameItem(candidate, ref))
    if (!item || item.group === 'body' || seen.some((other) => sameItem(other, item) || selected.smartOrder && itemsConflict(other, item))) throw new Error('Appearance references a missing, duplicate or conflicting variant')
    seen.push(item)
  }
}

const plane = ({ layer }: CharacterLayerRef) => layer === 'back' ? 0 : layer === 'body' ? 1 : 2
const defaultOrder = (item: Item, layer: CharacterLayerRef['layer']) => {
  if (layer === 'back') return ({ prop: 10, outfit: 20, hair: 25, headwear: 28, body: 30, expression: 35 })[item.group]
  return ({ body: 30, outfit: item.metadata?.outfit?.slot === 'outerwear' ? 33 : 32, expression: 35, hair: 37, headwear: 38, prop: 40 })[item.group]
}

/** Stable topological order. Defaults are tie-breakers, never edges that defeat explicit relations. */
export function orderItemLayers<T extends CharacterLayerRef>(items: Item[], layers: T[], selected: CharacterSelection): T[] {
  const byItem = new Map(items.map((item) => [itemKey(item), item]))
  const nodes = new Map(layers.map((layer) => [layerKey(layer), layer]))
  const edges = new Map(layers.map((layer) => [layerKey(layer), new Set<string>()]))
  if (selected.smartOrder) for (const item of items) for (const rule of item.metadata?.composition?.order ?? []) {
    const source = { group: item.group, id: item.id, layer: rule.layer }
    if (!nodes.has(layerKey(source)) || !nodes.has(layerKey(rule.target))) continue
    const [before, after] = rule.relation === 'above' ? [rule.target, source] : [source, rule.target]
    edges.get(layerKey(before))!.add(layerKey(after))
  }
  const activation = new Map(selected.items.map((ref, index) => [itemKey(ref), index]))
  const compare = (a: T, b: T) => plane(a) - plane(b) ||
    (selected.smartOrder ? defaultOrder(byItem.get(itemKey(a))!, a.layer) - defaultOrder(byItem.get(itemKey(b))!, b.layer) : 0) ||
    (activation.get(itemKey(a)) ?? 100) - (activation.get(itemKey(b)) ?? 100) || layerKey(a).localeCompare(layerKey(b))
  const baseline = new Map([...layers].sort(compare).map((node, index) => [layerKey(node), index]))
  const priorities = new Map<string, number>(), visiting = new Set<string>()
  const priority = (key: string): number => {
    if (priorities.has(key)) return priorities.get(key)!
    if (visiting.has(key)) throw new Error('Character layer order contains a cycle; remove a conflicting above/below rule')
    visiting.add(key)
    const rank = Math.min(baseline.get(key)!, ...[...edges.get(key)!].map(priority))
    visiting.delete(key)
    priorities.set(key, rank)
    return rank
  }
  for (const key of nodes.keys()) priority(key)
  const result: T[] = []
  // ponytail: at most 100 items / 200 layers; quadratic scan keeps cycle handling small and deterministic.
  while (nodes.size) {
    const incoming = new Set([...edges.values()].flatMap((targets) => [...targets]))
    const next = [...nodes.values()].filter((node) => !incoming.has(layerKey(node))).sort((a, b) => priorities.get(layerKey(a))! - priorities.get(layerKey(b))! || compare(a, b))[0]
    if (!next) throw new Error('Character layer order contains a cycle; remove a conflicting above/below rule')
    result.push(next)
    nodes.delete(layerKey(next))
    edges.delete(layerKey(next))
  }
  return result
}

/** Validate declared layers, even before pixels exist, so dormant cycles cannot appear later. */
export function validateItemComposition(items: Item[]) {
  for (const item of items) {
    const composition = item.metadata?.composition
    if (composition === undefined) continue
    if (!composition || typeof composition !== 'object' || Array.isArray(composition) || item.group === 'body' || Object.keys(composition).some((key) => !['exclusiveKeys', 'order'].includes(key))) throw new Error('Invalid item composition')
    const keys = composition.exclusiveKeys ?? []
    if (!Array.isArray(keys) || keys.length > 8 || new Set(keys).size !== keys.length || keys.some((key) => typeof key !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(key))) throw new Error('Exclusive keys must be up to 8 unique lowercase identifiers')
    const rules = composition.order ?? []
    if (!Array.isArray(rules) || rules.length > 16) throw new Error('Item order is limited to 16 relations')
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Object.keys(rule).some((key) => !['layer', 'relation', 'target'].includes(key)) ||
        !['above', 'below'].includes(rule.relation) || !(CHARACTER_VARIANT_LAYERS[item.group] as readonly string[]).includes(rule.layer) ||
        !rule.target || typeof rule.target !== 'object' || Object.keys(rule.target).some((key) => !['group', 'id', 'layer'].includes(key))) throw new Error('Invalid layer relation')
      const target = items.find((candidate) => sameItem(candidate, rule.target))
      if (!target || sameItem(item, target) || !(CHARACTER_VARIANT_LAYERS[target.group] as readonly string[]).includes(rule.target.layer)) throw new Error('Layer relation target is missing or invalid')
      const source = { ...item, layer: rule.layer }
      if (plane(source) !== plane(rule.target)) throw new Error('Layer relations must stay on the same side of the Canonical Body')
    }
  }
  orderItemLayers(items, items.flatMap((item) => CHARACTER_VARIANT_LAYERS[item.group].map((layer) => ({ group: item.group, id: item.id, layer }))), { smartOrder: true, items: [] })
}

/** Pre-v7 categories had no cross-category chronology; preserve their former paint order. */
export function migrateItemSelection(value: unknown, version: number): CharacterSelection {
  if (version === 7) return value as CharacterSelection
  const old = value as Record<string, unknown>
  if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error('Invalid Character selection')
  const outfits = version === 4 ? (old.outfit === undefined ? [] : [old.outfit]) : version === 5 ? CHARACTER_OUTFIT_SLOTS.flatMap((slot) => { const id = (old.outfits as Record<string, unknown> | undefined)?.[slot]; return id === undefined ? [] : [id] }) : old.outfits
  if (!Array.isArray(outfits) || !Array.isArray(old.props)) throw new Error('Invalid legacy Character selection')
  return { smartOrder: true, items: [
    ...outfits.map((id) => ({ group: 'outfit' as const, id: id as string })),
    ...(['expression', 'hair', 'headwear'] as const).flatMap((group) => old[group] === undefined ? [] : [{ group, id: old[group] as string }]),
    ...old.props.map((id) => ({ group: 'prop' as const, id: id as string })),
  ] }
}
