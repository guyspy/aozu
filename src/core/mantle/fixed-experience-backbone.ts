import type { ManifestSource } from '@aotter/mantle-spec'
import { EFFECT_SCHEMA, PLAYBOOK_LIMITS, PLAYBOOK_RULE_SCHEMA, PREPARED_ACTION_SCHEMA, PROGRESS_BINDING_SCHEMA } from '../domain/playbook.ts'
import { envelope, objectSchema, source, toolResultSchema } from './backbone-shared.ts'

const sceneReferenceSchema = objectSchema({
  compositionId: { type: 'string', minLength: 1 },
  characterStateId: { type: 'string', minLength: 1 },
})

const stageProjectionSchema = objectSchema({
  stageId: { type: 'string', minLength: 1 },
  revision: { type: 'integer', minimum: 0 },
  status: { enum: ['active', 'completed', 'blocked'] },
  agentFallback: { type: 'boolean' },
  title: { type: 'string' },
  narrative: { type: 'string' },
  scene: sceneReferenceSchema,
  actions: { type: 'array', items: objectSchema({ id: { type: 'string' }, label: { type: 'string' } }, ['id', 'label']) },
  progress: { type: 'array', items: objectSchema({ id: { type: 'string' }, label: { type: 'string' }, value: { type: ['string', 'number'] }, max: { type: 'number' } }, ['id', 'label', 'value']) },
}, ['stageId', 'revision', 'status', 'agentFallback', 'title', 'narrative', 'actions', 'progress'])

const emptyReadOnlyInput = { ...objectSchema({}), readOnly: true }
const actionSchema = PREPARED_ACTION_SCHEMA
const progressSchema = PROGRESS_BINDING_SCHEMA

export const FIXED_EXPERIENCE_SOURCES = [
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
