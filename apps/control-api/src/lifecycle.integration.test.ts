import assert from 'node:assert/strict'
import test from 'node:test'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'

import {
  getBlockedIssueProjectionView,
  loadWorkflowManifestBundle,
  getIssueRuntimeStateView,
  getStatusProjectionView,
  prepareTestDatabase,
  publishWorkflowConfig,
} from '@ai-dev-team/db'

import { createApp } from './app.js'
import { createKnowledgeReadRepository } from './knowledge.js'
import { createLifecycleReadRepository } from './lifecycle.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const controlApiBearerToken = 'test-internal-api-bearer-token'
const operatorQuestionArtifactId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const closedRunId = '33333333-3333-4333-8333-333333333333'
const firstTransitionId = '44444444-4444-4444-8444-444444444444'
const secondTransitionId = '55555555-5555-4555-8555-555555555555'
const thirdTransitionId = '66666666-6666-4666-8666-666666666666'
const contextArtifactId = '77777777-7777-4777-8777-777777777777'
const runnerReadRepository = {
  listRunnerInventory: async () => [],
  listActiveLeases: async () => [],
  listStaleLeases: async () => [],
  listMcpPoolSnapshots: async () => [],
  getLeaseDetail: async () => null,
  getProviderFailoverMetrics: async () => ({
    totalLeases: 0,
    fallbackTriggeredCount: 0,
    providerFallbackExhaustedCount: 0,
    providerLimitExhaustionEvents: 0,
    fallbackReasonCounts: {},
    mcpPoolReuseRatio: null,
    sharedMcpProcessCount: 0,
  }),
}

const runnerWriteRepository = {
  upsertManifest: async () => ({ schemaVersion: 1 as const, accepted: true }),
  claimNextTask: async () => ({ schemaVersion: 1 as const, task: null }),
  markExecutionStarted: async () => {},
  heartbeat: async () => ({ schemaVersion: 1 as const, cancelRequested: false }),
  stageArtifact: async () => ({
    schemaVersion: 1 as const,
    artifactId: 'blob-1',
    artifactUri: 'artifact://blob/blob-1',
    contentSha256: 'sha256',
    sizeBytes: 0,
  }),
  completeAttempt: async () => {},
  getContextPackResource: async () => null,
  getArtifactResource: async () => null,
  getExecutionBundle: async () => {
    throw new Error('not used in lifecycle integration test')
  },
  getActiveSkillReleaseSummary: async () => ({
    schemaVersion: 1 as const,
    releaseId: null,
    releaseFingerprint: null,
    publishedAt: null,
    skills: [],
  }),
  getSkillReleasePayload: async () => null,
  failAttempt: async () => {},
  acknowledgeCancellation: async () => ({
    schemaVersion: 1 as const,
    leaseStatus: 'released' as const,
    cancelOutcome: 'accepted' as const,
  }),
  requestLeaseCancellation: async () => ({
    leaseStatus: 'cancellation_requested' as const,
    leaseAttemptId: null,
  }),
}

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

async function injectInternal(
  app: ReturnType<typeof createApp>,
  input: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject({
    ...input,
    headers: {
      ...input.headers,
      authorization: `Bearer ${controlApiBearerToken}`,
    },
  })
}

test('control-api lifecycle integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'lifecycle command route persists durable commands and lifecycle read routes reflect DB truth',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'control-api-test',
      })

      await db
        .insertInto('artifact_registry')
        .values({
          id: operatorQuestionArtifactId,
          issue_id: 'ISSUE-API-9',
          run_id: null,
          transition_audit_id: null,
          artifact_type: 'operator_question',
          artifact_scope: 'operator_question',
          artifact_uri: 's3://artifacts/operator-question-9.json',
          artifact_summary: 'Operator question snapshot',
          produced_by_role: 'orchestrator',
          produced_for_status_code: 'needs_input',
          superseded_at: null,
          metadata: toJsonInsert({
            reasonCode: 'need_more_info',
            reasonText: 'Need confirmation',
          }),
        })
        .execute()

      await db
        .insertInto('issue_runtime_state')
        .values({
          issue_id: 'ISSUE-API-9',
          current_status_code: 'needs_input',
          current_stage: 'waiting',
          workflow_id: 'issue:ISSUE-API-9',
          active_run_id: null,
          pinned_config_version: 1,
          open_operator_question_id: operatorQuestionArtifactId,
          pause_reason_code: null,
          pause_reason_text: null,
          resume_condition: null,
          suspended_from_status_code: null,
          block_reason_code: null,
          block_reason_text: null,
          blocked_by_issue_ids: toJsonInsert([]),
          active_lease_id: null,
        })
        .execute()

      await db
        .insertInto('status_projection')
        .values({
          issue_id: 'ISSUE-API-9',
          current_status_code: 'needs_input',
          current_owner_role: 'orchestrator',
          is_blocked: false,
          is_waiting_for_input: true,
          needs_human: true,
          active_lease_id: null,
          active_run_id: null,
          last_transition_at: new Date('2026-03-26T09:30:00.000Z'),
          last_transition_trigger: 'comment_received',
          stuck_for_seconds: 3600,
          high_risk: true,
        })
        .execute()

      await db
        .insertInto('status_transition_audit')
        .values([
          {
            id: firstTransitionId,
            issue_id: 'ISSUE-API-9',
            run_id: null,
            workflow_id: 'issue:ISSUE-API-9',
            config_version: 1,
            from_status_code: 'coding',
            to_status_code: 'needs_input',
            trigger_code: 'comment_received',
            rule_id: 'rule-1',
            actor_type: 'human',
            actor_id: 'user-9',
            owner_role: 'orchestrator',
            reason_code: 'need_more_info',
            reason_text: 'Need confirmation',
            comment_id: 'comment-9',
            artifact_links: toJsonInsert([]),
            checkpoint_id: null,
            lease_id: null,
            metadata: toJsonInsert({}),
            created_at: new Date('2026-03-26T09:30:00.000Z'),
          },
          {
            id: secondTransitionId,
            issue_id: 'ISSUE-API-9',
            run_id: null,
            workflow_id: 'issue:ISSUE-API-9',
            config_version: 1,
            from_status_code: 'needs_input',
            to_status_code: 'coding',
            trigger_code: 'human_status_change',
            rule_id: 'rule-2',
            actor_type: 'human',
            actor_id: 'user-9',
            owner_role: 'developer',
            reason_code: 'clarified',
            reason_text: 'Provided answer',
            comment_id: 'comment-10',
            artifact_links: toJsonInsert([]),
            checkpoint_id: null,
            lease_id: null,
            metadata: toJsonInsert({}),
            created_at: new Date('2026-03-26T10:00:00.000Z'),
          },
          {
            id: thirdTransitionId,
            issue_id: 'ISSUE-API-9',
            run_id: null,
            workflow_id: 'issue:ISSUE-API-9',
            config_version: 1,
            from_status_code: 'needs_input',
            to_status_code: 'needs_input',
            trigger_code: 'human_status_change',
            rule_id: 'rule-3',
            actor_type: 'human',
            actor_id: 'user-9',
            owner_role: 'orchestrator',
            reason_code: 'need_more_info',
            reason_text: 'Need confirmation',
            comment_id: 'comment-11',
            artifact_links: toJsonInsert([]),
            checkpoint_id: null,
            lease_id: null,
            metadata: toJsonInsert({}),
            created_at: new Date('2026-03-26T10:30:00.000Z'),
          },
        ])
        .execute()

      await db
        .insertInto('lifecycle_command_inbox')
        .values({
          command_key: 'command-processed-9',
          issue_id: 'ISSUE-API-9',
          workflow_id: 'issue:ISSUE-API-9',
          signal_name: 'ingestSystemCommand',
          source: 'operator_api',
          source_ref: 'command-processed-9',
          payload: toJsonInsert({
            schemaVersion: 1,
            commandKey: 'command-processed-9',
            issueId: 'ISSUE-API-9',
            workflowId: 'issue:ISSUE-API-9',
            signalName: 'ingestSystemCommand',
            source: 'operator_api',
            sourceRef: 'command-processed-9',
            occurredAt: '2026-03-26T10:30:00.000Z',
            actorType: 'human',
            actorId: 'user-9',
            triggerCode: 'human_status_change',
            requestedStatusCode: 'needs_input',
            commentId: 'comment-10',
            reasonCode: 'need_more_info',
            reasonText: 'Need confirmation',
            metadata: {},
          }),
          status: 'accepted',
          attempt_count: 1,
          scheduled_at: new Date('2026-03-26T10:30:00.000Z'),
          accepted_at: new Date('2026-03-26T10:30:01.000Z'),
          rejected_at: null,
          processed_at: new Date('2026-03-26T10:30:02.000Z'),
          last_error: null,
          transition_audit_id: thirdTransitionId,
          rejection_payload: null,
        })
        .execute()

      await db
        .insertInto('issue_runs')
        .values([
          {
            id: runId,
            issue_id: 'ISSUE-API-9',
            workflow_id: 'issue:ISSUE-API-9',
            sequence_no: 1,
            run_kind: 'build',
            status: 'open',
            config_version: 1,
            opened_by_transition_id: firstTransitionId,
            closed_by_transition_id: null,
            branch_ref: 'feature/issue-9',
            runner_requirements: toJsonInsert({}),
            checkpoint_id: null,
            opened_at: new Date('2026-03-26T09:00:00.000Z'),
            closed_at: null,
          },
          {
            id: closedRunId,
            issue_id: 'ISSUE-API-9',
            workflow_id: 'issue:ISSUE-API-9',
            sequence_no: 2,
            run_kind: 'build',
            status: 'completed',
            config_version: 1,
            opened_by_transition_id: secondTransitionId,
            closed_by_transition_id: secondTransitionId,
            branch_ref: null,
            runner_requirements: toJsonInsert({}),
            checkpoint_id: null,
            opened_at: new Date('2026-03-26T10:00:00.000Z'),
            closed_at: new Date('2026-03-26T11:00:00.000Z'),
          },
        ])
        .execute()

      await db
        .insertInto('artifact_registry')
        .values({
          id: contextArtifactId,
          issue_id: 'ISSUE-API-9',
          run_id: runId,
          transition_audit_id: firstTransitionId,
          artifact_type: 'context_pack',
          artifact_scope: 'issue',
          artifact_uri: 's3://artifacts/context-pack-9.json',
          artifact_summary: 'Context pack snapshot',
          produced_by_role: 'orchestrator',
          produced_for_status_code: 'needs_input',
          superseded_at: null,
          metadata: toJsonInsert({ kind: 'context_pack' }),
        })
        .execute()

      const app = createApp({
        config: {
          serviceName: 'control-api',
          environment: 'test',
          logLevel: 'info',
          version: 'test',
          host: '127.0.0.1',
          port: 4000,
          database: {
            url: process.env.DATABASE_URL as string,
            poolMax: 1,
          },
          internalApiBearerToken: controlApiBearerToken,
          runner: {
            authTokensByNodeId: {},
            longPollMaxWaitMs: 20_000,
          },
          ingress: {
            linearWebhookSecret: 'linear-secret',
            githubWebhookSecret: 'github-secret',
            replayWindowMs: 60_000,
            maxPayloadBytes: 1_048_576,
          },
          knowledge: {
            contextPackMaxTokens: 16_000,
            contextPackMaxComments: 10,
            contextPackMaxNotes: 12,
          },
          integration: {
            vendorDocsAllowlist: [],
            secretService: {
              backend: 'gcp_secret_manager',
              gcpProjectId: null,
              defaultSecretPrefix: 'ai-dev-team',
            },
            oauthService: {
              publicCallbackBaseUrl: 'http://127.0.0.1:4000/oauth/callback',
              defaultRedirectPathPrefix: '/oauth/callback',
              enforcePkce: true,
            },
            integrationLab: {
              enabled: true,
              maxProbeRequests: 5,
              allowedSandboxDomains: [],
            },
          },
        },
        workflowReadRepository: {
          getActiveWorkflowConfig: async () => null,
          getIssueRuntimeState: (issueId) => getIssueRuntimeStateView(db, issueId),
          getStatusProjection: (issueId) => getStatusProjectionView(db, issueId),
          getIssueLinearSyncProjection: async () => null,
          getBlockedIssueProjection: (issueId) =>
            getBlockedIssueProjectionView(db, issueId),
        },
        runnerReadRepository,
        runnerWriteRepository,
        knowledgeReadRepository: createKnowledgeReadRepository({
          db,
          config: {
            serviceName: 'control-api',
            environment: 'test',
            logLevel: 'info',
            version: 'test',
            host: '127.0.0.1',
            port: 4000,
            database: {
              url: process.env.DATABASE_URL as string,
              poolMax: 1,
            },
            internalApiBearerToken: controlApiBearerToken,
            runner: {
              authTokensByNodeId: {},
              longPollMaxWaitMs: 20_000,
            },
            ingress: {
              linearWebhookSecret: 'linear-secret',
              githubWebhookSecret: 'github-secret',
              replayWindowMs: 60_000,
              maxPayloadBytes: 1_048_576,
            },
            knowledge: {
              contextPackMaxTokens: 16_000,
              contextPackMaxComments: 10,
              contextPackMaxNotes: 12,
            },
            integration: {
              vendorDocsAllowlist: [],
              secretService: {
                backend: 'gcp_secret_manager',
                gcpProjectId: null,
                defaultSecretPrefix: 'ai-dev-team',
              },
              oauthService: {
                publicCallbackBaseUrl: 'http://127.0.0.1:4000/oauth/callback',
                defaultRedirectPathPrefix: '/oauth/callback',
                enforcePkce: true,
              },
              integrationLab: {
                enabled: true,
                maxProbeRequests: 5,
                allowedSandboxDomains: [],
              },
            },
          },
        }),
        integrationReadRepository: {
          getIssueSummary: async (issueId) => ({
            issueId,
            credentialSlotCount: 0,
            unresolvedCredentialSlotCount: 0,
            oauthRegistrationCount: 0,
            oauthConsentStatuses: {},
            activeTokenHandleCount: 0,
            webhookRegistrationCount: 0,
            validationRunCount: 0,
            lastValidationAt: null,
          }),
          getCredentialSlots: async () => [],
          getOAuthRegistrations: async () => [],
          getOAuthConsentSessions: async () => [],
          getTokenHandles: async () => [],
          getWebhookRegistrations: async () => [],
          getValidationRuns: async () => [],
          recordOAuthCallback: async () => null,
        },
        integrationWriteRepository: {
          createCredentialSlot: async () => ({}) as never,
          updateCredentialSlotStatus: async () => null,
          createOAuthRegistration: async () => ({}) as never,
          createConsentSession: async () => ({}) as never,
          createWebhook: async () => ({}) as never,
          createValidationRun: async () => ({}) as never,
        },
        lifecycleReadRepository: createLifecycleReadRepository({ db }),
        webhookIngressRepository: {
          persistRawEventDelivery: async () => {
            throw new Error('not used')
          },
        },
      })

      try {
        const commandPayload = {
          commandKey: 'command-9',
          workflowId: 'issue:ISSUE-API-9',
          signalName: 'ingestSystemCommand',
          source: 'operator_api',
          sourceRef: 'command-9',
          occurredAt: '2026-03-26T12:00:00.000Z',
          actorType: 'human',
          actorId: 'user-9',
          triggerCode: 'human_status_change',
          requestedStatusCode: 'coding',
          commentId: 'comment-11',
          reasonCode: 'clarified',
          reasonText: 'Human confirmed next step',
          metadata: {
            origin: 'operator',
          },
        }

        const firstCommand = await app.inject({
          method: 'POST',
          url: '/internal/issues/ISSUE-API-9/lifecycle-commands',
          headers: {
            authorization: `Bearer ${controlApiBearerToken}`,
          },
          payload: commandPayload,
        })

        const duplicateCommand = await app.inject({
          method: 'POST',
          url: '/internal/issues/ISSUE-API-9/lifecycle-commands',
          headers: {
            authorization: `Bearer ${controlApiBearerToken}`,
          },
          payload: commandPayload,
        })

        assert.equal(firstCommand.statusCode, 201)
        assert.equal(duplicateCommand.statusCode, 200)

        const inboxRows = await db
          .selectFrom('lifecycle_command_inbox')
          .selectAll()
          .where('command_key', '=', 'command-9')
          .execute()

        assert.equal(inboxRows.length, 1)

        const snapshotResponse = await injectInternal(app, {
          method: 'GET',
          url: '/internal/issues/ISSUE-API-9/lifecycle-snapshot',
        })

        const journeyResponse = await injectInternal(app, {
          method: 'GET',
          url: '/internal/issues/ISSUE-API-9/journey',
        })

        const systemHealthResponse = await injectInternal(app, {
          method: 'GET',
          url: '/internal/metrics/system-health',
        })

        const stuckIssuesResponse = await injectInternal(app, {
          method: 'GET',
          url: '/internal/metrics/stuck-issues',
        })

        const dailyMetricsResponse = await injectInternal(app, {
          method: 'GET',
          url: '/internal/metrics/daily?date=2026-03-26',
        })

        assert.equal(snapshotResponse.statusCode, 200)
        assert.equal(snapshotResponse.json().workflowId, 'issue:ISSUE-API-9')
        assert.equal(snapshotResponse.json().lastProcessedCommandKey, 'command-processed-9')
        assert.deepEqual(snapshotResponse.json().recentCommandKeys, ['command-processed-9'])
        assert.equal(
          snapshotResponse.json().openHumanGate.questionArtifactId,
          operatorQuestionArtifactId,
        )

        assert.equal(journeyResponse.statusCode, 200)
        assert.equal(journeyResponse.json().commands.length, 2)

        assert.equal(systemHealthResponse.statusCode, 200)
        assert.equal(systemHealthResponse.json().openWorkflowCount, 1)

        assert.equal(stuckIssuesResponse.statusCode, 200)
        assert.equal(stuckIssuesResponse.json().length, 1)

        assert.equal(dailyMetricsResponse.statusCode, 200)
        assert.equal(dailyMetricsResponse.json().transitionCount, 3)
      } finally {
        await app.close()
      }
    } finally {
      await db.destroy()
    }
  },
)
