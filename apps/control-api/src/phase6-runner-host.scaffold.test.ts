import assert from 'node:assert/strict'
import test from 'node:test'

import type { ControlApiConfig } from '@ai-dev-team/config'
import type {
  ContextPack,
  ProjectRepositoryMappingView,
  RunnerExecutionBundleV1,
} from '@ai-dev-team/shared'
import { createApp } from './app.js'
import type { KnowledgeReadRepository } from './knowledge.js'
import type { LifecycleReadRepository } from './lifecycle.js'

function buildControlApiConfig(
  overrides: {
    port?: number
    runnerLongPollMaxWaitMs?: number
  } = {},
): ControlApiConfig {
  return {
    serviceName: 'control-api',
    environment: 'test',
    logLevel: 'info',
    version: 'test',
    host: '127.0.0.1',
    port: overrides.port ?? 4000,
    database: {
      url: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
      poolMax: 1,
    },
    internalApiBearerToken: 'internal-token',
    runner: {
      authTokensByNodeId: {
        'runner-phase6-1': 'runner-token-1',
      },
      longPollMaxWaitMs: overrides.runnerLongPollMaxWaitMs ?? 10,
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
  }
}

function buildApp(options: {
  port?: number
  runnerLongPollMaxWaitMs?: number
  overrideClaimNextTask?: (
    input: Parameters<NonNullable<Parameters<typeof createApp>[0]['runnerWriteRepository']['claimNextTask']>>[0],
  ) => ReturnType<NonNullable<Parameters<typeof createApp>[0]['runnerWriteRepository']['claimNextTask']>>
  overrideGetContextPackResource?: () => ReturnType<
    NonNullable<Parameters<typeof createApp>[0]['runnerWriteRepository']['getContextPackResource']>
  >
  overrideGetArtifactResource?: () => ReturnType<
    NonNullable<Parameters<typeof createApp>[0]['runnerWriteRepository']['getArtifactResource']>
  >
  overrideGetExecutionBundle?: (leaseAttemptId: string) => ReturnType<
    NonNullable<Parameters<typeof createApp>[0]['runnerWriteRepository']['getExecutionBundle']>
  >
  overrideGetActiveSkillReleaseSummary?: () => ReturnType<
    NonNullable<Parameters<typeof createApp>[0]['runnerWriteRepository']['getActiveSkillReleaseSummary']>
  >
  overrideGetSkillReleasePayload?: (releaseId: string) => ReturnType<
    NonNullable<Parameters<typeof createApp>[0]['runnerWriteRepository']['getSkillReleasePayload']>
  >
} = {}) {
  const recorded = {
    manifests: [] as string[],
    heartbeats: [] as string[],
    heartbeatSnapshots: [] as Array<Record<string, unknown> | null>,
    artifacts: [] as string[],
    completions: [] as string[],
    completionFallbacks: [] as Array<{
      fallbackFromProvider: string | null
      fallbackReason: string | null
    }>,
    failures: [] as string[],
    claimNextCalls: 0,
  }

  const knowledgeReadRepository: KnowledgeReadRepository = {
    getRepository: async () => null,
    getProjectRepositoryMapping: async () =>
      ({
        schemaVersion: 1,
        projectId: 'project-1',
        mappings: [],
      }) as unknown as ProjectRepositoryMappingView,
    getContextPack: async () => ({ schemaVersion: 1 }) as unknown as ContextPack,
  }

  const lifecycleReadRepository: LifecycleReadRepository = {
    persistLifecycleCommand: async () =>
      ({
        id: 'command-1',
        commandKey: 'command-1',
        issueId: 'ISSUE-1',
        workflowId: 'issue:ISSUE-1',
        signalName: 'ingestSystemCommand',
        source: 'test',
        sourceRef: 'command-1',
        payload: {} as Record<string, unknown>,
        status: 'completed',
        attemptCount: 1,
        scheduledAt: new Date().toISOString(),
        acceptedAt: null,
        rejectedAt: null,
        processedAt: null,
        lastError: null,
        transitionAuditId: null,
        rejectionPayload: null,
        createdAt: new Date().toISOString(),
        wasDuplicate: false,
      }) as unknown as Awaited<
        ReturnType<LifecycleReadRepository['persistLifecycleCommand']>
      >,
    getLifecycleSnapshot: async () => null,
    getIssueJourney: async () => null,
    getSystemHealth: async () =>
      ({
        database: 'ok',
        workflowConfig: 'ok',
        outbox: 'ok',
      }) as unknown as Awaited<
        ReturnType<LifecycleReadRepository['getSystemHealth']>
      >,
    getStuckIssues: async () => [],
    getDailyMetrics: async () =>
      ({
        date: '2026-03-26',
        totals: {
          transitions: 0,
          commandsAccepted: 0,
          commandsRejected: 0,
          outboxExecuted: 0,
        },
        byOwnerRole: [],
        byTriggerCode: [],
      }) as unknown as Awaited<
        ReturnType<LifecycleReadRepository['getDailyMetrics']>
      >,
  }

  const app = createApp({
    config: buildControlApiConfig({
      port: options.port,
      runnerLongPollMaxWaitMs: options.runnerLongPollMaxWaitMs,
    }),
    workflowReadRepository: {
      getActiveWorkflowConfig: async () => null,
      getIssueRuntimeState: async () => null,
      getStatusProjection: async () => null,
      getIssueLinearSyncProjection: async () => null,
      getBlockedIssueProjection: async () => null,
    },
    knowledgeReadRepository,
    lifecycleReadRepository,
    runnerReadRepository: {
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
    },
    runnerWriteRepository: {
      upsertManifest: async ({ request }) => {
        recorded.manifests.push(request.manifest.runnerNodeId)
        return {
          schemaVersion: 1,
          accepted: true,
        }
      },
      claimNextTask: async (input) => {
        recorded.claimNextCalls += 1
        if (options.overrideClaimNextTask) {
          return options.overrideClaimNextTask(input)
        }

        return {
          schemaVersion: 1,
          task: null,
        }
      },
      markExecutionStarted: async () => {},
      heartbeat: async (input) => {
        recorded.heartbeats.push(input.leaseAttemptId)
        recorded.heartbeatSnapshots.push(input.mcpPoolSnapshot ?? null)
        return {
          schemaVersion: 1,
          cancelRequested: true,
        }
      },
      stageArtifact: async (input) => {
        recorded.artifacts.push(input.artifactKey)
        return {
          schemaVersion: 1,
          artifactId: 'blob-1',
          artifactUri: 'artifact://blob/blob-1',
          contentSha256: 'sha256',
          sizeBytes: 11,
        }
      },
      completeAttempt: async (input) => {
        recorded.completions.push(input.artifactBundle.leaseAttemptId)
        recorded.completionFallbacks.push({
          fallbackFromProvider: input.artifactBundle.fallbackFromProvider,
          fallbackReason: input.artifactBundle.fallbackReason,
        })
      },
      getContextPackResource: async () =>
        options.overrideGetContextPackResource
          ? options.overrideGetContextPackResource()
          : null,
      getArtifactResource: async () =>
        options.overrideGetArtifactResource
          ? options.overrideGetArtifactResource()
          : null,
      getExecutionBundle: async (leaseAttemptId) =>
        options.overrideGetExecutionBundle
          ? options.overrideGetExecutionBundle(leaseAttemptId)
          : ({
              schemaVersion: 1,
              leaseAttemptId,
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
              resolvedSkillRefs: ['S46'],
              skippedOptionalSkillRefs: ['S47'],
              systemInstruction: {
                roleId: 'build_agent_backend',
                instructionVersion: 'v1',
                relativePath:
                  'system-instructions/build_agent_backend_system_instructions.md',
                resolutionSource: 'working_tree_fallback',
                body: '# System instruction\nKeep provider behavior subordinate to runtime rules.',
              },
              roleCharter: {
                roleCharterRef:
                  'agent-library://releases/v1/role-charters/build_agent_backend',
                roleId: 'build_agent_backend',
                charterVersion: 'v1',
                canonicalRunKind: 'build',
                frontmatterSummary: { owner_role: 'build_agent_backend' },
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
                  compatibleRoles: ['build_agent_backend'],
                  compatibleSkillPacks: ['build_backend_core'],
                  sourceRefs: [
                    'config/agents/prompt-families/global-baseline/v1.md',
                  ],
                  relativePath:
                    'config/agents/prompt-families/global-baseline/v1.md',
                  familyFingerprint: 'family-fingerprint-global',
                  body: '# Global baseline\nUse the repo as source of truth.',
                },
                {
                  promptFamilyRef: 'build',
                  familyId: 'build',
                  familyVersion: 'v1',
                  providerCompatibility: ['codex', 'claude'],
                  compatibleRoles: ['build_agent_backend'],
                  compatibleSkillPacks: ['build_backend_core'],
                  sourceRefs: ['config/agents/prompt-families/build/v1.md'],
                  relativePath: 'config/agents/prompt-families/build/v1.md',
                  familyFingerprint: 'family-fingerprint-build',
                  body: '# Build family\nKeep changes minimal.',
                },
              ],
              skillPacks: [
                {
                  packId: 'build_backend_core',
                  packVersion: 'v1',
                  purpose: 'Backend implementation',
                  skillRefs: ['S46'],
                  optionalSkillRefs: ['S47'],
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
                roleId: 'build_agent_backend',
                canonicalRunKind: 'build',
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
                ownerRole: 'build_agent_backend',
                primaryProvider: 'codex',
                secondaryProvider: 'claude',
                fallbackTriggers: [],
                maxProviderFailovers: 1,
                mcpProfileRef: 'default',
                requiredCapabilities: ['workspace_access'],
              },
            } satisfies RunnerExecutionBundleV1),
      getActiveSkillReleaseSummary: async () =>
        options.overrideGetActiveSkillReleaseSummary
          ? options.overrideGetActiveSkillReleaseSummary()
          : {
              schemaVersion: 1,
              releaseId: null,
              releaseFingerprint: null,
              publishedAt: null,
              skills: [],
            },
      getSkillReleasePayload: async (releaseId) =>
        options.overrideGetSkillReleasePayload
          ? options.overrideGetSkillReleasePayload(releaseId)
          : null,
      failAttempt: async (input) => {
        recorded.failures.push(input.leaseAttemptId)
      },
      acknowledgeCancellation: async () => ({
        schemaVersion: 1,
        leaseStatus: 'released',
        cancelOutcome: 'accepted',
      }),
      requestLeaseCancellation: async () => ({
        leaseStatus: 'cancellation_requested',
        leaseAttemptId: 'attempt-1',
      }),
    },
    integrationReadRepository: {
      getIssueSummary: async () => ({
        issueId: 'ISSUE-1',
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
    webhookIngressRepository: {
      persistRawEventDelivery: async () => ({
        id: 'evt-1',
        wasDuplicate: false,
        deliveryAttemptCount: 1,
        processingStatus: 'received',
      }),
    },
  })

  return { app, recorded }
}

test('phase 6 runner-host auth binds bearer token to authenticatedRunnerNodeId', async () => {
  const { app, recorded } = buildApp()

  const unauthorized = await app.inject({
    method: 'PUT',
    url: '/runner-host/manifests/current',
    payload: {
      schemaVersion: 1,
      manifest: {
        schemaVersion: 1,
        runnerNodeId: 'runner-phase6-1',
        hostGroupId: 'host-1',
        manifestVersion: 1,
        providers: ['codex'],
        providerCliVersions: { codex: '1.0.0' },
        supportedRoles: ['orchestrator'],
        supportedRunKinds: ['build'],
        supportedRepoKinds: ['application'],
        mcpServerCatalog: [
          {
            serverName: 'serena',
            sharingScope: 'workspace' as unknown as 'repo',
            reusePolicy: 'shared_by_scope',
            supportsConcurrentSessions: true,
            configHash: 'cfg-1',
          },
        ],
        toolBaseline: ['serena'],
        skillsAvailable: [],
        workspaceRoot: '/tmp/workspace',
        worktreeRoot: '/tmp/worktrees',
        maxConcurrentLeases: 1,
        supportsInterrupt: true,
        supportsCheckpointResume: true,
        supportsArtifactUpload: true,
        supportsConcurrentSessions: true,
        integration: {
          networkModesSupported: ['invalid_mode'],
          allowedDocDomains: [],
          allowedSandboxDomains: [],
          supportsBrowserConsent: false,
          supportsSecretBroker: false,
          supportsOAuthBroker: false,
          supportsIntegrationLab: false,
        },
        host: {
          hostName: 'runner-phase6-1.local',
          hostOs: 'darwin',
          hostArch: 123 as unknown as string,
        },
        publishedAt: '2026-03-26T10:00:00.000Z',
      },
    },
  })

  assert.equal(unauthorized.statusCode, 401)

  const forbidden = await app.inject({
    method: 'PUT',
    url: '/runner-host/manifests/current',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      manifest: {
        schemaVersion: 1,
        runnerNodeId: 'runner-phase6-2',
        hostGroupId: 'host-1',
        manifestVersion: 1,
        providers: ['codex'],
        providerCliVersions: { codex: '1.0.0' },
        supportedRoles: ['orchestrator'],
        supportedRunKinds: ['build'],
        supportedRepoKinds: ['application'],
        mcpServerCatalog: [],
        toolBaseline: ['serena'],
        skillsAvailable: [],
        workspaceRoot: '/tmp/workspace',
        worktreeRoot: '/tmp/worktrees',
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
          hostName: 'runner-phase6-2.local',
          hostOs: 'darwin',
          hostArch: 'arm64',
        },
        publishedAt: '2026-03-26T10:00:00.000Z',
      },
    },
  })

  assert.equal(forbidden.statusCode, 403)
  assert.deepEqual(recorded.manifests, [])

  await app.close()
})

test('phase 6 long-poll stops retrying after client disconnect', async () => {
  const { app, recorded } = buildApp({
    runnerLongPollMaxWaitMs: 250,
  })
  const startedAt = Date.now()

  app.addHook('preHandler', async (request) => {
    if (request.url === '/runner-host/leases:claim-next') {
      setTimeout(() => {
        request.raw.emit('close')
      }, 20)
    }
  })

  try {
    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      app.inject({
        method: 'POST',
        url: '/runner-host/leases:claim-next',
        headers: {
          authorization: 'Bearer runner-token-1',
        },
        payload: {
          schemaVersion: 1,
          runnerNodeId: 'runner-phase6-1',
          heartbeatExpiryAt: '2026-03-26T10:05:00.000Z',
        },
      }, (error, injectedResponse) => {
        if (error) {
          reject(error)
          return
        }

        if (!injectedResponse) {
          reject(new Error('inject did not return a response'))
          return
        }

        resolve(injectedResponse)
      })
    })

    assert.equal(response.statusCode, 200)
    assert.equal(recorded.claimNextCalls, 1)
    assert.ok(
      Date.now() - startedAt < 1_000,
      'long-poll request should exit promptly after disconnect',
    )
  } finally {
    await app.close()
  }
})

test('phase 6 heartbeat responses expose cancelRequested once cancellation is requested', async () => {
  const { app, recorded } = buildApp()

  const response = await app.inject({
    method: 'POST',
    url: '/runner-host/attempts/attempt-1/heartbeat',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      leaseAttemptId: 'attempt-1',
      heartbeatExpiryAt: '2026-03-26T10:05:00.000Z',
    },
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    schemaVersion: 1,
    cancelRequested: true,
  })
  assert.deepEqual(recorded.heartbeats, ['attempt-1'])

  await app.close()
})

test('phase 6 runner-host heartbeat forwards MCP pool snapshots to the write repository', async () => {
  const { app, recorded } = buildApp()

  const response = await app.inject({
    method: 'POST',
    url: '/runner-host/attempts/attempt-1/heartbeat',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      leaseAttemptId: 'attempt-1',
      heartbeatExpiryAt: '2026-03-26T10:05:00.000Z',
      mcpPoolSnapshot: {
        schemaVersion: 1,
        runnerNodeId: 'runner-phase6-1',
        configHash: 'mcp-config-hash',
        capturedAt: '2026-03-26T10:01:00.000Z',
        bindings: [
          {
            serverName: 'serena',
            sharingScope: 'repo',
            bindingKey: 'serena|repo|repo-primary|config-hash',
            repoSlug: 'repo-primary',
            acquiredCount: 1,
            sessionCounts: {
              'lease:attempt:1': 1,
            },
            processState: 'running',
            updatedAt: '2026-03-26T10:01:00.000Z',
          },
        ],
      },
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(recorded.heartbeatSnapshots.length, 1)
  assert.deepEqual(recorded.heartbeatSnapshots[0], {
    schemaVersion: 1,
    runnerNodeId: 'runner-phase6-1',
    configHash: 'mcp-config-hash',
    capturedAt: '2026-03-26T10:01:00.000Z',
    bindings: [
      {
        serverName: 'serena',
        sharingScope: 'repo',
        bindingKey: 'serena|repo|repo-primary|config-hash',
        repoSlug: 'repo-primary',
        acquiredCount: 1,
        sessionCounts: {
          'lease:attempt:1': 1,
        },
        processState: 'running',
        updatedAt: '2026-03-26T10:01:00.000Z',
      },
    ],
  })

  await app.close()
})

test('phase 7 runner-host serves frozen context-pack resources over the authenticated read surface', async () => {
  const { app } = buildApp({
    overrideGetContextPackResource: async () => ({
      schemaVersion: 1,
      contextPackId: 'context-pack-1',
      issueId: 'ISSUE-1',
      inputFingerprint: 'ctx-phase7-1',
      bundle: {
        issue: {
          issueId: 'ISSUE-1',
          goal: 'Close phase 7.',
          background: 'scaffold test',
          scope: ['serve context'],
          nonGoals: ['GitHub automation'],
          acceptanceCriteria: ['Route returns the frozen context'],
          verificationPath: {
            automated: ['corepack pnpm --filter @ai-dev-team/control-api test'],
            manual: [],
          },
          doneWhen: ['Assertions pass'],
          risk: 'medium',
          dependencies: {
            blocks: [],
            blockedBy: [],
            external: [],
          },
          primaryRepo: 'test_repo',
          affectedRepos: [],
          docsLinks: [],
          openQuestions: [],
          issueType: 'feature',
          source: 'founder',
          mode: 'autonomous',
          humanDecisionRequired: true,
        },
        repositories: [],
        decisionSummary: ['Phase 7 context route scaffold'],
        latestRelevantComments: [],
        docsPack: [],
        repoGuidance: [],
        budgets: {
          contextPolicyVersion: 1,
          estimatedTokens: 512,
          maxTokens: 16000,
          commentCount: 0,
          noteCount: 0,
          truncatedSections: [],
        },
        sourceTrace: {
          issueContractSnapshotId: 'snapshot-1',
          issueContractSnapshotHash: 'snapshot-hash-1',
          mappingIds: ['mapping-1'],
          noteSnapshotRefs: [],
          repoGuidanceRefs: [],
          commentRefs: [],
          warnings: [],
        },
      },
      createdAt: '2026-03-27T10:00:00.000Z',
    }),
  })

  const response = await app.inject({
    method: 'GET',
    url: '/runner-host/context-packs/context-pack-1',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().contextPackId, 'context-pack-1')
  assert.equal(response.json().inputFingerprint, 'ctx-phase7-1')
  assert.equal(response.json().bundle.issue.primaryRepo, 'test_repo')

  await app.close()
})

test('phase 7 runner-host serves reviewed build artifacts over the authenticated read surface', async () => {
  const { app } = buildApp({
    overrideGetArtifactResource: async () => ({
      schemaVersion: 1,
      artifactId: 'artifact-build-1',
      issueId: 'ISSUE-1',
      runId: 'run-1',
      artifactType: 'build_report',
      artifactUri: 'artifact://bundle/artifact-build-1',
      artifactSummary: 'Build artifact for review consumption.',
      metadata: {
        runKind: 'build',
        repoSlug: 'test_repo',
      },
      producedAt: '2026-03-27T10:01:00.000Z',
      supersededAt: null,
    }),
  })

  const response = await app.inject({
    method: 'GET',
    url: '/runner-host/artifacts/artifact-build-1',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().artifactId, 'artifact-build-1')
  assert.equal(response.json().artifactType, 'build_report')
  assert.equal(response.json().metadata.repoSlug, 'test_repo')

  await app.close()
})

test('block 9 runner-host serves execution bundles over the authenticated read surface', async () => {
  const { app } = buildApp()

  const response = await app.inject({
    method: 'GET',
    url: '/runner-host/attempts/attempt-1/execution-bundle',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().leaseAttemptId, 'attempt-1')
  assert.equal(
    response.json().resolvedPromptFamilyRefs[0],
    'global-baseline',
  )
  assert.equal(response.json().resolvedSkillRefs[0], 'S46')

  await app.close()
})

test('block 9 runner-host exposes stale-attempt execution bundle failures as 409 responses', async () => {
  const { app } = buildApp({
    overrideGetExecutionBundle: async () => {
      const error = new Error('stale attempt snapshot')
      ;(error as Error & { code?: string; statusCode?: number }).code =
        'execution_bundle_stale_attempt'
      ;(error as Error & { code?: string; statusCode?: number }).statusCode = 409
      throw error
    },
  })

  const response = await app.inject({
    method: 'GET',
    url: '/runner-host/attempts/attempt-stale/execution-bundle',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
  })

  assert.equal(response.statusCode, 409)
  assert.equal(response.json().error, 'execution_bundle_stale_attempt')

  await app.close()
})

test('block 8 runner-host serves the active managed skill release summary', async () => {
  const { app } = buildApp({
    overrideGetActiveSkillReleaseSummary: async () => ({
      schemaVersion: 1,
      releaseId: 'v1',
      releaseFingerprint: 'release-fingerprint-v1',
      publishedAt: '2026-03-28T12:00:00.000Z',
      skills: [
        {
          skillId: 'S46',
          fingerprint: 'skill-fingerprint-S46',
          providerCompatibility: ['codex'],
        },
      ],
    }),
  })

  const response = await app.inject({
    method: 'GET',
    url: '/runner-host/skill-sync/active-release',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().releaseId, 'v1')
  assert.equal(response.json().skills[0]?.skillId, 'S46')

  await app.close()
})

test('block 8 runner-host serves release-scoped managed skill payloads only when available', async () => {
  const { app } = buildApp({
    overrideGetSkillReleasePayload: async (releaseId) =>
      releaseId === 'v1'
        ? {
            schemaVersion: 1,
            releaseId: 'v1',
            releaseFingerprint: 'release-fingerprint-v1',
            publishedAt: '2026-03-28T12:00:00.000Z',
            skillCount: 1,
            skills: [
              {
                skillId: 'S46',
                fingerprint: 'skill-fingerprint-S46',
                relativePath: 'config/agents/releases/v1/skills/S46/SKILL.md',
                metaJson: '{"id":"S46"}\n',
                metaSha256: 'meta-digest',
                skillMarkdown: '# Skill\n',
                skillMarkdownSha256: 'markdown-digest',
                providerCompatibility: ['codex'],
              },
            ],
          }
        : null,
  })

  const found = await app.inject({
    method: 'GET',
    url: '/runner-host/skill-sync/releases/v1',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
  })
  const missing = await app.inject({
    method: 'GET',
    url: '/runner-host/skill-sync/releases/v2',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
  })

  assert.equal(found.statusCode, 200)
  assert.equal(found.json().releaseId, 'v1')
  assert.equal(found.json().skillCount, 1)
  assert.equal(missing.statusCode, 404)

  await app.close()
})

test('phase 6 runner-host artifact staging and completion routes use the write repository contract', async () => {
  const { app, recorded } = buildApp()

  const artifactResponse = await app.inject({
    method: 'POST',
    url: '/runner-host/attempts/attempt-1/artifacts',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      leaseAttemptId: 'attempt-1',
      artifactKey: 'summary-md',
      contentType: 'text/markdown',
      contentBase64: Buffer.from('# summary\n').toString('base64'),
      metadata: {},
    },
  })

  assert.equal(artifactResponse.statusCode, 200)
  assert.deepEqual(artifactResponse.json(), {
    schemaVersion: 1,
    artifactId: 'blob-1',
    artifactUri: 'artifact://blob/blob-1',
    contentSha256: 'sha256',
    sizeBytes: 11,
  })

  const completionResponse = await app.inject({
    method: 'POST',
    url: '/runner-host/attempts/attempt-1/completed',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      artifactBundle: {
        schemaVersion: 2,
        leaseId: 'lease-1',
        leaseAttemptId: 'attempt-1',
        issueId: 'ISSUE-1',
        runId: null,
        requestedProvider: 'codex',
        effectiveProvider: 'codex',
        providerAttemptNo: 1,
        fallbackFromProvider: null,
        fallbackReason: null,
        roleExecutionPolicyVersion: 1,
        agentRole: 'orchestrator',
        status: 'completed',
        summary: 'done',
        changedFiles: [],
        testResults: [],
        patchRef: null,
        branchRef: null,
        reviewFindings: [],
        executionSessionKey: 'lease-1:attempt:1',
        mcpProfileRef: 'default',
        mcpBindingsSummary: [],
        toolUsage: ['serena'],
        mcpBindings: [],
        providerExecutionMetadata: {},
        producedAt: '2026-03-26T10:10:00.000Z',
      },
      executionMetadata: {
        schemaVersion: 2,
        agentRole: 'orchestrator',
        promptVersion: 'phase6',
        agentLibraryReleaseId: 'v1',
        taskInstructionsRef: 'agent-library://releases/v1/prompt-bundles/orchestrator',
        roleCharterRef: 'agent-library://releases/v1/role-charters/orchestrator',
        promptBundleFingerprint: 'bundle-fingerprint-1',
        resolvedPromptFamilyRefs: ['global-baseline', 'planning'],
        skillPackRefs: ['orchestrator_core'],
        resolvedSkillRefs: ['F01'],
        skippedOptionalSkillRefs: ['S99'],
        effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
        contextPackFingerprint: null,
        configVersion: 1,
        workflowId: 'issue:ISSUE-1',
        workflowRunId: null,
        runKind: 'build',
        attemptNo: 1,
        requestedProvider: 'codex',
        effectiveProvider: 'codex',
        providerAttemptNo: 1,
        fallbackFromProvider: null,
        fallbackReason: null,
        toolsUsed: ['serena'],
        mcpBindings: [],
        runnerNodeId: 'runner-phase6-1',
        hostGroupId: 'host-1',
        executionDurationMs: 1000,
        completionReason: 'completed',
      },
    },
  })

  assert.equal(completionResponse.statusCode, 204)
  assert.deepEqual(recorded.artifacts, ['summary-md'])
  assert.deepEqual(recorded.completions, ['attempt-1'])
  assert.deepEqual(recorded.completionFallbacks, [
    {
      fallbackFromProvider: null,
      fallbackReason: null,
    },
  ])

  await app.close()
})

test('phase 6 runner-host completion accepts nullable runKind for review attempts', async () => {
  const { app, recorded } = buildApp()

  const completionResponse = await app.inject({
    method: 'POST',
    url: '/runner-host/attempts/attempt-review-1/completed',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      artifactBundle: {
        schemaVersion: 2,
        leaseId: 'lease-review-1',
        leaseAttemptId: 'attempt-review-1',
        issueId: 'ISSUE-1',
        runId: null,
        requestedProvider: 'claude',
        effectiveProvider: 'claude',
        providerAttemptNo: 1,
        fallbackFromProvider: null,
        fallbackReason: null,
        roleExecutionPolicyVersion: 1,
        agentRole: 'review_agent',
        status: 'completed',
        summary: 'review complete',
        changedFiles: [],
        testResults: [],
        patchRef: null,
        branchRef: null,
        reviewFindings: [],
        executionSessionKey: 'lease-review-1:attempt:1',
        mcpProfileRef: 'default',
        mcpBindingsSummary: [],
        toolUsage: ['serena'],
        mcpBindings: [],
        providerExecutionMetadata: {},
        producedAt: '2026-03-26T10:20:00.000Z',
      },
      executionMetadata: {
        schemaVersion: 2,
        agentRole: 'review_agent',
        promptVersion: 'phase6',
        agentLibraryReleaseId: 'v1',
        taskInstructionsRef: 'agent-library://releases/v1/prompt-bundles/review_agent',
        roleCharterRef: 'agent-library://releases/v1/role-charters/review_agent',
        promptBundleFingerprint: 'bundle-fingerprint-2',
        resolvedPromptFamilyRefs: ['global-baseline', 'review'],
        skillPackRefs: ['review_core'],
        resolvedSkillRefs: ['R01'],
        skippedOptionalSkillRefs: [],
        effectiveSkillFingerprint: 'effective-skill-fingerprint-2',
        contextPackFingerprint: null,
        configVersion: 1,
        workflowId: 'issue:ISSUE-1',
        workflowRunId: null,
        runKind: null,
        attemptNo: 1,
        requestedProvider: 'claude',
        effectiveProvider: 'claude',
        providerAttemptNo: 1,
        fallbackFromProvider: null,
        fallbackReason: null,
        toolsUsed: ['serena'],
        mcpBindings: [],
        runnerNodeId: 'runner-phase6-1',
        hostGroupId: 'host-1',
        executionDurationMs: 750,
        completionReason: 'completed',
      },
    },
  })

  assert.equal(completionResponse.statusCode, 204)
  assert.deepEqual(recorded.completions, ['attempt-review-1'])

  await app.close()
})

test('phase 6 runner-host routes reject malformed payloads before hitting the write repository', async () => {
  const { app, recorded } = buildApp()

  const invalidManifest = await app.inject({
    method: 'PUT',
    url: '/runner-host/manifests/current',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      manifest: {
        schemaVersion: 1,
        runnerNodeId: 'runner-phase6-1',
        hostGroupId: 'host-1',
        manifestVersion: 1,
        providers: ['codex'],
        providerCliVersions: { codex: '1.0.0' },
        supportedRoles: ['orchestrator'],
      supportedRunKinds: ['build'],
      supportedRepoKinds: ['application'],
      mcpServerCatalog: [
        {
          serverName: 'serena',
          sharingScope: 'not-a-scope' as unknown as 'repo',
          reusePolicy: 'shared_by_scope',
          supportsConcurrentSessions: true,
          configHash: 'config-hash',
        },
      ],
      toolBaseline: ['serena'],
      skillsAvailable: [],
      workspaceRoot: '/tmp/workspace',
        worktreeRoot: '/tmp/worktrees',
        maxConcurrentLeases: 1,
        supportsInterrupt: true,
        supportsCheckpointResume: true,
        supportsArtifactUpload: true,
        supportsConcurrentSessions: true,
        integration: {
          networkModesSupported: 'docs_allowlist' as unknown as ['docs_allowlist'],
          allowedDocDomains: [],
          allowedSandboxDomains: [],
          supportsBrowserConsent: false,
          supportsSecretBroker: false,
          supportsOAuthBroker: false,
          supportsIntegrationLab: false,
        },
        host: {
          hostName: 'runner-phase6-1.local',
          hostOs: 'darwin',
          hostArch: 'arm64',
          extraField: true,
        },
        publishedAt: '2026-03-26T10:00:00.000Z',
      },
    },
  })

  assert.equal(invalidManifest.statusCode, 400)

  const invalidClaim = await app.inject({
    method: 'POST',
    url: '/runner-host/leases:claim-next',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
    },
  })

  assert.equal(invalidClaim.statusCode, 400)

  const invalidHeartbeat = await app.inject({
    method: 'POST',
    url: '/runner-host/attempts/attempt-1/heartbeat',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      leaseAttemptId: 'attempt-1',
      heartbeatExpiryAt: '2026-03-26T10:05:00.000Z',
      mcpPoolSnapshot: {
        schemaVersion: 1,
        runnerNodeId: 'runner-phase6-1',
        configHash: 'mcp-config-hash',
        capturedAt: '2026-03-26T10:01:00.000Z',
        bindings: [
          {
            serverName: 'serena',
            sharingScope: 'repo',
            bindingKey: 'serena|repo|repo-primary|config-hash',
            repoSlug: 'repo-primary',
            acquiredCount: 1,
            sessionCounts: {
              'lease:attempt:1': 1,
            },
            processState: 'paused',
            updatedAt: '2026-03-26T10:01:00.000Z',
          },
        ],
      },
    },
  })

  assert.equal(invalidHeartbeat.statusCode, 400)

  const invalidCompletion = await app.inject({
    method: 'POST',
    url: '/runner-host/attempts/attempt-1/completed',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      artifactBundle: {
        schemaVersion: 2,
        leaseId: 'lease-1',
        leaseAttemptId: 'attempt-1',
        issueId: 'ISSUE-1',
        runId: null,
        requestedProvider: 'codex',
        effectiveProvider: 'codex',
        providerAttemptNo: 1,
        fallbackFromProvider: null,
        fallbackReason: null,
        roleExecutionPolicyVersion: 1,
        agentRole: 'orchestrator',
        status: 'pending',
        summary: 'done',
        changedFiles: [],
        testResults: [],
        patchRef: null,
        branchRef: null,
        reviewFindings: [],
        executionSessionKey: 'lease-1:attempt:1',
        mcpProfileRef: 'default',
        mcpBindingsSummary: [
          {
            serverName: 'serena',
            sharingScope: 'workspace' as unknown as 'repo',
            bindingKey: 'serena|repo|repo-primary|config-hash',
            reused: false,
            repoSlug: 'repo-primary',
          },
        ],
        toolUsage: ['serena'],
        mcpBindings: [],
        providerExecutionMetadata: {},
        producedAt: '2026-03-26T10:10:00.000Z',
      },
      executionMetadata: {
        schemaVersion: 2,
        agentRole: 'orchestrator',
        promptVersion: 'phase6',
        agentLibraryReleaseId: 'v1',
        taskInstructionsRef: 'agent-library://releases/v1/prompt-bundles/orchestrator',
        roleCharterRef: 'agent-library://releases/v1/role-charters/orchestrator',
        promptBundleFingerprint: 'bundle-fingerprint-1',
        resolvedPromptFamilyRefs: ['global-baseline', 'planning'],
        skillPackRefs: ['orchestrator_core'],
        resolvedSkillRefs: ['F01'],
        skippedOptionalSkillRefs: [],
        effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
        contextPackFingerprint: null,
        configVersion: 1,
        workflowId: 'issue:ISSUE-1',
        workflowRunId: null,
        runKind: 'build',
        attemptNo: 1,
        requestedProvider: 'unknown',
        effectiveProvider: 'codex',
        providerAttemptNo: 1,
        fallbackFromProvider: null,
        fallbackReason: null,
        toolsUsed: ['serena'],
        mcpBindings: [],
        runnerNodeId: 'runner-phase6-1',
        hostGroupId: 'host-1',
        executionDurationMs: 1000,
        completionReason: 'completed',
      },
    },
  })

  assert.equal(invalidCompletion.statusCode, 400)

  const invalidFailure = await app.inject({
    method: 'POST',
    url: '/runner-host/attempts/attempt-1/failed',
    headers: {
      authorization: 'Bearer runner-token-1',
    },
    payload: {
      schemaVersion: 1,
      runnerNodeId: 'runner-phase6-1',
      leaseAttemptId: 'attempt-1',
      errorClass: 'worker_error',
      errorMessage: 'boom',
      fallbackReason: null,
      checkpointRef: null,
      supportsCheckpointResume: false,
      executionMetadata: {
        schemaVersion: 2,
        agentRole: 'orchestrator',
        promptVersion: 'phase6',
        agentLibraryReleaseId: 'v1',
        taskInstructionsRef: 'agent-library://releases/v1/prompt-bundles/orchestrator',
        roleCharterRef: 'agent-library://releases/v1/role-charters/orchestrator',
        promptBundleFingerprint: 'bundle-fingerprint-1',
        resolvedPromptFamilyRefs: ['global-baseline', 'planning'],
        skillPackRefs: ['orchestrator_core'],
        resolvedSkillRefs: ['F01'],
        skippedOptionalSkillRefs: [],
        effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
        contextPackFingerprint: null,
        configVersion: 1,
        workflowId: 'issue:ISSUE-1',
        workflowRunId: null,
        runKind: 'build',
        attemptNo: 1,
        requestedProvider: 'unknown',
        effectiveProvider: 'codex',
        providerAttemptNo: 1,
        fallbackFromProvider: null,
        fallbackReason: null,
        toolsUsed: ['serena'],
        mcpBindings: [
          {
            serverName: 'serena',
            sharingScope: 'repo',
            bindingKey: 123 as unknown as string,
            reused: false,
            repoSlug: 'repo-primary',
          },
        ],
        runnerNodeId: 'runner-phase6-1',
        hostGroupId: 'host-1',
        executionDurationMs: 1000,
        completionReason: 'failed',
      },
    },
  })

  assert.equal(invalidFailure.statusCode, 400)
  assert.deepEqual(recorded.completions, [])
  assert.deepEqual(recorded.heartbeats, [])
  assert.deepEqual(recorded.manifests, [])
  assert.deepEqual(recorded.failures, [])
  assert.equal(recorded.claimNextCalls, 0)

  await app.close()
})
