import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveWikiLinks,
  summarizeMarkdown,
  type VaultIndex,
} from './knowledge-sync.js'

test('resolveWikiLinks prefers current-directory matches, then unique basename fallback', () => {
  const vaultIndex: VaultIndex = {
    notePaths: new Set([
      'ai_dev_team/notes/links/current.md',
      'ai_dev_team/notes/links/sibling.md',
      'ai_dev_team/notes/elsewhere/sibling.md',
      'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
      'ai_dev_team/reference/unique-note.md',
      'ai_dev_team/notes/links/ambiguous.md',
      'helpers/ambiguous.md',
    ]),
    basenames: new Map([
      ['current', ['ai_dev_team/notes/links/current.md']],
      ['sibling', [
        'ai_dev_team/notes/links/sibling.md',
        'ai_dev_team/notes/elsewhere/sibling.md',
      ]],
      ['06_repository_registry_and_context_pack_spec', [
        'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
      ]],
      ['unique-note', ['ai_dev_team/reference/unique-note.md']],
      ['ambiguous', [
        'ai_dev_team/notes/links/ambiguous.md',
        'helpers/ambiguous.md',
      ]],
    ]),
  }

  const markdown = `
See [[sibling]], [[ai_dev_team/architecture/06_repository_registry_and_context_pack_spec]], [[unique-note]], [[ambiguous]].
`

  assert.deepEqual(
    resolveWikiLinks(markdown, 'ai_dev_team/notes/links/current.md', vaultIndex),
    [
      'ai_dev_team/notes/links/sibling.md',
      'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
      'ai_dev_team/reference/unique-note.md',
      'ai_dev_team/notes/links/ambiguous.md',
    ],
  )
})

test('resolveWikiLinks drops unresolved relative links', () => {
  const vaultIndex: VaultIndex = {
    notePaths: new Set(['ai_dev_team/notes/current.md']),
    basenames: new Map([['current', ['ai_dev_team/notes/current.md']]]),
  }

  assert.deepEqual(
    resolveWikiLinks(
      'See [[missing]] and [[/also-missing]].',
      'ai_dev_team/notes/current.md',
      vaultIndex,
    ),
    [],
  )
})

test('resolveWikiLinks resolves short links by unique basename when directory match is absent', () => {
  const vaultIndex: VaultIndex = {
    notePaths: new Set([
      'ai_dev_team/notes/current.md',
      'ai_dev_team/reference/standalone.md',
    ]),
    basenames: new Map([
      ['current', ['ai_dev_team/notes/current.md']],
      ['standalone', ['ai_dev_team/reference/standalone.md']],
    ]),
  }

  assert.deepEqual(
    resolveWikiLinks(
      'See [[standalone]] from elsewhere.',
      'ai_dev_team/notes/current.md',
      vaultIndex,
    ),
    ['ai_dev_team/reference/standalone.md'],
  )
})

test('resolveWikiLinks drops ambiguous basename fallback when no local match exists', () => {
  const vaultIndex: VaultIndex = {
    notePaths: new Set([
      'ai_dev_team/notes/current.md',
      'ai_dev_team/reference/ambiguous.md',
      'helpers/ambiguous.md',
    ]),
    basenames: new Map([
      ['current', ['ai_dev_team/notes/current.md']],
      ['ambiguous', [
        'ai_dev_team/reference/ambiguous.md',
        'helpers/ambiguous.md',
      ]],
    ]),
  }

  assert.deepEqual(
    resolveWikiLinks(
      'See [[ambiguous]] from elsewhere.',
      'ai_dev_team/notes/current.md',
      vaultIndex,
    ),
    [],
  )
})

test('summarizeMarkdown strips frontmatter and returns a compact summary', () => {
  const summary = summarizeMarkdown(`---
goal: Test
---

# Header

This is the first paragraph.

This is the second paragraph.
`)

  assert.equal(summary, '# Header This is the first paragraph. This is the second paragraph.')
})
