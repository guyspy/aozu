export const CHARACTER_3D_TRIGGERS = ['inspect-3d-character', 'configure-3d-preview'] as const
export const DEMO_GLB_URL = '/glb/demo-viking.glb'
export const CHARACTER_3D_CLIPS = ['idle', 'walk', 'battle-ready', 'attack', 'cheer', 'wave'] as const
export const CHARACTER_3D_EXPRESSIONS = ['neutral', 'happy', 'angry'] as const
export const CHARACTER_3D_WEAPONS = ['none', 'axe', 'sword'] as const

// One closed contract for Mantle schemas and the application boundary. No renderer types.
export const CHARACTER_3D_CONFIG_PROPERTIES = {
  expectedRevision: { type: 'integer', minimum: 0 },
  clipName: { type: 'string', enum: [...CHARACTER_3D_CLIPS] },
  playing: { type: 'boolean' },
  loop: { type: 'boolean' },
  timeScale: { type: 'number', minimum: 0, maximum: 3 },
  crossfade: { type: 'number', minimum: 0, maximum: 2 },
  seek: { type: 'number', minimum: 0, maximum: 1, description: 'Seek to a fraction of the selected clip; 0 restarts. Use playing:false to hold a pose. Skips crossfade.' },
  armor: { type: 'boolean' },
  helmet: { type: 'boolean' },
  weapon: { type: 'string', enum: [...CHARACTER_3D_WEAPONS] },
  expression: { type: 'string', enum: [...CHARACTER_3D_EXPRESSIONS] },
  expressionWeight: { type: 'number', minimum: 0, maximum: 1 },
  skeleton: { type: 'boolean' },
} as const

export type Preview3D = Readonly<{
  revision: number
  clipName: typeof CHARACTER_3D_CLIPS[number]
  playing: boolean
  loop: boolean
  timeScale: number
  crossfade: number
  seek: number
  playbackRevision: number
  armor: boolean
  helmet: boolean
  weapon: typeof CHARACTER_3D_WEAPONS[number]
  expression: typeof CHARACTER_3D_EXPRESSIONS[number]
  expressionWeight: number
  skeleton: boolean
}>
export type Preview3DPatch = Partial<Omit<Preview3D, 'revision' | 'playbackRevision'>>

// Workshop cards are a projection of the preview, never a second inventory or PNG draft.
export const CHARACTER_3D_SLOTS = [
  { group: 'expression', id: 'happy', label: 'Happy' },
  { group: 'expression', id: 'angry', label: 'Angry' },
  { group: 'outfit', id: 'armor', label: 'Armor' },
  { group: 'outfit', id: 'helmet', label: 'Helmet' },
  { group: 'prop', id: 'axe', label: 'Axe' },
  { group: 'prop', id: 'sword', label: 'Sword' },
] as const
export type Character3DSlot = typeof CHARACTER_3D_SLOTS[number]
export const isCharacter3DSlotSelected = (state: Preview3D, slot: Character3DSlot) =>
  slot.group === 'outfit' ? state[slot.id] : slot.group === 'prop' ? state.weapon === slot.id : state.expression === slot.id

export function createCharacter3DPreview() {
  let state: Preview3D = Object.freeze({
    revision: 0, clipName: 'idle', playing: true, loop: true, timeScale: 1, crossfade: .25,
    seek: 0, playbackRevision: 0, armor: true, helmet: true, weapon: 'axe',
    expression: 'neutral', expressionWeight: 1, skeleton: false,
  })
  const listeners = new Set<() => void>()
  const inspect = () => ({
    asset: DEMO_GLB_URL, scope: 'shared-tab-demo', persistence: 'none', boneMap: 'VRM-1.0-semantics',
    animations: [...CHARACTER_3D_CLIPS], expressions: [...CHARACTER_3D_EXPRESSIONS],
    equipment: { armor: 'shared-skeleton mesh', helmet: 'shared-skeleton mesh', weapons: [...CHARACTER_3D_WEAPONS] },
    slots: CHARACTER_3D_SLOTS.map(slot => ({ ...slot, selected: isCharacter3DSlotSelected(state, slot) })),
    sockets: ['rightHand'], handPoses: { none: 'hands-open', equipped: 'hands-grip' },
    playback: { seek: 'normalized clip position; command value, not a live clock', crossfade: 'seconds at 1x; next clip switch', once: 'holds final pose; seek:0 to replay' },
    state,
  })
  const configure = (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('Expected preview configuration')
    const value = input as Record<string, unknown>
    for (const [key, field] of Object.entries(value)) {
      if (!Object.hasOwn(CHARACTER_3D_CONFIG_PROPERTIES, key)) throw new Error(`Unknown preview field: ${key}`)
      const rule = CHARACTER_3D_CONFIG_PROPERTIES[key as keyof typeof CHARACTER_3D_CONFIG_PROPERTIES]
      if (rule.type === 'boolean' && typeof field !== 'boolean') throw new Error(`${key} must be boolean`)
      if (rule.type === 'string' && (typeof field !== 'string' || !(rule.enum as readonly string[]).includes(field))) throw new Error(`Unsupported ${key}`)
      if ((rule.type === 'number' || rule.type === 'integer') && (typeof field !== 'number' || !Number.isFinite(field) || field < rule.minimum || ('maximum' in rule && field > rule.maximum) || (rule.type === 'integer' && !Number.isSafeInteger(field)))) throw new Error(`Invalid ${key}`)
    }
    if (!Object.hasOwn(value, 'expectedRevision') || value.expectedRevision !== state.revision) throw new Error('Preview revision conflict; inspect again')
    const { expectedRevision: _, ...patch } = value
    const changedClip = patch.clipName !== undefined && patch.clipName !== state.clipName
    state = Object.freeze({
      ...state, ...patch as Preview3DPatch, revision: state.revision + 1,
      seek: patch.seek as number ?? (changedClip ? 0 : state.seek),
      playbackRevision: state.playbackRevision + (Object.hasOwn(patch, 'seek') ? 1 : 0),
    })
    for (const listener of listeners) listener()
    return inspect()
  }
  const toggleSlot = (slot: Character3DSlot) => {
    const selected = isCharacter3DSlotSelected(state, slot)
    const patch: Preview3DPatch = slot.group === 'outfit' ? { [slot.id]: !selected }
      : slot.group === 'prop' ? { weapon: selected ? 'none' : slot.id }
      : { expression: slot.id }
    return configure({ expectedRevision: state.revision, ...patch })
  }
  const clearSlots = (group: Character3DSlot['group']) => configure({
    expectedRevision: state.revision,
    ...(group === 'outfit' ? { armor: false, helmet: false } : group === 'prop' ? { weapon: 'none' } : { expression: 'neutral' }),
  })
  return { inspect, configure, toggleSlot, clearSlots, getSnapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
}
export const character3DPreview = createCharacter3DPreview()
