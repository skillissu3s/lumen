import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSrcdoc } from './frame.js'

const manifest = { id: 't', entry: 'index.html' }

test('inlines local scripts and styles, drops external ones', () => {
  const files = {
    'index.html': '<html><head><link rel="stylesheet" href="style.css"><script src="main.js"></script><script src="https://cdn.example/x.js"></script></head><body></body></html>',
    'style.css': 'body { color: red }',
    'main.js': 'window.x = 1',
  }
  const out = buildSrcdoc({ manifest, files })
  assert.ok(out.includes('<style>body { color: red }</style>'))
  assert.ok(out.includes('<script>window.x = 1</script>'))
  assert.ok(!out.includes('cdn.example'))
})

test('keeps inline scripts and strips dev scripts', () => {
  const files = {
    'index.html': '<html><head><script src="../_dev/mock-lumen.js" data-lumen-dev></script><script>window.y = 2</script></head><body></body></html>',
  }
  const out = buildSrcdoc({ manifest, files })
  assert.ok(!out.includes('mock-lumen'))
  assert.ok(out.includes('window.y = 2'))
})

test('CSP allows network only with the network permission', () => {
  const files = { 'index.html': '<html><head></head><body></body></html>' }
  const without = buildSrcdoc({ manifest, files, permissions: [] })
  const withNet = buildSrcdoc({ manifest, files, permissions: ['network'] })
  assert.ok(without.includes("connect-src 'none'"))
  assert.ok(withNet.includes('connect-src https:'))
  assert.ok(!withNet.includes("connect-src 'none'"))
})

test('a body script without src is preserved in place', () => {
  const files = {
    'index.html': '<html><head></head><body><div id="app"></div><script src="charts.js"></script><script src="main.js"></script></body></html>',
    'charts.js': 'var Charts = 1',
    'main.js': 'var Main = 2',
  }
  const out = buildSrcdoc({ manifest, files })
  assert.ok(out.indexOf('<div id="app">') < out.indexOf('var Charts = 1'))
  assert.ok(out.indexOf('var Charts = 1') < out.indexOf('var Main = 2'))
})

test('starter plugins transform into a srcdoc without errors', () => {
  for (const dir of ['focus-forest', 'usage-monitor']) {
    const base = new URL(`../../../plugins/${dir}/`, import.meta.url)
    const read = (name) => readFileSync(new URL(name, base), 'utf8')
    const m = JSON.parse(read('manifest.json'))
    const files = {}
    for (const name of m.files) files[name] = read(name)
    const out = buildSrcdoc({ manifest: m, files, permissions: m.permissions })
    assert.ok(out.includes('window.lumen'), `${dir}: SDK is present`)
    assert.ok(out.includes('<style>'), `${dir}: styles inlined`)
    assert.ok(!out.includes('mock-lumen'), `${dir}: dev script stripped`)
    assert.ok(out.includes('<meta http-equiv="Content-Security-Policy"'), `${dir}: CSP present`)
  }
})
