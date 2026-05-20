import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AgentProvider } from '@ai-dev-team/shared'
import { loadRunnerHostConfig, type RunnerHostConfig } from '@ai-dev-team/config'

export const RUNNER_HOST_RUNTIME_MODES = ['real', 'fake'] as const
export type RunnerHostRuntimeMode =
  (typeof RUNNER_HOST_RUNTIME_MODES)[number]

export interface RunnerHostAppConfig extends RunnerHostConfig {
  runtimeMode: RunnerHostRuntimeMode
  fakeProviderCommand: string | null
  fakeMcpCommand: string | null
  fakeAgentLibraryReleaseId: string | null
  fakeAgentLibraryFingerprint: string | null
  skillsAvailable: string[]
  skillCacheRoot: string
  manifestVersion: number
}

const runnerHostAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function optionalTrimmedString(
  env: NodeJS.ProcessEnv,
  key: string,
): string | null {
  const value = env[key]?.trim()

  return value && value.length > 0 ? value : null
}

function optionalCsvList(
  env: NodeJS.ProcessEnv,
  key: string,
): string[] {
  const value = env[key]?.trim()

  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function uniqueSortedStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function resolveRuntimeMode(env: NodeJS.ProcessEnv): RunnerHostRuntimeMode {
  return env.RUNNER_RUNTIME_MODE === 'fake' ? 'fake' : 'real'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function normalizeRepoOwnedShellCommand(command: string | null): string | null {
  if (!command) {
    return null
  }

  const trimmed = command.trim()
  const nodeDistMatch = /^node\s+((?:\.\/)?dist\/[^\s]+)(.*)$/u.exec(trimmed)

  if (!nodeDistMatch) {
    return trimmed
  }

  const [, relativeDistPath, suffix] = nodeDistMatch
  const normalizedRelativePath = relativeDistPath.replace(/^\.\//u, '')
  const absoluteDistPath = path.join(runnerHostAppRoot, normalizedRelativePath)

  return `node ${shellQuote(absoluteDistPath)}${suffix}`
}

function normalizeCommandMap(
  commands: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [
      name,
      normalizeRepoOwnedShellCommand(command) ?? command,
    ]),
  )
}

function normalizeProviderCommandMap(
  commands: Partial<Record<AgentProvider, string>>,
): Partial<Record<AgentProvider, string>> {
  return Object.fromEntries(
    Object.entries(commands).map(([provider, command]) => [
      provider,
      normalizeRepoOwnedShellCommand(command) ?? command,
    ]),
  ) as Partial<Record<AgentProvider, string>>
}

function resolveSkillsAvailable(
  env: NodeJS.ProcessEnv,
  runtimeMode: RunnerHostRuntimeMode,
): string[] {
  return runtimeMode === 'fake'
    ? uniqueSortedStrings(optionalCsvList(env, 'RUNNER_SKILLS_AVAILABLE'))
    : []
}

function fakeDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const root = tmpdir()
  const fakeMcpCommand = env.RUNNER_FAKE_MCP_COMMAND?.trim() || 'node dist/fake-mcp.js'

  return {
    ...env,
    NODE_ENV: env.NODE_ENV ?? 'test',
    DATABASE_URL:
      env.DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:5432/ai_dev_team',
    LINEAR_WEBHOOK_SECRET: env.LINEAR_WEBHOOK_SECRET ?? 'fake-linear-secret',
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET ?? 'fake-github-secret',
    RUNNER_NODE_ID: env.RUNNER_NODE_ID ?? 'fake-runner-node',
    RUNNER_HOST_GROUP_ID: env.RUNNER_HOST_GROUP_ID ?? 'fake-host-group',
    RUNNER_AUTH_TOKEN: env.RUNNER_AUTH_TOKEN ?? 'fake-runner-token',
    RUNNER_WORKSPACE_ROOT:
      env.RUNNER_WORKSPACE_ROOT ?? path.join(root, 'ai-dev-team-runner-workspace'),
    RUNNER_WORKTREE_ROOT:
      env.RUNNER_WORKTREE_ROOT ?? path.join(root, 'ai-dev-team-runner-worktrees'),
    RUNNER_ARTIFACT_ROOT:
      env.RUNNER_ARTIFACT_ROOT ?? path.join(root, 'ai-dev-team-runner-artifacts'),
    RUNNER_MCP_CONFIG_HASH: env.RUNNER_MCP_CONFIG_HASH ?? 'fake-mcp-config',
    RUNNER_PROVIDERS: env.RUNNER_PROVIDERS ?? 'codex,claude',
    RUNNER_SUPPORTED_ROLES:
      env.RUNNER_SUPPORTED_ROLES ??
      'intake_agent,spec_agent,architect_agent,plan_agent,build_agent,build_agent_backend,build_agent_integrations,test_agent,review_agent,security_agent,docs_agent,release_agent,reporter_agent,monitoring_agent,integration_agent,orchestrator',
    RUNNER_SUPPORTED_RUN_KINDS:
      env.RUNNER_SUPPORTED_RUN_KINDS ?? 'build,review,deploy,rework_cycle',
    RUNNER_SUPPORTED_REPO_KINDS:
      env.RUNNER_SUPPORTED_REPO_KINDS ?? 'application',
    RUNNER_TOOL_BASELINE:
      env.RUNNER_TOOL_BASELINE ?? 'serena,sequential-thinking,obsidian,context7,github,git,filesystem,linear,postgres,fetch,memory',
    RUNNER_SKILLS_AVAILABLE: env.RUNNER_SKILLS_AVAILABLE ?? 'fake-runner,fake-mcp',
    RUNNER_MCP_HOST_SERVERS: env.RUNNER_MCP_HOST_SERVERS ?? 'linear,obsidian,context7,postgres,fetch,memory,secret-broker,oauth-broker,integration-lab,policy-guard',
    RUNNER_MCP_REPO_SERVERS: env.RUNNER_MCP_REPO_SERVERS ?? 'github,filesystem,git,serena',
    RUNNER_MCP_EXCLUSIVE_SERVERS: env.RUNNER_MCP_EXCLUSIVE_SERVERS ?? 'sequential-thinking',
    RUNNER_MCP_COMMANDS_JSON:
      env.RUNNER_MCP_COMMANDS_JSON?.trim() ||
      JSON.stringify({
        linear: fakeMcpCommand,
        obsidian: fakeMcpCommand,
        context7: fakeMcpCommand,
        postgres: fakeMcpCommand,
        fetch: fakeMcpCommand,
        memory: fakeMcpCommand,
        github: fakeMcpCommand,
        filesystem: fakeMcpCommand,
        git: fakeMcpCommand,
        serena: fakeMcpCommand,
        'sequential-thinking': fakeMcpCommand,
        'secret-broker': fakeMcpCommand,
        'oauth-broker': fakeMcpCommand,
        'integration-lab': fakeMcpCommand,
        'policy-guard': fakeMcpCommand,
      }),
    CODEX_CLI_BIN: env.CODEX_CLI_BIN ?? 'codex',
    CLAUDE_CLI_BIN: env.CLAUDE_CLI_BIN ?? 'claude',
    CODEX_COMMAND: env.CODEX_COMMAND ?? '',
    CLAUDE_CODE_COMMAND: env.CLAUDE_CODE_COMMAND ?? '',
    RUNNER_FAKE_MCP_COMMAND: fakeMcpCommand,
  }
}

export function loadRunnerHostAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): RunnerHostAppConfig {
  const runtimeMode = resolveRuntimeMode(env)
  const resolvedEnv = runtimeMode === 'fake' ? fakeDefaults(env) : env
  const baseConfig = loadRunnerHostConfig(resolvedEnv)

  return {
    ...baseConfig,
    runtimeMode,
    commands: normalizeProviderCommandMap(baseConfig.commands),
    mcpCommandsByServer: normalizeCommandMap(baseConfig.mcpCommandsByServer),
    fakeProviderCommand: normalizeRepoOwnedShellCommand(
      optionalTrimmedString(env, 'RUNNER_FAKE_PROVIDER_COMMAND'),
    ),
    fakeMcpCommand: normalizeRepoOwnedShellCommand(
      optionalTrimmedString(resolvedEnv, 'RUNNER_FAKE_MCP_COMMAND'),
    ),
    fakeAgentLibraryReleaseId: optionalTrimmedString(
      resolvedEnv,
      'RUNNER_FAKE_AGENT_LIBRARY_RELEASE_ID',
    ),
    fakeAgentLibraryFingerprint: optionalTrimmedString(
      resolvedEnv,
      'RUNNER_FAKE_AGENT_LIBRARY_FINGERPRINT',
    ),
    skillsAvailable: resolveSkillsAvailable(resolvedEnv, runtimeMode),
    skillCacheRoot:
      optionalTrimmedString(resolvedEnv, 'RUNNER_SKILL_CACHE_ROOT') ??
      path.join(baseConfig.workspaceRoot, '.runner-managed-skills'),
    manifestVersion: Number.parseInt(
      resolvedEnv.RUNNER_MANIFEST_VERSION ?? '1',
      10,
    ),
  }
}
