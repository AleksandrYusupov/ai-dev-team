import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AGENT_PROVIDERS,
  MCP_SHARING_SCOPES,
  RUNNER_CANCEL_OUTCOMES,
  RUNNER_LEASE_ATTEMPT_STATUSES,
  RUNNER_LEASE_STATUSES,
  type RunnerArtifactStageRequestV1,
  type RunnerAttemptCancelRequestV1,
  type RunnerHeartbeatRequestV1,
  type RunnerHeartbeatResponseV1,
  type RunnerCapabilityManifestV1,
  type RunnerLeaseDetailView,
  type RunnerMcpPoolSnapshotView,
} from './index.js'

const phase6RunnerManifest = {
  schemaVersion: 1,
  runnerNodeId: 'runner-phase6-scaffold',
  hostGroupId: 'phase6-host-group',
  manifestVersion: 2,
  providers: ['codex', 'claude'],
  providerCliVersions: {
    codex: '1.0.0',
    claude: '1.0.0',
  },
  supportedRoles: ['orchestrator'],
  supportedRunKinds: ['build'],
  supportedRepoKinds: ['application'],
  mcpServerCatalog: [
    {
      serverName: 'serena',
      sharingScope: 'repo',
      reusePolicy: 'shared_by_scope',
      supportsConcurrentSessions: true,
      configHash: 'serena:repo',
    },
    {
      serverName: 'obsidian',
      sharingScope: 'host',
      reusePolicy: 'shared_by_scope',
      supportsConcurrentSessions: true,
      configHash: 'obsidian:host',
    },
    {
      serverName: 'context7',
      sharingScope: 'host',
      reusePolicy: 'shared_by_scope',
      supportsConcurrentSessions: true,
      configHash: 'context7:host',
    },
    {
      serverName: 'playwright',
      sharingScope: 'exclusive',
      reusePolicy: 'exclusive_per_execution',
      supportsConcurrentSessions: false,
      configHash: 'playwright:exclusive',
    },
  ],
  toolBaseline: ['serena', 'obsidian', 'context7'],
  skillsAvailable: ['phase6-scaffold'],
  workspaceRoot: '/tmp/runner-phase6-scaffold/workspace',
  worktreeRoot: '/tmp/runner-phase6-scaffold/worktrees',
  maxConcurrentLeases: 2,
  supportsInterrupt: true,
  supportsCheckpointResume: true,
  supportsArtifactUpload: true,
  supportsConcurrentSessions: true,
  integration: {
    networkModesSupported: ['docs_allowlist'],
    allowedDocDomains: [],
    allowedSandboxDomains: [],
    supportsBrowserConsent: false,
    supportsSecretBroker: false,
    supportsOAuthBroker: false,
    supportsIntegrationLab: false,
  },
  host: {
    hostName: 'runner-phase6-scaffold.local',
    hostOs: 'darwin',
    hostArch: 'arm64',
  },
  publishedAt: '2026-03-26T10:00:00.000Z',
} satisfies RunnerCapabilityManifestV1

test('phase 6 runner protocol constants still match the closure fabric contract', () => {
  assert.deepEqual(AGENT_PROVIDERS, ['codex', 'claude'])
  assert.deepEqual(MCP_SHARING_SCOPES, ['host', 'repo', 'exclusive'])
  assert.ok(RUNNER_LEASE_STATUSES.includes('cancellation_requested'))
  assert.ok(RUNNER_LEASE_STATUSES.includes('heartbeat_lost'))
  assert.ok(RUNNER_LEASE_STATUSES.includes('expired'))
  assert.ok(RUNNER_LEASE_ATTEMPT_STATUSES.includes('abandoned_for_fallback'))
})

test('phase 6 runner manifests can declare repo-scoped and host-scoped MCP reuse', () => {
  assert.equal(phase6RunnerManifest.providers.length, 2)
  assert.equal(phase6RunnerManifest.mcpServerCatalog.length, 4)
  assert.deepEqual(
    phase6RunnerManifest.mcpServerCatalog.map((entry) => entry.sharingScope),
    ['repo', 'host', 'host', 'exclusive'],
  )
})

test('phase 6 runner-host cancel and artifact-stage DTOs are exported with stable fields', () => {
  assert.deepEqual(RUNNER_CANCEL_OUTCOMES, [
    'accepted',
    'already_terminal',
    'unsupported',
  ])

  const heartbeat: RunnerHeartbeatResponseV1 = {
    schemaVersion: 1,
    cancelRequested: true,
  }

  const artifactStage: RunnerArtifactStageRequestV1 = {
    schemaVersion: 1,
    runnerNodeId: 'runner-phase6-scaffold',
    leaseAttemptId: 'attempt-1',
    artifactKey: 'summary-md',
    contentType: 'text/markdown',
    contentBase64: Buffer.from('# summary\n').toString('base64'),
    metadata: {},
  }

  const cancelRequest: RunnerAttemptCancelRequestV1 = {
    schemaVersion: 1,
    runnerNodeId: 'runner-phase6-scaffold',
    leaseAttemptId: 'attempt-1',
    outcome: 'accepted',
    checkpointRef: null,
  }

  assert.equal(heartbeat.cancelRequested, true)
  assert.equal(artifactStage.artifactKey, 'summary-md')
  assert.equal(cancelRequest.outcome, 'accepted')
})

test('phase 6 runner heartbeat and lease detail DTOs expose MCP pool and timeline read models', () => {
  const mcpPoolSnapshot = {
    runnerNodeId: 'runner-phase6-scaffold',
    hostGroupId: 'phase6-host-group',
    updatedAt: '2026-03-26T10:00:00.000Z',
    bindings: [
      {
        runnerNodeId: 'runner-phase6-scaffold',
        hostGroupId: 'phase6-host-group',
        serverName: 'serena',
        sharingScope: 'repo',
        repoSlug: 'repo-primary',
        bindingKey: 'serena|repo|repo-primary|config-hash',
        acquiredCount: 2,
        sessionCounts: {
          'lease-1:attempt:1': 2,
        },
        processState: 'running',
        updatedAt: '2026-03-26T10:00:00.000Z',
      },
    ],
  } satisfies RunnerMcpPoolSnapshotView

  const heartbeatRequest: RunnerHeartbeatRequestV1 = {
    schemaVersion: 1,
    runnerNodeId: 'runner-phase6-scaffold',
    leaseAttemptId: 'attempt-1',
    heartbeatExpiryAt: '2026-03-26T10:05:00.000Z',
    mcpPoolSnapshot: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-scaffold',
      configHash: 'config-hash',
      capturedAt: '2026-03-26T10:00:00.000Z',
      bindings: [],
    },
  }

  const leaseDetail: RunnerLeaseDetailView = {
    lease: {
      leaseId: 'lease-1',
      issueId: 'ISSUE-1',
      runId: null,
      workflowId: 'issue:ISSUE-1',
      requestedProvider: 'codex',
      requestedOwnerRole: 'orchestrator',
      requestedRunKind: 'build',
      roleExecutionPolicyVersion: 1,
      status: 'execution_started',
      assignedRunnerNodeId: 'runner-phase6-scaffold',
      requestedAt: '2026-03-26T10:00:00.000Z',
      acquiredAt: '2026-03-26T10:00:10.000Z',
      executionStartedAt: '2026-03-26T10:00:20.000Z',
      lastHeartbeatAt: '2026-03-26T10:00:30.000Z',
      heartbeatExpiresAt: '2026-03-26T10:05:00.000Z',
      agentLibraryReleaseId: 'v1',
      promptVersion: 'v1',
      taskInstructionsRef: 'agent-library://releases/v1/prompt-bundles/orchestrator',
      roleCharterRef: 'agent-library://releases/v1/role-charters/orchestrator',
      promptBundleFingerprint: 'bundle-fingerprint-1',
      skillPackRefs: ['orchestrator_core'],
      effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
      contextPackFingerprint: null,
      promptResolutionSource: 'published_bundle',
      failedAt: null,
      completedAt: null,
      releasedAt: null,
      releasedReasonCode: null,
      attemptCount: 1,
      lastError: null,
    },
    attempts: [],
    timeline: [
      {
        event: 'requested',
        at: '2026-03-26T10:00:00.000Z',
        scope: 'lease',
        leaseAttemptId: null,
        providerAttemptNo: null,
        status: 'execution_started',
      },
      {
        event: 'execution_started',
        at: '2026-03-26T10:00:20.000Z',
        scope: 'attempt',
        leaseAttemptId: 'attempt-1',
        providerAttemptNo: 1,
        status: 'execution_started',
      },
    ],
  }

  assert.equal(mcpPoolSnapshot.bindings[0]?.processState, 'running')
  assert.equal(heartbeatRequest.mcpPoolSnapshot?.schemaVersion, 1)
  assert.equal(leaseDetail.timeline[1]?.event, 'execution_started')
})
