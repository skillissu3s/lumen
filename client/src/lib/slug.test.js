import test from 'node:test'
import assert from 'node:assert/strict'
import { slugify, uniquePath } from './slug.js'

test('slugify', () => {
  assert.equal(slugify('Groceries List'), 'groceries-list')
  assert.equal(slugify('  Hello, World!!!  '), 'hello-world')
  assert.equal(slugify(''), 'untitled')
  assert.equal(slugify('---'), 'untitled')
  assert.equal(slugify('Café'), 'cafe')
  assert.equal(slugify('UPPER Case').includes('U'), false)
  assert.equal(slugify('a'.repeat(100)).length, 48)
})

test('uniquePath', () => {
  assert.equal(uniquePath('lists', 'groceries', 'md', []), 'lists/groceries.md')
  assert.equal(uniquePath('lists', 'groceries', 'md', ['lists/groceries.md']), 'lists/groceries-2.md')
  assert.equal(uniquePath('lists', 'groceries', 'md', ['lists/groceries.md', 'lists/groceries-2.md']), 'lists/groceries-3.md')
})
