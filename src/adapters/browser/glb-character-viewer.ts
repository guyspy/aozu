import { AnimationMixer, LoopOnce, LoopRepeat, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, SkeletonHelper, SkinnedMesh, WebGLRenderer, ACESFilmicToneMapping, Color, CylinderGeometry, type AnimationAction, type Object3D } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { CHARACTER_3D_CLIPS, DEMO_GLB_URL, type Preview3D } from '../../core/application/character-3d.ts'

/** Trusted Viking fixture. All motion, hand poses and equipment originate in the GLB. */
export function createSkinnedDemo(gltf: GLTF) {
  const meshes: SkinnedMesh[] = []
  gltf.scene.traverse(node => { if (node instanceof SkinnedMesh) meshes.push(node) })
  const hand = gltf.scene.getObjectByName('rightHand')
  const socket = gltf.scene.getObjectByName('rightHandSocket')
  const body = meshes.find(mesh => mesh.name === 'VikingBody')
  const armor = meshes.find(mesh => mesh.name === 'VikingArmor')
  const helmet = meshes.find(mesh => mesh.name === 'VikingHelmet')
  const axe = gltf.scene.getObjectByName('VikingAxe'), sword = gltf.scene.getObjectByName('VikingSword')
  if (!body || !armor || !helmet || !hand || socket?.parent !== hand || !axe || !sword || axe.parent !== socket || sword.parent !== socket) throw new Error('Viking requires shared skin, equipment and right-hand socket')
  for (const name of ['happy', 'angry']) if (body.morphTargetDictionary?.[name] === undefined) throw new Error(`Missing expression: ${name}`)
  if (armor.skeleton !== body.skeleton || helmet.skeleton !== body.skeleton) throw new Error('Equipment must share the body skeleton')
  // glTF has no core visibility flag: the spare sword is authored at zero scale so
  // generic GLB viewers show just the axe. Composition here uses mesh visibility.
  sword.scale.setScalar(1)
  const helper = new SkeletonHelper(gltf.scene)
  const mixer = new AnimationMixer(gltf.scene)
  const actions = new Map([...CHARACTER_3D_CLIPS, 'hands-open', 'hands-grip'].map(name => {
    const clip = gltf.animations.find(clip => clip.name === name)
    if (!clip) throw new Error(`Missing embedded clip: ${name}`)
    return [name, mixer.clipAction(clip)] as const
  }))
  let state: Preview3D | undefined, active: AnimationAction | undefined, handAction: AnimationAction | undefined
  let transition: { elapsed: number; duration: number; weights: Map<AnimationAction, number> } | undefined
  const stopTransition = () => {
    transition = undefined
    for (const name of CHARACTER_3D_CLIPS) {
      const action = actions.get(name)!
      if (action !== active) action.stop()
    }
    active?.setEffectiveWeight(1)
  }
  const apply = (next: Preview3D) => {
    const changedClip = !state || state.clipName !== next.clipName
    const seek = !state || state.playbackRevision !== next.playbackRevision
    if (changedClip) {
      const nextAction = actions.get(next.clipName)!
      const fading = active && state?.playing && next.playing && next.timeScale > 0 && next.crossfade > 0 && !seek
      if (fading) {
        // Capture every current contribution. Rapid A -> B -> A switches remain continuous
        // and never accumulate abandoned actions or return partially to the bind pose.
        const weights = new Map<AnimationAction, number>()
        for (const name of CHARACTER_3D_CLIPS) {
          const action = actions.get(name)!
          if (action.isScheduled()) weights.set(action, action.getEffectiveWeight())
        }
        if (!nextAction.isScheduled()) nextAction.reset().setEffectiveWeight(0).play()
        weights.set(nextAction, weights.get(nextAction) ?? 0)
        transition = { elapsed: 0, duration: next.crossfade, weights }
        active = nextAction
      } else {
        active = nextAction; stopTransition(); active.reset().setEffectiveWeight(1).play()
      }
    }
    if (!active) throw new Error('Missing active animation')
    active.setLoop(next.loop ? LoopRepeat : LoopOnce, next.loop ? Infinity : 1)
    active.clampWhenFinished = true
    if (seek) {
      stopTransition()
      active.reset().setEffectiveWeight(1).play()
      active.time = next.seek * active.getClip().duration
    } else if (state && state.loop !== next.loop) {
      // Changing loop mode must also release a completed LoopOnce clamp.
      active.paused = false
    }
    const pose = actions.get(next.weapon === 'none' ? 'hands-open' : 'hands-grip')!
    if (pose !== handAction) { handAction?.stop(); handAction = pose; pose.reset().play() }
    for (const name of ['happy', 'angry']) body.morphTargetInfluences![body.morphTargetDictionary![name]] = next.expression === name ? next.expressionWeight : 0
    armor.visible = next.armor; helmet.visible = next.helmet
    axe.visible = next.weapon === 'axe'; sword.visible = next.weapon === 'sword'; helper.visible = next.skeleton
    state = next
    mixer.update(0) // Apply a selected/seeked pose and finger changes even while paused.
    gltf.scene.updateMatrixWorld(true)
  }
  const update = (dt: number) => {
    if (!state?.playing || state.timeScale === 0) return
    const delta = dt * state.timeScale
    if (transition) {
      transition.elapsed += delta
      const t = Math.min(1, transition.elapsed / transition.duration)
      for (const [action, weight] of transition.weights) action.setEffectiveWeight(weight * (1 - t) + (action === active ? t : 0))
      if (t === 1) stopTransition()
    }
    mixer.update(delta)
  }
  return { meshes, body, hand, socket, armor, helmet, weapons: { axe, sword }, helper, mixer, apply, update,
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); helper.dispose() },
  }
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
  camera.position.set(2.5, 2.0, 5.6)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1.40, 0); controls.enableDamping = true; controls.enabled = interactive
  controls.minDistance = 1.5; controls.maxDistance = 8; controls.enablePan = false; controls.update()
  renderer.toneMapping = ACESFilmicToneMapping
  scene.background = new Color('#17262e')
  scene.add(new HemisphereLight(0xe5f4ff, 0x657269, 2.4))
  const plinth = new Mesh(new CylinderGeometry(.88, .98, .10, 48), new MeshStandardMaterial({ color: '#384b52', roughness: .9 }))
  plinth.position.y = -.04; scene.add(plinth)
  const rim = new DirectionalLight(0x86c9ff, 3); rim.position.set(-3, 3, -2); scene.add(rim)
  const light = new DirectionalLight(0xffffff, 3); light.position.set(-3, 5, 4); scene.add(light)
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
    plinth.geometry.dispose(); plinth.material.dispose()
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
