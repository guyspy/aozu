import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { de } from '../src/ui/locales/de.ts'
import { en } from '../src/ui/locales/en.ts'
import { es } from '../src/ui/locales/es.ts'
import { fr } from '../src/ui/locales/fr.ts'
import { ja } from '../src/ui/locales/ja.ts'
import { ko } from '../src/ui/locales/ko.ts'
import { ptBR } from '../src/ui/locales/pt-BR.ts'
import { zhCN } from '../src/ui/locales/zh-CN.ts'
import { zhTW } from '../src/ui/locales/zh-TW.ts'

type Tree = { [key: string]: string | Tree }
const leaves = (value: Tree, path: string[] = []): string[] =>
  Object.entries(value).flatMap(([key, child]) => typeof child === 'string' ? [[...path, key].join('.')] : leaves(child, [...path, key]))

const english = new Set(leaves(en as unknown as Tree))
const read = (tree: Tree, path: string) => path.split('.').reduce<string | Tree>((value, part) => (value as Tree)[part], tree)
const tokens = (value: string | Tree) => [...String(value).matchAll(/\{\{[^}]+\}\}/g)].map(([token]) => token).sort()

// Every locale carries the whole English shape, so no screen can silently fall back mid-sentence.
for (const [name, locale] of Object.entries({ de, es, fr, ja, ko, ptBR, zhCN, zhTW })) {
  const keys = new Set(leaves(locale as unknown as Tree))
  const missing = [...english].filter((key) => !keys.has(key))
  const extra = [...keys].filter((key) => !english.has(key))
  assert.deepEqual(missing, [], `${name} is missing keys: ${missing.join(', ')}`)
  assert.deepEqual(extra, [], `${name} has keys English dropped: ${extra.join(', ')}`)
  assert.deepEqual([...keys], [...english], `${name} keys are not ordered like English`)
  for (const key of english) {
    const value = read(locale as unknown as Tree, key)
    assert.ok(String(value).trim(), `${name}.${key} is empty`)
    assert.deepEqual(tokens(value), tokens(read(en as unknown as Tree, key)), `${name}.${key} changed interpolation tokens`)
    assert.doesNotMatch(String(value), /[\uE000-\uF8FF]/, `${name}.${key} contains a translation marker`)
  }
  const source = readFileSync(join('src/ui/locales', `${name === 'ptBR' ? 'pt-BR' : name === 'zhCN' ? 'zh-CN' : name === 'zhTW' ? 'zh-TW' : name}.ts`), 'utf8')
    .replace(/^import .*$/gm, '')
  assert.doesNotMatch(source, /\ben\.[A-Za-z]/, `${name} directly falls back to English`)
}

const untranslatedJapanese = [...english].filter((key) => key !== 'common.productName' && read(ja as unknown as Tree, key) === read(en as unknown as Tree, key))
assert.deepEqual(untranslatedJapanese, [], `Japanese still uses English: ${untranslatedJapanese.join(', ')}`)

const sources: string[] = []
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (/\.tsx?$/.test(path) && !path.includes(`locales${'/'}`)) sources.push(path)
  }
}
walk('src')

// `t('ns.key')` is resolved literally; `text('key')` goes through a per-file `t(`ns.${key}`)` helper.
const used = new Set<string>()
for (const path of sources) {
  const source = readFileSync(path, 'utf8')
  for (const [, key] of source.matchAll(/\bt\('([a-zA-Z][\w-]*(?:\.[\w-]+)+)'/g)) used.add(key)
  const helpers = [...source.matchAll(/=> t\(`([a-zA-Z]+)\.\$\{/g)].map(([, namespace]) => namespace)
  for (const [, key] of source.matchAll(/\btext\('([\w-]+)'\)/g)) for (const namespace of helpers) used.add(`${namespace}.${key}`)
}
assert.ok(used.size > 100, `expected to find the UI's translation keys, found ${used.size}`)

// Dynamic keys are built from a known set; list their resolved forms so the scan stays honest.
const dynamic = new Set([
  ...['expression', 'outfit', 'prop'].flatMap((group) => [`characterDraft.groups.${group}.add`, `characterDraft.groups.${group}.variantName`]),
  ...['merge', 'replace'].map((mode) => `library.${mode}Description`),
  ...['unsupported', 'registering', 'ready', 'failed'].map((status) => `main.webmcp.${status}`),
  ...['saving', 'saved', 'failed', 'retry', 'conflict', 'reload'].map((status) => `characterDraft.status.${status}`),
  ...['composite', 'overlay', 'difference', 'diagnostic'].map((mode) => `characterDraft.alignment.${mode}`),
  ...['expressions', 'outfits', 'props'].map((id) => `characterDraft.categories.${id}`),
  ...['front', 'three-quarter', 'side', 'back'].map((view) => `modelSheet.views.${view}`),
  ...['full-body', 'head', 'structure', 'expression', 'detail', 'style'].map((kind) => `modelSheet.kinds.${kind}`),
  ...['mask-alignment', 'visual-correlation'].map((source) => `characterDraft.transform.fitSource.${source}`),
  ...['body', 'head', 'primary', 'behindOptional'].map((layer) => `characterDraft.layers.${layer}`),
  ...['draft', 'needs-work', 'confirmed'].map((review) => `storyboard.${review}`),
  ...['inspiration', 'design'].map((purpose) => `world.${purpose}`),
  ...['locationProfile', 'conditions'].map((view) => `world.${view}`),
  'world.images',
])

const staleDynamic = [...dynamic].filter((key) => !english.has(key))
assert.deepEqual(staleDynamic, [], `dynamic i18n allowlist has stale keys: ${staleDynamic.join(', ')}`)
const unresolved = [...used].filter((key) => !english.has(key) && !dynamic.has(key))
assert.deepEqual(unresolved, [], `UI asks for keys English does not define: ${unresolved.join(', ')}`)

const unusedNamespaces = ['world', 'storyboard', 'books', 'library']
for (const namespace of unusedNamespaces) {
  assert.ok([...english].some((key) => key.startsWith(`${namespace}.`)), `${namespace} namespace disappeared`)
}

console.log(`i18n: ${english.size} keys, 8 locales complete, ${used.size} referenced keys all resolve: ok`)
