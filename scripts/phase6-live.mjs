#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const liveTestPath = 'apps/workflow-worker/dist/phase6-live.integration.test.js'

const requiredEnvKeys = [
  'DATABASE_URL',
  'TEMPORAL_SERVER_ADDRESS',
  'TEMPORAL_NAMESPACE',
  'TEMPORAL_TASK_QUEUE',
  'CONTROL_API_PORT',
  'INTERNAL_API_BEARER_TOKEN',
  'LINEAR_WEBHOOK_SECRET',
  'GITHUB_WEBHOOK_SECRET',
  'RUNNER_AUTH_TOKENS_JSON',
  'RUNNER_NODE_ID',
  'RUNNER_AUTH_TOKEN',
  'RUNNER_HOST_GROUP_ID',
  'RUNNER_WORKSPACE_ROOT',
  'RUNNER_WORKTREE_ROOT',
  'RUNNER_ARTIFACT_ROOT',
  'RUNNER_MCP_CONFIG_HASH',
  'RUNNER_MCP_HOST_SERVERS',
  'RUNNER_MCP_REPO_SERVERS',
  'RUNNER_MCP_EXCLUSIVE_SERVERS',
  'RUNNER_MCP_COMMANDS_JSON',
]
const allowEmptyEnvKeys = new Set([
  'RUNNER_MCP_EXCLUSIVE_SERVERS',
])
const readinessTimeoutMs = 120_000

const spawnedChildren = []
let shuttingDown = false

loadPhase6EnvFiles()

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function loadPhase6EnvFiles() {
  for (const fileName of ['.env.local', '.env']) {
    loadEnvFile(path.join(rootDir, fileName))
  }
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return
  }

  const raw = readFileSync(filePath, 'utf8')

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trimStart()
      : trimmed
    const equalsIndex = normalized.indexOf('=')

    if (equalsIndex <= 0) {
      continue
    }

    const key = normalized.slice(0, equalsIndex).trim()
    const existing = process.env[key]

    if (existing != null && existing.trim()) {
      continue
    }

    const value = parseEnvValue(normalized.slice(equalsIndex + 1))
    process.env[key] = value
  }
}

function parseEnvValue(rawValue) {
  const withoutComment = stripInlineEnvComment(rawValue.trim())

  if (withoutComment.length >= 2) {
    const quote = withoutComment[0]

    if (
      (quote === '"' || quote === "'") &&
      withoutComment.endsWith(quote)
    ) {
      const inner = withoutComment.slice(1, -1)

      if (quote === "'") {
        return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
      }

      return inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    }
  }

  return withoutComment
}

function stripInlineEnvComment(value) {
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (
      char === '#' &&
      !inSingleQuote &&
      !inDoubleQuote &&
      index > 0 &&
      /\s/.test(value[index - 1] ?? '')
    ) {
      return value.slice(0, index).trimEnd()
    }
  }

  return value.trimEnd()
}

function requireEnv(key) {
  const value = process.env[key]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value
}

function optionalEnv(key) {
  const value = process.env[key]?.trim()

  return value && value.length > 0 ? value : null
}

function requireCommand(command, label) {
  const result = spawnSync('/bin/sh', ['-lc', `command -v ${shellQuote(command)}`], {
    cwd: rootDir,
    stdio: 'ignore',
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`Missing required CLI for ${label}: ${command}`)
  }
}

function isAdapterCommand(command, adapterStem) {
  return command.includes(`${adapterStem}.js`)
}

function isNamedCli(binary, commandName) {
  const normalized = path.basename(extractCommandBinary(binary) ?? binary)
  return normalized === commandName
}

function resolveProviderExecutionConfig(provider) {
  const commandKey = provider === 'codex' ? 'CODEX_COMMAND' : 'CLAUDE_CODE_COMMAND'
  const cliBinKey = provider === 'codex' ? 'CODEX_CLI_BIN' : 'CLAUDE_CLI_BIN'
  const adapterStem = provider === 'codex' ? 'codex-adapter' : 'claude-adapter'
  const command = optionalEnv(commandKey)
  const cliBin = optionalEnv(cliBinKey)
  const effectiveCommand = command ?? cliBin

  if (!effectiveCommand) {
    throw new Error(
      `Missing provider command for ${provider}: set ${commandKey} or ${cliBinKey}`,
    )
  }

  const effectiveBinary = extractCommandBinary(effectiveCommand)

  if (!effectiveBinary) {
    throw new Error(`Unable to resolve executable for ${provider} provider command`)
  }

  if (command && isAdapterCommand(command, adapterStem) && !cliBin) {
    throw new Error(
      `${cliBinKey} is required when ${commandKey} uses the repo-owned ${adapterStem}.js wrapper`,
    )
  }

  return {
    commandKey,
    cliBinKey,
    command,
    cliBin,
    effectiveCommand,
    effectiveBinary,
    adapterStem,
  }
}

function resolveProviderAccessProbe(providerConfig, provider) {
  if (providerConfig.cliBin && isNamedCli(providerConfig.cliBin, provider)) {
    return providerConfig.cliBin
  }

  if (isNamedCli(providerConfig.effectiveBinary, provider)) {
    return providerConfig.effectiveBinary
  }

  return null
}

function resolveProofRoot(baseRoot, hostName, overrideKey) {
  const override = process.env[overrideKey]?.trim()

  if (override) {
    return path.resolve(override)
  }

  return path.resolve(baseRoot, hostName)
}

function resolveProofRoots() {
  const baseWorkspaceRoot = requireEnv('RUNNER_WORKSPACE_ROOT')
  const baseWorktreeRoot = requireEnv('RUNNER_WORKTREE_ROOT')
  const baseArtifactRoot = requireEnv('RUNNER_ARTIFACT_ROOT')
  const codexRoots = {
    workspaceRoot: resolveProofRoot(
      baseWorkspaceRoot,
      'codex',
      'PHASE6_LIVE_CODEX_WORKSPACE_ROOT',
    ),
    worktreeRoot: resolveProofRoot(
      baseWorktreeRoot,
      'codex',
      'PHASE6_LIVE_CODEX_WORKTREE_ROOT',
    ),
    artifactRoot: resolveProofRoot(
      baseArtifactRoot,
      'codex',
      'PHASE6_LIVE_CODEX_ARTIFACT_ROOT',
    ),
  }
  const claudeRoots = {
    workspaceRoot: resolveProofRoot(
      baseWorkspaceRoot,
      'claude',
      'PHASE6_LIVE_CLAUDE_WORKSPACE_ROOT',
    ),
    worktreeRoot: resolveProofRoot(
      baseWorktreeRoot,
      'claude',
      'PHASE6_LIVE_CLAUDE_WORKTREE_ROOT',
    ),
    artifactRoot: resolveProofRoot(
      baseArtifactRoot,
      'claude',
      'PHASE6_LIVE_CLAUDE_ARTIFACT_ROOT',
    ),
  }

  for (const key of ['workspaceRoot', 'worktreeRoot', 'artifactRoot']) {
    if (codexRoots[key] === claudeRoots[key]) {
      throw new Error(
        `Codex and Claude proof hosts must use distinct ${key} values`,
      )
    }
  }

  return { codexRoots, claudeRoots }
}

function parseCsvEnv(key) {
  return (process.env[key] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function parseRunnerMcpCommands() {
  const raw = requireEnv('RUNNER_MCP_COMMANDS_JSON')

  try {
    const parsed = JSON.parse(raw)

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object')
    }

    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`RUNNER_MCP_COMMANDS_JSON must be valid JSON: ${message}`)
  }
}

function extractCommandBinary(command) {
  const trimmed = command.trim()

  if (!trimmed) {
    return null
  }

  const quoted = trimmed.match(/^"([^"]+)"/) ?? trimmed.match(/^'([^']+)'/)

  if (quoted) {
    return quoted[1]
  }

  return trimmed.split(/\s+/, 1)[0] ?? null
}

async function importPhase6RuntimeModules() {
  const [
    dbModule,
    configModule,
    workflowModule,
  ] = await Promise.all([
    import(new URL('../packages/db/dist/index.js', import.meta.url)),
    import(new URL('../packages/config/dist/index.js', import.meta.url)),
    import(
      new URL(
        '../apps/workflow-worker/dist/application/workflow/apply-transition.js',
        import.meta.url,
      )
    ),
  ])

  return {
    createDb: dbModule.createDb,
    loadWorkflowManifestBundle: dbModule.loadWorkflowManifestBundle,
    publishWorkflowConfig: dbModule.publishWorkflowConfig,
    upsertLifecycleCommand: dbModule.upsertLifecycleCommand,
    loadDatabaseConfig: configModule.loadDatabaseConfig,
    bootstrapIssueRuntimeState: workflowModule.bootstrapIssueRuntimeState,
  }
}

async function waitForCondition(label, predicate, timeoutMs = readinessTimeoutMs, intervalMs = 1_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return
    }

    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for ${label}`)
}

function buildReadinessProbeLifecycleCommand(issueId) {
  const occurredAt = new Date().toISOString()

  return {
    schemaVersion: 1,
    commandKey: `phase6-readiness-lifecycle:${issueId}`,
    issueId,
    workflowId: `issue:${issueId}`,
    signalName: 'ingestSystemCommand',
    source: 'system',
    sourceRef: `phase6-readiness:${issueId}`,
    occurredAt,
    actorType: 'system',
    actorId: 'phase6-live-readiness-probe',
    triggerCode: 'system_contract_built',
    requestedStatusCode: null,
    commentId: null,
    reasonCode: null,
    reasonText: null,
    checkpointId: null,
    leaseId: null,
    blockedByIssueIds: [],
    guardOutcomes: {
      contract_complete: true,
      primary_repo_resolved: true,
      blockers_inspected: true,
    },
    canonicalEventId: null,
    metadata: {},
    artifacts: [
      {
        artifactType: 'issue_contract_snapshot',
        artifactScope: 'issue',
        artifactUri: `artifact://phase6-readiness/${issueId}/contract`,
      },
    ],
  }
}

function buildReadinessProbeOutboxPayload(issueId, workflowId, transitionAuditId, configVersion) {
  const commandKey = `phase6-readiness-outbox:${issueId}`

  return {
    commandKey,
    commandType: 'post_linear_comment',
    issueId,
    runId: null,
    workflowId,
    transitionAuditId,
    configVersion,
    body: {
      probe: true,
    },
    issuedAt: new Date().toISOString(),
    schemaVersion: 1,
  }
}

async function waitForRunnerManifestReadiness(db, input) {
  await waitForCondition('runner manifest publication', async () => {
    const manifests = await db
      .selectFrom('runner_capabilities')
      .select([
        'runner_node_id',
        'workspace_root',
        'worktree_root',
        'is_active',
      ])
      .where('runner_node_id', 'in', [
        input.codexRunnerNodeId,
        input.claudeRunnerNodeId,
      ])
      .where('is_active', '=', true)
      .execute()

    const codexManifest = manifests.find((row) => row.runner_node_id === input.codexRunnerNodeId)
    const claudeManifest = manifests.find((row) => row.runner_node_id === input.claudeRunnerNodeId)

    return Boolean(
      codexManifest &&
        codexManifest.workspace_root === input.codexRoots.workspaceRoot &&
        codexManifest.worktree_root === input.codexRoots.worktreeRoot &&
        claudeManifest &&
        claudeManifest.workspace_root === input.claudeRoots.workspaceRoot &&
        claudeManifest.worktree_root === input.claudeRoots.worktreeRoot,
    )
  })
}

async function runAsyncReadinessProbe(db, modules) {
  const issueId = `ISSUE-PHASE6-READY-${Date.now().toString()}`
  const workflowId = `issue:${issueId}`

  const bundle = await modules.loadWorkflowManifestBundle()
  await modules.publishWorkflowConfig(db, bundle, {
    publishedBy: 'phase6-live-readiness',
  })

  await modules.bootstrapIssueRuntimeState(db, {
    issueId,
    workflowId,
    actorId: 'phase6-live-readiness',
    rawIssueArtifactUri: `linear://${issueId}`,
    metadata: {
      highRisk: false,
    },
  })

  await modules.upsertLifecycleCommand(
    db,
    buildReadinessProbeLifecycleCommand(issueId),
  )

  await waitForCondition('workflow-worker lifecycle dispatch', async () => {
    const runtimeState = await db
      .selectFrom('issue_runtime_state')
      .select(['current_status_code'])
      .where('issue_id', '=', issueId)
      .executeTakeFirst()

    return runtimeState?.current_status_code === 'planned'
  })

  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['pinned_config_version'])
    .where('issue_id', '=', issueId)
    .executeTakeFirst()

  if (!runtimeState) {
    throw new Error(`Readiness probe issue runtime state missing for ${issueId}`)
  }

  const transitionAudit = await db
    .selectFrom('status_transition_audit')
    .select(['id'])
    .where('issue_id', '=', issueId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  if (!transitionAudit) {
    throw new Error(`Readiness probe transition audit missing for ${issueId}`)
  }

  const outboxPayload = buildReadinessProbeOutboxPayload(
    issueId,
    workflowId,
    transitionAudit.id,
    runtimeState.pinned_config_version,
  )

  await db
    .insertInto('workflow_effect_outbox')
    .values({
      transition_audit_id: transitionAudit.id,
      issue_id: issueId,
      run_id: null,
      command_type: 'post_linear_comment',
      command_payload: outboxPayload,
      idempotency_key: outboxPayload.commandKey,
    })
    .execute()

  await waitForCondition('outbox executor readiness probe', async () => {
    const outboxRow = await db
      .selectFrom('workflow_effect_outbox')
      .select(['status', 'last_error'])
      .where('idempotency_key', '=', outboxPayload.commandKey)
      .executeTakeFirst()

    if (!outboxRow) {
      return false
    }

    if (outboxRow.status === 'dead_letter') {
      throw new Error(
        `Readiness probe outbox command dead-lettered: ${outboxRow.last_error ?? 'unknown error'}`,
      )
    }

    return outboxRow.status === 'done'
  })
}

async function waitForLiveHarnessReadiness(db, modules, input) {
  await waitForRunnerManifestReadiness(db, input)
  await runAsyncReadinessProbe(db, modules)
}

function validateMcpCommandMap() {
  const commandMap = parseRunnerMcpCommands()
  const configuredServers = new Set([
    ...parseCsvEnv('RUNNER_MCP_HOST_SERVERS'),
    ...parseCsvEnv('RUNNER_MCP_REPO_SERVERS'),
    ...parseCsvEnv('RUNNER_MCP_EXCLUSIVE_SERVERS'),
  ])

  for (const serverName of configuredServers) {
    const command = typeof commandMap[serverName] === 'string'
      ? commandMap[serverName].trim()
      : ''

    if (!command) {
      throw new Error(
        `RUNNER_MCP_COMMANDS_JSON does not define a command for configured MCP server ${serverName}`,
      )
    }

    const binary = extractCommandBinary(command)

    if (!binary) {
      throw new Error(`Unable to resolve executable for MCP server ${serverName}`)
    }

    requireCommand(binary, `MCP server ${serverName}`)
  }
}

function resolveCodexAuthSourcePath() {
  const explicitHome = process.env.CODEX_HOME?.trim()

  if (explicitHome) {
    return path.join(explicitHome, 'auth.json')
  }

  const home = process.env.HOME?.trim()

  if (home) {
    return path.join(home, '.codex', 'auth.json')
  }

  return null
}

function verifyCodexAccess(codexCliBin) {
  const probeDir = mkdtempSync(path.join(tmpdir(), 'phase6-live-codex-'))
  const isolatedHome = path.join(probeDir, '.codex')
  const outputFile = path.join(probeDir, 'codex-last-message.txt')
  mkdirSync(isolatedHome, { recursive: true })

  const authSource = resolveCodexAuthSourcePath()

  if (authSource && existsSync(authSource)) {
    copyFileSync(authSource, path.join(isolatedHome, 'auth.json'))
  }

  const result = spawnSync(
    codexCliBin,
    [
      'exec',
      '--skip-git-repo-check',
      '--cd',
      rootDir,
      '--sandbox',
      'read-only',
      '--output-last-message',
      outputFile,
      'Reply with exactly OK.',
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        HOME: probeDir,
        CODEX_HOME: isolatedHome,
      },
      encoding: 'utf8',
      timeout: 300_000,
    },
  )

  try {
    if (result.error) {
      throw result.error
    }

    if (result.status !== 0) {
      throw new Error(
        `Codex CLI auth/access check failed: ${result.stderr || result.stdout || `exit ${result.status}`}`,
      )
    }

    const output = readFileSync(outputFile, 'utf8').trim()

    if (output !== 'OK') {
      throw new Error(`Codex CLI auth/access check returned ${JSON.stringify(output)}`)
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

function verifyClaudeAccess(claudeCliBin) {
  const result = spawnSync(
    claudeCliBin,
    ['--print', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--', 'Reply with exactly OK.'],
    {
      cwd: rootDir,
      env: process.env,
      encoding: 'utf8',
      timeout: 120_000,
    },
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `Claude CLI auth/access check failed: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    )
  }

  if (!/\bOK\b/.test((result.stdout ?? '').trim())) {
    throw new Error('Claude CLI auth/access check did not return OK')
  }
}

function parseRunnerAuthTokens() {
  const raw = requireEnv('RUNNER_AUTH_TOKENS_JSON')

  try {
    const parsed = JSON.parse(raw)

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object')
    }

    return parsed
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)

    throw new Error(`RUNNER_AUTH_TOKENS_JSON must be valid JSON: ${message}`)
  }
}

function collectMissingEnvKeys(keys) {
  return keys.filter((key) => {
    if (!(key in process.env)) {
      return true
    }

    if (allowEmptyEnvKeys.has(key)) {
      return false
    }

    return !process.env[key]?.trim()
  })
}

function validatePrereqs() {
  const missingKeys = collectMissingEnvKeys(requiredEnvKeys)

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(', ')}`,
    )
  }

  const codexProvider = resolveProviderExecutionConfig('codex')
  const claudeProvider = resolveProviderExecutionConfig('claude')
  const authTokens = parseRunnerAuthTokens()
  const codexRunnerNodeId = requireEnv('RUNNER_NODE_ID')
  const codexRunnerToken = requireEnv('RUNNER_AUTH_TOKEN')
  const claudeRunnerNodeId =
    process.env.PHASE6_LIVE_CLAUDE_RUNNER_NODE_ID?.trim() || 'claude-runner-1'
  const claudeRunnerToken =
    process.env.PHASE6_LIVE_CLAUDE_RUNNER_AUTH_TOKEN?.trim() || 'claude-runner-token'

  if (authTokens[codexRunnerNodeId] !== codexRunnerToken) {
    throw new Error(
      `RUNNER_AUTH_TOKENS_JSON does not contain the codex runner token for ${codexRunnerNodeId}`,
    )
  }

  if (authTokens[claudeRunnerNodeId] !== claudeRunnerToken) {
    throw new Error(
      `RUNNER_AUTH_TOKENS_JSON does not contain the claude runner token for ${claudeRunnerNodeId}`,
    )
  }

  validateMcpCommandMap()
  requireCommand(codexProvider.effectiveBinary, 'codex provider command')
  requireCommand(claudeProvider.effectiveBinary, 'claude provider command')
  if (codexProvider.cliBin) {
    requireCommand(codexProvider.cliBin, 'codex binary')
  }
  if (claudeProvider.cliBin) {
    requireCommand(claudeProvider.cliBin, 'claude binary')
  }
  requireCommand('corepack', 'corepack')
  const codexProbe = resolveProviderAccessProbe(codexProvider, 'codex')
  const claudeProbe = resolveProviderAccessProbe(claudeProvider, 'claude')

  if (codexProbe) {
    verifyCodexAccess(codexProbe)
  }

  if (claudeProbe) {
    verifyClaudeAccess(claudeProbe)
  }

  return {
    codexRunnerNodeId,
    codexRunnerToken,
    claudeRunnerNodeId,
    claudeRunnerToken,
  }
}

function spawnService(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: 'inherit',
    detached: true,
  })

  spawnedChildren.push({ child, label })

  child.once('exit', (code, signal) => {
    if (!shuttingDown && (signal || code !== 0)) {
      console.error(`${label} exited unexpectedly`, {
        code,
        signal,
      })
    }
  })

  return child
}

async function stopChild(child) {
  if (!child || child.exitCode != null || child.signalCode != null) {
    return
  }

  const exitPromise = new Promise((resolve) => {
    child.once('exit', () => resolve())
  })

  try {
    if (typeof child.pid === 'number') {
      process.kill(-child.pid, 'SIGTERM')
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    child.kill('SIGTERM')
  }

  const timedOut = await Promise.race([
    exitPromise.then(() => false),
    sleep(5_000).then(() => true),
  ])

  if (timedOut) {
    try {
      if (typeof child.pid === 'number') {
        process.kill(-child.pid, 'SIGKILL')
      } else {
        child.kill('SIGKILL')
      }
    } catch {
      child.kill('SIGKILL')
    }

    await Promise.race([exitPromise, sleep(2_000)])
  }
}

async function cleanupChildren() {
  shuttingDown = true
  const children = spawnedChildren.splice(0).reverse()

  for (const { child } of children) {
    await stopChild(child).catch(() => undefined)
  }
}

async function waitForHealthz(url, timeoutMs = 120_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)

      if (response.ok) {
        return
      }
    } catch {
      // keep waiting
    }

    await sleep(1_000)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function startLinearStubServer() {
  const server = await import('node:http').then(({ createServer }) =>
    createServer((request, response) => {
      const chunks = []
      request.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: { commentCreate: { success: true } } }))
      })
    }),
  )

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind Linear stub server')
  }

  return {
    apiBaseUrl: `http://127.0.0.1:${address.port.toString()}/graphql`,
    close: async () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      }),
  }
}

async function main() {
  validatePrereqs()
  const { codexRoots, claudeRoots } = resolveProofRoots()
  const controlApiPort = Number.parseInt(process.env.CONTROL_API_PORT ?? '4000', 10)
  const controlApiBaseUrl = `http://127.0.0.1:${controlApiPort}`
  const linearStub = await startLinearStubServer()
  process.env.LINEAR_API_BASE_URL = linearStub.apiBaseUrl
  process.env.LINEAR_API_TOKEN = 'phase6-live-stub-token'

  await execPnpm(['--filter', '@ai-dev-team/db', 'compile'])
  await execPnpm(['--filter', '@ai-dev-team/control-api', 'compile'])
  await execPnpm(['--filter', '@ai-dev-team/runner-host', 'compile'])
  await execPnpm(['--filter', '@ai-dev-team/workflow-worker', 'compile'])
  await execFile(
    'node',
    [
      '--input-type=module',
      '-e',
      "import { prepareTestDatabase } from './packages/db/dist/index.js'; await prepareTestDatabase();",
    ],
  )
  const runtimeModules = await importPhase6RuntimeModules()
  const db = runtimeModules.createDb(runtimeModules.loadDatabaseConfig(process.env))

  const codexRunnerNodeId = requireEnv('RUNNER_NODE_ID')
  const codexRunnerToken = requireEnv('RUNNER_AUTH_TOKEN')
  const claudeRunnerNodeId =
    process.env.PHASE6_LIVE_CLAUDE_RUNNER_NODE_ID?.trim() || 'claude-runner-1'
  const claudeRunnerToken =
    process.env.PHASE6_LIVE_CLAUDE_RUNNER_AUTH_TOKEN?.trim() || 'claude-runner-token'
  const codexRunnerHostGroupId = requireEnv('RUNNER_HOST_GROUP_ID')
  const claudeRunnerHostGroupId =
    process.env.PHASE6_LIVE_CLAUDE_RUNNER_HOST_GROUP_ID?.trim() ||
    `${codexRunnerHostGroupId}-review`
  const mcpConfigHash = requireEnv('RUNNER_MCP_CONFIG_HASH')
  const providerListCodex = 'codex'
  const providerListClaude = 'claude'

  spawnService('control-api', 'node', ['apps/control-api/dist/index.js'])
  spawnService('workflow-worker', 'node', ['apps/workflow-worker/dist/index.js'])
  spawnService('outbox-executor', 'node', ['apps/workflow-worker/dist/outbox-executor.js'])
  spawnService(
    'runner-host codex',
    'node',
    ['apps/runner-host/dist/index.js', '--provider', 'codex'],
    {
      RUNNER_NODE_ID: codexRunnerNodeId,
      RUNNER_AUTH_TOKEN: codexRunnerToken,
      RUNNER_HOST_GROUP_ID: codexRunnerHostGroupId,
      RUNNER_PROVIDERS: providerListCodex,
      RUNNER_WORKSPACE_ROOT: codexRoots.workspaceRoot,
      RUNNER_WORKTREE_ROOT: codexRoots.worktreeRoot,
      RUNNER_ARTIFACT_ROOT: codexRoots.artifactRoot,
      RUNNER_MCP_CONFIG_HASH: mcpConfigHash,
      RUNNER_POLL_BASE_URL: controlApiBaseUrl,
    },
  )
  spawnService(
    'runner-host claude',
    'node',
    ['apps/runner-host/dist/index.js', '--provider', 'claude'],
    {
      RUNNER_NODE_ID: claudeRunnerNodeId,
      RUNNER_AUTH_TOKEN: claudeRunnerToken,
      RUNNER_HOST_GROUP_ID: claudeRunnerHostGroupId,
      RUNNER_PROVIDERS: providerListClaude,
      RUNNER_WORKSPACE_ROOT: claudeRoots.workspaceRoot,
      RUNNER_WORKTREE_ROOT: claudeRoots.worktreeRoot,
      RUNNER_ARTIFACT_ROOT: claudeRoots.artifactRoot,
      RUNNER_MCP_CONFIG_HASH: mcpConfigHash,
      RUNNER_POLL_BASE_URL: controlApiBaseUrl,
    },
  )

  try {
    await waitForHealthz(`${controlApiBaseUrl}/internal/healthz`)
    await waitForLiveHarnessReadiness(db, runtimeModules, {
      codexRunnerNodeId,
      claudeRunnerNodeId,
      codexRoots,
      claudeRoots,
    })

    await execFile('node', ['--test', '--test-concurrency=1', liveTestPath], {
      PHASE6_LIVE_PROOF: 'true',
      PHASE6_LIVE_PREPARED: 'true',
      PHASE6_LIVE_CODEX_RUNNER_NODE_ID: codexRunnerNodeId,
      PHASE6_LIVE_CODEX_RUNNER_HOST_GROUP_ID: codexRunnerHostGroupId,
      PHASE6_LIVE_CLAUDE_RUNNER_NODE_ID: claudeRunnerNodeId,
      PHASE6_LIVE_CLAUDE_RUNNER_HOST_GROUP_ID: claudeRunnerHostGroupId,
      PHASE6_LIVE_CLAUDE_RUNNER_AUTH_TOKEN: claudeRunnerToken,
      PHASE6_LIVE_CODEX_WORKSPACE_ROOT: codexRoots.workspaceRoot,
      PHASE6_LIVE_CODEX_WORKTREE_ROOT: codexRoots.worktreeRoot,
      PHASE6_LIVE_CODEX_ARTIFACT_ROOT: codexRoots.artifactRoot,
      PHASE6_LIVE_CLAUDE_WORKSPACE_ROOT: claudeRoots.workspaceRoot,
      PHASE6_LIVE_CLAUDE_WORKTREE_ROOT: claudeRoots.worktreeRoot,
      PHASE6_LIVE_CLAUDE_ARTIFACT_ROOT: claudeRoots.artifactRoot,
    })
  } finally {
    await db.destroy().catch(() => undefined)
    await cleanupChildren()
    await linearStub.close().catch(() => undefined)
  }
}

function execPnpm(args) {
  return execFile('corepack', ['pnpm', ...args])
}

function execFile(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: 'inherit',
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated with ${signal}`))
        return
      }

      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
        return
      }

      resolve(undefined)
    })
  })
}

function shutdownAndExit(exitCode) {
  void cleanupChildren()
    .catch(() => undefined)
    .finally(() => {
      process.exit(exitCode)
    })
}

process.on('SIGINT', () => {
  shutdownAndExit(130)
})

process.on('SIGTERM', () => {
  shutdownAndExit(143)
})

main().catch(async (error) => {
  console.error('Phase 6 live proof failed', error)
  await cleanupChildren().catch(() => undefined)
  process.exitCode = 1
})
