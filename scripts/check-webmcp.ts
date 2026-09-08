import assert from 'node:assert/strict'
import { runtimeDiagnostic } from '@aotter/mantle-spec'
import type { WebMcpTool } from '@aotter/mantle-web/webmcp'

import { createWebMcpController, readWorkspaceView } from '../src/adapters/webmcp/controller.ts'
import { bindMantleWebMcpTools, createAgentCapability } from '../src/adapters/webmcp/tools.ts'
import { compileAuthoringBackbone } from '../src/core/mantle/backbone.ts'
import { CHARACTER_VISUAL_REVIEW } from '../src/core/application/character-agent-guidance.ts'

// A fresh inspection follows UI-only changes, independent of the saved variant selection.
const page = {
  dataset: { workspaceView: 'character', characterId: 'id', category: 'expressions', variantId: 'happy', previewMode: 'overlay', hasUncommittedInput: 'false' } as Record<string, string>,
  querySelectorAll: () => CHARACTER_VISUAL_REVIEW.checks.map(({ mode, label }) => ({
    dataset: { alignmentMode: mode },
    textContent: label,
    getAttribute: () => String(page.dataset.previewMode === mode),
  })),
}
const viewDocument = { querySelector: () => page } as unknown as Document
assert.equal(readWorkspaceView({ querySelector: () => null } as unknown as Document), null)
const initialView = readWorkspaceView(viewDocument)!
assert.equal(initialView.viewedVariantId, 'happy')
assert.equal(initialView.hasUncommittedInput, false)
assert.deepEqual(initialView.alignmentControls.filter(({ selected }) => selected).map(({ mode }) => mode), ['overlay'])
page.dataset.previewMode = 'diagnostic'
page.dataset.panel = 'profile'
page.dataset.hasUncommittedInput = 'true'
const changedView = readWorkspaceView(viewDocument)!
assert.equal(changedView.previewMode, 'diagnostic')
assert.equal(changedView.panel, 'profile')
assert.equal(changedView.hasUncommittedInput, true)
assert.equal(initialView.previewMode, 'overlay')
page.dataset = { workspaceView: 'collection', collectionId: 'book' }
page.querySelectorAll = () => []
assert.equal(readWorkspaceView(viewDocument)!.collectionId, 'book')
assert.equal(readWorkspaceView(viewDocument)!.viewedVariantId, null)

const plan = compileAuthoringBackbone()
const triggers = new Set(['inspect-workspace', 'navigate-character', 'inspect-character-contract', 'update-character-profile', 'replace-character-asset', 'repair-character-asset', 'set-character-variant-selection', 'set-character-variant-transform', 'undo-character-change', 'redo-character-change'])
assert.equal(createAgentCapability({} as Document).isAvailable(), false)
assert.equal(await bindMantleWebMcpTools({} as Document, plan, async () => ({ ok: true, data: null }), triggers), null)

const registered = new Map<string, WebMcpTool>()
let registrationSignal: AbortSignal | undefined
const view = {
  location: { pathname: '/characters' },
  addEventListener() {},
  removeEventListener() {},
}
const document = {
  defaultView: view,
  modelContext: {
    async registerTool(tool: WebMcpTool, options: { signal: AbortSignal }) {
      registered.set(tool.name, tool)
      registrationSignal = options.signal
    },
  },
} as unknown as Document
assert.equal(createAgentCapability(document).isAvailable(), true)

let navigated: string | undefined
const invoke = async (trigger: string, input: unknown) => ({
  ok: true as const,
  data: trigger === 'navigate-character'
    ? { status: 'ok', data: { trigger, input }, effects: { navigation: { path: '/characters/id/outfits/raincoat', mode: 'push', reason: 'review' } } }
    : { status: 'ok', data: { trigger, input } },
})
const controller = createWebMcpController(document, plan, [...triggers], invoke)
await controller.ready
assert.deepEqual(controller.getState(), { status: 'ready', toolCount: 10 })
assert.deepEqual([...registered.keys()].sort(), [
  'inspect_character_contract',
  'inspect_workspace',
  'navigate_character',
  'redo_character_change',
  'repair_character_asset',
  'replace_character_asset',
  'set_character_variant_selection',
  'set_character_variant_transform',
  'undo_character_change',
  'update_character_profile',
])
assert.deepEqual([
  registered.get('inspect_workspace')?.annotations.readOnlyHint,
  registered.get('replace_character_asset')?.annotations.readOnlyHint,
  registered.get('undo_character_change')?.annotations.readOnlyHint,
], [true, false, false])
assert.match(registered.get('inspect_character_contract')!.description, /required browser visual-review workflow/)
assert.match(registered.get('set_character_variant_transform')!.description, /expression whole head/)
assert.match(registered.get('set_character_variant_transform')!.description, /x moves right, y moves down/)
assert.match(registered.get('set_character_variant_transform')!.description, /Composite, Overlay, Difference, and Align/)
assert.match(registered.get('inspect_workspace')!.description, /two-step workflow/)
assert.match(registered.get('inspect_workspace')!.description, /snapshot, not a live subscription/)
for (const tool of registered.values()) {
  if (!tool.annotations.readOnlyHint) assert.match(tool.description, /AOZU itself handles effects.navigation/)
}
assert.equal(registered.get('set_character_variant_selection')!.annotations.readOnlyHint, false)
assert.match(registered.get('set_character_variant_selection')!.description, /bottom-to-top activation order/)
const selection = { characterId: 'id', group: 'prop', variantId: 'hat', active: true, expectedRevision: 1 }
assert.deepEqual(await registered.get('set_character_variant_selection')!.execute(selection, {}), {
  status: 'ok', data: { trigger: 'set-character-variant-selection', input: selection },
})
const navigation = { destination: 'character-outfits', characterId: 'id', variantId: 'raincoat' }
assert.deepEqual(await registered.get('navigate_character')!.execute(navigation, {}), {
  status: 'ok', data: { trigger: 'navigate-character', input: navigation }, effects: { navigation: { path: '/characters/id/outfits/raincoat', mode: 'push', reason: 'review' } },
})
assert.equal(navigated, undefined)
let navigationCount = 0
controller.setNavigate((path) => { navigated = path; view.location.pathname = path; navigationCount++ })
assert.equal(navigated, '/characters/id/outfits/raincoat')
await registered.get('navigate_character')!.execute(navigation, {})
assert.equal(navigationCount, 1, 'The website must not push the same route twice')
const boundSignal = registrationSignal
controller.dispose()
assert.equal(boundSignal?.aborted, true)

const incomplete = createWebMcpController(document, plan, [...triggers, 'missing-trigger'], invoke)
await incomplete.ready
assert.equal(incomplete.getState().status, 'failed')
incomplete.dispose()

registered.clear()
await bindMantleWebMcpTools(document, plan, async () => ({
  ok: false,
  diagnostic: runtimeDiagnostic({ code: 'CONFLICT', severity: 'error', path: 'character/revision', message: 'stale' }),
}), new Set(['navigate-character']))
await assert.rejects(registered.get('navigate_character')!.execute({ destination: 'characters' }, {}), /stale/)

console.log('webmcp: ok')
