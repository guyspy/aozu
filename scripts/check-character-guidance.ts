import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { CHARACTER_AUTHORING_GUIDE, CHARACTER_BACKGROUND_GUIDANCE, characterMetadataStatus } from '../src/core/application/character-agent-guidance.ts'
import { CHARACTER_ASSET_LANES, CHARACTER_ASSET_POLICY, CHARACTER_CREATION_GROUPS } from '../src/core/application/character-asset-policy.ts'
import { createCharacterDraft, updateCharacterVariantMetadata } from '../src/core/application/character-creation.ts'
import { measureCharacterPointAlignment, measureCharacterMaskAlignment, type CharacterAlignmentPoint } from '../src/core/application/character-alignment.ts'

const points: CharacterAlignmentPoint[] = [
  { label: 'upper left', candidate: { x: 100, y: 100 }, reference: { x: 120, y: 140 } },
  { label: 'upper right', candidate: { x: 300, y: 100 }, reference: { x: 320, y: 140 } },
  { label: 'lower contact', candidate: { x: 200, y: 500 }, reference: { x: 220, y: 540 } },
]
const translated = measureCharacterPointAlignment(points)
assert.equal(translated.status, 'suggested')
assert.deepEqual(translated.suggestedTransform, { x: 20, y: 40, scale: 1 })
assert.equal(measureCharacterPointAlignment(points, translated.suggestedTransform!).before.max, 0)
const scaled = points.map((p) => ({ ...p, reference: { x: p.candidate.x * 0.8 + 15, y: p.candidate.y * 0.8 + 25 } }))
assert.deepEqual(measureCharacterPointAlignment(scaled).suggestedTransform, { x: 15, y: 25, scale: 0.8 })
const distorted = points.map((p, i) => ({ ...p, reference: { ...p.reference, x: p.reference.x + (i === 2 ? 45 : 0) } }))
assert.equal(measureCharacterPointAlignment(distorted).status, 'needs-artwork-correction')
assert.equal(measureCharacterPointAlignment(distorted).suggestedTransform, null)
assert.throws(() => measureCharacterPointAlignment(points.slice(0, 2)))
assert.throws(() => measureCharacterPointAlignment(points.map((p) => ({ ...p, candidate: { x: 100, y: 100 } }))))
assert.throws(() => measureCharacterPointAlignment(points.map((p) => ({ ...p, label: 'duplicate' }))))
assert.throws(() => measureCharacterPointAlignment(points.map((p) => ({ ...p, reference: { x: NaN, y: 0 } }))))
const mask = (x: number, y: number, w: number, h: number) => {
  const alpha = new Uint8Array(512 * 768)
  for (let row = y; row < y + h; row++) alpha.fill(255, row * 512 + x, row * 512 + x + w)
  return { width: 512, height: 768, alpha }
}
const body = mask(100, 100, 200, 500), garment = mask(100, 100, 200, 120)
const alignedOverlay = measureCharacterMaskAlignment('outfit', body, garment)
const movedOverlay = measureCharacterMaskAlignment('outfit', body, garment, { x: 300, y: 0, scale: 1 })
assert.equal(alignedOverlay.status, 'unverified', 'Partial overlap is never visual approval')
assert.ok('metrics' in alignedOverlay && alignedOverlay.metrics && 'iou' in alignedOverlay.metrics && alignedOverlay.metrics.iou === 0.24)
assert.ok('metrics' in movedOverlay && movedOverlay.metrics && 'iou' in movedOverlay.metrics && movedOverlay.metrics.iou === 0)
assert.ok(!('suggestedTransform' in alignedOverlay), 'Never auto-fit a partial item to a whole body')

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
assert.ok(CHARACTER_BACKGROUND_GUIDANCE.includes('移除此圖像的背景。保持所有前景主體不變且完整，邊緣乾淨平滑。將背景設為透明。'))
assert.ok(CHARACTER_BACKGROUND_GUIDANCE.includes('intentional 2× authoring canvas'))
assert.equal(CHARACTER_ASSET_POLICY.input.alpha.instruction, CHARACTER_BACKGROUND_GUIDANCE)
assert.deepEqual(CHARACTER_CREATION_GROUPS.map(({ group }) => group), Object.keys(CHARACTER_ASSET_LANES))
for (const [group, lane] of Object.entries(CHARACTER_ASSET_LANES)) {
  assert.ok(lane.layers.length, `${group} needs at least one owned layer`)
  assert.ok(lane.instruction.length > 40, `${group} needs lane guidance`)
}
for (const group of ['outfit', 'hair', 'headwear', 'prop', 'expression'] as const) {
  const id = `new-${group}`
  const created = updateCharacterVariantMetadata(draft, group, id, {
    label: `New ${group}`,
    description: `Independent ${group} asset.`,
    tags: [group],
    ...(group === 'outfit' ? { outfit: { slot: 'one-piece' as const, garmentType: 'test garment' } } : {}),
    ...(group === 'expression' ? { faceStyleId: 'default' } : {}),
  })
  assert.ok(created.variants.some((variant) => variant.group === group && variant.id === id), `${group} metadata must create a missing variant`)
}
for (const source of [guide, readFileSync('public/llms.txt', 'utf8'), readFileSync('README.md', 'utf8')]) {
  assert.doesNotMatch(source, /outfit skins?|navigate_character|update_collection_profile|complete outfit skins?/i, 'Public instructions advertise obsolete tools or clothing layers')
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
