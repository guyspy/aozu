import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Matrix4, Scene, SkinnedMesh, Vector3, type AnimationClip } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { bootMantleRuntime } from '@aotter/mantle-runtime'
import type { WebMcpTool } from '@aotter/mantle-web/webmcp'
import { createSkinnedDemo } from '../src/adapters/browser/glb-character-viewer.ts'
import { createCharacter3DPreview, CHARACTER_3D_CLIPS, CHARACTER_3D_SLOTS, CHARACTER_3D_TRIGGERS, type Preview3DPatch } from '../src/core/application/character-3d.ts'
import { compileAuthoringBackbone } from '../src/core/mantle/backbone.ts'
import { bindMantleWebMcpTools } from '../src/adapters/webmcp/tools.ts'

const load = async (name: string, budget: number) => {
  const bytes = readFileSync(new URL(`../public/glb/${name}.glb`, import.meta.url))
  assert.ok(bytes.length < budget)
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  // Regression coverage for issues found by the Khronos glTF Validator review.
  const json = gltf.parser.json
  for (const node of json.nodes) if (node.children) assert.ok(node.children.length > 0, 'glTF forbids empty children arrays')
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    for (const index of [...Object.values(primitive.attributes), ...(primitive.targets ?? []).flatMap((t: object) => Object.values(t))] as number[]) assert.equal(json.bufferViews[json.accessors[index].bufferView].target, 34962)
    assert.equal(json.bufferViews[json.accessors[primitive.indices].bufferView].target, 34963)
  }
  gltf.scene.traverse(node => {
    if (!(node instanceof SkinnedMesh)) return
    const weights = node.geometry.getAttribute('skinWeight'), joints = node.geometry.getAttribute('skinIndex')
    for (let i = 0; i < weights.count; i++) for (let c = 0; c < 4; c++) if (weights.getComponent(i, c) === 0) assert.equal(joints.getComponent(i, c), 0)
  })
  return gltf
}
// Keep the original fixture as a small baseline for the spike's 17-joint rig.
const original = await load('demo-humanoid', 200_000)
const originalMesh = original.scene.getObjectByName('Humanoid') as SkinnedMesh
assert.equal(originalMesh.skeleton.bones.length, 17)
assert.equal(original.animations[0].name, 'wave')

const gltf = await load('demo-viking', 2_000_000)
const scene = new Scene()
scene.add(gltf.scene)
const demo = createSkinnedDemo(gltf)
assert.equal(demo.helper, undefined, 'Bones off must not allocate a helper')
const preview = createCharacter3DPreview()
const apply = (patch: Preview3DPatch) => {
  preview.configure({ expectedRevision: preview.getSnapshot().revision, ...patch })
  demo.apply(preview.getSnapshot())
  gltf.scene.updateMatrixWorld(true)
}
const position = (name: string) => gltf.scene.getObjectByName(name)!.getWorldPosition(new Vector3())
const vertices = (mesh = demo.body) => Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, i) => mesh.getVertexPosition(i, new Vector3()))
const assertPositions = (a: Vector3[], b: Vector3[], epsilon = 1e-6) => a.forEach((p, i) => assert.ok(p.distanceTo(b[i]) < epsilon, `vertex ${i} drifted`))
const clip = (name: string) => gltf.animations.find(clip => clip.name === name)!
const action = (name: string) => demo.mixer.existingAction(clip(name))!
assert.deepEqual(gltf.animations.map(c => c.name), [...CHARACTER_3D_CLIPS, 'hands-open', 'hands-grip'])
assert.equal(demo.meshes.length, 3)
assert.equal(demo.body.skeleton.bones.length, 47)
assert.equal(gltf.parser.json.nodes.find((node: { name: string }) => node.name === 'VikingSword').scale[0], 0, 'spare weapon is hidden in generic glTF viewers')
assert.equal(demo.weapons.sword.scale.x, 1, 'runtime uses visibility with restored socket scale')
assert.equal(demo.armor.skeleton, demo.body.skeleton)
assert.equal(demo.helmet.skeleton, demo.body.skeleton)
for (const side of ['left', 'right']) for (const chain of [['UpperArm', 'LowerArm', 'Hand'], ['UpperLeg', 'LowerLeg', 'Foot'], ['IndexProximal', 'IndexIntermediate', 'IndexDistal'], ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal']]) {
  for (let i = 1; i < chain.length; i++) assert.equal(gltf.scene.getObjectByName(side + chain[i])?.parent?.name, side + chain[i - 1])
}
gltf.scene.updateMatrixWorld(true)
for (const mesh of demo.meshes) {
  mesh.skeleton.bones.forEach((bone, i) => {
    const bind = new Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[i])
    bind.elements.forEach((v, c) => assert.ok(Math.abs(v - new Matrix4().elements[c]) < 1e-6))
  })
  const weights = mesh.geometry.getAttribute('skinWeight'), joints = mesh.geometry.getAttribute('skinIndex')
  let blended = 0
  for (let i = 0; i < weights.count; i++) {
    let sum = 0
    for (let c = 0; c < 4; c++) { const w = weights.getComponent(i, c); assert.ok(Number.isFinite(w) && w >= 0 && w <= 1); sum += w; assert.ok(Number.isInteger(joints.getComponent(i, c)) && joints.getComponent(i, c) < 47) }
    assert.ok(Math.abs(sum - 1) < 1e-6)
    if (weights.getX(i) > 0 && weights.getY(i) > 0) blended++
  }
  if (mesh !== demo.helmet) assert.ok(blended > 100, `${mesh.name} must prove blended skinning`)
}
// Body clips must animate actual bones and must not overwrite the finger overlay.
const bodyBindings = new Set(clip('idle').tracks.map(t => t.name))
for (const name of CHARACTER_3D_CLIPS) {
  const c = clip(name)
  assert.ok(c.duration > 0 && c.tracks.length >= 10)
  assert.deepEqual(new Set(c.tracks.map(t => t.name)), bodyBindings, 'complete tracks make switches history-independent')
  for (const t of c.tracks) {
    assert.ok(t.name.endsWith('.quaternion'))
    assert.ok(gltf.scene.getObjectByName(t.name.split('.')[0])?.type === 'Bone')
    assert.ok([...t.values].every(Number.isFinite))
  }
}
for (const name of ['hands-open', 'hands-grip']) for (const t of clip(name).tracks) assert.ok(!bodyBindings.has(t.name), 'hand pose must coexist with body motion')

// Every clip deforms blended body vertices, and clothing follows the same live skeleton.
const weights = demo.body.geometry.getAttribute('skinWeight')
for (const name of CHARACTER_3D_CLIPS) {
  apply({ clipName: name, seek: 0, playing: true, weapon: 'axe', crossfade: 0 })
  const before = vertices(), armorBefore = vertices(demo.armor)
  demo.update(clip(name).duration * .35); gltf.scene.updateMatrixWorld(true)
  assert.ok(vertices().some((p, i) => weights.getX(i) > 0 && weights.getY(i) > 0 && p.distanceTo(before[i]) > .002), `${name} deforms blended vertices`)
  assert.ok(vertices(demo.armor).some((p, i) => p.distanceTo(armorBefore[i]) > .002), `${name} moves clothing`)
}
// Pause holds the current pose, including during a fade; unrelated edits never rewind.
apply({ clipName: 'walk', seek: .25, playing: false })
const paused = vertices(), pausedTime = action('walk').time
apply({ armor: false, helmet: false, skeleton: true })
demo.update(1); gltf.scene.updateMatrixWorld(true)
assertPositions(paused, vertices()); assert.equal(action('walk').time, pausedTime)
assert.equal(demo.armor.visible, false); assert.equal(demo.helmet.visible, false); assert.equal(demo.helper.visible, true)
assert.equal(demo.needsUpdate(), false, 'paused playback needs no frames')
scene.updateMatrixWorld(true)
const helper = demo.helper!
const helperVersion = helper.geometry.getAttribute('position').version
apply({ skeleton: false })
scene.updateMatrixWorld(true)
assert.equal(helper.parent, null)
assert.equal(helper.geometry.getAttribute('position').version, helperVersion, 'hidden Bones must not update geometry')
apply({ skeleton: true })
assert.equal(demo.helper, helper, 'reuse the helper when reenabled')
assert.equal(helper.parent, scene)
let samples = 0
const updateMixer = demo.mixer.update
demo.mixer.update = function (dt) { samples++; return updateMixer.call(this, dt) }
apply({ armor: true, expression: 'happy', expressionWeight: .2 })
assert.equal(samples, 0, 'visibility/morph edits must not resample skeletal tracks')
demo.mixer.update = updateMixer
apply({ playing: true, timeScale: 2 }); demo.update(.1)
assert.ok(Math.abs(action('walk').time - pausedTime - .2) < 1e-6, 'speed scales clip time')
apply({ timeScale: 0 }); const frozenTime = action('walk').time; demo.update(1); assert.equal(action('walk').time, frozenTime)
assert.equal(demo.needsUpdate(), false, 'zero speed needs no frames')
apply({ timeScale: 1, loop: false, seek: .9 }); demo.update(2)
assert.equal(action('walk').time, clip('walk').duration); assert.equal(action('walk').paused, true)
assert.equal(demo.needsUpdate(), false, 'completed LoopOnce needs no frames')
gltf.scene.updateMatrixWorld(true); const held = vertices(); demo.update(2); gltf.scene.updateMatrixWorld(true); assertPositions(held, vertices())
apply({ seek: 0 }); demo.update(.1); assert.ok(action('walk').time < .11, 'same clip can replay after completion')
assert.equal(demo.needsUpdate(), true, 'restart wakes the render loop')
apply({ seek: 0, loop: true }); demo.update(clip('walk').duration + .2); assert.ok(Math.abs(action('walk').time - .2) < 1e-6)
// An identical seek value is a new command; normalization is based on the chosen clip.
apply({ seek: .5, playing: false }); assert.ok(Math.abs(action('walk').time - clip('walk').duration / 2) < 1e-6)
apply({ seek: .5 }); assert.ok(Math.abs(action('walk').time - clip('walk').duration / 2) < 1e-6)
apply({ clipName: 'battle-ready' }); assert.equal(action('battle-ready').time, 0)

// Crossfades blend multiple skeletal actions; rapid switches retain all contributions.
apply({ clipName: 'idle', seek: .25, playing: true, crossfade: 1 })
const beforeFade = vertices()
apply({ clipName: 'walk' }); assertPositions(beforeFade, vertices())
demo.update(.2)
assert.ok(action('idle').getEffectiveWeight() > .7 && action('walk').getEffectiveWeight() > .1)
const bodyActions = () => CHARACTER_3D_CLIPS.map(name => action(name)).filter(a => a.isScheduled())
assert.ok(Math.abs(bodyActions().reduce((sum, a) => sum + a.getEffectiveWeight(), 0) - 1) < 1e-6)
apply({ playing: false }); const fadeTime = demo.mixer.time; demo.update(.5); assert.equal(demo.mixer.time, fadeTime)
apply({ playing: true }); gltf.scene.updateMatrixWorld(true); const beforeRapid = vertices()
apply({ clipName: 'idle' }); assertPositions(beforeRapid, vertices())
for (const name of ['attack', 'cheer', 'wave', 'walk', 'idle'] as const) { demo.update(.05); apply({ clipName: name }) }
demo.update(1.1); assert.equal(bodyActions().length, 1); assert.equal(action('idle').getEffectiveWeight(), 1)
// Seeking explicitly cancels a fade, even when clip and seek change atomically.
apply({ clipName: 'attack', seek: .5, playing: false }); assert.equal(bodyActions().length, 1); assert.ok(Math.abs(action('attack').time - clip('attack').duration / 2) < 1e-6)

// Open and gripped fingers differ with the same paused body pose; both weapons
// share a socket and follow its world transform through multiple animations.
apply({ clipName: 'idle', seek: 0, playing: false, weapon: 'none', armor: true, helmet: true })
assert.equal(demo.armor.visible, true); assert.equal(demo.helmet.visible, true)
const openFinger = position('rightIndexDistal'), openVertices = vertices()
assert.equal(demo.weapons.axe.visible, false); assert.equal(demo.weapons.sword.visible, false)
apply({ weapon: 'axe' }); assert.ok(position('rightIndexDistal').distanceTo(openFinger) > .04)
assert.ok(vertices().some((p, i) => p.distanceTo(openVertices[i]) > .04), 'finger skin deforms with grip')
assert.equal(demo.weapons.axe.visible, true); assert.equal(demo.weapons.sword.visible, false)
assert.equal(demo.weapons.axe.parent, demo.socket); assert.equal(demo.socket!.parent, demo.hand)
const grip = position('rightIndexDistal')
apply({ weapon: 'sword' }); assert.ok(position('rightIndexDistal').distanceTo(grip) < 1e-6)
assert.equal(demo.weapons.axe.visible, false); assert.equal(demo.weapons.sword.visible, true)
const socketBefore = demo.weapons.sword.getWorldPosition(new Vector3())
apply({ clipName: 'attack', seek: .45 }); assert.ok(demo.weapons.sword.getWorldPosition(new Vector3()).distanceTo(socketBefore) > .1)
apply({ weapon: 'none' }); assert.equal(action('hands-grip').isScheduled(), false); assert.equal(action('hands-open').isScheduled(), true)

// Morph presets are exclusive, continuous and independent of the frozen skeleton.
apply({ expression: 'neutral' }); const neutralFace = vertices(), faceBones = position('head')
const morphIndices = demo.body.morphTargetDictionary!
for (const expression of ['happy', 'angry'] as const) {
  apply({ expression, expressionWeight: 1 })
  assert.equal(demo.body.morphTargetInfluences![morphIndices[expression]], 1)
  assert.equal(demo.body.morphTargetInfluences![morphIndices[expression === 'happy' ? 'angry' : 'happy']], 0)
  const full = vertices()
  assert.ok(full.some((p, i) => p.distanceTo(neutralFace[i]) > .02))
  apply({ expressionWeight: .5 })
  assertPositions(vertices(), full.map((p, i) => p.clone().lerp(neutralFace[i], .5)))
  assert.ok(position('head').distanceTo(faceBones) < 1e-6)
}
apply({ expression: 'neutral' }); assertPositions(neutralFace, vertices())
apply({ expression: 'happy', expressionWeight: 0 }); assertPositions(neutralFace, vertices())
apply({ expression: 'angry', expressionWeight: .6, weapon: 'axe', playing: true })
demo.update(.2)
assert.equal(demo.body.morphTargetInfluences![morphIndices.angry], .6, 'body and hand animation do not overwrite expression weights')

// Fail closed at the application boundary, including callers that bypass JSON/Mantle.
const revision = preview.getSnapshot().revision
const invalidPatches = [
  { clipName: 'run' }, { clipName: 'hands-grip' }, { clipName: null }, { loop: 'yes' }, { playing: 1 },
  { timeScale: -1 }, { timeScale: 3.1 }, { timeScale: NaN }, { timeScale: Infinity }, { timeScale: '1' },
  { crossfade: -1 }, { crossfade: 2.1 }, { crossfade: null }, { seek: -1 }, { seek: 1.1 },
  { armor: 'true' }, { helmet: 0 }, { weapon: 'bow' }, { expression: 'sad' }, { expressionWeight: -.1 },
  { expressionWeight: 1.1 }, { skeleton: {} }, { happy: .5 }, { prop: true }, { unknown: true },
  { playbackRevision: 9 }, { slot: 'expression-head' }, { clipName: undefined },
]
for (const patch of invalidPatches) assert.throws(() => preview.configure({ expectedRevision: revision, ...patch }))
for (const input of [null, [], {}, { expectedRevision: revision - 1 }, { expectedRevision: revision + .1 }, Object.assign(new Date(), { expectedRevision: revision })]) assert.throws(() => preview.configure(input))
assert.equal(preview.getSnapshot().revision, revision)

// Compile real procedures and invoke the same WebMCP tools shipped by bootstrap.
const plan = compileAuthoringBackbone()
const runtime = await bootMantleRuntime({ plan, storage: { nativeViewDialects: [], async prepare() { return { entries: {} as never, views: { async execute() { return { rows: [], page: 1, show: 50, hasMore: false } } } } } }, handlers: {
  ...Object.fromEntries(Object.keys(plan.procedures).map(name => [`companion.${name}`, () => { throw new Error('Unexpected unrelated procedure') }])),
  'companion.inspect-3d-character': () => preview.inspect(),
  'companion.configure-3d-preview': input => preview.configure(input),
} })
const invoke = (trigger: string, input: unknown) => runtime.invokeTrigger({ trigger, input, ctx: { user: null, staff: null, env: {} } })
const tools = new Map<string, WebMcpTool>()
const doc = { modelContext: { async registerTool(tool: WebMcpTool) { tools.set(tool.name, tool) } } } as unknown as Document
const dispose = await bindMantleWebMcpTools(doc, plan, invoke, new Set(CHARACTER_3D_TRIGGERS))
assert.equal(tools.size, 2)
assert.equal(tools.get('inspect_3d_character')?.annotations.readOnlyHint, true)
assert.deepEqual(await tools.get('inspect_3d_character')!.execute({}, {}), preview.inspect())
let notified = 0
const unsubscribe = preview.subscribe(() => { notified++; demo.apply(preview.getSnapshot()) })
await tools.get('configure_3d_preview')!.execute({ expectedRevision: revision, clipName: 'cheer', seek: .3, loop: false, playing: false, timeScale: .5, crossfade: .4, armor: false, helmet: false, weapon: 'sword', expression: 'angry', expressionWeight: .7, skeleton: true }, {})
assert.equal(notified, 1); assert.equal(preview.getSnapshot().clipName, 'cheer'); assert.equal(demo.armor.visible, false)
assert.equal(demo.helmet.visible, false); assert.equal(demo.weapons.sword.visible, true)
assert.equal(demo.body.morphTargetInfluences![morphIndices.angry], .7)
assert.ok(Math.abs(action('cheer').time - clip('cheer').duration * .3) < 1e-6)
for (const patch of invalidPatches) {
  assert.equal((await invoke('configure-3d-preview', { expectedRevision: revision + 1, ...patch })).ok, false)
  await assert.rejects(() => tools.get('configure_3d_preview')!.execute({ expectedRevision: revision + 1, ...patch }, {}))
}
assert.equal((await invoke('inspect-3d-character', { unknown: true })).ok, false)
assert.equal((await invoke('configure-3d-preview', { expectedRevision: revision })).ok, false)
assert.equal((await invoke('configure-3d-preview', {})).ok, false)
assert.equal(preview.getSnapshot().revision, revision + 1); assert.equal(notified, 1)

// Workshop selections and WebMCP operate on the same live composition and revision.
const toggleSlot = (id: typeof CHARACTER_3D_SLOTS[number]['id']) => preview.toggleSlot(CHARACTER_3D_SLOTS.find(slot => slot.id === id)!)
const selectedSlots = () => preview.inspect().slots.filter(slot => slot.selected).map(slot => slot.id)
assert.deepEqual(selectedSlots(), ['angry', 'sword'], 'tool configuration projects directly into the workshop cards')
const heldClipTime = action('cheer').time
const heldPlaybackRevision = preview.getSnapshot().playbackRevision
toggleSlot('armor')
assert.equal(notified, 2, 'one slot click emits one atomic composition change')
assert.equal(demo.armor.visible, true); assert.equal(demo.helmet.visible, false)
toggleSlot('helmet'); toggleSlot('armor')
assert.equal(demo.armor.visible, false); assert.equal(demo.helmet.visible, true)
toggleSlot('armor'); preview.clearSlots('outfit')
assert.equal(demo.armor.visible, false); assert.equal(demo.helmet.visible, false)
assert.equal(demo.weapons.sword.visible, true, 'clearing outfits preserves props')
toggleSlot('axe')
assert.equal(demo.weapons.axe.visible, true); assert.equal(demo.weapons.sword.visible, false)
toggleSlot('axe')
assert.equal(demo.weapons.axe.visible, false); assert.equal(action('hands-open').isScheduled(), true)
toggleSlot('sword')
assert.equal(demo.weapons.sword.visible, true); assert.equal(action('hands-grip').isScheduled(), true)
preview.clearSlots('prop')
assert.equal(demo.weapons.sword.visible, false); assert.equal(action('hands-open').isScheduled(), true)
toggleSlot('happy'); toggleSlot('happy') // Expressions retain the 2D select pattern; Neutral is the reset card.
assert.equal(demo.body.morphTargetInfluences![morphIndices.happy], .7)
assert.equal(demo.body.morphTargetInfluences![morphIndices.angry], 0)
toggleSlot('angry')
assert.equal(demo.body.morphTargetInfluences![morphIndices.happy], 0)
assert.equal(demo.body.morphTargetInfluences![morphIndices.angry], .7)
preview.clearSlots('expression')
assert.deepEqual(selectedSlots(), [])
assert.equal(demo.body.morphTargetInfluences![morphIndices.happy], 0)
assert.equal(demo.body.morphTargetInfluences![morphIndices.angry], 0)
assert.equal(action('cheer').time, heldClipTime, 'slot clicks never rewind a paused animation')
assert.equal(preview.getSnapshot().playbackRevision, heldPlaybackRevision)
const inspectedSlots = await tools.get('inspect_3d_character')!.execute({}, {}) as ReturnType<typeof preview.inspect>
assert.deepEqual(inspectedSlots, preview.inspect(), 'tools see every UI selection immediately')
await assert.rejects(() => tools.get('configure_3d_preview')!.execute({ expectedRevision: revision + 1, weapon: 'axe' }, {}), 'a UI slot mutation invalidates the old tool revision')
await tools.get('configure_3d_preview')!.execute({ expectedRevision: inspectedSlots.state.revision, armor: true, helmet: true, weapon: 'axe', expression: 'happy', expressionWeight: .4 }, {})
assert.deepEqual(selectedSlots(), ['happy', 'armor', 'helmet', 'axe'])
assert.equal(demo.body.morphTargetInfluences![morphIndices.happy], .4)
unsubscribe(); dispose?.(); demo.dispose()
for (const c of gltf.animations as AnimationClip[]) assert.equal(demo.mixer.existingAction(c), null, 'dispose uncaches every action')
console.log('game-ready 3D: Viking skin/clips, playback/fades/seek, equipment/fingers, expressions and closed Mantle/WebMCP commands ok')
