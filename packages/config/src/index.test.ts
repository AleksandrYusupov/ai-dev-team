import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadControlApiConfig,
  loadKnowledgeSyncConfig,
  loadRunnerHostConfig,
  loadWorkflowWorkerConfig,
} from './index.js'

test('loadControlApiConfig applies defaults and requires database url', () => {
  const config = loadControlApiConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    LINEAR_WEBHOOK_SECRET: 'linear-secret',
    GITHUB_WEBHOOK_SECRET: 'github-secret',
  })

  assert.equal(config.serviceName, 'control-api')
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.port, 4000)
  assert.equal(config.database.poolMax, 10)
  assert.equal(config.internalApiBearerToken, 'test-internal-api-bearer-token')
  assert.deepEqual(config.runner.authTokensByNodeId, {})
  assert.equal(config.runner.longPollMaxWaitMs, 20_000)
  assert.equal(config.ingress.replayWindowMs, 60_000)
  assert.equal(config.ingress.maxPayloadBytes, 1_048_576)
  assert.equal(config.knowledge.contextPackMaxTokens, 16_000)
  assert.equal(config.knowledge.contextPackMaxComments, 10)
  assert.equal(config.knowledge.contextPackMaxNotes, 12)
  assert.deepEqual(config.integration.vendorDocsAllowlist, [])
  assert.equal(config.integration.secretService.backend, 'gcp_secret_manager')
  assert.equal(config.integration.secretService.gcpProjectId, null)
  assert.equal(
    config.integration.oauthService.publicCallbackBaseUrl,
    'http://127.0.0.1:4000/oauth/callback',
  )
  assert.equal(config.integration.oauthService.enforcePkce, true)
  assert.equal(config.integration.integrationLab.enabled, true)
  assert.equal(config.integration.integrationLab.maxProbeRequests, 5)
  assert.deepEqual(config.integration.integrationLab.allowedSandboxDomains, [])
})

test('loadWorkflowWorkerConfig uses temporal defaults', () => {
  const config = loadWorkflowWorkerConfig({
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
  })

  assert.equal(config.serviceName, 'workflow-worker')
  assert.equal(config.outbox.batchSize, 25)
  assert.equal(config.outbox.pollIntervalMs, 1_000)
  assert.equal(config.outbox.maxAttempts, 5)
  assert.equal(config.outbox.processingTimeoutMs, 30_000)
  assert.equal(config.inbox.batchSize, 25)
  assert.equal(config.inbox.pollIntervalMs, 1_000)
  assert.equal(config.inbox.maxAttempts, 5)
  assert.equal(config.inbox.replayWindowMs, 60_000)
  assert.equal(config.temporal.namespace, 'default')
  assert.equal(config.temporal.taskQueue, 'ai-dev-team')
  assert.deepEqual(config.integration.networkModesSupported, [
    'docs_allowlist',
    'sandbox_api_allowlist',
  ])
  assert.deepEqual(config.integration.allowedDocDomains, [])
  assert.equal(config.integration.supportsBrowserConsent, false)
  assert.equal(config.integration.supportsSecretBroker, false)
  assert.equal(config.integration.supportsOAuthBroker, false)
  assert.equal(config.integration.supportsIntegrationLab, false)
})

test('loadWorkflowWorkerConfig parses integration capability overrides', () => {
  const config = loadWorkflowWorkerConfig({
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    RUNNER_NETWORK_MODES_SUPPORTED:
      'docs_allowlist,sandbox_api_allowlist,release_broker_only',
    RUNNER_ALLOWED_DOC_DOMAINS: 'docs.vendor.test,api.vendor.test',
    RUNNER_ALLOWED_SANDBOX_DOMAINS: 'sandbox.vendor.test',
    RUNNER_SUPPORTS_BROWSER_CONSENT: 'true',
    RUNNER_SUPPORTS_SECRET_BROKER: 'true',
    RUNNER_SUPPORTS_OAUTH_BROKER: 'true',
    RUNNER_SUPPORTS_INTEGRATION_LAB: 'true',
  })

  assert.deepEqual(config.integration.networkModesSupported, [
    'docs_allowlist',
    'sandbox_api_allowlist',
    'release_broker_only',
  ])
  assert.deepEqual(config.integration.allowedDocDomains, [
    'docs.vendor.test',
    'api.vendor.test',
  ])
  assert.deepEqual(config.integration.allowedSandboxDomains, [
    'sandbox.vendor.test',
  ])
  assert.equal(config.integration.supportsBrowserConsent, true)
  assert.equal(config.integration.supportsSecretBroker, true)
  assert.equal(config.integration.supportsOAuthBroker, true)
  assert.equal(config.integration.supportsIntegrationLab, true)
})

test('loadControlApiConfig throws when DATABASE_URL is missing', () => {
  assert.throws(
    () =>
      loadControlApiConfig({
        LINEAR_WEBHOOK_SECRET: 'linear-secret',
        GITHUB_WEBHOOK_SECRET: 'github-secret',
      }),
    /DATABASE_URL/,
  )
})

test('loadControlApiConfig requires webhook secrets', () => {
  assert.throws(
    () =>
      loadControlApiConfig({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
        INTERNAL_API_BEARER_TOKEN: 'control-api-token',
      }),
    /LINEAR_WEBHOOK_SECRET/,
  )
})

test('loadControlApiConfig requires internal bearer token in non-test environments', () => {
  assert.throws(
    () =>
      loadControlApiConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
        LINEAR_WEBHOOK_SECRET: 'linear-secret',
        GITHUB_WEBHOOK_SECRET: 'github-secret',
      }),
    /INTERNAL_API_BEARER_TOKEN/,
  )
})

test('loadKnowledgeSyncConfig reads trusted local sync settings', () => {
  const config = loadKnowledgeSyncConfig({
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    KNOWLEDGE_SYNC_VAULT_ROOT: '/tmp/knowledge-vault',
  })

  assert.equal(config.vaultRoot, '/tmp/knowledge-vault')
  assert.equal(config.batchSize, 100)
  assert.equal(config.maxNoteBytes, 131_072)
})

test('loadKnowledgeSyncConfig requires vault root', () => {
  assert.throws(
    () =>
      loadKnowledgeSyncConfig({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
      }),
    /KNOWLEDGE_SYNC_VAULT_ROOT/,
  )
})

test('loadControlApiConfig parses runner-host auth token mapping', () => {
  const config = loadControlApiConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    LINEAR_WEBHOOK_SECRET: 'linear-secret',
    GITHUB_WEBHOOK_SECRET: 'github-secret',
    RUNNER_AUTH_TOKENS_JSON: JSON.stringify({
      codex_runner: 'codex-token',
      claude_runner: 'claude-token',
    }),
    RUNNER_LONG_POLL_MAX_WAIT_MS: '25000',
  })

  assert.deepEqual(config.runner.authTokensByNodeId, {
    codex_runner: 'codex-token',
    claude_runner: 'claude-token',
  })
  assert.equal(config.runner.longPollMaxWaitMs, 25_000)
})

test('loadRunnerHostConfig parses runner-host defaults and capabilities', () => {
  const config = loadRunnerHostConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    RUNNER_NODE_ID: 'codex-runner-1',
    RUNNER_HOST_GROUP_ID: 'local-dev',
    RUNNER_AUTH_TOKEN: 'runner-token',
    RUNNER_WORKSPACE_ROOT: '/tmp/workspace',
    RUNNER_WORKTREE_ROOT: '/tmp/worktrees',
    RUNNER_ARTIFACT_ROOT: '/tmp/artifacts',
    RUNNER_PROVIDERS: 'codex,claude',
    RUNNER_MCP_CONFIG_HASH: 'config-hash',
    RUNNER_MCP_HOST_SERVERS: 'obsidian,context7',
    RUNNER_MCP_REPO_SERVERS: 'serena',
    RUNNER_MCP_EXCLUSIVE_SERVERS: 'custom-unsafe',
    RUNNER_NETWORK_MODES_SUPPORTED:
      'docs_allowlist,sandbox_api_allowlist,release_broker_only',
    RUNNER_ALLOWED_DOC_DOMAINS: 'docs.vendor.test,api.vendor.test',
    RUNNER_ALLOWED_SANDBOX_DOMAINS: 'sandbox.vendor.test',
    RUNNER_SUPPORTS_BROWSER_CONSENT: 'true',
    RUNNER_SUPPORTS_SECRET_BROKER: 'true',
    RUNNER_SUPPORTS_OAUTH_BROKER: 'true',
    RUNNER_SUPPORTS_INTEGRATION_LAB: 'true',
    CODEX_COMMAND: 'codex',
    CLAUDE_CODE_COMMAND: 'claude',
    CODEX_CLI_BIN: 'codex-bin',
    CLAUDE_CLI_BIN: 'claude-bin',
    RUNNER_MCP_COMMANDS_JSON: JSON.stringify({
      serena: 'node -e "console.log(\'serena\')"',
      obsidian: 'node -e "console.log(\'obsidian\')"',
    }),
  })

  assert.equal(config.serviceName, 'runner-host')
  assert.equal(config.controlApiBaseUrl, 'http://127.0.0.1:4000')
  assert.equal(config.pollTimeoutMs, 20_000)
  assert.equal(config.heartbeatIntervalMs, 15_000)
  assert.equal(config.heartbeatExpiryMs, 45_000)
  assert.equal(config.maxConcurrentLeases, 1)
  assert.deepEqual(config.providers, ['codex', 'claude'])
  assert.deepEqual(config.mcpHostServers, ['obsidian', 'context7'])
  assert.deepEqual(config.mcpRepoServers, ['serena'])
  assert.deepEqual(config.mcpExclusiveServers, ['custom-unsafe'])
  assert.deepEqual(config.integration.networkModesSupported, [
    'docs_allowlist',
    'sandbox_api_allowlist',
    'release_broker_only',
  ])
  assert.deepEqual(config.integration.allowedDocDomains, [
    'docs.vendor.test',
    'api.vendor.test',
  ])
  assert.deepEqual(config.integration.allowedSandboxDomains, [
    'sandbox.vendor.test',
  ])
  assert.equal(config.integration.supportsBrowserConsent, true)
  assert.equal(config.integration.supportsSecretBroker, true)
  assert.equal(config.integration.supportsOAuthBroker, true)
  assert.equal(config.integration.supportsIntegrationLab, true)
  assert.deepEqual(config.providerCliBins, {
    codex: 'codex-bin',
    claude: 'claude-bin',
  })
  assert.equal(config.commands.codex, 'codex')
  assert.equal(config.commands.claude, 'claude')
  assert.deepEqual(config.mcpCommandsByServer, {
    serena: 'node -e "console.log(\'serena\')"',
    obsidian: 'node -e "console.log(\'obsidian\')"',
  })
  assert.deepEqual(config.supportedRunKinds, [
    'build',
    'review',
    'deploy',
    'rework_cycle',
  ])
  assert.deepEqual(config.toolBaseline, [
    'serena',
    'sequential-thinking',
    'obsidian',
    'context7',
    'github',
    'git',
    'filesystem',
    'linear',
    'postgres',
    'fetch',
    'memory',
  ])
})
