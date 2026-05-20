import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { loadRunnerHostAppConfig } from './config.js'
import { applyProviderOverride } from './index.js'
import { buildRunnerManifest } from './runtime.js'

function buildRealRunnerEnv(root: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    RUNNER_NODE_ID: 'runner-node',
    RUNNER_HOST_GROUP_ID: 'host-group',
    RUNNER_AUTH_TOKEN: 'runner-token',
    RUNNER_WORKSPACE_ROOT: path.join(root, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(root, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(root, 'artifacts'),
    RUNNER_MCP_CONFIG_HASH: 'config-hash',
    RUNNER_PROVIDERS: 'codex,claude',
    RUNNER_MCP_HOST_SERVERS: 'obsidian,context7',
    RUNNER_MCP_REPO_SERVERS: 'serena',
    RUNNER_MCP_EXCLUSIVE_SERVERS: 'custom-unsafe',
    CODEX_COMMAND: '',
    CLAUDE_CODE_COMMAND: '',
    CODEX_CLI_BIN: '',
    CLAUDE_CLI_BIN: '',
  }
}

test('provider override narrows the advertised provider set', () => {
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
  })

  const narrowed = applyProviderOverride(config, 'codex')
  const ignored = applyProviderOverride(config, 'not-a-provider')

  assert.deepEqual(narrowed.providers, ['codex'])
  assert.deepEqual(ignored.providers, config.providers)
  assert.deepEqual(config.providers, ['codex', 'claude'])
})

test('runner manifest only advertises backed providers and MCP servers in real mode', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-manifest-'))
  const config = loadRunnerHostAppConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    RUNNER_NODE_ID: 'runner-node',
    RUNNER_HOST_GROUP_ID: 'host-group',
    RUNNER_AUTH_TOKEN: 'runner-token',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_MCP_CONFIG_HASH: 'config-hash',
    RUNNER_PROVIDERS: 'codex,claude',
    RUNNER_MCP_HOST_SERVERS: 'obsidian,context7',
    RUNNER_MCP_REPO_SERVERS: 'serena',
    RUNNER_MCP_EXCLUSIVE_SERVERS: 'custom-unsafe',
    CODEX_COMMAND: '',
    CLAUDE_CODE_COMMAND: '',
    CODEX_CLI_BIN: '',
    CLAUDE_CLI_BIN: '',
  })

  const manifest = buildRunnerManifest(config)

  assert.deepEqual(manifest.providers, [])
  assert.deepEqual(manifest.mcpServerCatalog, [])

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host config normalizes repo-owned wrapper commands to absolute paths', () => {
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    CODEX_COMMAND: 'node dist/codex-adapter.js',
    CLAUDE_CODE_COMMAND: 'node dist/claude-adapter.js --flag',
    RUNNER_MCP_COMMANDS_JSON: JSON.stringify({
      serena: 'node dist/fake-mcp.js',
    }),
  })

  assert.match(
    config.commands.codex ?? '',
    /^node '.*apps\/runner-host\/dist\/codex-adapter\.js'$/,
  )
  assert.match(
    config.commands.claude ?? '',
    /^node '.*apps\/runner-host\/dist\/claude-adapter\.js' --flag$/,
  )
  assert.match(
    config.mcpCommandsByServer.serena ?? '',
    /^node '.*apps\/runner-host\/dist\/fake-mcp\.js'$/,
  )
})

test('real mode starts with empty managed skill availability and a dedicated cache root', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-skills-'))

  try {
    const config = loadRunnerHostAppConfig({
      ...buildRealRunnerEnv(sandboxRoot),
      RUNNER_SKILLS_AVAILABLE: 'legacy-skill',
    })

    assert.deepEqual(config.skillsAvailable, [])
    assert.equal(
      config.skillCacheRoot,
      path.join(config.workspaceRoot, '.runner-managed-skills'),
    )
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
})

test('fake mode keeps env-declared skills without filesystem verification', () => {
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_SKILLS_AVAILABLE: 'declared-only,missing-skill',
  })

  assert.deepEqual(config.skillsAvailable, ['declared-only', 'missing-skill'])
})
