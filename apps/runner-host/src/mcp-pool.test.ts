import assert from 'node:assert/strict'
import test from 'node:test'

import { loadRunnerHostAppConfig } from './config.js'
import { McpPoolManager } from './mcp-pool.js'

test('MCP pool reuses shared bindings across sessions and releases them cleanly', () => {
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
  })
  const pool = new McpPoolManager(config)
  const requested = [
    {
      serverName: 'serena',
      sharingScope: 'repo' as const,
      bindingKey: 'serena',
      reused: false,
      repoSlug: 'acme/repo',
    },
    {
      serverName: 'obsidian',
      sharingScope: 'host' as const,
      bindingKey: 'obsidian',
      reused: false,
      repoSlug: null,
    },
    {
      serverName: 'custom',
      sharingScope: 'exclusive' as const,
      bindingKey: 'custom',
      reused: false,
      repoSlug: null,
    },
  ]

  const first = pool.acquireBindings(requested, {
    executionSessionKey: 'session-1',
    repoSlug: 'acme/repo',
    configHash: 'cfg',
  })
  const second = pool.acquireBindings(requested, {
    executionSessionKey: 'session-2',
    repoSlug: 'acme/repo',
    configHash: 'cfg',
  })

  assert.equal(first[0]?.reused, false)
  assert.equal(second[0]?.reused, true)
  assert.equal(first[0]?.bindingKey, second[0]?.bindingKey)
  assert.equal(first[1]?.bindingKey, second[1]?.bindingKey)
  assert.notEqual(first[2]?.bindingKey, second[2]?.bindingKey)
  assert.equal(pool.snapshot().length, 4)
  assert.equal(pool.snapshotDetailed().bindings.length, 4)

  pool.releaseExecutionSession('session-1')
  assert.equal(pool.snapshot().length, 3)

  pool.releaseExecutionSession('session-2')
  assert.equal(pool.snapshot().length, 0)
})

test('MCP pool keeps one repo-shared serena runtime across many sessions on the same repo', () => {
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
  })
  const pool = new McpPoolManager(config)
  const requested = [
    {
      serverName: 'serena',
      sharingScope: 'repo' as const,
      bindingKey: 'serena',
      reused: false,
      repoSlug: 'acme/repo',
    },
    {
      serverName: 'obsidian',
      sharingScope: 'host' as const,
      bindingKey: 'obsidian',
      reused: false,
      repoSlug: null,
    },
  ]

  for (let index = 1; index <= 10; index += 1) {
    pool.acquireBindings(requested, {
      executionSessionKey: `session-${index}`,
      repoSlug: 'acme/repo',
      configHash: 'cfg',
    })
  }

  const snapshot = pool.snapshot()
  assert.equal(snapshot.filter((binding) => binding.serverName === 'serena').length, 1)
  assert.equal(snapshot.filter((binding) => binding.serverName === 'obsidian').length, 1)
  assert.ok(
    pool
      .snapshotDetailed()
      .bindings.every((binding) => binding.processState === 'starting' || binding.processState === 'running'),
  )

  for (let index = 1; index <= 10; index += 1) {
    pool.releaseExecutionSession(`session-${index}`)
  }

  assert.equal(pool.snapshot().length, 0)
})
