import type { ManifestSource } from '@aotter/mantle-spec'
import { CHARACTER_3D_CONFIG_PROPERTIES } from '../application/character-3d.ts'

const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const definitions = [
  { name: 'inspect-3d-character', title: 'Inspect 3D Character', description: 'Inspect the shared tab-local Viking GLB, revision, embedded animation clips, expressions, equipment, workshop slots with selected flags and automatic hand poses. State resets on reload.', input: { ...object({}), readOnly: true } },
  { name: 'configure-3d-preview', title: 'Configure 3D Preview', description: 'Configure the Viking: clipName, playing, loop, timeScale (0–3), crossfade (0–2 seconds), seek (0–1 clip fraction, skips fade), armor, helmet, weapon, expression, expressionWeight and skeleton. Inspect first for expectedRevision. Set playing:false with seek to hold a custom pose; seek:0 replays a finished clip. Weapon selects the embedded open/grip finger pose automatically. Shares composition with the Character workshop slots: outfits toggle armor/helmet independently, props select one weapon or none, expressions select happy/angry or neutral. Select 3D in the UI to view; shared tab demo, no persistence.', input: object(CHARACTER_3D_CONFIG_PROPERTIES, ['expectedRevision']) },
]
export const CHARACTER_3D_SOURCES: ManifestSource[] = definitions.flatMap(({ name, ...spec }) => [
  { sourceId: `authoring/${name}.yaml`, text: JSON.stringify({ apiVersion: 'cms.mantle.aotter.net/v1', kind: 'Procedure', metadata: { name }, spec: { ...spec, output: { type: 'object', additionalProperties: true }, handler: { kind: 'ref', ref: `companion.${name}` } } }) },
  { sourceId: `authoring/${name}-mcp.yaml`, text: JSON.stringify({ apiVersion: 'cms.mantle.aotter.net/v1', kind: 'Trigger', metadata: { name }, spec: { source: { kind: 'mcp', surface: 'public' }, target: { procedure: name } } }) },
])
