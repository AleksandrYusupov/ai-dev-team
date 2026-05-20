import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'

import {
  buildSupportedGitHubFixtures,
  buildSupportedLinearFixtures,
  serializePhase3FixturePayload,
} from '@ai-dev-team/shared'
import {
  getActiveWorkflowConfigSummary,
  getBlockedIssueProjectionView,
  getIssueRuntimeStateView,
  getStatusProjectionView,
  persistRawEventDelivery,
  prepareTestDatabase,
} from '@ai-dev-team/db'

import { createApp } from './app.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const controlApiBearerToken = 'test-internal-api-bearer-token'
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
    throw new Error('not used in webhook integration test')
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

function signLinear(payload: string): string {
  return createHmac('sha256', 'linear-secret').update(payload).digest('hex')
}

function signGitHub(payload: string): string {
  return 'sha256=' + createHmac('sha256', 'github-secret').update(payload).digest('hex')
}

test('control-api webhook integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'webhook routes persist raw inbox rows and dedupe provider deliveries',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()

    try {
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
          getActiveWorkflowConfig: () => getActiveWorkflowConfigSummary(db),
          getIssueRuntimeState: (issueId) => getIssueRuntimeStateView(db, issueId),
          getStatusProjection: (issueId) => getStatusProjectionView(db, issueId),
          getIssueLinearSyncProjection: async () => null,
          getBlockedIssueProjection: (issueId) =>
            getBlockedIssueProjectionView(db, issueId),
        },
        runnerReadRepository,
        runnerWriteRepository,
        knowledgeReadRepository: {
          getRepository: async () => null,
          getProjectRepositoryMapping: async () => ({
            linearProjectId: 'project-test-1',
            primaryRepo: 'repo-primary',
            affectedRepos: [],
            mappings: [],
          }),
          getContextPack: async () => {
            throw new Error('not used in webhook integration test')
          },
        },
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
        lifecycleReadRepository: {
          persistLifecycleCommand: async (input) => ({
            id: 'evt-test',
            commandKey: input.commandKey,
            issueId: input.issueId,
            workflowId: input.workflowId,
            signalName: input.signalName,
            source: input.source,
            sourceRef: input.sourceRef,
            payload: input,
            status: 'pending',
            attemptCount: 1,
            scheduledAt: input.occurredAt,
            acceptedAt: null,
            rejectedAt: null,
            processedAt: null,
            lastError: null,
            transitionAuditId: null,
            rejectionPayload: null,
            createdAt: input.occurredAt,
            wasDuplicate: false,
          }),
          getLifecycleSnapshot: async () => null,
          getIssueJourney: async () => null,
          getSystemHealth: async () => ({
            generatedAt: new Date().toISOString(),
            openWorkflowCount: 0,
            openIssueCount: 0,
            rawInboxLagCount: 0,
            rawInboxOldestAgeSeconds: null,
            lifecycleCommandLagCount: 0,
            lifecycleCommandOldestAgeSeconds: null,
            outboxLagCount: 0,
            outboxOldestAgeSeconds: null,
            stuckIssueCount: 0,
          }),
          getStuckIssues: async () => [],
          getDailyMetrics: async (date) => ({
            metricDate: date,
            transitionCount: 0,
            lifecycleCommandAcceptedCount: 0,
            lifecycleCommandRejectedCount: 0,
            duplicateSuppressionCount: 0,
            runOpenCounts: {},
            runCloseCounts: {},
            dwellP50Seconds: {},
            dwellP90Seconds: {},
            updatedAt: new Date().toISOString(),
          }),
        },
        webhookIngressRepository: {
          persistRawEventDelivery: (input) => persistRawEventDelivery(db, input),
        },
        webhookNow: () => new Date('2026-03-25T12:00:00.000Z'),
      })

      try {
        const now = new Date('2026-03-25T12:00:00.000Z')
        const linearFixture = buildSupportedLinearFixtures(now.getTime()).find(
          (entry) => entry.providerEventType === 'Issue',
        )
        const staleLinearFixture = buildSupportedLinearFixtures(
          now.getTime() - 120_000,
        ).find((entry) => entry.providerEventType === 'Comment')
        const githubFixture = buildSupportedGitHubFixtures().find(
          (entry) => entry.providerEventType === 'workflow_run',
        )

        assert.ok(linearFixture)
        assert.ok(staleLinearFixture)
        assert.ok(githubFixture)
        const invalidGithubFixture = buildSupportedGitHubFixtures().find(
          (entry) => entry.providerEventType === 'check_run',
        )
        assert.ok(invalidGithubFixture)

        const linearPayload = serializePhase3FixturePayload(linearFixture)

        const firstLinear = await app.inject({
          method: 'POST',
          url: '/webhooks/linear',
          headers: {
            'content-type': 'application/json',
            'linear-delivery': linearFixture.deliveryId,
            'linear-event': linearFixture.providerEventType,
            'linear-signature': signLinear(linearPayload),
          },
          payload: linearPayload,
        })

        const duplicateLinear = await app.inject({
          method: 'POST',
          url: '/webhooks/linear',
          headers: {
            'content-type': 'application/json',
            'linear-delivery': linearFixture.deliveryId,
            'linear-event': linearFixture.providerEventType,
            'linear-signature': signLinear(linearPayload),
          },
          payload: linearPayload,
        })

        const staleLinearPayload = serializePhase3FixturePayload(staleLinearFixture)

        const staleLinear = await app.inject({
          method: 'POST',
          url: '/webhooks/linear',
          headers: {
            'content-type': 'application/json',
            'linear-delivery': staleLinearFixture.deliveryId,
            'linear-event': staleLinearFixture.providerEventType,
            'linear-signature': signLinear(staleLinearPayload),
          },
          payload: staleLinearPayload,
        })

        const githubPayload = serializePhase3FixturePayload(githubFixture)

        const githubResponse = await app.inject({
          method: 'POST',
          url: '/webhooks/github',
          headers: {
            'content-type': 'application/json',
            'x-github-delivery': githubFixture.deliveryId,
            'x-github-event': githubFixture.providerEventType,
            'x-hub-signature-256': signGitHub(githubPayload),
          },
          payload: githubPayload,
        })

        const invalidGitHub = await app.inject({
          method: 'POST',
          url: '/webhooks/github',
          headers: {
            'content-type': 'application/json',
            'x-github-delivery': 'github-delivery-2',
            'x-github-event': invalidGithubFixture.providerEventType,
            'x-hub-signature-256': 'sha256=deadbeef',
          },
          payload: serializePhase3FixturePayload(invalidGithubFixture),
        })

        assert.equal(firstLinear.statusCode, 202)
        assert.equal(duplicateLinear.statusCode, 202)
        assert.equal(staleLinear.statusCode, 202)
        assert.equal(githubResponse.statusCode, 202)
        assert.equal(invalidGitHub.statusCode, 202)

        const inboxRows = await db
          .selectFrom('raw_event_inbox')
          .select([
            'provider',
            'provider_event_type',
            'delivery_id',
            'signature_status',
            'replay_window_valid',
            'raw_body',
            'issue_id',
            'repository_full_name',
            'delivery_attempt_count',
          ])
          .orderBy('provider', 'asc')
          .orderBy('delivery_id', 'asc')
          .execute()
        const expectedDeliveryIds = new Set([
          linearFixture.deliveryId,
          staleLinearFixture.deliveryId,
          githubFixture.deliveryId,
          'github-delivery-2',
        ])
        const relevantRows = inboxRows.filter((row) =>
          expectedDeliveryIds.has(row.delivery_id),
        )

        assert.equal(relevantRows.length, 4)

        const linearRow = relevantRows.find(
          (row) => row.delivery_id === linearFixture.deliveryId,
        )
        const staleLinearRow = relevantRows.find(
          (row) => row.delivery_id === staleLinearFixture.deliveryId,
        )
        const githubRow = relevantRows.find(
          (row) => row.delivery_id === githubFixture.deliveryId,
        )
        const invalidGithubRow = relevantRows.find(
          (row) => row.delivery_id === 'github-delivery-2',
        )

        assert.ok(linearRow)
        assert.equal(linearRow.provider_event_type, 'Issue')
        assert.equal(linearRow.raw_body, linearPayload)
        assert.equal(linearRow.issue_id, linearFixture.refs.issueId)
        assert.equal(linearRow.delivery_attempt_count, 2)
        assert.equal(linearRow.replay_window_valid, true)

        assert.ok(staleLinearRow)
        assert.equal(staleLinearRow.provider_event_type, 'Comment')
        assert.equal(staleLinearRow.replay_window_valid, false)

        assert.ok(githubRow)
        assert.equal(githubRow.provider_event_type, 'workflow_run')
        assert.equal(githubRow.repository_full_name, 'acme/repo')
        assert.equal(githubRow.signature_status, 'verified')
        assert.equal(githubRow.replay_window_valid, null)

        assert.ok(invalidGithubRow)
        assert.equal(invalidGithubRow.signature_status, 'failed')
      } finally {
        await app.close()
      }
    } finally {
      await db.destroy()
    }
  },
)
