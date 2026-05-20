import assert from 'node:assert/strict'
import test from 'node:test'

import type { RunnerCapabilityManifestV1, TaskEnvelopeV2 } from '@ai-dev-team/shared'

import {
  claimNextRunnerTask,
  createRunnerLeaseFromCommand,
  getActiveAgentLibraryReleaseSummary,
  getRunnerExecutionBundle,
  getRunnerLeaseDetailView,
  loadPublishedAgentRuntimeBundle,
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishAgentRuntimeRelease,
  publishWorkflowConfig,
  recordRunnerAttemptCompletion,
  recordRunnerAttemptFailure,
  recordRunnerExecutionStarted,
  upsertIssueContractSnapshot,
  upsertRunnerCapabilityManifest,
} from './index.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)
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
  'S16',
  'S14',
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

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

function buildRunnerManifest(input: {
  runnerNodeId: string
  supportedRoles: string[]
  includeIntegrationCapabilities?: boolean
}): RunnerCapabilityManifestV1 {
  const mcpServerCatalog: RunnerCapabilityManifestV1['mcpServerCatalog'] = [
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
  ]

  if (input.includeIntegrationCapabilities) {
    mcpServerCatalog.push(
      {
        serverName: 'vendor-docs-mcp',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'vendor-docs:host',
      },
      {
        serverName: 'secret-broker-mcp',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'secret-broker:host',
      },
      {
        serverName: 'oauth-broker-mcp',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'oauth-broker:host',
      },
      {
        serverName: 'integration-lab-mcp',
        sharingScope: 'host',
        reusePolicy: 'shared_by_scope',
        supportsConcurrentSessions: true,
        configHash: 'integration-lab:host',
      },
    )
  }

  return {
    schemaVersion: 1,
    runnerNodeId: input.runnerNodeId,
    hostGroupId: 'phase6-build-hosts',
    manifestVersion: 1,
    providers: ['codex'],
    providerCliVersions: {
      codex: '1.0.0',
    },
    supportedRoles: input.supportedRoles,
    supportedRunKinds: ['build', 'review'],
    supportedRepoKinds: ['application', 'service'],
    mcpServerCatalog,
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
    workspaceRoot: `/tmp/${input.runnerNodeId}/workspace`,
    worktreeRoot: `/tmp/${input.runnerNodeId}/worktrees`,
    maxConcurrentLeases: 1,
    supportsInterrupt: true,
    supportsCheckpointResume: true,
    supportsArtifactUpload: true,
    supportsConcurrentSessions: true,
    integration: {
      networkModesSupported: input.includeIntegrationCapabilities
        ? ['docs_allowlist', 'sandbox_api_allowlist']
        : ['docs_allowlist'],
      allowedDocDomains: input.includeIntegrationCapabilities ? ['docs.vendor.test'] : [],
      allowedSandboxDomains: input.includeIntegrationCapabilities ? ['api.vendor.test'] : [],
      supportsBrowserConsent: input.includeIntegrationCapabilities ?? false,
      supportsSecretBroker: input.includeIntegrationCapabilities ?? false,
      supportsOAuthBroker: input.includeIntegrationCapabilities ?? false,
      supportsIntegrationLab: input.includeIntegrationCapabilities ?? false,
    },
    host: {
      hostName: `${input.runnerNodeId}.local`,
      hostOs: 'darwin',
      hostArch: 'arm64',
    },
    publishedAt: '2026-03-28T10:00:00.000Z',
  }
}

async function publishWorkflow(db: Awaited<ReturnType<typeof prepareTestDatabase>>) {
  const workflowBundle = await loadWorkflowManifestBundle()
  await publishWorkflowConfig(db, workflowBundle, {
    publishedBy: 'agent-runtime-integration-test',
  })
}

async function cloneRuntimeRelease(input: {
  db: Awaited<ReturnType<typeof prepareTestDatabase>>
  sourceReleaseId: string
  targetReleaseId: string
  activateForNewRuns?: boolean
}) {
  const release = await input.db
    .selectFrom('agent_library_releases')
    .selectAll()
    .where('release_id', '=', input.sourceReleaseId)
    .executeTakeFirstOrThrow()
  const roleCharters = await input.db
    .selectFrom('agent_role_charters')
    .selectAll()
    .where('release_id', '=', input.sourceReleaseId)
    .execute()
  const promptFamilies = await input.db
    .selectFrom('agent_prompt_families')
    .selectAll()
    .where('release_id', '=', input.sourceReleaseId)
    .execute()
  const skillPacks = await input.db
    .selectFrom('agent_skill_packs')
    .selectAll()
    .where('release_id', '=', input.sourceReleaseId)
    .execute()
  const promptBundles = await input.db
    .selectFrom('agent_prompt_bundles')
    .selectAll()
    .where('release_id', '=', input.sourceReleaseId)
    .execute()
  const routingRules = await input.db
    .selectFrom('agent_routing_skill_pack_rules')
    .selectAll()
    .where('release_id', '=', input.sourceReleaseId)
    .execute()

  await input.db
    .insertInto('agent_library_releases')
    .values({
      release_id: input.targetReleaseId,
      library_id: release.library_id,
      library_version: input.targetReleaseId,
      library_fingerprint: release.library_fingerprint,
      published_at: new Date('2026-03-28T12:00:00.000Z'),
      published_by: 'agent-runtime-integration-test',
      source_library_fingerprint: release.source_library_fingerprint,
      is_active_for_new_runs: false,
    })
    .execute()

  await input.db
    .insertInto('agent_role_charters')
    .values(
      roleCharters.map((row) => ({
        release_id: input.targetReleaseId,
        role_id: row.role_id,
        charter_version: row.charter_version,
        canonical_run_kind: row.canonical_run_kind,
        frontmatter_json: toJsonInsert(row.frontmatter_json),
        source_refs: toJsonInsert(row.source_refs),
        body: row.body,
        relative_path: row.relative_path,
        role_fingerprint: row.role_fingerprint,
      })),
    )
    .execute()

  await input.db
    .insertInto('agent_prompt_families')
    .values(
      promptFamilies.map((row) => ({
        release_id: input.targetReleaseId,
        prompt_family_ref: row.prompt_family_ref,
        family_id: row.family_id,
        family_version: row.family_version,
        provider_compatibility: toJsonInsert(row.provider_compatibility),
        compatible_roles: toJsonInsert(row.compatible_roles),
        compatible_skill_packs: toJsonInsert(row.compatible_skill_packs),
        source_refs: toJsonInsert(row.source_refs),
        body: row.body,
        relative_path: row.relative_path,
        family_fingerprint: row.family_fingerprint,
      })),
    )
    .execute()

  await input.db
    .insertInto('agent_skill_packs')
    .values(
      skillPacks.map((row) => ({
        release_id: input.targetReleaseId,
        pack_id: row.pack_id,
        pack_version: row.pack_version,
        purpose: row.purpose,
        skill_refs: toJsonInsert(row.skill_refs),
        optional_skill_refs: toJsonInsert(row.optional_skill_refs),
        providers: toJsonInsert(row.providers),
        activation_conditions: toJsonInsert(row.activation_conditions),
        prompt_family_refs: toJsonInsert(row.prompt_family_refs),
        denied_actions_overlay: toJsonInsert(row.denied_actions_overlay),
        human_gate_overlay: toJsonInsert(row.human_gate_overlay),
        source_refs: toJsonInsert(row.source_refs),
        skill_pack_fingerprint: row.skill_pack_fingerprint,
      })),
    )
    .execute()

  await input.db
    .insertInto('agent_prompt_bundles')
    .values(
      promptBundles.map((row) => ({
        release_id: input.targetReleaseId,
        role_id: row.role_id,
        prompt_bundle_ref: row.prompt_bundle_ref.replace(
          `/releases/${input.sourceReleaseId}/`,
          `/releases/${input.targetReleaseId}/`,
        ),
        role_charter_ref: row.role_charter_ref.replace(
          `/releases/${input.sourceReleaseId}/`,
          `/releases/${input.targetReleaseId}/`,
        ),
        prompt_version: input.targetReleaseId,
        prompt_bundle_fingerprint: row.prompt_bundle_fingerprint,
        default_skill_pack_refs: toJsonInsert(row.default_skill_pack_refs),
        default_prompt_family_refs: toJsonInsert(row.default_prompt_family_refs),
        resolution_mode: row.resolution_mode,
      })),
    )
    .execute()

  await input.db
    .insertInto('agent_routing_skill_pack_rules')
    .values(
      routingRules.map((row) => ({
        release_id: input.targetReleaseId,
        rule_id: row.rule_id,
        statuses: toJsonInsert(row.statuses),
        triggers: toJsonInsert(row.triggers),
        task_types: toJsonInsert(row.task_types),
        requires_integration: row.requires_integration,
        add_skill_pack_refs: toJsonInsert(row.add_skill_pack_refs),
        notes: row.notes,
      })),
    )
    .execute()

  if (input.activateForNewRuns) {
    await input.db
      .updateTable('agent_library_releases')
      .set({ is_active_for_new_runs: false })
      .where('library_id', '=', release.library_id)
      .execute()

    await input.db
      .updateTable('agent_library_releases')
      .set({ is_active_for_new_runs: true })
      .where('release_id', '=', input.targetReleaseId)
      .execute()
  }
}

async function insertRun(input: {
  db: Awaited<ReturnType<typeof prepareTestDatabase>>
  issueId: string
  workflowId: string
  runId: string
  sequenceNo: number
}) {
  const transition = await input.db
    .insertInto('status_transition_audit')
    .values({
      issue_id: input.issueId,
      run_id: null,
      workflow_id: input.workflowId,
      config_version: 1,
      from_status_code: 'planned',
      to_status_code: 'ready_for_build',
      trigger_code: 'system_ready_check_passed',
      rule_id: null,
      actor_type: 'system',
      actor_id: 'agent-runtime-integration-test',
      owner_role: 'orchestrator',
      reason_code: null,
      reason_text: null,
      comment_id: null,
      artifact_links: toJsonInsert([]),
      checkpoint_id: null,
      lease_id: null,
      metadata: toJsonInsert({}),
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  await input.db
    .insertInto('issue_runs')
    .values({
      id: input.runId,
      issue_id: input.issueId,
      workflow_id: input.workflowId,
      sequence_no: input.sequenceNo,
      run_kind: 'build',
      status: 'open',
      config_version: 1,
      opened_by_transition_id: transition.id,
      closed_by_transition_id: null,
      branch_ref: null,
      runner_requirements: toJsonInsert({}),
      checkpoint_id: null,
    })
    .execute()
}

function buildExecutionMetadataFromTask(input: {
  task: TaskEnvelopeV2
  runnerNodeId: string
  hostGroupId: string
  resolvedPromptFamilyRefs?: string[]
  resolvedSkillRefs?: string[]
  skippedOptionalSkillRefs?: string[]
}) {
  return {
    schemaVersion: 2 as const,
    agentRole: input.task.agentRole,
    promptVersion: input.task.promptVersion ?? input.task.taskInstructionsRef ?? 'legacy_synthetic',
    agentLibraryReleaseId: input.task.agentLibraryReleaseId,
    taskInstructionsRef: input.task.taskInstructionsRef,
    roleCharterRef: input.task.roleCharterRef,
    promptBundleFingerprint: input.task.promptBundleFingerprint,
    resolvedPromptFamilyRefs:
      input.resolvedPromptFamilyRefs ?? ['global-baseline', 'build'],
    skillPackRefs: input.task.skillPackRefs,
    resolvedSkillRefs: input.resolvedSkillRefs ?? ['S46'],
    skippedOptionalSkillRefs: input.skippedOptionalSkillRefs ?? ['S47'],
    effectiveSkillFingerprint: input.task.effectiveSkillFingerprint,
    contextPackFingerprint: input.task.contextPackFingerprint,
    configVersion: 1,
    workflowId: input.task.workflowId,
    workflowRunId: input.task.runId,
    runKind: input.task.runKind,
    attemptNo: 1,
    requestedProvider: input.task.requestedProvider,
    effectiveProvider: input.task.effectiveProvider,
    providerAttemptNo: input.task.providerAttemptNo,
    fallbackFromProvider: input.task.fallbackFromProvider,
    fallbackReason: input.task.fallbackReason,
    toolsUsed: ['codex'],
    mcpBindings: input.task.mcpBindingsSummary,
    runnerNodeId: input.runnerNodeId,
    hostGroupId: input.hostGroupId,
    executionDurationMs: 100,
    completionReason: 'completed',
  }
}

test('agent-library runtime publish is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'publishAgentRuntimeRelease is idempotent, loads the mirrored bundle, and materializes the build_agent compatibility alias',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase({ publishAgentRuntimeRelease: false })

    try {
      const firstPublish = await publishAgentRuntimeRelease(db, {
        releaseId: 'v1',
        publishedBy: 'agent-runtime-integration-test',
        activateForNewRuns: true,
      })

      assert.equal(firstPublish.inserted, true)
      assert.equal(firstPublish.isActiveForNewRuns, true)

      const secondPublish = await publishAgentRuntimeRelease(db, {
        releaseId: 'v1',
        publishedBy: 'agent-runtime-integration-test',
        activateForNewRuns: true,
      })

      assert.equal(secondPublish.inserted, false)
      assert.equal(secondPublish.activationChanged, false)

      const activeRelease = await getActiveAgentLibraryReleaseSummary(db)
      assert.equal(activeRelease?.releaseId, 'v1')

      const runtimeBundle = await loadPublishedAgentRuntimeBundle(db, 'v1')
      assert.ok(runtimeBundle)
      const compatibilityAlias = runtimeBundle.promptBundles.find(
        (bundle) => bundle.roleId === 'build_agent',
      )

      assert.ok(compatibilityAlias)
      assert.equal(compatibilityAlias?.resolutionMode, 'compatibility_alias')
      assert.equal(
        compatibilityAlias?.promptBundleRef,
        'agent-library://releases/v1/prompt-bundles/build_agent',
      )
      assert.equal(
        compatibilityAlias?.roleCharterRef,
        'agent-library://releases/v1/role-charters/build_agent_backend',
      )
      assert.deepEqual(compatibilityAlias?.defaultSkillPackRefs, ['build_backend_core'])
    } finally {
      await db.destroy()
    }
  },
)

test(
  'first lease in a run pins the active release and later leases in the same run keep that pin after activation changes',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase({ publishAgentRuntimeRelease: false })

    try {
      await publishWorkflow(db)
      await publishAgentRuntimeRelease(db, {
        releaseId: 'v1',
        publishedBy: 'agent-runtime-integration-test',
        activateForNewRuns: true,
      })

      const issueId = 'ISSUE-AGENT-RUNTIME-PIN-1'
      const workflowId = `issue:${issueId}`
      const runId = '11111111-1111-4111-8111-111111111111'
      await insertRun({
        db,
        issueId,
        workflowId,
        runId,
        sequenceNo: 1,
      })

      const firstLease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'agent-runtime-pin-command-1',
        issueId,
        runId,
        workflowId,
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const firstPinnedRun = await db
        .selectFrom('issue_runs')
        .select(['agent_library_release_id', 'agent_library_fingerprint'])
        .where('id', '=', runId)
        .executeTakeFirstOrThrow()

      const firstPinnedLease = await db
        .selectFrom('runner_leases')
        .select(['agent_library_release_id'])
        .where('lease_id', '=', firstLease.leaseId)
        .executeTakeFirstOrThrow()

      assert.equal(firstPinnedRun.agent_library_release_id, 'v1')
      assert.equal(firstPinnedLease.agent_library_release_id, 'v1')
      assert.ok(firstPinnedRun.agent_library_fingerprint)

      await cloneRuntimeRelease({
        db,
        sourceReleaseId: 'v1',
        targetReleaseId: 'v2',
        activateForNewRuns: true,
      })

      const secondLeaseSameRun = await createRunnerLeaseFromCommand(db, {
        commandKey: 'agent-runtime-pin-command-2',
        issueId,
        runId,
        workflowId,
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const secondPinnedLease = await db
        .selectFrom('runner_leases')
        .select(['agent_library_release_id'])
        .where('lease_id', '=', secondLeaseSameRun.leaseId)
        .executeTakeFirstOrThrow()

      assert.equal(secondPinnedLease.agent_library_release_id, 'v1')

      const nextIssueId = 'ISSUE-AGENT-RUNTIME-PIN-2'
      const nextWorkflowId = `issue:${nextIssueId}`
      const nextRunId = '22222222-2222-4222-8222-222222222222'
      await insertRun({
        db,
        issueId: nextIssueId,
        workflowId: nextWorkflowId,
        runId: nextRunId,
        sequenceNo: 1,
      })

      const firstLeaseNextRun = await createRunnerLeaseFromCommand(db, {
        commandKey: 'agent-runtime-pin-command-3',
        issueId: nextIssueId,
        runId: nextRunId,
        workflowId: nextWorkflowId,
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const nextRunPinnedLease = await db
        .selectFrom('runner_leases')
        .select(['agent_library_release_id'])
        .where('lease_id', '=', firstLeaseNextRun.leaseId)
        .executeTakeFirstOrThrow()

      assert.equal(nextRunPinnedLease.agent_library_release_id, 'v2')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'build_agent compatibility alias produces a real prompt bundle ref in the task envelope and lease detail',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase({ publishAgentRuntimeRelease: false })

    try {
      await publishWorkflow(db)
      await publishAgentRuntimeRelease(db, {
        releaseId: 'v1',
        publishedBy: 'agent-runtime-integration-test',
        activateForNewRuns: true,
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner-host:runner-build-agent-alias',
        manifest: buildRunnerManifest({
          runnerNodeId: 'runner-build-agent-alias',
          supportedRoles: ['build_agent'],
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'agent-runtime-alias-command-1',
        issueId: 'ISSUE-AGENT-RUNTIME-ALIAS-1',
        runId: null,
        workflowId: 'issue:ISSUE-AGENT-RUNTIME-ALIAS-1',
        configVersion: 1,
        requestedOwnerRole: 'build_agent',
        requestedRunKind: 'build',
        runnerRequirementProfile: {
          requestedStatusCode: 'coding',
        },
        contextPackFingerprint: 'ctx-alias-1',
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-build-agent-alias',
        heartbeatExpiryAt: new Date('2026-03-28T12:05:00.000Z'),
      })

      assert.ok(task)
      assert.equal(task?.agentLibraryReleaseId, 'v1')
      assert.equal(
        task?.taskInstructionsRef,
        'agent-library://releases/v1/prompt-bundles/build_agent',
      )
      assert.equal(task?.promptVersion, 'v1')
      assert.equal(
        task?.roleCharterRef,
        'agent-library://releases/v1/role-charters/build_agent_backend',
      )
      assert.deepEqual(task?.skillPackRefs, ['build_backend_core'])

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.equal(detail?.lease.promptResolutionSource, 'compatibility_alias')
      assert.equal(
        detail?.lease.taskInstructionsRef,
        'agent-library://releases/v1/prompt-bundles/build_agent',
      )
      assert.equal(
        detail?.lease.roleCharterRef,
        'agent-library://releases/v1/role-charters/build_agent_backend',
      )
      assert.deepEqual(detail?.lease.skillPackRefs, ['build_backend_core'])
      assert.equal(detail?.lease.contextPackFingerprint, 'ctx-alias-1')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'execution bundle assembly returns the exact per-attempt compatibility-alias snapshot',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase({ publishAgentRuntimeRelease: false })

    try {
      await publishWorkflow(db)
      await publishAgentRuntimeRelease(db, {
        releaseId: 'v1',
        publishedBy: 'agent-runtime-integration-test',
        activateForNewRuns: true,
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner-host:runner-build-agent-execution-bundle',
        manifest: buildRunnerManifest({
          runnerNodeId: 'runner-build-agent-execution-bundle',
          supportedRoles: ['build_agent'],
        }),
      })

      await createRunnerLeaseFromCommand(db, {
        commandKey: 'agent-runtime-execution-bundle-command-1',
        issueId: 'ISSUE-AGENT-RUNTIME-BUNDLE-1',
        runId: null,
        workflowId: 'issue:ISSUE-AGENT-RUNTIME-BUNDLE-1',
        configVersion: 1,
        requestedOwnerRole: 'build_agent',
        requestedRunKind: 'build',
        runnerRequirementProfile: {
          requestedStatusCode: 'coding',
        },
        contextPackFingerprint: 'ctx-bundle-1',
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-build-agent-execution-bundle',
        heartbeatExpiryAt: new Date('2026-03-28T12:07:00.000Z'),
      })

      assert.ok(task)

      const executionBundle = await getRunnerExecutionBundle(db, task!.leaseAttemptId)

      assert.equal(
        executionBundle.roleCharter.roleId,
        'build_agent_backend',
      )
      assert.equal(executionBundle.roleExecutionPolicy.ownerRole, 'build_agent')
      assert.deepEqual(executionBundle.resolvedPromptFamilyRefs, [
        'build/v1',
        'global-baseline/v1',
      ])
      assert.deepEqual(executionBundle.skillPackRefs, ['build_backend_core'])
      assert.deepEqual(
        executionBundle.promptFamilies.map((family) => family.familyId),
        ['build', 'global-baseline'],
      )
      assert.deepEqual(
        executionBundle.skillPacks.map((pack) => pack.packId),
        ['build_backend_core'],
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'execution bundle assembly includes role-specific system instructions for intake_agent',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase({ publishAgentRuntimeRelease: false })

    try {
      await publishWorkflow(db)
      await publishAgentRuntimeRelease(db, {
        releaseId: 'v1',
        publishedBy: 'agent-runtime-integration-test',
        activateForNewRuns: true,
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner-host:runner-intake-agent-execution-bundle',
        manifest: buildRunnerManifest({
          runnerNodeId: 'runner-intake-agent-execution-bundle',
          supportedRoles: ['intake_agent'],
        }),
      })

      await createRunnerLeaseFromCommand(db, {
        commandKey: 'agent-runtime-execution-bundle-command-intake-1',
        issueId: 'ISSUE-AGENT-RUNTIME-BUNDLE-INTAKE-1',
        runId: null,
        workflowId: 'issue:ISSUE-AGENT-RUNTIME-BUNDLE-INTAKE-1',
        configVersion: 1,
        requestedOwnerRole: 'intake_agent',
        requestedRunKind: null,
        runnerRequirementProfile: {
          requestedStatusCode: 'triage',
        },
        contextPackFingerprint: 'ctx-bundle-intake-1',
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-intake-agent-execution-bundle',
        heartbeatExpiryAt: new Date('2026-03-28T12:07:00.000Z'),
      })

      assert.ok(task)
      assert.equal(task!.agentRole, 'intake_agent')

      const executionBundle = await getRunnerExecutionBundle(db, task!.leaseAttemptId)

      assert.equal(executionBundle.roleExecutionPolicy.ownerRole, 'intake_agent')
      assert.equal(executionBundle.systemInstruction?.roleId, 'intake_agent')
      assert.equal(
        executionBundle.systemInstruction?.resolutionSource,
        'working_tree_fallback',
      )
      assert.match(
        executionBundle.systemInstruction?.body ?? '',
        /You MUST use the Linear MCP to perform these actions directly/,
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'execution bundle assembly rejects stale attempts and missing mirrored runtime truth deterministically',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase({ publishAgentRuntimeRelease: false })

    try {
      await publishWorkflow(db)
      await publishAgentRuntimeRelease(db, {
        releaseId: 'v1',
        publishedBy: 'agent-runtime-integration-test',
        activateForNewRuns: true,
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner-host:runner-build-agent-execution-bundle-failures',
        manifest: buildRunnerManifest({
          runnerNodeId: 'runner-build-agent-execution-bundle-failures',
          supportedRoles: ['build_agent'],
        }),
      })

      await createRunnerLeaseFromCommand(db, {
        commandKey: 'agent-runtime-execution-bundle-command-2',
        issueId: 'ISSUE-AGENT-RUNTIME-BUNDLE-2',
        runId: null,
        workflowId: 'issue:ISSUE-AGENT-RUNTIME-BUNDLE-2',
        configVersion: 1,
        requestedOwnerRole: 'build_agent',
        requestedRunKind: 'build',
        runnerRequirementProfile: {
          requestedStatusCode: 'coding',
        },
        contextPackFingerprint: 'ctx-bundle-2',
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-build-agent-execution-bundle-failures',
        heartbeatExpiryAt: new Date('2026-03-28T12:08:00.000Z'),
      })

      assert.ok(task)

      await db
        .updateTable('runner_leases')
        .set({
          attempt_count: task!.providerAttemptNo + 1,
        })
        .where('lease_id', '=', task!.leaseId)
        .execute()

      await assert.rejects(
        () => getRunnerExecutionBundle(db, task!.leaseAttemptId),
        /stale and no longer matches the active attempt snapshot/u,
      )

      await db
        .updateTable('runner_leases')
        .set({
          attempt_count: task!.providerAttemptNo,
        })
        .where('lease_id', '=', task!.leaseId)
        .execute()

      await db
        .deleteFrom('agent_role_charters')
        .where('release_id', '=', 'v1')
        .where('role_id', '=', 'build_agent_backend')
        .execute()

      await assert.rejects(
        () => getRunnerExecutionBundle(db, task!.leaseAttemptId),
        /Role charter .* is missing from mirrored runtime truth/u,
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'integration routing adds deterministic skill packs and mismatched completion or failure metadata is rejected',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase({ publishAgentRuntimeRelease: false })

    try {
      await publishWorkflow(db)
      await publishAgentRuntimeRelease(db, {
        releaseId: 'v1',
        publishedBy: 'agent-runtime-integration-test',
        activateForNewRuns: true,
      })

      await db
        .insertInto('repository_registry')
        .values({
          repo_slug: 'repo-primary',
          github_owner: 'acme',
          github_repo: 'repo-primary',
          default_branch: 'main',
          visibility: 'private',
          linear_team_id: 'team-1',
          obsidian_root_note:
            'ai_dev_team/architecture/05_full_system_implementation_plan.md',
          agent_guidance_scope: '.',
          local_checkout_path: null,
          required_checks: toJsonInsert(['typecheck']),
          environments: toJsonInsert(['test']),
          repo_kind: 'service',
          service_dependencies: toJsonInsert([]),
        })
        .execute()

      const issueId = 'ISSUE-AGENT-RUNTIME-ROUTING-1'
      const workflowId = `issue:${issueId}`

      await upsertIssueContractSnapshot(db, {
        issueId,
        snapshotHash: 'agent-runtime-routing-snapshot-1',
        primaryRepo: 'repo-primary',
        affectedRepos: [],
        docsLinks: [],
        risk: 'medium',
        dependencies: {
          blocks: [],
          blockedBy: [],
          external: [],
        },
        contractJson: {
          project: 'project-agent-runtime',
          primaryRepo: 'repo-primary',
          affectedRepos: [],
          goal: 'Verify deterministic integration routing.',
          background: 'integration test',
          scope: ['Verify runtime routing'],
          nonGoals: [],
          acceptanceCriteria: ['Integration packs are added deterministically.'],
          verificationPath: {
            automated: ['corepack pnpm --filter @ai-dev-team/db test:integration'],
            manual: [],
          },
          docsLinks: [],
          dependencies: {
            blocks: [],
            blockedBy: [],
            external: [],
          },
          risk: 'medium',
          doneWhen: ['The lease resolves the expected runtime skill packs.'],
          openQuestions: [],
          humanDecisionRequired: false,
          issueType: 'integration',
          authScheme: 'oauth2_auth_code',
          providerName: 'stripe',
          source: 'founder',
          mode: 'autonomous',
        },
      })

      const transition = await db
        .insertInto('status_transition_audit')
        .values({
          issue_id: issueId,
          run_id: null,
          workflow_id: workflowId,
          config_version: 1,
          from_status_code: 'ready_for_build',
          to_status_code: 'coding',
          trigger_code: 'system_build_started',
          rule_id: null,
          actor_type: 'system',
          actor_id: 'agent-runtime-integration-test',
          owner_role: 'build_agent',
          reason_code: null,
          reason_text: null,
          comment_id: null,
          artifact_links: toJsonInsert([]),
          checkpoint_id: null,
          lease_id: null,
          metadata: toJsonInsert({}),
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner-host:runner-build-agent-integration',
        manifest: buildRunnerManifest({
          runnerNodeId: 'runner-build-agent-integration',
          supportedRoles: ['build_agent'],
          includeIntegrationCapabilities: true,
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'agent-runtime-routing-command-1',
        issueId,
        runId: null,
        workflowId,
        configVersion: 1,
        requestedOwnerRole: 'build_agent',
        requestedRunKind: 'build',
        runnerRequirementProfile: {
          requestedStatusCode: 'coding',
        },
        contextPackFingerprint: 'ctx-routing-1',
        checkpointId: null,
        transitionAuditId: transition.id,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-build-agent-integration',
        heartbeatExpiryAt: new Date('2026-03-28T12:10:00.000Z'),
      })

      assert.ok(task)
      assert.deepEqual(
        [...(task?.skillPackRefs ?? [])].sort((left, right) => left.localeCompare(right)),
        ['build_backend_core', 'build_integrations_core', 'integration_boundary_core'],
      )

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.deepEqual(
        [...(detail?.lease.skillPackRefs ?? [])].sort((left, right) => left.localeCompare(right)),
        ['build_backend_core', 'build_integrations_core', 'integration_boundary_core'],
      )
      const executionBundle = await getRunnerExecutionBundle(db, task!.leaseAttemptId)

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: task!.leaseAttemptId,
        runnerNodeId: 'runner-build-agent-integration',
        executionSessionKey: task!.executionSessionKey,
        mcpBindingsSummary: task!.mcpBindingsSummary,
      })

      const artifactBundle = {
        schemaVersion: 2 as const,
        leaseId: task!.leaseId,
        leaseAttemptId: task!.leaseAttemptId,
        issueId,
        runId: task!.runId,
        requestedProvider: task!.requestedProvider,
        effectiveProvider: task!.effectiveProvider,
        providerAttemptNo: task!.providerAttemptNo,
        fallbackFromProvider: task!.fallbackFromProvider,
        fallbackReason: task!.fallbackReason,
        roleExecutionPolicyVersion: task!.roleExecutionPolicyVersion,
        agentRole: task!.agentRole,
        status: 'completed' as const,
        runKind: task!.runKind,
        summary: 'integration routing completed',
        changedFiles: [],
        testResults: [],
        patchRef: null,
        branchRef: null,
        reviewFindings: [],
        executionSessionKey: task!.executionSessionKey,
        mcpProfileRef: task!.mcpProfileRef,
        mcpBindingsSummary: task!.mcpBindingsSummary,
        toolUsage: ['codex'],
        mcpBindings: task!.mcpBindingsSummary,
        providerExecutionMetadata: {
          mode: 'integration-test',
        },
        producedAt: new Date().toISOString(),
      }

      const mismatchedCompletion = {
        ...buildExecutionMetadataFromTask({
          task: task!,
          runnerNodeId: 'runner-build-agent-integration',
          hostGroupId: 'phase6-build-hosts',
          resolvedPromptFamilyRefs: executionBundle.resolvedPromptFamilyRefs,
          resolvedSkillRefs: executionBundle.resolvedSkillRefs,
          skippedOptionalSkillRefs: executionBundle.skippedOptionalSkillRefs,
        }),
        taskInstructionsRef: 'agent-library://releases/v1/prompt-bundles/not-build-agent',
      }

      await assert.rejects(
        () =>
          recordRunnerAttemptCompletion(db, {
            runnerNodeId: 'runner-build-agent-integration',
            artifactBundle,
            executionMetadata: mismatchedCompletion,
          }),
        /Runner completion payload does not match durable attempt state: .*executionMetadata\.taskInstructionsRef/u,
      )

      const mismatchedFailure = {
        ...buildExecutionMetadataFromTask({
          task: task!,
          runnerNodeId: 'runner-build-agent-integration',
          hostGroupId: 'phase6-build-hosts',
          resolvedPromptFamilyRefs: executionBundle.resolvedPromptFamilyRefs,
          resolvedSkillRefs: executionBundle.resolvedSkillRefs,
          skippedOptionalSkillRefs: executionBundle.skippedOptionalSkillRefs,
        }),
        effectiveSkillFingerprint: 'mismatched-skill-fingerprint',
      }

      await assert.rejects(
        () =>
          recordRunnerAttemptFailure(db, {
            leaseAttemptId: task!.leaseAttemptId,
            runnerNodeId: 'runner-build-agent-integration',
            errorClass: 'worker_error',
            errorMessage: 'integration failure',
            fallbackReason: null,
            checkpointRef: null,
            supportsCheckpointResume: false,
            executionMetadata: mismatchedFailure,
          }),
        /Runner failure payload does not match durable attempt state: .*executionMetadata\.effectiveSkillFingerprint/u,
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'historical leases with null prompt runtime columns remain inspectable as legacy_synthetic',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase({ publishAgentRuntimeRelease: false })

    try {
      await publishWorkflow(db)

      const inserted = await db
        .insertInto('runner_leases')
        .values({
          issue_id: 'ISSUE-AGENT-RUNTIME-LEGACY-1',
          run_id: null,
          workflow_id: 'issue:ISSUE-AGENT-RUNTIME-LEGACY-1',
          requested_provider: 'codex',
          requested_owner_role: 'orchestrator',
          requested_run_kind: 'build',
          role_execution_policy_version: 1,
          runner_requirement_profile_json: toJsonInsert({}),
          context_pack_fingerprint: 'ctx-legacy-1',
          status: 'requested',
          acquired_at: null,
          execution_started_at: null,
          last_heartbeat_at: null,
          heartbeat_expires_at: null,
          failed_at: null,
          completed_at: null,
          released_at: null,
          cancellation_requested_at: null,
          released_reason_code: null,
          assigned_runner_node_id: null,
          result_artifact_id: null,
          attempt_count: 1,
          last_error: null,
          requested_by_command_key: 'agent-runtime-legacy-command-1',
        })
        .returning('lease_id')
        .executeTakeFirstOrThrow()

      const detail = await getRunnerLeaseDetailView(db, inserted.lease_id)

      assert.equal(detail?.lease.promptResolutionSource, 'legacy_synthetic')
      assert.equal(detail?.lease.agentLibraryReleaseId, null)
      assert.equal(detail?.lease.promptVersion, null)
      assert.equal(detail?.lease.taskInstructionsRef, null)
      assert.equal(detail?.lease.roleCharterRef, null)
      assert.deepEqual(detail?.lease.skillPackRefs, [])
      assert.equal(detail?.lease.effectiveSkillFingerprint, null)
      assert.equal(detail?.lease.contextPackFingerprint, 'ctx-legacy-1')
    } finally {
      await db.destroy()
    }
  },
)
