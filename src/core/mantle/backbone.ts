import type { JsonSchema, ManifestSource } from "@aotter/mantle-spec"
import type { RuntimePlan } from "@aotter/mantle-runtime"
import {
  EFFECT_SCHEMA,
  EXPERIENCE_CANDIDATE_SCHEMA,
  PLAYBOOK_RULE_SCHEMA,
  PLAYBOOK_LIMITS,
  PLAYBOOK_SCHEMA_DEFS,
  PREPARED_ACTION_SCHEMA,
  PROGRESS_LOOP_IDS,
  PROGRESS_BINDING_SCHEMA,
} from '../domain/playbook.ts'
import { CHARACTER_ALIGN_MODES, CHARACTER_GENERATION_CANVAS, CHARACTER_RESIZE_MODES, CHARACTER_RIG, CHARACTER_VARIANT_GROUPS } from '../domain/character.ts'
import { compileBundle } from '../bundle.ts'

const source = (sourceId: string, manifest: object): ManifestSource => ({
  sourceId,
  text: JSON.stringify(manifest),
})

const envelope = (kind: string, name: string, spec: object) => ({
  apiVersion: "cms.mantle.aotter.net/v1",
  kind,
  metadata: { name },
  spec,
})

const objectSchema = (properties: Readonly<Record<string, JsonSchema>>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const actionSchema = PREPARED_ACTION_SCHEMA

const progressSchema = PROGRESS_BINDING_SCHEMA

const sceneReferenceSchema = objectSchema({
  compositionId: { type: "string", minLength: 1 },
  characterStateId: { type: "string", minLength: 1 },
})

const emptyReadOnlyInput = { ...objectSchema({}), readOnly: true }

const nextActionSchema = objectSchema({
  tool: { type: 'string', minLength: 1 },
  required: { type: 'boolean' },
  reason: { type: 'string', minLength: 1 },
  input: { type: 'object' },
}, ['tool', 'required'])

const toolEffectsSchema = objectSchema({
  navigation: objectSchema({
    path: { type: 'string', pattern: '^/characters(?:/|$)' },
    mode: { const: 'push' },
    reason: { type: 'string', minLength: 1 },
  }, ['path', 'mode', 'reason']),
})

const toolResultSchema = objectSchema({
  status: { const: 'ok' },
  data: { type: 'object' },
  nextActions: { type: 'array', items: nextActionSchema },
  effects: toolEffectsSchema,
}, ['status', 'data'])

const characterHistoryResultSchema = objectSchema({
  status: { enum: ['ok', 'no_active_history', 'not_settled', 'revision_conflict', 'nothing_to_undo', 'nothing_to_redo'] },
  data: { type: 'object' },
  effects: toolEffectsSchema,
}, ['status', 'data'])

const characterHistoryInputSchema = objectSchema({
  characterId: { type: 'string', minLength: 1 },
  expectedRevision: { type: 'integer', minimum: 1 },
}, ['characterId', 'expectedRevision'])

const stageProjectionSchema = objectSchema({
  stageId: { type: 'string', minLength: 1 },
  revision: { type: 'integer', minimum: 0 },
  status: { enum: ['active', 'completed', 'blocked'] },
  agentFallback: { type: 'boolean' },
  title: { type: 'string' },
  narrative: { type: 'string' },
  scene: sceneReferenceSchema,
  actions: { type: 'array', items: objectSchema({ id: { type: 'string' }, label: { type: 'string' } }, ['id', 'label']) },
  progress: {
    type: 'array',
    items: objectSchema({
      id: { type: 'string' }, label: { type: 'string' }, value: { type: ['string', 'number'] }, max: { type: 'number' },
    }, ['id', 'label', 'value']),
  },
}, ['stageId', 'revision', 'status', 'agentFallback', 'title', 'narrative', 'actions', 'progress'])

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

const characterTransformSchema = objectSchema({
  x: { type: 'number', minimum: -512, maximum: 512 },
  y: { type: 'number', minimum: -768, maximum: 768 },
  scale: { type: 'number', minimum: 0.25, maximum: 4 },
}, ['x', 'y', 'scale'])

const characterNormalizationSchema = objectSchema({
  resize: { enum: CHARACTER_RESIZE_MODES },
  align: { enum: CHARACTER_ALIGN_MODES },
}, ['resize', 'align'])

const characterInspectionSchema = objectSchema({
  width: { const: CHARACTER_RIG.canvas.width },
  height: { const: CHARACTER_RIG.canvas.height },
  hasTransparentPixels: { const: true },
  hasVisiblePixels: { const: true },
  genuineRgba: { const: true },
  visibleBounds: objectSchema({
    x: { type: 'integer', minimum: 0 },
    y: { type: 'integer', minimum: 0 },
    width: { type: 'integer', minimum: 1, maximum: CHARACTER_RIG.canvas.width },
    height: { type: 'integer', minimum: 1, maximum: CHARACTER_RIG.canvas.height },
  }, ['x', 'y', 'width', 'height']),
  visiblePixelCount: { type: 'integer', minimum: 1 },
  size: { type: 'integer', minimum: 1, maximum: 5 * 1024 * 1024 },
  sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
}, ['width', 'height', 'hasTransparentPixels', 'hasVisiblePixels', 'genuineRgba', 'size', 'sha256'])

const characterAssetDescriptorSchema = objectSchema({
  blobId: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  filename: { type: 'string', minLength: 1, maxLength: 200 },
  source: { enum: ['user', 'agent', 'starter'] },
  inspection: characterInspectionSchema,
  canonicalSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
}, ['blobId', 'filename', 'source', 'inspection'])

const characterAttributesSchema: JsonSchema = {
  type: 'object',
  maxProperties: 32,
  additionalProperties: { type: ['string', 'number', 'boolean'], maxLength: 200 },
}

const characterWorkspaceProperties = {
  schemaVersion: { const: 4 },
  packId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
  rigProfile: objectSchema({
    id: { const: CHARACTER_RIG.id },
    version: { const: CHARACTER_RIG.version },
  }, ['id', 'version']),
  name: { type: 'string', minLength: 1, maxLength: 200 },
  description: { type: 'string', maxLength: 500 },
  backstory: { type: 'string', maxLength: 8_000 },
  attributes: characterAttributesSchema,
  variants: {
    type: 'array',
    minItems: 1,
    maxItems: 100,
    items: objectSchema({
      id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
      group: { enum: CHARACTER_VARIANT_GROUPS },
      label: { type: 'string', minLength: 1, maxLength: 80 },
      layers: objectSchema({
        body: characterAssetDescriptorSchema,
        head: characterAssetDescriptorSchema,
        back: characterAssetDescriptorSchema,
        front: characterAssetDescriptorSchema,
      }),
      transform: characterTransformSchema,
    }, ['id', 'group', 'label', 'layers']),
  },
  headRegistration: objectSchema({ variantId: { type: 'string', minLength: 1, maxLength: 40 } }, ['variantId']),
  selected: objectSchema({
    expression: { type: 'string', minLength: 1, maxLength: 40 },
    outfit: { type: 'string', minLength: 1, maxLength: 40 },
    props: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
  }, ['props']),
}
const characterWorkspaceRequired = ['schemaVersion', 'packId', 'rigProfile', 'name', 'variants', 'selected']

export const FIXED_BACKBONE_VERSION = "6"

const ALL_BACKBONE_SOURCES = [
  source(
    "fixed/item-definition.yaml",
    envelope(
      "Schema",
      "item-definitions",
      {
        title: "Item definitions",
        lifecycle: "operational",
        schema: objectSchema({ definition: { type: "object" } }, ["definition"]),
      },
    ),
  ),
  source(
    "fixed/inventory-item.yaml",
    envelope(
      "Schema",
      "inventory-items",
      {
        title: "Inventory items",
        lifecycle: "operational",
        indexes: [["definitionId"]],
        schema: objectSchema(
          {
            definitionId: { type: "string", minLength: 1 },
            quantity: { type: "integer", minimum: 1 },
            state: { type: "object" },
          },
          ["definitionId", "quantity", "state"],
        ),
      },
    ),
  ),
  source(
    "fixed/character-loadout.yaml",
    envelope(
      "Schema",
      "character-loadouts",
      {
        title: "Character loadouts",
        lifecycle: "operational",
        indexes: [["runId"]],
        schema: objectSchema(
          {
            runId: { type: "string", minLength: 1 },
            equipment: { type: "object" },
            appearanceOverrides: { type: "object" },
          },
          ["runId", "equipment", "appearanceOverrides"],
        ),
      },
    ),
  ),
  source(
    "fixed/character-pack.yaml",
    envelope(
      "Schema",
      "character-packs",
      {
        title: "Character packs",
        lifecycle: "operational",
        schema: objectSchema(
          {
            pack: { type: "object" },
          },
          ["pack"],
        ),
      },
    ),
  ),
  source(
    "fixed/character-state.yaml",
    envelope(
      "Schema",
      "character-states",
      {
        title: "Character states",
        lifecycle: "operational",
        schema: objectSchema(
          {
            packId: { type: "string", minLength: 1 },
            packVersion: { type: "integer", minimum: 1 },
            composition: { type: "array", items: { type: "object" } },
          },
          ["packId", "packVersion", "composition"],
        ),
      },
    ),
  ),
  source(
    "fixed/journal-entry.yaml",
    envelope(
      "Schema",
      "journal-entries",
      {
        title: "Journal entries",
        lifecycle: "operational",
        schema: objectSchema(
          {
            content: { type: "string", minLength: 1, maxLength: 100000 },
          },
          ["content"],
        ),
      },
    ),
  ),
  source(
    "fixed/pending-agent-turn.yaml",
    envelope(
      "Schema",
      "pending-agent-turns",
      {
        title: "Pending agent turns",
        lifecycle: "operational",
        indexes: [["runId"]],
        schema: objectSchema(
          {
            runId: { type: "string", minLength: 1 },
            nodeId: { type: "string", minLength: 1 },
            userText: { type: "string", minLength: 1, maxLength: 4000 },
            expectedRevision: { type: "integer", minimum: 0 },
            status: { type: "string", enum: ["pending", "resolved", "failed"] },
            createdAtMs: { type: "integer", minimum: 0 },
            resolutionDialogue: { type: "string" },
            resolutionEventId: { type: "string" },
          },
          ["runId", "nodeId", "userText", "expectedRevision", "status", "createdAtMs"],
        ),
      },
    ),
  ),
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
    "fixed/run.yaml",
    envelope(
      "Schema",
      "runs",
      {
        title: "Runs",
        lifecycle: "operational",
        schema: objectSchema(
          {
            currentStageId: { type: "string", minLength: 1 },
            revision: { type: "integer", minimum: 0 },
            status: { enum: ["active", "completed", "blocked"] },
            currentDialogue: { type: "string", maxLength: PLAYBOOK_LIMITS.dialogueLength },
            metrics: { type: "object", additionalProperties: { type: "number" } },
            flags: { type: "object", additionalProperties: { type: "boolean" } },
          },
          ["currentStageId", "revision", "status"],
        ),
      },
    ),
  ),
  source(
    "fixed/rule.yaml",
    envelope(
      "Schema",
      "rules",
      {
        title: "Rules",
        lifecycle: "operational",
        indexes: [["priority", "ruleId"]],
        schema: PLAYBOOK_RULE_SCHEMA,
      },
    ),
  ),
  source(
    "fixed/scene-asset.yaml",
    envelope(
      "Schema",
      "scene-assets",
      {
        title: "Scene assets",
        lifecycle: "operational",
        schema: objectSchema(
          {
            blobId: { type: "string", minLength: 1 },
            mediaType: { enum: ["image/png", "image/jpeg", "image/webp"] },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
            size: { type: "integer", minimum: 1 },
            sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          },
          ["blobId", "mediaType", "width", "height", "size", "sha256"],
        ),
      },
    ),
  ),
  source(
    "fixed/scene-composition.yaml",
    envelope(
      "Schema",
      "scene-compositions",
      {
        title: "Scene compositions",
        lifecycle: "operational",
        schema: objectSchema(
          {
            layers: {
              type: "array",
              minItems: 1,
              maxItems: 32,
              items: objectSchema(
                {
                  id: { type: "string", minLength: 1 },
                  assetId: { type: "string", minLength: 1 },
                  plane: { enum: ["back", "front"] },
                  order: { type: "integer" },
                },
                ["id", "assetId", "plane", "order"],
              ),
            },
          },
          ["layers"],
        ),
      },
    ),
  ),
  source(
    "fixed/stage.yaml",
    envelope(
      "Schema",
      "stages",
      {
        title: "Stages",
        lifecycle: "operational",
        schema: objectSchema(
          {
            title: { type: "string", minLength: 1 },
            narrative: { type: "string" },
            actions: { type: "array", items: actionSchema },
            progress: { type: "array", items: progressSchema },
            scene: sceneReferenceSchema,
            terminal: { type: "boolean" },
            agentFallback: { type: "boolean" },
          },
          ["title", "narrative", "actions", "progress"],
        ),
      },
    ),
  ),
  source(
    "fixed/progress-event.yaml",
    envelope(
      "Schema",
      "progress-events",
      {
        title: "Progress events",
        lifecycle: "operational",
        indexes: [["runId", "createdAtMs"]],
        schema: objectSchema(
          {
            runId: { type: "string", minLength: 1 },
            actionId: { type: "string", minLength: 1 },
            idempotencyKey: { type: "string", minLength: 1, "x-mcp-hint": "idempotency-key" },
            summary: { type: "string" },
            createdAtMs: { type: "integer", minimum: 0, "x-mcp-hint": "timestamp-ms" },
          },
          ["runId", "actionId", "idempotencyKey", "createdAtMs"],
        ),
      },
    ),
  ),
  source(
    "fixed/current-stage.yaml",
    envelope("View", "current-stage", {
      from: "stages",
      surface: "public",
      fields: ["title", "narrative", "scene", "actions", "progress", "terminal", "agentFallback"],
      limit: 1,
    }),
  ),
  source(
    'authoring/inspect-workspace.yaml',
    envelope('Procedure', 'inspect-workspace', {
      title: 'Inspect Workspace',
      description: 'Start here on every page. Returns saved Character workspaces, the current Character and route, missing required art, exact next actions, and all stable asset acceptance rules. AOZU rejects opaque artwork and does not remove backgrounds; if direct transparency is unavailable, generate on one flat high-contrast color, remove it with an image tool, and verify genuine alpha before submission. Outfits are complete dressed character skins in the canonical pose, never clothing-only overlays.',
      input: emptyReadOnlyInput,
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.inspect-workspace' },
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
    'authoring/navigate-character.yaml',
    envelope('Procedure', 'navigate-character', {
      title: 'Navigate Character',
      description: 'Navigate to the Character library or an exact Character category or variant returned by inspect_workspace. A successful call pushes that route in the SPA without mutating Character data.',
      input: objectSchema({
        destination: { enum: ['characters', 'character-expressions', 'character-outfits', 'character-props'] },
        characterId: { type: 'string', minLength: 1 },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
      }, ['destination']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.navigate-character' },
    }),
  ),
  source(
    'authoring/navigate-character-mcp.yaml',
    envelope('Trigger', 'navigate-character', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'navigate-character' },
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
  source(
    'authoring/inspect-character-contract.yaml',
    envelope('Procedure', 'inspect-character-contract', {
      title: 'Inspect Character Contract',
      description: `Required before replacing, repairing, or aligning character art. Optionally name one target to receive its allowed operations, exact current asset hash, visual alignment reference, layer ownership, alpha policy, generation size (${CHARACTER_GENERATION_CANVAS.width}×${CHARACTER_GENERATION_CANVAS.height}) and final size (${CHARACTER_RIG.canvas.width}×${CHARACTER_RIG.canvas.height}), normalization, revision, z-order, diagnostics, and required browser visual-review workflow. replace_character_asset installs a complete finished layer without preserving old pixels and is the only operation for outfits. repair_character_asset is available only for a current expression and stitches into that exact head asset. Expressions contain only a complete whole head. Outfits contain the complete dressed character skin.`,
      input: {
        ...objectSchema({
          characterId: { type: 'string', minLength: 1 },
          group: { enum: CHARACTER_VARIANT_GROUPS },
          variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
          layer: { enum: ['body', 'head', 'back', 'front'] },
        }, ['characterId']),
        readOnly: true,
      },
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.inspect-character-contract' },
    }),
  ),
  source(
    'authoring/inspect-character-contract-mcp.yaml',
    envelope('Trigger', 'inspect-character-contract', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'inspect-character-contract' },
    }),
  ),
  source(
    'authoring/update-character-profile.yaml',
    envelope('Procedure', 'update-character-profile', {
      title: 'Update Character Profile',
      description: 'Update one or more identity fields of a saved Character using its exact revision. Omitted fields stay unchanged; empty description, backstory, or attributes clear that field. A successful call saves one undoable change and opens that Character editor.',
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        expectedRevision: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1, maxLength: 80 },
        description: { type: 'string', maxLength: 500 },
        backstory: { type: 'string', maxLength: 8_000 },
        attributes: characterAttributesSchema,
      }, ['characterId', 'expectedRevision']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.update-character-profile' },
    }),
  ),
  source(
    'authoring/update-character-profile-mcp.yaml',
    envelope('Trigger', 'update-character-profile', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'update-character-profile' },
    }),
  ),
  source(
    'authoring/replace-character-asset.yaml',
    envelope('Procedure', 'replace-character-asset', {
      title: 'Replace Character Asset',
      description: `Install one complete canonical Character layer after inspect_character_contract. This is a true replacement: it never stitches or preserves pixels from the old asset. Expressions must contain only a complete whole head with transparency everywhere else. Outfits must contain the complete dressed character skin in a pose and registration compatible with the canonical reference; exact base-pixel coverage is not required. Opaque input is rejected; AOZU never removes backgrounds. Rejected or stale input does not mutate or navigate. Submit exact ${CHARACTER_RIG.canvas.width}×${CHARACTER_RIG.canvas.height} RGBA by default, or explicitly request the deterministic normalization returned by inspect_character_contract.`,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        group: { enum: CHARACTER_VARIANT_GROUPS },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        label: { type: 'string', minLength: 1, maxLength: 80 },
        layer: { enum: ['body', 'head', 'back', 'front'] },
        expectedRevision: { type: 'integer', minimum: 1 },
        expectedAssetSha256: { type: ['string', 'null'], pattern: '^[0-9a-f]{64}$' },
        filename: { type: 'string', minLength: 1, maxLength: 200 },
        dataUrl: { type: 'string', pattern: '^data:image/png;base64,', maxLength: 7_100_000 },
        normalization: characterNormalizationSchema,
      }, ['characterId', 'group', 'variantId', 'label', 'layer', 'expectedRevision', 'expectedAssetSha256', 'filename', 'dataUrl']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.replace-character-asset' },
    }),
  ),
  source(
    'authoring/replace-character-asset-mcp.yaml',
    envelope('Trigger', 'replace-character-asset', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'replace-character-asset' },
    }),
  ),
  source(
    'authoring/repair-character-asset.yaml',
    envelope('Procedure', 'repair-character-asset', {
      title: 'Repair Character Asset',
      description: `Repair one existing expression after inspect_character_contract. The current head asset and editable-region mask are the only edit source; this tool never falls back to the canonical body. Accepted pixels are deterministically stitched into that current asset, preserving protected pixels. Outfits and other complete layers must use replace_character_asset.`,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        group: { const: 'expression' },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        label: { type: 'string', minLength: 1, maxLength: 80 },
        layer: { const: 'head' },
        expectedRevision: { type: 'integer', minimum: 1 },
        expectedAssetSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        filename: { type: 'string', minLength: 1, maxLength: 200 },
        dataUrl: { type: 'string', pattern: '^data:image/png;base64,', maxLength: 7_100_000 },
        normalization: characterNormalizationSchema,
      }, ['characterId', 'group', 'variantId', 'label', 'layer', 'expectedRevision', 'expectedAssetSha256', 'filename', 'dataUrl']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.repair-character-asset' },
    }),
  ),
  source(
    'authoring/repair-character-asset-mcp.yaml',
    envelope('Trigger', 'repair-character-asset', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'repair-character-asset' },
    }),
  ),
  source(
    'authoring/set-character-variant-transform.yaml',
    envelope('Procedure', 'set-character-variant-transform', {
      title: 'Set Character Variant Transform',
      description: 'Visually align an existing expression whole head, outfit, or prop by changing only its full-canvas translation and uniform scale. Inspect the Character in the browser first; x moves right, y moves down, and values are absolute rather than deltas. Use the exact revision from inspect_character_contract. Success opens the exact variant so you can verify Composite, Overlay, Difference, and Align before continuing. Head-anchor changes rebase current expressions; front and back prop layers share one transform. The canonical body is locked.',
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        group: { enum: ['expression', 'outfit', 'prop'] },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        expectedRevision: { type: 'integer', minimum: 1 },
        x: { type: 'number', minimum: -512, maximum: 512 },
        y: { type: 'number', minimum: -768, maximum: 768 },
        scale: { type: 'number', minimum: 0.25, maximum: 4 },
      }, ['characterId', 'group', 'variantId', 'expectedRevision', 'x', 'y', 'scale']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.set-character-variant-transform' },
    }),
  ),
  source(
    'authoring/set-character-variant-transform-mcp.yaml',
    envelope('Trigger', 'set-character-variant-transform', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'set-character-variant-transform' },
    }),
  ),
  source(
    'authoring/undo-character-change.yaml',
    envelope('Procedure', 'undo-character-change', {
      title: 'Undo Character Change',
      description: 'Undo the latest change of the active Character editing session. Requires the exact saved Character revision and a settled (saved) session; inactive, pending, failed, conflicted, stale, or empty-history requests return a structured status without mutation or navigation. Success persists the previous Character as a new revision and opens that Character editor.',
      input: characterHistoryInputSchema,
      output: characterHistoryResultSchema,
      handler: { kind: 'ref', ref: 'companion.undo-character-change' },
    }),
  ),
  source(
    'authoring/undo-character-change-mcp.yaml',
    envelope('Trigger', 'undo-character-change', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'undo-character-change' },
    }),
  ),
  source(
    'authoring/redo-character-change.yaml',
    envelope('Procedure', 'redo-character-change', {
      title: 'Redo Character Change',
      description: 'Redo the most recently undone change of the active Character editing session. Same preconditions and structured statuses as undo_character_change. Success persists the next Character as a new revision and opens that Character editor.',
      input: characterHistoryInputSchema,
      output: characterHistoryResultSchema,
      handler: { kind: 'ref', ref: 'companion.redo-character-change' },
    }),
  ),
  source(
    'authoring/redo-character-change-mcp.yaml',
    envelope('Trigger', 'redo-character-change', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'redo-character-change' },
    }),
  ),
  source(
    'fixed/inspect-companion.yaml',
    envelope('Procedure', 'inspect-companion', {
      title: 'Inspect Companion',
      description: 'Required first step for Companion interaction. Read the current stage, revision, prepared actions, and persisted pending user turns. When a pending turn exists, act as the character and call resolve_companion_turn; put the character response in the website instead of printing it in agent chat.',
      input: emptyReadOnlyInput,
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.inspect-companion' },
    }),
  ),
  source(
    'fixed/inspect-companion-mcp.yaml',
    envelope('Trigger', 'inspect-companion', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'inspect-companion' },
    }),
  ),
  source(
    'fixed/submit-companion-action.yaml',
    envelope('Procedure', 'submit-companion-action', {
      title: 'Submit Companion Action',
      description: 'Execute one prepared website action with the exact current revision. The website validates and atomically records effects and progress. Inspect first; never invent action IDs or revisions.',
      input: objectSchema({
          actionId: { type: "string", minLength: 1 },
          expectedRevision: { type: "integer", minimum: 0 },
          idempotencyKey: { type: "string", minLength: 1, maxLength: 100, "x-mcp-hint": "idempotency-key" },
      }, ['actionId', 'expectedRevision', 'idempotencyKey']),
      output: stageProjectionSchema,
      handler: { kind: 'ref', ref: 'companion.submit-companion-action' },
    }),
  ),
  source(
    'fixed/submit-companion-action-mcp.yaml',
    envelope('Trigger', 'submit-companion-action', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'submit-companion-action' },
    }),
  ),
  source(
    'fixed/resolve-companion-turn.yaml',
    envelope('Procedure', 'resolve-companion-turn', {
      title: 'Resolve Companion Turn',
      description: 'Write the character response and validated effects directly into the website for one persisted pending turn. Keep your normal agent personality outside the tool; apply the Companion character voice only to dialogue. Do not repeat the dialogue in agent chat after this succeeds.',
      input: objectSchema({
        turnId: { type: 'string', minLength: 1 },
        idempotencyKey: { type: 'string', minLength: 1, maxLength: 100 },
        dialogue: { type: 'string', minLength: 1, maxLength: PLAYBOOK_LIMITS.dialogueLength },
        effects: { type: 'array', maxItems: PLAYBOOK_LIMITS.effectsPerTransaction, items: EFFECT_SCHEMA },
      }, ['turnId', 'idempotencyKey', 'dialogue', 'effects']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.resolve-companion-turn' },
    }),
  ),
  source(
    'fixed/resolve-companion-turn-mcp.yaml',
    envelope('Trigger', 'resolve-companion-turn', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'resolve-companion-turn' },
    }),
  ),
] as const satisfies readonly ManifestSource[]

export const AUTHORING_BACKBONE_SOURCES = ALL_BACKBONE_SOURCES.filter(({ sourceId }) => sourceId.startsWith('authoring/'))
export const FIXED_BACKBONE_SOURCES = ALL_BACKBONE_SOURCES.filter(({ sourceId }) => sourceId.startsWith('fixed/'))

const compileBackbone = (sources: readonly ManifestSource[]): RuntimePlan =>
  compileBundle(Object.fromEntries(sources.map(({ sourceId, text }) => [sourceId, text])))

export const compileAuthoringBackbone = () => compileBackbone(AUTHORING_BACKBONE_SOURCES)
export const compileFixedBackbone = () => compileBackbone(FIXED_BACKBONE_SOURCES)
