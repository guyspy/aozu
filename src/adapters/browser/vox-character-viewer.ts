import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
  type Object3D,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { VOXLoader, buildMesh } from 'three/addons/loaders/VOXLoader.js'

export const DEMO_VOX_URL = '/vox/demo-character.vox'

type VoxChunk = { data?: Uint8Array }

type VoxParseResult = {
  chunks?: VoxChunk[]
  scene?: Object3D | null
}

export type VoxCharacterViewerOptions = {
  src?: string
  controls?: boolean
}

const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const disposeObject = (object: Object3D) => {
  object.traverse((child) => {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as Material | Material[] | undefined
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material?.dispose()
  })
}

const meshFromChunks = (chunks: VoxChunk[]) => {
  const group = new Group()
  for (const chunk of chunks) {
    if (chunk.data) group.add(buildMesh(chunk))
  }
  return group
}

const frameObject = (object: Object3D, camera: PerspectiveCamera, controls?: OrbitControls) => {
  const box = new Box3().setFromObject(object)
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  object.position.sub(center)
  const span = Math.max(size.x, size.y, size.z, 1)
  const distance = (span / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.55
  camera.position.set(distance * 0.72, distance * 0.28, distance * 0.86)
  camera.near = Math.max(0.05, distance / 80)
  camera.far = distance * 20
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  if (controls) {
    controls.target.set(0, 0, 0)
    controls.minDistance = distance * 0.55
    controls.maxDistance = distance * 2.6
    controls.update()
  }
  return distance
}

/** Mount a MagicaVoxel model with the official Three.js VOXLoader. Keep Three out of `core/`. */
export async function mountVoxCharacterViewer(host: HTMLElement, options: VoxCharacterViewerOptions = {}) {
  const src = options.src ?? DEMO_VOX_URL
  const enableControls = options.controls ?? true
  const scene = new Scene()
  const camera = new PerspectiveCamera(36, 1, 0.1, 500)
  const renderer = new WebGLRenderer({ alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2))
  const canvas = renderer.domElement
  canvas.className = 'size-full'
  if (!enableControls) canvas.style.pointerEvents = 'none'
  host.replaceChildren(canvas)

  scene.add(new HemisphereLight(0xf4efe6, 0x3a3f4c, 1.15))
  const key = new DirectionalLight(0xfff4e8, 1.35)
  key.position.set(6, 10, 7)
  scene.add(key)
  const fill = new DirectionalLight(0xc9d6e8, 0.4)
  fill.position.set(-7, 3, -5)
  scene.add(fill)

  let model: Object3D | undefined
  let controls: OrbitControls | undefined
  let frame = 0
  let destroyed = false
  const loader = new VOXLoader()
  const parsed = await loader.loadAsync(src) as VoxParseResult
  if (destroyed) return { destroy() {} }

  if (parsed.scene) {
    model = parsed.scene
  } else {
    model = meshFromChunks(parsed.chunks ?? [])
    if (model.children.length === 0) throw new Error(`VOX model is empty: ${src}`)
  }
  scene.add(model)

  if (enableControls) {
    controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minPolarAngle = Math.PI * 0.18
    controls.maxPolarAngle = Math.PI * 0.82
  }
  frameObject(model, camera, controls)

  const resize = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  const spin = !enableControls && !prefersReducedMotion()
  const tick = () => {
    if (destroyed) return
    if (spin && model) model.rotation.y += 0.008
    controls?.update()
    renderer.render(scene, camera)
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls?.dispose()
      if (model) {
        scene.remove(model)
        disposeObject(model)
      }
      renderer.dispose()
      canvas.remove()
    },
  }
}
