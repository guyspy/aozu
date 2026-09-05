import { AnimationMixer, BoxGeometry, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, SkeletonHelper, SkinnedMesh, WebGLRenderer, type Object3D } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { DEMO_GLB_URL, type Preview3D } from '../../core/application/character-3d.ts'

export function createSkinnedDemo(gltf: GLTF) {
  const meshes: SkinnedMesh[] = []
  gltf.scene.traverse(node => { if (node instanceof SkinnedMesh) meshes.push(node) })
  const hand = gltf.scene.getObjectByName('rightHand')
  if (!meshes.length || !hand || !gltf.animations.length) throw new Error('Demo requires a skin, rightHand and animation')
  const prop = new Mesh(new BoxGeometry(.055, .3, .055), new MeshStandardMaterial({ color: 0xe9b949 }))
  prop.name = 'rightHand-prop'; prop.position.set(0, .13, 0); hand.add(prop)
  const helper = new SkeletonHelper(gltf.scene)
  const mixer = new AnimationMixer(gltf.scene)
  const action = mixer.clipAction(gltf.animations[0]); action.play()
  let playing = false
  const apply = (state: Preview3D) => {
    for (const mesh of meshes) {
      const index = mesh.morphTargetDictionary?.happy
      if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = state.happy
    }
    prop.visible = state.prop; helper.visible = state.skeleton; playing = state.playing
    if (!playing) { mixer.setTime(0); gltf.scene.updateMatrixWorld(true) }
  }
  return { meshes, hand, prop, helper, apply, update(dt: number) { if (playing) mixer.update(dt) }, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); helper.dispose() } }
}
function disposeModel(model: Object3D) {
  const skeletons = new Set<SkinnedMesh['skeleton']>()
  model.traverse(node => {
    if (node instanceof Mesh) { node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose() }
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton)
  })
  for (const skeleton of skeletons) skeleton.dispose()
}

/** Bundled trusted fixture only; this is not an arbitrary GLB import endpoint. */
export function mountGlbCharacterViewer(host: HTMLElement, initial: Preview3D, interactive = true) {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2))
  host.append(renderer.domElement)
  const scene = new Scene(), camera = new PerspectiveCamera(36, 1, .01, 30)
  camera.position.set(2.4, 1.8, 3.8)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, .95, 0); controls.enableDamping = true; controls.enabled = interactive
  controls.minDistance = 1.5; controls.maxDistance = 8; controls.enablePan = false; controls.update()
  scene.add(new HemisphereLight(0xffffff, 0x566277, 2))
  const light = new DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light)
  let destroyed = false, model: Object3D | undefined, demo: ReturnType<typeof createSkinnedDemo> | undefined
  let state = initial, frame = 0, previous = 0
  const resize = () => {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize); observer.observe(host); resize()
  const destroy = () => {
    if (destroyed) return
    destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose()
    demo?.dispose(); if (model) disposeModel(model)
    renderer.dispose(); renderer.domElement.remove()
  }
  const ready = new GLTFLoader().loadAsync(DEMO_GLB_URL).then(gltf => {
    if (destroyed) { disposeModel(gltf.scene); return }
    model = gltf.scene; demo = createSkinnedDemo(gltf); demo.apply(state)
    scene.add(model, demo.helper)
    const tick = (time: number) => {
      if (destroyed) return
      demo?.update(previous ? Math.min((time - previous) / 1000, .05) : 0); previous = time
      controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }).catch(error => { destroy(); throw error })
  return { ready, setState(next: Preview3D) { state = next; demo?.apply(next) }, destroy }
}
