import assert from 'node:assert/strict'

import { RENDER_MODE_STORAGE_KEY, parseRenderMode, readStoredRenderMode, writeStoredRenderMode } from '../src/ui/render-mode.ts'

assert.equal(parseRenderMode('2d'), '2d')
assert.equal(parseRenderMode('3d'), '3d')
assert.equal(parseRenderMode('voxel'), '2d')
assert.equal(parseRenderMode(undefined), '2d')

const memory = new Map<string, string>()
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
}

assert.equal(readStoredRenderMode(storage), '2d')
writeStoredRenderMode('3d', storage)
assert.equal(memory.get(RENDER_MODE_STORAGE_KEY), '3d')
assert.equal(readStoredRenderMode(storage), '3d')
writeStoredRenderMode('2d', storage)
assert.equal(readStoredRenderMode(storage), '2d')

console.log('render mode: ok')
