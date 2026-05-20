import { hostname } from 'node:os'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import type {
  AgentProvider,
  McpServerCatalogEntryV1,
  ProviderFailureClass,
  RunnerCapabilityManifestV1,
  RunnerExecutionBundleV1,
  RunnerExecutionStartedRequestV1,
  TaskEnvelopeV2,
} from '@ai-dev-team/shared'

import type { RunnerHostAppConfig } from './config.js'
import { RunnerControlApiClient } from './control-api-client.js'
import { McpPoolManager, resolveMcpServerCommand } from './mcp-pool.js'
import {
  SkillSyncManager,
  type ResolvedSkillBundle,
  type SkillSyncManifestState,
} from './skill-sync.js'
import {
  buildAttemptPaths,
  cleanupAttemptPaths,
  prepareAttemptPaths,
  type PreparedAttemptPaths,
} from './worktree.js'
import {
  buildArtifactBundle,
  buildExecutionMetadata,
  executeProviderAttempt,
  resolveProviderCommand,
  type ProviderExecutionResult,
  type ProviderRunContext,
  type ProviderResolvedSkillDocument,
} from './providers.js'

type AbortReason = 'shutdown' | 'cancel' | 'heartbeat_transport_failure'

function inferCommandVersion(command: string | null | undefined): string {
  if (!command) {
    return 'unconfigured'
  }

  return command.trim().split(/\s+/)[0] ?? 'unconfigured'
}

function buildServerCatalog(
  config: RunnerHostAppConfig,
): McpServerCatalogEntryV1[] {
  const catalog = new Map<string, McpServerCatalogEntryV1>()

  const register = (serverName: string, sharingScope: McpServerCatalogEntryV1['sharingScope']) => {
    const command = resolveMcpServerCommand(config, serverName)

    if (config.runtimeMode !== 'fake' && !command) {
      return
    }

    if (catalog.has(serverName)) {
      return
    }

    catalog.set(serverName, {
      serverName,
      sharingScope,
      reusePolicy:
        sharingScope === 'exclusive'
          ? 'exclusive_per_execution'
          : 'shared_by_scope',
      supportsConcurrentSessions: sharingScope !== 'exclusive',
      configHash: config.mcpConfigHash,
    })
  }

  for (const serverName of config.mcpHostServers) {
    register(serverName, 'host')
  }

  for (const serverName of config.mcpRepoServers) {
    register(serverName, 'repo')
  }

  for (const serverName of config.mcpExclusiveServers) {
    register(serverName, 'exclusive')
  }

  return [...catalog.values()]
}

function buildPublishableProviders(config: RunnerHostAppConfig): RunnerHostAppConfig['providers'] {
  if (config.runtimeMode === 'fake') {
    return config.providers
  }

  return config.providers.filter((provider) => resolveProviderCommand(config, provider) !== null)
}

function buildProviderCliVersions(
  config: RunnerHostAppConfig,
): Partial<Record<AgentProvider, string>> {
  const publishableProviders = buildPublishableProviders(config)
  const versions: Partial<Record<AgentProvider, string>> = {}

  for (const provider of publishableProviders) {
    versions[provider] = inferCommandVersion(resolveProviderCommand(config, provider))
  }

  return versions
}

export function buildRunnerManifest(
  config: RunnerHostAppConfig,
  skillState: SkillSyncManifestState = {
    skillsAvailable: [...config.skillsAvailable],
    activeAgentLibraryReleaseId:
      config.runtimeMode === 'fake'
        ? config.fakeAgentLibraryReleaseId ??
          (config.skillsAvailable.length > 0 ? 'v1' : null)
        : null,
    activeAgentLibraryFingerprint:
      config.runtimeMode === 'fake'
        ? config.fakeAgentLibraryFingerprint ??
          (config.skillsAvailable.length > 0
            ? 'fake-release-fingerprint'
            : null)
        : null,
    skillSyncStatus: config.runtimeMode === 'fake' ? 'ready' : 'degraded',
    skillSyncError: null,
    installedSkillBundles:
      config.runtimeMode === 'fake' &&
      (config.fakeAgentLibraryReleaseId || config.skillsAvailable.length > 0) &&
      (config.fakeAgentLibraryFingerprint || config.skillsAvailable.length > 0)
        ? [
            {
              releaseId:
                config.fakeAgentLibraryReleaseId ?? 'v1',
              fingerprint:
                config.fakeAgentLibraryFingerprint ??
                'fake-release-fingerprint',
              skillIds: [...config.skillsAvailable],
            },
          ]
        : [],
  },
): RunnerCapabilityManifestV1 {
  return {
    schemaVersion: 1,
    runnerNodeId: config.runnerNodeId,
    hostGroupId: config.hostGroupId,
    manifestVersion: config.manifestVersion,
    providers: buildPublishableProviders(config),
    providerCliVersions: buildProviderCliVersions(config),
    supportedRoles: config.supportedRoles,
    supportedRunKinds: config.supportedRunKinds,
    supportedRepoKinds: config.supportedRepoKinds,
    mcpServerCatalog: buildServerCatalog(config),
    toolBaseline: config.toolBaseline,
    skillsAvailable: skillState.skillsAvailable,
    activeAgentLibraryReleaseId: skillState.activeAgentLibraryReleaseId,
    activeAgentLibraryFingerprint: skillState.activeAgentLibraryFingerprint,
    skillSyncStatus: skillState.skillSyncStatus,
    skillSyncError: skillState.skillSyncError,
    installedSkillBundles: skillState.installedSkillBundles,
    workspaceRoot: config.workspaceRoot,
    worktreeRoot: config.worktreeRoot,
    maxConcurrentLeases: config.maxConcurrentLeases,
    supportsInterrupt: config.supportsInterrupt,
    supportsCheckpointResume: config.supportsCheckpointResume,
    supportsArtifactUpload: config.supportsArtifactUpload,
    supportsConcurrentSessions: config.supportsConcurrentSessions,
    integration: {
      ...config.integration,
      networkModesSupported: config.integration.networkModesSupported,
    },
    host: {
      hostName: hostname(),
      hostOs: process.platform,
      hostArch: process.arch,
    },
    publishedAt: new Date().toISOString(),
  }
}

async function uploadStagedArtifacts(
  client: RunnerControlApiClient,
  runnerNodeId: string,
  task: TaskEnvelopeV2,
  providerResult: Awaited<ReturnType<typeof executeProviderAttempt>>,
): Promise<void> {
  const uploadedUris = new Map<string, string>()

  for (const artifact of providerResult.stagedArtifacts) {
    const contents = await readFile(artifact.artifactPath)
    const response = await client.stageArtifact({
      schemaVersion: 1,
      runnerNodeId,
      leaseAttemptId: task.leaseAttemptId,
      artifactKey: artifact.artifactId,
      contentType: artifact.contentType,
      contentBase64: contents.toString('base64'),
      metadata: {
        localUri: artifact.uri,
        localPath: artifact.artifactPath,
        manifestPath: artifact.manifestPath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      },
    })

    uploadedUris.set(artifact.uri, response.artifactUri)
    artifact.uri = response.artifactUri
    artifact.artifactId = response.artifactId
  }

  if (providerResult.patchRef && uploadedUris.has(providerResult.patchRef)) {
    providerResult.patchRef = uploadedUris.get(providerResult.patchRef) ?? providerResult.patchRef
  }

  if (providerResult.branchRef && uploadedUris.has(providerResult.branchRef)) {
    providerResult.branchRef =
      uploadedUris.get(providerResult.branchRef) ?? providerResult.branchRef
  }
}

function isProviderNotSupportedError(error: unknown): error is Error & {
  code: 'provider_not_supported'
} {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'provider_not_supported'
  )
}

function classifyUnexpectedFailure(
  error: unknown,
  abortReason: AbortReason | null,
  uploadFailed: boolean,
): ProviderFailureClass {
  if (abortReason === 'heartbeat_transport_failure') {
    return 'transport_error'
  }

  if (isProviderNotSupportedError(error)) {
    return 'provider_not_supported'
  }

  if (uploadFailed) {
    return 'artifact_upload_failed'
  }

  return 'worker_error'
}

function resolveControlPlaneRetryDelay(
  config: RunnerHostAppConfig,
): number {
  return Math.min(5_000, Math.max(500, config.pollTimeoutMs))
}

function buildLocalCapabilitySet(config: RunnerHostAppConfig): Set<string> {
  const set = new Set<string>(config.toolBaseline)
  const mcpServerCatalog = buildServerCatalog(config)

  if (mcpServerCatalog.some((entry) => entry.sharingScope !== 'exclusive')) {
    set.add('shared_mcp')
  }
  if (config.workspaceRoot.trim().length > 0) {
    set.add('workspace_access')
    set.add('context_pack_read')
    set.add('repo_guidance_read')
  }
  if (config.worktreeRoot.trim().length > 0) {
    set.add('worktree_management')
  }
  if (config.supportsArtifactUpload) {
    set.add('artifact_upload')
  }
  if (
    config.integration.networkModesSupported.includes('docs_allowlist') &&
    config.integration.allowedDocDomains.length > 0
  ) {
    set.add('network_docs_allowlist')
  }
  if (
    config.integration.networkModesSupported.includes('sandbox_api_allowlist') &&
    config.integration.allowedSandboxDomains.length > 0
  ) {
    set.add('network_sandbox_api_allowlist')
  }
  if (config.integration.supportsBrowserConsent) {
    set.add('browser_consent')
  }
  if (config.integration.supportsSecretBroker) {
    set.add('secret_broker')
  }
  if (config.integration.supportsOAuthBroker) {
    set.add('oauth_broker')
  }
  if (config.integration.supportsIntegrationLab) {
    set.add('integration_lab')
  }

  return set
}

function findMissingRequiredCapabilities(
  config: RunnerHostAppConfig,
  requiredCapabilities: string[],
): string[] {
  const supported = buildLocalCapabilitySet(config)
  return requiredCapabilities.filter((capability) => !supported.has(capability))
}

function isIntegrationHeavyRole(role: string): boolean {
  return role === 'build_agent_integrations' || role === 'integration_agent'
}

async function readResolvedSkillDocs(
  skillBundle: ResolvedSkillBundle,
  executionBundle: RunnerExecutionBundleV1,
): Promise<ProviderResolvedSkillDocument[]> {
  const docs: ProviderResolvedSkillDocument[] = []
  const missingSkillRefs: string[] = []

  for (const skillRef of executionBundle.resolvedSkillRefs) {
    const absolutePath = path.join(skillBundle.skillsRoot, skillRef, 'SKILL.md')

    try {
      docs.push({
        skillRef,
        absolutePath,
        markdown: await readFile(absolutePath, 'utf8'),
      })
    } catch {
      missingSkillRefs.push(skillRef)
    }
  }

  if (missingSkillRefs.length > 0) {
    throw new Error(
      `Managed skill bundle ${skillBundle.releaseId} is missing required local skill docs: ${missingSkillRefs.join(', ')}`,
    )
  }

  return docs
}

export class RunnerHostRuntime {
  private readonly client: RunnerControlApiClient
  private readonly pool: McpPoolManager
  private readonly skillSync: SkillSyncManager
  private readonly activeAttempts = new Set<Promise<void>>()
  private running = false

  constructor(
    private readonly config: RunnerHostAppConfig,
    client?: RunnerControlApiClient,
    pool?: McpPoolManager,
  ) {
    this.client =
      client ??
      new RunnerControlApiClient({
        baseUrl: config.controlApiBaseUrl,
        authToken: config.authToken,
        runnerNodeId: config.runnerNodeId,
      })
    this.pool = pool ?? new McpPoolManager(config)
    this.skillSync = new SkillSyncManager(config, this.client)
  }

  async publishManifest(): Promise<void> {
    await this.client.publishManifest(
      buildRunnerManifest(this.config, this.skillSync.getManifestState()),
    )
  }

  private async publishManifestUntilAvailable(
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.publishManifest()
        return
      } catch (error) {
        console.error('runner-host manifest publish failed', {
          runnerNodeId: this.config.runnerNodeId,
          error,
        })
        await sleep(resolveControlPlaneRetryDelay(this.config))
      }
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    await this.skillSync.initialize()
    await this.publishManifestUntilAvailable(signal)

    try {
      while (!signal.aborted) {
        let claimFailed = false

        if (this.activeAttempts.size === 0) {
          try {
            const manifestChanged = await this.skillSync.refreshActiveRelease()

            if (manifestChanged) {
              await this.publishManifestUntilAvailable(signal)
            }
          } catch (error) {
            console.error('runner-host managed skill refresh failed', {
              runnerNodeId: this.config.runnerNodeId,
              error,
            })
          }
        }

        while (
          this.activeAttempts.size < this.config.maxConcurrentLeases &&
          !signal.aborted
        ) {
          const heartbeatExpiryAt = new Date(
            Date.now() + this.config.heartbeatExpiryMs,
          ).toISOString()
          let claimed: Awaited<ReturnType<RunnerControlApiClient['claimNext']>>

          try {
            claimed = await this.client.claimNext(heartbeatExpiryAt)
          } catch (error) {
            claimFailed = true
            console.error('runner-host lease claim failed', {
              runnerNodeId: this.config.runnerNodeId,
              error,
            })
            break
          }

          if (!claimed.task) {
            break
          }

          if (signal.aborted) {
            break
          }

          const attempt = this.processTask(claimed.task, signal)
          this.activeAttempts.add(attempt)
          attempt.finally(() => this.activeAttempts.delete(attempt))
        }

        if (signal.aborted) {
          break
        }

        if (claimFailed) {
          await sleep(resolveControlPlaneRetryDelay(this.config))
          continue
        }

        if (this.activeAttempts.size === 0) {
          await sleep(this.config.pollTimeoutMs)
        } else {
          await sleep(Math.min(1_000, this.config.heartbeatIntervalMs))
        }
      }
    } finally {
      await Promise.allSettled(this.activeAttempts)
      this.running = false
    }
  }

  private async processTask(task: TaskEnvelopeV2, signal: AbortSignal): Promise<void> {
    const attempts = buildAttemptPaths({
      workspaceRoot: this.config.workspaceRoot,
      worktreeRoot: this.config.worktreeRoot,
      artifactRoot: this.config.artifactRoot,
      runnerNodeId: this.config.runnerNodeId,
      repoSlug: task.repoSlug,
      leaseAttemptId: task.leaseAttemptId,
    })
    let preparedAttempts: PreparedAttemptPaths | null = null
    let heartbeatFailures = 0
    let abortReason: AbortReason | null = null
    let terminalReportAttempted = false
    let terminalReportSucceeded = false
    let terminalReportFailed = false
    let uploadFailed = false
    const attemptSignal = new AbortController()
    const externalAbortHandler = () => {
      requestAbort('shutdown')
    }

    const requestAbort = (reason: AbortReason) => {
      const currentPriority = abortReason === 'heartbeat_transport_failure'
        ? 3
        : abortReason === 'cancel'
          ? 2
          : abortReason === 'shutdown'
            ? 1
            : 0
      const nextPriority =
        reason === 'heartbeat_transport_failure'
          ? 3
          : reason === 'cancel'
            ? 2
            : 1

      if (nextPriority >= currentPriority) {
        abortReason = reason
      }

      if (!attemptSignal.signal.aborted) {
        attemptSignal.abort(new Error(reason))
      }
    }

    const terminalHeartbeat = async (): Promise<void> => {
      if (attemptSignal.signal.aborted || signal.aborted) {
        return
      }

      try {
        const heartbeatResponse = await this.client.heartbeat({
          schemaVersion: 1,
          runnerNodeId: this.config.runnerNodeId,
          leaseAttemptId: task.leaseAttemptId,
          heartbeatExpiryAt: new Date(
            Date.now() + this.config.heartbeatExpiryMs,
          ).toISOString(),
          mcpPoolSnapshot: this.pool.snapshotDetailed(),
        })

        heartbeatFailures = 0

        if (heartbeatResponse.cancelRequested) {
          requestAbort('cancel')
        }
      } catch (error) {
        heartbeatFailures += 1
        console.error('runner-host heartbeat failed', {
          leaseAttemptId: task.leaseAttemptId,
          error,
          heartbeatFailures,
          mcpPoolSnapshot: this.pool.snapshotDetailed(),
        })

        if (heartbeatFailures >= 3) {
          requestAbort('heartbeat_transport_failure')
        }
      }
    }

    const heartbeatInterval = setInterval(() => {
      void terminalHeartbeat()
    }, this.config.heartbeatIntervalMs)
    heartbeatInterval.unref?.()

    const startedAt = Date.now()

    if (signal.aborted) {
      requestAbort('shutdown')
    } else {
      signal.addEventListener('abort', externalAbortHandler, { once: true })
    }

    const reportCompletion = async (
      providerContext: ProviderRunContext,
      providerResult: Awaited<ReturnType<typeof executeProviderAttempt>>,
    ): Promise<void> => {
      terminalReportAttempted = true
      try {
        await this.client.completeAttempt({
          schemaVersion: 1,
          runnerNodeId: this.config.runnerNodeId,
          artifactBundle: buildArtifactBundle(providerContext, providerResult),
          executionMetadata: buildExecutionMetadata(
            providerContext,
            providerResult,
            Date.now() - startedAt,
            providerResult.status,
          ),
        })
        terminalReportSucceeded = true
      } catch (error) {
        terminalReportFailed = true
        throw error
      }
    }

    const reportCancel = async (
      outcome: 'accepted' | 'already_terminal',
    ): Promise<void> => {
      terminalReportAttempted = true
      try {
        await this.client.cancelAttempt({
          schemaVersion: 1,
          runnerNodeId: this.config.runnerNodeId,
          leaseAttemptId: task.leaseAttemptId,
          outcome,
          checkpointRef: task.checkpointRef,
        })
        terminalReportSucceeded = true
      } catch (error) {
        terminalReportFailed = true
        throw error
      }
    }

    const reportFailure = async (
      errorClass: ProviderFailureClass,
      errorMessage: string,
      executionMetadata: Awaited<
        ReturnType<typeof buildExecutionMetadata>
      > | null,
    ): Promise<void> => {
      terminalReportAttempted = true
      try {
        await this.client.failAttempt({
          schemaVersion: 1,
          runnerNodeId: this.config.runnerNodeId,
          leaseAttemptId: task.leaseAttemptId,
          errorClass,
          errorMessage,
          fallbackReason: task.fallbackReason,
          checkpointRef: task.checkpointRef,
          supportsCheckpointResume: this.config.supportsCheckpointResume,
          executionMetadata,
        })
        terminalReportSucceeded = true
      } catch (error) {
        terminalReportFailed = true
        throw error
      }
    }

    const buildPreflightExecutionMetadata = (input: {
      executionBundle: RunnerExecutionBundleV1 | null
      skillBundle: ResolvedSkillBundle | null
      resolvedSkillDocs: ProviderResolvedSkillDocument[]
      contextPack: Awaited<ReturnType<RunnerControlApiClient['fetchContextPack']>> | null
      reviewedBuildArtifact: Awaited<ReturnType<RunnerControlApiClient['fetchArtifact']>> | null
      errorMessage: string
    }) => {
      const preflightContext: ProviderRunContext = {
        config: this.config,
        task,
        attempts:
          preparedAttempts ?? {
            ...attempts,
            branchRef: null,
            checkoutPath: task.localCheckoutPath ?? attempts.workspaceAttemptPath,
            checkoutPathManaged: task.localCheckoutPath == null,
            gitWorktreeSourcePath: null,
            worktreePath: task.worktreePathHint ?? attempts.worktreePath,
          },
        provider: task.effectiveProvider,
        skillBundle: input.skillBundle,
        executionBundle: input.executionBundle,
        resolvedSkillDocs: input.resolvedSkillDocs,
        mcpBindingsSummary: task.mcpBindingsSummary,
        executionSessionKey: task.executionSessionKey,
        cancelSignal: attemptSignal.signal,
        contextPack: input.contextPack,
        reviewedBuildArtifact: input.reviewedBuildArtifact,
      }
      const preflightResult: ProviderExecutionResult = {
        status: 'failed',
        summary: input.errorMessage,
        changedFiles: [],
        testResults: [],
        patchRef: null,
        branchRef: null,
        reviewFindings: [],
        reviewDisposition: null,
        decisionSummary: null,
        recommendedNextAction: null,
        reviewedBuildArtifactId: task.reviewedBuildArtifactId ?? null,
        guardOutcomes: null,
        toolUsage: [],
        providerExecutionMetadata: {
          preflightFailure: true,
          errorMessage: input.errorMessage,
        },
        stagedArtifacts: [],
        producedAt: new Date().toISOString(),
      }

      return buildExecutionMetadata(
        preflightContext,
        preflightResult,
        Date.now() - startedAt,
        'preflight_failed',
      )
    }

    try {
      if (
        this.config.runtimeMode !== 'fake' &&
        resolveProviderCommand(this.config, task.effectiveProvider) === null
      ) {
        await reportFailure(
          'provider_not_supported',
          `Provider ${task.effectiveProvider} is not supported by this runner host`,
          null,
        )
        return
      }

      if (signal.aborted || attemptSignal.signal.aborted) {
        requestAbort('shutdown')
        throw new Error('runner-host task aborted before path preparation')
      }

      preparedAttempts = await prepareAttemptPaths(attempts, {
        branchStrategy: task.branchStrategy,
        checkoutPath: task.localCheckoutPath,
        issueId: task.issueId,
        leaseAttemptId: task.leaseAttemptId,
        worktreePathHint: task.worktreePathHint,
      })

      const [contextPack, reviewedBuildArtifact] = await Promise.all([
        task.contextPackRef
          ? this.client.fetchContextPack(task.contextPackRef)
          : Promise.resolve(null),
        task.reviewedBuildArtifactId
          ? this.client.fetchArtifact(task.reviewedBuildArtifactId)
          : Promise.resolve(null),
      ])

      if (signal.aborted || attemptSignal.signal.aborted) {
        requestAbort('shutdown')
        throw new Error('runner-host task aborted after path preparation')
      }

      const executionBundle = task.agentLibraryReleaseId
        ? await this.client.fetchExecutionBundle(task.leaseAttemptId)
        : null
      const skillBundle = await this.skillSync.resolveExecutionBundle(
        task.agentLibraryReleaseId,
      )

      if (task.agentLibraryReleaseId && skillBundle === null) {
        const errorMessage = `Managed skill bundle ${task.agentLibraryReleaseId} is not installed on runner ${this.config.runnerNodeId}.`
        await reportFailure(
          'worker_error',
          errorMessage,
          buildPreflightExecutionMetadata({
            executionBundle,
            skillBundle,
            resolvedSkillDocs: [],
            contextPack,
            reviewedBuildArtifact,
            errorMessage,
          }),
        )
        return
      }

      let resolvedSkillDocs: ProviderResolvedSkillDocument[] = []

      if (executionBundle && skillBundle) {
        try {
          resolvedSkillDocs = await readResolvedSkillDocs(
            skillBundle,
            executionBundle,
          )
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Failed to read required local skill docs'
          await reportFailure(
            'worker_error',
            errorMessage,
            buildPreflightExecutionMetadata({
              executionBundle,
              skillBundle,
              resolvedSkillDocs: [],
              contextPack,
              reviewedBuildArtifact,
              errorMessage,
            }),
          )
          return
        }
      }

      const missingRequiredCapabilities = executionBundle
        ? findMissingRequiredCapabilities(
            this.config,
            executionBundle.roleExecutionPolicy.requiredCapabilities,
          )
        : []

      if (missingRequiredCapabilities.length > 0) {
        const errorMessage = isIntegrationHeavyRole(task.agentRole)
          ? `Runner ${this.config.runnerNodeId} no longer satisfies integration capability fit for ${task.agentRole}: ${missingRequiredCapabilities.join(', ')}`
          : `Runner ${this.config.runnerNodeId} no longer satisfies required capabilities for ${task.agentRole}: ${missingRequiredCapabilities.join(', ')}`

        console.error('runner-host preflight capability mismatch', {
          leaseAttemptId: task.leaseAttemptId,
          agentRole: task.agentRole,
          requiredCapabilities:
            executionBundle?.roleExecutionPolicy.requiredCapabilities ?? [],
          missingRequiredCapabilities,
          integrationHeavyRole: isIntegrationHeavyRole(task.agentRole),
        })
        await reportFailure(
          'worker_error',
          errorMessage,
          buildPreflightExecutionMetadata({
            executionBundle,
            skillBundle,
            resolvedSkillDocs,
            contextPack,
            reviewedBuildArtifact,
            errorMessage,
          }),
        )
        return
      }

      const realizedBindings = this.pool.acquireBindings(task.mcpBindingsSummary, {
        executionSessionKey: task.executionSessionKey,
        repoSlug: task.repoSlug,
        configHash: this.config.mcpConfigHash,
      })

      if (signal.aborted || attemptSignal.signal.aborted) {
        requestAbort('shutdown')
        throw new Error('runner-host task aborted after MCP acquisition')
      }

      const executionStarted: RunnerExecutionStartedRequestV1 = {
        schemaVersion: 1,
        runnerNodeId: this.config.runnerNodeId,
        leaseAttemptId: task.leaseAttemptId,
        executionSessionKey: task.executionSessionKey,
        mcpBindingsSummary: realizedBindings,
      }

      if (signal.aborted || attemptSignal.signal.aborted) {
        requestAbort('shutdown')
        throw new Error('runner-host task aborted before execution start')
      }

      await this.client.executionStarted(executionStarted)
      await terminalHeartbeat()

      const providerContext: ProviderRunContext = {
        config: this.config,
        task,
        attempts: preparedAttempts,
        provider: task.effectiveProvider,
        skillBundle,
        executionBundle,
        resolvedSkillDocs,
        mcpBindingsSummary: realizedBindings,
        executionSessionKey: task.executionSessionKey,
        cancelSignal: attemptSignal.signal,
        contextPack,
        reviewedBuildArtifact,
      }

      console.info('runner-host executing provider attempt', {
        leaseAttemptId: task.leaseAttemptId,
        provider: task.effectiveProvider,
        runKind: task.runKind,
        contextPackFingerprint: task.contextPackFingerprint,
        agentLibraryReleaseId: task.agentLibraryReleaseId,
        taskInstructionsRef: executionBundle?.taskInstructionsRef ?? null,
        roleCharterRef: executionBundle?.roleCharterRef ?? null,
        resolvedPromptFamilyRefs:
          executionBundle?.resolvedPromptFamilyRefs ?? [],
        skillPackRefs: executionBundle?.skillPackRefs ?? task.skillPackRefs,
        resolvedSkillRefs: executionBundle?.resolvedSkillRefs ?? [],
        skippedOptionalSkillRefs:
          executionBundle?.skippedOptionalSkillRefs ?? [],
        promptBundleFingerprint:
          executionBundle?.promptBundleFingerprint ??
          task.promptBundleFingerprint,
        effectiveSkillFingerprint: task.effectiveSkillFingerprint,
        sourceArtifactIds: task.reviewedBuildArtifactId
          ? [task.reviewedBuildArtifactId]
          : [],
      })

      const providerResult = await executeProviderAttempt(providerContext)

      if (!providerResult.branchRef && preparedAttempts.branchRef) {
        providerResult.branchRef = preparedAttempts.branchRef
      }

      if (
        this.config.supportsArtifactUpload &&
        providerResult.stagedArtifacts.length > 0
      ) {
        try {
          await uploadStagedArtifacts(
            this.client,
            this.config.runnerNodeId,
            task,
            providerResult,
          )
        } catch (error) {
          uploadFailed = true
          throw error
        }
      }

      const executionMetadata = buildExecutionMetadata(
        providerContext,
        providerResult,
        Date.now() - startedAt,
        providerResult.status,
      )

      if (abortReason === 'heartbeat_transport_failure') {
        await reportFailure(
          'transport_error',
          providerResult.summary ?? 'heartbeat transport budget exhausted',
          executionMetadata,
        )
      } else if (providerResult.status === 'completed' && !attemptSignal.signal.aborted) {
        await reportCompletion(providerContext, providerResult)
      } else if (
        providerResult.status === 'completed' &&
        attemptSignal.signal.aborted
      ) {
        await reportCompletion(providerContext, providerResult)
        await reportCancel('already_terminal')
      } else if (attemptSignal.signal.aborted || providerResult.status === 'canceled') {
        await reportCancel('accepted')
      } else {
        await reportFailure(
          classifyUnexpectedFailure(null, abortReason, uploadFailed),
          providerResult.summary ?? 'provider attempt failed',
          executionMetadata,
        )
      }
    } catch (error) {
      console.error('runner-host task failed', {
        leaseAttemptId: task.leaseAttemptId,
        error,
      })

      if (!terminalReportAttempted) {
        const failureMessage =
          error instanceof Error ? error.message : 'unexpected runner-host failure'
        const failureClass = classifyUnexpectedFailure(error, abortReason, uploadFailed)

        await reportFailure(failureClass, failureMessage, null)
      } else if (!terminalReportSucceeded) {
        terminalReportFailed = true
      }
    } finally {
      clearInterval(heartbeatInterval)
      signal.removeEventListener('abort', externalAbortHandler)
      this.pool.releaseExecutionSession(task.executionSessionKey)

      if (terminalReportSucceeded && !terminalReportFailed) {
        await cleanupAttemptPaths(
          preparedAttempts ?? {
            ...attempts,
            branchRef: null,
            checkoutPath: task.localCheckoutPath ?? attempts.workspaceAttemptPath,
            checkoutPathManaged: task.localCheckoutPath == null,
            gitWorktreeSourcePath: null,
            worktreePath: task.worktreePathHint ?? attempts.worktreePath,
          },
        )
      } else {
        console.warn('runner-host preserved local attempt state after terminal report failure', {
          leaseAttemptId: task.leaseAttemptId,
          worktreePath: preparedAttempts?.worktreePath ?? attempts.worktreePath,
          artifactAttemptRoot:
            preparedAttempts?.artifactAttemptRoot ?? attempts.artifactAttemptRoot,
        })
      }
    }
  }
}
