import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Matrix4, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { bootMantleRuntime } from '@aotter/mantle-runtime'
import type { WebMcpTool } from '@aotter/mantle-web/webmcp'
import { createSkinnedDemo } from '../src/adapters/browser/glb-character-viewer.ts'
import { createCharacter3DPreview, CHARACTER_3D_TRIGGERS } from '../src/core/application/character-3d.ts'
import { compileAuthoringBackbone } from '../src/core/mantle/backbone.ts'
import { bindMantleWebMcpTools } from '../src/adapters/webmcp/tools.ts'

const bytes = readFileSync(new URL('../public/glb/demo-humanoid.glb', import.meta.url))
assert.ok(bytes.length < 200_000)
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
const demo = createSkinnedDemo(gltf)
const preview = createCharacter3DPreview()
demo.apply(preview.getSnapshot())
gltf.scene.updateMatrixWorld(true)
assert.equal(demo.meshes.length, 1)
const mesh = demo.meshes[0]
assert.equal(mesh.skeleton.bones.length, 17)
for (const side of ['left', 'right']) for (const chain of [['UpperArm', 'LowerArm', 'Hand'], ['UpperLeg', 'LowerLeg', 'Foot']]) {
  for (let i = 1; i < chain.length; i++) assert.equal(gltf.scene.getObjectByName(side + chain[i])?.parent?.name, side + chain[i - 1])
}
mesh.skeleton.bones.forEach((bone, i) => {
  const bind = new Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[i])
  bind.elements.forEach((v, c) => assert.ok(Math.abs(v - new Matrix4().elements[c]) < 1e-6))
})
const weights = mesh.geometry.getAttribute('skinWeight'), joints = mesh.geometry.getAttribute('skinIndex')
let blended = 0
for (let i = 0; i < weights.count; i++) {
  let sum = 0
  for (let c = 0; c < 4; c++) { const w = weights.getComponent(i, c); assert.ok(w >= 0 && w <= 1); sum += w; assert.ok(joints.getComponent(i, c) < 17) }
  assert.ok(Math.abs(sum - 1) < 1e-6)
  if (weights.getX(i) > 0 && weights.getY(i) > 0) blended++
}
assert.ok(blended > 100, 'must prove blended skinning, not rigid pieces only')
const bindPositions = Array.from({ length: weights.count }, (_, i) => mesh.getVertexPosition(i, new Vector3()))
const socketBefore = demo.prop.getWorldPosition(new Vector3())
preview.configure({ expectedRevision: 0, playing: true, prop: true, happy: 1, skeleton: true })
demo.apply(preview.getSnapshot()); demo.update(.75); gltf.scene.updateMatrixWorld(true)
assert.ok(demo.prop.getWorldPosition(new Vector3()).distanceTo(socketBefore) > .05)
assert.equal(demo.prop.parent, demo.hand)
assert.equal(demo.helper.visible, true)
assert.equal(mesh.morphTargetInfluences?.[mesh.morphTargetDictionary!.happy], 1)
assert.ok(bindPositions.some((p, i) => weights.getX(i) > 0 && weights.getY(i) > 0 && mesh.getVertexPosition(i, new Vector3()).distanceTo(p) > .01), 'animation deforms blended vertices')
preview.configure({ expectedRevision: 1, playing: false, happy: 1 }); demo.apply(preview.getSnapshot())
assert.ok(bindPositions.some((p, i) => mesh.getVertexPosition(i, new Vector3()).distanceTo(p) > .02), 'morph moves face independently of animation')
preview.configure({ expectedRevision: 2, happy: 0 }); demo.apply(preview.getSnapshot())
bindPositions.forEach((p, i) => assert.ok(mesh.getVertexPosition(i, new Vector3()).distanceTo(p) < 1e-6, 'neutral restores bind geometry'))
for (const input of [{ expectedRevision: 0 }, { expectedRevision: 3, happy: NaN }, { expectedRevision: 3, happy: 2 }, { expectedRevision: 3, prop: 'yes' }, { expectedRevision: 3, slot: 'expression-head' }]) assert.throws(() => preview.configure(input))
assert.equal(preview.getSnapshot().revision, 3)

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
const unsubscribe = preview.subscribe(() => { notified++ })
await tools.get('configure_3d_preview')!.execute({ expectedRevision: 3, happy: .5 }, {})
assert.equal(preview.getSnapshot().happy, .5); assert.equal(notified, 1)
for (const input of [{ expectedRevision: 3, happy: 0 }, { expectedRevision: 4, happy: -1 }, { expectedRevision: 4, prop: 'yes' }, { expectedRevision: 4, unknown: true }]) {
  assert.equal((await invoke('configure-3d-preview', input)).ok, false)
}
assert.equal(preview.getSnapshot().revision, 4); assert.equal(notified, 1)
unsubscribe(); dispose?.(); demo.dispose()
console.log('game-ready 3D: GLB skin, bind pose, animation, morph, socket and Mantle/WebMCP ok')
