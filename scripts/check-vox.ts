import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VOXLoader } from 'three/addons/loaders/VOXLoader.js'

import { DEMO_VOX_RELATIVE_PATH, buildDemoCharacterVox, inspectVox } from './demo-vox.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, DEMO_VOX_RELATIVE_PATH)
const generated = buildDemoCharacterVox()
const committed = new Uint8Array(readFileSync(dest))
assert.deepEqual(committed, generated, `${DEMO_VOX_RELATIVE_PATH} is out of date; run node --experimental-strip-types scripts/generate-demo-vox.ts`)

const info = inspectVox(committed)
assert.equal(info.version, 150)
assert.ok(info.voxelCount > 20)
assert.deepEqual(info.size, { x: 9, y: 7, z: 16 })

const parsed = new VOXLoader().parse(committed.buffer.slice(committed.byteOffset, committed.byteOffset + committed.byteLength)) as {
  chunks?: Array<{ data?: Uint8Array; size?: { x: number; y: number; z: number } }>
  scene?: unknown
}
assert.ok(parsed?.chunks?.length, 'official VOXLoader did not return chunks')
assert.equal(parsed.chunks![0]!.size?.x, 9)
assert.equal((parsed.chunks![0]!.data?.length ?? 0) / 4, info.voxelCount)

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  return entry.isDirectory() ? walk(path) : [path]
})

for (const file of walk(join(root, 'src/core'))) {
  const text = readFileSync(file, 'utf8')
  assert.doesNotMatch(text, /from ['"]three(?:\/|['"])/, `${relative(root, file)} must not import three`)
}

console.log('vox: ok')
