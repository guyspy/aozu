import type { ContentState, Entry } from "@aotter/mantle-spec"
import type {
  CreateEntryArgs,
  DeleteEntryArgs,
  EntryReader,
  EntryRepository,
  FindEntryByDataFieldArgs,
  FindEntryByDataFieldsArgs,
  FindManyEntriesByDataFieldArgs,
  ListEntriesArgs,
  ListEntriesResult,
  MantleStorageAdapter,
  ReadEntriesByDataFieldInArgs,
  ReadEntryByDataFieldArgs,
  ReadEntryBySlugArgs,
  ReadPublishedEntriesArgs,
  RuntimePlan,
  TransitionStatusArgs,
  UpdateEntryArgs,
  ViewQueryExecutor,
  ViewQueryRequest,
  ViewQueryResult,
} from "@aotter/mantle-runtime"
import { assertEntryMutationAllowed } from "../../core/domain/history.ts"
import { CHARACTER_COLLECTIONS } from '../../core/domain/character-collection.ts'
import { characterAssetScope, type CharacterWorkspaceData } from '../../core/domain/character.ts'
import { AUTHORING_NAMESPACE } from '../../core/application/authoring.ts'
import { CHARACTER_LIBRARY_REVISION_FLOOR } from '../../core/application/character-library.ts'
import { characterAssets } from '../../core/application/character-assets.ts'
import { validateModelSheet } from '../../core/application/character-model-sheet.ts'
import {
  type CompanionDatabase,
  ENTRY_STORE,
  ASSET_STORE,
  META_STORE,
  openCompanionDatabase,
  type StoredEntry,
  type StoredAsset,
  toPublicEntry,
} from "./database.ts"

type EntryRow = Entry & { authorId: string | null }

type EntrySort = NonNullable<ListEntriesArgs["sort"]>

const valueAt = (entry: EntryRow, field: string) =>
  field in entry ? entry[field as keyof EntryRow] : entry.data[field]

const conflict = (kind: string, id: string, expected: unknown, actual: unknown) =>
  Object.assign(new Error(`${kind} conflict for ${id}: expected ${expected}, found ${actual}`), {
    name: kind,
    id,
    expected,
    actual,
  })

const allEntries = (database: CompanionDatabase, bundleId: string): Promise<StoredEntry[]> =>
  database.getAllFromIndex(ENTRY_STORE, "bundleId", bundleId)

const requireCharacterAssets = async (data: Entry['data'], get: (key: [string, string]) => Promise<StoredAsset | undefined>) => {
  const character = data as unknown as CharacterWorkspaceData
  if (character.modelSheet) validateModelSheet(character.modelSheet)
  for (const asset of characterAssets(character)) {
    const stored = await get([characterAssetScope(character.packId), asset.blobId])
    if (!stored || stored.blob.type !== 'image/png' || stored.blob.size !== asset.inspection.size) {
      throw new Error('Character assets changed during save; retry the Character operation')
    }
  }
}

export function createIndexedDbEntryRepository(bundleId: string): EntryRepository & EntryReader {
  const key = (id: string): [string, string] => [bundleId, id]

  async function read(id: string): Promise<StoredEntry | null> {
    const database = await openCompanionDatabase()
    return (await database.get(ENTRY_STORE, key(id))) ?? null
  }

  async function select(
    predicate: (entry: StoredEntry) => boolean,
    limit = Number.POSITIVE_INFINITY,
  ): Promise<StoredEntry[]> {
    const database = await openCompanionDatabase()
    return (await allEntries(database, bundleId)).filter(predicate).slice(0, limit)
  }

  return {
    async create(args: CreateEntryArgs) {
      const database = await openCompanionDatabase()
      const transaction = database.transaction([ENTRY_STORE, ASSET_STORE], "readwrite")
      const entries = transaction.objectStore(ENTRY_STORE)
      const existing = await entries.get(key(args.id))
      if (existing) throw conflict("EntryVersionConflict", args.id, "absent", existing.version)
      if (bundleId === AUTHORING_NAMESPACE && args.collection === 'character-workspaces') {
        const siblings = await entries.index('bundleId').getAll(bundleId)
        if (siblings.some((entry) => entry.collection === 'character-workspaces' && entry.data.packId === args.data.packId)) {
          throw new Error('Character pack ID is already used by another Character')
        }
        await requireCharacterAssets(args.data, (assetKey) => transaction.objectStore(ASSET_STORE).get(assetKey))
      }
      const entry: StoredEntry = {
        bundleId,
        id: args.id,
        collection: args.collection,
        status: args.status,
        version: 1,
        data: structuredClone(args.data),
        authorId: args.authorId,
        createdAt: args.now,
        updatedAt: args.now,
      }
      await entries.add(entry)
      await transaction.done
      return entry
    },
    async get(id) {
      return read(id)
    },
    async update(args: UpdateEntryArgs) {
      assertEntryMutationAllowed(args.collection)
      const database = await openCompanionDatabase()
      const transaction = database.transaction([ENTRY_STORE, ASSET_STORE], "readwrite")
      const entries = transaction.objectStore(ENTRY_STORE)
      const current = await entries.get(key(args.id))
      if (!current || current.collection !== args.collection) {
        throw conflict("EntryVersionConflict", args.id, args.expectedVersion, current?.version ?? 0)
      }
      if (current.version !== args.expectedVersion) {
        throw conflict("EntryVersionConflict", args.id, args.expectedVersion, current.version)
      }
      if (bundleId === AUTHORING_NAMESPACE && args.collection === 'character-workspaces') {
        if (args.data.packId !== current.data.packId) throw new Error('Character pack identity cannot change during save')
        await requireCharacterAssets(args.data, (assetKey) => transaction.objectStore(ASSET_STORE).get(assetKey))
      }
      const entry = { ...current, data: structuredClone(args.data), version: current.version + 1, updatedAt: args.now }
      await entries.put(entry)
      await transaction.done
      return entry
    },
    async delete(args: DeleteEntryArgs) {
      assertEntryMutationAllowed(args.collection)
      const database = await openCompanionDatabase()
      const transaction = database.transaction([ENTRY_STORE, ASSET_STORE, META_STORE], "readwrite")
      const entries = transaction.objectStore(ENTRY_STORE)
      const current = await entries.get(key(args.id))
      if (!current || current.collection !== args.collection) return { removed: false }
      if (current.version !== args.expectedVersion) {
        throw conflict("EntryVersionConflict", args.id, args.expectedVersion, current.version)
      }
      if (current.status !== args.expectedStatus) {
        throw conflict("EntryStatusConflict", args.id, args.expectedStatus, current.status)
      }
      await entries.delete(key(args.id))
      if (args.collection === 'character-workspaces') {
        const meta = transaction.objectStore(META_STORE)
        await meta.put(String(Math.max(Number(await meta.get(CHARACTER_LIBRARY_REVISION_FLOOR)) || 0, current.version)), CHARACTER_LIBRARY_REVISION_FLOOR)
        const collections = await entries.index('bundleId').getAll(bundleId)
        if (bundleId === AUTHORING_NAMESPACE && typeof current.data.packId === 'string' &&
          /^[a-z0-9][a-z0-9_-]{0,63}$/.test(current.data.packId) &&
          !collections.some((entry) => entry.collection === 'character-workspaces' && entry.data.packId === current.data.packId)) {
          const assets = transaction.objectStore(ASSET_STORE)
          let cursor = await assets.index('bundleId').openKeyCursor(characterAssetScope(current.data.packId))
          while (cursor) {
            await assets.delete(cursor.primaryKey)
            cursor = await cursor.continue()
          }
        }
        for (const entry of collections) {
          if (entry.collection !== CHARACTER_COLLECTIONS || !(entry.data.characterIds as string[]).includes(args.id)) continue
          await entries.put({
            ...entry,
            data: { ...entry.data, characterIds: (entry.data.characterIds as string[]).filter((id) => id !== args.id) },
            version: entry.version + 1,
            updatedAt: Date.now(),
          })
        }
      }
      await transaction.done
      return { removed: true }
    },
    async transitionStatus(args: TransitionStatusArgs) {
      assertEntryMutationAllowed(args.collection)
      const database = await openCompanionDatabase()
      const transaction = database.transaction(ENTRY_STORE, "readwrite")
      const current = await transaction.store.get(key(args.id))
      if (!current || current.collection !== args.collection) {
        throw conflict("EntryVersionConflict", args.id, args.expectedVersion ?? 0, current?.version ?? 0)
      }
      if (args.expectedStatus && current.status !== args.expectedStatus) {
        throw conflict("EntryStatusConflict", args.id, args.expectedStatus, current.status)
      }
      if (args.expectedVersion !== undefined && current.version !== args.expectedVersion) {
        throw conflict("EntryVersionConflict", args.id, args.expectedVersion, current.version)
      }
      const entry = { ...current, status: args.to, version: current.version + 1, updatedAt: args.now }
      await transaction.store.put(entry)
      await transaction.done
      return entry
    },
    async list(args: ListEntriesArgs): Promise<ListEntriesResult> {
      const offset = args.cursor ? Number(args.cursor) : 0
      const limit = args.limit ?? 50
      let rows = await select((entry) => entry.collection === args.collection && (!args.status || entry.status === args.status))
      if (args.search) {
        const term = args.search.toLowerCase()
        rows = rows.filter((entry) =>
          [entry.id, ...(args.searchFields ?? []).map((field) => entry.data[field])].some((value) =>
            String(value ?? "").toLowerCase().includes(term),
          ),
        )
      }
      if (args.filter) rows = rows.filter((entry) => entry.data[args.filter!.field] === args.filter!.value)
      if (args.sort) rows.sort(entryComparator(args.sort))
      const page = rows.slice(offset, offset + limit)
      return {
        rows: page,
        previousCursor: offset > 0 ? String(Math.max(0, offset - limit)) : undefined,
        nextCursor: offset + limit < rows.length ? String(offset + limit) : undefined,
      }
    },
    async findByDataField(args: FindEntryByDataFieldArgs) {
      return (await select(matchesData(args), 1))[0] ?? null
    },
    async findByDataFields(args: FindEntryByDataFieldsArgs) {
      return (
        await select(
          (entry) =>
            entry.collection === args.collection &&
            (!args.status || entry.status === args.status) &&
            entry.id !== args.excludeId &&
            Object.entries(args.fields).every(([field, value]) => entry.data[field] === value),
          1,
        )
      )[0] ?? null
    },
    async readById(id) {
      const entry = await read(id)
      return entry ? toPublicEntry(entry) : null
    },
    async readBySlug(args: ReadEntryBySlugArgs) {
      const entry = (await select(matchesData({ ...args, field: "slug", value: args.slug }), 1))[0]
      return entry ? toPublicEntry(entry) : null
    },
    async readByDataField(args: ReadEntryByDataFieldArgs) {
      const entry = (await select(matchesData(args), 1))[0]
      return entry ? toPublicEntry(entry) : null
    },
    async readByDataFieldIn(args: ReadEntriesByDataFieldInArgs) {
      return (await select((entry) => matchesData(args)(entry) && args.values.includes(entry.data[args.field] as never))).map(toPublicEntry)
    },
    async readPublished(args: ReadPublishedEntriesArgs = {}) {
      return (
        await select(
          (entry) =>
            entry.status === "published" &&
            (!args.collection || entry.collection === args.collection) &&
            localeMatches(entry, args.locale),
          args.limit,
        )
      ).map(toPublicEntry)
    },
    async findManyByDataField(args: FindManyEntriesByDataFieldArgs) {
      return (await select(matchesData(args), args.limit)).map(toPublicEntry)
    },
  }
}

const localeMatches = (entry: EntryRow, locale: string | null | undefined) =>
  locale === undefined || (entry.data.locale ?? null) === locale

const matchesData = (args: {
  collection: string
  status?: ContentState
  field: string
  value?: unknown
  locale?: string | null
}) =>
  (entry: StoredEntry) =>
    entry.collection === args.collection &&
    (!args.status || entry.status === args.status) &&
    (args.value === undefined || entry.data[args.field] === args.value) &&
    localeMatches(entry, args.locale)

const entryComparator = (sort: EntrySort) => (a: EntryRow, b: EntryRow) => {
  const left = valueAt(a, sort.field)
  const right = valueAt(b, sort.field)
  const order = left === right ? 0 : (left ?? "") < (right ?? "") ? -1 : 1
  return sort.direction === "asc" ? order : -order
}

const resolveFilterValue = (value: unknown, request: ViewQueryRequest) => {
  if (value && typeof value === "object" && "$param" in value) return request.params?.[String(value.$param)]
  if (value && typeof value === "object" && "$ctx.user" in value) return request.ctxUserId
  return value
}

const filterMatches = (filter: unknown, entry: EntryRow, request: ViewQueryRequest): boolean => {
  if (!filter || typeof filter !== "object") return true
  if ("and" in filter) return (filter.and as unknown[]).every((item) => filterMatches(item, entry, request))
  if ("or" in filter) return (filter.or as unknown[]).some((item) => filterMatches(item, entry, request))
  for (const operator of ["eq", "gt", "gte", "lt", "lte"] as const) {
    if (!(operator in filter)) continue
    const node = (filter as Record<string, { field: string; value: unknown }>)[operator]
    const left = valueAt(entry, node.field) as never
    const right = resolveFilterValue(node.value, request) as never
    return operator === "eq" ? left === right : operator === "gt" ? left > right : operator === "gte" ? left >= right : operator === "lt" ? left < right : left <= right
  }
  return false
}

export function createIndexedDbViewQueryExecutor(bundleId: string, plan: RuntimePlan): ViewQueryExecutor {
  const entries = createIndexedDbEntryRepository(bundleId)
  return {
    async execute<R = Record<string, unknown>>(request: ViewQueryRequest): Promise<ViewQueryResult<R>> {
      const view = plan.views[request.view]
      if (!view || view.query.kind !== "declarative") throw new Error(`Unsupported view: ${request.view}`)
      const query = view.query
      const all = await entries.list({ collection: query.from, limit: Number.MAX_SAFE_INTEGER })
      let rows = all.rows.filter((entry) => filterMatches(query.filter, entry, request))
      for (const order of [...query.orderBy].reverse()) rows.sort(entryComparator(order))
      const page = Math.max(1, request.page ?? 1)
      const show = Math.min(request.show ?? query.limit ?? 50, query.limit ?? 50)
      const start = (page - 1) * show
      const selected = rows.slice(start, start + show + 1)
      const projected = selected.slice(0, show).map((entry) => {
        const fields = query.fields
        if (!fields) return toPublicEntry(entry as StoredEntry)
        return Object.fromEntries(fields.map((field) => [field, valueAt(entry, field)]))
      }) as R[]
      return { rows: projected, page, show, hasMore: selected.length > show }
    },
  }
}

export function createIndexedDbMantleStorageAdapter(bundleId: string): MantleStorageAdapter {
  return {
    nativeViewDialects: [],
    async prepare(plan) {
      return {
        entries: createIndexedDbEntryRepository(bundleId),
        views: createIndexedDbViewQueryExecutor(bundleId, plan),
      }
    },
  }
}
