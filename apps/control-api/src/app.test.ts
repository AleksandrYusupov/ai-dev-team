import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'

import type { ControlApiConfig } from '@ai-dev-team/config'
import type {
  PersistRawEventDeliveryInput,
  PersistRawEventDeliveryResult,
  RunnerMcpPoolSnapshotView,
} from '@ai-dev-team/db'
import {
  buildSupportedGitHubFixtures,
  buildSupportedLinearFixtures,
  buildUnsupportedGitHubFixture,
  buildUnsupportedLinearFixture,
  type RunnerInventoryView,
  type RunnerLeaseDetailView,
  serializePhase3FixturePayload,
} from '@ai-dev-team/shared'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'

import { createApp } from './app.js'
import type { IntegrationReadRepository, IntegrationWriteRepository } from './integrations.js'
import type { KnowledgeReadRepository } from './knowledge.js'
import type {
  LifecycleCommandEnvelopeInput,
  LifecycleReadRepository,
} from './lifecycle.js'
import type { RunnerReadRepository } from './runners.js'

const controlApiBearerToken = 'test-internal-api-bearer-token'

const config: ControlApiConfig = {
  serviceName: 'control-api',
  environment: 'test',
  logLevel: 'info',
  version: 'test',
  host: '127.0.0.1',
  port: 4000,
  database: {
    url: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
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
    vendorDocsAllowlist: ['docs.vendor.test'],
    secretService: {
      backend: 'gcp_secret_manager',
      gcpProjectId: 'project-test',
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
      allowedSandboxDomains: ['sandbox.vendor.test'],
    },
  },
}

const workflowReadRepository = {
  getActiveWorkflowConfig: async () => null,
  getIssueRuntimeState: async () => null,
  getStatusProjection: async () => null,
  getIssueLinearSyncProjection: async () => null,
  getBlockedIssueProjection: async () => null,
}

const runnerReadRepository: RunnerReadRepository = {
  listRunnerInventory: async () => [],
  listActiveLeases: async () => [],
  listStaleLeases: async () => [],
  listMcpPoolSnapshots: async () => {
    const snapshot = {
      runnerNodeId: 'runner-1',
      hostGroupId: 'host-1',
      updatedAt: '2026-03-26T10:00:00.000Z',
      bindings: [
        {
          runnerNodeId: 'runner-1',
          hostGroupId: 'host-1',
          serverName: 'serena',
          sharingScope: 'repo',
          repoSlug: 'repo-primary',
          bindingKey: 'serena|repo|repo-primary|config-hash',
          acquiredCount: 1,
          sessionCounts: {
            'lease:attempt:1': 1,
          },
          processState: 'running',
          updatedAt: '2026-03-26T10:00:00.000Z',
        },
      ],
    } satisfies RunnerMcpPoolSnapshotView

    return [snapshot]
  },
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
    throw new Error('not used in app test')
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

function createLifecycleReadRepository(
  persistedLifecycleCommands: LifecycleCommandEnvelopeInput[],
): LifecycleReadRepository {
  return {
    persistLifecycleCommand: async (input) => {
      persistedLifecycleCommands.push(input)

      return {
        id: 'command-1',
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
      }
    },
    getLifecycleSnapshot: async (issueId) =>
      issueId === 'ISSUE-1'
        ? {
            schemaVersion: 1,
            issueId: 'ISSUE-1',
            workflowId: 'issue:ISSUE-1',
            lastProcessedCommandKey: 'command-1',
            recentCommandKeys: ['command-1'],
            openHumanGate: null,
            activeTimerIntents: [],
            versionMarker: 1,
            terminal: false,
            updatedAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
          }
        : null,
    getIssueJourney: async (issueId) =>
      issueId === 'ISSUE-1'
        ? {
            issueId: 'ISSUE-1',
            commands: [],
            transitions: [],
            runs: [],
            artifacts: [],
          }
        : null,
    getSystemHealth: async () => ({
      generatedAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
      openWorkflowCount: 1,
      openIssueCount: 1,
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
      updatedAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
    }),
  }
}

const internalAuthHeaders = {
  authorization: `Bearer ${controlApiBearerToken}`,
}

const knowledgeReadRepository: KnowledgeReadRepository = {
  getRepository: async (repoSlug: string) =>
    repoSlug === 'repo-primary'
      ? {
          repoSlug: 'repo-primary',
          githubOwner: 'acme',
          githubRepo: 'repo-primary',
          defaultBranch: 'main',
          visibility: 'private',
          linearTeamId: 'team-1',
          obsidianRootNote:
            'ai_dev_team/architecture/05_full_system_implementation_plan.md',
          agentGuidanceScope: '.',
          localCheckoutPath: null,
          requiredChecks: ['typecheck', 'test'],
          environments: ['test'],
          repoKind: 'service',
          serviceDependencies: [],
          isActive: true,
          createdAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
          updatedAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
        }
      : null,
  getProjectRepositoryMapping: async () => ({
    linearProjectId: 'project-test-1',
    primaryRepo: 'repo-primary',
    affectedRepos: ['repo-secondary'],
    mappings: [],
  }),
  getContextPack: async () => ({
    issue: {
      issueId: 'ISSUE-1',
      goal: 'Ship Phase 4',
      background: null,
      scope: ['Implement context pack'],
      nonGoals: [],
      acceptanceCriteria: ['Route returns a bundle'],
      verificationPath: {
        automated: ['corepack pnpm test'],
        manual: [],
      },
      doneWhen: ['Tests are green'],
      risk: 'medium',
      dependencies: {
        blocks: [],
        blockedBy: [],
        external: [],
      },
      primaryRepo: 'repo-primary',
      affectedRepos: ['repo-secondary'],
      docsLinks: ['ai_dev_team/architecture/06_repository_registry_and_context_pack_spec'],
      openQuestions: [],
      issueType: 'feature',
      source: 'founder',
      mode: 'autonomous',
      humanDecisionRequired: false,
    },
    repositories: [],
    decisionSummary: ['Goal: Ship Phase 4'],
    latestRelevantComments: [],
    docsPack: [],
    repoGuidance: [],
    budgets: {
      contextPolicyVersion: 1,
      estimatedTokens: 128,
      maxTokens: 16_000,
      commentCount: 0,
      noteCount: 0,
      truncatedSections: [],
    },
    sourceTrace: {
      issueContractSnapshotId: 'snapshot-1',
      issueContractSnapshotHash: 'hash-1',
      mappingIds: [],
      noteSnapshotRefs: [],
      repoGuidanceRefs: [],
      commentRefs: [],
      warnings: [],
    },
  }),
}

function createIntegrationReadRepository(
  recordedCallbacks?: {
    providerName: string
    state: string
    receivedAt: string
    codePresent: boolean
    error: string | null
    errorDescription: string | null
    grantedScopes: string[]
    metadata: Record<string, unknown>
  }[],
): IntegrationReadRepository {
  return {
    getIssueSummary: async (issueId) => ({
      issueId,
      credentialSlotCount: 2,
      unresolvedCredentialSlotCount: 1,
      oauthRegistrationCount: 1,
      oauthConsentStatuses: {
        callback_received: 1,
      },
      activeTokenHandleCount: 1,
      webhookRegistrationCount: 1,
      validationRunCount: 2,
      lastValidationAt: new Date('2026-03-26T10:05:00.000Z').toISOString(),
    }),
    getCredentialSlots: async (issueId) => [
      {
        schemaVersion: 1,
        id: 'slot-1',
        issueId,
        providerName: 'Stripe',
        credentialKey: 'client_secret',
        environment: 'sandbox',
        secretAlias: 'stripe.sandbox.client_secret',
        ownerActorType: 'human',
        ownerActorId: 'user-1',
        authScheme: 'oauth2_auth_code',
        status: 'uploaded',
        scopes: ['read_write'],
        metadata: {},
        validationCheckedAt: null,
        expiresAt: null,
        rotatedAt: null,
        lastError: null,
        createdAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
      },
    ],
    getOAuthRegistrations: async (issueId) => [
      {
        schemaVersion: 1,
        id: 'oauth-reg-1',
        issueId,
        providerName: 'Stripe',
        environment: 'sandbox',
        clientType: 'confidential',
        authScheme: 'oauth2_auth_code',
        clientIdAlias: 'stripe.sandbox.client_id',
        clientSecretAlias: 'stripe.sandbox.client_secret',
        redirectUris: ['https://control.example.test/oauth/callback/stripe'],
        scopes: ['read_write'],
        registrationState: 'configured',
        metadata: {},
        createdAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
      },
    ],
    getOAuthConsentSessions: async (issueId) => [
      {
        schemaVersion: 1,
        id: 'oauth-session-1',
        issueId,
        providerName: 'Stripe',
        registrationId: 'oauth-reg-1',
        state: 'state-1',
        pkceVerifierAlias: 'pkce-alias',
        codeChallengeMethod: 'S256',
        requestedScopes: ['read_write'],
        grantedScopes: ['read_write'],
        status: 'callback_received',
        consentUrl: 'https://vendor.test/consent',
        callbackReceivedAt: new Date('2026-03-26T10:03:00.000Z').toISOString(),
        completedAt: null,
        lastError: null,
        metadata: {},
        createdAt: new Date('2026-03-26T10:01:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-26T10:03:00.000Z').toISOString(),
      },
    ],
    getTokenHandles: async (issueId) => [
      {
        schemaVersion: 1,
        id: 'token-1',
        issueId,
        providerName: 'Stripe',
        consentSessionId: 'oauth-session-1',
        tokenKind: 'refresh_token',
        secretAlias: 'stripe.sandbox.refresh_token',
        status: 'active',
        scopes: ['read_write'],
        expiresAt: null,
        rotatedAt: null,
        lastCheckedAt: null,
        lastError: null,
        metadata: {},
        createdAt: new Date('2026-03-26T10:03:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-26T10:03:00.000Z').toISOString(),
      },
    ],
    getWebhookRegistrations: async (issueId) => [
      {
        schemaVersion: 1,
        id: 'webhook-1',
        issueId,
        providerName: 'Stripe',
        environment: 'sandbox',
        callbackUrl: 'https://control.example.test/webhooks/stripe',
        eventTypes: ['payment.succeeded'],
        signingSecretAlias: 'stripe.sandbox.webhook_secret',
        status: 'registered',
        lastValidatedAt: null,
        lastError: null,
        metadata: {},
        createdAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-26T10:00:00.000Z').toISOString(),
      },
    ],
    getValidationRuns: async (issueId) => [
      {
        schemaVersion: 1,
        id: 'validation-1',
        issueId,
        providerName: 'Stripe',
        validationType: 'sandbox_smoke',
        environment: 'sandbox',
        status: 'passed',
        summary: 'Smoke passed',
        artifactId: null,
        metadata: {},
        executedAt: new Date('2026-03-26T10:05:00.000Z').toISOString(),
      },
    ],
    recordOAuthCallback: async (input) => {
      recordedCallbacks?.push(input)

      return {
        schemaVersion: 1,
        id: 'oauth-session-1',
        issueId: 'ISSUE-1',
        providerName: input.providerName,
        registrationId: 'oauth-reg-1',
        state: input.state,
        pkceVerifierAlias: 'pkce-alias',
        codeChallengeMethod: 'S256',
        requestedScopes: ['read_write'],
        grantedScopes: input.grantedScopes,
        status: input.error ? 'failed' : 'callback_received',
        consentUrl: 'https://vendor.test/consent',
        callbackReceivedAt: input.receivedAt,
        completedAt: null,
        lastError: input.error,
        metadata: input.metadata,
        createdAt: new Date('2026-03-26T10:01:00.000Z').toISOString(),
        updatedAt: input.receivedAt,
      }
  },
}
}

function createStubIntegrationWriteRepository(): IntegrationWriteRepository {
  const stubRecord = (extra: Record<string, unknown>) => ({
    schemaVersion: 1 as const,
    id: 'stub-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
    ...extra,
  })

  return {
    createCredentialSlot: async (input) => stubRecord({
      issueId: input.issueId,
      providerName: input.providerName,
      credentialKey: input.credentialKey,
      environment: input.environment,
      secretAlias: input.secretAlias,
      ownerActorType: input.ownerActorType,
      ownerActorId: input.ownerActorId,
      authScheme: input.authScheme,
      status: 'required',
      scopes: input.scopes,
      validationCheckedAt: null,
      expiresAt: null,
      rotatedAt: null,
      lastError: null,
    }) as never,
    updateCredentialSlotStatus: async () => null,
    createOAuthRegistration: async (input) => stubRecord({
      issueId: input.issueId,
      providerName: input.providerName,
      environment: input.environment,
      clientType: input.clientType,
      authScheme: input.authScheme,
      clientIdAlias: input.clientIdAlias,
      clientSecretAlias: input.clientSecretAlias,
      redirectUris: input.redirectUris,
      scopes: input.scopes,
      registrationState: input.registrationState,
    }) as never,
    createConsentSession: async (input) => stubRecord({
      issueId: input.issueId,
      providerName: input.providerName,
      registrationId: input.registrationId,
      state: input.state,
      pkceVerifierAlias: input.pkceVerifierAlias,
      codeChallengeMethod: input.codeChallengeMethod,
      requestedScopes: input.requestedScopes,
      grantedScopes: [],
      status: 'pending',
      consentUrl: input.consentUrl,
      callbackReceivedAt: null,
      completedAt: null,
      lastError: null,
    }) as never,
    createWebhook: async (input) => stubRecord({
      issueId: input.issueId,
      providerName: input.providerName,
      environment: input.environment,
      callbackUrl: input.callbackUrl,
      eventTypes: input.eventTypes,
      signingSecretAlias: input.signingSecretAlias,
      status: 'required',
      lastValidatedAt: null,
      lastError: null,
    }) as never,
    createValidationRun: async (input) => ({
      schemaVersion: 1 as const,
      id: 'stub-validation-run-id',
      issueId: input.issueId,
      providerName: input.providerName,
      validationType: input.validationType,
      environment: input.environment,
      status: 'pending' as const,
      summary: input.summary,
      artifactId: null,
      metadata: {},
      executedAt: new Date().toISOString(),
    }),
  }
}

function signLinear(payload: string): string {
  return createHmac('sha256', config.ingress.linearWebhookSecret)
    .update(payload)
    .digest('hex')
}

function signGitHub(payload: string): string {
  return (
    'sha256=' +
    createHmac('sha256', config.ingress.githubWebhookSecret)
      .update(payload)
      .digest('hex')
  )
}

function buildApp(options?: {
  persistResult?: PersistRawEventDeliveryResult
  configOverride?: Partial<ControlApiConfig>
  webhookNow?: () => Date
  recordedOauthCallbacks?: Parameters<
    NonNullable<IntegrationReadRepository['recordOAuthCallback']>
  >[0][]
  runnerReadRepositoryOverride?: Partial<RunnerReadRepository>
}) {
  const persistedEvents: PersistRawEventDeliveryInput[] = []
  const persistedLifecycleCommands: LifecycleCommandEnvelopeInput[] = []
  const webhookIngressRepository = {
    persistRawEventDelivery: async (
      input: PersistRawEventDeliveryInput,
    ): Promise<PersistRawEventDeliveryResult> => {
      persistedEvents.push(input)

      return (
        options?.persistResult ?? {
          id: 'evt-1',
          wasDuplicate: false,
          deliveryAttemptCount: 1,
          processingStatus: 'received',
        }
      )
    },
  }

  const appConfig: ControlApiConfig = {
    ...config,
    ...options?.configOverride,
    database: {
      ...config.database,
      ...options?.configOverride?.database,
    },
    ingress: {
      ...config.ingress,
      ...options?.configOverride?.ingress,
    },
    runner: {
      ...config.runner,
      ...options?.configOverride?.runner,
    },
  }

  const app = createApp({
    config: appConfig,
    workflowReadRepository,
    knowledgeReadRepository,
    lifecycleReadRepository: createLifecycleReadRepository(
      persistedLifecycleCommands,
    ),
    runnerReadRepository: {
      ...runnerReadRepository,
      ...options?.runnerReadRepositoryOverride,
    },
    runnerWriteRepository,
    integrationReadRepository: createIntegrationReadRepository(
      options?.recordedOauthCallbacks,
    ),
    integrationWriteRepository: createStubIntegrationWriteRepository(),
    webhookIngressRepository,
    webhookNow: options?.webhookNow,
  })

  return { app, persistedEvents, persistedLifecycleCommands }
}

async function injectInternal(
  app: ReturnType<typeof buildApp>['app'],
  input: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject({
    ...input,
    headers: {
      ...input.headers,
      ...internalAuthHeaders,
    },
  })
}

test('GET /internal/healthz returns service metadata', async () => {
  const { app } = buildApp()

  const response = await app.inject({
    method: 'GET',
    url: '/internal/healthz',
  })

  assert.equal(response.statusCode, 200)

  const payload = response.json() as {
    service: string
    environment: string
  }

  assert.equal(payload.service, 'control-api')
  assert.equal(payload.environment, 'test')

  await app.close()
})

test('GET /internal/runners/mcp-pool returns latest persisted MCP bindings', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/runners/mcp-pool',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), [
    {
      runnerNodeId: 'runner-1',
      hostGroupId: 'host-1',
      updatedAt: '2026-03-26T10:00:00.000Z',
      bindings: [
        {
          runnerNodeId: 'runner-1',
          hostGroupId: 'host-1',
          serverName: 'serena',
          sharingScope: 'repo',
          repoSlug: 'repo-primary',
          bindingKey: 'serena|repo|repo-primary|config-hash',
          acquiredCount: 1,
          sessionCounts: {
            'lease:attempt:1': 1,
          },
          processState: 'running',
          updatedAt: '2026-03-26T10:00:00.000Z',
        },
      ],
    },
  ])

  await app.close()
})

test('GET /internal/runners/inventory returns persisted skills and derived pack refs', async () => {
  const inventory: RunnerInventoryView[] = [
    {
      runnerNodeId: 'runner-1',
      hostGroupId: 'host-1',
      displayName: 'Runner 1',
      hostName: 'runner-1.local',
      status: 'online',
      providers: ['codex'],
      currentActiveLeaseCount: 0,
      maxConcurrentLeases: 1,
      manifestVersion: 3,
      lastHeartbeatAt: '2026-03-28T10:00:00.000Z',
      heartbeatExpiresAt: '2026-03-28T10:05:00.000Z',
      sharedMcpProcessCount: 2,
      mcpServerCatalog: [],
      skillsAvailable: ['F01', 'S03'],
      activeAgentLibraryReleaseId: 'v1',
      activeAgentLibraryFingerprint: 'release-fingerprint-v1',
      skillSyncStatus: 'ready',
      skillSyncError: null,
      installedSkillBundles: [
        {
          releaseId: 'v1',
          fingerprint: 'release-fingerprint-v1',
          skillIds: ['F01', 'S03'],
        },
      ],
      providerSupportedSkillPackRefs: {
        codex: ['orchestrator_control_plane_core'],
      },
      integrationCapabilities: {
        networkModesSupported: ['docs_allowlist'],
        allowedDocDomains: [],
        allowedSandboxDomains: [],
        supportsBrowserConsent: false,
        supportsSecretBroker: false,
        supportsOAuthBroker: false,
        supportsIntegrationLab: false,
      },
    },
  ]
  const { app } = buildApp({
    runnerReadRepositoryOverride: {
      listRunnerInventory: async () => inventory,
    },
  })

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/runners/inventory',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), inventory)

  await app.close()
})

test('GET /internal/runners/leases/:leaseId returns attempt-time skill snapshots', async () => {
  const detail: RunnerLeaseDetailView = {
    lease: {
      leaseId: 'lease-1',
      issueId: 'ISSUE-1',
      runId: null,
      workflowId: 'issue:ISSUE-1',
      requestedProvider: 'codex',
      requestedOwnerRole: 'orchestrator',
      requestedRunKind: 'build',
      roleExecutionPolicyVersion: 1,
      agentLibraryReleaseId: 'release-1',
      promptVersion: 'v1',
      taskInstructionsRef: 'bundle-1',
      roleCharterRef: 'charter-1',
      promptBundleFingerprint: 'bundle-fingerprint-1',
      skillPackRefs: ['orchestrator_control_plane_core'],
      effectiveSkillFingerprint: 'skill-fingerprint-1',
      contextPackFingerprint: null,
      promptResolutionSource: 'published_bundle',
      status: 'acquired',
      assignedRunnerNodeId: 'runner-1',
      requestedAt: '2026-03-28T10:00:00.000Z',
      acquiredAt: '2026-03-28T10:00:05.000Z',
      executionStartedAt: null,
      lastHeartbeatAt: '2026-03-28T10:00:05.000Z',
      heartbeatExpiresAt: '2026-03-28T10:05:05.000Z',
      failedAt: null,
      completedAt: null,
      releasedAt: null,
      releasedReasonCode: null,
      attemptCount: 1,
      lastError: null,
    },
    attempts: [
      {
        leaseAttemptId: 'attempt-1',
        leaseId: 'lease-1',
        providerAttemptNo: 1,
        requestedProvider: 'codex',
        effectiveProvider: 'codex',
        fallbackFromProvider: null,
        fallbackReason: null,
        executionSessionKey: 'lease-1:1',
        mcpProfileRef: 'default',
        mcpBindingsSummary: [],
        installedSkillRefs: ['F01', 'F02'],
        resolvedSkillRefs: ['F01'],
        skippedOptionalSkillRefs: ['S99'],
        runnerNodeId: 'runner-1',
        hostGroupId: 'host-1',
        status: 'acquired',
        acquiredAt: '2026-03-28T10:00:05.000Z',
        executionStartedAt: null,
        lastHeartbeatAt: '2026-03-28T10:00:05.000Z',
        failedAt: null,
        completedAt: null,
        releasedAt: null,
        errorClass: null,
        errorMessage: null,
        checkpointRef: null,
        cancelRequestedAt: null,
        cancelAcknowledgedAt: null,
        cancelOutcome: null,
      },
    ],
    timeline: [],
  }
  const { app } = buildApp({
    runnerReadRepositoryOverride: {
      getLeaseDetail: async (leaseId) => (leaseId === 'lease-1' ? detail : null),
    },
  })

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/runners/leases/lease-1',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), detail)

  await app.close()
})

test('GET /internal/issues/:issueId/integrations/summary returns integration state', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/issues/ISSUE-1/integrations/summary',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    issueId: 'ISSUE-1',
    credentialSlotCount: 2,
    unresolvedCredentialSlotCount: 1,
    oauthRegistrationCount: 1,
    oauthConsentStatuses: {
      callback_received: 1,
    },
    activeTokenHandleCount: 1,
    webhookRegistrationCount: 1,
    validationRunCount: 2,
    lastValidationAt: '2026-03-26T10:05:00.000Z',
  })
})

test('integration detail routes expose metadata-only auth plane resources', async () => {
  const { app } = buildApp()

  const cases = [
    {
      url: '/internal/issues/ISSUE-1/integrations/credential-slots',
      expectedId: 'slot-1',
    },
    {
      url: '/internal/issues/ISSUE-1/integrations/oauth-registrations',
      expectedId: 'oauth-reg-1',
    },
    {
      url: '/internal/issues/ISSUE-1/integrations/oauth-consents',
      expectedId: 'oauth-session-1',
    },
    {
      url: '/internal/issues/ISSUE-1/integrations/token-handles',
      expectedId: 'token-1',
    },
    {
      url: '/internal/issues/ISSUE-1/integrations/webhooks',
      expectedId: 'webhook-1',
    },
    {
      url: '/internal/issues/ISSUE-1/integrations/validation-runs',
      expectedId: 'validation-1',
    },
  ] as const

  for (const testCase of cases) {
    const response = await injectInternal(app, {
      method: 'GET',
      url: testCase.url,
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.json().issueId, 'ISSUE-1')
    assert.equal(response.json().items.length, 1)
    assert.equal(response.json().items[0].id, testCase.expectedId)
  }

  await app.close()
})

test('GET /oauth/callback/:providerName records sanitized callback state', async () => {
  const recordedOauthCallbacks: Parameters<
    NonNullable<IntegrationReadRepository['recordOAuthCallback']>
  >[0][] = []
  const { app } = buildApp({
    recordedOauthCallbacks,
  })

  const response = await app.inject({
    method: 'GET',
    url: '/oauth/callback/stripe?state=session-1&code=abc123&scope=read_write%20webhook',
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /Consent received/)
  assert.match(response.body, /stripe/)
  assert.match(response.body, /callback_received/)
  assert.equal(recordedOauthCallbacks.length, 1)
  assert.equal(recordedOauthCallbacks[0]?.codePresent, true)
  assert.ok(
    !JSON.stringify(recordedOauthCallbacks[0]).includes('abc123'),
    'raw authorization code must not be persisted through the callback contract',
  )
})

test('OAuth callback route honors the configured redirect path prefix', async () => {
  const { app } = buildApp({
    configOverride: {
      integration: {
        vendorDocsAllowlist: ['docs.vendor.test'],
        secretService: {
          backend: 'gcp_secret_manager',
          gcpProjectId: 'project-test',
          defaultSecretPrefix: 'ai-dev-team',
        },
        oauthService: {
          publicCallbackBaseUrl: 'http://127.0.0.1:4000/integrations/oauth',
          defaultRedirectPathPrefix: '/integrations/oauth',
          enforcePkce: true,
        },
        integrationLab: {
          enabled: true,
          maxProbeRequests: 5,
          allowedSandboxDomains: ['sandbox.vendor.test'],
        },
      },
    },
  })

  const response = await app.inject({
    method: 'GET',
    url: '/integrations/oauth/stripe?state=session-1&code=abc123&scope=read_write',
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /Consent received/)

  const legacyPath = await app.inject({
    method: 'GET',
    url: '/oauth/callback/stripe?state=session-1&code=abc123&scope=read_write',
  })

  assert.equal(legacyPath.statusCode, 404)
})

test('internal route families reject missing bearer token', async () => {
  const { app } = buildApp()

  for (const request of [
    {
      method: 'GET',
      url: '/internal/workflow-config/active',
    },
    {
      method: 'GET',
      url: '/internal/issues/ISSUE-1/runtime-state',
    },
    {
      method: 'GET',
      url: '/internal/issues/ISSUE-1/lifecycle-snapshot',
    },
    {
      method: 'GET',
      url: '/internal/issues/ISSUE-1/context-pack',
    },
    {
      method: 'GET',
      url: '/internal/repositories/repo-primary',
    },
    {
      method: 'POST',
      url: '/internal/issues/ISSUE-1/lifecycle-commands',
      payload: {
        commandKey: 'command-unauthorized',
        signalName: 'ingestSystemCommand',
        sourceRef: 'command-unauthorized',
      },
    },
  ] as const) {
    const response = await app.inject(request)

    assert.equal(response.statusCode, 401)
    assert.equal(response.json().error, 'unauthorized')
    assert.equal(response.headers['www-authenticate'], 'Bearer')
  }

  await app.close()
})

test('GET /internal/workflow-config/active returns 503 when no config is active', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/workflow-config/active',
  })

  assert.equal(response.statusCode, 503)

  await app.close()
})

test('POST /internal/issues/:issueId/lifecycle-commands rejects non-system commands', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'POST',
    url: '/internal/issues/ISSUE-1/lifecycle-commands',
    payload: {
      commandKey: 'command-1',
      workflowId: 'workflow-1',
      signalName: 'ingestCanonicalEvent',
      source: 'linear',
      sourceRef: 'comment-1',
      occurredAt: '2026-03-26T10:00:00.000Z',
      actorType: 'human',
      actorId: 'user-1',
    },
  })

  assert.equal(response.statusCode, 422)

  await app.close()
})

test('POST /internal/issues/:issueId/lifecycle-commands canonicalizes workflow id and source', async () => {
  const { app, persistedLifecycleCommands } = buildApp()

  const response = await injectInternal(app, {
    method: 'POST',
    url: '/internal/issues/ISSUE-1/lifecycle-commands',
    payload: {
      commandKey: 'command-2',
      signalName: 'ingestSystemCommand',
      sourceRef: 'command-2',
      occurredAt: '2026-03-26T10:00:00.000Z',
      actorType: 'system',
      actorId: 'control-api',
      triggerCode: 'system_block_cleared',
      requestedStatusCode: 'needs_input',
      artifacts: [
        {
          artifactType: 'unblock_record',
          artifactScope: 'issue',
          artifactUri: 'artifact://unblock-record/ISSUE-1',
        },
      ],
    },
  })

  assert.equal(response.statusCode, 201)
  assert.equal(response.json().workflowId, 'issue:ISSUE-1')
  assert.equal(response.json().source, 'operator_api')
  assert.equal(response.json().payload.artifacts[0].artifactType, 'unblock_record')
  assert.equal(persistedLifecycleCommands[0].source, 'operator_api')

  await app.close()
})

test('POST /internal/issues/:issueId/lifecycle-commands canonicalizes timer-fired source', async () => {
  const { app, persistedLifecycleCommands } = buildApp()

  const response = await injectInternal(app, {
    method: 'POST',
    url: '/internal/issues/ISSUE-1/lifecycle-commands',
    payload: {
      commandKey: 'command-2b',
      signalName: 'ingestTimerFired',
      sourceRef: 'command-2b',
      occurredAt: '2026-03-26T10:00:00.000Z',
      actorType: 'system',
      actorId: 'timer-service',
      triggerCode: 'system_block_cleared',
      requestedStatusCode: 'needs_input',
    },
  })

  assert.equal(response.statusCode, 201)
  assert.equal(response.json().source, 'system_timer')
  assert.equal(persistedLifecycleCommands[0].source, 'system_timer')

  await app.close()
})

test('POST /internal/issues/:issueId/lifecycle-commands accepts cancel-open-human-gate orchestration commands', async () => {
  const { app, persistedLifecycleCommands } = buildApp()

  const response = await injectInternal(app, {
    method: 'POST',
    url: '/internal/issues/ISSUE-1/lifecycle-commands',
    payload: {
      commandKey: 'command-2d',
      signalName: 'cancelOpenHumanGate',
      sourceRef: 'command-2d',
      occurredAt: '2026-03-26T10:00:00.000Z',
      actorType: 'human',
      actorId: 'operator-1',
    },
  })

  assert.equal(response.statusCode, 201)
  assert.equal(response.json().signalName, 'cancelOpenHumanGate')
  assert.equal(response.json().source, 'operator_api')
  assert.equal(persistedLifecycleCommands[0].source, 'operator_api')

  await app.close()
})

test('POST /internal/issues/:issueId/lifecycle-commands rejects reserved source spoofing', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'POST',
    url: '/internal/issues/ISSUE-1/lifecycle-commands',
    payload: {
      commandKey: 'command-2c',
      signalName: 'ingestSystemCommand',
      source: 'comment_response_workflow',
      sourceRef: 'command-2c',
      occurredAt: '2026-03-26T10:00:00.000Z',
      actorType: 'system',
      actorId: 'control-api',
      triggerCode: 'system_block_cleared',
      requestedStatusCode: 'needs_input',
    },
  })

  assert.equal(response.statusCode, 422)
  assert.equal(response.json().error, 'invalid_lifecycle_command')

  await app.close()
})

test('POST /internal/issues/:issueId/lifecycle-commands rejects invalid actor type', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'POST',
    url: '/internal/issues/ISSUE-1/lifecycle-commands',
    payload: {
      commandKey: 'command-3',
      signalName: 'ingestSystemCommand',
      source: 'operator_api',
      sourceRef: 'command-3',
      occurredAt: '2026-03-26T10:00:00.000Z',
      actorType: 'bot',
      actorId: 'control-api',
      triggerCode: 'human_status_change',
      requestedStatusCode: 'coding',
    },
  })

  assert.equal(response.statusCode, 422)

  await app.close()
})

test('POST /internal/issues/:issueId/lifecycle-commands rejects missing requested status', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'POST',
    url: '/internal/issues/ISSUE-1/lifecycle-commands',
    payload: {
      commandKey: 'command-4',
      signalName: 'ingestSystemCommand',
      source: 'operator_api',
      sourceRef: 'command-4',
      occurredAt: '2026-03-26T10:00:00.000Z',
      actorType: 'human',
      actorId: 'user-1',
      triggerCode: 'human_decision_given',
    },
  })

  assert.equal(response.statusCode, 422)

  await app.close()
})

test('POST /internal/issues/:issueId/lifecycle-commands rejects invalid occurredAt timestamps', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'POST',
    url: '/internal/issues/ISSUE-1/lifecycle-commands',
    payload: {
      commandKey: 'command-5',
      signalName: 'ingestSystemCommand',
      source: 'operator_api',
      sourceRef: 'command-5',
      occurredAt: '2026-03-26',
      actorType: 'human',
      actorId: 'user-1',
      triggerCode: 'human_status_change',
      requestedStatusCode: 'coding',
    },
  })

  assert.equal(response.statusCode, 422)

  await app.close()
})

test('GET /internal/issues/:issueId/lifecycle-snapshot returns workflow snapshot data', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/issues/ISSUE-1/lifecycle-snapshot',
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().workflowId, 'issue:ISSUE-1')

  await app.close()
})

test('GET /internal/metrics/system-health returns internal health summary', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/metrics/system-health',
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().openWorkflowCount, 1)

  await app.close()
})

test('GET /internal/repositories/:repoSlug returns 404 when repository is unknown', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/repositories/repo-missing',
  })

  assert.equal(response.statusCode, 404)
  assert.equal(response.json().error, 'repository_registry_not_found')

  await app.close()
})

test('GET /internal/repositories/:repoSlug returns repository metadata', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/repositories/repo-primary',
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().githubRepo, 'repo-primary')

  await app.close()
})

test('GET /internal/projects/:projectId/repository-mapping returns resolved mapping', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/projects/project-test-1/repository-mapping',
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().primaryRepo, 'repo-primary')
  assert.deepEqual(response.json().affectedRepos, ['repo-secondary'])

  await app.close()
})

test('GET /internal/issues/:issueId/context-pack returns knowledge bundle', async () => {
  const { app } = buildApp()

  const response = await injectInternal(app, {
    method: 'GET',
    url: '/internal/issues/ISSUE-1/context-pack',
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().issue.goal, 'Ship Phase 4')

  await app.close()
})

test('createApp internal routes do not depend on Temporal client startup', async () => {
  const { app } = buildApp()

  const workflowConfigResponse = await injectInternal(app, {
    method: 'GET',
    url: '/internal/workflow-config/active',
  })

  assert.equal(workflowConfigResponse.statusCode, 503)

  const lifecycleSnapshotResponse = await injectInternal(app, {
    method: 'GET',
    url: '/internal/issues/ISSUE-1/lifecycle-snapshot',
  })

  assert.equal(lifecycleSnapshotResponse.statusCode, 200)
  assert.equal(lifecycleSnapshotResponse.json().workflowId, 'issue:ISSUE-1')

  await app.close()
})

test('createApp internal routes do not depend on Temporal client startup', async () => {
  const { app } = buildApp()

  const workflowConfigResponse = await injectInternal(app, {
    method: 'GET',
    url: '/internal/workflow-config/active',
  })

  assert.equal(workflowConfigResponse.statusCode, 503)

  const lifecycleSnapshotResponse = await injectInternal(app, {
    method: 'GET',
    url: '/internal/issues/ISSUE-1/lifecycle-snapshot',
  })

  assert.equal(lifecycleSnapshotResponse.statusCode, 200)
  assert.equal(lifecycleSnapshotResponse.json().workflowId, 'issue:ISSUE-1')

  await app.close()
})

test('POST /webhooks/linear persists raw body and verified signature state', async () => {
  const { app, persistedEvents } = buildApp()
  const fixture = buildSupportedLinearFixtures(Date.now()).find(
    (entry) => entry.providerEventType === 'Comment',
  )
  assert.ok(fixture)
  const payload = serializePhase3FixturePayload(fixture)

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/linear',
    headers: {
      'content-type': 'application/json',
      'linear-delivery': fixture.deliveryId,
      'linear-event': fixture.providerEventType,
      'linear-signature': signLinear(payload),
    },
    payload,
  })

  assert.equal(response.statusCode, 202)
  assert.equal(persistedEvents.length, 1)
  assert.equal(persistedEvents[0].provider, 'linear')
  assert.equal(persistedEvents[0].signatureStatus, 'verified')
  assert.equal(persistedEvents[0].rawBody, payload)
  assert.equal(persistedEvents[0].issueId, fixture.refs.issueId)
  assert.equal(persistedEvents[0].commentId, fixture.refs.commentId)
  assert.equal(persistedEvents[0].replayWindowValid, true)

  await app.close()
})

test('POST /webhooks/linear returns 400 for malformed JSON payloads', async () => {
  const { app, persistedEvents } = buildApp()

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/linear',
    headers: {
      'content-type': 'application/json',
      'linear-delivery': 'linear-delivery-malformed',
      'linear-event': 'Issue',
      'linear-signature': signLinear('{"broken":true'),
    },
    payload: '{"broken":true',
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error, 'invalid_webhook_payload')
  assert.equal(persistedEvents.length, 0)

  await app.close()
})

test('POST /webhooks/linear returns 400 for unsupported events', async () => {
  const { app, persistedEvents } = buildApp()
  const payloadObject = buildUnsupportedLinearFixture(Date.now())
  const payload = JSON.stringify(payloadObject)

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/linear',
    headers: {
      'content-type': 'application/json',
      'linear-delivery': 'linear-delivery-unsupported',
      'linear-event': 'Cycle',
      'linear-signature': signLinear(payload),
    },
    payload,
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error, 'unsupported_webhook_event')
  assert.equal(persistedEvents.length, 0)

  await app.close()
})

test('POST /webhooks/linear keeps invalid signatures and stale deliveries audit-safe and accepted', async () => {
  const now = new Date('2026-03-25T12:00:00.000Z')
  const { app, persistedEvents } = buildApp({
    persistResult: {
      id: 'evt-2',
      wasDuplicate: true,
      deliveryAttemptCount: 2,
      processingStatus: 'received',
    },
    webhookNow: () => now,
  })
  const fixture = buildSupportedLinearFixtures(
    now.getTime() - 120_000,
  ).find((entry) => entry.providerEventType === 'Issue')
  assert.ok(fixture)
  const payload = serializePhase3FixturePayload(fixture)

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/linear',
    headers: {
      'content-type': 'application/json',
      'linear-delivery': fixture.deliveryId,
      'linear-event': fixture.providerEventType,
      'linear-signature': 'deadbeef',
    },
    payload,
  })

  assert.equal(response.statusCode, 202)
  assert.equal(persistedEvents.length, 1)
  assert.equal(persistedEvents[0].signatureStatus, 'failed')
  assert.equal(
    persistedEvents[0].providerTimestamp?.toISOString(),
    new Date(fixture.payload.webhookTimestamp as number).toISOString(),
  )
  assert.equal(persistedEvents[0].replayWindowValid, false)

  await app.close()
})

test('POST /webhooks/github persists delivery metadata and repository linkage', async () => {
  const { app, persistedEvents } = buildApp()
  const fixture = buildSupportedGitHubFixtures().find(
    (entry) => entry.providerEventType === 'pull_request',
  )
  assert.ok(fixture)
  const payload = serializePhase3FixturePayload(fixture)

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': fixture.deliveryId,
      'x-github-event': fixture.providerEventType,
      'x-hub-signature-256': signGitHub(payload),
    },
    payload,
  })

  assert.equal(response.statusCode, 202)
  assert.equal(persistedEvents.length, 1)
  assert.equal(persistedEvents[0].provider, 'github')
  assert.equal(persistedEvents[0].providerEventType, 'pull_request')
  assert.equal(persistedEvents[0].signatureStatus, 'verified')
  assert.equal(persistedEvents[0].providerTimestamp, null)
  assert.equal(
    persistedEvents[0].repositoryFullName,
    fixture.refs.repositoryFullName,
  )
  assert.equal(persistedEvents[0].replayWindowValid, null)

  await app.close()
})

test('POST /webhooks/github returns 400 when required headers are missing', async () => {
  const { app, persistedEvents } = buildApp()

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      repository: {
        full_name: 'acme/example',
      },
    }),
  })

  assert.equal(response.statusCode, 400)
  assert.equal(persistedEvents.length, 0)

  await app.close()
})

test('POST /webhooks/linear returns 400 when required headers are missing', async () => {
  const { app, persistedEvents } = buildApp()

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/linear',
    headers: {
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      action: 'create',
      type: 'Issue',
      data: {
        id: 'ISSUE-MISSING-HEADERS',
      },
    }),
  })

  assert.equal(response.statusCode, 400)
  assert.equal(persistedEvents.length, 0)

  await app.close()
})

test('POST /webhooks/github returns 400 for unsupported events', async () => {
  const { app, persistedEvents } = buildApp()
  const payloadObject = buildUnsupportedGitHubFixture()
  const payload = JSON.stringify(payloadObject)

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': 'github-delivery-unsupported',
      'x-github-event': 'check_suite',
      'x-hub-signature-256': signGitHub(payload),
    },
    payload,
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error, 'unsupported_webhook_event')
  assert.equal(persistedEvents.length, 0)

  await app.close()
})

test('POST /webhooks/linear returns 413 for oversized payloads', async () => {
  const { app, persistedEvents } = buildApp({
    configOverride: {
      ingress: {
        ...config.ingress,
        maxPayloadBytes: 64,
      },
    },
  })

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/linear',
    headers: {
      'content-type': 'application/json',
      'linear-delivery': 'linear-delivery-too-large',
      'linear-event': 'Issue',
      'linear-signature': signLinear(
        JSON.stringify({ oversized: 'x'.repeat(128) }),
      ),
    },
    payload: JSON.stringify({ oversized: 'x'.repeat(128) }),
  })

  assert.equal(response.statusCode, 413)
  assert.equal(response.json().error, 'payload_too_large')
  assert.equal(persistedEvents.length, 0)

  await app.close()
})
