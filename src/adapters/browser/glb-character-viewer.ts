import { AnimationMixer, LoopOnce, LoopRepeat, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, SkeletonHelper, SkinnedMesh, WebGLRenderer, ACESFilmicToneMapping, Color, CylinderGeometry, type AnimationAction } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { CHARACTER_3D_CLIPS, type Preview3D } from '../../core/application/character-3d.ts'
import { createDemandRenderLoop } from './demand-render-loop.ts'
import { vikingAsset } from './glb-asset.ts'

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
  // Validate before allocating helpers or mixer bindings, including failure paths.
  const clips = [...CHARACTER_3D_CLIPS, 'hands-open', 'hands-grip'].map(name => {
    const clip = gltf.animations.find(clip => clip.name === name)
    if (!clip) throw new Error(`Missing embedded clip: ${name}`)
    return clip
  })
  let helper: SkeletonHelper | undefined
  const mixer = new AnimationMixer(gltf.scene)
  const actions = new Map(clips.map(clip => [clip.name, mixer.clipAction(clip)]))
  const bodyActions = CHARACTER_3D_CLIPS.map(name => actions.get(name)!)
  let state: Preview3D | undefined, active: AnimationAction | undefined, handAction: AnimationAction | undefined
  let transition: { elapsed: number; duration: number; weights: { action: AnimationAction; weight: number }[] } | undefined
  const stopTransition = () => {
    transition = undefined
    for (const action of bodyActions) {
      if (action !== active) action.stop()
    }
    active?.setEffectiveWeight(1)
  }
  const apply = (next: Preview3D) => {
    if (next === state) return
    const changedClip = !state || state.clipName !== next.clipName
    const seek = !state || state.playbackRevision !== next.playbackRevision
    if (changedClip) {
      const nextAction = actions.get(next.clipName)!
      const fading = active && state?.playing && next.playing && next.timeScale > 0 && next.crossfade > 0 && !seek
      if (fading) {
        // Capture every current contribution. Rapid A -> B -> A switches remain continuous
        // and never accumulate abandoned actions or return partially to the bind pose.
        const weights = bodyActions.filter(action => action.isScheduled()).map(action => ({ action, weight: action.getEffectiveWeight() }))
        if (!nextAction.isScheduled()) {
          nextAction.reset().setEffectiveWeight(0).play()
          weights.push({ action: nextAction, weight: 0 })
        }
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
    const changedHand = pose !== handAction
    if (changedHand) { handAction?.stop(); handAction = pose; pose.reset().play(); pose.paused = true }
    for (const name of ['happy', 'angry']) body.morphTargetInfluences![body.morphTargetDictionary![name]] = next.expression === name ? next.expressionWeight : 0
    armor.visible = next.armor; helmet.visible = next.helmet
    axe.visible = next.weapon === 'axe'; sword.visible = next.weapon === 'sword'
    if (next.skeleton) {
      helper ??= new SkeletonHelper(gltf.scene)
      if (!helper.parent) gltf.scene.parent?.add(helper)
    } else helper?.removeFromParent()
    state = next
    // Equipment visibility and face weights do not need to resample the skeleton.
    if (changedClip || seek || changedHand) mixer.update(0)
  }
  const needsUpdate = () => Boolean(state?.playing && state.timeScale > 0 && (transition || active?.isRunning()))
  const update = (dt: number) => {
    if (!needsUpdate() || dt === 0) return
    const delta = dt * state!.timeScale
    if (transition) {
      transition.elapsed += delta
      const t = Math.min(1, transition.elapsed / transition.duration)
      for (let i = 0; i < transition.weights.length; i++) {
        const { action, weight } = transition.weights[i]
        action.setEffectiveWeight(weight * (1 - t) + (action === active ? t : 0))
      }
      if (t === 1) stopTransition()
    }
    mixer.update(delta)
  }
  return { meshes, body, hand, socket, armor, helmet, weapons: { axe, sword }, get helper() { return helper }, mixer, apply, update, needsUpdate,
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); helper?.removeFromParent(); helper?.dispose() },
  }
}

/** Bundled trusted fixture only; this is not an arbitrary GLB import endpoint. */
export function mountGlbCharacterViewer(host: HTMLElement, initial: Preview3D, interactive = true) {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, interactive ? 2 : 1))
  renderer.domElement.className = 'size-full'
  host.append(renderer.domElement)
  const scene = new Scene(), camera = new PerspectiveCamera(36, 1, .01, 30)
  camera.position.set(2.5, 2.0, 5.6)
  camera.lookAt(0, 1.40, 0)
  const controls = interactive ? new OrbitControls(camera, renderer.domElement) : undefined
  if (controls) {
    controls.target.set(0, 1.40, 0); controls.enableDamping = true
    controls.minDistance = 1.5; controls.maxDistance = 8; controls.enablePan = false; controls.update()
  }
  renderer.toneMapping = ACESFilmicToneMapping
  scene.background = new Color('#17262e')
  scene.add(new HemisphereLight(0xe5f4ff, 0x657269, 2.4))
  const plinth = new Mesh(new CylinderGeometry(.88, .98, .10, 48), new MeshStandardMaterial({ color: '#384b52', roughness: .9 }))
  plinth.position.y = -.04; scene.add(plinth)
  const rim = new DirectionalLight(0x86c9ff, 3); rim.position.set(-3, 3, -2); scene.add(rim)
  const light = new DirectionalLight(0xffffff, 3); light.position.set(-3, 5, 4); scene.add(light)
  let destroyed = false, demo: ReturnType<typeof createSkinnedDemo> | undefined
  let state = initial, inView = false, width = 0, height = 0
  const loop = createDemandRenderLoop(delta => {
    if (interactive) demo?.update(delta)
    const orbiting = controls?.update() ?? false
    renderer.render(scene, camera)
    return orbiting || (interactive && (demo?.needsUpdate() ?? false))
  })
  const visibility = () => loop.setVisible(inView && width > 0 && height > 0 && !document.hidden)
  const resize = () => {
    const nextWidth = host.clientWidth, nextHeight = host.clientHeight
    if (width !== nextWidth || height !== nextHeight) {
      width = nextWidth; height = nextHeight
      renderer.setSize(Math.max(1, width), Math.max(1, height), false)
      camera.aspect = Math.max(1, width) / Math.max(1, height); camera.updateProjectionMatrix()
    }
    visibility()
  }
  const observer = new ResizeObserver(resize); observer.observe(host); resize()
  const intersection = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; visibility() })
  intersection.observe(host)
  document.addEventListener('visibilitychange', visibility)
  controls?.addEventListener('change', loop.invalidate)
  const asset = vikingAsset.acquire()
  const destroy = () => {
    if (destroyed) return
    destroyed = true; loop.destroy(); observer.disconnect(); intersection.disconnect()
    document.removeEventListener('visibilitychange', visibility)
    controls?.removeEventListener('change', loop.invalidate); controls?.dispose()
    demo?.dispose(); asset.release()
    plinth.geometry.dispose(); plinth.material.dispose()
    scene.clear(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
  }
  const ready = asset.ready.then(gltf => {
    if (destroyed || !gltf) return
    scene.add(gltf.scene)
    demo = createSkinnedDemo(gltf); demo.apply(state)
    loop.invalidate()
  }).catch(error => { destroy(); throw error })
  return {
    ready,
    setState(next: Preview3D) { state = next; demo?.apply(next); loop.invalidate() },
    destroy,
  }
}
