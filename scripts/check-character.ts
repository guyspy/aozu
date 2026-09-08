import assert from 'node:assert/strict'

import { CHARACTER_RIG, validateCharacterPack, type CharacterPack } from '../src/core/domain/character.ts'

const inspection = { width: 512, height: 768, hasTransparentPixels: true, hasVisiblePixels: true, genuineRgba: true, visibleBounds: { x: 40, y: 20, width: 430, height: 720 }, visiblePixelCount: 100, size: 10, sha256: 'a'.repeat(64) }
const pack: CharacterPack = {
  id: 'guide', version: 1, rigProfile: { id: CHARACTER_RIG.id, version: CHARACTER_RIG.version },
  creator: { name: 'Companion' }, license: { id: 'test', url: 'https://example.com/license', embedding: 'allowed' },
  assets: [
    { id: 'hat-back', blobId: 'hat-back', mediaType: 'image/png', size: 10, sha256: inspection.sha256 },
    { id: 'skin', blobId: 'skin', mediaType: 'image/png', size: 10, sha256: inspection.sha256 },
    { id: 'head', blobId: 'head', mediaType: 'image/png', size: 10, sha256: inspection.sha256 },
    { id: 'hat-front', blobId: 'hat-front', mediaType: 'image/png', size: 10, sha256: inspection.sha256 },
  ],
  appearances: [
    { id: 'hat', layers: [
      { asset: { packId: 'guide', packVersion: 1, assetId: 'hat-back' }, slot: 'item-back', order: 1 },
      { asset: { packId: 'guide', packVersion: 1, assetId: 'hat-front' }, slot: 'item-front', order: 1 },
    ] },
    { id: 'default', layers: [{ asset: { packId: 'guide', packVersion: 1, assetId: 'skin' }, slot: 'character-skin', order: 1 }] },
    { id: 'happy', layers: [{ asset: { packId: 'guide', packVersion: 1, assetId: 'head' }, slot: 'expression-head', order: 1 }] },
  ],
  defaultComposition: [
    { packId: 'guide', packVersion: 1, appearanceId: 'hat' },
    { packId: 'guide', packVersion: 1, appearanceId: 'default' },
    { packId: 'guide', packVersion: 1, appearanceId: 'happy' },
  ],
}
const inspections = new Map(pack.assets.map(({ blobId }) => [blobId, inspection]))
assert.deepEqual(validateCharacterPack(pack, inspections).map(({ slot }) => slot), ['item-back', 'character-skin', 'expression-head', 'item-front'])
assert.throws(() => validateCharacterPack({ ...pack, license: { ...pack.license, embedding: 'denied' as never } }, inspections), /embedded/)
assert.throws(() => validateCharacterPack(pack, new Map([['skin', { ...inspection, genuineRgba: false }]])), /asset/)
assert.throws(() => validateCharacterPack({ ...pack, assets: [...pack.assets, pack.assets[0]!] }, inspections), /Duplicate or invalid character asset ID/)
assert.throws(() => validateCharacterPack({ ...pack, appearances: [...pack.appearances, pack.appearances[0]!] }, inspections), /Duplicate or invalid appearance ID/)
assert.throws(() => validateCharacterPack(pack, new Map(pack.assets.map(({ blobId }) => [blobId, { ...inspection, sha256: 'b'.repeat(64) }]))), /Invalid character asset/)
assert.throws(() => validateCharacterPack({
  ...pack,
  appearances: [...pack.appearances, { ...pack.appearances[0]!, id: 'another-hat' }],
  defaultComposition: [...pack.defaultComposition, { packId: pack.id, packVersion: pack.version, appearanceId: 'another-hat' }],
}, inspections), /Composition layer order collision/)
console.log('character: ok')
