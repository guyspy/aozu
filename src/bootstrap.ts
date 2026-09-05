import { CHARACTER_3D_TRIGGERS, character3DPreview } from './core/application/character-3d.ts'
import { bootMantleRuntime, type MantleRuntime } from '@aotter/mantle-runtime'

import { createIndexedDbAssetRepository } from './adapters/indexeddb/asset-repository.ts'
import { createIndexedDbCharacterDraftRepository } from './adapters/indexeddb/character-draft-repository.ts'
import { createCharacterWorkspaceRepository } from './adapters/indexeddb/character-workspace-repository.ts'
import { createIndexedDbMantleStorageAdapter } from './adapters/indexeddb/mantle-storage.ts'
import { createWebMcpController } from './adapters/webmcp/controller.ts'
import { loadStarterCatalog } from './adapters/browser/starter-packages.ts'
import { AUTHORING_NAMESPACE } from './core/application/authoring.ts'
import {
  CHARACTER_ALIGN_MODES,
  CHARACTER_GENERATION_CANVAS,
  CHARACTER_RESIZE_MODES,
  CHARACTER_RIG,
  NO_CHARACTER_NORMALIZATION,
  type CharacterAssetInspection,
  type CharacterAssetTarget,
  type CharacterDraft,
  type CharacterNormalization,
  type CharacterProfilePatch,
  type CharacterVariantGroup,
  type CharacterVariantLayer,
  type CharacterVariantTransform,
} from './core/domain/character.ts'
import {
  CHARACTER_CREATION_GROUPS,
  REQUIRED_CHARACTER_TARGETS,
  activateCharacterVariant,
  createCharacterDraftFromStarter,
  createCharacterDraft,
  migrateCharacterDraft,
  hasCurrentCharacterLayer,
  isCharacterDraftAssetCurrent,
  characterAssetPlacement,
  characterDraftAtlasKey,
  characterAssetInspectionRejection,
  characterRegistrationFrame,
  resolveCharacterDraftAtlasSources,
  resolveCharacterDraftLayers,
  resolveCharacterDraftReferenceLayers,
  resolveCharacterAssetSources,
  setCharacterVariantTransform,
  transformCharacterBounds,
  updateCharacterProfile,
  saveCharacterDraftAsset,
} from './core/application/character-creation.ts'
import { createCharacterEditor } from './core/application/character-editor.ts'
import { highConfidenceCharacterAutoFit, inspectCharacterAssetOwnership, measureCharacterMaskAlignment, measureProtectedRegionDelta, planCharacterAlignment, planCharacterResize, suggestCharacterFit, suggestCharacterVisualRegistration } from './core/application/character-alignment.ts'
import { inspectCharacterImage, readCharacterAlphaMask, readCharacterPixels, readCharacterVisualSample, renderCharacterCanvasDownscale, renderCharacterCompositeDataUrl, renderCharacterEditMaskDataUrl, renderStitchedCharacterEditBlob } from './adapters/browser/character-image.ts'
import { compileCharacterTextureAtlas } from './adapters/browser/character-atlas.ts'
import { inspectSceneImage } from './adapters/browser/scene-image.ts'
import { requestPersistentStorage } from './adapters/browser/storage-persistence.ts'
import { createCharacterWorkspaceEvents } from './adapters/browser/character-workspace-events.ts'
import { exportCharacterDraftZip, readCharacterDraftZip } from './adapters/zip/character-draft.ts'
import { type StarterCharacterSelection } from './core/domain/starter.ts'
import { compileAuthoringBackbone, FIXED_BACKBONE_VERSION } from './core/mantle/backbone.ts'

const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read character asset'))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

type CharacterBounds = NonNullable<CharacterAssetInspection['visibleBounds']>
type CharacterAlignmentMeasurement = ReturnType<typeof measureCharacterMaskAlignment>

const CHARACTER_ASSET_POLICY = {
  workflow: {
    inspectBeforeMutation: true,
    exactRevisionAndAssetSha256: 'required',
    canonicalBodyBeforeDerivedLayers: 'required',
  },
  input: {
    mediaType: 'image/png',
    finalCanvas: { ...CHARACTER_RIG.canvas },
    visiblePixels: 'required',
    canvasEdge: { body: 'reject', expression: 'reject', outfit: 'reject', prop: 'warning' },
    alpha: {
      required: true,
      websiteRemovesBackground: false,
      opaqueInput: 'reject',
      fallback: {
        generateOn: 'one flat high-contrast color absent from the subject',
        avoid: ['gradient', 'shadow', 'glow', 'texture', 'cropped silhouette'],
        beforeSubmission: ['remove the background with an available image tool', 'verify genuine alpha', 'submit PNG'],
      },
    },
  },
  layers: {
    body: { content: 'complete-character-skin' },
    expression: { content: 'complete-whole-head-only', outsideHeadOwnership: 'transparent', referenceOverlap: 'required' },
    outfit: {
      content: 'complete-dressed-character-skin',
      clothingOnlyOverlay: 'reject',
      referenceSilhouetteCompatibility: 'required',
      exactCanonicalPixelCoverage: 'not-required',
      preserve: ['pose', 'body center', 'head position', 'foot line'],
    },
    prop: { content: 'independent-transparent-overlay' },
  },
} as const

/** The one deterministic alignment reference per group, read from the shared registration frame. */
const characterReferenceBounds = (
  frame: ReturnType<typeof characterRegistrationFrame>,
  group: CharacterVariantGroup,
): CharacterBounds | undefined =>
  group === 'expression' ? frame.headEnvelope?.bounds : group === 'outfit' ? frame.bodyBounds : undefined

/** What a submission may and should ask the website to normalize, from the same geometry submission validates against. */
const characterNormalizationContract = (alignAvailable: boolean) => ({
  allowed: { resize: CHARACTER_RESIZE_MODES, align: alignAvailable ? CHARACTER_ALIGN_MODES : (['none'] as const) },
  recommended: {
    resize: 'exact-aspect-downscale' as const,
    align: alignAvailable ? 'reference-visible-bounds' as const : 'none' as const,
  },
  generateAt: { ...CHARACTER_GENERATION_CANVAS },
  finalizeAt: { ...CHARACTER_RIG.canvas },
  requirements: [
    `Submit genuine RGBA PNG with real alpha. Opaque input is rejected. If direct transparency is unavailable, generate on one flat high-contrast color absent from the subject, remove it with an image tool, and verify alpha before submission. Painted transparency grids and matte backgrounds are forbidden and never repaired.`,
    `Default submissions must already be exactly ${CHARACTER_RIG.canvas.width}×${CHARACTER_RIG.canvas.height}.`,
    `"exact-aspect-downscale" accepts only genuine RGBA at the exact ${CHARACTER_RIG.canvas.width}:${CHARACTER_RIG.canvas.height} aspect and at least that size; it never upscales, crops, or reframes.`,
    alignAvailable
      ? '"reference-visible-bounds" fits the candidate alpha bounds onto the returned reference bounds with one uniform scale plus translation, and is rejected if it would leave the canvas.'
      : 'Alignment normalization is unavailable for this target; submit exact-canvas pixels that already match the returned geometry.',
  ],
})

const CHARACTER_WEBMCP_TRIGGERS = [
  ...CHARACTER_3D_TRIGGERS,
  'inspect-workspace',
  'navigate-character',
  'inspect-character-contract',
  'update-character-profile',
  'replace-character-asset',
  'repair-character-asset',
  'set-character-variant-transform',
  'undo-character-change',
  'redo-character-change',
] as const

export function createApplication(document: Document) {
  const legacyCharacterDrafts = createIndexedDbCharacterDraftRepository()
  const browser = document.defaultView
  const characterChanges = createCharacterWorkspaceEvents(browser && 'BroadcastChannel' in browser
    ? new browser.BroadcastChannel('aozu-character-workspaces')
    : null)
  // Derived atlas output lives outside the tracked Character and outside the Mantle entry.
  let authoringAtlas: { key: string; value: ReturnType<typeof compileCharacterTextureAtlas> } | undefined
  const compileAuthoringAtlas = (draft: CharacterDraft) => {
    const key = characterDraftAtlasKey(draft)
    if (authoringAtlas?.key !== key) authoringAtlas = { key, value: compileCharacterTextureAtlas(resolveCharacterDraftAtlasSources(draft)) }
    return authoringAtlas.value
  }
  let starterPackages: ReturnType<typeof loadStarterCatalog> | undefined
  const loadStarters = () => starterPackages ??= loadStarterCatalog(
    browser?.fetch.bind(browser) ?? fetch,
    inspectCharacterImage,
    inspectSceneImage,
    FIXED_BACKBONE_VERSION,
  )
  const authoringPlan = compileAuthoringBackbone()
  let authoringRuntime: Promise<MantleRuntime> | undefined
  const invokeContext = { user: null, staff: null, env: {} }

  const getAuthoringRuntime = () => authoringRuntime ??= bootMantleRuntime({
    plan: authoringPlan,
    storage: createIndexedDbMantleStorageAdapter(AUTHORING_NAMESPACE),
    handlers: {
      'companion.inspect-3d-character': () => character3DPreview.inspect(),
      'companion.configure-3d-preview': (input) => character3DPreview.configure(input),
      'companion.inspect-workspace': inspectWorkspace,
      'companion.navigate-character': navigateCharacter,
      'companion.update-character-profile': updateProfile,
      'companion.create-local-companion': storyModeUnavailable,
      'companion.inspect-experience-contract': storyModeUnavailable,
      'companion.submit-experience-candidate': storyModeUnavailable,
      'companion.inspect-character-contract': inspectCharacterContract,
      'companion.replace-character-asset': replaceCharacterAssetTool,
      'companion.repair-character-asset': repairCharacterAssetTool,
      'companion.set-character-variant-transform': setCharacterTransform,
      'companion.undo-character-change': characterHistoryTool('undo'),
      'companion.redo-character-change': characterHistoryTool('redo'),
    },
  })
  const storedCharacterDrafts = createCharacterWorkspaceRepository(getAuthoringRuntime, createIndexedDbAssetRepository)
  const characterDrafts = {
    ...storedCharacterDrafts,
    async create(draft: CharacterDraft) {
      const record = await storedCharacterDrafts.create(draft)
      characterChanges.publish({ characterId: record.character.id, revision: record.version })
      return record
    },
    async put(draft: CharacterDraft, expectedVersion: number) {
      const persisted = await storedCharacterDrafts.put(draft, expectedVersion)
      characterChanges.publish({ characterId: draft.id, revision: persisted.version })
      return persisted
    },
    async delete(characterId: string) {
      await storedCharacterDrafts.delete(characterId)
      characterChanges.publish({ characterId, revision: null })
    },
  }
  const editor = createCharacterEditor(characterDrafts, createIndexedDbAssetRepository, inspectCharacterImage)
  const webmcp = createWebMcpController(document, authoringPlan, CHARACTER_WEBMCP_TRIGGERS, async (trigger, input) =>
    (await getAuthoringRuntime()).invokeTrigger({ trigger, input, ctx: invokeContext }))

  function storyModeUnavailable(): never {
    throw new Error('Story mode is not available in this build')
  }

  let legacyCharactersMigrated: Promise<void> | undefined
  const migrateLegacyCharacters = () => legacyCharactersMigrated ??= (async () => {
    const legacy = await legacyCharacterDrafts.list()
    if (!legacy.length) return
    const packIds = new Set((await characterDrafts.list()).map(({ character }) => character.packId))
    for (const stored of legacy) {
      const draft = migrateCharacterDraft(stored)
      if (!packIds.has(draft.packId)) {
        await characterDrafts.create(draft)
        packIds.add(draft.packId)
      }
      await legacyCharacterDrafts.delete(stored.id)
    }
  })().catch((error) => {
    legacyCharactersMigrated = undefined
    throw error
  })

  const listCharacterDrafts = async () => {
    await migrateLegacyCharacters()
    return (await characterDrafts.list()).sort((left, right) => right.character.updatedAt - left.character.updatedAt || left.character.id.localeCompare(right.character.id))
  }

  const persisted = async <T>(record: Promise<{ character: T }>) => {
    const { character } = await record
    await requestPersistentStorage(browser?.navigator.storage)
    return character
  }
  const activeCharacter = () => {
    const { character, persistedRevision } = editor.store.getState()
    if (!character || persistedRevision === null) throw new Error('No Character is open')
    return { character, revision: persistedRevision }
  }
  const settledRevision = (what: string) => {
    const { persistedRevision, saveStatus, saveError } = editor.store.getState()
    if (saveStatus !== 'saved') throw new Error(`${what} is applied in the editor but not saved: ${saveError ?? saveStatus}`)
    return persistedRevision!
  }

  const application = {
    webmcp,
    editor,
    subscribeCharacterChanges: characterChanges.subscribe,
    async loadCharacterLibrary() {
      return {
        characters: (await listCharacterDrafts()).map(({ character, version }) => ({
          id: character.id,
          name: character.name,
          description: character.description ?? '',
          revision: version,
          updatedAt: character.updatedAt,
          layers: resolveCharacterDraftLayers(character),
        })),
      }
    },
    listStarters: loadStarters,
    async createCharacter(characterChoice: StarterCharacterSelection) {
      let character: CharacterDraft
      if (characterChoice) {
        const packages = await loadStarters()
        const loaded = packages.find(({ starter }) => starter.id === characterChoice.starterId && starter.version === characterChoice.starterVersion)
        if (!loaded) throw new Error(`Starter not found: ${characterChoice.starterId}@${characterChoice.starterVersion}`)
        character = createCharacterDraftFromStarter(loaded, characterChoice.stateId)
      } else {
        character = createCharacterDraft()
      }
      return persisted(characterDrafts.create(character))
    },
    /** Save As: duplicates the active in-memory Character and switches to the copy. */
    saveCharacterAs: () => persisted(editor.saveAs().then((character) => ({ character }))),
    /** Copy: duplicates the latest saved library Character. */
    async copyCharacter(characterId: string) {
      return persisted(editor.duplicate((await editor.read(characterId)).character))
    },
    /** Read-only: the same high-confidence fit WebMCP reports, so the editor can explain it before applying. */
    characterFitSuggestion: (group: CharacterVariantGroup, variantId: string) =>
      characterFit(group, variantId).then(({ fit }) => fit),
    async autoFitCharacterVariant(group: CharacterVariantGroup, variantId: string) {
      const { revision, fit } = await characterFit(group, variantId)
      if (fit.status === 'aligned') return
      if (fit.status !== 'suggested') throw new Error('No high-confidence fit is available; use the visual alignment controls.')
      await editor.dispatch((current) => setCharacterVariantTransform(current, group, variantId, fit.transform), revision)
    },
    compileCharacterAtlas: compileAuthoringAtlas,
    async replaceCharacterAsset(characterId: string, target: CharacterAssetTarget, blob: Blob) {
      await editor.open(characterId)
      const { character, revision } = activeCharacter()
      const current = character.variants.find(({ group, id }) => group === target.group && id === target.variantId)?.layers[target.layer]
      const result = await mutateCharacterAsset('replace', {
        ...target,
        characterId,
        expectedRevision: revision,
        expectedAssetSha256: current?.inspection.sha256 ?? null,
        filename: blob instanceof File ? blob.name : `${target.variantId}-${target.layer}.png`,
      }, blob, 'user')
      if (!result.data.accepted) throw new Error('rejection' in result.data ? result.data.rejection?.message : 'Character asset was rejected')
      return result.data
    },
    async deleteCharacter(characterId: string) {
      await editor.close(characterId)
      await characterDrafts.delete(characterId)
    },
    async exportCharacter(characterId: string) {
      const { character } = await editor.view(characterId)
      return exportCharacterDraftZip(character, await compileAuthoringAtlas(character))
    },
    async importCharacter(blob: Blob) {
      const imported = await readCharacterDraftZip(blob, inspectCharacterImage)
      const duplicateIdentity = (await listCharacterDrafts()).some(({ character }) => character.packId === imported.draft.packId)
      return persisted(characterDrafts.create({
        ...imported.draft,
        id: crypto.randomUUID(),
        ...(duplicateIdentity ? { packId: `character-${crypto.randomUUID()}` } : {}),
        updatedAt: Date.now(),
      }))
    },
  }

  const characterFit = async (group: CharacterVariantGroup, variantId: string) => {
    const { character, revision } = activeCharacter()
    const variant = character.variants.find((candidate) => candidate.group === group && candidate.id === variantId)
    const layer = variant && CHARACTER_CREATION_GROUPS.find((candidate) => candidate.group === group)?.layers.find((candidate) => variant.layers[candidate])
    if (!variant || !layer) throw new Error('Character variant is empty or missing')
    const target = await characterTarget(character, revision, { group, variantId, layer })
    return { revision, fit: target?.alignment.autoFit ?? { status: 'unavailable' as const } }
  }

  const categoryFor = (group: CharacterVariantGroup) => group === 'expression' ? 'expressions'
    : group === 'outfit' ? 'outfits' : group === 'prop' ? 'props' : 'expressions'
  const characterPath = (characterId: string, group: CharacterVariantGroup = 'expression', variantId?: string) =>
    `/characters/${encodeURIComponent(characterId)}/${categoryFor(group)}${variantId && group !== 'body' ? `/${encodeURIComponent(variantId)}` : ''}`
  const routeSelection = (path: string) => {
    const match = /^\/characters\/([^/]+)(?:\/(expressions|outfits|props)(?:\/([^/]+))?)?$/.exec(path)
    if (!match) return null
    try {
      return { characterId: decodeURIComponent(match[1]!), category: match[2] ?? null, variantId: match[3] ? decodeURIComponent(match[3]) : null }
    } catch { return null }
  }
  const characterNextActions = (draft: CharacterDraft) => {
    const missing = REQUIRED_CHARACTER_TARGETS.filter((target) => !hasCurrentCharacterLayer(draft, target.group, target.variantId, target.layer))
    return missing.length ? missing.map((target) => ({
      tool: 'inspect_character_contract',
      required: true,
      reason: `Inspect ${target.group}/${target.variantId}/${target.layer} before filling it.`,
      input: { characterId: draft.id, ...target },
    })) : []
  }
  const historyStatus = () => {
    const { activeCharacterId, persistedRevision, saveStatus } = editor.store.getState()
    const { pastStates, futureStates } = editor.history.getState()
    return {
      characterId: activeCharacterId,
      revision: persistedRevision,
      canUndo: pastStates.length > 0 && saveStatus !== 'conflict',
      canRedo: futureStates.length > 0 && saveStatus !== 'conflict',
      saveStatus,
    }
  }

  async function inspectWorkspace() {
    const route = browser?.location.pathname ?? '/'
    const selectedRoute = routeSelection(route)
    const records = await listCharacterDrafts()
    const saved = records.find(({ character }) => character.id === selectedRoute?.characterId)
    const current = saved ? await editor.view(saved.character.id) : null
    const character = current?.character ?? null
    const missingCharacterTargets = character ? REQUIRED_CHARACTER_TARGETS
      .filter((target) => !hasCurrentCharacterLayer(character, target.group, target.variantId, target.layer)) : REQUIRED_CHARACTER_TARGETS
    const navigation = [{ destination: 'characters', path: '/characters' }, ...(character ? [
      { destination: 'character-expressions', path: characterPath(character.id, 'expression') },
      { destination: 'character-outfits', path: characterPath(character.id, 'outfit') },
      { destination: 'character-props', path: characterPath(character.id, 'prop') },
    ] : [])]
    const nextActions = character ? characterNextActions(character) : [{
      tool: 'navigate_character', required: false, reason: records.length ? 'Open a Character before editing its assets.' : 'Open the Character library so the user can create a blank or starter Character.', input: { destination: 'characters' },
    }]
    return {
      status: 'ok',
      data: {
        route: { path: route, ...selectedRoute },
        characters: records.map(({ character: draft, version }) => ({
          id: draft.id,
          name: draft.name,
          description: draft.description ?? '',
          revision: version,
          updatedAt: draft.updatedAt,
        })),
        currentCharacter: character && current ? {
          id: character.id,
          name: character.name,
          description: character.description ?? '',
          backstory: character.backstory ?? '',
          attributes: character.attributes ?? {},
          revision: current.version,
          updatedAt: character.updatedAt,
          selected: character.selected,
          missingTargets: missingCharacterTargets,
        } : null,
        history: historyStatus(),
        navigation,
        assetPolicy: CHARACTER_ASSET_POLICY,
      },
      nextActions,
    }
  }

  async function navigateCharacter(rawInput: unknown) {
    const { destination, characterId, variantId } = rawInput as {
      destination: 'characters' | 'character-expressions' | 'character-outfits' | 'character-props'
      characterId?: string
      variantId?: string
    }
    if (destination === 'characters') {
      return { status: 'ok', data: { destination, path: '/characters' }, nextActions: [], effects: { navigation: { path: '/characters', mode: 'push', reason: 'Open the Character library.' } } }
    }
    const character = characterId ? await editor.open(characterId) : null
    if (!character) throw new Error('A valid Character ID is required for this destination')
    const group = destination === 'character-expressions' ? 'expression' : destination === 'character-outfits' ? 'outfit' : 'prop'
    if (variantId && !character.variants.some((variant) => variant.group === group && variant.id === variantId)) throw new Error('Character variant not found')
    const path = characterPath(character.id, group, variantId)
    return { status: 'ok', data: { destination, characterId: character.id, variantId: variantId ?? null, path }, nextActions: [], effects: { navigation: { path, mode: 'push', reason: variantId ? 'Open the exact Character variant.' : 'Open the Character category.' } } }
  }

  async function updateProfile(rawInput: unknown) {
    const { characterId, expectedRevision, ...patch } = rawInput as CharacterProfilePatch & { characterId: string; expectedRevision: number }
    if (!Object.keys(patch).length) throw new Error('At least one Character profile field is required')
    await editor.open(characterId)
    const changed = await editor.dispatch((character) => updateCharacterProfile(character, patch), expectedRevision)
    const character = activeCharacter().character
    const revision = settledRevision('Character profile')
    const route = browser?.location.pathname ?? ''
    const path = routeSelection(route)?.characterId === character.id ? route : characterPath(character.id)
    return {
      status: 'ok',
      data: {
        characterId: character.id,
        profile: {
          name: character.name,
          description: character.description ?? '',
          backstory: character.backstory ?? '',
          attributes: character.attributes ?? {},
        },
        revision,
        changed,
      },
      nextActions: characterNextActions(character),
      effects: { navigation: { path, mode: 'push', reason: 'Open the updated Character profile.' } },
    }
  }

  const characterTarget = async (draft: CharacterDraft, revision: number, rawInput: unknown) => {
    const input = rawInput as Partial<{ group: CharacterVariantGroup; variantId: string; layer: CharacterVariantLayer }>
    if (!input.group && !input.variantId && !input.layer) return null
    if (!input.group || !input.variantId || !input.layer) throw new Error('Character target requires group, variantId, and layer')
    const group = CHARACTER_CREATION_GROUPS.find(({ group }) => group === input.group)
    if (!group || !group.layers.includes(input.layer) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(input.variantId)) throw new Error('Unknown character asset target')
    if (input.group === 'body' && input.variantId !== 'base') throw new Error('The body group only supports body/base/body')
    const { asset, canonical, headRegistration, current, transform, alignmentReference, referenceTransform, editSource, editSourceTransform } = resolveCharacterAssetSources(draft, input as CharacterAssetTarget)
    const label = draft.variants.find(({ group, id }) => group === input.group && id === input.variantId)?.label ?? input.variantId
    const registrationFrame = characterRegistrationFrame(draft)
    const allowedOperations = [
      'replace' as const,
      ...(current && input.group === 'expression' ? ['repair' as const] : []),
      ...(current && input.group !== 'body' ? ['transform' as const] : []),
    ]
    const measurement = asset ? measureCharacterMaskAlignment(
      input.group,
      alignmentReference ? await readCharacterAlphaMask(alignmentReference.blob) : null,
      await readCharacterAlphaMask(asset.blob),
      transform,
      referenceTransform,
    ) : null
    const currentBounds = asset?.inspection.visibleBounds ? transformCharacterBounds(asset.inspection.visibleBounds, transform) : undefined
    const overflow = currentBounds ? {
      left: Math.max(0, -currentBounds.x),
      top: Math.max(0, -currentBounds.y),
      right: Math.max(0, currentBounds.x + currentBounds.width - CHARACTER_RIG.canvas.width),
      bottom: Math.max(0, currentBounds.y + currentBounds.height - CHARACTER_RIG.canvas.height),
    } : undefined
    const placementLayers = resolveCharacterDraftReferenceLayers(draft, { group: input.group, id: input.variantId })
    const placement = characterAssetPlacement(input.group, input.layer)
    const lineage = input.group === 'body' ? 'establish-canonical'
      : input.group === 'expression' ? headRegistration ? 'derive-from-head-registration' : 'establish-head-registration'
        : input.group === 'outfit' ? 'replace-character-skin'
          : 'place-against-current-composite'
    const visualFit = asset && canonical && input.group === 'expression' && headRegistration?.variant.id === input.variantId
      ? suggestCharacterVisualRegistration(await readCharacterVisualSample(canonical.blob), await readCharacterVisualSample(asset.blob), transform)
      : null
    const editableRegion = current && input.group === 'expression' ? registrationFrame.editableRegions.expression : undefined
    const fit = suggestCharacterFit({
      measurement,
      visualFit,
      headAnchor: input.group === 'expression' && headRegistration?.variant.id === input.variantId,
    })
    const referenceBounds = characterReferenceBounds(registrationFrame, input.group)
    const normalization = {
      ...characterNormalizationContract(Boolean(referenceBounds)),
      referenceVisibleBounds: referenceBounds ?? null,
    }
    const protectedRegionDelta = asset && editSource && editableRegion
      ? measureProtectedRegionDelta(
          await readCharacterPixels(editSource.blob, editSourceTransform),
          await readCharacterPixels(asset.blob, transform),
          editableRegion,
        )
      : null
    const reviewPath = characterPath(draft.id, input.group, input.variantId)
    const visualReview = input.group === 'expression' || input.group === 'outfit' ? {
      requiredAfterMutation: true,
      surface: 'browser' as const,
      path: reviewPath,
      modes: ['Composite', 'Overlay', 'Difference', 'Align'],
      instruction: 'Use the browser to inspect the rendered Character in all four modes. Diagnostics are supporting evidence, not final proof. Do not continue to the next asset until the placement passes visual review.',
      correctionTool: 'set_character_variant_transform',
      correctionScope: 'translation-and-uniform-scale-only',
      current: transform,
      axes: { x: 'right-positive', y: 'down-positive' },
      regenerateWhen: ['local deformation', 'wrong pose', 'identity drift', 'bad transparency'],
    } : null
    const replacementAction = {
      tool: 'replace_character_asset',
      required: !current,
      reason: current ? 'Replace this asset only when the user has a complete finished layer.' : 'Install the final exact-canvas RGBA target layer without preserving old pixels.',
      input: {
        characterId: draft.id,
        group: input.group,
        variantId: input.variantId,
        label,
        layer: input.layer,
        expectedRevision: revision,
        expectedAssetSha256: asset?.inspection.sha256 ?? null,
        normalization: normalization.recommended,
      },
    }
    const repairAction = current && input.group === 'expression' ? {
      tool: 'repair_character_asset',
      required: false,
      reason: 'Repair only the editable region of this existing asset; protected pixels remain byte-identical.',
      input: {
        characterId: draft.id,
        group: input.group,
        variantId: input.variantId,
        label,
        layer: input.layer,
        expectedRevision: revision,
        expectedAssetSha256: asset!.inspection.sha256,
        normalization: normalization.recommended,
      },
    } : null
    const maskFit = fit.status === 'suggested' && fit.source === 'mask-alignment'
    const fitActions = fit.status !== 'suggested' ? [] : [{
      tool: 'set_character_variant_transform',
      required: maskFit,
      reason: maskFit
        ? 'Apply the suggested absolute transform, then inspect the alpha-mask alignment again.'
        : 'Try the experimental native pixel-and-edge correlation fit, then visually review the head alignment view.',
      input: { characterId: draft.id, group: input.group, variantId: input.variantId, expectedRevision: revision, ...fit.transform },
    }]
    const mutationActions = repairAction ? [repairAction, replacementAction] : [replacementAction]
    const nextActions = !current ? [replacementAction]
      : maskFit ? fitActions
      : fitActions.length ? [...fitActions, ...mutationActions]
      : [...mutationActions, {
        tool: 'navigate_character', required: false,
        reason: input.group === 'body' ? 'Open the Character editor for canonical-body preflight.' : 'Open this exact variant for visual preflight.', input: {
          destination: `character-${categoryFor(input.group)}`, characterId: draft.id,
          ...(input.group === 'body' ? {} : { variantId: input.variantId }),
        },
      }]
    return {
      input: { group: input.group, variantId: input.variantId, layer: input.layer },
      allowedOperations,
      expectedRevision: revision,
      current: asset ? {
        filled: true,
        current,
        filename: asset.filename,
        sha256: asset.inspection.sha256,
        transform,
      } : { filled: false, current: false, transform },
      required: REQUIRED_CHARACTER_TARGETS.some((target) => target.group === input.group && target.variantId === input.variantId && target.layer === input.layer),
      acceptance: CHARACTER_ASSET_POLICY.layers[input.group],
      placement: { slot: placement.slot, slotOrder: CHARACTER_RIG.slots.find(({ id }) => id === placement.slot)!.order, layerOrder: placement.order },
      alignmentReference: alignmentReference ? {
        filename: alignmentReference.filename,
        sha256: alignmentReference.inspection.sha256,
        transform: referenceTransform ?? { x: 0, y: 0, scale: 1 },
        dataUrl: await readDataUrl(alignmentReference.blob),
      } : null,
      editSource: editSource ? {
        filename: editSource.filename,
        sha256: editSource.inspection.sha256,
        transform: editSourceTransform ?? { x: 0, y: 0, scale: 1 },
        coordinates: 'final-canvas',
        visibleBounds: editSource.inspection.visibleBounds && editSourceTransform
          ? transformCharacterBounds(editSource.inspection.visibleBounds, editSourceTransform)
          : editSource.inspection.visibleBounds,
        dataUrl: editSourceTransform ? await renderCharacterCompositeDataUrl([{
          id: 'edit-source', blobId: 'edit-source', slot: 'expression-head',
          slotOrder: 35, layerOrder: 0, transform: editSourceTransform, blob: editSource.blob,
        }]) : await readDataUrl(editSource.blob),
      } : null,
      editableRegion: editableRegion ? {
        ...editableRegion,
        mask: {
          filename: `${input.group}-${input.variantId}-${input.layer}-edit-mask.png`,
          mediaType: 'image/png',
          semantics: 'transparent-editable-opaque-protected',
          dataUrl: renderCharacterEditMaskDataUrl(editableRegion),
        },
      } : null,
      ownership: input.group === 'expression' ? {
        assetRole: 'whole-head',
        outside: 'transparent',
        bounds: registrationFrame.headEnvelope?.bounds ?? null,
      } : input.group === 'outfit' ? {
        assetRole: 'complete-character-skin',
        referenceSilhouetteCompatibility: 'required',
        exactCanonicalPixelCoverage: 'not-required',
      } : {
        assetRole: input.group === 'body' ? 'complete-character-skin' : 'prop-layer',
      },
      generationRecipe: {
        lineage,
        method: 'reference-guided-generation',
        placementReference: placementLayers.length ? {
          layerCount: placementLayers.length,
          dataUrl: await renderCharacterCompositeDataUrl(placementLayers),
        } : null,
        preserveCanvasCoordinates: true,
        output: {
          generateAt: { ...CHARACTER_GENERATION_CANVAS },
          finalizeAt: { ...CHARACTER_RIG.canvas },
          rgba: true,
          realAlpha: true,
          content: input.group === 'body' || input.group === 'outfit' ? 'complete-character'
            : input.group === 'expression' ? 'complete-whole-head' : 'prop-layer',
        },
      },
      alignment: {
        mode: input.group === 'expression' ? 'whole-head-bounds'
          : input.group === 'outfit' ? 'pose-frame'
            : input.group === 'prop' ? 'composite-review'
              : 'establish-frame',
        transform,
        referenceBounds: measurement && 'metrics' in measurement && measurement.metrics && 'referenceBounds' in measurement.metrics
          ? measurement.metrics.referenceBounds : undefined,
        candidateBounds: currentBounds,
        overflow,
        measurement,
        protectedRegionDelta,
        autoFit: fit,
        visualFit,
        normalization,
        visualReview,
        registration: input.group === 'expression' ? {
          role: headRegistration?.variant.id === input.variantId ? 'head-anchor' : 'follower',
          anchorVariantId: headRegistration?.variant.id ?? null,
          calibration: headRegistration?.variant.id === input.variantId ? {
            status: 'visual-required',
            compareAgainst: 'canonical-body-default-head',
            tool: 'set_character_variant_transform',
            rebasesCurrentExpressions: true,
          } : null,
        } : null,
        reviewPath,
      },
      nextActions,
    }
  }

  async function inspectCharacterContract(rawInput: unknown) {
      const { characterId, ...targetInput } = rawInput as { characterId: string }
      const { character: draft, version } = await editor.view(characterId)
      const canonical = draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body
      const target = await characterTarget(draft, version, targetInput)
      return {
        status: 'ok',
        data: {
          rig: CHARACTER_RIG,
          creationGroups: CHARACTER_CREATION_GROUPS,
          variants: draft.variants.map((variant) => ({
            group: variant.group,
            id: variant.id,
            label: variant.label,
            layers: CHARACTER_CREATION_GROUPS.find(({ group }) => group === variant.group)!.layers.map((layer) => ({
              layer,
              filled: Boolean(variant.layers[layer]),
              current: isCharacterDraftAssetCurrent(draft, variant, layer),
            })),
          })),
          character: {
            id: draft.id,
            name: draft.name,
            description: draft.description ?? '',
            backstory: draft.backstory ?? '',
            attributes: draft.attributes ?? {},
            selected: draft.selected,
            revision: version,
          },
          registrationFrame: characterRegistrationFrame(draft),
          canonicalReference: canonical ? {
            filename: canonical.filename,
            sha256: canonical.inspection.sha256,
            ...(target ? {} : { dataUrl: await readDataUrl(canonical.blob) }),
          } : null,
          productionBrief: [
            'The first body/base/body candidate establishes the canonical character and registration frame.',
            'The canonical body is a visual reference, never an expression edit source. Replace the first expression with a head-only layer; the first accepted whole head establishes registration for later expressions.',
            'An outfit replaces the character-skin slot: replace it with the complete dressed character, never a clothing-only overlay. Preserve pose, body center, head position, and foot line. Generate props against the returned current composite.',
            'Generate at 1024×1536. When the inspected target recommends exact-aspect-downscale, request it during submission; otherwise finalize externally at the exact 512×768 canvas. Never crop, reframe, or stretch.',
            'If direct transparency is unavailable, generate on one flat high-contrast color absent from the subject, without gradients, shadows, glow, texture, or cropped edges. Remove that background with an available image tool and verify genuine alpha before submission. The website validates but never removes backgrounds.',
            'Use replace_character_asset for every outfit and any other complete finished layer; it never preserves old pixels. Use repair_character_asset only for an existing expression; transparent mask pixels are editable, opaque pixels are protected, and protectedRegionDelta must be 0.',
            'Submit only full-canvas RGBA PNG proposals, either already at 512×768 or with the explicit normalization allowed by the inspected target. The website never generates, removes backgrounds, or guesses geometry; expression repair alone uses the deterministic editable region.',
            'Expression layers contain only the whole aligned head, including the same fixed hairstyle and facial hair; every pixel outside head ownership must be transparent.',
            'No expression overlay means the default face baked into the body. Optional whole-head variants include happy, sad, angry, surprised, and sleepy; additional variants are allowed.',
            'Outfits are full-body variants. Props are independent, multi-select, full-canvas overlays and may contain front and back layers. A prop may be positioned anywhere, including on the head or in a hand.',
            'After every accepted expression or outfit, use the browser page opened by AOZU and inspect Composite, Overlay, Difference, and Align. If the pixels only need translation or uniform scale, call set_character_variant_transform with absolute x, y, and scale, then inspect all four modes again. Regenerate or replace local deformation, wrong pose, identity drift, or bad transparency. Do not continue to the next asset until visual review passes.',
          ],
          assetPolicy: CHARACTER_ASSET_POLICY,
          target,
        },
        nextActions: target?.nextActions ?? characterNextActions(draft),
      }
  }

  type CharacterAssetMutationInput = {
    characterId: string
    group: CharacterVariantGroup
    variantId: string
    label: string
    layer: CharacterVariantLayer
    expectedRevision: number
    expectedAssetSha256: string | null
    filename: string
    dataUrl?: string
    normalization?: CharacterNormalization
  }

  const replaceCharacterAssetTool = (rawInput: unknown) => mutateCharacterAsset('replace', rawInput as CharacterAssetMutationInput)
  const repairCharacterAssetTool = (rawInput: unknown) => mutateCharacterAsset('repair', rawInput as CharacterAssetMutationInput)

  async function mutateCharacterAsset(
    mode: 'replace' | 'repair',
    input: CharacterAssetMutationInput,
    providedBlob?: Blob,
    source: 'user' | 'agent' = 'agent',
  ) {
      const requested = input.normalization ?? NO_CHARACTER_NORMALIZATION
      const target: CharacterAssetTarget = {
        group: input.group,
        variantId: input.variantId,
        label: input.label,
        layer: input.layer,
      }
      const group = CHARACTER_CREATION_GROUPS.find(({ group }) => group === target.group)
      if (!group || !group.layers.includes(target.layer) || (target.group === 'body' && target.variantId !== 'base')) throw new Error('Unknown character asset target')
      // Targeting another Character settles the active queue and switches sessions before validation.
      await editor.open(input.characterId)
      const { character: current, revision } = activeCharacter()
      if (revision !== input.expectedRevision) throw new Error(`Character changed; expected revision ${input.expectedRevision}, current ${revision}`)
      const sources = resolveCharacterAssetSources(current, target)
      const assetSha256 = sources.asset?.inspection.sha256 ?? null
      if (assetSha256 !== input.expectedAssetSha256) throw new Error('Character asset changed; inspect the target again')
      if (mode === 'repair' && (target.group !== 'expression' || target.layer !== 'head' || !sources.current || !sources.editSource)) {
        throw new Error('Repair requires a current expression head; use replace_character_asset for outfits and complete layers')
      }
      if (!(target.group === 'body' && target.variantId === 'base' && target.layer === 'body') && !sources.canonical) throw new Error('Submit body/base/body before derived character assets')
      const { filename } = input
      let submitted = providedBlob
      if (!submitted) {
        const dataUrl = input.dataUrl ?? ''
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
        if (!match || dataUrl.length > 7_100_000) throw new Error('Expected a PNG data URL under 5 MiB')
        const binary = atob(match[1])
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
        submitted = new Blob([bytes], { type: 'image/png' })
      }
      const submittedInspection = await inspectCharacterImage(submitted)
      const registrationFrame = characterRegistrationFrame(current)
      const editableRegion = mode === 'repair' ? registrationFrame.editableRegions.expression : undefined
      const referenceBounds = characterReferenceBounds(registrationFrame, target.group)
      const contract = characterNormalizationContract(Boolean(referenceBounds))
      const alignmentMode = target.group === 'expression' ? 'whole-head-bounds'
        : target.group === 'outfit' ? 'pose-frame'
          : target.group === 'prop' ? 'composite-review' : 'establish-frame'

      let resizeScale: number | null = null
      let resizedBounds: CharacterBounds | undefined
      let alignTransform: CharacterVariantTransform | null = null
      let alignedBounds: CharacterBounds | null = null
      let afterResize: CharacterAlignmentMeasurement | null = null
      let afterAlignment: CharacterAlignmentMeasurement | null = null
      let finalSize: { width: number; height: number } | null = null
      let protectedRegionDelta: ReturnType<typeof measureProtectedRegionDelta> = null
      let ownership: ReturnType<typeof inspectCharacterAssetOwnership> = { status: 'valid' }
      // No normalization happens silently: accepted and rejected submissions both report this.
      const report = () => {
        const bounds = alignedBounds ?? resizedBounds
        return {
          requested,
          applied: {
            resize: resizeScale === null ? 'none' as const : 'exact-aspect-downscale' as const,
            align: alignTransform ? 'reference-visible-bounds' as const : 'none' as const,
          },
          input: { width: submittedInspection.width, height: submittedInspection.height },
          final: finalSize,
          scale: resizeScale,
          transform: alignTransform,
          referenceVisibleBounds: referenceBounds ?? null,
          candidateVisibleBounds: { afterResize: resizedBounds ?? null, afterAlignment: alignedBounds },
          overflow: bounds ? {
            left: Math.max(0, -bounds.x),
            top: Math.max(0, -bounds.y),
            right: Math.max(0, bounds.x + bounds.width - CHARACTER_RIG.canvas.width),
            bottom: Math.max(0, bounds.y + bounds.height - CHARACTER_RIG.canvas.height),
          } : null,
          metrics: { afterResize, afterAlignment },
          protectedRegionDelta,
        }
      }
      const rejected = (reason: string, rejection?: { code: string; message: string }) => ({
        status: 'ok',
        data: {
          accepted: false,
          target,
          filename,
          ...(rejection ? { rejection } : {}),
          inspection: {
            width: submittedInspection.width,
            height: submittedInspection.height,
            genuineRgba: submittedInspection.genuineRgba,
            hasTransparentPixels: submittedInspection.hasTransparentPixels,
            visibleBounds: submittedInspection.visibleBounds,
            visiblePixelCount: submittedInspection.visiblePixelCount,
          },
          normalization: report(),
          alignment: { mode: alignmentMode, measurement: afterAlignment ?? afterResize },
          ownership,
        },
        nextActions: [{
          tool: mode === 'replace' ? 'replace_character_asset' : 'repair_character_asset',
          required: true,
          reason,
          input: {
            characterId: current.id,
            group: target.group,
            variantId: target.variantId,
            label: target.label,
            layer: target.layer,
            expectedRevision: revision,
            expectedAssetSha256: assetSha256,
            normalization: contract.recommended,
          },
        }],
      })

      // 1. Deterministic downscale first, so strict inspection and stitching only ever see the exact rig canvas.
      const resize = planCharacterResize(requested.resize, submittedInspection)
      if (!resize.ok) return rejected(resize.message, { code: resize.code, message: resize.message })
      resizeScale = resize.scale
      const resized = resize.scale === null ? submitted : await renderCharacterCanvasDownscale(submitted)
      const inspection = resize.scale === null ? submittedInspection : await inspectCharacterImage(resized)
      resizedBounds = inspection.visibleBounds
      finalSize = { width: inspection.width, height: inspection.height }
      const invalidAsset = characterAssetInspectionRejection(inspection)
      if (invalidAsset) return rejected(invalidAsset.message, invalidAsset)

      // 2. One uniform scale plus translation onto the reference bounds this contract published.
      const referenceMask = sources.alignmentReference ? await readCharacterAlphaMask(sources.alignmentReference.blob) : null
      const candidateMask = await readCharacterAlphaMask(resized)
      if (target.group === 'expression') {
        ownership = inspectCharacterAssetOwnership(target.group, candidateMask, { headBounds: registrationFrame.headEnvelope?.bounds })
        if (ownership.status === 'invalid' && ownership.code === 'EXPRESSION_NOT_HEAD_ONLY') return rejected(ownership.message, { code: ownership.code, message: ownership.message })
      }
      afterResize = measureCharacterMaskAlignment(target.group, referenceMask, candidateMask, undefined, sources.referenceTransform)
      const align = planCharacterAlignment(requested.align, target.group, inspection.visibleBounds, referenceBounds)
      if (!align.ok) return rejected(align.message, { code: align.code, message: align.message })
      if (align.transform) {
        alignTransform = align.transform
        alignedBounds = align.bounds ?? null
        afterAlignment = measureCharacterMaskAlignment(target.group, referenceMask, candidateMask, align.transform, sources.referenceTransform)
      }

      // 3. The existing safety diagnostics decide, on the normalized pixels.
      const alignment = afterAlignment ?? afterResize
      if (alignment.status === 'invalid') {
        const diagnostic = alignment.diagnostics[0]
        return rejected(diagnostic?.message ?? 'Regenerate the rejected character asset.', diagnostic && { code: diagnostic.code, message: diagnostic.message })
      }

      // A requested alignment is baked into the stitched pixels, so it never competes with a mask auto-fit.
      const autoFit = alignTransform ?? highConfidenceCharacterAutoFit(alignment)
      ownership = inspectCharacterAssetOwnership(target.group, candidateMask, {
        headBounds: registrationFrame.headEnvelope?.bounds,
        transform: autoFit ?? undefined,
      })
      if (ownership.status === 'invalid') return rejected(ownership.message, { code: ownership.code, message: ownership.message })
      const stitchedBlob = mode === 'repair' && sources.editSource && editableRegion
        ? await renderStitchedCharacterEditBlob(
            sources.editSource.blob,
            resized,
            editableRegion,
            sources.editSourceTransform,
            autoFit ?? undefined,
          )
        : null
      const savedBlob = stitchedBlob ?? resized
      const savedInspection = stitchedBlob ? await inspectCharacterImage(stitchedBlob) : inspection
      // Blob first; then one command (asset swap plus optional auto-fit) creates exactly one history frame.
      const asset = await editor.stageAsset(savedBlob, filename, source, savedInspection)
      await editor.dispatch((character) => {
        let placed = saveCharacterDraftAsset(character, target, asset)
        if (!stitchedBlob && autoFit && target.group !== 'body') placed = setCharacterVariantTransform(placed, target.group, target.variantId, autoFit)
        return activateCharacterVariant(placed, { group: target.group, id: target.variantId })
      }, input.expectedRevision)
      const draft = activeCharacter().character
      const savedRevision = settledRevision('Character asset')
      const savedVariant = draft.variants.find(({ group, id }) => group === target.group && id === target.variantId)!
      const specification = await characterTarget(draft, savedRevision, target)
      protectedRegionDelta = stitchedBlob && sources.editSource && editableRegion
        ? measureProtectedRegionDelta(
            await readCharacterPixels(sources.editSource.blob, sources.editSourceTransform),
            await readCharacterPixels(stitchedBlob),
            editableRegion,
          ) : null
      const path = characterPath(draft.id, target.group, target.variantId)
      return {
        status: 'ok',
        data: {
          accepted: true,
          target: { ...target, label: savedVariant.label },
          filename,
          byteLength: savedBlob.size,
          inspection: {
            width: savedInspection.width,
            height: savedInspection.height,
            genuineRgba: savedInspection.genuineRgba,
            hasTransparentPixels: savedInspection.hasTransparentPixels,
            visibleBounds: savedInspection.visibleBounds,
            visiblePixelCount: savedInspection.visiblePixelCount,
          },
          normalization: report(),
          alignment: specification?.alignment,
          operation: mode,
          ownership,
          compositor: stitchedBlob ? { applied: true, protectedRegionDelta } : { applied: false },
          autoFit: autoFit ? { applied: true, transform: autoFit, bakedIntoAsset: Boolean(stitchedBlob) } : { applied: false },
          revision: savedRevision,
        },
        nextActions: specification?.nextActions ?? characterNextActions(draft),
        effects: { navigation: { path, mode: 'push', reason: 'Open the accepted Character asset for visual review.' } },
      }
  }

  async function setCharacterTransform(rawInput: unknown) {
      const input = rawInput as {
        characterId: string
        group: CharacterVariantGroup
        variantId: string
        expectedRevision: number
        x: number
        y: number
        scale: number
      }
      await editor.open(input.characterId)
      const { character: current } = activeCharacter()
      const before = current.variants.find(({ group, id }) => group === input.group && id === input.variantId)?.transform ?? { x: 0, y: 0, scale: 1 }
      const calibratesHead = input.group === 'expression' && current.headRegistration?.variantId === input.variantId
      await editor.dispatch((character) => setCharacterVariantTransform(character, input.group, input.variantId, {
        x: input.x,
        y: input.y,
        scale: input.scale,
      }), input.expectedRevision)
      const draft = activeCharacter().character
      const revision = settledRevision('Character transform')
      const variant = draft.variants.find(({ group, id }) => group === input.group && id === input.variantId)!
      const firstLayer = CHARACTER_CREATION_GROUPS.find(({ group }) => group === input.group)!.layers.find((layer) => variant.layers[layer])!
      const specification = await characterTarget(draft, revision, { group: input.group, variantId: input.variantId, layer: firstLayer })
      const path = characterPath(draft.id, input.group, input.variantId)
      return {
        status: 'ok',
        data: {
          target: { group: input.group, variantId: input.variantId },
          before,
          after: variant.transform,
          rebasedVariantIds: calibratesHead ? draft.variants.filter((candidate) =>
            candidate.group === 'expression' && candidate.id !== input.variantId && isCharacterDraftAssetCurrent(draft, candidate, 'head')
          ).map(({ id }) => id) : [],
          revision,
          alignment: specification?.alignment,
        },
        nextActions: specification?.nextActions ?? characterNextActions(draft),
        effects: { navigation: { path, mode: 'push', reason: 'Open the adjusted Character variant for visual review.' } },
      }
  }

  function characterHistoryTool(direction: 'undo' | 'redo') {
    return async (rawInput: unknown) => {
      const input = rawInput as { characterId: string; expectedRevision: number }
      const state = editor.store.getState()
      const history = historyStatus()
      if (state.activeCharacterId !== input.characterId || !state.character) return { status: 'no_active_history', data: history }
      if (state.saveStatus !== 'saved') return { status: 'not_settled', data: history }
      if (state.persistedRevision !== input.expectedRevision) return { status: 'revision_conflict', data: history }
      if (!(direction === 'undo' ? history.canUndo : history.canRedo)) return { status: `nothing_to_${direction}`, data: history }
      await editor[direction]()
      settledRevision(`Character ${direction}`)
      const route = browser?.location.pathname ?? ''
      const path = routeSelection(route)?.characterId === input.characterId ? route : characterPath(input.characterId)
      return {
        status: 'ok',
        data: { ...historyStatus(), characterId: input.characterId },
        effects: { navigation: { path, mode: 'push', reason: `Review the Character after ${direction}.` } },
      }
    }
  }

  return application
}

export type Application = ReturnType<typeof createApplication>
