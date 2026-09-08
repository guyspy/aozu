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
    const trigger = find('.character-stage-heading button')
    trigger.click()
    await ready(() => find('[role="dialog"]'))
    await wait(250)
    const drawer = find('[role="dialog"]')
    assert(drawer.getBoundingClientRect().right <= width + 1 && drawer.clientWidth >= width * 0.5, 'Drawer must fit on the right')
    assert(find('.workbench-content').clientHeight > 100, 'Drawer list must remain scrollable')
    for (const label of doc.querySelectorAll('.workbench-tabs [role="tab"] > span:last-child')) {
      assert(label.scrollWidth <= label.clientWidth + 1, `Clipped category at ${width}px: ${label.textContent}`)
    }
    find('[data-slot="sheet-close"]').click()
    await ready(() => !find('[role="dialog"]'))
    assert(doc.activeElement === trigger, 'Closing must return focus to the opener')
  }
  find('.character-stage-heading button').click()
  await ready(() => find('[role="dialog"]'))
  frame.style.width = '1280px'
  await ready(() => !find('[role="dialog"]') && find('#root .doll-workbench'))
  await wait(350)
  assert(!find('[data-slot="sheet-overlay"]') && doc.body.style.pointerEvents !== 'none', 'Desktop resize must release the modal')
  assert(find('.doll-workbench').getBoundingClientRect().left > find('.character-stage-panel').getBoundingClientRect().left, 'Desktop must retain two columns')
  frame.style.width = '844px'; frame.style.height = '390px'
  await wait(350)
  assert(find('.character-stage-canvas').clientHeight > 200 && find('#root').scrollHeight > 390, 'Short windows must scroll instead of collapsing the preview')
  result.textContent = 'PASS: 320/390/757px drawer, labels, focus return, 1280px desktop transition, and 844×390px scrolling'
} catch (error) {
  result.textContent = `FAIL: ${error.message}`
  throw error
} finally {
  frame.remove()
}
