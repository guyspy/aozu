import { useCallback, useSyncExternalStore } from 'react'

export const RENDER_MODES = ['2d', '3d'] as const
export type RenderMode = (typeof RENDER_MODES)[number]
export const RENDER_MODE_STORAGE_KEY = 'companion-render-mode'
export const DEFAULT_DEMO_VOX_URL = '/vox/demo-character.vox'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const isRenderMode = (value: unknown): value is RenderMode => value === '2d' || value === '3d'

export const parseRenderMode = (value: unknown): RenderMode => isRenderMode(value) ? value : '2d'

export const readStoredRenderMode = (storage?: StorageLike): RenderMode => {
  try {
    return parseRenderMode((storage ?? globalThis.localStorage)?.getItem(RENDER_MODE_STORAGE_KEY))
  } catch {
    return '2d'
  }
}

export const writeStoredRenderMode = (mode: RenderMode, storage?: StorageLike): void => {
  try {
    (storage ?? globalThis.localStorage)?.setItem(RENDER_MODE_STORAGE_KEY, mode)
  } catch { /* storage may be unavailable */ }
}

let current = readStoredRenderMode()
const listeners = new Set<() => void>()

export const getRenderMode = (): RenderMode => current

export const setRenderMode = (mode: RenderMode): void => {
  if (mode === current) return
  current = mode
  writeStoredRenderMode(mode)
  for (const listen of listeners) listen()
}

export const subscribeRenderMode = (listen: () => void): (() => void) => {
  listeners.add(listen)
  return () => { listeners.delete(listen) }
}

export function useRenderMode(): [RenderMode, (mode: RenderMode) => void] {
  const mode = useSyncExternalStore(subscribeRenderMode, getRenderMode, getRenderMode)
  return [mode, useCallback((next: RenderMode) => { setRenderMode(next) }, [])]
}
