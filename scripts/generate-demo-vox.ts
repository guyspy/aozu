import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { DEMO_VOX_RELATIVE_PATH, buildDemoCharacterVox, inspectVox } from './demo-vox.ts'

const dest = resolve(import.meta.dirname, '..', DEMO_VOX_RELATIVE_PATH)
mkdirSync(dirname(dest), { recursive: true })
const bytes = buildDemoCharacterVox()
writeFileSync(dest, bytes)
const info = inspectVox(bytes)
console.log(`wrote ${dest} (${bytes.length} bytes, ${info.voxelCount} voxels, v${info.version})`)
