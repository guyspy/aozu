import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SkinnedMesh, Texture } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { createGlbAssetPool, disposeGlbModel } from '../src/adapters/browser/glb-asset.ts'
import { createDemandRenderLoop } from '../src/adapters/browser/demand-render-loop.ts'
import { createSkinnedDemo } from '../src/adapters/browser/glb-character-viewer.ts'
import { createCharacter3DPreview } from '../src/core/application/character-3d.ts'

// Preserve the renderer boundary check formerly housed in the unused VOX test.
const core = new URL('../src/core/', import.meta.url)
for (const file of readdirSync(core, { recursive: true }) as string[]) {
  if (file.endsWith('.ts')) assert.doesNotMatch(readFileSync(new URL(file, core), 'utf8'), /from ['"]three(?:\/|['"])/, `${file} must not import Three`)
}

const bytes = readFileSync(new URL('../public/glb/demo-viking.glb', import.meta.url))
const loader = new GLTFLoader()
const load = () => loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
let loads = 0
const pool = createGlbAssetPool(() => { loads++; return load() })
const a = pool.acquire(), b = pool.acquire()
const [first, second] = await Promise.all([a.ready, b.ready])
assert.equal(loads, 1, 'concurrent viewers share loading and parsing')
const one = createSkinnedDemo(first!), two = createSkinnedDemo(second!)
const preview = createCharacter3DPreview()
one.apply(preview.getSnapshot()); two.apply(preview.getSnapshot())
assert.equal(one.body.geometry, two.body.geometry)
assert.equal(one.body.material, two.body.material)
assert.notEqual(one.body.skeleton, two.body.skeleton)
assert.notEqual(one.body.skeleton.bones[0], two.body.skeleton.bones[0])
assert.equal(one.body.skeleton, one.armor.skeleton)
assert.equal(two.body.skeleton, two.helmet.skeleton)
preview.configure({ expectedRevision: 0, armor: false, expression: 'happy', seek: .4, playing: false })
one.apply(preview.getSnapshot())
assert.equal(two.armor.visible, true)
assert.equal(two.body.morphTargetInfluences![two.body.morphTargetDictionary!.happy], 0)
assert.equal(two.mixer.time, 0)
let geometryDisposals = 0, boneDisposals = 0
one.body.geometry.addEventListener('dispose', () => { geometryDisposals++ })
one.body.skeleton.computeBoneTexture()
one.body.skeleton.boneTexture!.addEventListener('dispose', () => { boneDisposals++ })
one.dispose(); a.release(); a.release()
assert.equal(boneDisposals, 1, 'release each instance bone palette once')
assert.equal(geometryDisposals, 0, 'a surviving viewer retains shared geometry')
two.update(.1)
assert.ok(two.mixer.time > 0)
two.dispose(); b.release()
assert.equal(geometryDisposals, 1, 'the last viewer frees the shared asset')
const c = pool.acquire(); await c.ready; c.release()
assert.equal(loads, 2, 'the released template is not retained indefinitely')

// Unmount all viewers before loading completes; then retry without leaked resources.
let resolve!: (gltf: GLTF) => void
const pendingPool = createGlbAssetPool(() => new Promise<GLTF>(done => { resolve = done }))
const abandoned = pendingPool.acquire()
abandoned.release()
const late = await load()
let lateDisposals = 0
;(late.scene.getObjectByName('VikingBody') as SkinnedMesh).geometry.addEventListener('dispose', () => { lateDisposals++ })
resolve(late)
assert.equal(await abandoned.ready, undefined)
assert.equal(lateDisposals, 1, 'late load is disposed without cloning or mounting')
let attempts = 0
const retryPool = createGlbAssetPool(() => ++attempts === 1 ? Promise.reject(new Error('offline')) : load())
const failed = retryPool.acquire()
await assert.rejects(failed.ready, /offline/)
const retry = retryPool.acquire()
failed.release()
assert.ok(await retry.ready)
retry.release()
assert.equal(attempts, 2, 'failed loads do not poison the cache')

// Materials do not own texture disposal; shared mesh resources need deduplication.
const texture = new Texture(), geometry = new BoxGeometry(), material = new MeshStandardMaterial({ map: texture, normalMap: texture })
const model = new Group()
model.add(new Mesh(geometry, material), new Mesh(geometry, [material, material]))
const disposals = { texture: 0, geometry: 0, material: 0 }
for (const [key, resource] of Object.entries({ texture, geometry, material })) resource.addEventListener('dispose', () => { disposals[key as keyof typeof disposals]++ })
disposeGlbModel(model)
assert.deepEqual(disposals, { texture: 1, geometry: 1, material: 1 })

// Drive actual demand scheduling with a deterministic browser frame queue.
const savedRequest = globalThis.requestAnimationFrame, savedCancel = globalThis.cancelAnimationFrame
let nextId = 0, moving = false
const frames = new Map<number, FrameRequestCallback>(), deltas: number[] = []
globalThis.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId }
globalThis.cancelAnimationFrame = id => { frames.delete(id) }
try {
  const loop = createDemandRenderLoop(delta => { deltas.push(delta); return moving })
  const tick = (time: number) => {
    assert.equal(frames.size, 1)
    const [id, callback] = frames.entries().next().value!
    frames.delete(id); callback(time)
  }
  loop.invalidate(); loop.invalidate(); tick(100)
  assert.equal(frames.size, 0, 'paused/static viewers render once then sleep')
  moving = true; loop.invalidate(); tick(5000)
  assert.equal(deltas.at(-1), 0, 'idle time never advances playback')
  tick(5020); assert.ok(Math.abs(deltas.at(-1)! - .02) < 1e-6)
  loop.setVisible(false); loop.invalidate()
  assert.equal(frames.size, 0, 'hidden/offscreen viewers have no pending frame')
  loop.setVisible(true); tick(10000); assert.equal(deltas.at(-1), 0)
  tick(11000); assert.equal(deltas.at(-1), .05, 'a slow frame clamps the delta')
  moving = false; tick(11020); assert.equal(frames.size, 0)
  loop.invalidate(); loop.destroy(); loop.setVisible(true); loop.invalidate()
  assert.equal(frames.size, 0, 'unmount cancels work and cannot resurrect the loop')
} finally {
  if (savedRequest) globalThis.requestAnimationFrame = savedRequest
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  if (savedCancel) globalThis.cancelAnimationFrame = savedCancel
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
}
console.log('3D lifecycle: shared loading, independent rigs/morphs, release/retry races, resource disposal and demand rendering ok')
