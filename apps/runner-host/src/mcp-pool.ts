import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'

import type {
  McpBindingRefV1,
  McpProcessStateV1,
  McpSharingScope,
  RunnerMcpPoolSnapshotV1,
} from '@ai-dev-team/shared'

import type { RunnerHostAppConfig } from './config.js'

const DEFAULT_SCOPES: Record<string, McpSharingScope> = {
  // Host-scope: shared across all executions on this runner
  linear: 'host',
  obsidian: 'host',
  context7: 'host',
  postgres: 'host',
  fetch: 'host',
  memory: 'host',
  // Repo-scope: one process per repository slug
  github: 'repo',
  filesystem: 'repo',
  git: 'repo',
  serena: 'repo',
  // Exclusive-scope: one process per execution session
  'sequential-thinking': 'exclusive',
  // Custom integration-boundary MCPs (host-scope)
  'secret-broker': 'host',
  'oauth-broker': 'host',
  'integration-lab': 'host',
  'policy-guard': 'host',
}

export interface McpPoolAcquireContext {
  executionSessionKey: string
  repoSlug: string | null
  configHash: string
}

interface ActiveBinding {
  serverName: string
  sharingScope: McpSharingScope
  repoSlug: string | null
  configHash: string
  bindingKey: string
  acquiredCount: number
  sessionCounts: Map<string, number>
  process: ReturnType<typeof spawn>
  command: string
  processState: McpProcessStateV1
  updatedAt: string
  exitCode: number | null
  signalCode: NodeJS.Signals | null
}

function normalizeScope(
  serverName: string,
  sharingScope: McpSharingScope,
): McpSharingScope {
  return DEFAULT_SCOPES[serverName] ?? sharingScope
}

function buildPoolKey(
  serverName: string,
  sharingScope: McpSharingScope,
  repoSlug: string | null,
  configHash: string,
): string {
  return [serverName, sharingScope, repoSlug ?? 'null', configHash].join('|')
}

function buildBindingKey(
  serverName: string,
  sharingScope: McpSharingScope,
  repoSlug: string | null,
  configHash: string,
  executionSessionKey: string,
): string {
  const poolKey = buildPoolKey(serverName, sharingScope, repoSlug, configHash)

  return sharingScope === 'exclusive'
    ? `${poolKey}|${executionSessionKey}`
    : poolKey
}

function signalProcessTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): boolean {
  if (typeof child.pid !== 'number') {
    return child.kill(signal)
  }

  try {
    return process.kill(-child.pid, signal)
  } catch {
    return child.kill(signal)
  }
}

async function terminateManagedProcess(
  processHandle: ReturnType<typeof spawn>,
): Promise<void> {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
    return
  }

  const exitPromise = once(processHandle, 'exit') as Promise<
    [number | null, NodeJS.Signals | null]
  >
  signalProcessTree(processHandle, 'SIGTERM')

  const result = await Promise.race([
    exitPromise.then(() => 'exit' as const),
    sleep(5_000).then(() => 'timeout' as const),
  ])

  if (
    result === 'timeout' &&
    processHandle.exitCode === null &&
    processHandle.signalCode === null
  ) {
    signalProcessTree(processHandle, 'SIGKILL')
    await Promise.race([exitPromise, sleep(2_000)])
  }
}

export function resolveMcpServerCommand(
  config: Pick<
    RunnerHostAppConfig,
    'fakeMcpCommand' | 'mcpCommandsByServer' | 'runtimeMode'
  >,
  serverName: string,
): string | null {
  return (
    config.mcpCommandsByServer[serverName] ??
    (config.runtimeMode === 'fake' ? config.fakeMcpCommand : null)
  )
}

function startManagedProcess(
  config: Pick<
    RunnerHostAppConfig,
    'fakeMcpCommand' | 'mcpCommandsByServer' | 'runtimeMode'
  >,
  context: McpPoolAcquireContext,
  binding: Pick<
    ActiveBinding,
    'bindingKey' | 'repoSlug' | 'serverName' | 'sharingScope'
  >,
): ReturnType<typeof spawn> {
  const command = resolveMcpServerCommand(config, binding.serverName)

  if (!command) {
    throw new Error(`Missing MCP command for server ${binding.serverName}`)
  }

  const child = spawn('/bin/sh', ['-lc', command], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    env: {
      ...process.env,
      RUNNER_MCP_BINDING_KEY: binding.bindingKey,
      RUNNER_MCP_SERVER_NAME: binding.serverName,
      RUNNER_MCP_SHARING_SCOPE: binding.sharingScope,
      RUNNER_MCP_REPO_SLUG: binding.repoSlug ?? '',
      RUNNER_MCP_CONFIG_HASH: context.configHash,
      RUNNER_MCP_EXECUTION_SESSION_KEY: context.executionSessionKey,
    },
  })

  child.on('exit', (code, signal) => {
    if (code !== 0 || signal) {
      console.warn('runner-host MCP subprocess exited unexpectedly', {
        bindingKey: binding.bindingKey,
        code,
        signal,
      })
    }
  })
  child.on('error', (error) => {
    console.warn('runner-host MCP subprocess failed to start', {
      bindingKey: binding.bindingKey,
      error,
    })
  })

  return child
}

export class McpPoolManager {
  private readonly activeBindings = new Map<string, ActiveBinding>()

  constructor(private readonly config: RunnerHostAppConfig) {}

  acquireBindings(
    requestedBindings: McpBindingRefV1[],
    context: McpPoolAcquireContext,
  ): McpBindingRefV1[] {
    return requestedBindings.map((binding) => this.acquireBinding(binding, context))
  }

  acquireBinding(
    binding: McpBindingRefV1,
    context: McpPoolAcquireContext,
  ): McpBindingRefV1 {
    const sharingScope = normalizeScope(binding.serverName, binding.sharingScope)
    const repoSlug =
      sharingScope === 'host' ? null : context.repoSlug ?? binding.repoSlug
    const bindingKey = buildBindingKey(
      binding.serverName,
      sharingScope,
      repoSlug,
      context.configHash,
      context.executionSessionKey,
    )
    const existing = this.activeBindings.get(bindingKey)

    if (existing) {
      if (
        existing.process.exitCode !== null ||
        existing.process.signalCode !== null
      ) {
        void this.stopBinding(existing).catch((error) => {
          console.warn('runner-host MCP subprocess shutdown failed', {
            bindingKey,
            error,
          })
        })
        this.activeBindings.delete(bindingKey)
      } else {
        existing.acquiredCount += 1
        existing.sessionCounts.set(
          context.executionSessionKey,
          (existing.sessionCounts.get(context.executionSessionKey) ?? 0) + 1,
        )
        existing.updatedAt = new Date().toISOString()

        return {
          serverName: existing.serverName,
          sharingScope: existing.sharingScope,
          bindingKey: existing.bindingKey,
          reused: true,
          repoSlug: existing.repoSlug,
        }
      }
    }

    const processHandle = startManagedProcess(
      this.config,
      context,
      {
        bindingKey,
        repoSlug,
        serverName: binding.serverName,
        sharingScope,
      },
    )

    const activeBinding: ActiveBinding = {
      serverName: binding.serverName,
      sharingScope,
      repoSlug,
      configHash: context.configHash,
      bindingKey,
      acquiredCount: 1,
      sessionCounts: new Map([[context.executionSessionKey, 1]]),
      process: processHandle,
      command: resolveMcpServerCommand(this.config, binding.serverName) ?? '',
      processState: 'starting',
      updatedAt: new Date().toISOString(),
      exitCode: null,
      signalCode: null,
    }

    processHandle.once('spawn', () => {
      const current = this.activeBindings.get(bindingKey)

      if (!current) {
        return
      }

      current.processState = 'running'
      current.updatedAt = new Date().toISOString()
    })
    processHandle.once('exit', (code, signal) => {
      const current = this.activeBindings.get(bindingKey)

      if (!current) {
        return
      }

      current.exitCode = code
      current.signalCode = signal
      current.processState = code === 0 && signal === null ? 'stopped' : 'failed'
      current.updatedAt = new Date().toISOString()
    })

    this.activeBindings.set(bindingKey, activeBinding)

    return {
      serverName: binding.serverName,
      sharingScope,
      bindingKey,
      reused: false,
      repoSlug,
    }
  }

  releaseExecutionSession(executionSessionKey: string): void {
    for (const [bindingKey, binding] of this.activeBindings.entries()) {
      const sessionCount = binding.sessionCounts.get(executionSessionKey)

      if (!sessionCount) {
        continue
      }

      binding.sessionCounts.delete(executionSessionKey)
      binding.acquiredCount -= sessionCount
      binding.updatedAt = new Date().toISOString()

      if (binding.acquiredCount <= 0) {
        void this.stopBinding(binding).catch((error) => {
          console.warn('runner-host MCP subprocess shutdown failed', {
            bindingKey,
            error,
          })
        })
        this.activeBindings.delete(bindingKey)
      }
    }
  }

  private async stopBinding(binding: ActiveBinding): Promise<void> {
    await terminateManagedProcess(binding.process)

    binding.processState =
      binding.exitCode === 0 && binding.signalCode === null ? 'stopped' : 'failed'
    binding.updatedAt = new Date().toISOString()
  }

  snapshot(): McpBindingRefV1[] {
    return [...this.activeBindings.values()].map((binding) => ({
      serverName: binding.serverName,
      sharingScope: binding.sharingScope,
      bindingKey: binding.bindingKey,
      reused: true,
      repoSlug: binding.repoSlug,
    }))
  }

  snapshotDetailed(): RunnerMcpPoolSnapshotV1 {
    return {
      schemaVersion: 1,
      runnerNodeId: this.config.runnerNodeId,
      configHash: this.config.mcpConfigHash,
      capturedAt: new Date().toISOString(),
      bindings: [...this.activeBindings.values()].map((binding) => ({
        serverName: binding.serverName,
        sharingScope: binding.sharingScope,
        bindingKey: binding.bindingKey,
        repoSlug: binding.repoSlug,
        acquiredCount: binding.acquiredCount,
        sessionCounts: Object.fromEntries(binding.sessionCounts),
        processState: binding.processState,
        updatedAt: binding.updatedAt,
      })),
    }
  }
}
