import assert from 'node:assert/strict'
import test from 'node:test'

import { loadDatabaseConfig } from '@ai-dev-team/config'
import {
  cacheContextPack,
  createDb,
  ensurePhase7ReferenceRepoBootstrap,
  getLifecycleSnapshotView,
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
  upsertIssueContractSnapshot,
  upsertRunnerCapabilityManifest,
  type DbClient,
} from '@ai-dev-team/db'
import type { ContextPack, RunnerCapabilityManifestV1 } from '@ai-dev-team/shared'

import { applyTransition, bootstrapIssueRuntimeState } from './application/workflow/apply-transition.js'
import { waitForCondition } from './testing/temporal.js'

const liveProofEnabled = process.env.PHASE7_LIVE_PROOF === 'true'
const liveProofTimeoutMs = Number.parseInt(
  process.env.PHASE7_LIVE_TIMEOUT_MS ?? '600000',
  10,
)

const runtimeClaimSkillRefs = [
  'F01',
  'F02',
  'F03',
  'F04',
  'F05',
  'F06',
  'F07',
  'F08',
  'F09',
  'F10',
  'F11',
  'F13',
  'S01',
  'S03',
  'S14',
  'S16',
  'S19',
  'S20',
  'S21',
  'S22',
  'S23',
  'S24',
  'S25',
  'S26',
  'S27',
  'S43',
  'S44',
  'S46',
  'S47',
  'S48',
  'S49',
  'S50',
  'S51',
  'S52',
  'S53',
  'S54',
] as const

function getExpectedEnvValue(envKey: string, fallback: string): string {
  return process.env[envKey]?.trim() || fallback
}

function requireExpectedEnvValue(envKey: string): string {
  const value = process.env[envKey]?.trim()

  assert.ok(value, `missing expected live-proof env: ${envKey}`)
  return value
}

function buildBuildRunnerManifest(
  runnerNodeId: string,
  workspaceRoot: string,
  worktreeRoot: string,
): RunnerCapabilityManifestV1 {
  return {
    schemaVersion: 1,
    runnerNodeId,
    hostGroupId: 'phase7-build-hosts',
    manifestVersion: 1,
    providers: ['codex'],
    providerCliVersions: { codex: '1.0.0' },
    supportedRoles: [
      'build_agent',
      'build_agent_backend',
      'build_agent_integrations',
      'test_agent',
    ],
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
        serverName: 'context7',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'context7:host',
      },
    ],
    toolBaseline: ['serena', 'context7', 'obsidian'],
    skillsAvailable: [...runtimeClaimSkillRefs],
    activeAgentLibraryReleaseId: 'v1',
    activeAgentLibraryFingerprint: 'release-fingerprint-v1',
    skillSyncStatus: 'ready',
    skillSyncError: null,
    installedSkillBundles: [
      {
        releaseId: 'v1',
        fingerprint: 'release-fingerprint-v1',
        skillIds: [...runtimeClaimSkillRefs],
      },
    ],
    workspaceRoot,
    worktreeRoot,
    maxConcurrentLeases: 1,
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
      hostName: `${runnerNodeId}.local`,
      hostOs: 'darwin',
      hostArch: 'arm64',
    },
    publishedAt: '2026-03-27T10:00:00.000Z',
  }
}

function buildReviewRunnerManifest(
  runnerNodeId: string,
  workspaceRoot: string,
  worktreeRoot: string,
): RunnerCapabilityManifestV1 {
  return {
    schemaVersion: 1,
    runnerNodeId,
    hostGroupId: 'phase7-review-hosts',
    manifestVersion: 1,
    providers: ['claude'],
    providerCliVersions: { claude: '1.0.0' },
    supportedRoles: ['security_agent', 'review_agent'],
    supportedRunKinds: ['review'],
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
        serverName: 'context7',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'context7:host',
      },
    ],
    toolBaseline: ['serena', 'context7', 'obsidian'],
    skillsAvailable: [...runtimeClaimSkillRefs],
    activeAgentLibraryReleaseId: 'v1',
    activeAgentLibraryFingerprint: 'release-fingerprint-v1',
    skillSyncStatus: 'ready',
    skillSyncError: null,
    installedSkillBundles: [
      {
        releaseId: 'v1',
        fingerprint: 'release-fingerprint-v1',
        skillIds: [...runtimeClaimSkillRefs],
      },
    ],
    workspaceRoot,
    worktreeRoot,
    maxConcurrentLeases: 1,
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
      hostName: `${runnerNodeId}.local`,
      hostOs: 'darwin',
      hostArch: 'arm64',
    },
    publishedAt: '2026-03-27T10:05:00.000Z',
  }
}

function buildPhase7ContextPack(input: {
  issueId: string
  issueContractSnapshotHash: string
  primaryRepo: string
}): ContextPack {
  return {
    issue: {
      issueId: input.issueId,
      goal: 'Prove the honest Phase 7 build/review loop on the canonical reference repo.',
      background: 'live proof',
      scope: ['build task', 'review task', 'human gate write-back'],
      nonGoals: ['GitHub PR automation'],
      acceptanceCriteria: [
        'Build and review both consume one frozen context pack.',
        'Review completion reaches needs_human_decision.',
        'Linear decision summary is delivered through the outbox path.',
      ],
      verificationPath: {
        automated: ['corepack pnpm test:phase7', 'corepack pnpm test:phase7:live'],
        manual: [],
      },
      doneWhen: ['The issue reaches needs_human_decision with durable review artifacts.'],
      risk: 'medium',
      dependencies: {
        blocks: [],
        blockedBy: [],
        external: ['Linear GraphQL comment delivery'],
      },
      primaryRepo: input.primaryRepo,
      affectedRepos: [],
      docsLinks: [
        'ai_dev_team/architecture/10_phase_7_first_end_to_end_build_and_review_spec.md',
      ],
      openQuestions: [],
      issueType: 'feature',
      source: 'founder',
      mode: 'autonomous',
      humanDecisionRequired: true,
    },
    repositories: [],
    latestRelevantComments: [],
    docsPack: [],
    repoGuidance: [],
    integrationArtifacts: [],
    decisionSummary: ['Phase 7 live proof context'],
    budgets: {
      contextPolicyVersion: 1,
      estimatedTokens: 2400,
      maxTokens: 16_000,
      commentCount: 0,
      noteCount: 0,
      truncatedSections: [],
    },
    sourceTrace: {
      issueContractSnapshotId: 'snapshot-phase7-live-1',
      issueContractSnapshotHash: input.issueContractSnapshotHash,
      mappingIds: ['mapping-phase7-live-1'],
      noteSnapshotRefs: [],
      repoGuidanceRefs: [],
      commentRefs: [],
      artifactRefs: [],
      warnings: [],
    },
  }
}

async function dumpDiagnostics(
  db: DbClient,
  issueId: string,
): Promise<void> {
  try {
    const [runtimeState, leases, attempts, artifacts, outboxRows] = await Promise.all([
      db
        .selectFrom('issue_runtime_state')
        .selectAll()
        .where('issue_id', '=', issueId)
        .executeTakeFirst(),
      db
        .selectFrom('runner_leases')
        .selectAll()
        .where('issue_id', '=', issueId)
        .orderBy('requested_at', 'asc')
        .execute(),
      db
        .selectFrom('runner_lease_attempts as attempts')
        .innerJoin('runner_leases as leases', 'leases.lease_id', 'attempts.lease_id')
        .select([
          'attempts.lease_attempt_id as lease_attempt_id',
          'attempts.status as status',
          'attempts.runner_node_id as runner_node_id',
          'attempts.host_group_id as host_group_id',
          'attempts.execution_session_key as execution_session_key',
          'attempts.completed_at as completed_at',
          'leases.requested_provider as requested_provider',
        ])
        .where('leases.issue_id', '=', issueId)
        .orderBy('attempts.provider_attempt_no', 'asc')
        .execute(),
      db
        .selectFrom('artifact_registry')
        .select([
          'id',
          'artifact_type',
          'produced_by_role',
          'produced_for_status_code',
          'metadata',
        ])
        .where('issue_id', '=', issueId)
        .orderBy('produced_at', 'asc')
        .execute(),
      db
        .selectFrom('workflow_effect_outbox')
        .select([
          'command_type',
          'status',
          'attempt_count',
          'last_error',
        ])
        .where('issue_id', '=', issueId)
        .orderBy('created_at', 'desc')
        .execute(),
    ])

    console.error(
      'Phase 7 live proof diagnostics',
      JSON.stringify(
        {
          issueId,
          runtimeState,
          leases,
          attempts,
          artifacts,
          outboxRows,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    console.error('Phase 7 live diagnostics failed', {
      issueId,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    })
  }
}

test(
  'Phase 7 live proof reaches needs_human_decision on the canonical reference repo',
  { skip: !liveProofEnabled },
  async () => {
    const db = process.env.PHASE7_LIVE_PREPARED === 'true'
      ? createDb(loadDatabaseConfig(process.env))
      : await prepareTestDatabase()
    let issueId = ''

    try {
      issueId = `ISSUE-PHASE7-LIVE-${Date.now().toString()}`
      const workflowId = `issue:${issueId}`
      const contextPackFingerprint = `ctx-phase7-live-${issueId}`
      const localCheckoutPath = getExpectedEnvValue(
        'PHASE7_TEST_REPO_PATH',
        '/tmp/ai-dev-team/reference_repos/test_repo',
      )
      const buildRunnerNodeId = getExpectedEnvValue(
        'PHASE7_LIVE_CODEX_RUNNER_NODE_ID',
        process.env.RUNNER_NODE_ID?.trim() || 'codex-runner-1',
      )
      const reviewRunnerNodeId = getExpectedEnvValue(
        'PHASE7_LIVE_CLAUDE_RUNNER_NODE_ID',
        'claude-runner-1',
      )
      const buildWorkspaceRoot = requireExpectedEnvValue(
        'PHASE7_LIVE_CODEX_WORKSPACE_ROOT',
      )
      const buildWorktreeRoot = requireExpectedEnvValue(
        'PHASE7_LIVE_CODEX_WORKTREE_ROOT',
      )
      const reviewWorkspaceRoot = requireExpectedEnvValue(
        'PHASE7_LIVE_CLAUDE_WORKSPACE_ROOT',
      )
      const reviewWorktreeRoot = requireExpectedEnvValue(
        'PHASE7_LIVE_CLAUDE_WORKTREE_ROOT',
      )

      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, { publishedBy: 'phase7-live-proof' })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: `runner-host:${buildRunnerNodeId}`,
        manifest: buildBuildRunnerManifest(
          buildRunnerNodeId,
          buildWorkspaceRoot,
          buildWorktreeRoot,
        ),
      })
      await upsertRunnerCapabilityManifest(db, {
        authSubject: `runner-host:${reviewRunnerNodeId}`,
        manifest: buildReviewRunnerManifest(
          reviewRunnerNodeId,
          reviewWorkspaceRoot,
          reviewWorktreeRoot,
        ),
      })

      await ensurePhase7ReferenceRepoBootstrap(db, {
        localCheckoutPath,
      })

      await upsertIssueContractSnapshot(db, {
        issueId,
        snapshotHash: 'snapshot-hash-phase7-live-1',
        primaryRepo: 'test_repo',
        affectedRepos: [],
        docsLinks: [
          'ai_dev_team/architecture/10_phase_7_first_end_to_end_build_and_review_spec.md',
        ],
        risk: 'medium',
        dependencies: {
          blocks: [],
          blockedBy: [],
          external: [],
        },
        contractJson: {
          project: 'project-phase7',
          primaryRepo: 'test_repo',
          affectedRepos: [],
          goal: 'Prove the honest Phase 7 engineering loop.',
          background: 'live proof',
          scope: ['Freeze context', 'Persist build evidence', 'Persist review evidence'],
          nonGoals: ['GitHub merge automation'],
          acceptanceCriteria: [
            'Task envelopes remain frozen.',
            'Review completion reaches needs_human_decision.',
          ],
          verificationPath: {
            automated: ['corepack pnpm test:phase7', 'corepack pnpm test:phase7:live'],
            manual: [],
          },
          doneWhen: ['The issue reaches needs_human_decision with durable review truth.'],
          docsLinks: [
            'ai_dev_team/architecture/10_phase_7_first_end_to_end_build_and_review_spec.md',
          ],
          dependencies: {
            blocks: [],
            blockedBy: [],
            external: [],
          },
          openQuestions: [],
          issueType: 'feature',
          risk: 'medium',
          source: 'founder',
          mode: 'autonomous',
          humanDecisionRequired: true,
        },
      })

      await cacheContextPack(db, {
        issueId,
        inputFingerprint: contextPackFingerprint,
        estimatedTokens: 2400,
        bundleJson: buildPhase7ContextPack({
          issueId,
          issueContractSnapshotHash: 'snapshot-hash-phase7-live-1',
          primaryRepo: 'test_repo',
        }),
        sourceTraceJson: {
          issueContractSnapshotId: 'snapshot-phase7-live-1',
          issueContractSnapshotHash: 'snapshot-hash-phase7-live-1',
          mappingIds: ['mapping-phase7-live-1'],
          noteSnapshotRefs: [],
          repoGuidanceRefs: [],
          commentRefs: [],
          artifactRefs: [],
          warnings: [],
        },
      })

      await bootstrapIssueRuntimeState(db, {
        issueId,
        workflowId,
        actorId: 'phase7-live-proof',
        rawIssueArtifactUri: `linear://${issueId}`,
        metadata: {
          highRisk: false,
        },
      })

      await applyTransition(db, {
        issueId,
        triggerCode: 'system_contract_built',
        actorType: 'system',
        actorId: 'phase7-live-proof',
        guardOutcomes: {
          contract_complete: true,
          primary_repo_resolved: true,
          blockers_inspected: true,
        },
        artifacts: [
          {
            artifactType: 'issue_contract_snapshot',
            artifactScope: 'issue',
            artifactUri: `artifact://phase7-live/${issueId}/contract`,
          },
        ],
      })

      const readyTransition = await applyTransition(db, {
        issueId,
        triggerCode: 'system_ready_check_passed',
        actorType: 'system',
        actorId: 'phase7-live-proof',
        guardOutcomes: {
          plan_artifact_exists: true,
          dependency_report_clean_or_waived: true,
          context_pack_frozen: true,
          no_unresolved_blockers: true,
          no_unresolved_secret_slots: true,
          integration_prerequisites_satisfied_or_not_required: true,
          prod_access_gate_satisfied_or_not_required: true,
        },
        artifacts: [
          {
            artifactType: 'plan_artifact',
            artifactScope: 'issue',
            artifactUri: `artifact://phase7-live/${issueId}/plan`,
          },
          {
            artifactType: 'dependency_report',
            artifactScope: 'issue',
            artifactUri: `artifact://phase7-live/${issueId}/deps`,
          },
          {
            artifactType: 'readiness_report',
            artifactScope: 'issue',
            artifactUri: `artifact://phase7-live/${issueId}/readiness`,
          },
        ],
        metadata: {
          contextPackFingerprint,
        },
      })

      assert.equal(readyTransition.toStatus, 'ready_for_build')

      await waitForCondition(
        async () => {
          const state = await db
            .selectFrom('issue_runtime_state')
            .select('current_status_code')
            .where('issue_id', '=', issueId)
            .executeTakeFirst()

          return state?.current_status_code === 'needs_human_decision'
        },
        {
          timeoutMs: liveProofTimeoutMs,
          intervalMs: 2_000,
        },
      )

      await waitForCondition(
        async () => {
          const outboxRows = await db
            .selectFrom('workflow_effect_outbox')
            .select(['status'])
            .where('issue_id', '=', issueId)
            .where('command_type', '=', 'post_linear_comment')
            .execute()

          return (
            outboxRows.length > 0 &&
            outboxRows.every((row) => row.status === 'done')
          )
        },
        {
          timeoutMs: liveProofTimeoutMs,
          intervalMs: 2_000,
        },
      )

      const lifecycleSnapshot = await getLifecycleSnapshotView(db, issueId)
      assert.ok(lifecycleSnapshot)
      assert.equal(
        lifecycleSnapshot?.openHumanGate?.contextPackFingerprint,
        contextPackFingerprint,
      )
      assert.ok(lifecycleSnapshot?.openHumanGate?.reviewedBuildArtifactId)

      const runnerBundles = await db
        .selectFrom('artifact_registry')
        .select(['id', 'produced_by_role', 'metadata'])
        .where('issue_id', '=', issueId)
        .where('artifact_type', '=', 'runner_artifact_bundle')
        .where('superseded_at', 'is', null)
        .orderBy('produced_at', 'asc')
        .execute()

      assert.equal(runnerBundles.length, 2)
      const buildBundle = runnerBundles.find(
        (artifact) =>
          (artifact.metadata as { runKind?: string }).runKind === 'build',
      )
      const reviewBundle = runnerBundles.find(
        (artifact) =>
          (artifact.metadata as { runKind?: string }).runKind === 'review',
      )

      assert.ok(buildBundle)
      assert.ok(reviewBundle)
      assert.equal(
        (
          buildBundle?.metadata as {
            providerExecutionMetadata?: { contextPackFingerprint?: string }
          }
        )?.providerExecutionMetadata?.contextPackFingerprint,
        contextPackFingerprint,
      )
      assert.equal(
        (
          reviewBundle?.metadata as {
            providerExecutionMetadata?: { contextPackFingerprint?: string }
            reviewedBuildArtifactId?: string
          }
        )?.providerExecutionMetadata?.contextPackFingerprint,
        contextPackFingerprint,
      )
      assert.equal(
        (reviewBundle?.metadata as { reviewedBuildArtifactId?: string })
          ?.reviewedBuildArtifactId,
        buildBundle?.id,
      )

      const reviewArtifacts = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type', 'metadata'])
        .where('issue_id', '=', issueId)
        .where('artifact_type', 'in', ['review_report', 'decision_summary'])
        .where('produced_for_status_code', '=', 'needs_human_decision')
        .where('superseded_at', 'is', null)
        .execute()

      assert.deepEqual(
        reviewArtifacts.map((artifact) => artifact.artifact_type).sort(),
        ['decision_summary', 'review_report'],
      )
      const reviewReport = reviewArtifacts.find(
        (artifact) => artifact.artifact_type === 'review_report',
      )
      const decisionSummary = reviewArtifacts.find(
        (artifact) => artifact.artifact_type === 'decision_summary',
      )

      assert.equal(
        (
          reviewReport?.metadata as {
            contextPackFingerprint?: string
            reviewedBuildArtifactId?: string
          }
        )?.contextPackFingerprint,
        contextPackFingerprint,
      )
      assert.equal(
        (
          reviewReport?.metadata as {
            reviewedBuildArtifactId?: string
          }
        )?.reviewedBuildArtifactId,
        buildBundle?.id,
      )
      assert.equal(
        (
          decisionSummary?.metadata as {
            contextPackFingerprint?: string
          }
        )?.contextPackFingerprint,
        contextPackFingerprint,
      )

      const outboxRows = await db
        .selectFrom('workflow_effect_outbox')
        .select(['command_type', 'status', 'attempt_count', 'last_error'])
        .where('issue_id', '=', issueId)
        .where('command_type', '=', 'post_linear_comment')
        .orderBy('created_at', 'asc')
        .execute()

      assert.equal(outboxRows.length, 1)
      assert.equal(outboxRows[0]?.status, 'done')
      assert.equal((outboxRows[0]?.attempt_count ?? 0) >= 1, true)
      assert.equal(outboxRows[0]?.last_error ?? null, null)

      const leases = await db
        .selectFrom('runner_leases')
        .select(['requested_provider', 'status', 'assigned_runner_node_id'])
        .where('issue_id', '=', issueId)
        .orderBy('requested_at', 'asc')
        .execute()

      const buildLease = leases.find((lease) => lease.requested_provider === 'codex')
      const reviewLease = leases.find((lease) => lease.requested_provider === 'claude')

      assert.ok(buildLease)
      assert.ok(reviewLease)
      assert.equal(buildLease?.status, 'released')
      assert.equal(reviewLease?.status, 'completed')
      assert.equal(reviewLease?.assigned_runner_node_id, reviewRunnerNodeId)
    } catch (error) {
      if (issueId) {
        await dumpDiagnostics(db, issueId)
      }

      throw error
    } finally {
      await db.destroy()
    }
  },
)
