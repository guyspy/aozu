const frame = document.querySelector('iframe')
const result = document.querySelector('#result')
const characterId = new URLSearchParams(location.search).get('characterId')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const ready = async (check) => {
  for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await wait(50) }
  throw new Error('Timed out waiting for the workshop')
}
try {
  assert(characterId, 'Supply a saved characterId in the URL; this check never edits character data')
  frame.style.width = '390px'
  frame.src = `/characters/${encodeURIComponent(characterId)}/outfits`
  await ready(() => frame.contentDocument.querySelector('.character-stage-canvas'))
  const doc = frame.contentDocument
  const find = (selector) => doc.querySelector(selector)
  for (const width of [320, 390, 757]) {
    frame.style.width = `${width}px`
    await wait(350)
    assert(find('#root').scrollWidth <= width + 1, `Horizontal overflow at ${width}px`)
    assert(find('.character-stage-canvas').clientHeight > 200, `Collapsed preview at ${width}px`)
    assert(!find('.doll-workbench'), `Closed drawer still occupies the page at ${width}px`)
    const trigger = find('.character-stage-preview button[aria-label="Customize appearance"]')
    assert(trigger.getBoundingClientRect().height === 32, 'Customize button has a local size override')
    for (const button of doc.querySelectorAll('[aria-label="Preview controls"] button')) assert(button.getBoundingClientRect().height === 32, 'Preview button has a local size override')
    trigger.click()
    await ready(() => find('[role="dialog"]'))
    await wait(250)
    const drawer = find('[role="dialog"]')
    assert(drawer.getBoundingClientRect().right <= width + 1 && drawer.clientWidth >= width * 0.5, 'Drawer must fit on the right')
    assert(find('.workbench-content').clientHeight > 100, 'Drawer list must remain scrollable')
    for (const label of doc.querySelectorAll('.workbench-tabs [role="tab"] > span:last-child')) {
      assert(label.scrollWidth <= label.clientWidth + 1, `Clipped category at ${width}px: ${label.textContent}`)
    }
    const close = find('[data-slot="sheet-close"]')
    const edit = find('.variant-edit')
    assert(close.getBoundingClientRect().height === 32 && edit.getBoundingClientRect().height === 32, 'Portal buttons have inconsistent sizes')
    assert(frame.contentWindow.getComputedStyle(close).backgroundColor === frame.contentWindow.getComputedStyle(edit).backgroundColor, 'Close and edit buttons use different treatments')
    close.click()
    await ready(() => !find('[role="dialog"]'))
    await ready(() => doc.activeElement === trigger)
  }
  find('.character-stage-preview button[aria-label="Customize appearance"]').click()
  await ready(() => find('[role="dialog"]'))
  frame.style.width = '1280px'
  await ready(() => !find('[role="dialog"]') && find('#root .doll-workbench'))
  await wait(350)
  assert(!find('[data-slot="sheet-overlay"]') && doc.body.style.pointerEvents !== 'none', 'Desktop resize must release the modal')
  assert(find('.doll-workbench').getBoundingClientRect().left > find('.character-stage-panel').getBoundingClientRect().left, 'Desktop must retain two columns')
  // Switching tabs keeps the same preview geometry; profile editing must not resize it either.
  const button = (label) => [...doc.querySelectorAll('button')].find((node) => node.textContent.trim() === label || node.getAttribute('aria-label') === label)
  for (const width of [320, 390, 757, 900, 1182, 1280]) {
    frame.style.width = `${width}px`
    button('Appearance').click()
    await ready(() => find('main').dataset.category === 'expressions')
    await wait(350)
    const selectors = ['.character-stage-panel', '.character-stage-canvas', '[aria-label="Saved Appearance"]']
    const before = selectors.map((selector) => find(selector).getBoundingClientRect())
    const matches = () => selectors.forEach((selector, index) => {
      const after = find(selector).getBoundingClientRect()
      for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(after[key] - before[index][key]) < 1, `${selector} ${key} jumps on profile at ${width}px`)
    })
    button('Character profile').click()
    await ready(() => find('#character-profile'))
    await wait(350)
    matches()
    button('Edit character profile').click()
    await ready(() => find('#character-profile input'))
    matches()
    button('Cancel').click()
    await ready(() => !find('#character-profile input'))
    if (width < 900) {
      assert(find('[role="dialog"] #character-profile'), 'Mobile profile must use the shared drawer')
      find('[data-slot="sheet-close"]').click()
      await ready(() => !find('[role="dialog"]'))
      const trigger = find('.character-stage-preview button[aria-label="Character profile"]')
      await ready(() => doc.activeElement === trigger)
      trigger.click()
      await ready(() => find('[role="dialog"] #character-profile'))
      find('[data-slot="sheet-close"]').click()
      await ready(() => !find('[role="dialog"]'))
    }
    button('Model sheet').click()
    await ready(() => find('.model-sheet-content'))
    const sheet = find('.model-sheet').getBoundingClientRect()
    const selector = find('.model-sheet [aria-label="Saved Appearance"]').getBoundingClientRect()
    for (const key of ['x', 'y']) {
      assert(Math.abs(sheet[key] - before[0][key]) < 1, `Model sheet panel ${key} shifts at ${width}px`)
      assert(Math.abs(selector[key] - before[2][key]) < 1, `Model sheet toolbar ${key} shifts at ${width}px`)
    }
    assert(find('.model-sheet-content').clientHeight > 100 && find('.model-sheet').scrollWidth <= find('.model-sheet').clientWidth + 1, 'Model sheet must retain a scrollable board without overflow')
    find('.model-sheet-content').scrollTop = find('.model-sheet-content').scrollHeight
    assert(find('.model-sheet [aria-label="Saved Appearance"]').getBoundingClientRect().y === selector.y, 'Scrolling references moved the toolbar')
  }
  button('Appearance').click()
  await ready(() => !find('#character-profile'))
  frame.style.width = '844px'; frame.style.height = '390px'
  await wait(350)
  assert(find('.character-stage-canvas').clientHeight > 200 && find('#root').scrollHeight > 390, 'Short windows must scroll instead of collapsing the preview')
  button('Model sheet').click()
  await ready(() => find('.model-sheet-content'))
  assert(find('.model-sheet-toolbar').clientHeight < 150 && find('.model-sheet-content').clientHeight > 100, 'Short windows must keep a compact model sheet toolbar and usable board')
  result.textContent = 'PASS: responsive drawer/buttons, stable Appearance/profile preview and aligned Model sheet panel/toolbar at 320–1280px, and short-window scrolling'
} catch (error) {
  result.textContent = `FAIL: ${error.message}`
  throw error
} finally {
  frame.remove()
}
