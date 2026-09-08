import { strFromU8, unzipSync } from 'fflate'

export const safeZipPath = (path: string) => path.length <= 200 && !path.startsWith('/') && !path.includes('\\') &&
  path.split('/').every((part) => part && part !== '.' && part !== '..')
export const parseZipJson = <T>(bytes: Uint8Array, label: string): T => {
  try {
    const value: unknown = JSON.parse(strFromU8(bytes))
    const pending = [{ value, depth: 0 }]
    while (pending.length) {
      const current = pending.pop()!
      if (current.depth > 50) throw new Error('too deep')
      if (current.value && typeof current.value === 'object') {
        for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 })
      }
    }
    return value as T
  } catch { throw new Error(`Invalid ${label}`) }
}

export interface ZipLimits { archive: number; expanded: number; file: number; files: number }
const defaults: ZipLimits = { archive: 50 * 1024 * 1024, expanded: 100 * 1024 * 1024, file: 20 * 1024 * 1024, files: 500 }
interface ZipMember { size: number; crc: number }

/** Reject ambiguous directories and local headers before allocating decompressed files. No ZIP64 or multi-disk ZIPs. */
export function inspectZipDirectory(bytes: Uint8Array, limits: ZipLimits = defaults): Map<string, ZipMember> {
  if (bytes.byteLength > limits.archive) throw new Error('Archive is too large')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { eocd = offset; break }
  }
  if (eocd < 0) throw new Error('ZIP directory is missing')
  const count = view.getUint16(eocd + 10, true)
  const directorySize = view.getUint32(eocd + 12, true)
  let offset = view.getUint32(eocd + 16, true)
  const directoryStart = offset
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0 ||
    view.getUint16(eocd + 8, true) !== count || count > limits.files || count === 0xffff || offset + directorySize !== eocd) throw new Error('Unsupported ZIP directory')
  const names = new Map<string, ZipMember>()
  const ranges: Array<[number, number]> = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let expanded = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP entry')
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const crc = view.getUint32(offset + 16, true)
    const compressed = view.getUint32(offset + 20, true)
    const size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const end = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    if (end > eocd || local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid ZIP entry')
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    const path = name.endsWith('/') ? name.slice(0, -1) : name
    if ((flags & ~0x080e) || (method !== 0 && method !== 8) || !safeZipPath(path) || names.has(name) || size > limits.file ||
      compressed === 0xffffffff || view.getUint16(offset + 34, true) !== 0) throw new Error(`Unsafe ZIP entry: ${name}`)
    const localNameLength = view.getUint16(local + 26, true)
    const dataStart = local + 30 + localNameLength + view.getUint16(local + 28, true)
    if (dataStart + compressed > directoryStart || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name ||
      (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size))) throw new Error(`ZIP local header mismatch: ${name}`)
    ranges.push([local, dataStart + compressed])
    names.set(name, { size, crc })
    expanded += size
    if (expanded > limits.expanded) throw new Error('Expanded archive is too large')
    offset = end
  }
  if (offset !== eocd) throw new Error('ZIP directory count mismatch')
  ranges.sort(([left], [right]) => left - right)
  if (ranges.some(([start], index) => index > 0 && start < ranges[index - 1][1])) throw new Error('Overlapping ZIP entries')
  return names
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function readSafeZip(bytes: Uint8Array, accepts: (path: string) => boolean, limits?: ZipLimits) {
  const members = inspectZipDirectory(bytes, limits)
  for (const name of members.keys()) if (!accepts(name)) throw new Error(`Unsafe ZIP entry: ${name}`)
  const files = unzipSync(bytes)
  if (Object.keys(files).length !== members.size) throw new Error('ZIP file count mismatch')
  for (const [name, member] of members) {
    if (!files[name] || files[name].byteLength !== member.size || crc32(files[name]) !== member.crc) throw new Error(`ZIP checksum mismatch: ${name}`)
  }
  return files
}
