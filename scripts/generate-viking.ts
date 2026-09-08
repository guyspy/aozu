import { writeFileSync } from 'node:fs'
import { BoxGeometry, BufferGeometry, CylinderGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three'

// Original, stylized procedural demo art. Geometry + rig + clips are authored here,
// then packed into one texture-free GLB. No runtime-generated geometry or motion.
type V3 = [number, number, number]
type Node = { name: string; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[]; mesh?: number; skin?: number; extras?: object }
const nodes: Node[] = [], world: Vector3[] = [], roots: number[] = []
function bone(name: string, parent: number | null, p: V3) {
  const id = nodes.length, position = new Vector3(...p)
  world.push(position)
  nodes.push({ name, translation: position.clone().sub(parent === null ? new Vector3() : world[parent]).toArray(), children: [] })
  if (parent === null) roots.push(id)
  else nodes[parent].children!.push(id)
  return id
}
const hips = bone('hips', null, [0, 1.02, 0])
const spine = bone('spine', hips, [0, 1.27, 0])
const chest = bone('chest', spine, [0, 1.60, 0])
const neck = bone('neck', chest, [0, 1.86, 0])
const head = bone('head', neck, [0, 2.01, 0])
const limbs: { sign: number; side: string; arm: number; elbow: number; hand: number; leg: number; knee: number; foot: number }[] = []
const fingers: { id: number; side: string; digit: string; segment: number }[] = []
for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
  const arm = bone(`${side}UpperArm`, chest, [sign * .32, 1.74, 0])
  const elbow = bone(`${side}LowerArm`, arm, [sign * .49, 1.43, 0])
  const hand = bone(`${side}Hand`, elbow, [sign * .59, 1.14, 0])
  const leg = bone(`${side}UpperLeg`, hips, [sign * .16, 1.00, 0])
  const knee = bone(`${side}LowerLeg`, leg, [sign * .19, .57, .015])
  const foot = bone(`${side}Foot`, knee, [sign * .21, .14, .015])
  limbs.push({ sign, side, arm, elbow, hand, leg, knee, foot })
  for (const [digitIndex, digit] of ['Index', 'Middle', 'Ring', 'Little', 'Thumb'].entries()) {
    let parent = hand
    const thumb = digit === 'Thumb'
    for (let segment = 0; segment < 3; segment++) {
      const suffix = thumb ? ['Metacarpal', 'Proximal', 'Distal'][segment] : ['Proximal', 'Intermediate', 'Distal'][segment]
      const x = sign * .59 + (thumb ? -sign * (.061 + segment * .018) : (digitIndex - 1.5) * .032)
      const y = thumb ? 1.115 - segment * .029 : 1.035 - segment * (.035 - digitIndex * .002)
      const id = bone(`${side}${digit}${suffix}`, parent, [x, y, thumb ? .025 : .009])
      fingers.push({ id, side, digit, segment }); parent = id
    }
  }
}
const jointCount = nodes.length
const palette = {
  skin: '#be8057', muscle: '#cb8e61', highlight: '#db9e71', shadow: '#995d41',
  leather: '#352724', leatherLight: '#624331', steel: '#627f89', edge: '#b5c8c6', gold: '#c49a4c',
  beard: '#74391e', hair: '#a45125', hairLight: '#bd6a30', dark: '#201d21', eye: '#90c9d8', white: '#ece5cf',
}
function rgb(hex: string): V3 {
  // glTF vertex colors are linear, unlike the artist-facing sRGB palette.
  return [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }) as V3
}
type Skin = (p: Vector3) => [number, number, number]
type Morph = (p: Vector3) => [V3, V3]
class Part {
  positions: number[] = []; normals: number[] = []; colors: number[] = []
  joints: number[] = []; weights: number[] = []; happy: number[] = []; angry: number[] = []
  name: string; skinned: boolean; material: number
  constructor(name: string, skinned = true, material = 0) { this.name = name; this.skinned = skinned; this.material = material }
  add(geometry: BufferGeometry, transform: Matrix4, color: string, skin: number | Skin = head, morph?: Morph) {
    geometry.applyMatrix4(transform)
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = rgb(color)
    for (let i = 0; i < p.count; i++) {
      const point = new Vector3().fromBufferAttribute(p, i)
      this.positions.push(...point.toArray()); this.normals.push(n.getX(i), n.getY(i), n.getZ(i)); this.colors.push(...c)
      const [a, b, t] = typeof skin === 'number' ? [skin, skin, 0] : skin(point)
      this.joints.push(t === 1 ? 0 : a, t === 0 ? 0 : b, 0, 0); this.weights.push(1 - t, t, 0, 0)
      const [happy, angry] = morph?.(point) ?? [[0, 0, 0], [0, 0, 0]]
      this.happy.push(...happy); this.angry.push(...angry)
    }
    g.dispose(); if (g !== geometry) geometry.dispose()
  }
}
const body = new Part('VikingBody'), armor = new Part('VikingArmor', true, 1), helmet = new Part('VikingHelmet', true, 1)
const axe = new Part('VikingAxe', false, 1), sword = new Part('VikingSword', false, 1)
const parts = [body, armor, helmet, axe, sword]
function matrix(p: V3, scale: V3 = [1, 1, 1], rotation: V3 = [0, 0, 0]) { return new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...scale)) }
function ellipsoid(part: Part, p: V3, size: V3, joint: number | Skin, color: string, morph?: Morph, rotation: V3 = [0, 0, 0]) {
  part.add(new SphereGeometry(1, 12, 8), matrix(p, size, rotation), color, joint, morph)
}
function box(part: Part, p: V3, size: V3, joint: number, color: string, rotation: V3 = [0, 0, 0], morph?: Morph) {
  part.add(new BoxGeometry(...size), matrix(p, [1, 1, 1], rotation), color, joint, morph)
}
function rod(part: Part, a: Vector3, b: Vector3, r1: number, r2: number, joint: number | Skin, color: string, segments = 10) {
  const delta = b.clone().sub(a)
  const transform = new Matrix4().compose(a.clone().add(b).multiplyScalar(.5), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.clone().normalize()), new Vector3(1, 1, 1))
  part.add(new CylinderGeometry(r2, r1, delta.length(), segments, 8), transform, color, joint)
}
function blend(a: number, b: number): Skin {
  const delta = world[b].clone().sub(world[a]), length2 = delta.lengthSq()
  return p => [a, b, Math.max(0, Math.min(1, (p.clone().sub(world[a]).dot(delta) / length2 - .55) / .65))]
}
const torso: Skin = p => p.y < 1.30 ? [hips, spine, Math.max(0, Math.min(1, (p.y - 1.02) / .28))] : [spine, chest, Math.max(0, Math.min(1, (p.y - 1.30) / .30))]
// Tapered torso, distinct pectorals, deltoids, biceps and abdominal planes.
ellipsoid(body, [0, 1.43, 0], [.285, .39, .155], torso, palette.skin)
ellipsoid(body, [0, 1.02, 0], [.245, .18, .15], hips, palette.leather)
for (const sign of [-1, 1]) {
  ellipsoid(body, [sign * .145, 1.66, .087], [.193, .145, .139], torso, palette.muscle, undefined, [0, 0, sign * -.14])
  ellipsoid(body, [sign * .18, 1.51, -.05], [.13, .23, .145], torso, palette.skin)
  for (let row = 0; row < 3; row++) ellipsoid(body, [sign * .078, 1.42 - row * .105, .127], [.077, .057, .052], torso, palette.muscle)
}
rod(body, world[chest], world[neck], .135, .09, blend(chest, neck), palette.skin)
for (const { sign, arm, elbow, hand, leg, knee, foot } of limbs) {
  rod(body, world[arm], world[elbow], .125, .076, blend(arm, elbow), palette.skin)
  ellipsoid(body, [sign * .348, 1.72, 0], [.153, .17, .153], arm, palette.muscle)
  ellipsoid(body, [sign * .411, 1.585, .045], [.103, .17, .109], blend(arm, elbow), palette.muscle, undefined, [0, 0, -sign * .48])
  rod(body, world[elbow], world[hand], .077, .05, blend(elbow, hand), palette.skin)
  ellipsoid(body, [sign * .529, 1.335, .015], [.081, .127, .075], blend(elbow, hand), palette.muscle, undefined, [0, 0, -sign * .33])
  ellipsoid(body, [sign * .59, 1.09, 0], [.068, .074, .039], hand, palette.skin)
  rod(body, world[leg], world[knee], .136, .088, blend(leg, knee), palette.leatherLight)
  ellipsoid(body, [sign * .172, .82, .014], [.14, .23, .14], blend(leg, knee), palette.leatherLight)
  rod(body, world[knee], world[foot], .087, .074, blend(knee, foot), palette.leather)
  ellipsoid(body, [sign * .21, .118, .088], [.106, .111, .196], foot, palette.leather)
  // Boot wraps and bracers stay with the body; removable armor is explicitly separate.
  for (const y of [.22, .29, .36, .43]) rod(body, new Vector3(sign * .20, y, .014), new Vector3(sign * .20, y + .028, .014), .089, .09, knee, palette.leatherLight)
  rod(body, world[elbow].clone().lerp(world[hand], .50), world[elbow].clone().lerp(world[hand], .83), .073, .063, elbow, palette.leather)
  box(body, [sign * .553, 1.23, .062], [.092, .042, .018], elbow, palette.gold, [0, 0, -sign * .3])
}
for (const { id, digit, segment } of fingers) {
  const child = nodes[id].children?.[0]
  const end = child !== undefined ? world[child] : world[id].clone().add(new Vector3(digit === 'Thumb' ? (nodes[id].name.startsWith('left') ? -.012 : .012) : 0, -.029, 0))
  rod(body, world[id], end, segment === 0 ? .019 : .016, .013, child === undefined ? id : blend(id, child), palette.skin, 8)
  ellipsoid(body, world[id].toArray() as V3, [.018, .018, .018], id, palette.highlight)
}
// Belt, buckle and overlapping leather skirt panels.
rod(body, new Vector3(0, 1.05, 0), new Vector3(0, 1.135, 0), .25, .25, hips, palette.leather)
box(body, [0, 1.095, .253], [.125, .08, .027], hips, palette.gold)
box(body, [0, 1.095, .27], [.069, .043, .009], hips, palette.dark)
for (let i = 0; i < 10; i++) {
  const a = i * Math.PI / 5
  box(body, [Math.sin(a) * .223, .935, Math.cos(a) * .169], [.128, .23, .033], hips, i % 2 ? palette.leather : palette.leatherLight, [0, a, 0])
  ellipsoid(body, [Math.sin(a) * .245, 1.10, Math.cos(a) * .245], [.018, .018, .018], hips, palette.gold)
}
// Head, ears, nose, eyes and a sculptural forked beard.
ellipsoid(body, [0, 2.075, 0], [.166, .223, .151], head, palette.skin)
ellipsoid(body, [0, 1.967, .01], [.141, .122, .129], head, palette.skin)
for (const sign of [-1, 1]) {
  ellipsoid(body, [sign * .166, 2.075, -.005], [.035, .058, .029], head, palette.muscle)
  ellipsoid(body, [sign * .069, 2.106, .131], [.047, .024, .024], head, palette.white)
  ellipsoid(body, [sign * .069, 2.105, .152], [.017, .019, .008], head, palette.eye)
  ellipsoid(body, [sign * .069, 2.105, .159], [.008, .013, .005], head, palette.dark)
  const browMorph: Morph = p => [[0, .015, 0], [0, .035 * (Math.abs(p.x) - .069) / .05 - .008, .003]]
  box(body, [sign * .069, 2.143, .144], [.105, .022, .028], head, palette.beard, [0, 0, sign * .03], browMorph)
  ellipsoid(body, [sign * .104, 2.026, .102], [.06, .057, .058], head, palette.muscle, p => [[0, .012, Math.max(0, 1 - Math.abs(p.x) / .18) * .006], [0, 0, 0]])
}
ellipsoid(body, [0, 2.066, .147], [.032, .056, .048], head, palette.highlight)
ellipsoid(body, [0, 2.236, -.012], [.171, .102, .149], head, palette.beard)
for (const sign of [-1, 1]) {
  ellipsoid(body, [sign * .119, 1.967, .085], [.056, .11, .064], head, palette.beard)
  rod(body, new Vector3(sign * .06, 1.998, .11), new Vector3(sign * .045, 1.775, .125), .093, .022, head, palette.hair)
  for (let i = 0; i < 4; i++) ellipsoid(body, [sign * (.048 + (i % 2) * .01), 1.91 - i * .035, .161], [.034, .031, .031], head, i % 2 ? palette.hair : palette.hairLight)
  rod(body, new Vector3(sign * .045, 1.82, .127), new Vector3(sign * .045, 1.85, .127), .028, .03, head, palette.gold)
}
// Mouth remains visible above the beard; the same vertices smile/frown via two targets.
ellipsoid(body, [0, 2.006, .164], [.071, .013, .016], head, palette.dark, p => [[0, .033 * (Math.abs(p.x) / .071) ** 1.5 - .007, .003], [0, -.025 * Math.abs(p.x) / .071 + .008, .005]])
for (const sign of [-1, 1]) ellipsoid(body, [sign * .043, 2.031, .15], [.052, .019, .024], head, palette.hair, undefined, [0, 0, -sign * .20])
// Fitted armor shares the exact body skin and bind space. Broad chest plates + fur shoulders.
ellipsoid(armor, [0, 1.48, -.005], [.301, .32, .187], torso, palette.leather)
for (const sign of [-1, 1]) {
  ellipsoid(armor, [sign * .143, 1.64, .124], [.174, .141, .122], torso, palette.steel, undefined, [0, 0, -sign * .10])
  for (let row = 0; row < 3; row++) box(armor, [sign * .108, 1.49 - row * .085, .19 - row * .012], [.19, .074, .04], spine, palette.steel)
  const arm = limbs.find(l => l.sign === sign)!.arm
  ellipsoid(armor, [sign * .342, 1.768, -.015], [.188, .149, .184], arm, palette.leatherLight)
  for (let i = 0; i < 7; i++) ellipsoid(armor, [sign * (.27 + i * .025), 1.787 - Math.sin(i / 6 * Math.PI) * .006, .11], [.04, .058, .044], arm, i % 2 ? '#a8997e' : '#c2b399')
  ellipsoid(armor, [sign * .381, 1.752, .01], [.169, .078, .189], arm, palette.steel)
  for (const x of [.045, .13, .215]) ellipsoid(armor, [sign * x, 1.719, .22], [.013, .013, .013], chest, palette.gold)
}
box(armor, [0, 1.61, .253], [.075, .21, .028], chest, palette.gold)
box(armor, [0, 1.61, .27], [.038, .11, .012], chest, palette.leather)
// Rounded iron helmet with segmented band, ridge and nasal guard (no fantasy horns).
helmet.add(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), matrix([0, 2.18, -.012], [.191, .19, .175]), palette.steel, head)
rod(helmet, new Vector3(0, 2.155, -.012), new Vector3(0, 2.202, -.012), .189, .189, head, palette.edge, 16)
box(helmet, [0, 2.181, .17], [.037, .092, .035], head, palette.gold)
box(helmet, [0, 2.122, .177], [.027, .094, .028], head, palette.steel)
for (let i = 0; i < 7; i++) {
  const a = i * Math.PI / 6
  ellipsoid(helmet, [0, 2.185 + Math.sin(a) * .185, -.012 + Math.cos(a) * .174], [.022, .023, .025], head, palette.gold)
}
for (const sign of [-1, 1]) {
  box(helmet, [sign * .162, 2.086, -.028], [.042, .18, .125], head, palette.steel, [0, 0, -sign * .12])
  for (let i = 0; i < 5; i++) {
    const a = (i + .5) * Math.PI / 5
    ellipsoid(helmet, [sign * Math.sin(a) * .191, 2.178, Math.cos(a) * .191 - .012], [.012, .012, .012], head, palette.gold)
  }
}
// Weapon local origin is the grip; both assets use one authored socket transform.
rod(axe, new Vector3(0, -.24, 0), new Vector3(0, .53, 0), .023, .027, head, palette.leatherLight)
for (let i = 0; i < 5; i++) rod(axe, new Vector3(0, -.09 + i * .038, 0), new Vector3(0, -.071 + i * .038, 0), .029, .029, head, palette.leather)
box(axe, [0, .43, 0], [.10, .17, .085], head, palette.gold)
// Broad bearded axe head, extruded polygon with a bright cutting edge.
function prism(part: Part, outline: [number, number][], depth: number, color: string) {
  // Polygon fan is authored convex; normals are calculated per triangle for crisp facets.
  const p: number[] = []
  const triangle = (a: V3, b: V3, c: V3) => p.push(...a, ...b, ...c)
  for (let i = 1; i < outline.length - 1; i++) {
    triangle([...outline[0], depth / 2], [...outline[i], depth / 2], [...outline[i + 1], depth / 2])
    triangle([...outline[0], -depth / 2], [...outline[i + 1], -depth / 2], [...outline[i], -depth / 2])
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length]
    triangle([...a, depth / 2], [...a, -depth / 2], [...b, depth / 2]); triangle([...b, depth / 2], [...a, -depth / 2], [...b, -depth / 2])
  }
  // Reuse a fresh buffer geometry without depending on a glTF exporter or FileReader.
  const g = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(p, 3))
  g.computeVertexNormals(); part.add(g, new Matrix4(), color)
}
prism(axe, [[-.035, .52], [-.035, .38], [.14, .27], [.28, .30], [.29, .61], [.15, .57]], .065, palette.steel)
prism(axe, [[.245, .30], [.28, .30], [.29, .61], [.255, .59]], .07, palette.edge)
rod(sword, new Vector3(0, -.17, 0), new Vector3(0, .12, 0), .027, .027, head, palette.leather)
ellipsoid(sword, [0, -.19, 0], [.049, .045, .042], head, palette.gold)
box(sword, [0, .13, 0], [.26, .04, .048], head, palette.gold)
prism(sword, [[-.045, .15], [.045, .15], [.039, .77], [0, .89], [-.039, .77]], .027, palette.edge)
box(sword, [0, .46, .015], [.016, .56, .009], head, palette.steel)

// glTF buffer writer; every resource is embedded and all accessors are aligned.
const buffers: Buffer[] = [], bufferViews: object[] = [], accessors: object[] = []
let byteLength = 0
function accessor(values: number[], type: string, components: number, integer = false, bounds = false) {
  const array = integer ? new Uint16Array(values) : new Float32Array(values), bytes = Buffer.from(array.buffer)
  const view = bufferViews.length
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length }); buffers.push(bytes); byteLength += bytes.length
  const padding = (4 - byteLength % 4) % 4; buffers.push(Buffer.alloc(padding)); byteLength += padding
  const min = Array(components).fill(Infinity), max = Array(components).fill(-Infinity)
  if (bounds) for (let i = 0; i < array.length; i++) { min[i % components] = Math.min(min[i % components], array[i]); max[i % components] = Math.max(max[i % components], array[i]) }
  accessors.push({ bufferView: view, componentType: integer ? 5123 : 5126, count: values.length / components, type, ...(bounds ? { min, max } : {}) })
  return accessors.length - 1
}
// Weld identical vertices, retaining normal/color/skin/morph seams. Indexing keeps
// the portable demo small without sacrificing the readable silhouette or fingers.
function indexPart(part: Part) {
  const streams = [part.positions, part.normals, part.colors, part.joints, part.weights, part.happy, part.angry]
  const widths = [3, 3, 3, 4, 4, 3, 3], packed = streams.map(() => [] as number[])
  const known = new Map<string, number>(), indices: number[] = []
  for (let i = 0; i < part.positions.length / 3; i++) {
    const rows = streams.map((s, j) => s.slice(i * widths[j], (i + 1) * widths[j]))
    const key = rows.flat().map(n => Math.round(n * 1e6)).join(',')
    let index = known.get(key)
    if (index === undefined) {
      index = known.size; known.set(key, index)
      rows.forEach((row, j) => packed[j].push(...row))
    }
    indices.push(index)
  }
  if (known.size > 65535) throw new Error('Fixture exceeds 16-bit vertex budget')
  ;[part.positions, part.normals, part.colors, part.joints, part.weights, part.happy, part.angry] = packed
  return indices
}
const meshes = parts.map(part => {
  const indices = indexPart(part)
  return {
  name: part.name,
  primitives: [{ attributes: {
    POSITION: accessor(part.positions, 'VEC3', 3, false, true), NORMAL: accessor(part.normals, 'VEC3', 3), COLOR_0: accessor(part.colors, 'VEC3', 3),
    ...(part.skinned ? { JOINTS_0: accessor(part.joints, 'VEC4', 4, true), WEIGHTS_0: accessor(part.weights, 'VEC4', 4) } : {}),
  }, indices: accessor(indices, 'SCALAR', 1, true), material: part.material, ...(part === body ? { targets: [{ POSITION: accessor(part.happy, 'VEC3', 3, false, true) }, { POSITION: accessor(part.angry, 'VEC3', 3, false, true) }] } : {}) }],
  ...(part === body ? { weights: [0, 0], extras: { targetNames: ['happy', 'angry'] } } : {}),
}})
for (const mesh of meshes) for (const primitive of mesh.primitives) {
  for (const index of [...Object.values(primitive.attributes), ...(primitive.targets ?? []).flatMap(t => Object.values(t))]) {
    const { bufferView } = accessors[index] as { bufferView: number }
    ;(bufferViews[bufferView] as { target?: number }).target = 34962
  }
  const { bufferView } = accessors[primitive.indices] as { bufferView: number }
  ;(bufferViews[bufferView] as { target?: number }).target = 34963
}
const inverseBindMatrices = accessor(world.flatMap(p => new Matrix4().makeTranslation(-p.x, -p.y, -p.z).elements), 'MAT4', 16)
const rightHand = limbs.find(l => l.side === 'right')!.hand
const socket = nodes.length
nodes.push({ name: 'rightHandSocket', translation: [0, -.115, .061], rotation: new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)).toArray(), children: [], extras: { bone: 'rightHand', purpose: 'weapon', grip: 'hands-grip' } })
nodes[rightHand].children!.push(socket)
for (const [i, part] of parts.entries()) {
  const id = nodes.length
  nodes.push({ name: part.name, mesh: i, ...(part.skinned ? { skin: 0 } : {}), ...(part === sword ? { scale: [0, 0, 0] } : {}) })
  if (part.skinned) roots.push(id)
  else nodes[socket].children!.push(id)
}
// Complete body tracks keep crossfades independent of whichever clip played before.
// Finger-only clips have disjoint bindings, so their full-weight pose coexists with motion.
type Pose = Record<string, V3>
const bodyBones = nodes.slice(0, jointCount).map((n, i) => ({ name: n.name, id: i })).filter(n => !fingers.some(f => f.id === n.id))
const neutral: Pose = { rightLowerArm: [0, 0, -.95], leftLowerArm: [-.08, 0, .08] }
const ready: Pose = { ...neutral, hips: [0, -.17, 0], chest: [.10, .12, 0], rightUpperArm: [-.48, -.2, -.18], rightLowerArm: [-.25, 0, -1.22], leftUpperArm: [-.35, 0, .14], leftLowerArm: [-.65, 0, .24], leftUpperLeg: [-.13, 0, -.1], rightUpperLeg: [.13, 0, .1], leftLowerLeg: [.18, 0, 0], rightLowerLeg: [.12, 0, 0] }
const animations: object[] = []
function clip(name: string, times: number[], poses: Pose[], handOnly = false) {
  const input = accessor(times, 'SCALAR', 1, false, true), samplers: object[] = [], channels: object[] = []
  for (const { name: boneName, id } of handOnly ? fingers.map(f => ({ id: f.id, name: nodes[f.id].name })) : bodyBones) {
    const rotations = poses.flatMap(p => new Quaternion().setFromEuler(new Euler(...(p[boneName] ?? [0, 0, 0]))).toArray())
    const output = accessor(rotations, 'VEC4', 4)
    channels.push({ sampler: samplers.length, target: { node: id, path: 'rotation' } }); samplers.push({ input, output, interpolation: 'LINEAR' })
  }
  animations.push({ name, samplers, channels })
}
clip('idle', [0, 1.5, 3], [neutral, { ...neutral, spine: [.025, 0, 0], chest: [-.035, 0, .015], head: [0, .07, 0], rightLowerArm: [.03, 0, -1.01] }, neutral])
const walkPose = (sign: number): Pose => ({ ...neutral, hips: [0, sign * .055, sign * .025], chest: [0, -sign * .07, 0], rightUpperLeg: [sign * .48, 0, 0], leftUpperLeg: [-sign * .48, 0, 0], rightLowerLeg: [sign > 0 ? .60 : .06, 0, 0], leftLowerLeg: [sign < 0 ? .60 : .06, 0, 0], rightUpperArm: [-sign * .25, 0, 0], leftUpperArm: [sign * .38, 0, 0] })
clip('walk', [0, .3, .6, .9, 1.2], [walkPose(1), neutral, walkPose(-1), neutral, walkPose(1)])
clip('battle-ready', [0, 1, 2], [ready, { ...ready, chest: [.13, .15, -.025], rightLowerArm: [-.28, 0, -1.27] }, ready])
clip('attack', [0, .35, .55, .8, 1.2], [ready, { ...ready, chest: [0, -.4, -.1], rightUpperArm: [0, -.2, -1.5], rightLowerArm: [-.3, 0, -1.3] }, { ...ready, hips: [.12, .3, 0], chest: [.25, .35, .08], rightUpperArm: [-1.1, .15, -.3], rightLowerArm: [-.3, 0, -.35] }, { ...ready, chest: [.20, .18, .04], rightUpperArm: [-.8, .1, -.16] }, ready])
const cheer: Pose = { ...neutral, rightUpperArm: [0, 0, -2.25], leftUpperArm: [0, 0, 2.25], rightLowerArm: [0, 0, -.45], leftLowerArm: [0, 0, .45], head: [-.14, 0, 0] }
clip('cheer', [0, .45, .8, 1.15, 1.5, 2], [neutral, cheer, { ...cheer, chest: [0, 0, -.07] }, { ...cheer, chest: [0, 0, .07] }, cheer, neutral])
const wave: Pose = { ...neutral, leftUpperArm: [0, 0, 1.8], leftLowerArm: [0, 0, .8], leftHand: [0, 0, .15] }
clip('wave', [0, .4, .8, 1.2, 1.6, 2], [neutral, wave, { ...wave, leftLowerArm: [0, 0, 1.2], leftHand: [0, 0, -.2] }, wave, { ...wave, leftLowerArm: [0, 0, 1.2] }, neutral])
for (const gripping of [false, true]) {
  const pose: Pose = {}
  for (const { id, side, digit, segment } of fingers) {
    const curl = gripping && side === 'right' ? (digit === 'Thumb' ? .65 : [1.2, 1.45, .9][segment]) : (digit === 'Thumb' ? .12 : .06)
    pose[nodes[id].name] = [-curl, digit === 'Thumb' ? (side === 'right' ? -.3 : .3) : 0, 0]
  }
  clip(gripping ? 'hands-grip' : 'hands-open', [0, 1], [pose, pose], true)
}
const gltf = {
  asset: { version: '2.0', generator: 'AOZU original procedural Viking demo / CC0-1.0', copyright: 'Dedicated to the public domain under CC0-1.0' },
  scene: 0, scenes: [{ nodes: roots }], nodes: nodes.map(({ children, ...node }) => ({ ...node, ...(children?.length ? { children } : {}) })), meshes,
  materials: [
    { name: 'Skin-leather-hair', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: .83 } },
    { name: 'Forged-iron-and-brass', pbrMetallicRoughness: { metallicFactor: .55, roughnessFactor: .48 }, doubleSided: true },
  ],
  skins: [{ name: 'VikingHumanoid', joints: Array.from({ length: jointCount }, (_, i) => i), skeleton: hips, inverseBindMatrices }],
  animations, accessors, bufferViews, buffers: [{ byteLength }],
  extras: { demoArt: true, humanoidSemantics: 'VRM-1.0-names; plain glTF, not VRM', equipment: ['VikingArmor', 'VikingHelmet'], weapons: ['VikingAxe', 'VikingSword'], socket: 'rightHandSocket' },
}
const json = Buffer.from(JSON.stringify(gltf)), jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]), binary = Buffer.concat(buffers)
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonPadded.length + binary.length, 8)
function chunk(data: Buffer, type: number) { const h = Buffer.alloc(8); h.writeUInt32LE(data.length); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]) }
const output = Buffer.concat([header, chunk(jsonPadded, 0x4e4f534a), chunk(binary, 0x004e4942)])
writeFileSync(new URL('../public/glb/demo-viking.glb', import.meta.url), output)
console.log(`Generated Viking: ${jointCount} bones, ${parts.reduce((n, p) => n + p.positions.length / 3, 0)} vertices, ${animations.length} clips, ${(output.length / 1e6).toFixed(2)} MB`)
