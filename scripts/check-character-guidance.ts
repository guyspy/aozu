import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { CHARACTER_AUTHORING_GUIDE, characterMetadataStatus } from '../src/core/application/character-agent-guidance.ts'
import { createCharacterDraft, updateCharacterVariantMetadata } from '../src/core/application/character-creation.ts'

const draft = createCharacterDraft()
assert.equal(characterMetadataStatus(draft, 'body', 'base').complete, true)
for (const group of ['outfit', 'prop', 'hair', 'headwear', 'expression'] as const) {
  const missing = characterMetadataStatus(draft, group, 'new').missing
  assert.ok(missing.includes('description') && missing.includes('tags'), `${group} must describe its asset`)
}
assert.deepEqual(characterMetadataStatus(draft, 'outfit', 'top-1').missing, ['description', 'tags'])
const dressed = updateCharacterVariantMetadata(draft, 'outfit', 'top-1', { label: 'Green tank', description: 'Fitted green cotton tank.', tags: ['green', 'cotton'] })
assert.equal(characterMetadataStatus(dressed, 'outfit', 'top-1').complete, true)
assert.equal(characterMetadataStatus(dressed, 'outfit', 'top-1').sourceSha256, null, 'Never invent provenance')
const makeup = updateCharacterVariantMetadata(draft, 'expression', 'stage-neutral', {
  label: 'Stage neutral', description: 'Complete neutral head with gold face paint.', tags: ['neutral', 'gold'],
  faceStyle: { id: 'stage', label: 'Stage makeup', description: 'Gold face paint across expressions.', tags: ['makeup'] },
})
assert.equal(makeup.faceStyles.at(-1)?.facialHair, null, 'Makeup needs no beard data')
assert.equal(characterMetadataStatus(makeup, 'expression', 'stage-neutral').complete, true)
assert.equal(makeup.variants.find((v) => v.id === 'happy')?.metadata?.faceStyleId, 'default', 'New Facial Variants must not relabel old expression sets')
const bearded = updateCharacterVariantMetadata(makeup, 'expression', 'stage-neutral', { faceStyle: { ...makeup.faceStyles.at(-1)!, facialHair: { type: 'goatee' } } })
const edited = updateCharacterVariantMetadata(bearded, 'expression', 'stage-neutral', { faceStyle: { id: 'stage', label: 'Stage makeup', description: 'Gold paint and goatee.' } })
assert.equal(edited.faceStyles.at(-1)?.facialHair?.type, 'goatee', 'Generic edits must retain optional facial details')
assert.deepEqual(edited.faceStyles.at(-1)?.tags, ['makeup'], 'Partial facial metadata edits must retain omitted tags')

const guide = readFileSync(`public${CHARACTER_AUTHORING_GUIDE.path}`, 'utf8')
assert.ok(guide.includes(`Guide version: ${CHARACTER_AUTHORING_GUIDE.version}`), 'Live guide and contract version drifted')
for (const source of [guide, readFileSync('public/llms.txt', 'utf8'), readFileSync('README.md', 'utf8')]) {
  assert.doesNotMatch(source, /outfit skins?|navigate_character|complete outfit skins?/i, 'Public instructions advertise obsolete tools or clothing layers')
}
// Run the exact copyable toolkit against real bytes, without printing its payload.
const helper = guide.match(/```js\n([\s\S]*?)\/\/ In the same host runtime/)![1]
const { pngWebMcpPayload } = await import(`data:text/javascript,${encodeURIComponent(`${helper}\nexport { pngWebMcpPayload };`)}`)
const temp = mkdtempSync(join(tmpdir(), 'aozu-guide-'))
try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  const path = join(temp, 'source.png'); writeFileSync(path, png)
  const payload = await pngWebMcpPayload(path)
  assert.equal(payload.filename, 'source.png')
  assert.equal(payload.dataSha256, createHash('sha256').update(png).digest('hex'))
  assert.deepEqual(Buffer.from(payload.dataUrl.split(',')[1], 'base64'), png)
  writeFileSync(path, 'not a PNG')
  await assert.rejects(pngWebMcpPayload(path), /original PNG/)
} finally { rmSync(temp, { recursive: true, force: true }) }
console.log('character authoring guidance: ok')
