import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDb,
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
  type DbClient,
} from '@ai-dev-team/db'
import { loadDatabaseConfig } from '@ai-dev-team/config'

import { applyTransition, bootstrapIssueRuntimeState } from './application/workflow/apply-transition.js'
import { waitForCondition } from './testing/temporal.js'

const liveProofEnabled = process.env.PHASE6_LIVE_PROOF === 'true'
const liveProofTimeoutMs = Number.parseInt(
  process.env.PHASE6_LIVE_TIMEOUT_MS ?? '600000',
  10,
)

function getExpectedEnvValue(envKey: string, fallback: string): string {
  return process.env[envKey]?.trim() || fallback
}

function requireExpectedEnvValue(envKey: string): string {
  const value = process.env[envKey]?.trim()

  assert.ok(value, `missing expected live-proof env: ${envKey}`)
  return value
}

function getControlApiBaseUrl(): string {
  const port = Number.parseInt(process.env.CONTROL_API_PORT ?? '4000', 10)
  return `http://127.0.0.1:${port}`
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function formatDiagnosticValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const raw = await response.text()

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function fetchInternalJsonSafe(pathname: string): Promise<{
  pathname: string
  status: number | null
  ok: boolean
  body?: unknown
  error?: string
}> {
  const internalBearerToken = process.env.INTERNAL_API_BEARER_TOKEN?.trim()

  if (!internalBearerToken) {
    return {
      pathname,
      status: null,
      ok: false,
      error: 'missing INTERNAL_API_BEARER_TOKEN',
    }
  }

  try {
    const response = await fetch(`${getControlApiBaseUrl()}${pathname}`, {
      headers: {
        Authorization: `Bearer ${internalBearerToken}`,
      },
    })

    return {
      pathname,
      status: response.status,
      ok: response.ok,
      body: await parseResponseBody(response),
    }
  } catch (error) {
    return {
      pathname,
      status: null,
      ok: false,
      error: describeError(error),
    }
  }
}

async function fetchInternalJson(pathname: string): Promise<unknown> {
  const result = await fetchInternalJsonSafe(pathname)

  assert.equal(
    result.status,
    200,
    `${pathname}: ${result.error ?? formatDiagnosticValue(result.body)}`,
  )
  return result.body
}

interface LiveProofMcpPoolBindingView {
  runnerNodeId?: string
  hostGroupId?: string
  sessionCounts?: Record<string, number>
}

interface LiveProofMcpPoolSnapshotView {
  runnerNodeId: string
  hostGroupId: string
  bindings?: LiveProofMcpPoolBindingView[]
}

interface LiveProofLeaseAttemptView {
  leaseAttemptId: string
  runnerNodeId: string
  hostGroupId: string
  executionSessionKey: string
  mcpBindingsSummary: Array<Record<string, unknown>>
  status: string
}

interface LiveProofLeaseDetailView {
  lease: { leaseId: string; requestedProvider: string; status: string }
  attempts: LiveProofLeaseAttemptView[]
}

function assertNoLeak(
  condition: unknown,
  details: {
    surface: string
    sourceHostGroupId: string
    targetHostGroupId: string
    offendingRunnerNodeId: string
    leakedExecutionSessionKey: string
    message: string
  },
): asserts condition {
  if (condition) {
    return
  }

  assert.fail(
    [
      `host_group_id no-leak proof failed on ${details.surface}: ${details.message}`,
      `source host_group_id=${details.sourceHostGroupId}`,
      `target host_group_id=${details.targetHostGroupId}`,
      `offending runnerNodeId=${details.offendingRunnerNodeId}`,
      `leaked executionSessionKey=${details.leakedExecutionSessionKey}`,
    ].join('; '),
  )
}

function hasNonEmptyMcpUsageEvidence(
  mcpBindingsSummary: Array<Record<string, unknown>> | undefined,
): boolean {
  return Array.isArray(mcpBindingsSummary) && mcpBindingsSummary.length > 0
}

async function assertHostGroupNoLeakLiveProof(input: {
  buildLeaseId: string
  reviewLeaseId: string
  expectedCodexRunnerNodeId: string
  expectedClaudeRunnerNodeId: string
  expectedCodexRunnerHostGroupId: string
  expectedClaudeRunnerHostGroupId: string
}): Promise<void> {
  const mcpPoolSnapshots = await fetchInternalJson(
    '/internal/runners/mcp-pool',
  ) as LiveProofMcpPoolSnapshotView[]

  assert.ok(Array.isArray(mcpPoolSnapshots))

  const codexSnapshot = mcpPoolSnapshots.find(
    (snapshot) => snapshot.runnerNodeId === input.expectedCodexRunnerNodeId,
  )
  const claudeSnapshot = mcpPoolSnapshots.find(
    (snapshot) => snapshot.runnerNodeId === input.expectedClaudeRunnerNodeId,
  )

  assert.ok(codexSnapshot)
  assert.ok(claudeSnapshot)
  assert.equal(codexSnapshot.hostGroupId, input.expectedCodexRunnerHostGroupId)
  assert.equal(
    claudeSnapshot.hostGroupId,
    input.expectedClaudeRunnerHostGroupId,
  )

  const buildLeaseDetail = await fetchInternalJson(
    `/internal/runners/leases/${input.buildLeaseId}`,
  ) as LiveProofLeaseDetailView
  const reviewLeaseDetail = await fetchInternalJson(
    `/internal/runners/leases/${input.reviewLeaseId}`,
  ) as LiveProofLeaseDetailView

  const buildAttempt = buildLeaseDetail.attempts.at(-1)
  const reviewAttempt = reviewLeaseDetail.attempts.at(-1)

  assert.ok(buildAttempt)
  assert.ok(reviewAttempt)
  assert.notEqual(buildAttempt.hostGroupId, reviewAttempt.hostGroupId)
  assert.notEqual(
    buildAttempt.executionSessionKey,
    reviewAttempt.executionSessionKey,
  )
  assert.equal(buildAttempt.hostGroupId, input.expectedCodexRunnerHostGroupId)
  assert.equal(reviewAttempt.hostGroupId, input.expectedClaudeRunnerHostGroupId)
  assert.equal(buildAttempt.runnerNodeId, input.expectedCodexRunnerNodeId)
  assert.equal(reviewAttempt.runnerNodeId, input.expectedClaudeRunnerNodeId)
  assertNoLeak(hasNonEmptyMcpUsageEvidence(buildAttempt.mcpBindingsSummary), {
    surface: `/internal/runners/leases/${input.buildLeaseId}`,
    sourceHostGroupId: buildAttempt.hostGroupId,
    targetHostGroupId: reviewAttempt.hostGroupId,
    offendingRunnerNodeId: buildAttempt.runnerNodeId,
    leakedExecutionSessionKey: reviewAttempt.executionSessionKey,
    message: 'build attempt did not expose non-empty mcpBindingsSummary',
  })
  assertNoLeak(hasNonEmptyMcpUsageEvidence(reviewAttempt.mcpBindingsSummary), {
    surface: `/internal/runners/leases/${input.reviewLeaseId}`,
    sourceHostGroupId: reviewAttempt.hostGroupId,
    targetHostGroupId: buildAttempt.hostGroupId,
    offendingRunnerNodeId: reviewAttempt.runnerNodeId,
    leakedExecutionSessionKey: buildAttempt.executionSessionKey,
    message: 'review attempt did not expose non-empty mcpBindingsSummary',
  })

  for (const binding of codexSnapshot.bindings ?? []) {
    assert.equal(binding.runnerNodeId, input.expectedCodexRunnerNodeId)
    assert.equal(binding.hostGroupId, input.expectedCodexRunnerHostGroupId)
    assertNoLeak(
      !Object.keys(binding.sessionCounts ?? {}).includes(
        reviewAttempt.executionSessionKey,
      ),
      {
        surface: '/internal/runners/mcp-pool',
        sourceHostGroupId: input.expectedCodexRunnerHostGroupId,
        targetHostGroupId: input.expectedClaudeRunnerHostGroupId,
        offendingRunnerNodeId:
          binding.runnerNodeId ?? input.expectedCodexRunnerNodeId,
        leakedExecutionSessionKey: reviewAttempt.executionSessionKey,
        message: 'build-host MCP snapshot leaked review execution session',
      },
    )
  }

  for (const binding of claudeSnapshot.bindings ?? []) {
    assert.equal(binding.runnerNodeId, input.expectedClaudeRunnerNodeId)
    assert.equal(binding.hostGroupId, input.expectedClaudeRunnerHostGroupId)
    assertNoLeak(
      !Object.keys(binding.sessionCounts ?? {}).includes(
        buildAttempt.executionSessionKey,
      ),
      {
        surface: '/internal/runners/mcp-pool',
        sourceHostGroupId: input.expectedClaudeRunnerHostGroupId,
        targetHostGroupId: input.expectedCodexRunnerHostGroupId,
        offendingRunnerNodeId:
          binding.runnerNodeId ?? input.expectedClaudeRunnerNodeId,
        leakedExecutionSessionKey: buildAttempt.executionSessionKey,
        message: 'review-host MCP snapshot leaked build execution session',
      },
    )
  }
}

function buildMissingRowError(
  entityName: string,
  issueId: string,
  details: Record<string, unknown> = {},
): Error {
  const suffix = Object.keys(details).length > 0
    ? ` ${formatDiagnosticValue(details)}`
    : ''

  return new Error(`Live proof expected ${entityName} for issue ${issueId}.${suffix}`)
}

async function dumpLiveProofDiagnostics(
  db: DbClient,
  issueId: string,
  leaseIds: {
    buildLeaseId?: string
    reviewLeaseId?: string
  } = {},
): Promise<void> {
  try {
    const [issueRuntimeState, runnerLeases, artifactRegistryRows, outboxRows, mcpPoolSnapshot] =
      await Promise.all([
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
          .selectFrom('artifact_registry')
          .select([
            'id',
            'artifact_type',
            'artifact_uri',
            'produced_by_role',
            'produced_for_status_code',
            'transition_audit_id',
            'metadata',
            'produced_at',
          ])
          .where('issue_id', '=', issueId)
          .orderBy('produced_at', 'asc')
          .execute(),
        db
          .selectFrom('workflow_effect_outbox')
          .select([
            'id',
            'transition_audit_id',
            'command_type',
            'idempotency_key',
            'status',
            'attempt_count',
            'scheduled_at',
            'executed_at',
            'last_error',
            'created_at',
          ])
          .where('issue_id', '=', issueId)
          .orderBy('created_at', 'desc')
          .execute(),
        fetchInternalJsonSafe('/internal/runners/mcp-pool'),
      ])

    const allLeaseIds = runnerLeases.map((lease) => lease.lease_id)
    const runnerLeaseAttempts =
      allLeaseIds.length > 0
        ? await db
          .selectFrom('runner_lease_attempts')
          .selectAll()
          .where('lease_id', 'in', allLeaseIds)
          .orderBy('provider_attempt_no', 'asc')
          .execute()
        : []

    const buildLeaseId =
      leaseIds.buildLeaseId ??
      runnerLeases.find((lease) => lease.requested_provider === 'codex')?.lease_id
    const reviewLeaseId =
      leaseIds.reviewLeaseId ??
      runnerLeases.find((lease) => lease.requested_provider === 'claude')?.lease_id

    const [buildLeaseSnapshot, reviewLeaseSnapshot] = await Promise.all([
      buildLeaseId
        ? fetchInternalJsonSafe(`/internal/runners/leases/${buildLeaseId}`)
        : Promise.resolve(null),
      reviewLeaseId
        ? fetchInternalJsonSafe(`/internal/runners/leases/${reviewLeaseId}`)
        : Promise.resolve(null),
    ])

    console.error(
      'Phase 6 live proof diagnostics',
      JSON.stringify(
        {
          issueId,
          issueRuntimeState,
          runnerLeases,
          runnerLeaseAttempts,
          artifactRegistryRows,
          workflowEffectOutbox: outboxRows,
          mcpPoolSnapshot,
          buildLeaseSnapshot,
          reviewLeaseSnapshot,
        },
        null,
        2,
      ),
    )
  } catch (diagnosticError) {
    console.error('Phase 6 live proof diagnostics failed', {
      issueId,
      error: describeError(diagnosticError),
    })
  }
}

test(
  'Phase 6 live proof reaches agent_review through real codex and claude runner-hosts',
  { skip: !liveProofEnabled },
  async (t) => {
    const db = process.env.PHASE6_LIVE_PREPARED === 'true'
      ? createDb(loadDatabaseConfig(process.env))
      : await prepareTestDatabase()
    let issueId = ''
    let buildLeaseId: string | undefined
    let reviewLeaseId: string | undefined

    try {
      issueId = `ISSUE-PHASE6-LIVE-${Date.now().toString()}`
      const workflowId = `issue:${issueId}`
      const expectedCodexRunnerNodeId = getExpectedEnvValue(
        'PHASE6_LIVE_CODEX_RUNNER_NODE_ID',
        process.env.RUNNER_NODE_ID?.trim() || 'codex-runner-1',
      )
      const expectedClaudeRunnerNodeId = getExpectedEnvValue(
        'PHASE6_LIVE_CLAUDE_RUNNER_NODE_ID',
        'claude-runner-1',
      )
      const expectedCodexRunnerHostGroupId = getExpectedEnvValue(
        'PHASE6_LIVE_CODEX_RUNNER_HOST_GROUP_ID',
        process.env.RUNNER_HOST_GROUP_ID?.trim() || 'codex-runner-host-group',
      )
      const expectedClaudeRunnerHostGroupId = getExpectedEnvValue(
        'PHASE6_LIVE_CLAUDE_RUNNER_HOST_GROUP_ID',
        `${expectedCodexRunnerHostGroupId}-review`,
      )
      const expectedCodexWorkspaceRoot = requireExpectedEnvValue(
        'PHASE6_LIVE_CODEX_WORKSPACE_ROOT',
      )
      const expectedCodexWorktreeRoot = requireExpectedEnvValue(
        'PHASE6_LIVE_CODEX_WORKTREE_ROOT',
      )
      const expectedCodexArtifactRoot = requireExpectedEnvValue(
        'PHASE6_LIVE_CODEX_ARTIFACT_ROOT',
      )
      const expectedClaudeWorkspaceRoot = requireExpectedEnvValue(
        'PHASE6_LIVE_CLAUDE_WORKSPACE_ROOT',
      )
      const expectedClaudeWorktreeRoot = requireExpectedEnvValue(
        'PHASE6_LIVE_CLAUDE_WORKTREE_ROOT',
      )
      const expectedClaudeArtifactRoot = requireExpectedEnvValue(
        'PHASE6_LIVE_CLAUDE_ARTIFACT_ROOT',
      )

      assert.notEqual(
        expectedCodexRunnerHostGroupId,
        expectedClaudeRunnerHostGroupId,
      )
      assert.notEqual(expectedCodexWorkspaceRoot, expectedClaudeWorkspaceRoot)
      assert.notEqual(expectedCodexWorktreeRoot, expectedClaudeWorktreeRoot)
      assert.notEqual(expectedCodexArtifactRoot, expectedClaudeArtifactRoot)

      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-live-proof',
      })

      await bootstrapIssueRuntimeState(db, {
        issueId,
        workflowId,
        actorId: 'phase6-live-proof',
        rawIssueArtifactUri: `linear://${issueId}`,
        metadata: {
          highRisk: false,
        },
      })

      await applyTransition(db, {
        issueId,
        triggerCode: 'system_contract_built',
        actorType: 'system',
        actorId: 'spec-agent',
        guardOutcomes: {
          contract_complete: true,
          primary_repo_resolved: true,
          blockers_inspected: true,
        },
        artifacts: [
          {
            artifactType: 'issue_contract_snapshot',
            artifactScope: 'issue',
            artifactUri: `artifact://phase6-live/${issueId}/contract`,
          },
        ],
      })

      const readyTransition = await applyTransition(db, {
        issueId,
        triggerCode: 'system_ready_check_passed',
        actorType: 'system',
        actorId: 'phase6-live-proof',
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
            artifactUri: `artifact://phase6-live/${issueId}/plan`,
          },
          {
            artifactType: 'dependency_report',
            artifactScope: 'issue',
            artifactUri: `artifact://phase6-live/${issueId}/deps`,
          },
          {
            artifactType: 'readiness_report',
            artifactScope: 'issue',
            artifactUri: `artifact://phase6-live/${issueId}/readiness`,
          },
        ],
        metadata: {
          contextPackFingerprint: `phase6-live-${issueId}`,
        },
      })

      assert.equal(readyTransition.toStatus, 'ready_for_build')
      assert.equal(readyTransition.outboxCommandCount, 1)

      await waitForCondition(
        async () => {
          const runtimeState = await db
            .selectFrom('issue_runtime_state')
            .select(['current_status_code', 'active_lease_id'])
            .where('issue_id', '=', issueId)
            .executeTakeFirst()

          if (!runtimeState) {
            throw buildMissingRowError('issue_runtime_state row', issueId, {
              expectedStatus: 'agent_review',
            })
          }

          return runtimeState.current_status_code === 'agent_review'
        },
        {
          timeoutMs: liveProofTimeoutMs,
          intervalMs: 2_000,
        },
      )

      await waitForCondition(
        async () => {
          const attempts = await db
            .selectFrom('runner_lease_attempts as attempts')
            .innerJoin('runner_leases as leases', 'leases.lease_id', 'attempts.lease_id')
          .select([
              'attempts.lease_attempt_id as lease_attempt_id',
              'leases.requested_provider as requested_provider',
              'leases.status as lease_status',
              'attempts.effective_provider as effective_provider',
              'attempts.status as status',
              'attempts.runner_node_id as runner_node_id',
              'attempts.host_group_id as host_group_id',
              'attempts.provider_attempt_no as provider_attempt_no',
              'attempts.completed_at as completed_at',
            ])
            .where('leases.issue_id', '=', issueId)
            .orderBy('attempts.provider_attempt_no', 'asc')
            .execute()

          const codexAttempt = attempts
            .filter(
              (attempt) =>
                attempt.effective_provider === 'codex' &&
                attempt.status === 'completed',
            )
            .at(-1)
          const claudeAttempt = attempts
            .filter(
              (attempt) =>
                attempt.effective_provider === 'claude' &&
                attempt.status === 'completed',
            )
            .at(-1)

          return Boolean(
            codexAttempt &&
              codexAttempt.runner_node_id === expectedCodexRunnerNodeId &&
              codexAttempt.host_group_id === expectedCodexRunnerHostGroupId &&
              codexAttempt.completed_at &&
              claudeAttempt &&
              claudeAttempt.runner_node_id === expectedClaudeRunnerNodeId &&
              claudeAttempt.host_group_id === expectedClaudeRunnerHostGroupId &&
              claudeAttempt.completed_at,
            )
        },
        {
          timeoutMs: liveProofTimeoutMs,
          intervalMs: 2_000,
        },
      )

      const runnerCapabilities = await db
        .selectFrom('runner_capabilities')
        .select(['runner_node_id', 'workspace_root', 'worktree_root'])
        .where('runner_node_id', 'in', [
          expectedCodexRunnerNodeId,
          expectedClaudeRunnerNodeId,
        ])
        .execute()

      const codexCapabilities = runnerCapabilities.find(
        (row) => row.runner_node_id === expectedCodexRunnerNodeId,
      )
      const claudeCapabilities = runnerCapabilities.find(
        (row) => row.runner_node_id === expectedClaudeRunnerNodeId,
      )

      assert.ok(codexCapabilities)
      assert.ok(claudeCapabilities)
      assert.equal(codexCapabilities?.workspace_root, expectedCodexWorkspaceRoot)
      assert.equal(codexCapabilities?.worktree_root, expectedCodexWorktreeRoot)
      assert.equal(claudeCapabilities?.workspace_root, expectedClaudeWorkspaceRoot)
      assert.equal(claudeCapabilities?.worktree_root, expectedClaudeWorktreeRoot)

      const attempts = await db
        .selectFrom('runner_lease_attempts as attempts')
        .innerJoin('runner_leases as leases', 'leases.lease_id', 'attempts.lease_id')
        .select([
          'attempts.lease_attempt_id as lease_attempt_id',
          'leases.requested_provider as requested_provider',
          'leases.status as lease_status',
          'leases.attempt_count as attempt_count',
          'attempts.effective_provider as effective_provider',
          'attempts.status as status',
          'attempts.runner_node_id as runner_node_id',
          'attempts.host_group_id as host_group_id',
          'attempts.provider_attempt_no as provider_attempt_no',
          'attempts.completed_at as completed_at',
          'attempts.execution_started_at as execution_started_at',
          'attempts.execution_session_key as execution_session_key',
          'attempts.released_at as released_at',
        ])
        .where('leases.issue_id', '=', issueId)
        .orderBy('attempts.provider_attempt_no', 'asc')
        .execute()

      const leaseRows = await db
        .selectFrom('runner_leases')
        .select([
          'lease_id',
          'requested_provider',
          'status',
          'attempt_count',
          'assigned_runner_node_id',
          'completed_at',
          'released_at',
        ])
        .where('issue_id', '=', issueId)
        .orderBy('requested_at', 'asc')
        .execute()

      const buildLease = leaseRows.find((lease) => lease.requested_provider === 'codex')
      const reviewLease = leaseRows.find((lease) => lease.requested_provider === 'claude')
      buildLeaseId = buildLease?.lease_id
      reviewLeaseId = reviewLease?.lease_id
      const buildAttempt = attempts
        .filter(
          (attempt) =>
            attempt.effective_provider === 'codex' &&
            attempt.status === 'completed',
        )
        .at(-1)
      const reviewAttempt = attempts
        .filter(
          (attempt) =>
            attempt.effective_provider === 'claude' &&
            attempt.status === 'completed',
        )
        .at(-1)

      assert.ok(buildLease)
      assert.ok(reviewLease)
      assert.ok(buildAttempt)
      assert.ok(reviewAttempt)
      assert.equal(buildLease?.status, 'released')
      assert.ok((buildLease?.attempt_count ?? 0) >= 1)
      assert.ok(buildAttempt?.completed_at)
      assert.equal(buildAttempt?.runner_node_id, expectedCodexRunnerNodeId)
      assert.equal(buildAttempt?.host_group_id, expectedCodexRunnerHostGroupId)
      assert.ok(buildAttempt?.lease_attempt_id)
      assert.ok(buildLease?.completed_at)
      assert.ok(buildLease?.released_at)
      assert.equal(reviewAttempt?.runner_node_id, expectedClaudeRunnerNodeId)
      assert.equal(reviewAttempt?.host_group_id, expectedClaudeRunnerHostGroupId)
      assert.ok(reviewAttempt?.completed_at)
      assert.ok(reviewAttempt?.lease_attempt_id)
      assert.equal(reviewLease?.assigned_runner_node_id, expectedClaudeRunnerNodeId)
      assert.equal(reviewLease?.status, 'completed')
      assert.ok(reviewLease?.completed_at)
      assert.ok(reviewLease?.attempt_count && reviewLease.attempt_count >= 1)
      assert.ok(buildAttempt?.execution_session_key)
      assert.ok(reviewAttempt?.execution_session_key)
      assert.ok(buildLeaseId)
      assert.ok(reviewLeaseId)
      const buildLeaseIdForProof = buildLeaseId
      const reviewLeaseIdForProof = reviewLeaseId

      await t.test('host_group_id no-leak proof is operator-visible', async () => {
        await assertHostGroupNoLeakLiveProof({
          buildLeaseId: buildLeaseIdForProof,
          reviewLeaseId: reviewLeaseIdForProof,
          expectedCodexRunnerNodeId,
          expectedClaudeRunnerNodeId,
          expectedCodexRunnerHostGroupId,
          expectedClaudeRunnerHostGroupId,
        })
      })

      const buildLeaseDetail = await fetchInternalJson(
        `/internal/runners/leases/${buildLease.lease_id}`,
      ) as {
        lease: { leaseId: string; requestedProvider: string; status: string }
        attempts: Array<{
          leaseAttemptId: string
          runnerNodeId: string
          hostGroupId: string
          executionSessionKey: string
          mcpBindingsSummary: Array<Record<string, unknown>>
          status: string
        }>
      }
      const reviewLeaseDetail = await fetchInternalJson(
        `/internal/runners/leases/${reviewLease.lease_id}`,
      ) as {
        lease: { leaseId: string; requestedProvider: string; status: string }
        attempts: Array<{
          leaseAttemptId: string
          runnerNodeId: string
          hostGroupId: string
          executionSessionKey: string
          mcpBindingsSummary: Array<Record<string, unknown>>
          status: string
        }>
      }

      assert.equal(buildLeaseDetail.lease.leaseId, buildLease.lease_id)
      assert.equal(buildLeaseDetail.lease.requestedProvider, 'codex')
      assert.equal(buildLeaseDetail.lease.status, 'released')
      assert.equal(
        buildLeaseDetail.attempts.at(-1)?.runnerNodeId,
        expectedCodexRunnerNodeId,
      )
      assert.equal(
        buildLeaseDetail.attempts.at(-1)?.hostGroupId,
        expectedCodexRunnerHostGroupId,
      )
      assert.equal(
        buildLeaseDetail.attempts.at(-1)?.executionSessionKey,
        buildAttempt?.execution_session_key,
      )
      assert.equal(reviewLeaseDetail.lease.leaseId, reviewLease.lease_id)
      assert.equal(reviewLeaseDetail.lease.requestedProvider, 'claude')
      assert.equal(reviewLeaseDetail.lease.status, 'completed')
      assert.equal(
        reviewLeaseDetail.attempts.at(-1)?.runnerNodeId,
        expectedClaudeRunnerNodeId,
      )
      assert.equal(
        reviewLeaseDetail.attempts.at(-1)?.hostGroupId,
        expectedClaudeRunnerHostGroupId,
      )
      assert.equal(
        reviewLeaseDetail.attempts.at(-1)?.executionSessionKey,
        reviewAttempt?.execution_session_key,
      )

      const buildReport = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type'])
        .where('issue_id', '=', issueId)
        .where('artifact_type', '=', 'build_report')
        .executeTakeFirst()

      assert.equal(buildReport?.artifact_type, 'build_report')

      const reviewAttemptLeaseId = reviewLease?.lease_id as string
      const reviewAttemptArtifactId = reviewAttempt?.lease_attempt_id as string
      const reviewRunnerArtifactBundleUri =
        `system://runner-leases/${reviewAttemptLeaseId}/attempts/${reviewAttemptArtifactId}/artifact-bundle`
      const reviewExecutionMetadataUri =
        `system://runner-leases/${reviewAttemptLeaseId}/attempts/${reviewAttemptArtifactId}/execution-metadata`

      const reviewRunnerArtifactBundle = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type'])
        .where('artifact_uri', '=', reviewRunnerArtifactBundleUri)
        .executeTakeFirst()

      const reviewExecutionMetadata = await db
        .selectFrom('artifact_registry')
        .select([
          'artifact_type',
          'artifact_uri',
          'produced_by_role',
          'produced_for_status_code',
          'metadata',
        ])
        .where('artifact_uri', '=', reviewExecutionMetadataUri)
        .executeTakeFirst()

      const reviewReport = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type', 'produced_by_role', 'produced_for_status_code'])
        .where('issue_id', '=', issueId)
        .where('artifact_type', '=', 'review_report')
        .where('produced_for_status_code', '=', 'agent_review')
        .executeTakeFirst()

      const verificationResult = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type', 'produced_by_role', 'produced_for_status_code'])
        .where('issue_id', '=', issueId)
        .where('artifact_type', '=', 'verification_result')
        .where('produced_for_status_code', '=', 'agent_review')
        .executeTakeFirst()

      assert.equal(reviewRunnerArtifactBundle?.artifact_type, 'runner_artifact_bundle')
      assert.equal(reviewExecutionMetadata?.artifact_type, 'agent_execution_metadata')
      assert.equal(reviewExecutionMetadata?.produced_by_role, 'review_agent')
      assert.equal(reviewExecutionMetadata?.produced_for_status_code, 'agent_review')
      assert.equal(reviewReport?.artifact_type, 'review_report')
      assert.equal(reviewReport?.produced_for_status_code, 'agent_review')
      assert.equal(verificationResult?.artifact_type, 'verification_result')
      assert.equal(verificationResult?.produced_for_status_code, 'agent_review')

      const reviewExecutionMetadataRecord = reviewExecutionMetadata?.metadata
      assert.ok(reviewExecutionMetadataRecord)

      const reviewExecutionMetadataHostGroupId = (
        reviewExecutionMetadataRecord as { hostGroupId?: string }
      )?.hostGroupId

      assert.equal(reviewExecutionMetadataHostGroupId, expectedClaudeRunnerHostGroupId)
    } catch (error) {
      if (issueId) {
        await dumpLiveProofDiagnostics(db, issueId, {
          buildLeaseId,
          reviewLeaseId,
        })
      }

      throw error
    } finally {
      await db.destroy()
    }
  },
)
