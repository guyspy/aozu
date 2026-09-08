import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { Bounds, FilterSystem, RendererType } from 'pixi.js'

// Exercise the real scheduling/cache/controller code without a browser or GPU.
const applications: Application[] = []
class Container {
  children: Container[] = []
  parent?: Container
  alpha = 1
  filters: unknown[] = []
  blendMode = 'normal'
  addChild<T extends Container>(child: T): T { this.children.push(child); child.parent = this; return child }
  destroy() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); for (const child of [...this.children]) child.destroy() }
}
class Application {
  stage = new Container()
  canvas = { className: '' }
  renders = 0
  renderer = { type: RendererType.WEBGL, backBuffer: { useBackBuffer: false } }
  destroyed = false
  async init(options: { autoStart: boolean; useBackBuffer?: boolean }) {
    assert.equal(options.autoStart, false)
    this.renderer.backBuffer.useBackBuffer = options.useBackBuffer ?? false
    applications.push(this)
  }
  render() {
    assert.equal(this.destroyed, false)
    if (this.stage.children[1]?.blendMode === 'difference') {
      // Run Pixi's real WebGL blend-filter gate using the production init options.
      const data = { bounds: new Bounds(0, 0, 512, 768), skip: false, blendRequired: false, filters: [{
        enabled: true, resolution: 1, padding: 0, antialias: 'off', clipToViewport: true,
        compatibleRenderers: RendererType.WEBGL, blendRequired: true,
      }] }
      FilterSystem.prototype._calculateFilterBounds.call({ renderer: this.renderer }, data, { width: 512, height: 768 }, false, 1, 1)
      assert.equal(data.skip, false, 'Pixi skipped the Difference filter')
      assert.equal(data.blendRequired, true)
    }
    this.renders++
  }
  destroy() { this.destroyed = true; this.stage.destroy() }
}
class Texture {
  destroyed = false
  bitmap: Bitmap
  constructor(bitmap: Bitmap) { this.bitmap = bitmap }
  static from(bitmap: Bitmap) { return new Texture(bitmap) }
  destroy(source: boolean) { assert.equal(source, true); assert.equal(this.destroyed, false); this.destroyed = true }
}
class Sprite extends Container {
  texture: Texture
  zIndex = 0
  position = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y } }
  scale = { x: 1, set(x: number) { this.x = x } }
  constructor(texture: Texture) { super(); this.texture = texture }
}
class ColorMatrixFilter { matrix: number[] = []; destroy() {} }
class Spritesheet {
  textures: Record<string, Texture>
  texture: Texture
  constructor(texture: Texture, data: { frames: Record<string, unknown> }) { this.texture = texture; this.textures = Object.fromEntries(Object.keys(data.frames).map((id) => [id, texture])) }
  async parse() {}
  destroy() { this.texture.destroy(true) }
}
mock.module('pixi.js', { namedExports: { Application, Container, Sprite, Texture, ColorMatrixFilter, Spritesheet, Rectangle: class {} } })
mock.module('pixi.js/advanced-blend-modes', { namedExports: {} })
const { mountCharacterRenderer } = await import('../src/adapters/browser/pixi-character-renderer.ts')
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }
type Bitmap = { width: number; height: number; closed: boolean; close(): void }
const bitmaps: Bitmap[] = []
const reads: Blob[] = []
const gates = new Map<Blob, ReturnType<typeof deferred>>()
const failures = new Set<Blob>()
const large = new Blob(['large'])
const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (blob: Blob) => {
  reads.push(blob)
  await gates.get(blob)?.promise
  if (failures.has(blob)) throw new Error('Decode failed')
  const bitmap: Bitmap = { width: blob === large ? 4096 : 512, height: blob === large ? 4096 : 768, closed: false,
    close() { assert.equal(this.closed, false, 'Bitmap closed twice'); this.closed = true } }
  bitmaps.push(bitmap)
  return bitmap
} })
const layer = (blob: Blob, id = 'body') => ({ id, blob, slotOrder: 1, layerOrder: 1, transform: { x: 0, y: 0, scale: 1 } })
const host = { replaceChildren() {} } as unknown as HTMLElement
try {
  const controller = await mountCharacterRenderer(host)
  const app = applications[0]!
  const a = new Blob(['a']), b = new Blob(['b'])
  const initial = layer(a)
  assert.equal(await controller.update({ layers: [initial] }), true)
  const sprite = app.stage.children[1]!.children[0] as Sprite
  assert.equal(await controller.update({ layers: [{ ...initial, transform: { x: 20, y: -8, scale: 1.2 } }] }), true)
  assert.equal(app.stage.children[1]!.children[0], sprite, 'Transform recreated the sprite')
  assert.equal(sprite.position.x, 20)
  assert.equal(sprite.position.y, -8)
  assert.equal(sprite.scale.x, 1.2)
  assert.equal(reads.length, 1, 'Transform decoded the PNG again')
  for (const mode of ['overlay', 'difference', 'diagnostic', 'composite'] as const) {
    await controller.update({ layers: [initial], referenceLayers: [initial], mode })
    assert.equal(app.stage.children[1]!.blendMode, mode === 'difference' ? 'difference' : mode === 'diagnostic' ? 'screen' : 'normal')
  }
  assert.equal(reads.length, 1, 'Alignment mode decoded unchanged layers')
  assert.equal(applications.length, 1)
  await controller.update({ layers: [layer(b)] })
  await controller.update({ layers: [initial] })
  assert.deepEqual(reads, [a, b], 'A → B → A did not reuse textures')

  // Superseded work can finish its in-flight decode, but must stop before reading remaining layers.
  const slow = new Blob(['slow']), skipped = new Blob(['skipped'])
  gates.set(slow, deferred())
  const pending = controller.update({ layers: [layer(slow), layer(skipped, 'head')] })
  await new Promise((resolve) => setImmediate(resolve))
  const latest = controller.update({ layers: [initial] })
  gates.get(slow)!.resolve()
  assert.equal(await pending, false)
  assert.equal(await latest, true)
  assert.equal(reads.includes(skipped), false)
  assert.equal((app.stage.children[1]!.children[0] as Sprite).texture.bitmap, bitmaps[0])

  const bad = new Blob(['bad'])
  failures.add(bad)
  await assert.rejects(controller.update({ layers: [layer(bad)] }), /Decode failed/)
  failures.delete(bad)
  assert.equal(await controller.update({ layers: [layer(bad)] }), true, 'Rejected decode poisoned the queue')

  await controller.update({ layers: [layer(large)] })
  const huge = bitmaps.at(-1)!
  assert.equal(huge.closed, false, 'Visible texture was evicted')
  await controller.update({ layers: [initial] })
  assert.equal(huge.closed, true, 'Inactive texture exceeded the memory budget')

  // Portable atlases already contain baked transforms; preserve that consumer without double-scaling.
  const atlasBlob = new Blob(['atlas'])
  const atlas = { image: atlasBlob, data: { frames: { body: {} }, meta: {} } } as unknown as import('../src/core/domain/character.ts').CharacterTextureAtlas
  await controller.update({ atlas, layers: [{ ...initial, transform: { x: 20, y: 8, scale: 2 } }] })
  const atlasSprite = app.stage.children[1]!.children[0] as Sprite
  assert.equal(atlasSprite.position.x, 0)
  assert.equal(atlasSprite.scale.x, 1)

  const late = new Blob(['late'])
  gates.set(late, deferred())
  const closing = controller.update({ layers: [layer(late)] })
  await new Promise((resolve) => setImmediate(resolve))
  const renders = app.renders
  controller.destroy()
  gates.get(late)!.resolve()
  assert.equal(await closing, false)
  assert.equal(app.renders, renders, 'Late decode rendered after unmount')
  assert.ok(bitmaps.every(({ closed }) => closed), 'Unmount leaked decoded images')
  controller.destroy()
} finally {
  if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap)
  else Reflect.deleteProperty(globalThis, 'createImageBitmap')
  mock.restoreAll()
}
console.log('character renderer: transform reuse, selection cache, stale work, failure retry, memory budget and teardown ok')
