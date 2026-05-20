import { createHash } from 'node:crypto'

import {
  acknowledgeRunnerLeaseCancellation,
  buildAgentLibraryFingerprints,
  claimNextRunnerTask,
  getActiveAgentLibraryReleaseSummary,
  getRunnerExecutionBundle,
  getProviderFailoverMetricsView,
  getRunnerLeaseDetailView,
  listRunnerMcpPoolSnapshotsView,
  listActiveRunnerLeasesView,
  loadAgentLibraryBundle,
  listRunnerInventoryView,
  listStaleRunnerLeasesView,
  recordRunnerAttemptCompletion,
  recordRunnerAttemptFailure,
  recordRunnerExecutionStarted,
  recordRunnerHeartbeat,
  requestRunnerLeaseCancellation,
  stageRunnerArtifactBlob,
  upsertRunnerCapabilityManifest,
  RunnerExecutionBundleError,
  type DbClient,
} from '@ai-dev-team/db'
import type {
  ProviderFailoverMetricsView,
  RunnerArtifactResourceV1,
  RunnerArtifactStageRequestV1,
  RunnerArtifactStageResponseV1,
  RunnerAttemptCancelRequestV1,
  RunnerAttemptCancelResponseV1,
  RunnerAttemptCompletionRequestV1,
  RunnerContextPackResourceV1,
  RunnerAttemptFailureRequestV1,
  RunnerCapabilityManifestV1,
  RunnerExecutionStartedRequestV1,
  RunnerHeartbeatResponseV1,
  RunnerInventoryView,
  RunnerLeaseDetailView,
  RunnerLeaseClaimRequestV1,
  RunnerLeaseClaimResponseV1,
  RunnerLeaseStatus,
  RunnerMcpPoolSnapshotView,
  RunnerLeaseView,
  RunnerManifestUpsertRequestV1,
  RunnerManifestUpsertResponseV1,
  RunnerExecutionBundleV1,
  RunnerManagedSkillPayloadV1,
  RunnerManagedSkillSummaryV1,
  SharedJsonObject,
} from '@ai-dev-team/shared'

export interface RunnerHeartbeatRequestV1 {
  schemaVersion: 1
  runnerNodeId: string
  leaseAttemptId: string
  heartbeatExpiryAt: string
  mcpPoolSnapshot?: SharedJsonObject | null
}

export interface RunnerReadRepository {
  listRunnerInventory(): Promise<RunnerInventoryView[]>
  listActiveLeases(): Promise<RunnerLeaseView[]>
  listStaleLeases(): Promise<RunnerLeaseView[]>
  listMcpPoolSnapshots(): Promise<RunnerMcpPoolSnapshotView[]>
  getLeaseDetail(leaseId: string): Promise<RunnerLeaseDetailView | null>
  getProviderFailoverMetrics(): Promise<ProviderFailoverMetricsView>
}

export interface RunnerWriteRepository {
  upsertManifest(input: {
    request: RunnerManifestUpsertRequestV1
    authSubject: string
  }): Promise<RunnerManifestUpsertResponseV1>
  claimNextTask(
    input: RunnerLeaseClaimRequestV1,
  ): Promise<RunnerLeaseClaimResponseV1>
  markExecutionStarted(input: RunnerExecutionStartedRequestV1): Promise<void>
  heartbeat(
    input: RunnerHeartbeatRequestV1,
  ): Promise<RunnerHeartbeatResponseV1>
  stageArtifact(
    input: RunnerArtifactStageRequestV1,
  ): Promise<RunnerArtifactStageResponseV1>
  completeAttempt(input: RunnerAttemptCompletionRequestV1): Promise<void>
  getContextPackResource(
    contextPackId: string,
  ): Promise<RunnerContextPackResourceV1 | null>
  getArtifactResource(
    artifactId: string,
  ): Promise<RunnerArtifactResourceV1 | null>
  getExecutionBundle(
    leaseAttemptId: string,
  ): Promise<RunnerExecutionBundleV1>
  getActiveSkillReleaseSummary(): Promise<RunnerManagedSkillSummaryV1>
  getSkillReleasePayload(
    releaseId: string,
  ): Promise<RunnerManagedSkillPayloadV1 | null>
  failAttempt(input: RunnerAttemptFailureRequestV1): Promise<void>
  acknowledgeCancellation(
    input: RunnerAttemptCancelRequestV1,
  ): Promise<RunnerAttemptCancelResponseV1>
  requestLeaseCancellation(input: {
    leaseId: string
    reasonCode: string | null
    reasonText: string | null
  }): Promise<{
    leaseStatus: RunnerLeaseStatus
    leaseAttemptId: string | null
  }>
}

export function createRunnerReadRepository({
  db,
}: {
  db: DbClient
}): RunnerReadRepository {
  return {
    listRunnerInventory: () => listRunnerInventoryView(db),
    listActiveLeases: () => listActiveRunnerLeasesView(db),
    listStaleLeases: () => listStaleRunnerLeasesView(db),
    listMcpPoolSnapshots: () => listRunnerMcpPoolSnapshotsView(db),
    getLeaseDetail: (leaseId) => getRunnerLeaseDetailView(db, leaseId),
    getProviderFailoverMetrics: () => getProviderFailoverMetricsView(db),
  }
}

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function resolveRuntimeManagedSkills(
  releaseId: string,
) {
  return loadAgentLibraryBundle({
    source: 'release',
    releaseId,
  }).then((bundle) => {
    const fingerprints =
      bundle.releaseManifest?.fingerprints ??
      buildAgentLibraryFingerprints(bundle)
    const runtimeSkills = bundle.skills
      .filter(
        (skill) =>
          skill.meta.runtimeDependency && skill.meta.downloadRef === null,
      )
      .sort((left, right) => left.meta.id.localeCompare(right.meta.id))

    return {
      bundle,
      fingerprints,
      runtimeSkills,
    }
  })
}

export function createRunnerWriteRepository({
  db,
}: {
  db: DbClient
}): RunnerWriteRepository {
  return {
    upsertManifest: async ({ request, authSubject }) => {
      await upsertRunnerCapabilityManifest(db, {
        manifest: request.manifest as RunnerCapabilityManifestV1,
        authSubject,
      })

      return {
        schemaVersion: 1,
        accepted: true,
      }
    },
    claimNextTask: async (input) => ({
      schemaVersion: 1,
      task: await claimNextRunnerTask(db, {
        runnerNodeId: input.runnerNodeId,
        heartbeatExpiryAt: new Date(input.heartbeatExpiryAt),
      }),
    }),
    markExecutionStarted: async (input) => {
      await recordRunnerExecutionStarted(db, {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
        executionSessionKey: input.executionSessionKey,
        mcpBindingsSummary: input.mcpBindingsSummary,
      })
    },
    heartbeat: (input) =>
      recordRunnerHeartbeat(db, {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
        heartbeatExpiryAt: new Date(input.heartbeatExpiryAt),
        mcpPoolSnapshot: input.mcpPoolSnapshot ?? null,
      }),
    stageArtifact: async (input) => {
      const result = await stageRunnerArtifactBlob(db, {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
        artifactKey: input.artifactKey,
        contentType: input.contentType,
        contentBase64: input.contentBase64,
        metadata: input.metadata,
      })

      return {
        schemaVersion: 1,
        artifactId: result.artifactId,
        artifactUri: result.artifactUri,
        contentSha256: result.contentSha256,
        sizeBytes: result.sizeBytes,
      }
    },
    completeAttempt: async (input) => {
      await recordRunnerAttemptCompletion(db, {
        runnerNodeId: input.runnerNodeId,
        artifactBundle: input.artifactBundle,
        executionMetadata: input.executionMetadata,
      })
    },
    getContextPackResource: async (contextPackId) => {
      const row = await db
        .selectFrom('context_pack_cache')
        .selectAll()
        .where('id', '=', contextPackId)
        .where('superseded_at', 'is', null)
        .executeTakeFirst()

      if (!row) {
        return null
      }

      return {
        schemaVersion: 1,
        contextPackId: row.id,
        issueId: row.issue_id,
        inputFingerprint: row.input_fingerprint,
        bundle: row.bundle_json,
        createdAt: row.created_at.toISOString(),
      }
    },
    getArtifactResource: async (artifactId) => {
      const row = await db
        .selectFrom('artifact_registry')
        .selectAll()
        .where('id', '=', artifactId)
        .executeTakeFirst()

      if (!row) {
        return null
      }

      return {
        schemaVersion: 1,
        artifactId: row.id,
        issueId: row.issue_id,
        runId: row.run_id,
        artifactType: row.artifact_type,
        artifactUri: row.artifact_uri,
        artifactSummary: row.artifact_summary,
        metadata: row.metadata,
        producedAt: row.produced_at.toISOString(),
        supersededAt: row.superseded_at?.toISOString() ?? null,
      }
    },
    getExecutionBundle: async (leaseAttemptId) => {
      try {
        return await getRunnerExecutionBundle(db, leaseAttemptId)
      } catch (error) {
        if (error instanceof RunnerExecutionBundleError) {
          throw error
        }

        throw error
      }
    },
    getActiveSkillReleaseSummary: async () => {
      const activeRelease = await getActiveAgentLibraryReleaseSummary(db)

      if (!activeRelease) {
        return {
          schemaVersion: 1,
          releaseId: null,
          releaseFingerprint: null,
          publishedAt: null,
          skills: [],
        }
      }

      const { fingerprints, runtimeSkills } = await resolveRuntimeManagedSkills(
        activeRelease.releaseId,
      )

      return {
        schemaVersion: 1,
        releaseId: activeRelease.releaseId,
        releaseFingerprint: activeRelease.libraryFingerprint,
        publishedAt: activeRelease.publishedAt,
        skills: runtimeSkills.map((skill) => ({
          skillId: skill.meta.id,
          fingerprint: fingerprints.skillFingerprints[skill.meta.id] ?? '',
          providerCompatibility: skill.meta.providerCompatibility,
        })),
      }
    },
    getSkillReleasePayload: async (releaseId) => {
      const activeRelease = await getActiveAgentLibraryReleaseSummary(db)

      if (!activeRelease || activeRelease.releaseId !== releaseId) {
        return null
      }

      const { fingerprints, runtimeSkills } =
        await resolveRuntimeManagedSkills(releaseId)

      return {
        schemaVersion: 1,
        releaseId,
        releaseFingerprint: activeRelease.libraryFingerprint,
        publishedAt: activeRelease.publishedAt,
        skillCount: runtimeSkills.length,
        skills: runtimeSkills.map((skill) => {
          const metaJson = `${JSON.stringify(skill.meta, null, 2)}\n`
          const skillMarkdown = `${skill.body.trim()}\n`

          return {
            skillId: skill.meta.id,
            fingerprint: fingerprints.skillFingerprints[skill.meta.id] ?? '',
            relativePath: skill.relativePath,
            metaJson,
            metaSha256: hashSha256(metaJson),
            skillMarkdown,
            skillMarkdownSha256: hashSha256(skillMarkdown),
            providerCompatibility: skill.meta.providerCompatibility,
          }
        }),
      }
    },
    failAttempt: async (input) => {
      await recordRunnerAttemptFailure(db, {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
        errorClass: input.errorClass,
        errorMessage: input.errorMessage,
        fallbackReason: input.fallbackReason,
        checkpointRef: input.checkpointRef,
        supportsCheckpointResume: input.supportsCheckpointResume,
        executionMetadata: input.executionMetadata,
      })
    },
    acknowledgeCancellation: async (input) => {
      const result = await acknowledgeRunnerLeaseCancellation(db, {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
        outcome: input.outcome,
        checkpointRef: input.checkpointRef,
      })

      return {
        schemaVersion: 1,
        leaseStatus: result.leaseStatus,
        cancelOutcome: result.cancelOutcome,
      }
    },
    requestLeaseCancellation: (input) =>
      requestRunnerLeaseCancellation(db, input),
  }
}
