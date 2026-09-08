/**
 * Tiny MagicaVoxel v150 character used by the 3D render-mode spike.
 *
 * Source: generated here (not converted from 2D PNG layers).
 * License: CC0-1.0 / public domain — original geometry for AOZU.
 * Format: official MagicaVoxel .vox (VERSION 150), SIZE + XYZI + RGBA.
 * The committed binary is `public/vox/demo-character.vox`.
 */

export const DEMO_VOX_RELATIVE_PATH = 'public/vox/demo-character.vox'

const SIZE = { x: 9, y: 7, z: 16 } as const

/** Palette index 1+; RGBA bytes stored little-endian for VOXLoader. */
const PALETTE: Array<readonly [number, number, number, number]> = [
  [240, 196, 160, 255], // 1 skin
  [59, 36, 22, 255], // 2 hair
  [79, 127, 107, 255], // 3 shirt
  [58, 63, 82, 255], // 4 pants
  [42, 33, 28, 255], // 5 shoes
  [26, 20, 16, 255], // 6 eyes
  [232, 160, 144, 255], // 7 blush
]

const SKIN = 1
const HAIR = 2
const SHIRT = 3
const PANTS = 4
const SHOES = 5
const EYES = 6
const BLUSH = 7

type Voxel = { x: number; y: number; z: number; color: number }

const inBounds = (x: number, y: number, z: number) =>
  x >= 0 && x < SIZE.x && y >= 0 && y < SIZE.y && z >= 0 && z < SIZE.z

const fill = (voxels: Map<string, Voxel>, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, skip?: (x: number, y: number, z: number) => boolean) => {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (!inBounds(x, y, z) || skip?.(x, y, z)) continue
        voxels.set(`${x},${y},${z}`, { x, y, z, color })
      }
    }
  }
}

const corner = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  (x === x0 || x === x1) && (y === y0 || y === y1)

export const buildDemoCharacterVoxels = (): Voxel[] => {
  const voxels = new Map<string, Voxel>()

  // Head (rounded) and hair cap / bangs / ahoge.
  fill(voxels, 2, 1, 11, 6, 5, 14, SKIN, (x, y, z) => z >= 13 && corner(x, y, 2, 1, 6, 5))
  fill(voxels, 2, 1, 14, 6, 5, 15, HAIR, (x, y) => corner(x, y, 2, 1, 6, 5))
  fill(voxels, 3, 2, 15, 5, 4, 15, HAIR)
  fill(voxels, 3, 1, 14, 5, 1, 14, HAIR)
  fill(voxels, 4, 3, 16, 4, 3, 16, HAIR)
  fill(voxels, 3, 1, 13, 3, 1, 13, EYES)
  fill(voxels, 5, 1, 13, 5, 1, 13, EYES)
  fill(voxels, 2, 1, 12, 2, 1, 12, BLUSH)
  fill(voxels, 6, 1, 12, 6, 1, 12, BLUSH)

  // Torso, arms, legs, shoes.
  fill(voxels, 2, 2, 6, 6, 4, 10, SHIRT)
  fill(voxels, 0, 2, 7, 1, 3, 10, SKIN)
  fill(voxels, 7, 2, 7, 8, 3, 10, SKIN)
  fill(voxels, 2, 2, 5, 6, 4, 5, PANTS)
  fill(voxels, 2, 2, 2, 3, 3, 4, PANTS)
  fill(voxels, 5, 2, 2, 6, 3, 4, PANTS)
  fill(voxels, 2, 1, 0, 3, 3, 1, SHOES)
  fill(voxels, 5, 1, 0, 6, 3, 1, SHOES)

  return [...voxels.values()]
}

const writeInt32 = (target: Uint8Array, offset: number, value: number) => {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setInt32(offset, value, true)
}

const ascii = (value: string) => Uint8Array.from(value, (character) => character.charCodeAt(0))

const chunk = (id: string, content: Uint8Array) => {
  const out = new Uint8Array(12 + content.length)
  out.set(ascii(id))
  writeInt32(out, 4, content.length)
  writeInt32(out, 8, 0)
  out.set(content, 12)
  return out
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export const buildDemoCharacterVox = (): Uint8Array => {
  const voxels = buildDemoCharacterVoxels()
  const sizeContent = new Uint8Array(12)
  writeInt32(sizeContent, 0, SIZE.x)
  writeInt32(sizeContent, 4, SIZE.y)
  writeInt32(sizeContent, 8, SIZE.z)

  const xyziContent = new Uint8Array(4 + voxels.length * 4)
  writeInt32(xyziContent, 0, voxels.length)
  voxels.forEach((voxel, index) => {
    const offset = 4 + index * 4
    xyziContent[offset] = voxel.x
    xyziContent[offset + 1] = voxel.y
    xyziContent[offset + 2] = voxel.z
    xyziContent[offset + 3] = voxel.color
  })

  const rgbaContent = new Uint8Array(1024)
  PALETTE.forEach(([r, g, b, a], index) => {
    const offset = index * 4
    rgbaContent[offset] = r
    rgbaContent[offset + 1] = g
    rgbaContent[offset + 2] = b
    rgbaContent[offset + 3] = a
  })

  const children = concat(chunk('SIZE', sizeContent), chunk('XYZI', xyziContent), chunk('RGBA', rgbaContent))
  const header = new Uint8Array(8)
  header.set(ascii('VOX '))
  writeInt32(header, 4, 150)
  const main = new Uint8Array(12 + children.length)
  main.set(ascii('MAIN'))
  writeInt32(main, 4, 0)
  writeInt32(main, 8, children.length)
  main.set(children, 12)
  return concat(header, main)
}

export const inspectVox = (bytes: Uint8Array) => {
  if (bytes.length < 20) throw new Error('VOX file is too small')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (magic !== 'VOX ') throw new Error(`Invalid VOX magic: ${magic}`)
  const version = view.getInt32(4, true)
  if (version !== 150 && version !== 200) throw new Error(`Unsupported VOX version: ${version}`)
  let offset = 8
  let size: { x: number; y: number; z: number } | undefined
  let voxelCount = 0
  while (offset + 12 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    const contentSize = view.getInt32(offset + 4, true)
    offset += 12
    if (id === 'SIZE') {
      size = { x: view.getInt32(offset, true), y: view.getInt32(offset + 4, true), z: view.getInt32(offset + 8, true) }
    } else if (id === 'XYZI') {
      voxelCount = view.getInt32(offset, true)
    }
    offset += contentSize
  }
  if (!size) throw new Error('VOX file is missing a SIZE chunk')
  if (voxelCount <= 0) throw new Error('VOX file has no voxels')
  return { version, size, voxelCount }
}
