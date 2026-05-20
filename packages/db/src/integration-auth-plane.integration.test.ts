import assert from 'node:assert/strict'
import test from 'node:test'

import {
  claimNextRunnerTask,
  createRunnerLeaseFromCommand,
  getCredentialSlotsByIssueId,
  getIntegrationValidationRunsByIssueId,
  getLatestIntegrationContextArtifacts,
  getOAuthClientRegistrationsByIssueId,
  getOAuthConsentSessionsByIssueId,
  getTokenHandlesByIssueId,
  getWebhookRegistrationsByIssueId,
  insertIntegrationValidationRun,
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
  recordOAuthConsentCallback,
  updateCredentialSlotStatus,
  updateTokenHandleStatus,
  upsertOAuthClientRegistration,
  upsertRunnerCapabilityManifest,
  upsertWebhookRegistration,
} from './index.js'
import type { RunnerCapabilityManifestV1 } from '@ai-dev-team/shared'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const integrationClaimSkillRefs = [
  'F01',
  'F02',
  'F03',
  'F06',
  'F07',
  'F08',
  'F09',
  'F10',
  'F11',
  'F13',
  'S01',
  'S03',
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

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

function buildRunnerManifest(input: {
  runnerNodeId: string
  supportsBrowserConsent?: boolean
  supportsSecretBroker?: boolean
  supportsOAuthBroker?: boolean
  supportsIntegrationLab?: boolean
  includeIntegrationMcpServers?: boolean
}): RunnerCapabilityManifestV1 {
  const mcpServerCatalog: RunnerCapabilityManifestV1['mcpServerCatalog'] = [
    {
      serverName: 'serena',
      sharingScope: 'repo',
      reusePolicy: 'shared_by_scope',
      supportsConcurrentSessions: true,
      configHash: 'serena-config',
    },
    {
      serverName: 'context7',
      sharingScope: 'host',
      reusePolicy: 'shared_by_scope',
      supportsConcurrentSessions: true,
      configHash: 'context7-config',
    },
  ]

  if (input.includeIntegrationMcpServers) {
    mcpServerCatalog.push(
      {
        serverName: 'vendor-docs-mcp',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'vendor-docs-config',
      },
      {
        serverName: 'secret-broker-mcp',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'secret-broker-config',
      },
      {
        serverName: 'integration-lab-mcp',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'integration-lab-config',
      },
      {
        serverName: 'oauth-broker-mcp',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'oauth-broker-config',
      },
    )
  }

  return {
    schemaVersion: 1,
    runnerNodeId: input.runnerNodeId,
    hostGroupId: 'local-dev',
    manifestVersion: 1,
    providers: ['codex'],
    providerCliVersions: {
      codex: '1.0.0',
    },
    supportedRoles: ['orchestrator', 'integration_agent'],
    supportedRunKinds: ['build'],
    supportedRepoKinds: ['application'],
    mcpServerCatalog,
    toolBaseline: ['serena', 'context7', 'obsidian', 'sequential-thinking'],
    skillsAvailable: [...integrationClaimSkillRefs],
    activeAgentLibraryReleaseId: 'v1',
    activeAgentLibraryFingerprint: 'release-fingerprint-v1',
    skillSyncStatus: 'ready',
    skillSyncError: null,
    installedSkillBundles: [
      {
        releaseId: 'v1',
        fingerprint: 'release-fingerprint-v1',
        skillIds: [...integrationClaimSkillRefs],
      },
    ],
    workspaceRoot: `/tmp/${input.runnerNodeId}/workspace`,
    worktreeRoot: `/tmp/${input.runnerNodeId}/worktrees`,
    maxConcurrentLeases: 1,
    supportsInterrupt: true,
    supportsCheckpointResume: false,
    supportsArtifactUpload: true,
    supportsConcurrentSessions: true,
    integration: {
      networkModesSupported: ['docs_allowlist', 'sandbox_api_allowlist'],
      allowedDocDomains:
        input.supportsSecretBroker || input.supportsOAuthBroker || input.supportsIntegrationLab
          ? ['docs.vendor.test']
          : [],
      allowedSandboxDomains:
        input.supportsSecretBroker || input.supportsOAuthBroker || input.supportsIntegrationLab
          ? ['sandbox.vendor.test']
          : [],
      supportsBrowserConsent: input.supportsBrowserConsent ?? false,
      supportsSecretBroker: input.supportsSecretBroker ?? false,
      supportsOAuthBroker: input.supportsOAuthBroker ?? false,
      supportsIntegrationLab: input.supportsIntegrationLab ?? false,
    },
    host: {
      hostName: `${input.runnerNodeId}.local`,
      hostOs: 'darwin',
      hostArch: 'arm64',
    },
    publishedAt: '2026-03-26T10:00:00.000Z',
  }
}

test('integration auth plane db integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'integration auth plane tables persist metadata-only auth state and sanitize callback capture',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const credentialSlot = await db
        .insertInto('credential_slots')
        .values({
          issue_id: 'ISSUE-INT-1',
          provider_name: 'Stripe',
          credential_key: 'client_secret',
          environment: 'sandbox',
          secret_alias: 'stripe.sandbox.client_secret',
          owner_actor_type: 'human',
          owner_actor_id: 'user-1',
          auth_scheme: 'oauth2_auth_code',
          status: 'uploaded',
          scopes: toJsonInsert(['read_write']),
          metadata: toJsonInsert({
            uploadedBy: 'user-1',
          }),
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      const updatedSlot = await updateCredentialSlotStatus(db, {
        slotId: credentialSlot.id,
        status: 'validated',
        validationCheckedAt: new Date('2026-03-26T10:02:00.000Z'),
        metadata: {
          validatedBy: 'integration-agent',
        },
        updatedAt: new Date('2026-03-26T10:02:00.000Z'),
      })

      assert.equal(updatedSlot?.schemaVersion, 1)
      assert.equal(updatedSlot?.status, 'validated')

      const registration = await upsertOAuthClientRegistration(db, {
        issueId: 'ISSUE-INT-1',
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
        updatedAt: new Date('2026-03-26T10:03:00.000Z'),
      })

      const consent = await db
        .insertInto('oauth_consent_sessions')
        .values({
          issue_id: 'ISSUE-INT-1',
          provider_name: 'Stripe',
          registration_id: registration.id,
          state: 'state-1',
          pkce_verifier_alias: 'pkce-verifier-alias',
          code_challenge_method: 'S256',
          requested_scopes: toJsonInsert(['read_write']),
          granted_scopes: toJsonInsert([]),
          status: 'consent_required',
          consent_url: 'https://vendor.test/consent',
          metadata: toJsonInsert({}),
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      const tokenHandle = await db
        .insertInto('token_handles')
        .values({
          issue_id: 'ISSUE-INT-1',
          provider_name: 'Stripe',
          consent_session_id: consent.id,
          token_kind: 'refresh_token',
          secret_alias: 'stripe.sandbox.refresh_token',
          status: 'active',
          scopes: toJsonInsert(['read_write']),
          metadata: toJsonInsert({}),
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      const updatedTokenHandle = await updateTokenHandleStatus(db, {
        tokenHandleId: tokenHandle.id,
        status: 'refresh_required',
        lastCheckedAt: new Date('2026-03-26T10:04:00.000Z'),
        lastError: 'refresh window reached',
        metadata: {
          refreshStrategy: 'scheduled',
        },
        updatedAt: new Date('2026-03-26T10:04:00.000Z'),
      })

      assert.equal(updatedTokenHandle?.schemaVersion, 1)
      assert.equal(updatedTokenHandle?.status, 'refresh_required')

      const webhookRegistration = await upsertWebhookRegistration(db, {
        issueId: 'ISSUE-INT-1',
        providerName: 'Stripe',
        environment: 'sandbox',
        callbackUrl: 'https://control.example.test/webhooks/stripe',
        eventTypes: ['payment.succeeded'],
        signingSecretAlias: 'stripe.sandbox.webhook_secret',
        status: 'validated',
        lastValidatedAt: new Date('2026-03-26T10:09:30.000Z'),
        metadata: {
          replaySafe: true,
        },
        updatedAt: new Date('2026-03-26T10:09:30.000Z'),
      })

      assert.equal(webhookRegistration.schemaVersion, 1)
      assert.equal(webhookRegistration.status, 'validated')

      await db
        .insertInto('artifact_registry')
        .values([
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'integration_brief',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://integration-brief/old',
            artifact_summary: 'Old brief',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'needs_spec',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:00:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'integration_brief',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://integration-brief/latest',
            artifact_summary: 'Latest brief',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'needs_spec',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:05:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'auth_decision_record',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://auth-decision/1',
            artifact_summary: 'Use auth code + PKCE',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'planned',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:06:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'credential_request',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://credential-request/1',
            artifact_summary: 'Upload sandbox credentials',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'needs_input',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:07:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'credential_validation_report',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://credential-validation/1',
            artifact_summary: 'Sandbox credential probe passed',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'planned',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:08:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'oauth_consent_session',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://oauth-consent/1',
            artifact_summary: 'Consent session prepared',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'needs_input',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:09:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'webhook_contract',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://webhook-contract/1',
            artifact_summary: 'Webhook signature contract',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'planned',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:10:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'webhook_validation_report',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://webhook-validation/1',
            artifact_summary: 'Webhook replay verification passed',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'planned',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:11:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'integration_smoke_report',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://integration-smoke/1',
            artifact_summary: 'Sandbox smoke passed',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'ready_for_build',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:12:00.000Z'),
          },
          {
            issue_id: 'ISSUE-INT-1',
            run_id: null,
            transition_audit_id: null,
            artifact_type: 'integration_go_live_checklist',
            artifact_scope: 'issue',
            artifact_uri: 'artifact://go-live/1',
            artifact_summary: 'Go-live checklist',
            produced_by_role: 'integration_agent',
            produced_for_status_code: 'ready_for_build',
            metadata: toJsonInsert({}),
            produced_at: new Date('2026-03-26T10:13:00.000Z'),
          },
        ])
        .execute()

      const insertedValidationRun = await insertIntegrationValidationRun(db, {
        issueId: 'ISSUE-INT-1',
        providerName: 'Stripe',
        validationType: 'sandbox_smoke',
        environment: 'sandbox',
        status: 'passed',
        summary: 'Sandbox smoke passed',
        metadata: {
          probeCount: 2,
        },
        executedAt: new Date('2026-03-26T10:12:30.000Z'),
      })

      assert.equal(insertedValidationRun.schemaVersion, 1)

      const credentialSlots = await getCredentialSlotsByIssueId(db, 'ISSUE-INT-1')
      const registrations = await getOAuthClientRegistrationsByIssueId(
        db,
        'ISSUE-INT-1',
      )
      const consentSessions = await getOAuthConsentSessionsByIssueId(
        db,
        'ISSUE-INT-1',
      )
      const tokenHandles = await getTokenHandlesByIssueId(db, 'ISSUE-INT-1')
      const webhooks = await getWebhookRegistrationsByIssueId(db, 'ISSUE-INT-1')
      const validationRuns = await getIntegrationValidationRunsByIssueId(
        db,
        'ISSUE-INT-1',
      )
      const integrationArtifacts = await getLatestIntegrationContextArtifacts(
        db,
        'ISSUE-INT-1',
      )

      assert.equal(credentialSlots.length, 1)
      assert.equal(credentialSlots[0]?.schemaVersion, 1)
      assert.equal(credentialSlots[0]?.status, 'validated')
      assert.equal(registrations.length, 1)
      assert.equal(registrations[0]?.schemaVersion, 1)
      assert.equal(consentSessions.length, 1)
      assert.equal(consentSessions[0]?.schemaVersion, 1)
      assert.equal(tokenHandles.length, 1)
      assert.equal(tokenHandles[0]?.status, 'refresh_required')
      assert.equal(webhooks.length, 1)
      assert.equal(webhooks[0]?.status, 'validated')
      assert.equal(validationRuns.length, 1)
      assert.deepEqual(
        integrationArtifacts.artifacts.map((artifact) => artifact.artifactUri),
        [
          'artifact://go-live/1',
          'artifact://integration-smoke/1',
          'artifact://webhook-validation/1',
          'artifact://webhook-contract/1',
          'artifact://oauth-consent/1',
          'artifact://credential-validation/1',
          'artifact://credential-request/1',
          'artifact://auth-decision/1',
          'artifact://integration-brief/latest',
        ],
      )

      const updatedConsent = await recordOAuthConsentCallback(db, {
        providerName: 'Stripe',
        state: 'state-1',
        receivedAt: new Date('2026-03-26T10:10:00.000Z'),
        codePresent: true,
        error: null,
        errorDescription: null,
        grantedScopes: ['read_write'],
        metadata: {
          source: 'oauth_callback',
          code: 'raw-authorization-code',
          access_token: 'raw-access-token',
          nested: {
            refresh_token: 'raw-refresh-token',
            safe: true,
          },
        },
      })

      assert.ok(updatedConsent)
      assert.equal(updatedConsent?.status, 'callback_received')
      assert.deepEqual(updatedConsent?.grantedScopes, ['read_write'])
      assert.equal(updatedConsent?.callbackReceivedAt, '2026-03-26T10:10:00.000Z')
      assert.ok(
        !JSON.stringify(updatedConsent).includes('abc123'),
        'raw authorization code must not be persisted in consent-session metadata',
      )
      const callbackMetadata = updatedConsent?.metadata.callback as
        | { codePresent?: boolean }
        | undefined
        | null

      assert.equal(callbackMetadata?.codePresent, true)
      assert.equal(updatedConsent?.metadata.code, undefined)
      assert.equal(updatedConsent?.metadata.access_token, undefined)
      assert.deepEqual(updatedConsent?.metadata.nested, {
        safe: true,
      })
    } finally {
      await db.destroy()
    }
  },
)

test(
  'integration issues require runners with integration-safe capabilities before a lease can be claimed',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'integration-auth-plane-test',
      })

      await db
        .insertInto('linear_issue_contract_snapshots')
        .values({
          issue_id: 'ISSUE-INT-ROUTING-1',
          snapshot_hash: 'snapshot-int-routing-1',
          primary_repo: null,
          affected_repos: toJsonInsert([]),
          docs_links: toJsonInsert([]),
          risk: 'medium',
          dependencies: toJsonInsert({
            blocks: [],
            blockedBy: [],
            external: [],
          }),
          contract_json: toJsonInsert({
            project: 'project-int',
            primaryRepo: null,
            affectedRepos: [],
            goal: 'Implement OAuth onboarding',
            background: null,
            scope: ['Add OAuth callback handling'],
            nonGoals: [],
            acceptanceCriteria: ['OAuth onboarding is wired safely'],
            verificationPath: {
              automated: ['corepack pnpm test:integration'],
              manual: [],
            },
            docsLinks: [],
            dependencies: {
              blocks: [],
              blockedBy: [],
              external: [],
            },
            risk: 'medium',
            doneWhen: ['Sandbox onboarding succeeds'],
            openQuestions: [],
            humanDecisionRequired: false,
            issueType: 'feature',
            source: 'founder',
            mode: 'autonomous',
            providerName: 'Stripe',
            integrationKind: 'external_api',
            authScheme: 'oauth2_auth_code',
            requiredCredentials: [],
            secretSlots: ['stripe.client_secret'],
            requiredScopes: ['read_write'],
            oauthRedirectUris: ['https://control.example.test/oauth/callback/stripe'],
            sandboxAccountRequired: true,
            webhookRequired: false,
            webhookCallbackUrls: [],
            rateLimitNotes: null,
            errorModel: [],
            testStrategy: ['sandbox_smoke'],
            goLiveChecklist: ['Approve production access'],
            rollbackPlan: ['Revoke client secret'],
          }),
        })
        .execute()

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/non-integration',
        manifest: buildRunnerManifest({
          runnerNodeId: 'runner-non-integration',
        }),
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/integration-safe',
        manifest: buildRunnerManifest({
          runnerNodeId: 'runner-integration-safe',
          supportsBrowserConsent: true,
          supportsSecretBroker: true,
          supportsOAuthBroker: true,
          supportsIntegrationLab: true,
          includeIntegrationMcpServers: true,
        }),
      })

      await createRunnerLeaseFromCommand(db, {
        commandKey: 'command-int-routing-1',
        issueId: 'ISSUE-INT-ROUTING-1',
        runId: null,
        workflowId: 'issue:ISSUE-INT-ROUTING-1',
        configVersion: 1,
        requestedOwnerRole: 'integration_agent',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: 'fingerprint-int-routing-1',
        checkpointId: null,
      })

      const nonIntegrationTask = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-non-integration',
        heartbeatExpiryAt: new Date('2026-03-26T10:05:00.000Z'),
      })

      assert.equal(nonIntegrationTask, null)

      const integrationTask = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-integration-safe',
        heartbeatExpiryAt: new Date('2026-03-26T10:05:00.000Z'),
      })

      assert.ok(integrationTask)
      assert.equal(integrationTask?.issueId, 'ISSUE-INT-ROUTING-1')
      assert.equal(integrationTask?.agentRole, 'integration_agent')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'integration issues stay unclaimable when broker capabilities are advertised without the required integration MCP servers',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'integration-auth-plane-test',
      })

      await db
        .insertInto('linear_issue_contract_snapshots')
        .values({
          issue_id: 'ISSUE-INT-MCP-1',
          snapshot_hash: 'snapshot-int-mcp-1',
          primary_repo: null,
          affected_repos: toJsonInsert([]),
          docs_links: toJsonInsert([]),
          risk: 'medium',
          dependencies: toJsonInsert({
            blocks: [],
            blockedBy: [],
            external: [],
          }),
          contract_json: toJsonInsert({
            project: 'project-int',
            primaryRepo: null,
            affectedRepos: [],
            goal: 'Implement OAuth onboarding',
            background: null,
            scope: ['Add OAuth callback handling'],
            nonGoals: [],
            acceptanceCriteria: ['OAuth onboarding is wired safely'],
            verificationPath: {
              automated: ['corepack pnpm test:integration'],
              manual: [],
            },
            docsLinks: [],
            dependencies: {
              blocks: [],
              blockedBy: [],
              external: [],
            },
            risk: 'medium',
            doneWhen: ['Sandbox onboarding succeeds'],
            openQuestions: [],
            humanDecisionRequired: false,
            issueType: 'feature',
            source: 'founder',
            mode: 'autonomous',
            providerName: 'Stripe',
            integrationKind: 'external_api',
            authScheme: 'oauth2_auth_code',
            requiredCredentials: [],
            secretSlots: ['stripe.client_secret'],
            requiredScopes: ['read_write'],
            oauthRedirectUris: ['https://control.example.test/oauth/callback/stripe'],
            sandboxAccountRequired: true,
            webhookRequired: false,
            webhookCallbackUrls: [],
            rateLimitNotes: null,
            errorModel: [],
            testStrategy: ['sandbox_smoke'],
            goLiveChecklist: ['Approve production access'],
            rollbackPlan: ['Revoke client secret'],
          }),
        })
        .execute()

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/missing-mcp-servers',
        manifest: buildRunnerManifest({
          runnerNodeId: 'runner-missing-mcp-servers',
          supportsBrowserConsent: true,
          supportsSecretBroker: true,
          supportsOAuthBroker: true,
          supportsIntegrationLab: true,
          includeIntegrationMcpServers: false,
        }),
      })

      await createRunnerLeaseFromCommand(db, {
        commandKey: 'command-int-mcp-1',
        issueId: 'ISSUE-INT-MCP-1',
        runId: null,
        workflowId: 'issue:ISSUE-INT-MCP-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: 'fingerprint-int-mcp-1',
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-missing-mcp-servers',
        heartbeatExpiryAt: new Date('2026-03-26T10:05:00.000Z'),
      })

      assert.equal(task, null)
    } finally {
      await db.destroy()
    }
  },
)
