import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

import type {
  RunnerAttemptCancelResponseV1,
  RunnerArtifactStageResponseV1,
  RunnerCapabilityManifestV1,
  RunnerHeartbeatResponseV1,
  RunnerLeaseClaimResponseV1,
  RunnerManifestUpsertResponseV1,
  RunnerExecutionStartedRequestV1,
  RunnerAttemptCompletionRequestV1,
  RunnerAttemptFailureRequestV1,
  RunnerLeaseClaimRequestV1,
  RunnerArtifactStageRequestV1,
  TaskEnvelopeV2,
} from '@ai-dev-team/shared'

import type { RunnerControlApiClient } from './control-api-client.js'
import { loadRunnerHostAppConfig } from './config.js'
import { RunnerHostRuntime, buildRunnerManifest } from './runtime.js'
import { McpPoolManager } from './mcp-pool.js'

class SmokeControlApiClient {
  public manifest: RunnerCapabilityManifestV1 | null = null
  public completed: RunnerAttemptCompletionRequestV1 | null = null
  public started: RunnerExecutionStartedRequestV1 | null = null
  public failure: RunnerAttemptFailureRequestV1 | null = null
  public heartbeats = 0
  public claimRequests: RunnerLeaseClaimRequestV1[] = []
  public stagedArtifacts: RunnerArtifactStageRequestV1[] = []

  private claimed = false

  constructor(
    private readonly runnerNodeId: string,
    private readonly task: TaskEnvelopeV2,
    private readonly abortController: AbortController,
  ) {}

  async publishManifest(
    manifest: RunnerCapabilityManifestV1,
  ): Promise<RunnerManifestUpsertResponseV1> {
    this.manifest = manifest

    return {
      schemaVersion: 1,
      accepted: true,
    }
  }

  async claimNext(
    heartbeatExpiryAt: string,
  ): Promise<RunnerLeaseClaimResponseV1> {
    const request: RunnerLeaseClaimRequestV1 = {
      schemaVersion: 1,
      runnerNodeId: this.runnerNodeId,
      heartbeatExpiryAt,
    }
    this.claimRequests.push(request)

    if (this.claimed) {
      return { schemaVersion: 1, task: null }
    }

    this.claimed = true

    return { schemaVersion: 1, task: this.task }
  }

  async executionStarted(
    payload: RunnerExecutionStartedRequestV1,
  ): Promise<void> {
    this.started = payload
  }

  async heartbeat(): Promise<RunnerHeartbeatResponseV1> {
    this.heartbeats += 1

    return { schemaVersion: 1, cancelRequested: false }
  }

  async stageArtifact(
    payload: RunnerArtifactStageRequestV1,
  ): Promise<RunnerArtifactStageResponseV1> {
    this.stagedArtifacts.push(payload)
    const content = Buffer.from(payload.contentBase64, 'base64')
    const metadata = payload.metadata as {
      localUri?: string
      sha256?: string
    }

    return {
      schemaVersion: 1,
      artifactId: payload.artifactKey,
      artifactUri: metadata.localUri ?? payload.artifactKey,
      contentSha256: metadata.sha256 ?? '',
      sizeBytes: content.byteLength,
    }
  }

  async completeAttempt(
    payload: RunnerAttemptCompletionRequestV1,
  ): Promise<void> {
    this.completed = payload
    this.abortController.abort(new Error('smoke run completed'))
  }

  async failAttempt(
    payload: RunnerAttemptFailureRequestV1,
  ): Promise<void> {
    this.failure = payload
    this.abortController.abort(new Error('smoke run failed'))
  }

  async cancelAttempt(): Promise<RunnerAttemptCancelResponseV1> {
    return {
      schemaVersion: 1,
      leaseStatus: 'cancellation_requested',
      cancelOutcome: 'accepted',
    }
  }
}

export async function runSmokeHarness(
  config = loadRunnerHostAppConfig({
    ...process.env,
    RUNNER_RUNTIME_MODE: 'fake',
  }),
): Promise<void> {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-smoke-'))
  const workspaceRoot = path.join(sandboxRoot, 'workspace')
  const worktreeRoot = path.join(sandboxRoot, 'worktrees')
  const artifactRoot = path.join(sandboxRoot, 'artifacts')
  const checkoutPath = path.join(sandboxRoot, 'checkout')
  const worktreeHint = path.join(sandboxRoot, 'task-worktree')
  const smokeConfig = {
    ...config,
    workspaceRoot,
    worktreeRoot,
    artifactRoot,
    runtimeMode: 'fake' as const,
    fakeProviderCommand: null,
    fakeMcpCommand: config.fakeMcpCommand ?? 'node dist/fake-mcp.js',
  }

  await mkdir(checkoutPath, { recursive: true })
  await writeFile(path.join(checkoutPath, 'README.md'), '# smoke checkout\n')

  const manifest = buildRunnerManifest(smokeConfig)
  assert.equal(manifest.runnerNodeId, smokeConfig.runnerNodeId)
  assert.equal(manifest.hostGroupId, smokeConfig.hostGroupId)
  assert.ok(manifest.providers.length >= 1)

  const task: TaskEnvelopeV2 = {
    schemaVersion: 2,
    leaseId: 'lease-smoke',
    leaseAttemptId: 'attempt-smoke',
    issueId: 'issue-smoke',
    runId: 'run-smoke',
    workflowId: 'workflow-smoke',
    requestedProvider: 'codex',
    effectiveProvider: 'codex',
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'build_agent',
    runKind: 'build',
    repoSlug: 'acme/repo',
    localCheckoutPath: checkoutPath,
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: worktreeHint,
    contextPackRef: null,
    contextPackFingerprint: null,
    reviewedBuildArtifactId: null,
    checkpointRef: null,
    executionSessionKey: 'session-smoke',
    mcpProfileRef: 'default',
    mcpBindingsSummary: [
      {
        serverName: 'serena',
        sharingScope: 'repo',
        bindingKey: 'serena',
        reused: false,
        repoSlug: 'acme/repo',
      },
    ],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: 'smoke-instructions',
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: 'bundle-fingerprint-1',
    skillPackRefs: ['build_backend_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: smokeConfig.toolBaseline,
    expectedOutputs: ['summary'],
    issuedAt: new Date().toISOString(),
  }

  const abortController = new AbortController()
  const client = new SmokeControlApiClient(
    smokeConfig.runnerNodeId,
    task,
    abortController,
  )
  const runtime = new RunnerHostRuntime(
    smokeConfig,
    client as unknown as RunnerControlApiClient,
    new McpPoolManager(smokeConfig),
  )

  await runtime.run(abortController.signal)

  assert.equal(client.manifest?.runnerNodeId, smokeConfig.runnerNodeId)
  assert.equal(client.started?.leaseAttemptId, task.leaseAttemptId)
  assert.equal(client.completed?.artifactBundle.leaseAttemptId, task.leaseAttemptId)
  assert.equal(client.completed?.artifactBundle.executionSessionKey, task.executionSessionKey)
  assert.ok(client.heartbeats >= 1)
  assert.ok(client.stagedArtifacts.length >= 1)
  assert.ok(
    String(client.completed?.artifactBundle.providerExecutionMetadata.worktreePath ?? '').includes(
      'task-worktree',
    ),
  )

  const checkoutContents = await readFile(path.join(checkoutPath, 'README.md'), 'utf8')
  assert.equal(checkoutContents, '# smoke checkout\n')
  await assert.rejects(
    readFile(path.join(worktreeHint, 'README.md'), 'utf8'),
  )

  await rm(sandboxRoot, { recursive: true, force: true })

  console.info('runner-host smoke harness completed', {
    manifestVersion: manifest.manifestVersion,
    heartbeats: client.heartbeats,
    stagedArtifacts: client.stagedArtifacts.length,
  })
}
