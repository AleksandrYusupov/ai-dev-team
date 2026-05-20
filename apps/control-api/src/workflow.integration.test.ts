import assert from 'node:assert/strict'
import test from 'node:test'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'

import {
  getActiveWorkflowConfigSummary,
  getBlockedIssueProjectionView,
  getIssueLinearSyncProjectionView,
  getIssueRuntimeStateView,
  getStatusProjectionView,
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
} from '@ai-dev-team/db'

import { createApp } from './app.js'
import { createKnowledgeReadRepository } from './knowledge.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const controlApiBearerToken = 'test-internal-api-bearer-token'
const primaryRepoSlug = 'workflow-repo-primary'
const secondaryRepoSlug = 'workflow-repo-secondary'
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
    throw new Error('not used in workflow integration test')
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

test('control-api workflow integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'workflow inspection routes return active config, runtime state, and projections',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'control-api-test',
      })

      await db
        .insertInto('issue_runtime_state')
        .values({
          issue_id: 'ISSUE-API-1',
          current_status_code: 'blocked',
          current_stage: 'blocked',
          workflow_id: 'workflow-api-1',
          active_run_id: null,
          pinned_config_version: 1,
          open_operator_question_id: null,
          pause_reason_code: null,
          pause_reason_text: null,
          resume_condition: null,
          suspended_from_status_code: 'ready_for_build',
          block_reason_code: 'block_external_dependency',
          block_reason_text: 'Waiting for upstream issue',
          blocked_by_issue_ids: toJsonInsert(['ISSUE-UPSTREAM-1']),
          active_lease_id: null,
        })
        .execute()

      await db
        .insertInto('status_projection')
        .values({
          issue_id: 'ISSUE-API-1',
          current_status_code: 'blocked',
          current_owner_role: 'orchestrator',
          is_blocked: true,
          is_waiting_for_input: false,
          needs_human: false,
          active_lease_id: null,
          active_run_id: null,
          last_transition_at: new Date(),
          last_transition_trigger: 'system_block_detected',
          stuck_for_seconds: 120,
          high_risk: true,
        })
        .execute()

      await db
        .insertInto('blocked_issues_projection')
      .values({
        issue_id: 'ISSUE-API-1',
        blocked_by_issue_ids: toJsonInsert(['ISSUE-UPSTREAM-1']),
        blocked_by_external: false,
        block_reason_code: 'block_external_dependency',
        since: new Date(),
      })
      .execute()

      await db
        .insertInto('repository_registry')
        .values([
          {
            repo_slug: primaryRepoSlug,
            github_owner: 'acme',
            github_repo: primaryRepoSlug,
            default_branch: 'main',
            visibility: 'private',
            linear_team_id: 'team-1',
            obsidian_root_note:
              'ai_dev_team/architecture/05_full_system_implementation_plan.md',
            agent_guidance_scope: '.',
            local_checkout_path: null,
            required_checks: toJsonInsert(['typecheck', 'test']),
            environments: toJsonInsert(['test']),
            repo_kind: 'service',
            service_dependencies: toJsonInsert([]),
          },
          {
            repo_slug: secondaryRepoSlug,
            github_owner: 'acme',
            github_repo: secondaryRepoSlug,
            default_branch: 'main',
            visibility: 'private',
            linear_team_id: 'team-1',
            obsidian_root_note:
              'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
            agent_guidance_scope: '.',
            local_checkout_path: null,
            required_checks: toJsonInsert(['typecheck']),
            environments: toJsonInsert(['test']),
            repo_kind: 'library',
            service_dependencies: toJsonInsert([]),
          },
        ])
        .execute()

      await db
        .insertInto('issue_linear_sync_projection')
        .values([
          {
            issue_id: 'ISSUE-API-1',
            repo_slug: primaryRepoSlug,
            branch_ref: 'refs/heads/feature/phase8',
            pr_number: 42,
            pr_url: 'https://github.com/acme/workflow-repo-primary/pull/42',
            pr_state: 'open',
            latest_check_conclusion: 'success',
            latest_check_url: 'https://github.com/acme/workflow-repo-primary/actions/runs/1',
            latest_deployment_env: 'preview',
            latest_deployment_state: 'success',
            latest_deployment_url: 'https://preview.example.test',
            last_synced_payload_hash: 'payload-hash-1',
            last_sync_outcome: 'succeeded',
            last_sync_error: null,
            last_sync_at: new Date(),
          },
          {
            issue_id: 'ISSUE-API-1',
            repo_slug: secondaryRepoSlug,
            branch_ref: null,
            pr_number: null,
            pr_url: null,
            pr_state: null,
            latest_check_conclusion: null,
            latest_check_url: null,
            latest_deployment_env: null,
            latest_deployment_state: null,
            latest_deployment_url: null,
            last_synced_payload_hash: 'payload-hash-1',
            last_sync_outcome: 'pending',
            last_sync_error: null,
            last_sync_at: new Date(),
          },
        ])
        .execute()

      await db
        .insertInto('project_repository_mappings')
        .values([
          {
            linear_project_id: 'project-fixture-1',
            repo_slug: primaryRepoSlug,
            mapping_role: 'primary',
            priority_order: 1,
          },
          {
            linear_project_id: 'project-fixture-1',
            repo_slug: secondaryRepoSlug,
            mapping_role: 'affected',
            priority_order: 2,
          },
        ])
        .execute()

      await db
        .insertInto('raw_event_inbox')
        .values({
          provider: 'linear',
          provider_event_type: 'Issue',
          provider_action: 'create',
          delivery_id: 'issue-context-1',
          signature_status: 'verified',
          provider_timestamp: new Date(),
          replay_window_valid: true,
          request_headers: toJsonInsert({}),
          raw_body: '{}',
          parsed_payload: toJsonInsert({}),
          issue_id: 'ISSUE-API-1',
          comment_id: null,
          project_id: 'project-fixture-1',
          repository_full_name: null,
          dedupe_scope: 'provider_delivery_id',
        })
        .execute()

      await db
        .insertInto('linear_issue_contract_snapshots')
        .values({
          issue_id: 'ISSUE-API-1',
          snapshot_hash: 'snapshot-hash-1',
          primary_repo: primaryRepoSlug,
          affected_repos: toJsonInsert([secondaryRepoSlug]),
          docs_links: toJsonInsert([
            'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
          ]),
          risk: 'medium',
          dependencies: toJsonInsert({
            blocks: [],
            blockedBy: ['ISSUE-UPSTREAM-1'],
            external: [],
          }),
          contract_json: toJsonInsert({
            project: 'project-fixture-1',
            primaryRepo: primaryRepoSlug,
            affectedRepos: [secondaryRepoSlug],
            goal: 'Ship Phase 4',
            background: 'integration fixture',
            scope: ['Return context pack'],
            nonGoals: ['Change the architecture'],
            acceptanceCriteria: ['Context pack route returns a bundle'],
            verificationPath: {
              automated: ['corepack pnpm test:integration'],
              manual: [],
            },
            docsLinks: [
              'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
            ],
            dependencies: {
              blocks: [],
              blockedBy: ['ISSUE-UPSTREAM-1'],
              external: [],
            },
            risk: 'medium',
            doneWhen: ['Routes return context'],
            openQuestions: [],
            humanDecisionRequired: false,
            issueType: 'feature',
            source: 'founder',
            mode: 'autonomous',
          }),
        })
        .execute()

      await db
        .insertInto('knowledge_note_snapshots')
        .values([
          {
            note_path:
              'ai_dev_team/architecture/05_full_system_implementation_plan.md',
            note_title: 'Phase 4 plan',
            root_tag: '#ai_dev_team',
            content_hash: 'note-hash-1',
            resolved_links: toJsonInsert([
              'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
            ]),
            sanitized_markdown: 'Primary root note content',
            summary_markdown: 'Primary root note summary',
            source_updated_at: new Date(),
            snapshot_status: 'fresh',
            last_error: null,
          },
          {
            note_path:
              'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
            note_title: 'Repository registry spec',
            root_tag: '#ai_dev_team',
            content_hash: 'note-hash-2',
            resolved_links: toJsonInsert([]),
            sanitized_markdown: 'Spec content',
            summary_markdown: 'Spec summary',
            source_updated_at: new Date(),
            snapshot_status: 'fresh',
            last_error: null,
          },
        ])
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
          getActiveWorkflowConfig: () => getActiveWorkflowConfigSummary(db),
          getIssueRuntimeState: (issueId) => getIssueRuntimeStateView(db, issueId),
          getStatusProjection: (issueId) => getStatusProjectionView(db, issueId),
          getIssueLinearSyncProjection: (issueId) =>
            getIssueLinearSyncProjectionView(db, issueId),
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
          persistRawEventDelivery: async () => ({
            id: 'evt-test',
            wasDuplicate: false,
            deliveryAttemptCount: 1,
            processingStatus: 'received',
          }),
        },
      })

      try {
        const [
          configResponse,
          runtimeResponse,
          statusResponse,
          linearSyncResponse,
          blockedResponse,
          repositoryResponse,
          mappingResponse,
          contextPackResponse,
        ] =
          await Promise.all([
            injectInternal(app, {
              method: 'GET',
              url: '/internal/workflow-config/active',
            }),
            injectInternal(app, {
              method: 'GET',
              url: '/internal/issues/ISSUE-API-1/runtime-state',
            }),
            injectInternal(app, {
              method: 'GET',
              url: '/internal/issues/ISSUE-API-1/status-projection',
            }),
            injectInternal(app, {
              method: 'GET',
              url: '/internal/issues/ISSUE-API-1/linear-sync-projection',
            }),
            injectInternal(app, {
              method: 'GET',
              url: '/internal/issues/ISSUE-API-1/blocked-projection',
            }),
            injectInternal(app, {
              method: 'GET',
              url: `/internal/repositories/${primaryRepoSlug}`,
            }),
            injectInternal(app, {
              method: 'GET',
              url: '/internal/projects/project-fixture-1/repository-mapping',
            }),
            injectInternal(app, {
              method: 'GET',
              url: '/internal/issues/ISSUE-API-1/context-pack',
            }),
          ])

        assert.equal(configResponse.statusCode, 200)
        assert.equal(runtimeResponse.statusCode, 200)
        assert.equal(statusResponse.statusCode, 200)
        assert.equal(linearSyncResponse.statusCode, 200)
        assert.equal(blockedResponse.statusCode, 200)
        assert.equal(repositoryResponse.statusCode, 200)
        assert.equal(mappingResponse.statusCode, 200)
        assert.equal(contextPackResponse.statusCode, 200)

        assert.equal(configResponse.json().configVersion, 1)
        assert.equal(runtimeResponse.json().currentStatusCode, 'blocked')
        assert.equal(statusResponse.json().currentStatusCode, 'blocked')
        assert.equal(linearSyncResponse.json().projectId, 'project-fixture-1')
        assert.equal(linearSyncResponse.json().repositories.length, 2)
        assert.equal(
          linearSyncResponse.json().repositories[0]?.repoSlug,
          primaryRepoSlug,
        )
        assert.equal(
          linearSyncResponse.json().repositories[0]?.prNumber,
          42,
        )
        assert.deepEqual(blockedResponse.json().blockedByIssueIds, [
          'ISSUE-UPSTREAM-1',
        ])
        assert.equal(repositoryResponse.json().repoSlug, primaryRepoSlug)
        assert.equal(mappingResponse.json().primaryRepo, primaryRepoSlug)
        assert.equal(contextPackResponse.json().issue.primaryRepo, primaryRepoSlug)
        assert.equal(contextPackResponse.json().docsPack.length, 2)
      } finally {
        await app.close()
      }
    } finally {
      await db.destroy()
    }
  },
)
