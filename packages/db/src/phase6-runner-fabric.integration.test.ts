import assert from 'node:assert/strict'
import test from 'node:test'

import type { RunnerCapabilityManifestV1 } from '@ai-dev-team/shared'

import {
  acknowledgeRunnerLeaseCancellation,
  claimNextRunnerTask,
  createRunnerLeaseFromCommand,
  getRunnerExecutionBundle,
  getProviderFailoverMetricsView,
  getRunnerLeaseDetailView,
  listActiveRunnerLeasesView,
  listRunnerInventoryView,
  listRunnerMcpPoolSnapshotsView,
  listStaleRunnerLeasesView,
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
  recordRunnerAttemptCompletion,
  recordRunnerAttemptFailure,
  recordRunnerExecutionStarted,
  recordRunnerHeartbeat,
  recoverStaleRunnerLeases,
  requestRunnerLeaseCancellation,
  stageRunnerArtifactBlob,
  upsertRunnerCapabilityManifest,
} from './index.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const phase6RunnerNodeId = 'runner-phase6-fabric'
const phase6HostGroupId = 'phase6-host-group'
const orchestratorControlPlaneSkillRefs = [
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
  'S48',
  'S52',
  'S53',
] as const

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

function buildPhase6RunnerManifest(input: {
  runnerNodeId: string
  hostGroupId?: string
  providers?: RunnerCapabilityManifestV1['providers']
  mcpServerCatalog?: RunnerCapabilityManifestV1['mcpServerCatalog']
  supportsCheckpointResume?: boolean
  skillsAvailable?: string[]
}): RunnerCapabilityManifestV1 {
  const providers = input.providers ?? ['codex']
  const providerCliVersions = Object.fromEntries(
    providers.map((provider) => [provider, '1.0.0']),
  ) as RunnerCapabilityManifestV1['providerCliVersions']
  const mcpServerCatalog =
    input.mcpServerCatalog ??
    [
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

  return {
    activeAgentLibraryReleaseId: 'v1',
    activeAgentLibraryFingerprint: 'release-fingerprint-v1',
    schemaVersion: 1,
    runnerNodeId: input.runnerNodeId,
    hostGroupId: input.hostGroupId ?? phase6HostGroupId,
    manifestVersion: 1,
    providers,
    providerCliVersions,
    supportedRoles: ['orchestrator'],
    supportedRunKinds: ['build'],
    supportedRepoKinds: ['application'],
    mcpServerCatalog,
    toolBaseline: ['serena', 'context7', 'obsidian'],
    skillsAvailable: input.skillsAvailable
      ? [...input.skillsAvailable].sort((left, right) => left.localeCompare(right))
      : [...orchestratorControlPlaneSkillRefs],
    skillSyncStatus: 'ready',
    skillSyncError: null,
    installedSkillBundles: [
      {
        releaseId: 'v1',
        fingerprint: 'release-fingerprint-v1',
        skillIds: input.skillsAvailable
          ? [...input.skillsAvailable].sort((left, right) =>
              left.localeCompare(right),
            )
          : [...orchestratorControlPlaneSkillRefs],
      },
    ],
    workspaceRoot: `/tmp/${input.runnerNodeId}/workspace`,
    worktreeRoot: `/tmp/${input.runnerNodeId}/worktrees`,
    maxConcurrentLeases: 1,
    supportsInterrupt: true,
    supportsCheckpointResume: input.supportsCheckpointResume ?? true,
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
      hostName: `${input.runnerNodeId}.local`,
      hostOs: 'darwin',
      hostArch: 'arm64',
    },
    publishedAt: '2026-03-26T10:00:00.000Z',
  }
}

async function getActiveAgentLibraryReleaseId(
  db: Awaited<ReturnType<typeof prepareTestDatabase>>,
): Promise<string> {
  const release = await db
    .selectFrom('agent_library_releases')
    .select(['release_id'])
    .where('is_active_for_new_runs', '=', true)
    .executeTakeFirstOrThrow()

  return release.release_id
}

async function insertTestSkillPack(
  db: Awaited<ReturnType<typeof prepareTestDatabase>>,
  input: {
    packId: string
    providers: RunnerCapabilityManifestV1['providers']
    skillRefs: string[]
    optionalSkillRefs?: string[]
  },
): Promise<string> {
  const releaseId = await getActiveAgentLibraryReleaseId(db)

  await db
    .insertInto('agent_skill_packs')
    .values({
      release_id: releaseId,
      pack_id: input.packId,
      pack_version: 'test-v1',
      purpose: `test pack ${input.packId}`,
      skill_refs: toJsonInsert(input.skillRefs),
      optional_skill_refs: toJsonInsert(input.optionalSkillRefs ?? []),
      providers: toJsonInsert(input.providers),
      activation_conditions: toJsonInsert({}),
      prompt_family_refs: toJsonInsert([]),
      denied_actions_overlay: toJsonInsert([]),
      human_gate_overlay: toJsonInsert({}),
      source_refs: toJsonInsert(['packages/db/src/phase6-runner-fabric.integration.test.ts']),
      skill_pack_fingerprint: `${input.packId}-fingerprint`,
    })
    .execute()

  return releaseId
}

async function replaceLeaseSkillPackRefs(
  db: Awaited<ReturnType<typeof prepareTestDatabase>>,
  input: {
    leaseId: string
    releaseId: string
    skillPackRefs: string[]
  },
): Promise<void> {
  await db
    .updateTable('runner_leases')
    .set({
      agent_library_release_id: input.releaseId,
      skill_pack_refs: toJsonInsert(input.skillPackRefs),
      resolved_prompt_family_refs: toJsonInsert([]),
      effective_skill_fingerprint: `${input.skillPackRefs.join('+') || 'none'}-fingerprint`,
    })
    .where('lease_id', '=', input.leaseId)
    .execute()
}

function assertRunnerCapabilitiesDoNotExposeHostGroupId(
  db: Awaited<ReturnType<typeof prepareTestDatabase>>,
) {
  // @ts-expect-error host_group_id is canonical on runner_nodes and runner_lease_attempts
  return db.selectFrom('runner_capabilities').select(['host_group_id'])
}

function assertRunnerLeasesExposeCancellationColumn(
  db: Awaited<ReturnType<typeof prepareTestDatabase>>,
) {
  return db.selectFrom('runner_leases').select(['cancellation_requested_at'])
}

test('phase 6 db runner fabric integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'host_group_id is isolated to runner_nodes and runner_lease_attempts during lease claim',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-fabric',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: phase6RunnerNodeId,
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-claim-command-1',
        issueId: 'ISSUE-PHASE6-CLAIM-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-CLAIM-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: phase6RunnerNodeId,
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(task)
      assert.equal(task?.leaseId, lease.leaseId)

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.ok(detail)
      assert.equal(detail?.attempts.length, 1)
      assert.equal(detail?.attempts[0]?.hostGroupId, phase6HostGroupId)
      assert.equal(detail?.attempts[0]?.runnerNodeId, phase6RunnerNodeId)

      assertRunnerCapabilitiesDoNotExposeHostGroupId(db)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'heartbeat snapshots persist and drive inventory and metrics truth',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-snapshot',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-snapshot',
          mcpServerCatalog: [
            {
              serverName: 'serena',
              sharingScope: 'repo',
              reusePolicy: 'shared_by_scope',
              supportsConcurrentSessions: true,
              configHash: 'serena:repo',
            },
          ],
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-snapshot-command-1',
        issueId: 'ISSUE-PHASE6-SNAPSHOT-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-SNAPSHOT-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-snapshot',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(task)

      const snapshot = {
        runnerNodeId: 'runner-phase6-snapshot',
        hostGroupId: phase6HostGroupId,
        updatedAt: '2026-03-26T12:01:00.000Z',
        bindings: [
          {
            runnerNodeId: 'runner-phase6-snapshot',
            hostGroupId: phase6HostGroupId,
            serverName: 'serena',
            sharingScope: 'repo',
            repoSlug: 'repo-primary',
            bindingKey: 'serena|repo|repo-primary|config-hash',
            acquiredCount: 2,
            sessionCounts: {
              [task!.executionSessionKey]: 2,
            },
            processState: 'running',
            updatedAt: '2026-03-26T12:01:00.000Z',
          },
        ],
      }

      await recordRunnerHeartbeat(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-snapshot',
        heartbeatExpiryAt: new Date('2026-03-26T12:05:00.000Z'),
        mcpPoolSnapshot: snapshot,
        now: new Date('2026-03-26T12:01:00.000Z'),
      })

      const snapshots = await listRunnerMcpPoolSnapshotsView(db)
      assert.equal(snapshots.length, 1)
      assert.deepEqual(snapshots[0]?.bindings[0], {
        runnerNodeId: 'runner-phase6-snapshot',
        hostGroupId: phase6HostGroupId,
        serverName: 'serena',
        sharingScope: 'repo',
        repoSlug: 'repo-primary',
        bindingKey: 'serena|repo|repo-primary|config-hash',
        acquiredCount: 2,
        sessionCounts: {
          [task!.executionSessionKey]: 2,
        },
        processState: 'running',
        updatedAt: '2026-03-26T12:01:00.000Z',
      })

      const inventory = await listRunnerInventoryView(db)
      assert.equal(inventory[0]?.sharedMcpProcessCount, 1)

      const metrics = await getProviderFailoverMetricsView(db)
      assert.equal(metrics.sharedMcpProcessCount, 1)
      assert.equal(metrics.mcpPoolReuseRatio, null)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'cancellation_requested leases stay visible to stale and active runner lease views',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      const inserted = await db
        .insertInto('runner_leases')
        .values({
          issue_id: 'ISSUE-PHASE6-CANCEL-1',
          run_id: null,
          workflow_id: 'issue:ISSUE-PHASE6-CANCEL-1',
          requested_provider: 'codex',
          requested_owner_role: 'orchestrator',
          requested_run_kind: 'build',
          role_execution_policy_version: 1,
          runner_requirement_profile_json: toJsonInsert({}),
          context_pack_fingerprint: null,
          status: 'cancellation_requested',
          acquired_at: null,
          execution_started_at: null,
          last_heartbeat_at: new Date('2026-03-26T09:45:00.000Z'),
          heartbeat_expires_at: new Date('2026-03-26T09:46:00.000Z'),
          failed_at: null,
          completed_at: null,
          released_at: null,
          cancellation_requested_at: new Date('2026-03-26T09:44:00.000Z'),
          released_reason_code: null,
          assigned_runner_node_id: null,
          result_artifact_id: null,
          attempt_count: 1,
          last_error: null,
          requested_by_command_key: 'phase6-cancel-command-1',
        })
        .returning('lease_id')
        .executeTakeFirstOrThrow()

      const activeLeases = await listActiveRunnerLeasesView(db)
      const staleLeases = await listStaleRunnerLeasesView(db)

      assert.equal(
        activeLeases.some((lease) => lease.leaseId === inserted.lease_id),
        true,
      )
      assert.equal(
        staleLeases.some((lease) => lease.leaseId === inserted.lease_id),
        true,
      )

      const leaseRow = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', inserted.lease_id)
        .executeTakeFirstOrThrow()

      assert.equal(leaseRow.cancellation_requested_at !== null, true)
      assertRunnerLeasesExposeCancellationColumn(db)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'artifact blob staging is idempotent and cancellation bookkeeping is durable on attempts',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-cancel-stage',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-cancel-stage',
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-stage-cancel-command-1',
        issueId: 'ISSUE-PHASE6-STAGE-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-STAGE-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-cancel-stage',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(task)

      const stagedOnce = await stageRunnerArtifactBlob(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-cancel-stage',
        artifactKey: 'summary-md',
        contentType: 'text/markdown',
        contentBase64: Buffer.from('# summary\n').toString('base64'),
        metadata: {
          kind: 'summary',
        },
      })

      const stagedTwice = await stageRunnerArtifactBlob(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-cancel-stage',
        artifactKey: 'summary-md',
        contentType: 'text/markdown',
        contentBase64: Buffer.from('# summary\n').toString('base64'),
        metadata: {
          kind: 'summary',
        },
      })

      assert.equal(stagedOnce.artifactId, stagedTwice.artifactId)
      assert.equal(stagedOnce.artifactUri, stagedTwice.artifactUri)

      const blobCount = await db
        .selectFrom('runner_artifact_blobs')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('lease_attempt_id', '=', lease.leaseAttemptId)
        .executeTakeFirstOrThrow()

      assert.equal(Number(blobCount.count), 1)

      const cancelRequest = await requestRunnerLeaseCancellation(db, {
        leaseId: lease.leaseId,
        reasonCode: 'operator_cancel_requested',
        reasonText: 'operator requested cancel',
      })

      assert.equal(cancelRequest.leaseStatus, 'cancellation_requested')
      assert.equal(cancelRequest.leaseAttemptId, lease.leaseAttemptId)

      const cancelAck = await acknowledgeRunnerLeaseCancellation(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-cancel-stage',
        outcome: 'accepted',
        checkpointRef: null,
      })

      assert.equal(cancelAck.leaseStatus, 'released')
      assert.equal(cancelAck.cancelOutcome, 'accepted')

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.ok(detail)
      assert.equal(detail?.lease.status, 'released')
      assert.equal(detail?.attempts[0]?.status, 'released')
      assert.equal(detail?.attempts[0]?.cancelOutcome, 'accepted')
      assert.equal(detail?.attempts[0]?.cancelRequestedAt !== null, true)
      assert.equal(detail?.attempts[0]?.cancelAcknowledgedAt !== null, true)
      assert.equal(detail?.timeline[0]?.scope, 'lease')
      assert.equal(detail?.timeline[0]?.event, 'requested')
      assert.ok(
        detail?.timeline.some(
          (event) => event.scope === 'lease' && event.event === 'cancel_requested',
        ),
      )
      assert.ok(
        detail?.timeline.some(
          (event) => event.scope === 'attempt' && event.event === 'cancel_acknowledged',
        ),
      )
      assert.ok(
        detail?.timeline.some(
          (event) => event.scope === 'lease' && event.event === 'released',
        ),
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'upsertRunnerCapabilityManifest is idempotent for the same runner and manifest version',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      const manifest = buildPhase6RunnerManifest({
        runnerNodeId: 'runner-phase6-idempotent',
        providers: ['codex'],
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-idempotent',
        manifest,
      })
      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-idempotent',
        manifest,
      })

      const capabilityRows = await db
        .selectFrom('runner_capabilities')
        .select(['runner_node_id', 'manifest_version', 'is_active'])
        .where('runner_node_id', '=', manifest.runnerNodeId)
        .execute()

      assert.equal(capabilityRows.length, 1)
      assert.equal(capabilityRows[0]?.manifest_version, manifest.manifestVersion)
      assert.equal(capabilityRows[0]?.is_active, true)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'runner inventory persists verified skills and derives provider-supported pack refs',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-skill-inventory',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-skill-inventory',
          skillsAvailable: ['S53', 'F01', 'S01', 'F02', 'F03', 'S03', 'S53'],
        }),
      })
      await insertTestSkillPack(db, {
        packId: 'phase6_inventory_pack',
        providers: ['codex'],
        skillRefs: ['F01', 'F02'],
      })

      const capabilityRow = await db
        .selectFrom('runner_capabilities')
        .select(['skills_available'])
        .where('runner_node_id', '=', 'runner-phase6-skill-inventory')
        .where('is_active', '=', true)
        .executeTakeFirstOrThrow()

      assert.deepEqual(capabilityRow.skills_available, [
        'F01',
        'F02',
        'F03',
        'S01',
        'S03',
        'S53',
      ])

      const inventory = await listRunnerInventoryView(db)
      const runnerInventory = inventory.find(
        (row) => row.runnerNodeId === 'runner-phase6-skill-inventory',
      )

      assert.ok(runnerInventory)
      assert.deepEqual(runnerInventory?.skillsAvailable, [
        'F01',
        'F02',
        'F03',
        'S01',
        'S03',
        'S53',
      ])
      assert.equal(runnerInventory?.activeAgentLibraryReleaseId, 'v1')
      assert.equal(runnerInventory?.activeAgentLibraryFingerprint, 'release-fingerprint-v1')
      assert.equal(runnerInventory?.skillSyncStatus, 'ready')
      assert.deepEqual(runnerInventory?.installedSkillBundles, [
        {
          releaseId: 'v1',
          fingerprint: 'release-fingerprint-v1',
          skillIds: ['F01', 'F02', 'F03', 'S01', 'S03', 'S53'],
        },
      ])
      assert.ok(
        runnerInventory?.providerSupportedSkillPackRefs.codex?.includes(
          'phase6_inventory_pack',
        ),
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'claim snapshots installed, required, and skipped optional skill refs',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-skill-snapshot',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-skill-snapshot',
          skillsAvailable: [...orchestratorControlPlaneSkillRefs, 'skill-required'],
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-skill-snapshot-command-1',
        issueId: 'ISSUE-PHASE6-SKILL-SNAPSHOT-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-SKILL-SNAPSHOT-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const releaseId = await insertTestSkillPack(db, {
        packId: 'phase6_snapshot_pack',
        providers: ['codex'],
        skillRefs: ['skill-required'],
        optionalSkillRefs: ['skill-optional-missing'],
      })
      await replaceLeaseSkillPackRefs(db, {
        leaseId: lease.leaseId,
        releaseId,
        skillPackRefs: ['phase6_snapshot_pack'],
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-skill-snapshot',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(task)

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.ok(detail)
      assert.deepEqual(detail?.attempts[0]?.resolvedSkillRefs, ['skill-required'])
      assert.deepEqual(detail?.attempts[0]?.skippedOptionalSkillRefs, [
        'skill-optional-missing',
      ])
      assert.ok(detail?.attempts[0]?.installedSkillRefs.includes('skill-required'))
      assert.ok(detail?.attempts[0]?.installedSkillRefs.includes('F01'))
    } finally {
      await db.destroy()
    }
  },
)

test(
  'claim skips runners missing required skill refs',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-missing-skill',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-missing-skill',
          skillsAvailable: [...orchestratorControlPlaneSkillRefs],
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-skill-missing-command-1',
        issueId: 'ISSUE-PHASE6-SKILL-MISSING-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-SKILL-MISSING-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const releaseId = await insertTestSkillPack(db, {
        packId: 'phase6_missing_required_pack',
        providers: ['codex'],
        skillRefs: ['skill-required-missing'],
      })
      await replaceLeaseSkillPackRefs(db, {
        leaseId: lease.leaseId,
        releaseId,
        skillPackRefs: ['phase6_missing_required_pack'],
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-missing-skill',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.equal(task, null)

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.ok(detail)
      assert.equal(detail?.attempts[0]?.status, 'requested')
      assert.deepEqual(detail?.attempts[0]?.resolvedSkillRefs, [])
    } finally {
      await db.destroy()
    }
  },
)

test(
  'claim skips runners with stale release bundles even when top-level skills appear compatible',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-stale-release',
        manifest: {
          ...buildPhase6RunnerManifest({
            runnerNodeId: 'runner-phase6-stale-release',
            skillsAvailable: [...orchestratorControlPlaneSkillRefs, 'skill-required'],
          }),
          activeAgentLibraryReleaseId: 'v2',
          activeAgentLibraryFingerprint: 'release-fingerprint-v2',
          installedSkillBundles: [
            {
              releaseId: 'v2',
              fingerprint: 'release-fingerprint-v2',
              skillIds: [...orchestratorControlPlaneSkillRefs, 'skill-required'],
            },
          ],
        },
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-stale-release-command-1',
        issueId: 'ISSUE-PHASE6-STALE-RELEASE-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-STALE-RELEASE-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const releaseId = await insertTestSkillPack(db, {
        packId: 'phase6_stale_release_pack',
        providers: ['codex'],
        skillRefs: ['skill-required'],
      })
      await replaceLeaseSkillPackRefs(db, {
        leaseId: lease.leaseId,
        releaseId,
        skillPackRefs: ['phase6_stale_release_pack'],
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-stale-release',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.equal(task, null)

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.ok(detail)
      assert.equal(detail?.attempts[0]?.status, 'requested')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'provider fallback secondary claim is rejected when selected packs are provider-incompatible',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-incompatible-fallback-codex',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-incompatible-fallback-codex',
          providers: ['codex'],
          skillsAvailable: [...orchestratorControlPlaneSkillRefs, 'skill-required'],
        }),
      })
      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-incompatible-fallback-claude',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-incompatible-fallback-claude',
          providers: ['claude'],
          skillsAvailable: [...orchestratorControlPlaneSkillRefs, 'skill-required'],
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-incompatible-fallback-command-1',
        issueId: 'ISSUE-PHASE6-INCOMPATIBLE-FALLBACK-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-INCOMPATIBLE-FALLBACK-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const releaseId = await insertTestSkillPack(db, {
        packId: 'phase6_provider_locked_pack',
        providers: ['codex'],
        skillRefs: ['skill-required'],
      })
      await replaceLeaseSkillPackRefs(db, {
        leaseId: lease.leaseId,
        releaseId,
        skillPackRefs: ['phase6_provider_locked_pack'],
      })

      const firstTask = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-incompatible-fallback-codex',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(firstTask)

      const failure = await recordRunnerAttemptFailure(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-incompatible-fallback-codex',
        errorClass: 'quota_exhausted',
        errorMessage: 'primary provider quota exhausted',
        fallbackReason: 'quota_exhausted',
        checkpointRef: null,
        supportsCheckpointResume: false,
        executionMetadata: null,
      })

      assert.notEqual(failure.leaseAttemptId, lease.leaseAttemptId)

      const fallbackTask = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-incompatible-fallback-claude',
        heartbeatExpiryAt: new Date('2026-03-26T12:05:00.000Z'),
      })

      assert.equal(fallbackTask, null)

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.ok(detail)
      assert.deepEqual(
        detail?.attempts.map((attempt) => ({
          effectiveProvider: attempt.effectiveProvider,
          status: attempt.status,
        })),
        [
          {
            effectiveProvider: 'codex',
            status: 'abandoned_for_fallback',
          },
          {
            effectiveProvider: 'claude',
            status: 'requested',
          },
        ],
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'provider fallback opens a secondary-provider attempt before execution starts',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-fallback-codex',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-fallback-codex',
          providers: ['codex'],
        }),
      })
      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-fallback-claude',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-fallback-claude',
          providers: ['claude'],
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-fallback-command-1',
        issueId: 'ISSUE-PHASE6-FALLBACK-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-FALLBACK-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const firstTask = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-fallback-codex',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(firstTask)
      assert.equal(firstTask?.leaseAttemptId, lease.leaseAttemptId)

      const failure = await recordRunnerAttemptFailure(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-fallback-codex',
        errorClass: 'quota_exhausted',
        errorMessage: 'primary provider quota exhausted',
        fallbackReason: 'quota_exhausted',
        checkpointRef: null,
        supportsCheckpointResume: false,
        executionMetadata: null,
      })

      assert.equal(failure.leaseStatus, 'requested')
      assert.equal(failure.openedNextAttempt, true)
      assert.notEqual(failure.leaseAttemptId, lease.leaseAttemptId)

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.ok(detail)
      assert.deepEqual(
        detail?.attempts.map((attempt) => ({
          status: attempt.status,
          effectiveProvider: attempt.effectiveProvider,
          fallbackFromProvider: attempt.fallbackFromProvider,
          fallbackReason: attempt.fallbackReason,
        })),
        [
          {
            status: 'abandoned_for_fallback',
            effectiveProvider: 'codex',
            fallbackFromProvider: null,
            fallbackReason: null,
          },
          {
            status: 'requested',
            effectiveProvider: 'claude',
            fallbackFromProvider: 'codex',
            fallbackReason: 'quota_exhausted',
          },
        ],
      )

      const fallbackTask = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-fallback-claude',
        heartbeatExpiryAt: new Date('2026-03-26T12:05:00.000Z'),
      })

      assert.ok(fallbackTask)
      assert.equal(fallbackTask?.leaseAttemptId, failure.leaseAttemptId)
      assert.equal(fallbackTask?.effectiveProvider, 'claude')
      assert.equal(fallbackTask?.fallbackFromProvider, 'codex')
      assert.equal(fallbackTask?.fallbackReason, 'quota_exhausted')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'started attempts without a checkpoint do not auto-fail over across providers',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-no-checkpoint',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-no-checkpoint',
          providers: ['codex'],
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-no-checkpoint-command-1',
        issueId: 'ISSUE-PHASE6-NO-CHECKPOINT-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-NO-CHECKPOINT-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-no-checkpoint',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(task)

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-no-checkpoint',
        executionSessionKey: task!.executionSessionKey,
        mcpBindingsSummary: task!.mcpBindingsSummary,
        now: new Date('2026-03-26T11:59:00.000Z'),
      })

      const failure = await recordRunnerAttemptFailure(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-no-checkpoint',
        errorClass: 'quota_exhausted',
        errorMessage: 'quota exhausted after execution started',
        fallbackReason: 'quota_exhausted',
        checkpointRef: null,
        supportsCheckpointResume: false,
        executionMetadata: null,
      })

      assert.equal(failure.leaseStatus, 'provider_fallback_exhausted')
      assert.equal(failure.openedNextAttempt, false)
      assert.equal(failure.leaseAttemptId, lease.leaseAttemptId)

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.equal(detail?.lease.status, 'provider_fallback_exhausted')
      assert.equal(detail?.attempts.length, 1)
      assert.equal(detail?.attempts[0]?.status, 'failed')

      const outageCommand = await db
        .selectFrom('lifecycle_command_inbox')
        .select(['command_key', 'payload', 'created_at'])
        .where('issue_id', '=', 'ISSUE-PHASE6-NO-CHECKPOINT-1')
        .orderBy('created_at', 'desc')
        .executeTakeFirstOrThrow()

      assert.match(outageCommand.command_key, /^runner-provider-exhausted:/)
      assert.equal(outageCommand.payload.reasonCode, 'block_runner_outage')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'heartbeat recovery requeues pre-start attempts and expires started attempts after a grace period',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-recovery-prestart',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-recovery-prestart',
        }),
      })
      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-recovery-started',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-recovery-started',
        }),
      })

      const requeueLease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-recovery-requeue-command',
        issueId: 'ISSUE-PHASE6-RECOVERY-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-RECOVERY-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const startedLease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-recovery-started-command',
        issueId: 'ISSUE-PHASE6-RECOVERY-2',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-RECOVERY-2',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const requeueTask = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-recovery-prestart',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:45.000Z'),
      })
      const startedTask = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-recovery-started',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:45.000Z'),
      })

      assert.equal(requeueTask?.leaseId, requeueLease.leaseId)
      assert.equal(startedTask?.leaseId, startedLease.leaseId)

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: startedTask!.leaseAttemptId,
        runnerNodeId: 'runner-phase6-recovery-started',
        executionSessionKey: startedTask!.executionSessionKey,
        mcpBindingsSummary: startedTask!.mcpBindingsSummary,
        now: new Date('2026-03-26T12:00:00.000Z'),
      })

      const firstRecovery = await recoverStaleRunnerLeases(db, {
        now: new Date('2026-03-26T12:01:00.000Z'),
        heartbeatLostGraceMs: 30_000,
      })

      assert.equal(firstRecovery.requeuedLeaseIds.includes(requeueLease.leaseId), true)
      assert.equal(firstRecovery.heartbeatLostLeaseIds.includes(startedLease.leaseId), true)

      const requeuedLeaseRow = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', requeueLease.leaseId)
        .executeTakeFirstOrThrow()
      const requeuedAttempts = await db
        .selectFrom('runner_lease_attempts')
        .select(['provider_attempt_no', 'status'])
        .where('lease_id', '=', requeueLease.leaseId)
        .orderBy('provider_attempt_no', 'asc')
        .execute()

      assert.equal(requeuedLeaseRow.status, 'requested')
      assert.equal(requeuedLeaseRow.attempt_count, 2)
      assert.deepEqual(
        requeuedAttempts.map((attempt) => attempt.status),
        ['failed', 'requested'],
      )

      const heartbeatLostLeaseRow = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', startedLease.leaseId)
        .executeTakeFirstOrThrow()

      assert.equal(heartbeatLostLeaseRow.status, 'heartbeat_lost')

      const secondRecovery = await recoverStaleRunnerLeases(db, {
        now: new Date('2026-03-26T12:02:00.000Z'),
        heartbeatLostGraceMs: 30_000,
      })

      assert.equal(secondRecovery.expiredLeaseIds.includes(startedLease.leaseId), true)

      const expiredLeaseRow = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', startedLease.leaseId)
        .executeTakeFirstOrThrow()

      assert.equal(expiredLeaseRow.status, 'expired')
      assert.ok(expiredLeaseRow.failed_at)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'heartbeat recovery expires started attempts with checkpoints when the runner cannot resume checkpoints',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-recovery-no-resume',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-recovery-no-resume',
          supportsCheckpointResume: false,
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-recovery-no-resume-command',
        issueId: 'ISSUE-PHASE6-RECOVERY-NO-RESUME',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-RECOVERY-NO-RESUME',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: 'checkpoint-no-resume',
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-recovery-no-resume',
        heartbeatExpiryAt: new Date('2026-03-26T12:10:00.000Z'),
      })

      assert.ok(task)

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-recovery-no-resume',
        executionSessionKey: task!.executionSessionKey,
        mcpBindingsSummary: task!.mcpBindingsSummary,
        now: new Date('2026-03-26T12:09:00.000Z'),
      })

      const firstRecovery = await recoverStaleRunnerLeases(db, {
        now: new Date('2026-03-26T12:11:00.000Z'),
        heartbeatLostGraceMs: 30_000,
      })

      assert.equal(firstRecovery.requeuedLeaseIds.includes(lease.leaseId), false)
      assert.equal(firstRecovery.expiredLeaseIds.includes(lease.leaseId), false)
      assert.equal(firstRecovery.heartbeatLostLeaseIds.includes(lease.leaseId), true)

      const recovery = await recoverStaleRunnerLeases(db, {
        now: new Date('2026-03-26T12:12:00.000Z'),
        heartbeatLostGraceMs: 30_000,
      })

      assert.equal(recovery.requeuedLeaseIds.includes(lease.leaseId), false)
      assert.equal(recovery.expiredLeaseIds.includes(lease.leaseId), true)

      const leaseRow = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', lease.leaseId)
        .executeTakeFirstOrThrow()

      const attempts = await db
        .selectFrom('runner_lease_attempts')
        .select(['provider_attempt_no', 'status'])
        .where('lease_id', '=', lease.leaseId)
        .orderBy('provider_attempt_no', 'asc')
        .execute()

      assert.equal(leaseRow.status, 'expired')
      assert.equal(attempts.length, 1)
      assert.deepEqual(attempts.map((attempt) => attempt.status), ['failed'])
    } finally {
      await db.destroy()
    }
  },
)

test(
  'heartbeat recovery reopens started attempts with checkpoints when the runner supports checkpoint resume',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-recovery-resume',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-recovery-resume',
          supportsCheckpointResume: true,
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-recovery-resume-command',
        issueId: 'ISSUE-PHASE6-RECOVERY-RESUME',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-RECOVERY-RESUME',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: 'checkpoint-resume',
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-recovery-resume',
        heartbeatExpiryAt: new Date('2026-03-26T12:20:00.000Z'),
      })

      assert.ok(task)

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-recovery-resume',
        executionSessionKey: task!.executionSessionKey,
        mcpBindingsSummary: task!.mcpBindingsSummary,
        now: new Date('2026-03-26T12:19:00.000Z'),
      })

      const firstRecovery = await recoverStaleRunnerLeases(db, {
        now: new Date('2026-03-26T12:21:00.000Z'),
        heartbeatLostGraceMs: 30_000,
      })

      assert.equal(firstRecovery.requeuedLeaseIds.includes(lease.leaseId), false)
      assert.equal(firstRecovery.expiredLeaseIds.includes(lease.leaseId), false)
      assert.equal(firstRecovery.heartbeatLostLeaseIds.includes(lease.leaseId), true)

      const recovery = await recoverStaleRunnerLeases(db, {
        now: new Date('2026-03-26T12:22:00.000Z'),
        heartbeatLostGraceMs: 30_000,
      })

      assert.equal(recovery.requeuedLeaseIds.includes(lease.leaseId), true)
      assert.equal(recovery.expiredLeaseIds.includes(lease.leaseId), false)

      const leaseRow = await db
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', lease.leaseId)
        .executeTakeFirstOrThrow()
      const attempts = await db
        .selectFrom('runner_lease_attempts')
        .select(['provider_attempt_no', 'status', 'checkpoint_ref'])
        .where('lease_id', '=', lease.leaseId)
        .orderBy('provider_attempt_no', 'asc')
        .execute()

      assert.equal(leaseRow.status, 'requested')
      assert.equal(leaseRow.attempt_count, 2)
      assert.deepEqual(
        attempts.map((attempt) => ({
          status: attempt.status,
          checkpointRef: attempt.checkpoint_ref,
        })),
        [
          {
            status: 'failed',
            checkpointRef: 'checkpoint-resume',
          },
          {
            status: 'requested',
            checkpointRef: 'checkpoint-resume',
          },
        ],
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'duplicate execution-start and completion deliveries stay idempotent for terminal runner results',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-idempotent',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-idempotent',
        }),
      })

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-idempotent-command-1',
        issueId: 'ISSUE-PHASE6-IDEMPOTENT-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-IDEMPOTENT-1',
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {
          requestedStatusCode: 'agent_review',
        },
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-idempotent',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(task)

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-idempotent',
        executionSessionKey: task!.executionSessionKey,
        mcpBindingsSummary: task!.mcpBindingsSummary,
      })
      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-idempotent',
        executionSessionKey: task!.executionSessionKey,
        mcpBindingsSummary: task!.mcpBindingsSummary,
      })
      const executionBundle = await getRunnerExecutionBundle(
        db,
        lease.leaseAttemptId,
      )

      const firstCompletion = await recordRunnerAttemptCompletion(db, {
        runnerNodeId: 'runner-phase6-idempotent',
        artifactBundle: {
          schemaVersion: 2,
          leaseId: lease.leaseId,
          leaseAttemptId: lease.leaseAttemptId,
          issueId: 'ISSUE-PHASE6-IDEMPOTENT-1',
          runId: null,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          roleExecutionPolicyVersion: 1,
          agentRole: 'orchestrator',
          status: 'completed',
          summary: 'completed once',
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
        },
        executionMetadata: {
          schemaVersion: 2,
          agentRole: 'orchestrator',
          promptVersion: task!.promptVersion!,
          agentLibraryReleaseId: task!.agentLibraryReleaseId,
          taskInstructionsRef: task!.taskInstructionsRef,
          roleCharterRef: task!.roleCharterRef,
          promptBundleFingerprint: executionBundle.promptBundleFingerprint,
          resolvedPromptFamilyRefs: executionBundle.resolvedPromptFamilyRefs,
          skillPackRefs: task!.skillPackRefs,
          resolvedSkillRefs: executionBundle.resolvedSkillRefs,
          skippedOptionalSkillRefs: executionBundle.skippedOptionalSkillRefs,
          effectiveSkillFingerprint: task!.effectiveSkillFingerprint,
          contextPackFingerprint: task!.contextPackFingerprint,
          configVersion: 1,
          workflowId: 'issue:ISSUE-PHASE6-IDEMPOTENT-1',
          workflowRunId: null,
          runKind: 'build',
          attemptNo: 1,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          toolsUsed: ['codex'],
          mcpBindings: task!.mcpBindingsSummary,
          runnerNodeId: 'runner-phase6-idempotent',
          hostGroupId: phase6HostGroupId,
          executionDurationMs: 10,
          completionReason: 'completed',
        },
      })

      const duplicateCompletion = await recordRunnerAttemptCompletion(db, {
        runnerNodeId: 'runner-phase6-idempotent',
        artifactBundle: {
          schemaVersion: 2,
          leaseId: lease.leaseId,
          leaseAttemptId: lease.leaseAttemptId,
          issueId: 'ISSUE-PHASE6-IDEMPOTENT-1',
          runId: null,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          roleExecutionPolicyVersion: 1,
          agentRole: 'orchestrator',
          status: 'completed',
          summary: 'completed once',
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
        },
        executionMetadata: {
          schemaVersion: 2,
          agentRole: 'orchestrator',
          promptVersion: task!.promptVersion!,
          agentLibraryReleaseId: task!.agentLibraryReleaseId,
          taskInstructionsRef: task!.taskInstructionsRef,
          roleCharterRef: task!.roleCharterRef,
          promptBundleFingerprint: executionBundle.promptBundleFingerprint,
          resolvedPromptFamilyRefs: executionBundle.resolvedPromptFamilyRefs,
          skillPackRefs: task!.skillPackRefs,
          resolvedSkillRefs: executionBundle.resolvedSkillRefs,
          skippedOptionalSkillRefs: executionBundle.skippedOptionalSkillRefs,
          effectiveSkillFingerprint: task!.effectiveSkillFingerprint,
          contextPackFingerprint: task!.contextPackFingerprint,
          configVersion: 1,
          workflowId: 'issue:ISSUE-PHASE6-IDEMPOTENT-1',
          workflowRunId: null,
          runKind: 'build',
          attemptNo: 1,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          toolsUsed: ['codex'],
          mcpBindings: task!.mcpBindingsSummary,
          runnerNodeId: 'runner-phase6-idempotent',
          hostGroupId: phase6HostGroupId,
          executionDurationMs: 10,
          completionReason: 'completed',
        },
      })

      assert.equal(firstCompletion.resultArtifactId, duplicateCompletion.resultArtifactId)

      const artifactCounts = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type'])
        .where('issue_id', '=', 'ISSUE-PHASE6-IDEMPOTENT-1')
        .execute()

      assert.equal(
        artifactCounts.filter((artifact) => artifact.artifact_type === 'runner_artifact_bundle').length,
        1,
      )
      assert.equal(
        artifactCounts.filter((artifact) => artifact.artifact_type === 'agent_execution_metadata').length,
        1,
      )

      const executionMetadataArtifact = await db
        .selectFrom('artifact_registry')
        .select(['produced_for_status_code'])
        .where('issue_id', '=', 'ISSUE-PHASE6-IDEMPOTENT-1')
        .where('artifact_type', '=', 'agent_execution_metadata')
        .executeTakeFirstOrThrow()

      assert.equal(executionMetadataArtifact.produced_for_status_code, 'agent_review')

      const detail = await getRunnerLeaseDetailView(db, lease.leaseId)
      assert.equal(detail?.lease.status, 'completed')
      assert.equal(detail?.attempts[0]?.status, 'completed')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'completion accepts a null runner payload run id when the lease run id is backfilled after claim',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await upsertRunnerCapabilityManifest(db, {
        authSubject: 'runner/phase6-runid-backfill',
        manifest: buildPhase6RunnerManifest({
          runnerNodeId: 'runner-phase6-runid-backfill',
        }),
      })

      const issueId = 'ISSUE-PHASE6-RUNID-BACKFILL-1'
      const workflowId = `issue:${issueId}`
      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-runid-backfill-command-1',
        issueId,
        runId: null,
        workflowId,
        configVersion: 1,
        requestedOwnerRole: 'orchestrator',
        requestedRunKind: 'build',
        runnerRequirementProfile: {},
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const task = await claimNextRunnerTask(db, {
        runnerNodeId: 'runner-phase6-runid-backfill',
        heartbeatExpiryAt: new Date('2026-03-26T12:00:00.000Z'),
      })

      assert.ok(task)
      assert.equal(task?.runId, null)

      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: lease.leaseAttemptId,
        runnerNodeId: 'runner-phase6-runid-backfill',
        executionSessionKey: task!.executionSessionKey,
        mcpBindingsSummary: task!.mcpBindingsSummary,
      })

      const audit = await db
        .insertInto('status_transition_audit')
        .values({
          issue_id: issueId,
          run_id: null,
          workflow_id: workflowId,
          config_version: 1,
          from_status_code: 'ready_for_build',
          to_status_code: 'in_progress',
          trigger_code: 'system_contract_built',
          rule_id: null,
          actor_type: 'system',
          actor_id: 'phase6-runid-backfill-test',
          owner_role: 'orchestrator',
          reason_code: null,
          reason_text: null,
          comment_id: null,
          artifact_links: toJsonInsert([]),
          checkpoint_id: null,
          lease_id: lease.leaseId,
          metadata: toJsonInsert({}),
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      const runId = '11111111-1111-4111-8111-111111111111'

      await db
        .insertInto('issue_runs')
        .values({
          id: runId,
          issue_id: issueId,
          workflow_id: workflowId,
          sequence_no: 1,
          run_kind: 'build',
          status: 'open',
          config_version: 1,
          opened_by_transition_id: audit.id,
          closed_by_transition_id: null,
          branch_ref: null,
          runner_requirements: toJsonInsert({}),
          checkpoint_id: null,
          closed_at: null,
        })
        .execute()

      await db
        .updateTable('runner_leases')
        .set({
          run_id: runId,
          updated_at: new Date('2026-03-26T12:00:10.000Z'),
        })
        .where('lease_id', '=', lease.leaseId)
        .execute()
      const executionBundle = await getRunnerExecutionBundle(
        db,
        lease.leaseAttemptId,
      )

      const completion = await recordRunnerAttemptCompletion(db, {
        runnerNodeId: 'runner-phase6-runid-backfill',
        artifactBundle: {
          schemaVersion: 2,
          leaseId: lease.leaseId,
          leaseAttemptId: lease.leaseAttemptId,
          issueId,
          runId: null,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          roleExecutionPolicyVersion: 1,
          agentRole: 'orchestrator',
          status: 'completed',
          summary: 'completed after run-id backfill',
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
        },
        executionMetadata: {
          schemaVersion: 2,
          agentRole: 'orchestrator',
          promptVersion: task!.promptVersion!,
          agentLibraryReleaseId: task!.agentLibraryReleaseId,
          taskInstructionsRef: task!.taskInstructionsRef,
          roleCharterRef: task!.roleCharterRef,
          promptBundleFingerprint: executionBundle.promptBundleFingerprint,
          resolvedPromptFamilyRefs: executionBundle.resolvedPromptFamilyRefs,
          skillPackRefs: task!.skillPackRefs,
          resolvedSkillRefs: executionBundle.resolvedSkillRefs,
          skippedOptionalSkillRefs: executionBundle.skippedOptionalSkillRefs,
          effectiveSkillFingerprint: task!.effectiveSkillFingerprint,
          contextPackFingerprint: task!.contextPackFingerprint,
          configVersion: 1,
          workflowId,
          workflowRunId: null,
          runKind: 'build',
          attemptNo: 1,
          requestedProvider: 'codex',
          effectiveProvider: 'codex',
          providerAttemptNo: 1,
          fallbackFromProvider: null,
          fallbackReason: null,
          toolsUsed: ['codex'],
          mcpBindings: task!.mcpBindingsSummary,
          runnerNodeId: 'runner-phase6-runid-backfill',
          hostGroupId: phase6HostGroupId,
          executionDurationMs: 15,
          completionReason: 'completed',
        },
      })

      assert.ok(completion.resultArtifactId)

      const artifactRow = await db
        .selectFrom('artifact_registry')
        .select(['run_id', 'artifact_type'])
        .where('id', '=', completion.resultArtifactId!)
        .executeTakeFirstOrThrow()

      assert.equal(artifactRow.artifact_type, 'runner_artifact_bundle')
      assert.equal(artifactRow.run_id, runId)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'createRunnerLeaseFromCommand preserves explicit lease intent metadata without agent_review special-case normalization',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'phase6-runner-fabric-test',
      })

      await db
        .insertInto('issue_runtime_state')
        .values({
          issue_id: 'ISSUE-PHASE6-REVIEW-NORMALIZATION-1',
          workflow_id: 'issue:ISSUE-PHASE6-REVIEW-NORMALIZATION-1',
          current_status_code: 'agent_review',
          current_stage: 'agent_review',
          active_run_id: null,
          pinned_config_version: 1,
          open_operator_question_id: null,
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

      const lease = await createRunnerLeaseFromCommand(db, {
        commandKey: 'phase6-review-normalization-command-1',
        issueId: 'ISSUE-PHASE6-REVIEW-NORMALIZATION-1',
        runId: null,
        workflowId: 'issue:ISSUE-PHASE6-REVIEW-NORMALIZATION-1',
        configVersion: 1,
        requestedOwnerRole: 'build_agent',
        requestedRunKind: null,
        runnerRequirementProfile: {
          requestedOwnerRole: 'plan_agent',
        },
        contextPackFingerprint: null,
        checkpointId: null,
      })

      const leaseRow = await db
        .selectFrom('runner_leases')
        .select([
          'requested_provider',
          'requested_owner_role',
          'requested_run_kind',
          'runner_requirement_profile_json',
        ])
        .where('lease_id', '=', lease.leaseId)
        .executeTakeFirstOrThrow()

      assert.equal(leaseRow.requested_provider, 'codex')
      assert.equal(leaseRow.requested_owner_role, 'build_agent')
      assert.equal(leaseRow.requested_run_kind, null)
      assert.equal(
        (
          leaseRow.runner_requirement_profile_json as {
            requestedStatusCode?: string
          }
        ).requestedStatusCode,
        undefined,
      )
      assert.equal(
        (
          leaseRow.runner_requirement_profile_json as {
            requestedOwnerRole?: string
            requestedRunKind?: string
          }
        ).requestedOwnerRole,
        'build_agent',
      )
      assert.equal(
        (
          leaseRow.runner_requirement_profile_json as {
            requestedOwnerRole?: string
            requestedRunKind?: string
          }
        ).requestedRunKind,
        null,
      )
    } finally {
      await db.destroy()
    }
  },
)
