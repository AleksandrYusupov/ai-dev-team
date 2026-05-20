import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import {
  cacheContextPack,
  claimNextRunnerTask,
  ensurePhase7ReferenceRepoBootstrap,
  getActiveContextPackCache,
  getRunnerExecutionBundle,
  getLifecycleSnapshotView,
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
  recordRunnerAttemptCompletion,
  recordRunnerExecutionStarted,
  stageRunnerArtifactBlob,
  upsertIssueContractSnapshot,
  upsertRunnerCapabilityManifest,
  upsertLifecycleCommand,
} from '@ai-dev-team/db'
import type { ContextPack, RunnerCapabilityManifestV1 } from '@ai-dev-team/shared'
import type { Client } from '@temporalio/client'

import { applyTransition, bootstrapIssueRuntimeState } from './application/workflow/apply-transition.js'
import { runOutboxExecutorOnce } from './outbox/executor.js'
import { getLifecycleSnapshotQuery } from './workflows/index.js'
import {
  createTemporalTestEnvironment,
  createTemporalTestWorker,
  shutdownTemporalTestWorker,
  waitForCondition,
} from './testing/temporal.js'
import { runLifecycleCommandDispatchOnce } from './lifecycle/executor.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const linearStateNames = [
  'Triage',
  'Rework',
  'Needs Spec',
  'Needs Input',
  'Planned',
  'Ready for Build',
  'Coding',
  'Agent Review',
  'Blocked',
  'Needs Human Decision',
  'Ready to Merge',
  'Deploying',
  'Monitoring',
  'Done',
  'Canceled',
  'Duplicate',
]

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

function buildWorkflowConfig() {
  return loadWorkflowWorkerConfig(process.env)
}

function buildBuildRunnerManifest(
  runnerNodeId: string,
): RunnerCapabilityManifestV1 {
  return {
    schemaVersion: 1,
    runnerNodeId,
    hostGroupId: 'phase6-build-hosts',
    manifestVersion: 1,
    providers: ['codex'],
    providerCliVersions: {
      codex: '1.0.0',
    },
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
    workspaceRoot: `/tmp/${runnerNodeId}/workspace`,
    worktreeRoot: `/tmp/${runnerNodeId}/worktrees`,
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
    publishedAt: '2026-03-26T10:00:00.000Z',
  }
}

function buildReviewRunnerManifest(
  runnerNodeId: string,
): RunnerCapabilityManifestV1 {
  return {
    schemaVersion: 1,
    runnerNodeId,
    hostGroupId: 'phase7-review-hosts',
    manifestVersion: 1,
    providers: ['claude'],
    providerCliVersions: {
      claude: '1.0.0',
    },
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
    workspaceRoot: `/tmp/${runnerNodeId}/workspace`,
    worktreeRoot: `/tmp/${runnerNodeId}/worktrees`,
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

function buildPhase7ContextPack(input: {
  issueId: string
  issueContractSnapshotHash: string
  primaryRepo: string
}): ContextPack {
  return {
    issue: {
      issueId: input.issueId,
      goal: 'Prove the Phase 7 engineering loop on test_repo.',
      background: 'integration test',
      scope: ['build contract', 'review contract', 'human gate write-back'],
      nonGoals: ['GitHub PR automation'],
      acceptanceCriteria: [
        'Build and review consume frozen context.',
        'Review completion moves the issue to needs_human_decision.',
      ],
      verificationPath: {
        automated: ['corepack pnpm test:phase7'],
        manual: ['Inspect the Linear review summary.'],
      },
      doneWhen: ['The issue reaches needs_human_decision with durable artifacts.'],
      risk: 'medium',
      dependencies: {
        blocks: [],
        blockedBy: [],
        external: ['Linear comment publication'],
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
    decisionSummary: ['Phase 7 integration test context'],
    latestRelevantComments: [],
    docsPack: [],
    repoGuidance: [],
    budgets: {
      contextPolicyVersion: 1,
      estimatedTokens: 1800,
      maxTokens: 16_000,
      commentCount: 0,
      noteCount: 0,
      truncatedSections: [],
    },
    sourceTrace: {
      issueContractSnapshotId: 'snapshot-phase7-1',
      issueContractSnapshotHash: input.issueContractSnapshotHash,
      mappingIds: ['mapping-phase7-1'],
      noteSnapshotRefs: [],
      repoGuidanceRefs: [],
      commentRefs: [],
      warnings: [],
    },
  }
}

async function withTemporaryEnv<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }

  try {
    return await fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function startLinearStubServer() {
  const requests: Array<{
    headers: Record<string, string | string[] | undefined>
    payload: unknown
  }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      const payload = rawBody ? JSON.parse(rawBody) : null
      const requestPayload =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {}
      const query =
        typeof requestPayload.query === 'string' ? requestPayload.query : ''
      const variables =
        requestPayload.variables &&
        typeof requestPayload.variables === 'object' &&
        !Array.isArray(requestPayload.variables)
          ? (requestPayload.variables as Record<string, unknown>)
          : {}
      const issueId =
        typeof variables.issueId === 'string' && variables.issueId.length > 0
          ? variables.issueId
          : 'ISSUE-STUB-1'
      requests.push({
        headers: request.headers,
        payload,
      })
      response.writeHead(200, { 'content-type': 'application/json' })

      if (query.includes('query LinearSyncIssueContext')) {
        response.end(
          JSON.stringify({
            data: {
              issue: {
                id: issueId,
                identifier: issueId,
                title: `Stub ${issueId}`,
                state: {
                  id: 'state-triage',
                  name: 'Triage',
                },
                team: {
                  id: 'team-stub',
                  name: 'Stub Team',
                  states: {
                    nodes: linearStateNames.map((name) => ({
                      id: `state-${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
                      name,
                    })),
                  },
                },
                project: {
                  id: 'project-stub',
                  name: 'Stub Project',
                },
                attachments: {
                  nodes: [],
                },
              },
            },
          }),
        )
        return
      }

      if (query.includes('issueUpdate(')) {
        response.end(JSON.stringify({ data: { issueUpdate: { success: true } } }))
        return
      }

      if (query.includes('attachmentCreate(')) {
        response.end(
          JSON.stringify({ data: { attachmentCreate: { success: true } } }),
        )
        return
      }

      if (query.includes('projectUpdateCreate(')) {
        response.end(
          JSON.stringify({ data: { projectUpdateCreate: { success: true } } }),
        )
        return
      }

      if (query.includes('commentCreate(')) {
        response.end(
          JSON.stringify({ data: { commentCreate: { success: true } } }),
        )
        return
      }

      response.end(JSON.stringify({ data: {} }))
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind Linear stub server')
  }

  return {
    requests,
    apiBaseUrl: `http://127.0.0.1:${address.port.toString()}/graphql`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
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

test(
  'runLifecycleCommandDispatchOnce uses canonical workflow identity and survives worker restart',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const workflowId = 'issue:ISSUE-DISPATCH-1'
    const rogueWorkflowId = 'rogue:ISSUE-DISPATCH-1'

    let worker = await createTemporalTestWorker(env, workflowConfig)

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, { publishedBy: 'workflow-test' })

      const command = {
        schemaVersion: 1 as const,
        commandKey: 'dispatch-command-1',
        issueId: 'ISSUE-DISPATCH-1',
        workflowId: rogueWorkflowId,
        signalName: 'ingestCanonicalEvent' as const,
        source: 'workflow_test',
        sourceRef: 'dispatch-command-1',
        occurredAt: new Date().toISOString(),
        actorType: 'system' as const,
        actorId: 'dispatch-test',
        triggerCode: 'user_create_issue',
        metadata: {
          payloadRef: 'linear://ISSUE-DISPATCH-1',
        },
        guardOutcomes: {},
        blockedByIssueIds: [],
        canonicalEventId: null,
        requestedStatusCode: null,
        commentId: null,
        reasonCode: null,
        reasonText: null,
        checkpointId: null,
        leaseId: null,
      }

      await upsertLifecycleCommand(db, command)

      const client = env.client as Client
      const handle = client.workflow.getHandle(workflowId)

      const dispatched = await runLifecycleCommandDispatchOnce(
        db,
        client,
        workflowConfig,
      )

      assert.equal(dispatched, 1)

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)

        return (
          snapshot.workflowId === workflowId &&
          snapshot.lastProcessedCommandKey === command.commandKey
        )
      })

      const describeAfterFirstDispatch = await handle.describe()

      await shutdownTemporalTestWorker(worker)
      worker = await createTemporalTestWorker(env, workflowConfig)

      const describeAfterSecondDispatch = await handle.describe()

      assert.equal(
        describeAfterFirstDispatch.runId,
        describeAfterSecondDispatch.runId,
      )

      const transitionAuditCount = await db
        .selectFrom('status_transition_audit')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-DISPATCH-1')
        .executeTakeFirstOrThrow()

      assert.equal(Number(transitionAuditCount.count), 1)
    } finally {
      await shutdownTemporalTestWorker(worker).catch(() => undefined)
      await env.teardown()
      await db.destroy()
    }
  },
)

test(
  'runLifecycleCommandDispatchOnce moves durable commands to dead-letter on repeated Temporal failures',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const baseWorkflowConfig = buildWorkflowConfig()
    const workflowConfig = {
      ...baseWorkflowConfig,
      inbox: {
        ...baseWorkflowConfig.inbox,
        maxAttempts: 1,
      },
    }

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, { publishedBy: 'workflow-test' })

      await upsertLifecycleCommand(db, {
        schemaVersion: 1,
        commandKey: 'dispatch-command-failure',
        issueId: 'ISSUE-DISPATCH-FAILURE',
        workflowId: 'rogue:ISSUE-DISPATCH-FAILURE',
        signalName: 'ingestCanonicalEvent',
        source: 'workflow_test',
        sourceRef: 'dispatch-command-failure',
        occurredAt: new Date().toISOString(),
        actorType: 'system',
        actorId: 'dispatch-test',
        triggerCode: 'user_create_issue',
        metadata: {
          payloadRef: 'linear://ISSUE-DISPATCH-FAILURE',
        },
      })

      const failingClient = {
        workflow: {
          signalWithStart: async () => {
            throw new Error('synthetic temporal outage')
          },
        },
      } as unknown as Client

      const dispatched = await runLifecycleCommandDispatchOnce(
        db,
        failingClient,
        workflowConfig,
      )

      assert.equal(dispatched, 1)

      const inboxRow = await db
        .selectFrom('lifecycle_command_inbox')
        .select(['status', 'last_error'])
        .where('command_key', '=', 'dispatch-command-failure')
        .executeTakeFirstOrThrow()

      assert.equal(inboxRow.status, 'dead_letter')
      assert.match(inboxRow.last_error ?? '', /synthetic temporal outage/)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'runner fabric drives the durable build lifecycle from ready_for_build through agent_review',
  { skip: !hasDatabase },
  async () => {
    const linearStub = await startLinearStubServer()

    try {
      await withTemporaryEnv(
        {
          LINEAR_API_TOKEN: 'linear-sync-test-token',
          LINEAR_API_BASE_URL: linearStub.apiBaseUrl,
        },
        async () => {
          const db = await prepareTestDatabase()
          const env = await createTemporalTestEnvironment()
          const workflowConfig = buildWorkflowConfig()
          const runnerNodeId = 'runner-build-integration-1'
          const reviewRunnerNodeId = 'runner-review-integration-1'
          const workflowId = 'issue:ISSUE-RUNNER-LIFECYCLE-1'

          const worker = await createTemporalTestWorker(env, workflowConfig)

          try {
            const bundle = await loadWorkflowManifestBundle()
            await publishWorkflowConfig(db, bundle, { publishedBy: 'workflow-test' })
            await upsertRunnerCapabilityManifest(db, {
              authSubject: `runner-host:${runnerNodeId}`,
              manifest: buildBuildRunnerManifest(runnerNodeId),
            })
            await upsertRunnerCapabilityManifest(db, {
              authSubject: `runner-host:${reviewRunnerNodeId}`,
              manifest: buildReviewRunnerManifest(reviewRunnerNodeId),
            })

      await bootstrapIssueRuntimeState(db, {
        issueId: 'ISSUE-RUNNER-LIFECYCLE-1',
        workflowId,
        actorId: 'workflow-test',
        metadata: {
          payloadRef: 'linear://ISSUE-RUNNER-LIFECYCLE-1',
          highRisk: true,
        },
      })

      await applyTransition(db, {
        issueId: 'ISSUE-RUNNER-LIFECYCLE-1',
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
            artifactUri: 'artifact://runner-lifecycle/contract',
          },
        ],
      })

      const readyTransition = await applyTransition(db, {
        issueId: 'ISSUE-RUNNER-LIFECYCLE-1',
        triggerCode: 'system_ready_check_passed',
        actorType: 'system',
        actorId: 'plan-agent',
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
            artifactUri: 'artifact://runner-lifecycle/plan',
          },
          {
            artifactType: 'dependency_report',
            artifactScope: 'issue',
            artifactUri: 'artifact://runner-lifecycle/deps',
          },
          {
            artifactType: 'readiness_report',
            artifactScope: 'issue',
            artifactUri: 'artifact://runner-lifecycle/readiness',
          },
        ],
        metadata: {
          contextPackFingerprint: 'ctx-pack-runner-lifecycle',
        },
      })

            assert.equal(readyTransition.toStatus, 'ready_for_build')
            assert.equal(readyTransition.outboxCommandCount, 2)

      const initialOutboxProcessed = await runOutboxExecutorOnce(
        db,
        workflowConfig,
      )
      assert.equal(initialOutboxProcessed >= 1, true)

      const claimed = await claimNextRunnerTask(db, {
        runnerNodeId,
        heartbeatExpiryAt: new Date(Date.now() + 60_000),
      })
      assert.ok(claimed)
      assert.equal(claimed?.agentRole, 'build_agent_backend')
      assert.equal(claimed?.runKind, 'build')

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: claimed!.leaseAttemptId,
        runnerNodeId,
        executionSessionKey: claimed!.executionSessionKey,
        mcpBindingsSummary: claimed!.mcpBindingsSummary,
      })

      const dispatchStartCount = await runLifecycleCommandDispatchOnce(
        db,
        env.client as Client,
        workflowConfig,
      )
      assert.equal(dispatchStartCount, 1)

      await waitForCondition(async () => {
        const state = await db
          .selectFrom('issue_runtime_state')
          .select(['current_status_code', 'active_run_id'])
          .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
          .executeTakeFirstOrThrow()

        return (
          state.current_status_code === 'coding' &&
          state.active_run_id !== null
        )
      })

      const codingOutboxProcessed = await runOutboxExecutorOnce(db, workflowConfig)
      assert.equal(codingOutboxProcessed >= 1, true)

      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .selectAll()
        .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
        .executeTakeFirstOrThrow()

      assert.equal(runtimeState.current_status_code, 'coding')
      assert.equal(runtimeState.active_lease_id, claimed!.leaseId)
      assert.ok(runtimeState.active_run_id)

      const stagedPatch = await stageRunnerArtifactBlob(db, {
        leaseAttemptId: claimed!.leaseAttemptId,
        runnerNodeId,
        artifactKey: 'patch.diff',
        contentType: 'text/x-diff',
        contentBase64: Buffer.from('diff --git a/src/index.ts b/src/index.ts\n').toString('base64'),
        metadata: {
          kind: 'patch',
        },
      })

      const refreshedLease = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', claimed!.leaseId)
        .executeTakeFirstOrThrow()
      const claimedExecutionBundle = await getRunnerExecutionBundle(
        db,
        claimed!.leaseAttemptId,
      )

      await recordRunnerAttemptCompletion(db, {
        runnerNodeId,
        artifactBundle: {
          schemaVersion: 2,
          leaseId: claimed!.leaseId,
          leaseAttemptId: claimed!.leaseAttemptId,
          issueId: 'ISSUE-RUNNER-LIFECYCLE-1',
          runId: refreshedLease.run_id,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          roleExecutionPolicyVersion: 1,
          agentRole: claimed!.agentRole,
          status: 'completed',
          summary: 'Build completed with one source change.',
          changedFiles: ['src/index.ts'],
          testResults: [{ name: 'unit', passed: true }],
          patchRef: stagedPatch.artifactUri,
          branchRef: 'refs/heads/issue/ISSUE-RUNNER-LIFECYCLE-1',
          reviewFindings: [],
          executionSessionKey: claimed!.executionSessionKey,
          mcpProfileRef: claimed!.mcpProfileRef,
          mcpBindingsSummary: claimed!.mcpBindingsSummary,
          toolUsage: ['codex'],
          mcpBindings: claimed!.mcpBindingsSummary,
          providerExecutionMetadata: {
            mode: 'integration-test',
          },
          producedAt: new Date().toISOString(),
        },
        executionMetadata: {
          schemaVersion: 2,
          agentRole: claimed!.agentRole,
          promptVersion: claimed!.promptVersion!,
          agentLibraryReleaseId: claimed!.agentLibraryReleaseId,
          taskInstructionsRef: claimed!.taskInstructionsRef,
          roleCharterRef: claimed!.roleCharterRef,
          promptBundleFingerprint: claimedExecutionBundle.promptBundleFingerprint,
          resolvedPromptFamilyRefs:
            claimedExecutionBundle.resolvedPromptFamilyRefs,
          skillPackRefs: claimed!.skillPackRefs,
          resolvedSkillRefs: claimedExecutionBundle.resolvedSkillRefs,
          skippedOptionalSkillRefs:
            claimedExecutionBundle.skippedOptionalSkillRefs,
          effectiveSkillFingerprint: claimed!.effectiveSkillFingerprint,
          contextPackFingerprint: claimed!.contextPackFingerprint,
          configVersion: 1,
          workflowId,
          workflowRunId: refreshedLease.run_id,
          runKind: 'build',
          attemptNo: 1,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          toolsUsed: ['codex'],
          mcpBindings: claimed!.mcpBindingsSummary,
          runnerNodeId,
          hostGroupId: 'phase6-build-hosts',
          executionDurationMs: 1_250,
          completionReason: 'completed',
        },
      })

      const dispatchFinishCount = await runLifecycleCommandDispatchOnce(
        db,
        env.client as Client,
        workflowConfig,
      )
      assert.equal(dispatchFinishCount, 1)

      await waitForCondition(async () => {
        const state = await db
          .selectFrom('issue_runtime_state')
          .select('current_status_code')
          .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
          .executeTakeFirstOrThrow()

        return state.current_status_code === 'agent_review'
      })

            const agentReviewOutbox = await db
              .selectFrom('workflow_effect_outbox')
              .select(['command_type', 'status'])
              .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
              .where('status', '=', 'pending')
              .execute()

            assert.deepEqual(
              agentReviewOutbox
                .map((row) => row.command_type)
                .sort(),
              [
                'create_runner_lease',
                'release_runner_lease',
                'sync_linear_state',
              ],
            )

      const releaseOutboxProcessed = await runOutboxExecutorOnce(db, workflowConfig)
      assert.equal(releaseOutboxProcessed >= 1, true)

      const testLease = await db
        .selectFrom('runner_leases')
        .select([
          'requested_provider',
          'requested_owner_role',
          'requested_run_kind',
          'status',
          'run_id',
        ])
        .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
        .where('requested_owner_role', '=', 'test_agent')
        .orderBy('requested_at', 'desc')
        .executeTakeFirst()

      assert.equal(testLease?.requested_provider, 'codex')
      assert.equal(testLease?.requested_owner_role, 'test_agent')
      assert.equal(testLease?.requested_run_kind, 'build')
      assert.equal(testLease?.status, 'requested')

      const testTask = await claimNextRunnerTask(db, {
        runnerNodeId,
        heartbeatExpiryAt: new Date(Date.now() + 60_000),
      })

      assert.ok(testTask)
      assert.equal(testTask?.agentRole, 'test_agent')
      assert.equal(testTask?.runKind, 'build')

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: testTask!.leaseAttemptId,
        runnerNodeId,
        executionSessionKey: testTask!.executionSessionKey,
        mcpBindingsSummary: testTask!.mcpBindingsSummary,
      })

      const testLeaseRow = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', testTask!.leaseId)
        .executeTakeFirstOrThrow()
      const testExecutionBundle = await getRunnerExecutionBundle(
        db,
        testTask!.leaseAttemptId,
      )

      await recordRunnerAttemptCompletion(db, {
        runnerNodeId,
        artifactBundle: {
          schemaVersion: 2,
          leaseId: testTask!.leaseId,
          leaseAttemptId: testTask!.leaseAttemptId,
          issueId: 'ISSUE-RUNNER-LIFECYCLE-1',
          runId: testLeaseRow.run_id,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          roleExecutionPolicyVersion: 1,
          agentRole: testTask!.agentRole,
          status: 'completed',
          runKind: testTask!.runKind,
          summary: 'Verification completed for the high-risk build.',
          changedFiles: [],
          testResults: [{ name: 'integration', passed: true }],
          patchRef: null,
          branchRef: null,
          reviewFindings: [],
          executionSessionKey: testTask!.executionSessionKey,
          mcpProfileRef: testTask!.mcpProfileRef,
          mcpBindingsSummary: testTask!.mcpBindingsSummary,
          toolUsage: ['codex'],
          mcpBindings: testTask!.mcpBindingsSummary,
          providerExecutionMetadata: {
            mode: 'integration-test',
          },
          producedAt: new Date().toISOString(),
        },
        executionMetadata: {
          schemaVersion: 2,
          agentRole: testTask!.agentRole,
          promptVersion: testTask!.promptVersion!,
          agentLibraryReleaseId: testTask!.agentLibraryReleaseId,
          taskInstructionsRef: testTask!.taskInstructionsRef,
          roleCharterRef: testTask!.roleCharterRef,
          promptBundleFingerprint: testExecutionBundle.promptBundleFingerprint,
          resolvedPromptFamilyRefs:
            testExecutionBundle.resolvedPromptFamilyRefs,
          skillPackRefs: testTask!.skillPackRefs,
          resolvedSkillRefs: testExecutionBundle.resolvedSkillRefs,
          skippedOptionalSkillRefs:
            testExecutionBundle.skippedOptionalSkillRefs,
          effectiveSkillFingerprint: testTask!.effectiveSkillFingerprint,
          contextPackFingerprint: testTask!.contextPackFingerprint,
          configVersion: 1,
          workflowId,
          workflowRunId: testLeaseRow.run_id,
          runKind: testTask!.runKind,
          attemptNo: 1,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          toolsUsed: ['codex'],
          mcpBindings: testTask!.mcpBindingsSummary,
          runnerNodeId,
          hostGroupId: 'phase6-build-hosts',
          executionDurationMs: 650,
          completionReason: 'completed',
        },
      })

      const securityOutboxProcessed = await runOutboxExecutorOnce(
        db,
        workflowConfig,
      )
      assert.equal(securityOutboxProcessed >= 1, true)

      const securityLease = await db
        .selectFrom('runner_leases')
        .select([
          'requested_provider',
          'requested_owner_role',
          'requested_run_kind',
          'status',
          'run_id',
        ])
        .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
        .where('requested_owner_role', '=', 'security_agent')
        .orderBy('requested_at', 'desc')
        .executeTakeFirst()

      assert.equal(securityLease?.requested_provider, 'claude')
      assert.equal(securityLease?.requested_owner_role, 'security_agent')
      assert.equal(securityLease?.requested_run_kind, 'review')
      assert.equal(securityLease?.status, 'requested')

      const securityTask = await claimNextRunnerTask(db, {
        runnerNodeId: reviewRunnerNodeId,
        heartbeatExpiryAt: new Date(Date.now() + 60_000),
      })

      assert.ok(securityTask)
      assert.equal(securityTask?.agentRole, 'security_agent')
      assert.equal(securityTask?.runKind, 'review')

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: securityTask!.leaseAttemptId,
        runnerNodeId: reviewRunnerNodeId,
        executionSessionKey: securityTask!.executionSessionKey,
        mcpBindingsSummary: securityTask!.mcpBindingsSummary,
      })

      const securityLeaseRow = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', securityTask!.leaseId)
        .executeTakeFirstOrThrow()
      const securityExecutionBundle = await getRunnerExecutionBundle(
        db,
        securityTask!.leaseAttemptId,
      )

      await recordRunnerAttemptCompletion(db, {
        runnerNodeId: reviewRunnerNodeId,
        artifactBundle: {
          schemaVersion: 2,
          leaseId: securityTask!.leaseId,
          leaseAttemptId: securityTask!.leaseAttemptId,
          issueId: 'ISSUE-RUNNER-LIFECYCLE-1',
          runId: securityLeaseRow.run_id,
          requestedProvider: 'claude',
          effectiveProvider: 'claude',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          roleExecutionPolicyVersion: 1,
          agentRole: securityTask!.agentRole,
          status: 'completed',
          runKind: securityTask!.runKind,
          summary: 'Security review completed for the high-risk build.',
          changedFiles: [],
          testResults: [],
          patchRef: null,
          branchRef: null,
          reviewFindings: [],
          recommendedNextAction: 'Proceed to the independent review pass.',
          executionSessionKey: securityTask!.executionSessionKey,
          mcpProfileRef: securityTask!.mcpProfileRef,
          mcpBindingsSummary: securityTask!.mcpBindingsSummary,
          toolUsage: ['claude'],
          mcpBindings: securityTask!.mcpBindingsSummary,
          providerExecutionMetadata: {
            mode: 'integration-test',
          },
          producedAt: new Date().toISOString(),
        },
        executionMetadata: {
          schemaVersion: 2,
          agentRole: securityTask!.agentRole,
          promptVersion: securityTask!.promptVersion!,
          agentLibraryReleaseId: securityTask!.agentLibraryReleaseId,
          taskInstructionsRef: securityTask!.taskInstructionsRef,
          roleCharterRef: securityTask!.roleCharterRef,
          promptBundleFingerprint:
            securityExecutionBundle.promptBundleFingerprint,
          resolvedPromptFamilyRefs:
            securityExecutionBundle.resolvedPromptFamilyRefs,
          skillPackRefs: securityTask!.skillPackRefs,
          resolvedSkillRefs: securityExecutionBundle.resolvedSkillRefs,
          skippedOptionalSkillRefs:
            securityExecutionBundle.skippedOptionalSkillRefs,
          effectiveSkillFingerprint: securityTask!.effectiveSkillFingerprint,
          contextPackFingerprint: securityTask!.contextPackFingerprint,
          configVersion: 1,
          workflowId,
          workflowRunId: securityLeaseRow.run_id,
          runKind: securityTask!.runKind,
          attemptNo: 1,
          requestedProvider: 'claude',
          effectiveProvider: 'claude',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          toolsUsed: ['claude'],
          mcpBindings: securityTask!.mcpBindingsSummary,
          runnerNodeId: reviewRunnerNodeId,
          hostGroupId: 'phase7-review-hosts',
          executionDurationMs: 700,
          completionReason: 'completed',
        },
      })

      const reviewOutboxProcessed = await runOutboxExecutorOnce(db, workflowConfig)
      assert.equal(reviewOutboxProcessed >= 1, true)

      const finalRuntimeState = await db
        .selectFrom('issue_runtime_state')
        .selectAll()
        .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
        .executeTakeFirstOrThrow()

      const reviewLease = await db
        .selectFrom('runner_leases')
        .select([
          'requested_provider',
          'requested_owner_role',
          'requested_run_kind',
          'status',
          'run_id',
        ])
        .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
        .where('requested_owner_role', '=', 'review_agent')
        .orderBy('requested_at', 'desc')
        .executeTakeFirst()

      assert.equal(reviewLease?.requested_provider, 'claude')
      assert.equal(reviewLease?.requested_owner_role, 'review_agent')
      assert.equal(reviewLease?.requested_run_kind, 'review')
      assert.equal(reviewLease?.status, 'requested')
      assert.equal(reviewLease?.run_id, finalRuntimeState.active_run_id)

      assert.equal(finalRuntimeState.current_status_code, 'agent_review')
      assert.equal(finalRuntimeState.active_lease_id, null)
      assert.ok(finalRuntimeState.active_run_id)

      const finalLease = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', claimed!.leaseId)
        .executeTakeFirstOrThrow()

      assert.equal(finalLease.status, 'released')
      assert.ok(finalLease.completed_at)
      assert.ok(finalLease.released_at)
      assert.equal(finalLease.run_id, finalRuntimeState.active_run_id)
      assert.ok(finalLease.result_artifact_id)

      const buildReport = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type'])
        .where('issue_id', '=', 'ISSUE-RUNNER-LIFECYCLE-1')
        .where('artifact_type', '=', 'build_report')
        .executeTakeFirst()

            assert.equal(buildReport?.artifact_type, 'build_report')
          } finally {
            await shutdownTemporalTestWorker(worker).catch(() => undefined)
            await env.teardown()
            await db.destroy()
          }
        },
      )
    } finally {
      await linearStub.close()
    }
  },
)

test(
  'phase 7 runner fabric carries frozen context into build and review, then publishes one Linear decision summary',
  { skip: !hasDatabase },
  async () => {
    const linearStub = await startLinearStubServer()

    try {
      await withTemporaryEnv(
        {
          LINEAR_API_TOKEN: 'linear-phase7-token',
          LINEAR_API_BASE_URL: linearStub.apiBaseUrl,
        },
        async () => {
          const db = await prepareTestDatabase()
          const env = await createTemporalTestEnvironment()
          const workflowConfig = buildWorkflowConfig()
          const buildRunnerNodeId = 'runner-phase7-build-1'
          const reviewRunnerNodeId = 'runner-phase7-review-1'
          const issueId = 'ISSUE-PHASE7-LIFECYCLE-1'
          const workflowId = `issue:${issueId}`
          const contextPackFingerprint = 'ctx-phase7-lifecycle-1'
          const localCheckoutPath =
            '/tmp/ai-dev-team/reference_repos/test_repo'
          const worker = await createTemporalTestWorker(env, workflowConfig)

          try {
            const bundle = await loadWorkflowManifestBundle()
            await publishWorkflowConfig(db, bundle, { publishedBy: 'workflow-test' })
            await upsertRunnerCapabilityManifest(db, {
              authSubject: `runner-host:${buildRunnerNodeId}`,
              manifest: buildBuildRunnerManifest(buildRunnerNodeId),
            })
            await upsertRunnerCapabilityManifest(db, {
              authSubject: `runner-host:${reviewRunnerNodeId}`,
              manifest: buildReviewRunnerManifest(reviewRunnerNodeId),
            })

            await ensurePhase7ReferenceRepoBootstrap(db, {
              localCheckoutPath,
            })

            await upsertIssueContractSnapshot(db, {
              issueId,
              snapshotHash: 'snapshot-hash-phase7-1',
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
                goal: 'Close the honest Phase 7 engineering loop.',
                background: 'integration test',
                scope: ['Freeze context', 'Persist build evidence', 'Persist review evidence'],
                nonGoals: ['GitHub merge automation'],
                acceptanceCriteria: [
                  'Task envelopes remain frozen.',
                  'Review completion reaches needs_human_decision.',
                ],
                verificationPath: {
                  automated: ['corepack pnpm test:phase7'],
                  manual: [],
                },
                docsLinks: [
                  'ai_dev_team/architecture/10_phase_7_first_end_to_end_build_and_review_spec.md',
                ],
                dependencies: {
                  blocks: [],
                  blockedBy: [],
                  external: [],
                },
                risk: 'medium',
                doneWhen: ['The issue reaches needs_human_decision.'],
                openQuestions: [],
                humanDecisionRequired: true,
                issueType: 'feature',
                source: 'founder',
                mode: 'autonomous',
              },
            })

            await cacheContextPack(db, {
              issueId,
              inputFingerprint: contextPackFingerprint,
              bundleJson: buildPhase7ContextPack({
                issueId,
                issueContractSnapshotHash: 'snapshot-hash-phase7-1',
                primaryRepo: 'test_repo',
              }),
              estimatedTokens: 1800,
              sourceTraceJson: {
                issueContractSnapshotId: 'snapshot-phase7-1',
                issueContractSnapshotHash: 'snapshot-hash-phase7-1',
                mappingIds: ['mapping-phase7-1'],
                noteSnapshotRefs: [],
                repoGuidanceRefs: [],
                commentRefs: [],
                warnings: [],
              },
            })
            const cachedContextPack = await getActiveContextPackCache(
              db,
              issueId,
              contextPackFingerprint,
            )

            assert.ok(cachedContextPack)

            await bootstrapIssueRuntimeState(db, {
              issueId,
              workflowId,
              actorId: 'workflow-test',
              metadata: {
                payloadRef: `linear://${issueId}`,
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
                  artifactUri: 'artifact://phase7/contract',
                },
              ],
            })

            const readyTransition = await applyTransition(db, {
              issueId,
              triggerCode: 'system_ready_check_passed',
              actorType: 'system',
              actorId: 'plan-agent',
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
                  artifactUri: 'artifact://phase7/plan',
                },
                {
                  artifactType: 'dependency_report',
                  artifactScope: 'issue',
                  artifactUri: 'artifact://phase7/deps',
                },
                {
                  artifactType: 'readiness_report',
                  artifactScope: 'issue',
                  artifactUri: 'artifact://phase7/readiness',
                },
              ],
              metadata: {
                contextPackFingerprint,
              },
            })

            assert.equal(readyTransition.toStatus, 'ready_for_build')

            await runOutboxExecutorOnce(db, workflowConfig)

            const buildTask = await claimNextRunnerTask(db, {
              runnerNodeId: buildRunnerNodeId,
              heartbeatExpiryAt: new Date(Date.now() + 60_000),
            })

            assert.ok(buildTask)
            assert.equal(buildTask?.agentRole, 'build_agent_backend')
            assert.equal(buildTask?.runKind, 'build')
            assert.equal(buildTask?.repoSlug, 'test_repo')
            assert.equal(buildTask?.localCheckoutPath, localCheckoutPath)
            assert.equal(buildTask?.contextPackRef, cachedContextPack?.id)
            assert.equal(buildTask?.contextPackFingerprint, contextPackFingerprint)
            assert.equal(buildTask?.reviewedBuildArtifactId ?? null, null)

            await recordRunnerExecutionStarted(db, {
              leaseAttemptId: buildTask!.leaseAttemptId,
              runnerNodeId: buildRunnerNodeId,
              executionSessionKey: buildTask!.executionSessionKey,
              mcpBindingsSummary: buildTask!.mcpBindingsSummary,
            })

            await runLifecycleCommandDispatchOnce(
              db,
              env.client as Client,
              workflowConfig,
            )

            await waitForCondition(async () => {
              const state = await db
                .selectFrom('issue_runtime_state')
                .select('current_status_code')
                .where('issue_id', '=', issueId)
                .executeTakeFirstOrThrow()

              return state.current_status_code === 'coding'
            })

            await runOutboxExecutorOnce(db, workflowConfig)

            const buildPatchArtifact = await stageRunnerArtifactBlob(db, {
              leaseAttemptId: buildTask!.leaseAttemptId,
              runnerNodeId: buildRunnerNodeId,
              artifactKey: 'phase7.patch',
              contentType: 'text/x-diff',
              contentBase64: Buffer.from('diff --git a/src/index.ts b/src/index.ts\n').toString('base64'),
              metadata: {
                kind: 'patch',
              },
            })

            const buildLeaseRow = await db
              .selectFrom('runner_leases')
              .selectAll()
              .where('lease_id', '=', buildTask!.leaseId)
              .executeTakeFirstOrThrow()
            const buildExecutionBundle = await getRunnerExecutionBundle(
              db,
              buildTask!.leaseAttemptId,
            )

            const buildCompletion = await recordRunnerAttemptCompletion(db, {
              runnerNodeId: buildRunnerNodeId,
              artifactBundle: {
                schemaVersion: 2,
                leaseId: buildTask!.leaseId,
                leaseAttemptId: buildTask!.leaseAttemptId,
                issueId,
                runId: buildLeaseRow.run_id,
                requestedProvider: 'codex',
                effectiveProvider: 'codex',
                providerAttemptNo: 1,
                fallbackFromProvider: null,
                fallbackReason: null,
                roleExecutionPolicyVersion: 1,
                agentRole: buildTask!.agentRole,
                status: 'completed',
                runKind: 'build',
                summary: 'Build completed against frozen context.',
                changedFiles: ['src/index.ts'],
                testResults: [{ name: 'typecheck', passed: true }],
                patchRef: buildPatchArtifact.artifactUri,
                branchRef: 'refs/heads/issue/ISSUE-PHASE7-LIFECYCLE-1',
                reviewFindings: [],
                executionSessionKey: buildTask!.executionSessionKey,
                mcpProfileRef: buildTask!.mcpProfileRef,
                mcpBindingsSummary: buildTask!.mcpBindingsSummary,
                toolUsage: ['codex'],
                mcpBindings: buildTask!.mcpBindingsSummary,
                providerExecutionMetadata: {
                  mode: 'integration-test',
                  contextPackFingerprint,
                },
                producedAt: new Date().toISOString(),
              },
              executionMetadata: {
                schemaVersion: 2,
                agentRole: buildTask!.agentRole,
                promptVersion: buildTask!.promptVersion!,
                agentLibraryReleaseId: buildTask!.agentLibraryReleaseId,
                taskInstructionsRef: buildTask!.taskInstructionsRef,
                roleCharterRef: buildTask!.roleCharterRef,
                promptBundleFingerprint:
                  buildExecutionBundle.promptBundleFingerprint,
                resolvedPromptFamilyRefs:
                  buildExecutionBundle.resolvedPromptFamilyRefs,
                skillPackRefs: buildTask!.skillPackRefs,
                resolvedSkillRefs: buildExecutionBundle.resolvedSkillRefs,
                skippedOptionalSkillRefs:
                  buildExecutionBundle.skippedOptionalSkillRefs,
                effectiveSkillFingerprint: buildTask!.effectiveSkillFingerprint,
                contextPackFingerprint,
                configVersion: 1,
                workflowId,
                workflowRunId: buildLeaseRow.run_id,
                runKind: 'build',
                attemptNo: 1,
                requestedProvider: 'codex',
                effectiveProvider: 'codex',
                providerAttemptNo: 1,
                fallbackFromProvider: null,
                fallbackReason: null,
                toolsUsed: ['codex'],
                mcpBindings: buildTask!.mcpBindingsSummary,
                runnerNodeId: buildRunnerNodeId,
                hostGroupId: 'phase6-build-hosts',
                executionDurationMs: 800,
                completionReason: 'completed',
              },
            })

            await runLifecycleCommandDispatchOnce(
              db,
              env.client as Client,
              workflowConfig,
            )

            await waitForCondition(async () => {
              const state = await db
                .selectFrom('issue_runtime_state')
                .select('current_status_code')
                .where('issue_id', '=', issueId)
                .executeTakeFirstOrThrow()

              return state.current_status_code === 'agent_review'
            })

            await runOutboxExecutorOnce(db, workflowConfig)

            const testTask = await claimNextRunnerTask(db, {
              runnerNodeId: buildRunnerNodeId,
              heartbeatExpiryAt: new Date(Date.now() + 60_000),
            })

            assert.ok(testTask)
            assert.equal(testTask?.agentRole, 'test_agent')
            assert.equal(testTask?.runKind, 'build')
            assert.equal(testTask?.repoSlug, 'test_repo')
            assert.equal(testTask?.contextPackRef, cachedContextPack?.id)
            assert.equal(testTask?.contextPackFingerprint, contextPackFingerprint)

            await recordRunnerExecutionStarted(db, {
              leaseAttemptId: testTask!.leaseAttemptId,
              runnerNodeId: buildRunnerNodeId,
              executionSessionKey: testTask!.executionSessionKey,
              mcpBindingsSummary: testTask!.mcpBindingsSummary,
            })

            const testLeaseRow = await db
              .selectFrom('runner_leases')
              .selectAll()
              .where('lease_id', '=', testTask!.leaseId)
              .executeTakeFirstOrThrow()
            const phase7TestExecutionBundle = await getRunnerExecutionBundle(
              db,
              testTask!.leaseAttemptId,
            )

            await recordRunnerAttemptCompletion(db, {
              runnerNodeId: buildRunnerNodeId,
              artifactBundle: {
                schemaVersion: 2,
                leaseId: testTask!.leaseId,
                leaseAttemptId: testTask!.leaseAttemptId,
                issueId,
                runId: testLeaseRow.run_id,
                requestedProvider: 'codex',
                effectiveProvider: 'codex',
                providerAttemptNo: 1,
                fallbackFromProvider: null,
                fallbackReason: null,
                roleExecutionPolicyVersion: 1,
                agentRole: testTask!.agentRole,
                status: 'completed',
                runKind: testTask!.runKind,
                summary: 'Verification completed against the frozen context pack.',
                changedFiles: [],
                testResults: [{ name: 'phase7-verification', passed: true }],
                patchRef: null,
                branchRef: null,
                reviewFindings: [],
                executionSessionKey: testTask!.executionSessionKey,
                mcpProfileRef: testTask!.mcpProfileRef,
                mcpBindingsSummary: testTask!.mcpBindingsSummary,
                toolUsage: ['codex'],
                mcpBindings: testTask!.mcpBindingsSummary,
                providerExecutionMetadata: {
                  mode: 'integration-test',
                  contextPackFingerprint,
                },
                producedAt: new Date().toISOString(),
              },
              executionMetadata: {
                schemaVersion: 2,
                agentRole: testTask!.agentRole,
                promptVersion: testTask!.promptVersion!,
                agentLibraryReleaseId: testTask!.agentLibraryReleaseId,
                taskInstructionsRef: testTask!.taskInstructionsRef,
                roleCharterRef: testTask!.roleCharterRef,
                promptBundleFingerprint:
                  phase7TestExecutionBundle.promptBundleFingerprint,
                resolvedPromptFamilyRefs:
                  phase7TestExecutionBundle.resolvedPromptFamilyRefs,
                skillPackRefs: testTask!.skillPackRefs,
                resolvedSkillRefs: phase7TestExecutionBundle.resolvedSkillRefs,
                skippedOptionalSkillRefs:
                  phase7TestExecutionBundle.skippedOptionalSkillRefs,
                effectiveSkillFingerprint: testTask!.effectiveSkillFingerprint,
                contextPackFingerprint,
                configVersion: 1,
                workflowId,
                workflowRunId: testLeaseRow.run_id,
                runKind: testTask!.runKind,
                attemptNo: 1,
                requestedProvider: 'codex',
                effectiveProvider: 'codex',
                providerAttemptNo: 1,
                fallbackFromProvider: null,
                fallbackReason: null,
                toolsUsed: ['codex'],
                mcpBindings: testTask!.mcpBindingsSummary,
                runnerNodeId: buildRunnerNodeId,
                hostGroupId: 'phase6-build-hosts',
                executionDurationMs: 250,
                completionReason: 'completed',
              },
            })

            await runOutboxExecutorOnce(db, workflowConfig)

            const reviewTask = await claimNextRunnerTask(db, {
              runnerNodeId: reviewRunnerNodeId,
              heartbeatExpiryAt: new Date(Date.now() + 60_000),
            })

            assert.ok(reviewTask)
            assert.equal(reviewTask?.agentRole, 'review_agent')
            assert.equal(reviewTask?.runKind, 'review')
            assert.equal(reviewTask?.repoSlug, 'test_repo')
            assert.equal(reviewTask?.contextPackRef, cachedContextPack?.id)
            assert.equal(reviewTask?.contextPackFingerprint, contextPackFingerprint)
            assert.ok(buildCompletion.resultArtifactId)
            const buildArtifactId = buildCompletion.resultArtifactId
            assert.equal(reviewTask?.reviewedBuildArtifactId, buildArtifactId)

            await recordRunnerExecutionStarted(db, {
              leaseAttemptId: reviewTask!.leaseAttemptId,
              runnerNodeId: reviewRunnerNodeId,
              executionSessionKey: reviewTask!.executionSessionKey,
              mcpBindingsSummary: reviewTask!.mcpBindingsSummary,
            })

            const reviewPatchArtifact = await stageRunnerArtifactBlob(db, {
              leaseAttemptId: reviewTask!.leaseAttemptId,
              runnerNodeId: reviewRunnerNodeId,
              artifactKey: 'phase7.review.patch',
              contentType: 'text/x-diff',
              contentBase64: Buffer.from(
                'diff --git a/src/index.ts b/src/index.ts\n',
              ).toString('base64'),
              metadata: {
                kind: 'patch',
              },
            })

            const reviewLeaseRow = await db
              .selectFrom('runner_leases')
              .selectAll()
              .where('lease_id', '=', reviewTask!.leaseId)
              .executeTakeFirstOrThrow()
            const reviewExecutionBundle = await getRunnerExecutionBundle(
              db,
              reviewTask!.leaseAttemptId,
            )

            await recordRunnerAttemptCompletion(db, {
              runnerNodeId: reviewRunnerNodeId,
              artifactBundle: {
                schemaVersion: 2,
                leaseId: reviewTask!.leaseId,
                leaseAttemptId: reviewTask!.leaseAttemptId,
                issueId,
                runId: reviewLeaseRow.run_id,
                requestedProvider: 'claude',
                effectiveProvider: 'claude',
                providerAttemptNo: 1,
                fallbackFromProvider: null,
                fallbackReason: null,
                roleExecutionPolicyVersion: 1,
                agentRole: 'review_agent',
                status: 'completed',
                runKind: 'review',
                summary: 'Review completed and recommends a human decision before more coding.',
                changedFiles: ['src/index.ts'],
                testResults: [{ name: 'typecheck', passed: true }],
                patchRef: reviewPatchArtifact.artifactUri,
                branchRef: 'refs/heads/issue/ISSUE-PHASE7-LIFECYCLE-1',
                reviewFindings: [
                  {
                    severity: 'medium',
                    title: 'Behavioral change requires approval',
                    body: 'The build succeeded, but the change should be explicitly approved before continuing.',
                    filePath: 'src/index.ts',
                    line: 1,
                    evidenceRef: buildPatchArtifact.artifactUri,
                  },
                ],
                reviewDisposition: 'rework_recommended',
                decisionSummary:
                  'The change is coherent but should return to coding after a human decision.',
                recommendedNextAction:
                  'Review the summary and decide whether to send the issue back to coding.',
                reviewedBuildArtifactId: buildArtifactId,
                executionSessionKey: reviewTask!.executionSessionKey,
                mcpProfileRef: reviewTask!.mcpProfileRef,
                mcpBindingsSummary: reviewTask!.mcpBindingsSummary,
                toolUsage: ['claude'],
                mcpBindings: reviewTask!.mcpBindingsSummary,
                providerExecutionMetadata: {
                  mode: 'integration-test',
                  contextPackFingerprint,
                  reviewedBuildArtifactId: buildArtifactId,
                },
                producedAt: new Date().toISOString(),
              },
              executionMetadata: {
                schemaVersion: 2,
                agentRole: 'review_agent',
                promptVersion: reviewTask!.promptVersion!,
                agentLibraryReleaseId: reviewTask!.agentLibraryReleaseId,
                taskInstructionsRef: reviewTask!.taskInstructionsRef,
                roleCharterRef: reviewTask!.roleCharterRef,
                promptBundleFingerprint:
                  reviewExecutionBundle.promptBundleFingerprint,
                resolvedPromptFamilyRefs:
                  reviewExecutionBundle.resolvedPromptFamilyRefs,
                skillPackRefs: reviewTask!.skillPackRefs,
                resolvedSkillRefs: reviewExecutionBundle.resolvedSkillRefs,
                skippedOptionalSkillRefs:
                  reviewExecutionBundle.skippedOptionalSkillRefs,
                effectiveSkillFingerprint: reviewTask!.effectiveSkillFingerprint,
                contextPackFingerprint,
                configVersion: 1,
                workflowId,
                workflowRunId: reviewLeaseRow.run_id,
                runKind: 'review',
                attemptNo: 1,
                requestedProvider: 'claude',
                effectiveProvider: 'claude',
                providerAttemptNo: 1,
                fallbackFromProvider: null,
                fallbackReason: null,
                toolsUsed: ['claude'],
                mcpBindings: reviewTask!.mcpBindingsSummary,
                runnerNodeId: reviewRunnerNodeId,
                hostGroupId: 'phase7-review-hosts',
                executionDurationMs: 450,
                completionReason: 'completed',
                reviewedBuildArtifactId: buildArtifactId,
              },
            })

            const dispatchedReviewCompletion = await runLifecycleCommandDispatchOnce(
              db,
              env.client as Client,
              workflowConfig,
            )
            assert.equal(dispatchedReviewCompletion, 1)

            const handle = (env.client as Client).workflow.getHandle(workflowId)
            await waitForCondition(async () => {
              const state = await db
                .selectFrom('issue_runtime_state')
                .select('current_status_code')
                .where('issue_id', '=', issueId)
                .executeTakeFirstOrThrow()

              return state.current_status_code === 'needs_human_decision'
            })

            await waitForCondition(async () => {
              const snapshot = await handle.query(getLifecycleSnapshotQuery)
              return snapshot.openHumanGate?.statusCode === 'needs_human_decision'
            })

            const persistedSnapshot = await getLifecycleSnapshotView(db, issueId)
            assert.ok(persistedSnapshot)

            const latestReviewReportArtifact = await db
              .selectFrom('artifact_registry')
              .select(['metadata'])
              .where('issue_id', '=', issueId)
              .where('artifact_type', '=', 'review_report')
              .where('superseded_at', 'is', null)
              .orderBy('produced_at', 'desc')
              .executeTakeFirstOrThrow()

            const latestReviewExecutionMetadataArtifact = await db
              .selectFrom('artifact_registry')
              .select(['metadata'])
              .where('issue_id', '=', issueId)
              .where('artifact_type', '=', 'agent_execution_metadata')
              .where('produced_by_role', '=', 'review_agent')
              .where('superseded_at', 'is', null)
              .orderBy('produced_at', 'desc')
              .executeTakeFirstOrThrow()

            assert.equal(
              (
                latestReviewReportArtifact.metadata as {
                  contextPackFingerprint?: string | null
                }
              ).contextPackFingerprint ?? null,
              contextPackFingerprint,
            )
            assert.equal(
              (
                latestReviewExecutionMetadataArtifact.metadata as {
                  contextPackFingerprint?: string | null
                }
              ).contextPackFingerprint ?? null,
              contextPackFingerprint,
            )

            assert.equal(
              persistedSnapshot.openHumanGate?.statusCode,
              'needs_human_decision',
            )
            assert.equal(
              persistedSnapshot.openHumanGate?.reviewDisposition,
              'rework_recommended',
            )
            assert.equal(
              persistedSnapshot.openHumanGate?.reviewedBuildArtifactId,
              buildArtifactId,
            )
            assert.equal(
              persistedSnapshot.openHumanGate?.contextPackFingerprint,
              contextPackFingerprint,
            )

            const needsHumanArtifacts = await db
              .selectFrom('artifact_registry')
              .select(['artifact_type'])
              .where('issue_id', '=', issueId)
              .where('artifact_type', 'in', ['decision_summary', 'review_report'])
              .where('produced_for_status_code', '=', 'needs_human_decision')
              .where('superseded_at', 'is', null)
              .execute()

            assert.deepEqual(
              needsHumanArtifacts.map((artifact) => artifact.artifact_type).sort(),
              ['decision_summary', 'review_report'],
            )

            const firstOutboxRun = await runOutboxExecutorOnce(db, workflowConfig)
            assert.equal(firstOutboxRun >= 1, true)

            await waitForCondition(async () =>
              linearStub.requests.some((request) => {
                const payload = request.payload as { query?: string } | null
                return typeof payload?.query === 'string' &&
                  payload.query.includes('commentCreate(')
              }),
            )

            const commentRequest = linearStub.requests.find((request) => {
              const payload = request.payload as { query?: string } | null
              return typeof payload?.query === 'string' &&
                payload.query.includes('commentCreate(')
            })
            const commentPayload = commentRequest?.payload as {
              variables?: { issueId?: string; body?: string }
            }

            assert.equal(commentRequest?.headers.authorization, 'linear-phase7-token')
            assert.equal(commentPayload.variables?.issueId, issueId)
            assert.match(commentPayload.variables?.body ?? '', /rework_recommended/)
            assert.match(
              commentPayload.variables?.body ?? '',
              new RegExp(buildArtifactId),
            )

            const secondOutboxRun = await runOutboxExecutorOnce(db, workflowConfig)
            assert.equal(secondOutboxRun, 0)
            assert.equal(
              linearStub.requests.filter((request) => {
                const payload = request.payload as { query?: string } | null
                return typeof payload?.query === 'string' &&
                  payload.query.includes('commentCreate(')
              }).length,
              1,
            )
          } finally {
            await shutdownTemporalTestWorker(worker).catch(() => undefined)
            await env.teardown()
            await db.destroy()
          }
        },
      )
    } finally {
      await linearStub.close()
    }
  },
)
