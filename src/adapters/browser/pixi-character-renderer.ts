import { Application, ColorMatrixFilter, Container, Rectangle, Sprite, Spritesheet, Texture } from 'pixi.js'
import 'pixi.js/advanced-blend-modes'

import { CHARACTER_RIG, IDENTITY_CHARACTER_TRANSFORM, type CharacterTextureAtlas, type CharacterVariantTransform } from '../../core/domain/character.ts'

export type CharacterRenderLayer = { id: string; blob: Blob; slotOrder: number; layerOrder: number; transform?: CharacterVariantTransform }
export type CharacterRenderView = {
  layers: CharacterRenderLayer[]
  referenceLayers?: CharacterRenderLayer[]
  mode?: 'composite' | 'overlay' | 'difference' | 'diagnostic'
  atlas?: CharacterTextureAtlas
}

/** One renderer per stage. Editing transforms changes sprites, never image pixels or an atlas. */
export async function mountCharacterRenderer(host: HTMLElement) {
  const app = new Application()
  try {
    await app.init({ ...CHARACTER_RIG.canvas, backgroundAlpha: 0, antialias: false, autoStart: false })
  } catch (error) {
    if (app.renderer) app.destroy(true, { children: true })
    throw error
  }
  const canvas = app.canvas as HTMLCanvasElement
  canvas.className = 'size-full'
  host.replaceChildren(canvas)
  const reference = app.stage.addChild(new Container())
  const candidate = app.stage.addChild(new Container())
  reference.filterArea = candidate.filterArea = new Rectangle(0, 0, CHARACTER_RIG.canvas.width, CHARACTER_RIG.canvas.height)
  const sprites = [new Map<string, Sprite>(), new Map<string, Sprite>()]
  const tint = (r: number, g: number, b: number) => {
    const filter = new ColorMatrixFilter()
    filter.matrix = [0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0, 0, 0, 1, 0]
    return filter
  }
  const cyan = tint(0, 1, 1)
  const magenta = tint(1, 0, 1)
  type Source = { bitmap: ImageBitmap; texture: Texture; sheet?: Spritesheet; bytes: number }
  const sources = new Map<Blob, Source>()
  let active = new Set<Blob>()
  let revision = 0
  let destroyed = false
  let currentMode: CharacterRenderView['mode']
  let queue = Promise.resolve()
  const release = (source: Source) => {
    if (source.sheet) source.sheet.destroy(true)
    else source.texture.destroy(true)
    source.bitmap.close()
  }
  const trim = () => {
    let bytes = [...sources.values()].reduce((sum, source) => sum + source.bytes, 0)
    // Keep recent variants within 32 MiB of decoded RGBA. Visible layers are never evicted.
    for (const [blob, source] of sources) {
      if (bytes <= 32 * 1024 * 1024) break
      if (active.has(blob)) continue
      sources.delete(blob)
      bytes -= source.bytes
      release(source)
    }
  }
  const load = async (blob: Blob, atlas?: CharacterTextureAtlas) => {
    const existing = sources.get(blob)
    if (existing) {
      sources.delete(blob)
      sources.set(blob, existing)
      return existing
    }
    const bitmap = await createImageBitmap(blob)
    if (destroyed) { bitmap.close(); return }
    let texture: Texture | undefined
    let sheet: Spritesheet | undefined
    try {
      texture = Texture.from(bitmap, true)
      if (atlas) {
        sheet = new Spritesheet(texture, atlas.data)
        await sheet.parse()
      }
      const source = { bitmap, texture, sheet, bytes: bitmap.width * bitmap.height * 4 }
      if (destroyed) { release(source); return }
      sources.set(blob, source)
      return source
    } catch (error) {
      if (sheet) sheet.destroy(true)
      else texture?.destroy(true)
      bitmap.close()
      throw error
    }
  }
  const paint = (container: Container, index: number, layers: CharacterRenderLayer[], atlas?: CharacterTextureAtlas) => {
    const retained = new Set(layers.map(({ id }) => id))
    for (const [id, sprite] of sprites[index]!) {
      if (retained.has(id)) continue
      sprite.destroy()
      sprites[index]!.delete(id)
    }
    container.sortableChildren = true
    layers.forEach((layer, order) => {
      const source = sources.get(atlas?.image ?? layer.blob)!
      const texture = atlas ? source.sheet?.textures[layer.id] : source.texture
      if (!texture) throw new Error(`Character texture is missing: ${layer.id}`)
      let sprite = sprites[index]!.get(layer.id)
      if (!sprite) {
        sprite = container.addChild(new Sprite(texture))
        sprites[index]!.set(layer.id, sprite)
      }
      sprite.texture = texture
      sprite.zIndex = order
      const transform = atlas ? IDENTITY_CHARACTER_TRANSFORM : layer.transform ?? IDENTITY_CHARACTER_TRANSFORM
      sprite.position.set(transform.x, transform.y)
      sprite.scale.set(transform.scale)
    })
  }
  return {
    update(view: CharacterRenderView): Promise<boolean> {
      const ticket = ++revision
      const result = queue.then(async () => {
        if (destroyed || ticket !== revision) return false
        const mode = view.mode ?? 'composite'
        const refs = mode === 'composite' ? [] : view.referenceLayers ?? []
        const needed = new Set([...refs.map(({ blob }) => blob), ...(view.atlas ? [view.atlas.image] : view.layers.map(({ blob }) => blob))])
        try {
          for (const blob of needed) {
            await load(blob, view.atlas?.image === blob ? view.atlas : undefined)
            if (destroyed || ticket !== revision) return false
          }
          paint(reference, 0, refs)
          paint(candidate, 1, view.layers, view.atlas)
          if (mode !== currentMode) {
            reference.alpha = mode === 'difference' ? 1 : mode === 'diagnostic' ? 0.65 : 0.45
            candidate.alpha = mode === 'composite' || mode === 'difference' ? 1 : 0.65
            reference.filters = mode === 'diagnostic' ? [cyan] : []
            candidate.filters = mode === 'diagnostic' ? [magenta] : []
            reference.blendMode = mode === 'diagnostic' ? 'screen' : 'normal'
            candidate.blendMode = mode === 'difference' ? 'difference' : mode === 'diagnostic' ? 'screen' : 'normal'
            currentMode = mode
          }
          app.render()
          active = needed
          return true
        } finally { if (!destroyed) trim() }
      })
      queue = result.then(() => {}, () => {})
      return result
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      revision++
      app.destroy(true, { children: true })
      for (const source of sources.values()) release(source)
      sources.clear()
      cyan.destroy()
      magenta.destroy()
    },
  }
}
