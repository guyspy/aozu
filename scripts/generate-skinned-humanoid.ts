import { writeFileSync } from 'node:fs'

// Original procedural geometry; no downloaded models or textures.
const nodes: { name: string; translation: number[]; children: number[] }[] = []
const world: number[][] = []
function bone(name: string, parent: number | null, position: number[]) {
  const id = nodes.length
  world.push(position)
  nodes.push({ name, translation: position.map((v, i) => v - (parent === null ? 0 : world[parent][i])), children: [] })
  if (parent !== null) nodes[parent].children.push(id)
  return id
}
const hips = bone('hips', null, [0, .9, 0])
const spine = bone('spine', hips, [0, 1.12, 0])
const chest = bone('chest', spine, [0, 1.35, 0])
const neck = bone('neck', chest, [0, 1.48, 0])
const head = bone('head', neck, [0, 1.57, 0])
const limbs: [number, number, number][] = []
for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
  const arm = bone(`${side}UpperArm`, chest, [sign * .22, 1.38, 0])
  const elbow = bone(`${side}LowerArm`, arm, [sign * .48, 1.38, 0])
  const hand = bone(`${side}Hand`, elbow, [sign * .72, 1.38, 0])
  limbs.push([arm, elbow, hand])
  const leg = bone(`${side}UpperLeg`, hips, [sign * .12, .88, 0])
  const knee = bone(`${side}LowerLeg`, leg, [sign * .12, .49, 0])
  const foot = bone(`${side}Foot`, knee, [sign * .12, .1, .04])
  limbs.push([leg, knee, foot])
}
const positions: number[] = [], joints: number[] = [], weights: number[] = [], morph: number[] = [], colors: number[] = [], indices: number[] = []
function vertex(p: number[], a: number, b: number, blend: number, color: number[], delta = [0, 0, 0]) {
  positions.push(...p); joints.push(blend === 1 ? 0 : a, blend === 0 ? 0 : b, 0, 0); weights.push(1 - blend, blend, 0, 0)
  colors.push(...color); morph.push(...delta)
}
const blue = [.12, .52, .72], skin = [.95, .65, .38]
function tube(a: number, b: number, radius: number, color: number[]) {
  const start = positions.length / 3
  const alongX = Math.abs(world[b][0] - world[a][0]) > .1
  for (let ring = 0; ring <= 8; ring++) {
    const t = ring / 8
    for (let v = 0; v < 8; v++) {
      const angle = v * Math.PI / 4
      const p = world[a].map((n, i) => n * (1 - t) + world[b][i] * t)
      p[alongX ? 1 : 0] += Math.cos(angle) * radius
      p[2] += Math.sin(angle) * radius
      vertex(p, a, b, t, color)
    }
  }
  for (let ring = 0; ring < 8; ring++) for (let v = 0; v < 8; v++) {
    const x = start + ring * 8 + v, y = start + ring * 8 + (v + 1) % 8
    indices.push(x, y, x + 8, y, y + 8, x + 8)
  }
}
function ellipsoid(center: number[], size: number[], joint: number, color: number[], smile = false) {
  const start = positions.length / 3
  for (let lat = 0; lat <= 8; lat++) for (let lon = 0; lon <= 12; lon++) {
    const phi = lat * Math.PI / 8, theta = lon * Math.PI / 6
    const p = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]
    const delta = smile ? [0, .055 * Math.abs(p[0]), 0] : [0, 0, 0]
    vertex(p.map((v, i) => center[i] + v * size[i]), joint, joint, 0, color, delta)
  }
  for (let lat = 0; lat < 8; lat++) for (let lon = 0; lon < 12; lon++) {
    const a = start + lat * 13 + lon
    indices.push(a, a + 13, a + 1, a + 1, a + 13, a + 14)
  }
}
tube(hips, spine, .18, blue); tube(spine, chest, .2, blue); tube(chest, neck, .085, skin)
for (const [a, b, c] of limbs) {
  tube(a, b, .065, blue); tube(b, c, .055, skin)
  ellipsoid(world[c], [.07, .065, .085], c, skin)
}
ellipsoid([0, 1.68, 0], [.17, .21, .14], head, skin)
for (const x of [-.065, .065]) ellipsoid([x, 1.72, .126], [.022, .028, .015], head, [.025, .03, .04])
ellipsoid([0, 1.60, .133], [.085, .012, .012], head, [.25, .035, .03], true)

const buffers: Buffer[] = [], bufferViews: object[] = [], accessors: object[] = []
let byteLength = 0
function accessor(values: number[], type: string, components: number, integer = false, bounds = false) {
  const array = integer ? new Uint16Array(values) : new Float32Array(values)
  const bytes = Buffer.from(array.buffer)
  const view = bufferViews.length
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length })
  buffers.push(bytes); byteLength += bytes.length
  const padding = (4 - byteLength % 4) % 4
  buffers.push(Buffer.alloc(padding)); byteLength += padding
  const min = Array.from({ length: components }, (_, c) => Math.min(...values.filter((_, i) => i % components === c)))
  const max = Array.from({ length: components }, (_, c) => Math.max(...values.filter((_, i) => i % components === c)))
  accessors.push({ bufferView: view, componentType: integer ? 5123 : 5126, count: values.length / components, type, ...(bounds ? { min, max } : {}) })
  return accessors.length - 1
}
const primitive = { attributes: { POSITION: accessor(positions, 'VEC3', 3, false, true), JOINTS_0: accessor(joints, 'VEC4', 4, true), WEIGHTS_0: accessor(weights, 'VEC4', 4), COLOR_0: accessor(colors, 'VEC3', 3) }, indices: accessor(indices, 'SCALAR', 1, true), material: 0, targets: [{ POSITION: accessor(morph, 'VEC3', 3, false, true) }] }
for (const index of [...Object.values(primitive.attributes), ...primitive.targets.flatMap(t => Object.values(t))]) {
  const { bufferView } = accessors[index] as { bufferView: number }
  ;(bufferViews[bufferView] as { target?: number }).target = 34962
}
const { bufferView: indexView } = accessors[primitive.indices] as { bufferView: number }
;(bufferViews[indexView] as { target?: number }).target = 34963
const inverseBindMatrices = accessor(world.flatMap(([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]), 'MAT4', 16)
const times = accessor([0, .75, 1.5, 2.25, 3], 'SCALAR', 1, false, true)
const rotations = accessor([0, -.6, 0, .4, 0].flatMap(a => [0, 0, Math.sin(a / 2), Math.cos(a / 2)]), 'VEC4', 4)
const gltf = { asset: { version: '2.0', generator: 'AOZU procedural CC0 humanoid' }, scene: 0, scenes: [{ nodes: [hips, nodes.length] }], nodes: [...nodes.map(({ children, ...node }) => ({ ...node, ...(children.length ? { children } : {}) })), { name: 'Humanoid', mesh: 0, skin: 0 }], meshes: [{ name: 'Humanoid', primitives: [primitive], weights: [0], extras: { targetNames: ['happy'] } }], materials: [{ doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: .8 } }], skins: [{ joints: nodes.map((_, i) => i), skeleton: hips, inverseBindMatrices }], animations: [{ name: 'wave', samplers: [{ input: times, output: rotations, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: nodes.findIndex(n => n.name === 'rightLowerArm'), path: 'rotation' } }] }], accessors, bufferViews, buffers: [{ byteLength }] }
const json = Buffer.from(JSON.stringify(gltf))
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
const binary = Buffer.concat(buffers)
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonPadded.length + binary.length, 8)
function chunk(data: Buffer, type: number) { const h = Buffer.alloc(8); h.writeUInt32LE(data.length); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]) }
writeFileSync(new URL('../public/glb/demo-humanoid.glb', import.meta.url), Buffer.concat([header, chunk(jsonPadded, 0x4e4f534a), chunk(binary, 0x004e4942)]))
console.log(`Generated humanoid: ${nodes.length} bones, ${positions.length / 3} vertices`)
