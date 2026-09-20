import type { JsonSchema, ManifestSource } from '@aotter/mantle-spec'

export const source = (sourceId: string, manifest: object): ManifestSource => ({
  sourceId,
  text: JSON.stringify(manifest),
})

export const envelope = (kind: string, name: string, spec: object) => ({
  apiVersion: 'cms.mantle.aotter.net/v1',
  kind,
  metadata: { name },
  spec,
})

export const objectSchema = (properties: Readonly<Record<string, JsonSchema>>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const nextActionSchema = objectSchema({
  tool: { type: 'string', minLength: 1 },
  required: { type: 'boolean' },
  reason: { type: 'string', minLength: 1 },
  input: { type: 'object' },
}, ['tool', 'required'])

export const toolEffectsSchema = objectSchema({
  navigation: objectSchema({
    path: { type: 'string', pattern: '^/(?:$|characters(?:/|$)|collections(?:/|$)|storyboards(?:/|$)|albums(?:/|$))' },
    mode: { const: 'push' },
    reason: { type: 'string', minLength: 1 },
  }, ['path', 'mode', 'reason']),
})

export const toolResultSchema = objectSchema({
  status: { const: 'ok' },
  data: { type: 'object' },
  nextActions: { type: 'array', items: nextActionSchema },
  effects: toolEffectsSchema,
}, ['status', 'data'])

export const pngPayloadProperties = {
  dataUrl: { type: 'string', pattern: '^data:image/png;base64,', maxLength: 7_100_000 },
  dataSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
} satisfies Record<string, JsonSchema>

export const PNG_WEBMCP_TRANSFER_GUIDANCE = 'In ChatGPT Browser Use host JavaScript, read the trusted local PNG with node:fs/promises, hash its bytes with node:crypto, build one complete dataUrl (data:image/png;base64,...), and call WebMCP with dataUrl and dataSha256 in the same execution; never print or route base64 through model text, terminal output, or the clipboard. Use the exact assetTransfer.toolkit snippet from inspect_character_contract; if host file access is unavailable or decoding fails, use its browser-file-chooser fallback.'
