import 'fake-indexeddb/auto'
import { createElement as h, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { createApplication } from '/src/bootstrap.ts'
import { AppRoutes } from '/src/ui/routes/AppRoutes.tsx'
import i18n from '/src/ui/i18n.ts'
import '/src/index.css'

const preferences = new Map()
Object.defineProperty(window, 'localStorage', { value: { getItem: (key) => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value), removeItem: (key) => preferences.delete(key) } })
// Test-only media preference; application storage and OS settings remain untouched.
if (new URLSearchParams(location.search).has('reduced')) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (query) => {
    const media = matchMedia(query)
    if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(media, 'matches', { value: true })
    return media
  }
}
await i18n.changeLanguage('en')
const result = document.querySelector('#result')
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (condition, message) => { if (!condition) throw new Error(message) }
const ready = async (predicate) => { for (let i = 0; i < 400; i++) { if (await predicate()) return; await wait() } throw new Error(`Timed out: ${predicate}`) }
const button = (text) => [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === text)
const menu = (text) => [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.trim() === text)
const text = async (input, value) => {
  input.focus()
  Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await wait()
  input.blur()
  await wait()
}
const openMenu = async (selector) => {
  const trigger = document.querySelector(selector)
  trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false }))
  await ready(() => document.querySelector('[role="menuitem"]'))
}
let navigate, route, application, root
function Location() {
  const location = useLocation(), go = useNavigate()
  useEffect(() => { navigate = go; route = location.pathname }, [location, go])
  return null
}
const mount = () => {
  application = createApplication(document.implementation.createHTMLDocument())
  root = createRoot(document.querySelector('#root'))
  root.render(h(StrictMode, null, h(MemoryRouter, { initialEntries: ['/'] }, h(Location), h(AppRoutes, { application }))))
}
if (new URLSearchParams(location.search).has('responsive')) {
  try {
    for (const width of [320, 390, 757, 1280]) {
      const frame = document.createElement('iframe')
      frame.style.cssText = `width:${width}px;height:844px;border:0`
      frame.src = '/scripts/check-card-books.html' + (new URLSearchParams(location.search).has('reduced') ? '?reduced' : '')
      document.body.append(frame)
      await ready(() => /^(PASS|FAIL)/.test(frame.contentDocument?.querySelector('#result')?.textContent ?? ''))
      const outcome = frame.contentDocument.querySelector('#result').textContent
      check(outcome.startsWith('PASS'), `${width}px: ${outcome}`)
      const doc = frame.contentDocument
      check(doc.querySelector('#root').scrollWidth <= width + 1, `Root overflow at ${width}px`)
      const cards = doc.querySelector('.book-card-grid')
      if (width <= 390) check(getComputedStyle(cards).gridTemplateColumns.split(' ').length === 2, `Expected two card slots at ${width}px`)
      frame.remove()
    }
    result.textContent = 'PASS: collection flow, fan-to-grid, logo/404 and responsive layout at 320, 390, 757, 1280px'
  } catch (error) { result.textContent = `FAIL: ${error.message}` }
} else {
try {
  mount()
  await ready(() => document.querySelector('.character-stage-canvas'))
  check(route === '/characters/new/expressions', 'First visit did not enter the workshop')
  check((await application.loadCharacterLibrary()).characters.length === 0, 'Opening the workshop saved an empty Character')
  root.unmount(); mount()
  await ready(() => document.querySelector('input[aria-label="Character name"]'))
  check((await application.loadCharacterLibrary()).characters.length === 0, 'Reloading created an empty Character')
  await text(document.querySelector('input[aria-label="Character name"]'), 'Aster')
  await ready(() => application.editor.store.getState().persistedRevision > 0 && !route.includes('/new/'))
  let library = await application.loadCharacterLibrary()
  const characterId = library.characters[0].id
  check(library.characters.length === 1 && library.collections[0].characterIds.includes(characterId), 'First edit did not save once into the default book')
  document.querySelector('header button').click()
  await ready(() => route === '/collections/default' && document.querySelector('.book-character-card'))
  await openMenu('.book-switcher')
  menu('New collection').click()
  await ready(() => document.querySelector('.book-profile-form input'))
  await text(document.querySelector('.book-profile-form input'), 'Cloud atlas')
  document.querySelector('.book-profile-form').requestSubmit()
  await ready(() => route.startsWith('/collections/') && route !== '/collections/default' && !document.querySelector('[data-slot="sheet-content"]'))
  const bookId = route.split('/').pop()
  button('World background').click()
  await ready(() => document.querySelector('.book-profile-form textarea'))
  const fields = document.querySelectorAll('.book-profile-form textarea')
  await text(fields[0], 'People of the floating islands')
  await text(fields[1], 'The islands share one sky.\nEvery character remembers the winter voyage.')
  document.querySelector('.book-profile-form').requestSubmit()
  await ready(() => !document.querySelector('[data-slot="sheet-content"]'))
  const world = (await application.loadCharacterLibrary()).collections.find((book) => book.id === bookId)
  check(world.backstory.includes('winter voyage') && world.description.includes('floating'), 'World metadata did not persist through Mantle')
  await application.updateCollection(bookId, { name: world.name, description: world.description, backstory: world.backstory }, world.version)
  let staleRejected = false
  try { await application.updateCollection(bookId, { name: 'Stale', description: '', backstory: '' }, 0) } catch { staleRejected = true }
  check(staleRejected, 'A stale world profile overwrote the saved book')
  navigate('/collections/default')
  await ready(() => document.querySelector('.book-card-action'))
  await openMenu('.book-card-action')
  menu('Move to collection').click()
  await ready(() => button('Cloud atlas'))
  button('Cloud atlas').click()
  await ready(() => !document.querySelector('[data-slot="sheet-content"]'))
  library = await application.loadCharacterLibrary()
  check(!library.collections[0].characterIds.includes(characterId) && library.collections.find((book) => book.id === bookId).characterIds.includes(characterId), 'Moving a Character did not preserve one-book membership')
  navigate(`/collections/${bookId}`)
  await ready(() => document.querySelector('.companion-card-open'))
  document.querySelector('.companion-card-open').click()
  await ready(() => document.querySelector('.character-stage-canvas'))
  document.querySelector('header button').click()
  await ready(() => route === `/collections/${bookId}`)
  navigate('/')
  await ready(() => route === `/collections/${bookId}`)
  const snapshot = await application.prepareCharacterLibraryImport(await application.exportCharacterLibrary())
  check(snapshot.entries.find((entry) => entry.id === bookId).data.backstory === world.backstory, 'Library ZIP lost the shared world')
  await application.importCharacterLibrary(snapshot, 'replace')
  check((await application.loadCharacterLibrary()).collections.find((book) => book.id === bookId).backstory === world.backstory, 'Restoring the library lost world metadata')
  await openMenu('button[aria-label="Collection and library actions"]')
  menu('Delete collection').click()
  await ready(() => button('Delete collection'))
  button('Delete collection').click()
  await ready(() => route === '/collections/default' && !document.querySelector('[data-slot="sheet-content"]'))
  check((await application.loadCharacterLibrary()).collections[0].characterIds.includes(characterId), 'Deleting a book lost its Character')
  for (const path of ['/start', '/characters', '/missing-page']) {
    navigate(path)
    await ready(() => route === path && document.querySelector('main')?.textContent.includes('404'))
    check(document.querySelector('header a')?.getAttribute('href') === '/', 'Logo must always link home')
    document.querySelector('header a').click()
    await ready(() => route === '/collections/default' && document.querySelector('.book-card-grid'))
  }
  await application.copyCharacter(characterId)
  await application.copyCharacter(characterId)
  root.unmount(); mount()
  await ready(() => document.querySelectorAll('.book-character-card').length === 3)
  const cards = [...document.querySelectorAll('.book-character-card')]
  const animations = cards.flatMap((card) => card.getAnimations())
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  check(animations.length === (reduced ? 0 : 3), 'Opening a collection did not respect the motion preference')
  if (!reduced) {
    check(animations[0].effect.getKeyframes()[1].transform.includes('rotate(-4.25deg)'), 'The original fan angle was not retained')
    await Promise.all(animations.map((animation) => animation.finished))
  }
  const rects = cards.map((card) => card.getBoundingClientRect())
  check(rects.every((a, i) => rects.every((b, j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)), 'Settled cards overlap')
  button('World background').click()
  await ready(() => document.querySelector('.book-profile-form textarea'))
  await text(document.querySelector('.book-profile-form textarea'), 'A refreshed collection')
  document.querySelector('.book-profile-form').requestSubmit()
  await ready(() => !document.querySelector('[data-slot="sheet-content"]') && document.body.textContent.includes('A refreshed collection'))
  check(cards.every((card) => card.isConnected && card.getAnimations().length === 0), 'Metadata refresh replayed or remounted the cards')
  check(!document.body.textContent.includes('card book'), 'Old card-book naming remains visible')
  check(!document.body.textContent.includes('Story mode'), 'Dormant Story mode remains visible')
  check(document.documentElement.scrollWidth <= innerWidth && ![...document.querySelectorAll('input,button')].some((el) => el.getBoundingClientRect().right > innerWidth + 1), 'Book controls overflow the viewport')
  result.textContent = 'PASS: first visit/reload, first save, default book, Mantle world profile/conflict, move, editor return, last book, ZIP/restore, delete, removed routes/404, logo home, fan-to-grid and reduced motion'
} catch (error) {
  result.textContent = `FAIL: ${error.message}`
  console.error(error)
}
}
