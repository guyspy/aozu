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
  // Background iframes can suppress native blur events; exercise React's commit event explicitly.
  const blur = (element) => element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  const image = async (color, width = 800, height = 1200) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = color; ctx.fillRect(200, 100, 400, 1000)
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  }
  const dataUrlFor = (blob) => new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob) })
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
    await fill(height, '185'); blur(height); await settled()
    check(state().character.modelSheet.heightCm === 185, 'Height did not persist')
    await fill(height, ''); blur(height); await settled()
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
    const dataUrl = await dataUrlFor(png)
    const accepted = await call('update_character_model_sheet', { characterId: id, expectedRevision: revision, view: 'side', dataUrl, filename: 'side.png', expectedAssetSha256: null })
    check(accepted.data.modelSheet.views.side.width === 800, 'Agent reference submission failed')
    await app.replaceCharacterReference(id, 'front', await image('#234567'))
    check(state().character.modelSheet.views.front.guides === undefined && state().character.modelSheet.views.front.notes === 'Coat hem is level.', 'Replacement retained old calibration or erased notes')
    await ready(() => !document.querySelector('[data-has-uncommitted-input="true"]'))
    const contract = (await call('inspect_character_contract', { characterId: id, scope: 'model-sheet', referenceId: 't-pose', label: 'T-pose', kind: 'structure', viewpoint: 'front', pose: 't-pose', images: ['front'] })).data
    check(contract.sourceImages[0].dataUrl.startsWith('data:image/png;base64,') && !contract.rig && !contract.registrationFrame, 'Reference contract lost actual image or leaked layer-only contract')
    check(!contract.productionBrief.some((line) => line.includes('Default to a two-step')), 'Reference art was instructed to remove backgrounds')
    const currentRevision = state().persistedRevision
    const landscape = await dataUrlFor(await image('#564432', 1200, 800))
    await call('update_character_model_sheet', { characterId: id, expectedRevision: currentRevision, referenceId: 't-pose', label: 'T-pose', kind: 'structure', pose: 't-pose', sourceSha256: contract.sourceImages[0].sha256, dataUrl: landscape, filename: 't-pose.png', expectedAssetSha256: null })
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
    const frontArt = document.querySelector('[aria-label="Open Front reference"]')
    const poseArt = document.querySelector('[aria-label="Open T-pose reference"]')
    check(poseArt.clientWidth > frontArt.clientWidth * 1.8, 'Landscape reference did not span two columns')
    check(Math.abs(poseArt.clientWidth / poseArt.clientHeight - 1.5) < 0.03, 'Landscape preview lost its original aspect ratio')
    check(Math.abs(frontArt.clientWidth / frontArt.clientHeight - 2 / 3) < 0.03, 'Portrait preview lost its original aspect ratio')
    check(document.querySelector('.model-sheet').scrollWidth <= document.querySelector('.model-sheet').clientWidth + 1, 'Reference layout overflows')
    document.querySelector('.model-sheet-detail [data-slot=sheet-close]')?.click()
    await ready(() => !document.querySelector('.model-sheet-detail'))
    const buttons = (text) => [...document.querySelectorAll('button')].find((button) => button.textContent === text)
    buttons('Save as new Appearance').click()
    await ready(() => document.querySelector('section[data-has-uncommitted-input="true"] input'))
    const nameInput = document.querySelector('section[data-has-uncommitted-input="true"] input')
    await fill(nameInput, 'Gym')
    check((await call('inspect_workspace', {})).data.view.hasUncommittedInput, 'Appearance name form is invisible to agents')
    const formRevision = state().persistedRevision
    const blockedName = await call('set_character_variant_selection', { characterId: id, expectedRevision: formRevision, appearance: { action: 'save', id: 'interrupt', label: 'Interrupt' } }).then(() => false, () => true)
    check(blockedName && state().persistedRevision === formRevision, 'Agent interrupted Appearance naming')
    nameInput.form.querySelector('button[type=submit]').click()
    await ready(() => state().character.appearances?.length === 1); await settled()
    const gym = state().character.activeAppearanceId
    check(state().character.appearances[0].modelSheet.references['t-pose'] && !state().character.modelSheet.views.front, 'First Appearance failed to adopt references')
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 768
    canvas.getContext('2d').fillRect(128, 32, 256, 700)
    const layerPng = canvas.toDataURL('image/png')
    for (const [group, variantId, layer] of [['body', 'base', 'body'], ['prop', 'prop-1', 'front']]) {
      await call('replace_character_asset', { characterId: id, expectedRevision: state().persistedRevision, expectedAssetSha256: null, group, variantId, layer, label: variantId, filename: `${variantId}.png`, dataUrl: layerPng })
    }
    await call('set_character_variant_selection', { characterId: id, expectedRevision: state().persistedRevision, group: 'prop', variantId: 'prop-1', active: true })
    const modified = (await call('inspect_character_contract', { characterId: id, scope: 'model-sheet' })).data
    check(!modified.character.matchesSaved && modified.modelSheet.appearanceId === gym, 'Modified combination lost its saved reference scope')
    const captureBlocked = await call('update_character_model_sheet', { characterId: id, expectedRevision: state().persistedRevision, referenceId: 'front', fromAppearance: true, expectedAssetSha256: modified.modelSheet.views.front.sha256 }).then(() => false, (error) => error.message.includes('differs from the saved Appearance'))
    check(captureBlocked, 'Changed combination overwrote the saved Appearance front')
    await ready(() => buttons('Save as new Appearance') && !buttons('Save as new Appearance').disabled)
    buttons('Save as new Appearance').click()
    await ready(() => document.querySelector('section[data-has-uncommitted-input="true"] input'))
    const nextName = document.querySelector('section[data-has-uncommitted-input="true"] input')
    await fill(nextName, 'With prop'); nextName.form.querySelector('button[type=submit]').click()
    await ready(() => state().character.appearances?.length === 2); await settled()
    const withProp = state().character.activeAppearanceId
    await call('navigate_character', { destination: 'character-model-sheet', characterId: id })
    await ready(() => document.querySelectorAll('.model-sheet-empty').length === 4)
    check(document.querySelectorAll('.model-sheet-art img').length === 0, 'New Appearance inherited another outfit’s pictures')
    await call('update_character_model_sheet', { characterId: id, expectedRevision: state().persistedRevision, referenceId: 'front', fromAppearance: true, expectedAssetSha256: null })
    await ready(() => route.pathname.endsWith('/model-sheet/front') && document.querySelector('.model-sheet-detail') && Number(document.querySelector('main').dataset.characterRevision) === state().persistedRevision)
    const scoped = (await call('inspect_workspace', { includeSnapshot: true })).data
    check(scoped.currentCharacter.modelSheet.appearanceId === withProp && scoped.snapshot.referenceId === 'front', 'Reference snapshot lost Appearance ownership')
    document.querySelector('.model-sheet-detail [data-slot=sheet-close]')?.click()
    await ready(() => !document.querySelector('.model-sheet-detail'))
    const select = document.querySelector('select[aria-label="Saved Appearance"]')
    select.value = gym; select.dispatchEvent(new Event('change', { bubbles: true })); await settled()
    await ready(() => state().character.activeAppearanceId === gym && document.querySelectorAll('.model-sheet-art img').length === 3)
    check(state().character.selected.props.length === 0, 'UI selector did not restore saved prop selection')
    await call('undo_character_change', { characterId: id, expectedRevision: state().persistedRevision })
    check(state().character.activeAppearanceId === withProp && state().character.selected.props[0] === 'prop-1', 'Undo separated Appearance from its combination')
    await call('set_character_variant_selection', { characterId: id, expectedRevision: state().persistedRevision, appearance: { action: 'rename', id: withProp, label: 'Prop look' } })
    const archive = await app.exportCharacter(id)
    const { readCharacterDraftZip } = await import('/src/adapters/zip/character-draft.ts')
    const { inspectCharacterImage } = await import('/src/adapters/browser/character-image.ts')
    const roundtrip = (await readCharacterDraftZip(archive, inspectCharacterImage)).draft
    check(roundtrip.appearances.length === 2 && roundtrip.activeAppearanceId === withProp && roundtrip.appearances[0].modelSheet.references['t-pose'].pose === 't-pose', 'Character ZIP lost saved Appearances')
    await app.editor.reload()
    const afterReload = (await call('inspect_character_contract', { characterId: id, scope: 'model-sheet' })).data
    check(afterReload.character.appearances.length === 2 && afterReload.character.matchesSaved && afterReload.modelSheet.appearanceId === withProp, 'Mantle reload lost Appearance state')
    const namedBackup = await app.prepareCharacterLibraryImport(await app.exportCharacterLibrary())
    check(namedBackup.entries.find((entry) => entry.id === id).data.appearances.length === 2, 'Library backup lost saved Appearances')
    await call('navigate_character', { destination: 'characters' })
    await ready(() => route.pathname === '/collections')
    result.textContent = 'PASS: 12 tools, UI save/switch, Appearance-scoped references, protected front capture, naming guard, undo, Mantle reload, both archives and responsive layout'
  } catch (error) { result.textContent = `FAIL: ${error.stack ?? error.message}`; console.error(error) }
  finally { app.webmcp.dispose() }
}
