const fs = require('fs')
const path = require('path')
const assert = require('assert')

const file = path.join(__dirname, '..', 'client.js')
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

/* ------------------------------- fake React ------------------------------- */

const fakeReact = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {})
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  },
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useRef(initial) {
    return { current: initial }
  },
  useEffect(fn) {
    if (typeof fn === 'function') {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanup()
    }
  },
  useMemo(fn) {
    return fn()
  },
  useCallback(fn) {
    return fn
  },
}

global.window = { __ModuleLoader__: { load: (definition) => { global.__dshDefinition = definition } } }
global.setTimeout = global.setTimeout
new Function('window', source)(global.window)
const definition = global.__dshDefinition
assert.ok(definition, 'client bundle should call __ModuleLoader__.load')
assert.strictEqual(definition.id, '@local/dsh-dev-toolbox')

const exportsObject = definition.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error('unexpected require: ' + name)
})
assert.strictEqual(exportsObject.name, 'dsh-dev-toolbox')
assert.ok(Array.isArray(exportsObject.inject))
assert.deepStrictEqual(exportsObject.inject, ['slots', 'locale'])

/* --------------------------------- fake ctx -------------------------------- */

const registrations = []
let disposed = 0
const dictionaryCalls = []
const ctx = {
  effect(fn, label) {
    const dispose = fn()
    if (typeof dispose === 'function') registrations.push({ label, dispose })
    return () => {}
  },
  locale: {
    bind: () => (key) => key,
    register(ns, dicts) {
      dictionaryCalls.push({ ns, form: 'bulk', dicts })
      return () => { disposed += 1 }
    },
    getLocale: () => ({ active: 'zh' }),
    subscribe: () => () => {},
  },
  slots: {
    inject(key, callback) {
      callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => { disposed += 1 }
    },
  },
}

const result = exportsObject.apply(ctx)
assert.ok(result && typeof result.ToolboxPage === 'function', 'apply returns the page component')

const main = registrations.find((item) => item.options && item.options.name === 'main')
const side = registrations.find((item) => item.options && item.options.name === 'sidebar.panellist')
assert.ok(main, 'main slot registered')
assert.strictEqual(main.options.key, 'dsh-dev-toolbox')
assert.strictEqual(main.options.locale, 'dsh-dev-toolbox')
assert.ok(side, 'sidebar.panellist slot registered')
assert.strictEqual(side.options.id, 'dsh-dev-toolbox')
assert.strictEqual(side.options.order, 30)
assert.strictEqual(typeof side.options.label, 'function')
assert.strictEqual(side.options.label(), 'title')
assert.ok(dictionaryCalls.length === 1, 'dictionaries registered once')

/* --------------------------- render the whole page ------------------------- */

let renderedNodes = 0
function render(node, depth) {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => render(child, depth)).join('')
  if (typeof node.type === 'function') {
    renderedNodes += 1
    return render(node.type(node.props || {}), depth + 1)
  }
  if (typeof node.type === 'string' && /^(script|textarea|style|svg|path|circle)$/.test(node.type)) {
    if (node.type === 'textarea') return 'textarea'
    if (node.type === 'style') return 'style'
    return ''
  }
  return render(node.props && node.props.children, depth + 1)
}

const tree = render(fakeReact.createElement(result.ToolboxPage, { t: (key) => key }), 0)
assert.ok(renderedNodes > 8, 'function components rendered')
assert.ok(tree.includes('tab.time'), 'renders the timestamp tab label')
assert.ok(tree.includes('tab.json'), 'renders the JSON tab label')
assert.ok(tree.includes('tab.random'), 'renders the random tab label')
assert.ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(tree), 'timestamp panel produced a formatted date')
assert.ok(tree.includes('random.generate'), 'random panel rendered')

/* ---------------------- sidebar icon also renders safely ------------------- */

const iconNode = side.component({ size: 18, active: true })
const iconSvg = typeof iconNode.type === 'function' ? iconNode.type(iconNode.props) : iconNode
assert.strictEqual(iconSvg.type, 'svg')
assert.strictEqual(iconSvg.props.width, 18)

/* ------------------------- dictionaries completeness ----------------------- */

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0 && end > start, 'markers found: ' + startMarker)
  return source.slice(start, end)
}

const dictsSource = slice('const DICTS = {', 'const JSON_ERROR_KEYS = {')
const DICTS = new Function(dictsSource.replace(/^const DICTS = /, 'return '))()
const locales = Object.keys(DICTS)
assert.deepStrictEqual(locales.sort(), ['en', 'zh'])

const usedKeys = new Set()
for (const match of source.matchAll(/\bt\('([a-zA-Z0-9._-]+)'/g)) usedKeys.add(match[1])
for (const match of source.matchAll(/'json\.err\.[a-zA-Z0-9]+'/g)) usedKeys.add(match[0].slice(1, -1))
for (const match of source.matchAll(/'json\.(idle|ok|valid|standard|formatted|minified)'/g)) usedKeys.add('json.' + match[1])
for (const match of source.matchAll(/'tab\.(time|json|random)'/g)) usedKeys.add('tab.' + match[1])

const missing = []
for (const key of usedKeys) {
  for (const locale of locales) {
    if (DICTS[locale][key] === undefined) missing.push(locale + ':' + key)
  }
}
if (missing.length) {
  console.error('Missing dictionary keys:\n  ' + missing.join('\n  '))
  process.exitCode = 1
} else {
  console.log('dictionary keys complete: ' + usedKeys.size + ' keys x ' + locales.length + ' locales')
}

/* ------------------------------ CSS token audit ---------------------------- */

const css = slice('const CSS = `', '`\n\n    /* ================================ icon')
const allowed = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
])
const usedTokens = new Set()
for (const match of css.matchAll(/var\((--[a-z0-9-]+)\)/g)) usedTokens.add(match[1])
const unknown = [...usedTokens].filter((token) => !allowed.has(token) && token !== '--dtb-mono')
assert.deepStrictEqual(unknown, [], 'only DSH theme tokens are used')
assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no hard-coded hex colors in CSS')

console.log('client bundle: ' + renderedNodes + ' components rendered, ' + usedTokens.size + ' theme tokens used')
console.log('OK')
