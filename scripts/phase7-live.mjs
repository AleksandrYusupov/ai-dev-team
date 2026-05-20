#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const liveTestPath = 'apps/workflow-worker/dist/phase7-live.integration.test.js'

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
const allowEmptyEnvKeys = new Set(['RUNNER_MCP_EXCLUSIVE_SERVERS'])
const spawnedChildren = []

loadEnvFiles()

function loadEnvFiles() {
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

    if (process.env[key]?.trim()) {
      continue
    }

    process.env[key] = normalized.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '')
  }
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

function requireCommand(command, label) {
  const binary = extractCommandBinary(command)

  if (!binary) {
    throw new Error(`Unable to resolve executable for ${label}`)
  }

  const result = spawnSync('/bin/sh', ['-lc', `command -v "${binary}"`], {
    cwd: rootDir,
    stdio: 'ignore',
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`Missing required CLI for ${label}: ${binary}`)
  }
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

    requireCommand(command, `MCP server ${serverName}`)
  }
}

function validatePrereqs() {
  const missingKeys = collectMissingEnvKeys(requiredEnvKeys)

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(', ')}`,
    )
  }

  validateMcpCommandMap()
  requireCommand(optionalEnv('CODEX_COMMAND') ?? requireEnv('CODEX_CLI_BIN'), 'codex provider')
  requireCommand(
    optionalEnv('CLAUDE_CODE_COMMAND') ?? requireEnv('CLAUDE_CLI_BIN'),
    'claude provider',
  )
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
      'PHASE7_LIVE_CODEX_WORKSPACE_ROOT',
    ),
    worktreeRoot: resolveProofRoot(
      baseWorktreeRoot,
      'codex',
      'PHASE7_LIVE_CODEX_WORKTREE_ROOT',
    ),
    artifactRoot: resolveProofRoot(
      baseArtifactRoot,
      'codex',
      'PHASE7_LIVE_CODEX_ARTIFACT_ROOT',
    ),
  }
  const claudeRoots = {
    workspaceRoot: resolveProofRoot(
      baseWorkspaceRoot,
      'claude',
      'PHASE7_LIVE_CLAUDE_WORKSPACE_ROOT',
    ),
    worktreeRoot: resolveProofRoot(
      baseWorktreeRoot,
      'claude',
      'PHASE7_LIVE_CLAUDE_WORKTREE_ROOT',
    ),
    artifactRoot: resolveProofRoot(
      baseArtifactRoot,
      'claude',
      'PHASE7_LIVE_CLAUDE_ARTIFACT_ROOT',
    ),
  }

  return { codexRoots, claudeRoots }
}

function spawnService(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: 'inherit',
  })

  spawnedChildren.push({ label, child })
  child.once('error', (error) => {
    process.stderr.write(`${label} failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
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
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => {
      requests.push(Buffer.concat(chunks).toString('utf8'))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: { commentCreate: { success: true } } }))
    })
  })

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind Linear stub server')
  }

  return {
    requests,
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

async function main() {
  validatePrereqs()
  const { codexRoots, claudeRoots } = resolveProofRoots()
  const controlApiPort = Number.parseInt(process.env.CONTROL_API_PORT ?? '4000', 10)
  const controlApiBaseUrl = `http://127.0.0.1:${controlApiPort}`
  const linearStub = await startLinearStubServer()
  process.env.LINEAR_API_BASE_URL = linearStub.apiBaseUrl
  process.env.LINEAR_API_TOKEN = 'phase7-live-stub-token'

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
  await execFile('node', ['scripts/bootstrap-phase7-test-repo.mjs'])

  const codexRunnerNodeId = requireEnv('RUNNER_NODE_ID')
  const codexRunnerToken = requireEnv('RUNNER_AUTH_TOKEN')
  const claudeRunnerNodeId =
    process.env.PHASE7_LIVE_CLAUDE_RUNNER_NODE_ID?.trim() || 'claude-runner-1'
  const claudeRunnerToken =
    process.env.PHASE7_LIVE_CLAUDE_RUNNER_AUTH_TOKEN?.trim() || 'claude-runner-token'
  const codexRunnerHostGroupId = requireEnv('RUNNER_HOST_GROUP_ID')
  const claudeRunnerHostGroupId =
    process.env.PHASE7_LIVE_CLAUDE_RUNNER_HOST_GROUP_ID?.trim() ||
    `${codexRunnerHostGroupId}-review`
  const mcpConfigHash = requireEnv('RUNNER_MCP_CONFIG_HASH')

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
      RUNNER_PROVIDERS: 'codex',
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
      RUNNER_PROVIDERS: 'claude',
      RUNNER_WORKSPACE_ROOT: claudeRoots.workspaceRoot,
      RUNNER_WORKTREE_ROOT: claudeRoots.worktreeRoot,
      RUNNER_ARTIFACT_ROOT: claudeRoots.artifactRoot,
      RUNNER_MCP_CONFIG_HASH: mcpConfigHash,
      RUNNER_POLL_BASE_URL: controlApiBaseUrl,
    },
  )

  try {
    await waitForHealthz(`${controlApiBaseUrl}/internal/healthz`)

    await execFile('node', ['--test', '--test-concurrency=1', liveTestPath], {
      PHASE7_LIVE_PROOF: 'true',
      PHASE7_LIVE_PREPARED: 'true',
      PHASE7_LIVE_CODEX_RUNNER_NODE_ID: codexRunnerNodeId,
      PHASE7_LIVE_CODEX_RUNNER_HOST_GROUP_ID: codexRunnerHostGroupId,
      PHASE7_LIVE_CLAUDE_RUNNER_NODE_ID: claudeRunnerNodeId,
      PHASE7_LIVE_CLAUDE_RUNNER_HOST_GROUP_ID: claudeRunnerHostGroupId,
      PHASE7_LIVE_CLAUDE_RUNNER_AUTH_TOKEN: claudeRunnerToken,
      PHASE7_LIVE_CODEX_WORKSPACE_ROOT: codexRoots.workspaceRoot,
      PHASE7_LIVE_CODEX_WORKTREE_ROOT: codexRoots.worktreeRoot,
      PHASE7_LIVE_CODEX_ARTIFACT_ROOT: codexRoots.artifactRoot,
      PHASE7_LIVE_CLAUDE_WORKSPACE_ROOT: claudeRoots.workspaceRoot,
      PHASE7_LIVE_CLAUDE_WORKTREE_ROOT: claudeRoots.worktreeRoot,
      PHASE7_LIVE_CLAUDE_ARTIFACT_ROOT: claudeRoots.artifactRoot,
      PHASE7_TEST_REPO_PATH:
        process.env.PHASE7_TEST_REPO_PATH ??
        '/tmp/ai-dev-team/reference_repos/test_repo',
    })
  } finally {
    await cleanupChildren()
    await linearStub.close().catch(() => undefined)
  }
}

await main()
