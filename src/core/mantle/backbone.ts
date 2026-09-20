import { WORLD_LIBRARY_SCHEMA } from '../domain/world-library.ts'
import { STORYBOARD_UPDATE_SCHEMA } from '../domain/storyboard.ts'
import type { JsonSchema, ManifestSource } from "@aotter/mantle-spec"
import type { RuntimePlan } from "@aotter/mantle-runtime"
import {
  EXPERIENCE_CANDIDATE_SCHEMA,
  PLAYBOOK_SCHEMA_DEFS,
  PROGRESS_LOOP_IDS,
} from '../domain/playbook.ts'
import { compileBundle } from '../bundle.ts'
import { CHARACTER_BACKBONE_SOURCES, characterWorkspaceProperties, characterWorkspaceRequired } from './character-backbone.ts'
import { FIXED_EXPERIENCE_SOURCES } from './fixed-experience-backbone.ts'
import { envelope, objectSchema, source, toolResultSchema } from './backbone-shared.ts'

const experienceSeedSchema = objectSchema(
  {
    kind: { enum: ["story", "task"] },
    directionId: { type: "string", minLength: 1 },
    loopIds: { type: "array", minItems: 1, items: { enum: PROGRESS_LOOP_IDS } },
    completionMode: { enum: ["finite", "continuous"] },
    brief: { type: "string", minLength: 1, maxLength: 8000 },
  },
  ["kind", "directionId", "loopIds", "completionMode", "brief"],
)

const directionSchema = objectSchema(
  {
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    seed: experienceSeedSchema,
    sceneCompositionId: { type: "string", minLength: 1 },
  },
  ["id", "name", "summary", "seed", "sceneCompositionId"],
)

const starterIdentitySchema = objectSchema(
  {
    id: { type: "string", minLength: 1 },
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1 },
    manifestSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
  ["id", "version", "name", "manifestSha256"],
)

const storySelectionSchema: JsonSchema = {
  oneOf: [
    { type: "null" },
    objectSchema(
      {
        starter: starterIdentitySchema,
        direction: directionSchema,
        seed: experienceSeedSchema,
        sceneCompositionId: { type: "string", minLength: 1 },
      },
      ["starter", "direction", "seed", "sceneCompositionId"],
    ),
  ],
}

const appearanceRefSchema = objectSchema({
  packId: { type: 'string', minLength: 1 },
  packVersion: { type: 'integer', minimum: 1 },
  appearanceId: { type: 'string', minLength: 1 },
}, ['packId', 'packVersion', 'appearanceId'])

const experienceDraftProperties = {
  schemaVersion: { const: 1 },
  revision: { type: "integer", minimum: 0 },
  character: {
    oneOf: [
      { type: 'null' },
      objectSchema({
        packId: { type: 'string', minLength: 1 },
        packVersion: { type: 'integer', minimum: 1 },
        composition: { type: 'array', minItems: 1, items: appearanceRefSchema },
      }, ['packId', 'packVersion', 'composition']),
    ],
  },
  story: storySelectionSchema,
  lastSubmission: objectSchema(
    {
      idempotencyKey: { type: "string", minLength: 1, maxLength: 100 },
      bundleId: { type: "string", minLength: 1 },
    },
    ["idempotencyKey", "bundleId"],
  ),
}

const experienceDraftRequired = ["schemaVersion", "revision", "story"]
const experienceDraftCreateProperties = {
  schemaVersion: experienceDraftProperties.schemaVersion,
  revision: experienceDraftProperties.revision,
  character: experienceDraftProperties.character,
  story: experienceDraftProperties.story,
}



const workspaceNavigationSchema = objectSchema({
  resource: { enum: ['home', 'collections', 'collection', 'location', 'albums', 'album', 'photo', 'storyboards', 'story-book', 'storyboard', 'character'] },
  id: { type: 'string', minLength: 1, maxLength: 100 },
  view: { enum: ['characters', 'profile', 'locations', 'setting-images', 'conditions', 'expressions', 'wardrobe', 'hair', 'headwear', 'props', 'model-sheet', 'storyboard', 'details'] },
  itemId: { type: 'string', minLength: 1, maxLength: 100 },
}, ['resource'])

const libraryUpdateSchema = objectSchema({
  resource: { enum: ['collection', 'character', 'album', 'photo', 'location', 'condition', 'reference', 'story-book', 'storyboard-book'] },
  action: { enum: ['create', 'update', 'delete', 'duplicate', 'move'] },
  expectedRevision: { type: 'integer', minimum: 0 },
  id: { type: 'string', minLength: 1, maxLength: 100 },
  name: { type: 'string', minLength: 1, maxLength: 120 },
  description: { type: 'string', maxLength: 8000 },
  backstory: { type: 'string', maxLength: 8000 },
  collectionId: { type: 'string', minLength: 1, maxLength: 100 },
  albumId: { type: 'string', minLength: 1, maxLength: 100 },
  locationId: { type: 'string', minLength: 1, maxLength: 100 },
  conditionId: { type: 'string', minLength: 1, maxLength: 100 },
  photoId: { type: 'string', minLength: 1, maxLength: 100 },
  parentId: { oneOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'null' }] },
  tags: { type: 'array', maxItems: 30, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
  consistency: { type: 'string', maxLength: 8000 },
  source: { type: 'string', maxLength: 2000 },
  label: { type: 'string', minLength: 1, maxLength: 120 },
  purpose: { enum: ['inspiration', 'design'] },
  synopsis: { type: 'string', maxLength: 8000 },
  direction: { type: 'string', maxLength: 8000 },
  collectionIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } },
  boardId: { type: 'string', minLength: 1, maxLength: 100 },
  bookId: { oneOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'null' }] },
}, ['resource', 'action'])

const archiveDataUrl = { type: 'string', pattern: '^data:(?:application/zip|image/(?:png|jpeg|webp));base64,', maxLength: 28_000_000 } satisfies JsonSchema

export const FIXED_BACKBONE_VERSION = "8"

const ALL_BACKBONE_SOURCES = [
  source('authoring/world-library.yaml', envelope('Schema', 'world-library', { title: 'Albums, locations and story books', lifecycle: 'operational', schema: objectSchema({ library: WORLD_LIBRARY_SCHEMA }, ['library']) })),
  ...[
    { name: 'inspect-storyboard', title: 'Inspect Storyboard', description: 'List standalone storyboards or read one exact revision, selected candidates, pinned reference standards and source changes. Boards may mix collections and external PNGs. Image bytes are opt-in, at most five image IDs. Actually view images before visual feedback. Stored, selected and human-confirmed are distinct. UI context is exposed through inspect_workspace. No navigation or mutation.', input: { ...objectSchema({ boardId: { type: 'string', minLength: 1 }, images: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', minLength: 1 } } }), readOnly: true } },
    { name: 'update-storyboard', title: 'Update Storyboard', description: 'Create a standalone board or mutate it using its exact expectedRevision. Actions: rename (name/notes), add-frame (title/notes), edit-frame (frameId/title/notes/review/transition/duration), remove-frame, reorder (all frame IDs exactly once), add-candidate (frameId/filename/PNG dataUrl/source/settings), select (frameId/imageId), reference (frameId/imageId/purpose or remove:true), undo, redo. Undefined subjects in candidates may be invented freely. Every defined AOZU Character, Location, Condition or Album Photo used in a candidate must be included in settings. Character settings require the exact Appearance sha256 from inspect_character_contract with scope:model-sheet and images:[appearance]; world settings use the revision from inspect_workspace. Missing or stale refs are rejected. Uploaded candidates NEVER automatically replace selections. Confirmed review requires explicit human approval, never merely successful upload. Reference pins exact image ID/hash; changes to source selection do not rewrite it. Same operations and persisted undo/redo as UI. PNG originals up to 4096×4096 and 5 MiB, at most 100 frames/500 images/128 MiB per board. Source text is provenance only. Returns navigation to affected board for visual review. No same-collection requirement. pin-setting stores the same setting snapshot (id, kind character/location/photo, sourceId, revision, name, details, optional sha256) on frameId, optionally with PNG dataUrl/filename/source/purpose; it never selects or approves an image. unpin-setting removes a snapshot by imageId. inspect_workspace exposes current location and album metadata; local location settings take precedence over ancestor context.', input: STORYBOARD_UPDATE_SCHEMA },
    { name: 'navigate-workspace', title: 'Navigate Workspace', description: 'Open an exact AOZU resource without guessing a route. resource is home, collections, collection, location, albums, album, photo, storyboards, story-book, storyboard, or character. Supply id for one resource; Location view may be setting-images, profile, or conditions and itemId opens a Condition. Character view may be expressions, wardrobe, hair, headwear, props, profile, or model-sheet and itemId opens a variant/reference. Collection view may be characters, profile, or locations (the Collection’s Location tree); storyboard view may be storyboard or details. AOZU applies the returned navigation in this tab. Re-run inspect_workspace after rendering.', input: { ...workspaceNavigationSchema, readOnly: true } },
    { name: 'update-library', title: 'Update Library', description: 'Create, update, duplicate, delete, or move AOZU library records with one revision-checked command. Resources: collection; character (move between collections or delete); album; photo; location; condition; reference (explicitly reuse a finished Album photo as Location inspiration/design); story-book; storyboard-book. Duplicate is supported for Locations and Conditions and preserves their setting images with new IDs. Use IDs and expectedRevision from inspect_workspace. Omitted update fields stay unchanged. Moving a Photo requires id and albumId and routes to the Photo in its destination Album. Deleting an Album moves its photos to My images; deleting a Location moves its children to its parent; deleting a Story Book leaves its storyboards unfiled. This does not edit storyboard frames or character artwork. AOZU itself handles effects.navigation.', input: libraryUpdateSchema },
    { name: 'export-library', title: 'Export Library Resource', description: 'Download one resource without returning a huge base64 payload. resource may be library (complete backup), world (Albums, Locations and Story Books), character, storyboard, or photo. Character/storyboard require id and exact expectedRevision. Photo requires id. Returns the filename and size after starting the browser download.', input: { ...objectSchema({ resource: { enum: ['library', 'world', 'character', 'storyboard', 'photo'] }, id: { type: 'string', minLength: 1, maxLength: 100 }, expectedRevision: { type: 'integer', minimum: 0 } }, ['resource']), readOnly: true } },
    { name: 'import-library', title: 'Import Library Resource', description: 'Import one AOZU resource from a base64 data URL. library/world/storyboard/character expect application/zip. image expects PNG, JPEG, or WebP and exactly one destination: locationId stores a direct Location or Condition setting image without creating an Album photo. albumId stores a finished composition and requires prompt. Undefined subjects may be invented freely. Every defined AOZU subject used must carry its ref: for each Character, first call inspect_character_contract with scope:model-sheet and images:[appearance], actually view it, then pass characterId/revision/sha256 in characterSources; pass sourceLocationId and optional sourceConditionId for defined settings. Missing or stale refs are rejected and AOZU derives provenance from validated sources. Optional collectionId files an imported Character. Payloads above 20 MiB should use the visible Library file control. AOZU itself handles effects.navigation.', input: objectSchema({ resource: { enum: ['library', 'world', 'character', 'storyboard', 'image'] }, dataUrl: archiveDataUrl, filename: { type: 'string', minLength: 1, maxLength: 200 }, albumId: { type: 'string', minLength: 1, maxLength: 100 }, locationId: { type: 'string', minLength: 1, maxLength: 100 }, conditionId: { type: 'string', minLength: 1, maxLength: 100 }, collectionId: { type: 'string', minLength: 1, maxLength: 100 }, name: { type: 'string', minLength: 1, maxLength: 120 }, label: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 8000 }, source: { type: 'string', maxLength: 2000 }, purpose: { enum: ['inspiration', 'design'] }, characterSources: { type: 'array', maxItems: 10, items: objectSchema({ characterId: { type: 'string', minLength: 1, maxLength: 100 }, revision: { type: 'integer', minimum: 0 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['characterId', 'revision', 'sha256']) }, sourceLocationId: { type: 'string', minLength: 1, maxLength: 100 }, sourceConditionId: { type: 'string', minLength: 1, maxLength: 100 }, prompt: { type: 'string', minLength: 1, maxLength: 8000 } }, ['resource', 'dataUrl']) },
  ].flatMap(({ name, title, description, input }) => [
    source(`authoring/${name}.yaml`, envelope('Procedure', name, { title, description, input, output: toolResultSchema, handler: { kind: 'ref', ref: `companion.${name}` } })),
    source(`authoring/${name}-mcp.yaml`, envelope('Trigger', name, { source: { kind: 'mcp', surface: 'public' }, target: { procedure: name } })),
  ]),
  source(
    "authoring/experience-draft.yaml",
    envelope(
      "Schema",
      "experience-drafts",
      {
        title: "Experience drafts",
        lifecycle: "operational",
        schema: objectSchema(experienceDraftProperties, experienceDraftRequired),
      },
    ),
  ),
  source(
    'authoring/character-workspace.yaml',
    envelope('Schema', 'character-workspaces', {
      title: 'Character workspaces',
      lifecycle: 'operational',
      indexes: [['packId']],
      schema: objectSchema(characterWorkspaceProperties, characterWorkspaceRequired),
    }),
  ),
  source(
    'authoring/character-collection.yaml',
    envelope('Schema', 'character-collections', {
      title: 'Character Collections',
      lifecycle: 'operational',
      schema: objectSchema({
        name: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: 'string', maxLength: 500 },
        backstory: { type: 'string', maxLength: 8000 },
        characterIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } },
      }, ['name', 'characterIds']),
    }),
  ),
  source(
    'authoring/inspect-workspace.yaml',
    envelope('Procedure', 'inspect-workspace', {
      title: 'Inspect Workspace',
      description: `Start here and call again after user navigation or tool mutations: context is a snapshot, not a live subscription. intent:world starts the required world-authoring sequence: first choose and inspect a Collection's backstory, Characters, Locations and Conditions, then create setting art or a composed Album photo. resource/id can inspect an exact collection, album, photo, location or story book without navigating; images requests up to five Album photos or direct Location setting images with original data URLs. includeSnapshot:true returns the current Character composite or exact open/requested Photo, Location design, or model-sheet reference. Actually view returned image data before visual feedback. For storyboard originals use inspect_storyboard. A snapshot never navigates, saves or changes selections.`,
      input: {
        ...objectSchema({
          includeSnapshot: { type: 'boolean', description: 'Include the current Character, Photo, Location, or model-sheet image when available.' },
          resource: { enum: ['collection', 'album', 'photo', 'location', 'story-book'] },
          intent: { enum: ['character', 'world', 'storyboard'], description: 'Select the authoring workflow so nextActions require the right context before creation.' },
          id: { type: 'string', minLength: 1, maxLength: 100 },
          images: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } },
        }),
        readOnly: true,
      },
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.inspect-workspace' },
    }),
  ),
  source(
    'authoring/update-collection-profile.yaml',
    envelope('Procedure', 'update-collection-profile', {
      title: 'Update Collection Profile',
      description: 'Update a collection’s name, description, or shared world backstory. Use the collection ID and exact revision from inspect_workspace. Omitted fields stay unchanged. Shared world context is available to every Character in this collection without replacing their individual profiles.',
      input: objectSchema({
        collectionId: { type: 'string', minLength: 1 },
        expectedRevision: { type: 'integer', minimum: 0 },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: 'string', maxLength: 500 },
        backstory: { type: 'string', maxLength: 8000 },
      }, ['collectionId', 'expectedRevision']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.update-collection-profile' },
    }),
  ),
  source(
    'authoring/update-collection-profile-mcp.yaml',
    envelope('Trigger', 'update-collection-profile', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'update-collection-profile' },
    }),
  ),
  source(
    'authoring/create-character-workspace.yaml',
    envelope('Procedure', 'create-character-workspace', {
      title: 'Create Character Workspace',
      input: objectSchema(characterWorkspaceProperties, characterWorkspaceRequired),
      output: { type: 'object' },
      handler: { kind: 'builtin', op: 'create', schema: 'character-workspaces' },
    }),
  ),
  source(
    'authoring/update-character-workspace.yaml',
    envelope('Procedure', 'update-character-workspace', {
      title: 'Update Character Workspace',
      input: objectSchema({
        id: { type: 'string', minLength: 1 },
        // Alpha.15 builtin update requires strict JSON Schema type `number` (not `integer`).
        expectedVersion: { type: 'number', minimum: 1 },
        ...characterWorkspaceProperties,
      }, ['id', 'expectedVersion', ...characterWorkspaceRequired]),
      output: { type: 'object' },
      handler: { kind: 'builtin', op: 'update', schema: 'character-workspaces' },
    }),
  ),
  source(
    'authoring/delete-character-workspace.yaml',
    envelope('Procedure', 'delete-character-workspace', {
      title: 'Delete Character Workspace',
      input: objectSchema({ id: { type: 'string', minLength: 1 } }, ['id']),
      output: { type: 'object' },
      handler: { kind: 'builtin', op: 'delete', schema: 'character-workspaces' },
    }),
  ),
  source(
    'authoring/inspect-workspace-mcp.yaml',
    envelope('Trigger', 'inspect-workspace', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'inspect-workspace' },
    }),
  ),
  source(
    "authoring/select-experience-draft.yaml",
    envelope("Procedure", "select-experience-draft", {
      title: 'Select Experience Draft',
      description: 'Persist the selected Story starting point, or Blank, as the current Experience Draft. Character artwork normally comes from the editable Character Draft and may explicitly reference an installed local Character Pack.',
      input: objectSchema(experienceDraftCreateProperties, experienceDraftRequired),
      output: { type: "object" },
      handler: { kind: "builtin", op: "create", schema: "experience-drafts" },
    }),
  ),
  source(
    "authoring/select-experience-draft-mcp.yaml",
    envelope("Trigger", "select-experience-draft", {
      source: { kind: "mcp", surface: "staff" },
      target: { procedure: "select-experience-draft" },
    }),
  ),
  source(
    'authoring/create-local-companion.yaml',
    envelope('Procedure', 'create-local-companion', {
      title: 'Create Local Companion',
      description: 'Validate and activate the selected Character and Starter Playbook without agent participation.',
      input: objectSchema({ draftId: { type: 'string', minLength: 1 } }, ['draftId']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.create-local-companion' },
    }),
  ),
  source(
    'authoring/create-local-companion-trigger.yaml',
    envelope('Trigger', 'create-local-companion', {
      source: { kind: 'mcp', surface: 'staff' },
      target: { procedure: 'create-local-companion' },
    }),
  ),
  source(
    'authoring/inspect-experience-contract.yaml',
    envelope('Procedure', 'inspect-experience-contract', {
      title: 'Inspect Experience Contract',
      description: 'Required first step when an agent customizes an experience. Returns the exact Experience Draft revision, selected character resources, optional Story seed and scene resources, Playbook skeleton, vocabulary, and limits. The local creation flow can activate a Starter Playbook without agent participation.',
      input: { ...objectSchema({ draftId: { type: 'string', minLength: 1 } }, ['draftId']), readOnly: true },
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.inspect-experience-contract' },
    }),
  ),
  source(
    'authoring/inspect-experience-contract-mcp.yaml',
    envelope('Trigger', 'inspect-experience-contract', {
      source: { kind: 'mcp', surface: 'staff' },
      target: { procedure: 'inspect-experience-contract' },
    }),
  ),
  source(
    "authoring/submit-experience-candidate.yaml",
    envelope('Procedure', 'submit-experience-candidate', {
      title: 'Submit Experience Candidate',
      description: 'Submit one complete declarative Playbook for the exact inspected Experience revision and selected character resources. Selected Story assets, fixed manifests, handlers, and application code cannot be replaced. Invalid or stale submissions return diagnostics without staging. A valid candidate remains inactive until explicit user review and approval.',
      input: {
        ...objectSchema({
          draftId: { type: "string", minLength: 1 },
          expectedRevision: { type: "integer", minimum: 0 },
          expectedCharacterUpdatedAt: { type: "integer", minimum: 0 },
          idempotencyKey: { type: "string", minLength: 1, maxLength: 100 },
          candidate: EXPERIENCE_CANDIDATE_SCHEMA,
        }, ['draftId', 'expectedRevision', 'expectedCharacterUpdatedAt', 'idempotencyKey', 'candidate']),
        $defs: PLAYBOOK_SCHEMA_DEFS,
      },
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.submit-experience-candidate' },
    }),
  ),
  source(
    "authoring/submit-experience-candidate-mcp.yaml",
    envelope("Trigger", "submit-experience-candidate", {
      source: { kind: "mcp", surface: "staff" },
      target: { procedure: "submit-experience-candidate" },
    }),
  ),
  ...CHARACTER_BACKBONE_SOURCES,
  ...FIXED_EXPERIENCE_SOURCES,
] as const satisfies readonly ManifestSource[]

export const AUTHORING_BACKBONE_SOURCES = ALL_BACKBONE_SOURCES.filter(({ sourceId }) => sourceId.startsWith('authoring/'))
export const FIXED_BACKBONE_SOURCES = ALL_BACKBONE_SOURCES.filter(({ sourceId }) => sourceId.startsWith('fixed/'))

const compileBackbone = (sources: readonly ManifestSource[]): RuntimePlan =>
  compileBundle(Object.fromEntries(sources.map(({ sourceId, text }) => [sourceId, text])))

export const compileAuthoringBackbone = () => compileBackbone(AUTHORING_BACKBONE_SOURCES)
export const compileFixedBackbone = () => compileBackbone(FIXED_BACKBONE_SOURCES)
