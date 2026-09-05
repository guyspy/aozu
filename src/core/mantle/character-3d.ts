import type { ManifestSource } from '@aotter/mantle-spec'

const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const definitions = [
  { name: 'inspect-3d-character', title: 'Inspect 3D Character', description: 'Inspect the shared tab-local skinned GLB demo, revision, facial morph and bone socket capabilities. Separate from PNG characters; clothing and persistence are deferred.', input: { ...object({}), readOnly: true } },
  { name: 'configure-3d-preview', title: 'Configure 3D Preview', description: 'Set absolute happy morph weight, right-hand prop, wave animation or skeleton visibility on the shared GLB demo. Inspect first for expectedRevision. Toggle 3D in the UI to view; resets on reload.', input: object({ expectedRevision: { type: 'integer', minimum: 0 }, happy: { type: 'number', minimum: 0, maximum: 1 }, prop: { type: 'boolean' }, playing: { type: 'boolean' }, skeleton: { type: 'boolean' } }, ['expectedRevision']) },
]
export const CHARACTER_3D_SOURCES: ManifestSource[] = definitions.flatMap(({ name, ...spec }) => [
  { sourceId: `authoring/${name}.yaml`, text: JSON.stringify({ apiVersion: 'cms.mantle.aotter.net/v1', kind: 'Procedure', metadata: { name }, spec: { ...spec, output: { type: 'object', additionalProperties: true }, handler: { kind: 'ref', ref: `companion.${name}` } } }) },
  { sourceId: `authoring/${name}-mcp.yaml`, text: JSON.stringify({ apiVersion: 'cms.mantle.aotter.net/v1', kind: 'Trigger', metadata: { name }, spec: { source: { kind: 'mcp', surface: 'public' }, target: { procedure: name } } }) },
])
