import { Mesh, SkinnedMesh, Texture, type Material, type Object3D } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { DEMO_GLB_URL } from '../../core/application/character-3d.ts'

export function disposeGlbModel(model: Object3D, sharedResources = true) {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>()
  const textures = new Set<Texture>(), images = new Set<ImageBitmap>()
  const skeletons = new Set<SkinnedMesh['skeleton']>()
  model.traverse(node => {
    if (sharedResources && node instanceof Mesh) {
      geometries.add(node.geometry)
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
    }
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton)
  })
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    material.dispose()
  }
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image)
    texture.dispose()
  }
  for (const image of images) image.close()
  for (const geometry of geometries) geometry.dispose()
  for (const skeleton of skeletons) skeleton.dispose()
}

// One decoded fixture while viewers are mounted. Mesh resources are shared;
// bones, morph weights, visibility and mixer bindings belong to each lease.
export function createGlbAssetPool(load: () => Promise<GLTF>) {
  type Entry = { ready: Promise<GLTF>; users: number; source?: GLTF }
  let entry: Entry | undefined
  return {
    acquire() {
      if (!entry) {
        const created: Entry = { users: 0, ready: load().then(source => {
          created.source = source
          if (!created.users) {
            disposeGlbModel(source.scene)
            if (entry === created) entry = undefined
          }
          return source
        }, error => {
          if (entry === created) entry = undefined
          throw error
        }) }
        entry = created
      }
      const current = entry
      current.users++
      let released = false, instance: GLTF | undefined
      return {
        ready: current.ready.then(source => {
          if (released) return undefined
          const scene = clone(source.scene) as GLTF['scene']
          // SkeletonUtils clones per mesh. Restore shared skins within this instance
          // so body/armor/helmet upload one bone palette, as in the authored GLB.
          const sourceMeshes: SkinnedMesh[] = [], skeletons = new Map<SkinnedMesh['skeleton'], SkinnedMesh['skeleton']>()
          source.scene.traverse(node => { if (node instanceof SkinnedMesh) sourceMeshes.push(node) })
          let index = 0
          scene.traverse(node => {
            if (!(node instanceof SkinnedMesh)) return
            const original = sourceMeshes[index++].skeleton
            const shared = skeletons.get(original)
            if (shared) { node.skeleton.dispose(); node.skeleton = shared }
            else skeletons.set(original, node.skeleton)
          })
          instance = { ...source, scene, scenes: [scene] }
          return instance
        }),
        release() {
          if (released) return
          released = true
          if (instance) disposeGlbModel(instance.scene, false)
          if (--current.users === 0 && current.source) {
            disposeGlbModel(current.source.scene)
            if (entry === current) entry = undefined
          }
        },
      }
    },
  }
}

const loader = new GLTFLoader()
export const vikingAsset = createGlbAssetPool(() => loader.loadAsync(DEMO_GLB_URL))
