export const CHARACTER_3D_TRIGGERS = ['inspect-3d-character', 'configure-3d-preview'] as const
export const DEMO_GLB_URL = '/glb/demo-humanoid.glb'
export type Preview3D = Readonly<{ revision: number; happy: number; prop: boolean; playing: boolean; skeleton: boolean }>
export function createCharacter3DPreview() {
  let state: Preview3D = Object.freeze({ revision: 0, happy: 0, prop: false, playing: false, skeleton: false })
  const listeners = new Set<() => void>()
  const inspect = () => ({ asset: DEMO_GLB_URL, scope: 'shared-tab-demo', persistence: 'none', boneMap: 'VRM-1.0-semantics', expressions: ['happy'], sockets: ['rightHand'], clothing: 'deferred', state })
  const configure = (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected preview configuration')
    const value = input as Record<string, unknown>
    if (Object.keys(value).some(k => !['expectedRevision', 'happy', 'prop', 'playing', 'skeleton'].includes(k))) throw new Error('Unknown preview field')
    if (!Number.isInteger(value.expectedRevision) || value.expectedRevision !== state.revision) throw new Error('Preview revision conflict; inspect again')
    if (value.happy !== undefined && (typeof value.happy !== 'number' || !Number.isFinite(value.happy) || value.happy < 0 || value.happy > 1)) throw new Error('happy must be between 0 and 1')
    for (const key of ['prop', 'playing', 'skeleton']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`${key} must be boolean`)
    state = Object.freeze({ revision: state.revision + 1, happy: value.happy as number ?? state.happy, prop: value.prop as boolean ?? state.prop, playing: value.playing as boolean ?? state.playing, skeleton: value.skeleton as boolean ?? state.skeleton })
    for (const listener of listeners) listener()
    return inspect()
  }
  return { inspect, configure, getSnapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
}
export const character3DPreview = createCharacter3DPreview()
