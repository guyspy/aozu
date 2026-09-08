import 'fake-indexeddb/auto'
import { createElement as h, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router'
import { createApplication } from '/src/bootstrap.ts'
import { AppRoutes } from '/src/ui/routes/AppRoutes.tsx'
import i18n from '/src/ui/i18n.ts'
import '/src/index.css'

const preferences = new Map()
Object.defineProperty(window, 'localStorage', { value: { getItem: (key) => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) } })
await i18n.changeLanguage('en')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const wait = () => new Promise((resolve) => setTimeout(resolve, 30))
const ready = async (predicate) => { for (let i = 0; i < 400; i++) { if (await predicate()) return; await wait() } throw new Error(`Timed out: ${predicate}`) }
const result = document.querySelector('#result')
if (new URLSearchParams(location.search).has('responsive')) {
  try {
    for (const width of [320, 390, 900, 1280]) {
      const frame = document.createElement('iframe')
      frame.style.cssText = `width:${width}px;height:844px;border:0`
      frame.src = '/scripts/check-model-sheet.html'
      document.body.append(frame)
      await ready(() => /^(PASS|FAIL)/.test(frame.contentDocument?.querySelector('#result')?.textContent ?? ''))
      check(frame.contentDocument.querySelector('#result').textContent.startsWith('PASS'), `${width}px: ${frame.contentDocument.querySelector('#result').textContent}`)
      check(frame.contentDocument.querySelector('#root').scrollWidth <= width + 1, `Overflow at ${width}px`)
      frame.remove()
    }
    result.textContent = 'PASS: model sheet flow at 320, 390, 900 and 1280px'
  } catch (error) { result.textContent = `FAIL: ${error.message}` }
} else {
  const registered = new Map()
  const route = { pathname: '/characters/new/model-sheet' }
  const app = createApplication({
    defaultView: { location: route, navigator: {}, addEventListener() {}, removeEventListener() {} },
    querySelector: document.querySelector.bind(document),
    modelContext: { registerTool: (tool) => registered.set(tool.name, tool) },
  })
  function Location() { const location = useLocation(); useEffect(() => { route.pathname = location.pathname }, [location]); return null }
  const root = createRoot(document.querySelector('#root'))
  root.render(h(MemoryRouter, { initialEntries: [route.pathname] }, h(Location), h(AppRoutes, { application: app })))
  const state = () => app.editor.store.getState()
  const settled = () => ready(() => state().saveStatus === 'saved')
  const fill = async (element, value) => {
    element.focus()
    Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    await wait()
  }
  const image = async (color) => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1200
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 1200)
    ctx.fillStyle = color; ctx.fillRect(200, 100, 400, 1000)
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  }
  const call = async (name, input) => { try { return await registered.get(name).execute(input, {}) } catch (error) { throw new Error(`${name} ${JSON.stringify(input, (key, value) => key === 'dataUrl' ? '[PNG]' : value)}: ${error.message}`) } }
  try {
    await ready(() => document.querySelectorAll('.model-sheet-card').length === 4)
    await app.webmcp.ready
    check((await app.loadCharacterLibrary()).characters.length === 0, 'Opening an empty model sheet saved a Character')
    const png = await image('#564432')
    await app.replaceCharacterReference('new', 'front', png)
    await ready(() => !route.pathname.includes('/new/') && document.querySelector('[aria-label="Open Front reference"]'))
    check(!state().character.variants[0].layers.body, 'Reference changed base art')
    const id = state().activeCharacterId
    const height = document.querySelector('.model-sheet-height input')
    await fill(height, '185'); height.blur(); await settled()
    check(state().character.modelSheet.heightCm === 185, 'Height did not persist')
    await fill(height, ''); height.blur(); await settled()
    check(state().character.modelSheet.heightCm === undefined, 'Empty height became zero')
    document.querySelector('[aria-label="Undo"]').click(); await settled()
    check(state().character.modelSheet.heightCm === 185, 'Height did not undo')
    document.querySelector('[aria-label="Open Front reference"]').click()
    await ready(() => document.querySelector('.model-sheet-detail'))
    const dialog = document.querySelector('.model-sheet-detail')
    check(dialog.scrollWidth <= dialog.clientWidth + 1, 'Reference editor overflows')
    const openView = (await call('inspect_workspace', {})).data.view
    check(openView.panel === 'reference' && openView.referenceView === 'front', 'Tool missed the open reference editor')
    await fill(dialog.querySelector('textarea'), 'Coat hem is level.')
    await fill(dialog.querySelector('input[type=range]'), '12')
    dialog.querySelector('button[type=submit]').click(); await settled()
    check(state().character.modelSheet.views.front.notes === 'Coat hem is level.' && state().character.modelSheet.views.front.guides.head === 0.12, 'Notes or guides were not saved')
    dialog.querySelector('[data-slot=sheet-close]').click()
    await ready(() => !document.querySelector('.model-sheet-detail'))
    const inspected = (await call('inspect_workspace', { includeSnapshot: true })).data
    check(inspected.currentCharacter.id === id && inspected.currentCharacter.modelSheet.heightCm === 185, 'Tool missed the active model sheet')
    check(inspected.assetPolicy.tool === 'update_character_model_sheet' && inspected.snapshot.status === 'unavailable', 'Reference page advertised appearance-layer rules or the wrong image')
    const revision = state().persistedRevision
    const rejected = await call('update_character_model_sheet', { characterId: id, expectedRevision: revision, view: 'front', guides: { head: 0.9, feet: 0.1 } }).then(() => false, (error) => error.message.includes('head above the feet'))
    check(rejected, 'Invalid guides were not rejected')
    check(state().persistedRevision === revision, 'Invalid guides mutated storage')
    const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(png) })
    const accepted = await call('update_character_model_sheet', { characterId: id, expectedRevision: revision, view: 'side', dataUrl, filename: 'side.png', expectedAssetSha256: null })
    check(accepted.data.modelSheet.views.side.width === 800, 'Agent reference submission failed')
    await app.replaceCharacterReference(id, 'front', await image('#234567'))
    check(state().character.modelSheet.views.front.guides === undefined && state().character.modelSheet.views.front.notes === 'Coat hem is level.', 'Replacement retained old calibration or erased notes')
    await ready(() => !document.querySelector('[data-has-uncommitted-input="true"]'))
    const contract = (await call('inspect_character_contract', { characterId: id, scope: 'model-sheet', referenceId: 't-pose', label: 'T-pose', kind: 'structure', viewpoint: 'front', pose: 't-pose', images: ['front'] })).data
    check(contract.sourceImages[0].dataUrl.startsWith('data:image/png;base64,') && !contract.rig && !contract.registrationFrame, 'Reference contract lost actual image or leaked layer-only contract')
    check(!contract.productionBrief.some((line) => line.includes('Default to a two-step')), 'Reference art was instructed to remove backgrounds')
    const currentRevision = state().persistedRevision
    await call('update_character_model_sheet', { characterId: id, expectedRevision: currentRevision, referenceId: 't-pose', label: 'T-pose', kind: 'structure', pose: 't-pose', sourceSha256: contract.sourceImages[0].sha256, dataUrl, filename: 't-pose.png', expectedAssetSha256: null })
    await ready(() => route.pathname.endsWith('/model-sheet/t-pose') && document.querySelector('.model-sheet-detail'))
    const snapshot = (await call('inspect_workspace', { includeSnapshot: true })).data.snapshot
    check(snapshot.status === 'ready' && snapshot.referenceId === 't-pose' && snapshot.source === 'model-sheet-reference', 'Exact reference did not open for visual review')
    check(state().character.modelSheet.views.front && state().character.modelSheet.references['t-pose'], 'Supplemental pose overwrote front')
    const afterPose = state().persistedRevision
    const stale = await call('update_character_model_sheet', { characterId: id, expectedRevision: currentRevision, referenceId: 't-pose', notes: 'stale' }).then(() => false, () => true)
    const staleHash = await call('update_character_model_sheet', { characterId: id, expectedRevision: afterPose, referenceId: 't-pose', dataUrl, filename: 'wrong.png', expectedAssetSha256: null }).then(() => false, () => true)
    check(stale && staleHash && state().persistedRevision === afterPose, 'Stale revision/hash changed reference')
    const body = (await call('inspect_character_contract', { characterId: id, group: 'body', variantId: 'base', layer: 'body' })).data
    check(body.target.generationRecipe.pose === 'a-pose' && body.target.alignment.visualReview, 'First Appearance lacks A-pose review')
    check(registered.size === 12, 'Tool count grew')
    const backup = await app.prepareCharacterLibraryImport(await app.exportCharacterLibrary())
    check(backup.entries.some((entry) => entry.id === id && entry.data.modelSheet.heightCm === 185), 'Library backup lost model sheet')
    await app.editor.reload(); await ready(() => document.querySelectorAll('.model-sheet-art img').length === 3)
    check(state().character.modelSheet.views.side.asset.inspection.width === 800 && state().character.modelSheet.references['t-pose'].pose === 't-pose', 'Reload lost original reference or metadata')
    result.textContent = 'PASS: 12 tools, scoped source contract, A-pose guidance, supplemental pose, exact review snapshot, stale writes, guides/history and backup/reload'
  } catch (error) { result.textContent = `FAIL: ${error.stack ?? error.message}`; console.error(error) }
  finally { app.webmcp.dispose() }
}
