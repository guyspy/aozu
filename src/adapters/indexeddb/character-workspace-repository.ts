import type { Entry } from '@aotter/mantle-spec'
import type { MantleRuntime } from '@aotter/mantle-runtime'

import { resolveCharacterDraftPlacements } from '../../core/application/character-creation.ts'

import {
  CharacterRevisionConflict,
  type AssetRepositoryFactory,
  type CharacterDraftRepository,
  type CharacterRecord,
} from '../../core/application/ports.ts'
import {
  characterAssetScope,
  type CharacterDraft,
  type CharacterDraftAsset,
  type CharacterVariantLayer,
  type CharacterWorkspaceData,
} from '../../core/domain/character.ts'

export const CHARACTER_WORKSPACE_COLLECTION = 'character-workspaces'
const context = { user: null, staff: null, env: {} }
const previewKeyFor = (data: CharacterWorkspaceData) => JSON.stringify(resolveCharacterDraftPlacements(data)
  .map(({ variant, layer, transform, id }) => [id, variant.layers[layer]!.blobId, transform]))

const dataFrom = (draft: CharacterDraft): CharacterWorkspaceData => ({
  schemaVersion: draft.schemaVersion,
  packId: draft.packId,
  rigProfile: structuredClone(draft.rigProfile),
  name: draft.name,
  ...(draft.description ? { description: draft.description } : {}),
  ...(draft.backstory ? { backstory: draft.backstory } : {}),
  ...(draft.attributes && Object.keys(draft.attributes).length ? { attributes: structuredClone(draft.attributes) } : {}),
  variants: draft.variants.map(({ layers, ...variant }) => ({
    ...structuredClone(variant),
    layers: Object.fromEntries(Object.entries(layers).map(([layer, asset]) => [layer, asset && {
      filename: asset.filename,
      source: asset.source,
      inspection: structuredClone(asset.inspection),
      ...(asset.canonicalSha256 ? { canonicalSha256: asset.canonicalSha256 } : {}),
      blobId: asset.inspection.sha256,
    }])),
  })),
  ...(draft.headRegistration ? { headRegistration: structuredClone(draft.headRegistration) } : {}),
  selected: structuredClone(draft.selected),
})

export function createCharacterWorkspaceRepository(
  runtime: () => Promise<MantleRuntime>,
  assets: AssetRepositoryFactory,
) {
  const persistAssets = async (draft: CharacterDraft) => {
    const repository = assets(characterAssetScope(draft.packId))
    const unique = new Map(draft.variants.flatMap(({ layers }) => Object.values(layers).filter(Boolean).map((asset) => [asset.inspection.sha256, asset.blob])))
    await Promise.all([...unique].map(async ([id, blob]) => {
      if (!await repository.get(id)) await repository.put(id, blob)
    }))
  }
  const hydrate = async (entry: Entry): Promise<CharacterRecord> => {
    // Legacy `revision`/`published` metadata stays stored until the next real save; a read never writes.
    const { revision: _revision, published: _published, ...data } = structuredClone(entry.data) as unknown as CharacterWorkspaceData & { revision?: unknown; published?: unknown }
    const repository = assets(characterAssetScope(data.packId))
    const variants = await Promise.all(data.variants.map(async (source) => {
      const { layers, ...variant } = source
      return {
        ...variant,
        layers: Object.fromEntries(await Promise.all(Object.entries(layers).map(async ([layer, asset]) => {
          if (!asset) return [layer, undefined]
          const blob = await repository.get(asset.blobId)
          if (!blob) throw new Error(`Character asset is missing: ${data.packId}/${asset.blobId}`)
          const { blobId: _blobId, ...descriptor } = asset
          return [layer, { ...descriptor, blob } satisfies CharacterDraftAsset]
        }))) as Partial<Record<CharacterVariantLayer, CharacterDraftAsset>>,
      }
    }))
    return { character: { ...data, id: entry.id, updatedAt: entry.updatedAt, variants }, version: entry.version }
  }
  const entries = async () => (await runtime()).entries

  return {
    async listSummaries() {
      const rows = await (await entries()).readPublished({ collection: CHARACTER_WORKSPACE_COLLECTION })
      return rows.map((entry) => {
        const data = entry.data as unknown as CharacterWorkspaceData
        const previewKey = previewKeyFor(data)
        return { id: entry.id, name: data.name, description: data.description ?? '', revision: entry.version, updatedAt: entry.updatedAt, previewKey }
      }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    },
    async getPreview(id: string, expectedKey?: string) {
      const entry = await (await entries()).readById(id)
      if (entry?.collection !== CHARACTER_WORKSPACE_COLLECTION || entry.status !== 'published') throw new Error('Character not found')
      const data = entry.data as unknown as CharacterWorkspaceData
      if (expectedKey !== undefined && previewKeyFor(data) !== expectedKey) throw new Error('Character preview changed; refresh the library')
      const repository = assets(characterAssetScope(data.packId))
      return Promise.all(resolveCharacterDraftPlacements(data).map(async ({ variant, layer, ...placement }) => {
        const id = variant.layers[layer]!.blobId
        const blob = await repository.get(id)
        if (!blob) throw new Error(`Character asset is missing: ${data.packId}/${id}`)
        return { ...placement, blob }
      }))
    },
    async list() {
      const rows = await (await entries()).readPublished({ collection: CHARACTER_WORKSPACE_COLLECTION })
      return Promise.all(rows.map(hydrate))
    },
    async get(id: string) {
      const entry = await (await entries()).readById(id)
      return entry?.collection === CHARACTER_WORKSPACE_COLLECTION && entry.status === 'published' ? hydrate(entry) : null
    },
    async create(draft: CharacterDraft) {
      await persistAssets(draft)
      const result = await (await runtime()).invokeProcedure<Entry>({
        procedure: 'create-character-workspace',
        input: dataFrom(draft),
        ctx: context,
      })
      if (!result.ok) throw new Error(result.diagnostic.message ?? 'Character could not be created')
      return hydrate(result.data)
    },
    async put(draft: CharacterDraft, expectedVersion: number) {
      const current = await (await entries()).readById(draft.id)
      if (!current || current.collection !== CHARACTER_WORKSPACE_COLLECTION) throw new Error('Character not found')
      if (current.version !== expectedVersion) throw new CharacterRevisionConflict(`Character changed elsewhere: expected revision ${expectedVersion}, found ${current.version}`)
      await persistAssets(draft)
      const result = await (await runtime()).invokeProcedure<Entry>({
        procedure: 'update-character-workspace',
        input: { id: draft.id, expectedVersion, ...dataFrom(draft) },
        ctx: context,
      })
      if (!result.ok) {
        const message = result.diagnostic.message ?? 'Character could not be saved'
        throw result.diagnostic.code === 'CONFLICT' ? new CharacterRevisionConflict(message) : new Error(message)
      }
      return { version: result.data.version, updatedAt: result.data.updatedAt }
    },
    async delete(id: string) {
      const current = await (await entries()).readById(id)
      if (!current || current.collection !== CHARACTER_WORKSPACE_COLLECTION) return
      const result = await (await runtime()).invokeProcedure({
        procedure: 'delete-character-workspace', input: { id }, ctx: context,
      })
      if (!result.ok) throw new Error(result.diagnostic.message ?? 'Character could not be deleted')
    },
  } satisfies CharacterDraftRepository & { listSummaries: unknown; getPreview: unknown }
}
