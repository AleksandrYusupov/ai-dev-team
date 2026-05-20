import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

import type {
  RunnerArtifactResourceV1,
  RunnerCapabilityManifestV1,
  RunnerContextPackResourceV1,
  RunnerExecutionStartedRequestV1,
  RunnerHeartbeatResponseV1,
  RunnerLeaseClaimResponseV1,
  RunnerManifestUpsertResponseV1,
  RunnerArtifactStageRequestV1,
  RunnerArtifactStageResponseV1,
  RunnerAttemptCompletionRequestV1,
  RunnerAttemptFailureRequestV1,
  RunnerAttemptCancelResponseV1,
  RunnerExecutionBundleV1,
  TaskEnvelopeV2,
} from '@ai-dev-team/shared'

import { loadRunnerHostAppConfig } from './config.js'
import type { RunnerControlApiClient } from './control-api-client.js'
import type { McpPoolManager } from './mcp-pool.js'
import { RunnerHostRuntime } from './runtime.js'

class TestControlApiClient {
  public manifest: RunnerCapabilityManifestV1 | null = null
  public started: RunnerExecutionStartedRequestV1 | null = null
  public completed: RunnerAttemptCompletionRequestV1 | null = null
  public failure: RunnerAttemptFailureRequestV1 | null = null
  public executionBundleCalls = 0
  public operationLog: string[] = []
  public lastHeartbeatPayload: {
    leaseAttemptId: string
    schemaVersion: 1
    runnerNodeId: string
    heartbeatExpiryAt: string
    mcpPoolSnapshot?: unknown
  } | null = null
  public heartbeats = 0

  private claimed = false

  constructor(
    private readonly runnerNodeId: string,
    private readonly task: TaskEnvelopeV2,
    private readonly abortController: AbortController,
    private readonly options: {
      failCompletion?: boolean
      heartbeatFailureMode?: 'throw' | 'ok'
      publishManifestFailureCount?: number
      claimFailureCount?: number
      abortAfterClaim?: boolean
      executionBundleOverride?:
        | RunnerExecutionBundleV1
        | ((task: TaskEnvelopeV2) => RunnerExecutionBundleV1)
    } = {},
  ) {}

  async publishManifest(
    manifest: RunnerCapabilityManifestV1,
  ): Promise<RunnerManifestUpsertResponseV1> {
    if ((this.options.publishManifestFailureCount ?? 0) > 0) {
      this.options.publishManifestFailureCount =
        (this.options.publishManifestFailureCount ?? 0) - 1
      throw new Error('manifest publish transport failed')
    }

    this.manifest = manifest

    return { schemaVersion: 1, accepted: true }
  }

  async claimNext(
    heartbeatExpiryAt: string,
  ): Promise<RunnerLeaseClaimResponseV1> {
    void heartbeatExpiryAt

    if ((this.options.claimFailureCount ?? 0) > 0) {
      this.options.claimFailureCount =
        (this.options.claimFailureCount ?? 0) - 1
      throw new Error('claim-next transport failed')
    }

    if (this.claimed) {
      return { schemaVersion: 1, task: null }
    }

    this.claimed = true

    if (this.options.abortAfterClaim) {
      this.abortController.abort(new Error('abort after claim'))
    }

    return { schemaVersion: 1, task: this.task }
  }

  async executionStarted(
    payload: RunnerExecutionStartedRequestV1,
  ): Promise<void> {
    this.operationLog.push('executionStarted')
    this.started = payload
    void this.runnerNodeId
  }

  async fetchContextPack(): Promise<RunnerContextPackResourceV1> {
    this.operationLog.push('fetchContextPack')
    return {
      schemaVersion: 1,
      contextPackId: 'ctx-pack-1',
      issueId: this.task.issueId,
      inputFingerprint: this.task.contextPackFingerprint ?? 'ctx-fingerprint-1',
      bundle: {
        issue: {
          issueId: this.task.issueId,
          goal: 'Verify runner-host runtime',
          background: null,
          scope: ['runtime'],
          nonGoals: [],
          acceptanceCriteria: ['tests pass'],
          verificationPath: { automated: ['node --test'], manual: [] },
          doneWhen: ['runtime completes'],
          risk: null,
          dependencies: {
            blocks: [],
            blockedBy: [],
            external: [],
          },
          primaryRepo: this.task.repoSlug ?? 'acme/repo',
          affectedRepos: [],
          docsLinks: [],
          openQuestions: [],
          issueType: null,
          source: null,
          mode: null,
          humanDecisionRequired: false,
        },
        repositories: [],
        latestRelevantComments: [],
        docsPack: [],
        repoGuidance: [],
        integrationArtifacts: [],
        decisionSummary: [],
        budgets: {
          contextPolicyVersion: 1,
          estimatedTokens: 250,
          maxTokens: 1000,
          commentCount: 0,
          noteCount: 0,
          truncatedSections: [],
        },
        sourceTrace: {
          issueContractSnapshotId: 'contract-snapshot-1',
          issueContractSnapshotHash: 'contract-hash-1',
          mappingIds: [],
          noteSnapshotRefs: [],
          repoGuidanceRefs: [],
          commentRefs: [],
          artifactRefs: [],
          warnings: [],
        },
      },
      createdAt: new Date().toISOString(),
    }
  }

  async fetchArtifact(): Promise<RunnerArtifactResourceV1> {
    this.operationLog.push('fetchArtifact')
    return {
      schemaVersion: 1,
      artifactId: this.task.reviewedBuildArtifactId ?? 'artifact-1',
      issueId: this.task.issueId,
      runId: this.task.runId,
      artifactType: 'runner_artifact_bundle',
      artifactUri: 'system://artifact/test',
      artifactSummary: 'test artifact',
      metadata: {},
      producedAt: new Date().toISOString(),
      supersededAt: null,
    }
  }

  async fetchExecutionBundle(): Promise<RunnerExecutionBundleV1> {
    this.executionBundleCalls += 1
    this.operationLog.push('fetchExecutionBundle')

    if (typeof this.options.executionBundleOverride === 'function') {
      return this.options.executionBundleOverride(this.task)
    }

    if (this.options.executionBundleOverride) {
      return this.options.executionBundleOverride
    }

    return {
      schemaVersion: 1,
      leaseAttemptId: this.task.leaseAttemptId,
      agentLibraryReleaseId: this.task.agentLibraryReleaseId ?? 'v1',
      agentLibraryFingerprint: 'library-fingerprint-v1',
      taskInstructionsRef: this.task.taskInstructionsRef ?? 'instructions',
      promptVersion: this.task.promptVersion ?? 'v1',
      roleCharterRef:
        this.task.roleCharterRef ??
        'agent-library://releases/v1/role-charters/build_agent_backend',
      promptBundleFingerprint:
        this.task.promptBundleFingerprint ?? 'bundle-fingerprint-1',
      resolvedPromptFamilyRefs: [
        'global-baseline',
        this.task.runKind === 'review' ? 'review' : 'build',
      ],
      skillPackRefs: this.task.skillPackRefs,
      resolvedSkillRefs: ['fake-runner'],
      skippedOptionalSkillRefs: ['fake-mcp'],
      systemInstruction: null,
      roleCharter: {
        roleCharterRef:
          this.task.roleCharterRef ??
          'agent-library://releases/v1/role-charters/build_agent_backend',
        roleId: this.task.agentRole,
        charterVersion: 'v1',
        canonicalRunKind: this.task.runKind,
        frontmatterSummary: {
          owner_role: this.task.agentRole,
        },
        sourceRefs: ['role-charters/build_agent_backend.md'],
        relativePath: 'role-charters/build_agent_backend.md',
        roleFingerprint: 'role-fingerprint-1',
        body: '# Role charter\nDeliver precise execution.',
      },
      promptFamilies: [
        {
          promptFamilyRef: 'global-baseline',
          familyId: 'global-baseline',
          familyVersion: 'v1',
          providerCompatibility: ['codex', 'claude'],
          compatibleRoles: [this.task.agentRole],
          compatibleSkillPacks: this.task.skillPackRefs,
          sourceRefs: ['config/agents/prompt-families/global-baseline/v1.md'],
          relativePath: 'config/agents/prompt-families/global-baseline/v1.md',
          familyFingerprint: 'family-fingerprint-global',
          body: '# Global baseline\nUse the repo as source of truth.',
        },
        {
          promptFamilyRef: this.task.runKind === 'review' ? 'review' : 'build',
          familyId: this.task.runKind === 'review' ? 'review' : 'build',
          familyVersion: 'v1',
          providerCompatibility: ['codex', 'claude'],
          compatibleRoles: [this.task.agentRole],
          compatibleSkillPacks: this.task.skillPackRefs,
          sourceRefs: ['config/agents/prompt-families/build/v1.md'],
          relativePath: 'config/agents/prompt-families/build/v1.md',
          familyFingerprint: 'family-fingerprint-role',
          body: '# Build family\nKeep changes minimal.',
        },
      ],
      skillPacks: [
        {
          packId: this.task.skillPackRefs[0] ?? 'build_backend_core',
          packVersion: 'v1',
          purpose: 'Test bundle',
          skillRefs: ['fake-runner'],
          optionalSkillRefs: ['fake-mcp'],
          providers: ['codex', 'claude'],
          activationConditions: {},
          promptFamilyRefs: ['build'],
          deniedActionsOverlay: [],
          humanGateOverlay: {},
          sourceRefs: ['config/agents/skill-packs/build_backend_core.yaml'],
          skillPackFingerprint: 'skill-pack-fingerprint-1',
        },
      ],
      runtimeRoleContract: {
        roleId: this.task.agentRole,
        canonicalRunKind: this.task.runKind,
        allowedStatusOwnership: ['coding'],
        requiredInputArtifactTypes: [],
        requiredOutputArtifactTypes: ['build_report'],
        humanGatePolicy: {
          mode: this.task.runKind === 'review' ? 'always' : 'conditional',
          requiredHumanOwnedZones: [],
          notes: null,
        },
        escalationReasonCodes: [],
        activationMode: 'active',
      },
      roleExecutionPolicy: {
        ownerRole: this.task.agentRole,
        primaryProvider: this.task.effectiveProvider,
        secondaryProvider: this.task.effectiveProvider,
        fallbackTriggers: [],
        maxProviderFailovers: 0,
        mcpProfileRef: this.task.mcpProfileRef,
        requiredCapabilities: ['workspace_access'],
      },
    }
  }

  async heartbeat(payload: {
    leaseAttemptId: string
    schemaVersion: 1
    runnerNodeId: string
    heartbeatExpiryAt: string
    mcpPoolSnapshot?: unknown
  }): Promise<RunnerHeartbeatResponseV1> {
    this.heartbeats += 1
    this.lastHeartbeatPayload = payload

    if (this.options.heartbeatFailureMode === 'throw') {
      throw new Error('heartbeat transport failed')
    }

    return { schemaVersion: 1, cancelRequested: false }
  }

  async stageArtifact(
    payload: RunnerArtifactStageRequestV1,
  ): Promise<RunnerArtifactStageResponseV1> {
    const content = Buffer.from(payload.contentBase64, 'base64')

    return {
      schemaVersion: 1,
      artifactId: payload.artifactKey,
      artifactUri: payload.artifactKey,
      contentSha256: '',
      sizeBytes: content.byteLength,
    }
  }

  async completeAttempt(
    payload: RunnerAttemptCompletionRequestV1,
  ): Promise<void> {
    this.completed = payload

    if (this.options.failCompletion) {
      throw new Error('terminal completion failed')
    }

    this.abortController.abort(new Error('runtime completed'))
  }

  async failAttempt(
    payload: RunnerAttemptFailureRequestV1,
  ): Promise<void> {
    this.failure = payload
    this.abortController.abort(new Error('runtime failed'))
  }

  async cancelAttempt(): Promise<RunnerAttemptCancelResponseV1> {
    this.abortController.abort(new Error('runtime canceled'))

    return {
      schemaVersion: 1,
      leaseStatus: 'cancellation_requested',
      cancelOutcome: 'accepted',
    }
  }
}

function buildTask(overrides: Partial<TaskEnvelopeV2> = {}): TaskEnvelopeV2 {
  return {
    schemaVersion: 2,
    leaseId: 'lease-1',
    leaseAttemptId: 'attempt-1',
    issueId: 'issue-1',
    runId: 'run-1',
    workflowId: 'workflow-1',
    requestedProvider: 'codex',
    effectiveProvider: 'codex',
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'build_agent',
    runKind: 'build',
    repoSlug: 'acme/repo',
    localCheckoutPath: overrides.localCheckoutPath ?? null,
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: overrides.worktreePathHint ?? null,
    contextPackRef: null,
    contextPackFingerprint: null,
    reviewedBuildArtifactId: null,
    checkpointRef: null,
    executionSessionKey: 'session-1',
    mcpProfileRef: 'default',
    mcpBindingsSummary: [],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: 'instructions',
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: 'bundle-fingerprint-1',
    skillPackRefs: ['build_backend_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: ['serena'],
    expectedOutputs: ['summary'],
    issuedAt: new Date().toISOString(),
    ...overrides,
  }
}

function buildAbortAwarePool(
  abortController: AbortController,
  options: {
    abortDuringAcquire?: boolean
  } = {},
) {
  const binding = {
    serverName: 'serena',
    sharingScope: 'repo' as const,
    bindingKey: 'serena|repo|acme/repo|config-hash',
    reused: false,
    repoSlug: 'acme/repo',
  }

  let acquireCalls = 0
  let releaseCalls = 0

  const pool: unknown = {
    acquireCalls: () => acquireCalls,
    releaseCalls: () => releaseCalls,
    acquireBindings: () => {
      acquireCalls += 1

      if (options.abortDuringAcquire) {
        abortController.abort(new Error('abort during acquire'))
      }

      return [binding]
    },
    releaseExecutionSession: () => {
      releaseCalls += 1
    },
    snapshotDetailed: () => ({
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      configHash: 'config-hash',
      capturedAt: new Date().toISOString(),
      bindings: [],
    }),
  }

  return pool as McpPoolManager & {
    acquireCalls(): number
    releaseCalls(): number
  }
}

test('runner-host retries manifest publish until the control API becomes reachable', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-publish-retry-'))
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); fs.writeFileSync(process.env.RUNNER_RESULT_FILE, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    buildTask({
      localCheckoutPath: path.join(sandboxRoot, 'checkout'),
      worktreePathHint: path.join(sandboxRoot, 'worktree'),
    }),
    abortController,
    {
      publishManifestFailureCount: 1,
    },
  )
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
  )

  await runtime.run(abortController.signal)

  assert.ok(client.manifest)
  assert.ok(client.completed)
  assert.deepEqual(
    client.operationLog.slice(0, 2),
    ['fetchExecutionBundle', 'executionStarted'],
  )
  assert.ok(client.heartbeats >= 1)
  assert.ok(client.lastHeartbeatPayload?.mcpPoolSnapshot)

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host retries lease claims after transient control-plane transport failures', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-claim-retry-'))
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); fs.writeFileSync(process.env.RUNNER_RESULT_FILE, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    buildTask({
      localCheckoutPath: path.join(sandboxRoot, 'checkout'),
      worktreePathHint: path.join(sandboxRoot, 'worktree'),
    }),
    abortController,
    {
      claimFailureCount: 1,
    },
  )
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
  )

  await runtime.run(abortController.signal)

  assert.ok(client.manifest)
  assert.ok(client.completed)

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host fails before provider launch when required local skills are missing', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-missing-skill-'))
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); fs.writeFileSync(process.env.RUNNER_RESULT_FILE, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    buildTask({
      localCheckoutPath: path.join(sandboxRoot, 'checkout'),
      worktreePathHint: path.join(sandboxRoot, 'worktree'),
    }),
    abortController,
    {
      executionBundleOverride: (task) => ({
        schemaVersion: 1,
        leaseAttemptId: task.leaseAttemptId,
        agentLibraryReleaseId: 'v1',
        agentLibraryFingerprint: 'library-fingerprint-v1',
        taskInstructionsRef:
          'agent-library://releases/v1/prompt-bundles/build_agent',
        promptVersion: 'v1',
        roleCharterRef:
          'agent-library://releases/v1/role-charters/build_agent_backend',
        promptBundleFingerprint: 'bundle-fingerprint-1',
        resolvedPromptFamilyRefs: ['global-baseline', 'build'],
        skillPackRefs: ['build_backend_core'],
        resolvedSkillRefs: ['missing-skill'],
        skippedOptionalSkillRefs: [],
        systemInstruction: null,
        roleCharter: {
          roleCharterRef:
            'agent-library://releases/v1/role-charters/build_agent_backend',
          roleId: task.agentRole,
          charterVersion: 'v1',
          canonicalRunKind: task.runKind,
          frontmatterSummary: {},
          sourceRefs: [],
          relativePath: 'role-charters/build_agent_backend.md',
          roleFingerprint: 'role-fingerprint-1',
          body: '# Role charter\n',
        },
        promptFamilies: [],
        skillPacks: [
          {
            packId: 'build_backend_core',
            packVersion: 'v1',
            purpose: 'Backend implementation',
            skillRefs: ['missing-skill'],
            optionalSkillRefs: [],
            providers: ['codex', 'claude'],
            activationConditions: {},
            promptFamilyRefs: ['build'],
            deniedActionsOverlay: [],
            humanGateOverlay: {},
            sourceRefs: [],
            skillPackFingerprint: 'skill-pack-fingerprint-1',
          },
        ],
        runtimeRoleContract: {
          roleId: task.agentRole,
          canonicalRunKind: task.runKind,
          allowedStatusOwnership: ['coding'],
          requiredInputArtifactTypes: [],
          requiredOutputArtifactTypes: ['build_report'],
          humanGatePolicy: {
            mode: 'conditional',
            requiredHumanOwnedZones: [],
            notes: null,
          },
          escalationReasonCodes: [],
          activationMode: 'active',
        },
        roleExecutionPolicy: {
          ownerRole: task.agentRole,
          primaryProvider: task.effectiveProvider,
          secondaryProvider: task.effectiveProvider,
          fallbackTriggers: [],
          maxProviderFailovers: 0,
          mcpProfileRef: task.mcpProfileRef,
          requiredCapabilities: ['workspace_access'],
        },
      }),
    },
  )
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
  )

  await runtime.run(abortController.signal)

  assert.equal(client.started, null)
  assert.ok(client.failure)
  assert.match(
    client.failure?.errorMessage ?? '',
    /missing required local skill docs/,
  )

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host fails before provider launch when integration capability fit no longer holds', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-capability-mismatch-'))
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); fs.writeFileSync(process.env.RUNNER_RESULT_FILE, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    buildTask({
      agentRole: 'build_agent_integrations',
      localCheckoutPath: path.join(sandboxRoot, 'checkout'),
      worktreePathHint: path.join(sandboxRoot, 'worktree'),
    }),
    abortController,
    {
      executionBundleOverride: (task) => ({
        schemaVersion: 1,
        leaseAttemptId: task.leaseAttemptId,
        agentLibraryReleaseId: 'v1',
        agentLibraryFingerprint: 'library-fingerprint-v1',
        taskInstructionsRef:
          'agent-library://releases/v1/prompt-bundles/build_agent_integrations',
        promptVersion: 'v1',
        roleCharterRef:
          'agent-library://releases/v1/role-charters/build_agent_integrations',
        promptBundleFingerprint: 'bundle-fingerprint-1',
        resolvedPromptFamilyRefs: ['global-baseline', 'integration', 'build'],
        skillPackRefs: ['build_integrations_core'],
        resolvedSkillRefs: ['fake-runner'],
        skippedOptionalSkillRefs: [],
        systemInstruction: null,
        roleCharter: {
          roleCharterRef:
            'agent-library://releases/v1/role-charters/build_agent_integrations',
          roleId: task.agentRole,
          charterVersion: 'v1',
          canonicalRunKind: task.runKind,
          frontmatterSummary: {},
          sourceRefs: [],
          relativePath: 'role-charters/build_agent_integrations.md',
          roleFingerprint: 'role-fingerprint-1',
          body: '# Role charter\n',
        },
        promptFamilies: [],
        skillPacks: [
          {
            packId: 'build_integrations_core',
            packVersion: 'v1',
            purpose: 'Integration implementation',
            skillRefs: ['fake-runner'],
            optionalSkillRefs: [],
            providers: ['codex', 'claude'],
            activationConditions: {},
            promptFamilyRefs: ['integration', 'build'],
            deniedActionsOverlay: [],
            humanGateOverlay: {},
            sourceRefs: [],
            skillPackFingerprint: 'skill-pack-fingerprint-1',
          },
        ],
        runtimeRoleContract: {
          roleId: task.agentRole,
          canonicalRunKind: task.runKind,
          allowedStatusOwnership: ['coding'],
          requiredInputArtifactTypes: [],
          requiredOutputArtifactTypes: ['build_report'],
          humanGatePolicy: {
            mode: 'conditional',
            requiredHumanOwnedZones: [],
            notes: null,
          },
          escalationReasonCodes: [],
          activationMode: 'active',
        },
        roleExecutionPolicy: {
          ownerRole: task.agentRole,
          primaryProvider: task.effectiveProvider,
          secondaryProvider: task.effectiveProvider,
          fallbackTriggers: [],
          maxProviderFailovers: 0,
          mcpProfileRef: task.mcpProfileRef,
          requiredCapabilities: ['oauth_broker'],
        },
      }),
    },
  )
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
  )

  await runtime.run(abortController.signal)

  assert.equal(client.started, null)
  assert.ok(client.failure)
  assert.match(
    client.failure?.errorMessage ?? '',
    /integration capability fit/,
  )

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host never sends executionStarted when the signal aborts before path preparation', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-prep-abort-'))
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); fs.writeFileSync(process.env.RUNNER_RESULT_FILE, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const task = buildTask({
    localCheckoutPath: path.join(sandboxRoot, 'checkout'),
    worktreePathHint: path.join(sandboxRoot, 'worktree'),
    mcpBindingsSummary: [
      {
        serverName: 'serena',
        sharingScope: 'repo',
        bindingKey: 'serena|repo|acme/repo|cfg',
        reused: false,
        repoSlug: 'acme/repo',
      },
    ],
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    task,
    abortController,
  )
  const claimOverrideClient = client as TestControlApiClient & {
    claimNext: (heartbeatExpiryAt: string) => Promise<RunnerLeaseClaimResponseV1>
  }
  claimOverrideClient.claimNext = async () => {
    abortController.abort(new Error('abort before path preparation'))
    return { schemaVersion: 1, task }
  }
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
  )

  await runtime.run(abortController.signal)

  assert.equal(client.started, null)
  assert.equal(client.completed, null)
  assert.equal(client.failure, null)

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host never sends executionStarted when the signal aborts after MCP acquisition', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-mcp-abort-'))
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); fs.writeFileSync(process.env.RUNNER_RESULT_FILE, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const task = buildTask({
    localCheckoutPath: path.join(sandboxRoot, 'checkout'),
    worktreePathHint: path.join(sandboxRoot, 'worktree'),
    mcpBindingsSummary: [
      {
        serverName: 'serena',
        sharingScope: 'repo',
        bindingKey: 'serena|repo|acme/repo|cfg',
        reused: false,
        repoSlug: 'acme/repo',
      },
    ],
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    task,
    abortController,
  )
  let releasedExecutionSessionKey: string | null = null
  const pool = {
    acquireBindings: (bindings: typeof task.mcpBindingsSummary) => {
      abortController.abort(new Error('abort after MCP acquisition'))
      return bindings
    },
    releaseExecutionSession: (executionSessionKey: string) => {
      releasedExecutionSessionKey = executionSessionKey
    },
    snapshotDetailed: () => ({
      schemaVersion: 1,
      runnerNodeId: config.runnerNodeId,
      configHash: config.mcpConfigHash,
      capturedAt: new Date().toISOString(),
      bindings: [],
    }),
  }
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
    pool as never,
  )

  await runtime.run(abortController.signal)

  assert.equal(client.started, null)
  assert.equal(client.completed, null)
  assert.equal(client.failure?.errorClass, 'worker_error')
  assert.equal(releasedExecutionSessionKey, task.executionSessionKey)

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host does not send executionStarted when claimNext aborts before path preparation', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-abort-before-prepare-'))
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); fs.writeFileSync(process.env.RUNNER_RESULT_FILE, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const task = buildTask({
    localCheckoutPath: path.join(sandboxRoot, 'checkout'),
    worktreePathHint: path.join(sandboxRoot, 'worktree'),
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    task,
    abortController,
  )
  const pool = buildAbortAwarePool(abortController)
  const claimOverrideClient = client as TestControlApiClient & {
    claimNext: (heartbeatExpiryAt: string) => Promise<RunnerLeaseClaimResponseV1>
  }
  claimOverrideClient.claimNext = async () => {
    abortController.abort(new Error('abort before path preparation'))
    return { schemaVersion: 1, task }
  }
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
    pool,
  )

  await runtime.run(abortController.signal)

  assert.equal(client.started, null)
  assert.equal(client.completed, null)
  assert.equal(pool.acquireCalls(), 0)
  assert.equal(pool.releaseCalls(), 0)

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host does not send executionStarted when acquireBindings aborts before provider execution', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-abort-after-bindings-'))
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); fs.writeFileSync(process.env.RUNNER_RESULT_FILE, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const task = buildTask({
    localCheckoutPath: path.join(sandboxRoot, 'checkout'),
    worktreePathHint: path.join(sandboxRoot, 'worktree'),
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    task,
    abortController,
  )
  const pool = buildAbortAwarePool(abortController, {
    abortDuringAcquire: true,
  })
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
    pool,
  )

  await runtime.run(abortController.signal)

  assert.equal(client.started, null)
  assert.equal(client.completed, null)
  assert.ok(client.failure)
  assert.equal(pool.acquireCalls(), 1)
  assert.equal(pool.releaseCalls(), 1)

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host preserves local attempt state when terminal completion ack fails', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-preserve-'))
  const workspaceRoot = path.join(sandboxRoot, 'workspace')
  const worktreeRoot = path.join(sandboxRoot, 'worktrees')
  const artifactRoot = path.join(sandboxRoot, 'artifacts')
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: workspaceRoot,
    RUNNER_WORKTREE_ROOT: worktreeRoot,
    RUNNER_ARTIFACT_ROOT: artifactRoot,
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); const result=process.env.RUNNER_RESULT_FILE; fs.writeFileSync(result, JSON.stringify({status:'completed',summary:'done',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['test'],providerExecutionMetadata:{mode:'fake'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const task = buildTask({
    localCheckoutPath: path.join(sandboxRoot, 'checkout'),
    worktreePathHint: path.join(sandboxRoot, 'worktree'),
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    task,
    abortController,
    {
      failCompletion: true,
    },
  )
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
  )

  const stopTimer = setTimeout(
    () => abortController.abort(new Error('stop test')),
    1_000,
  )

  try {
    await runtime.run(abortController.signal)
  } finally {
    clearTimeout(stopTimer)
  }

  assert.ok(client.completed)
  assert.equal(client.failure, null)
  await assert.doesNotReject(stat(task.worktreePathHint as string))
  await assert.doesNotReject(stat(task.localCheckoutPath as string))

  await rm(sandboxRoot, { recursive: true, force: true })
})

test('runner-host aborts after repeated heartbeat transport failures', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-runtime-heartbeat-'))
  const workspaceRoot = path.join(sandboxRoot, 'workspace')
  const worktreeRoot = path.join(sandboxRoot, 'worktrees')
  const artifactRoot = path.join(sandboxRoot, 'artifacts')
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_WORKSPACE_ROOT: workspaceRoot,
    RUNNER_WORKTREE_ROOT: worktreeRoot,
    RUNNER_ARTIFACT_ROOT: artifactRoot,
    RUNNER_POLL_TIMEOUT_MS: '25',
    RUNNER_HEARTBEAT_INTERVAL_MS: '25',
    RUNNER_FAKE_PROVIDER_COMMAND: 'node -e "setInterval(() => {}, 1000)"',
  })
  const task = buildTask({
    localCheckoutPath: path.join(sandboxRoot, 'checkout'),
    worktreePathHint: path.join(sandboxRoot, 'worktree'),
  })
  const abortController = new AbortController()
  const client = new TestControlApiClient(
    config.runnerNodeId,
    task,
    abortController,
    {
      heartbeatFailureMode: 'throw',
    },
  )
  const runtime = new RunnerHostRuntime(
    config,
    client as unknown as RunnerControlApiClient,
  )

  await runtime.run(abortController.signal)

  assert.equal(client.failure?.errorClass, 'transport_error')
  assert.ok(client.heartbeats >= 3)
  assert.ok(client.lastHeartbeatPayload?.mcpPoolSnapshot)

  await rm(sandboxRoot, { recursive: true, force: true })
})
