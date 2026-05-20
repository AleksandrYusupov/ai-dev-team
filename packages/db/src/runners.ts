import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { sql, type Kysely, type Selectable } from 'kysely'

import type {
  AgentExecutionMetadataV2,
  AgentProvider,
  ArtifactBundleV2,
  AuthScheme,
  IntegrationAgentCapabilityManifest,
  IssueContract,
  LifecycleCommandEnvelopeV1,
  McpBindingRefV1,
  McpProcessStateV1,
  McpSharingScope,
  RunnerCancelOutcome,
  ProviderFailureClass,
  ProviderFailoverMetricsView,
  ProviderFallbackReason,
  RoleExecutionPolicyV1,
  RunnerCapabilityManifestV1,
  RunnerExecutionBundlePromptFamilyV1,
  RunnerExecutionBundleRoleCharterV1,
  RunnerExecutionBundleSkillPackV1,
  RunnerExecutionBundleSystemInstructionV1,
  RunnerExecutionBundleV1,
  RunnerInstalledSkillBundleV1,
  RunnerInventoryView,
  RunnerLeaseAttemptStatus,
  RunnerLeaseAttemptView,
  RunnerLeaseStatus,
  RunnerLeaseView,
  RunnerHeartbeatResponseV1,
  RunnerSkillSyncStatus,
  OutboxCommandEnvelopeV1,
  PromptResolutionSource,
  ReviewDisposition,
  RuntimeRoleContractV1,
  SharedJsonObject,
  TaskEnvelopeV2,
} from '@ai-dev-team/shared'

import type { Database, JsonObject } from './schema.js'
import {
  ensureIssueLinearSyncProjectionRepos,
  upsertIssueLinearSyncProjection,
} from './ingress.js'
import {
  buildAgentExecutionMetadataArtifact,
  upsertLifecycleCommand,
} from './lifecycle.js'
import {
  resolveAgentConfigFolder,
  resolveAgentReleaseFolder,
} from './agent-config/manifest-loader.js'

const DEFAULT_INTEGRATION_CAPABILITIES: IntegrationAgentCapabilityManifest = {
  networkModesSupported: ['docs_allowlist', 'sandbox_api_allowlist'],
  allowedDocDomains: [],
  allowedSandboxDomains: [],
  supportsBrowserConsent: false,
  supportsSecretBroker: false,
  supportsOAuthBroker: false,
  supportsIntegrationLab: false,
}

const REQUIRED_INTEGRATION_MCP_SERVERS = {
  secretBroker: 'secret-broker-mcp',
  oauthBroker: 'oauth-broker-mcp',
  integrationLab: 'integration-lab-mcp',
} as const

const ACTIVE_LEASE_STATUSES = [
  'requested',
  'acquired',
  'execution_started',
  'heartbeat_lost',
  'expired',
  'cancellation_requested',
] satisfies RunnerLeaseStatus[]

const ACTIVE_ATTEMPT_STATUSES = [
  'requested',
  'acquired',
  'execution_started',
] satisfies RunnerLeaseAttemptStatus[]

const PRIMARY_BUILD_EXECUTION_ROLES = [
  'build_agent',
  'build_agent_backend',
  'build_agent_integrations',
] as const

interface ResolvedAgentLibraryLeaseTruth {
  agentLibraryReleaseId: string
  agentLibraryFingerprint: string
  roleCharterRef: string
  promptVersion: string
  taskInstructionsRef: string
  promptBundleFingerprint: string
  skillPackRefs: string[]
  resolvedPromptFamilyRefs: string[]
  effectiveSkillFingerprint: string
  promptResolutionSource: PromptResolutionSource
}

export class RunnerExecutionBundleError extends Error {
  readonly code: string
  readonly statusCode: number

  constructor(message: string, options: { code: string; statusCode: number }) {
    super(message)
    this.name = 'RunnerExecutionBundleError'
    this.code = options.code
    this.statusCode = options.statusCode
  }
}

type InventorySkillPackRow = Pick<
  Selectable<Database['agent_skill_packs']>,
  'pack_id' | 'providers' | 'skill_refs'
>

type ClaimSkillPackRow = Pick<
  Selectable<Database['agent_skill_packs']>,
  'pack_id' | 'providers' | 'skill_refs' | 'optional_skill_refs'
>

function buildLegacyTaskInstructionsRef(
  issueId: string,
  runId: string | null,
): string {
  return `runner-requirements:${issueId}:${runId ?? 'issue'}`
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function normalizeUniqueStringArray(value: unknown): string[] {
  return [...new Set(normalizeStringArray(value))].sort((left, right) =>
    left.localeCompare(right),
  )
}

function normalizeOrderedUniqueStringArray(value: unknown): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const entry of normalizeStringArray(value)) {
    if (seen.has(entry)) {
      continue
    }

    seen.add(entry)
    result.push(entry)
  }

  return result
}

function normalizeRunnerSkillSyncStatus(
  value: unknown,
): RunnerSkillSyncStatus {
  return value === 'ready' ? 'ready' : 'degraded'
}

function normalizeInstalledSkillBundles(
  value: unknown,
): RunnerInstalledSkillBundleV1[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .flatMap((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as { releaseId?: unknown }).releaseId !== 'string' ||
        typeof (entry as { fingerprint?: unknown }).fingerprint !== 'string'
      ) {
        return []
      }

      return [
        {
          releaseId: (entry as { releaseId: string }).releaseId,
          fingerprint: (entry as { fingerprint: string }).fingerprint,
          skillIds: normalizeUniqueStringArray(
            (entry as { skillIds?: unknown }).skillIds,
          ),
        },
      ]
    })
    .sort((left, right) => left.releaseId.localeCompare(right.releaseId))
}

function findInstalledSkillBundle(
  bundles: RunnerInstalledSkillBundleV1[],
  releaseId: string,
): RunnerInstalledSkillBundleV1 | null {
  return bundles.find((bundle) => bundle.releaseId === releaseId) ?? null
}

function canRunnerSupportSkillPack(
  provider: AgentProvider,
  installedSkillSet: ReadonlySet<string>,
  pack: InventorySkillPackRow,
): boolean {
  return (
    pack.providers.includes(provider) &&
    normalizeStringArray(pack.skill_refs).every((skillRef) =>
      installedSkillSet.has(skillRef),
    )
  )
}

function computeClaimSkillSnapshot(input: {
  effectiveProvider: AgentProvider
  installedSkillRefs: string[]
  skillPackRefs: string[]
  packRows: ClaimSkillPackRow[]
}): {
  resolvedSkillRefs: string[]
  skippedOptionalSkillRefs: string[]
} | null {
  if (input.skillPackRefs.length === 0) {
    return {
      resolvedSkillRefs: [],
      skippedOptionalSkillRefs: [],
    }
  }

  const packById = new Map(input.packRows.map((row) => [row.pack_id, row]))

  if (input.skillPackRefs.some((packRef) => !packById.has(packRef))) {
    return null
  }

  const installedSkillSet = new Set(input.installedSkillRefs)
  const resolvedSkillRefs = new Set<string>()
  const skippedOptionalSkillRefs = new Set<string>()

  for (const packRef of input.skillPackRefs) {
    const pack = packById.get(packRef)

    if (!pack || !pack.providers.includes(input.effectiveProvider)) {
      return null
    }

    for (const skillRef of normalizeStringArray(pack.skill_refs)) {
      if (!installedSkillSet.has(skillRef)) {
        return null
      }

      resolvedSkillRefs.add(skillRef)
    }

    for (const optionalSkillRef of normalizeStringArray(pack.optional_skill_refs)) {
      if (!installedSkillSet.has(optionalSkillRef)) {
        skippedOptionalSkillRefs.add(optionalSkillRef)
      }
    }
  }

  return {
    resolvedSkillRefs: [...resolvedSkillRefs].sort((left, right) =>
      left.localeCompare(right),
    ),
    skippedOptionalSkillRefs: [...skippedOptionalSkillRefs].sort((left, right) =>
      left.localeCompare(right),
    ),
  }
}

function hashSortedValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeJsonValue(value)))
    .digest('hex')
}

function resolveContractTaskTypes(
  contract: IssueContract | null | undefined,
): string[] {
  const taskTypes = new Set<string>()

  if (typeof contract?.issueType === 'string' && contract.issueType.trim().length > 0) {
    taskTypes.add(contract.issueType)
  }

  if (typeof contract?.mode === 'string' && contract.mode.trim().length > 0) {
    taskTypes.add(contract.mode)
  }

  return [...taskTypes].sort((left, right) => left.localeCompare(right))
}

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function toJsonb<T>(value: T) {
  return sql<T>`${JSON.stringify(value)}::jsonb`
}

function buildExecutionSessionKey(leaseId: string, providerAttemptNo: number): string {
  return `${leaseId}:attempt:${providerAttemptNo.toString()}`
}

function buildRunnerArtifactBlobDigest(contentBase64: string): string {
  return createHash('sha256').update(contentBase64).digest('hex')
}

function buildRunnerArtifactBlobUri(artifactBlobId: string): string {
  return `artifact://blob/${artifactBlobId}`
}

function isLeaseTerminal(status: RunnerLeaseStatus): boolean {
  const terminalStatuses: RunnerLeaseStatus[] = [
    'completed',
    'failed',
    'released',
    'provider_fallback_exhausted',
  ]

  return terminalStatuses.includes(status)
}

function isAttemptTerminal(status: RunnerLeaseAttemptStatus): boolean {
  const terminalStatuses: RunnerLeaseAttemptStatus[] = [
    'failed',
    'completed',
    'released',
    'abandoned_for_fallback',
  ]

  return terminalStatuses.includes(status)
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry))
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJsonValue(entry)]),
    )
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKeywordMatch(value: unknown, keywords: readonly string[]): boolean {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    return keywords.some((keyword) => normalized.includes(keyword))
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasKeywordMatch(entry, keywords))
  }

  if (isRecord(value)) {
    return Object.values(value).some((entry) => hasKeywordMatch(entry, keywords))
  }

  return false
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeJsonValue(left)) ===
    JSON.stringify(normalizeJsonValue(right))
  )
}

const TIMELINE_EVENT_PRIORITY: Record<string, number> = {
  requested: 0,
  acquired: 1,
  execution_started: 2,
  cancel_requested: 3,
  cancel_acknowledged: 4,
  heartbeat_lost: 5,
  expired: 6,
  failed: 7,
  completed: 8,
  released: 9,
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function toStringRecord(value: unknown): Record<string, number> {
  if (!isPlainObject(value)) {
    return {}
  }

  const record: Record<string, number> = {}

  for (const [key, entry] of Object.entries(value)) {
    record[key] = toFiniteNumber(entry, 0)
  }

  return record
}

function resolveSnapshotBindings(
  snapshot: JsonObject | null,
): JsonObject[] {
  if (!snapshot) {
    return []
  }

  const candidateCollections = [
    snapshot.bindings,
    snapshot.activeBindings,
    snapshot.active_bindings,
    snapshot.mcpBindings,
    snapshot.mcp_bindings,
    snapshot.entries,
  ]

  for (const value of candidateCollections) {
    if (Array.isArray(value)) {
      return value.filter(isPlainObject)
    }
  }

  return []
}

function normalizeSharingScope(value: unknown): McpSharingScope {
  if (value === 'host' || value === 'repo' || value === 'exclusive') {
    return value
  }

  return 'exclusive'
}

function normalizeProcessState(value: unknown): McpProcessStateV1 {
  if (
    value === 'starting' ||
    value === 'running' ||
    value === 'stopped' ||
    value === 'failed'
  ) {
    return value
  }

  return 'running'
}

function resolveSnapshotUpdatedAt(
  value: unknown,
  fallback: Date | null,
): string {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  return toIsoString(fallback) ?? new Date().toISOString()
}

function buildMcpPoolBindingView(
  binding: JsonObject,
  context: {
    runnerNodeId: string
    hostGroupId: string
    updatedAt: string
  },
): RunnerMcpPoolBindingView {
  const acquiredCount = toFiniteNumber(binding.acquiredCount, 1)
  const sessionCounts = toStringRecord(binding.sessionCounts)
  const processState = normalizeProcessState(binding.processState)
  const updatedAt = resolveSnapshotUpdatedAt(binding.updatedAt, null)

  return {
    runnerNodeId:
      typeof binding.runnerNodeId === 'string' && binding.runnerNodeId.length > 0
        ? binding.runnerNodeId
        : context.runnerNodeId,
    hostGroupId:
      typeof binding.hostGroupId === 'string' && binding.hostGroupId.length > 0
        ? binding.hostGroupId
        : context.hostGroupId,
    serverName:
      typeof binding.serverName === 'string' && binding.serverName.length > 0
        ? binding.serverName
        : 'unknown',
    sharingScope: normalizeSharingScope(binding.sharingScope),
    repoSlug:
      typeof binding.repoSlug === 'string' && binding.repoSlug.length > 0
        ? binding.repoSlug
        : null,
    bindingKey:
      typeof binding.bindingKey === 'string' && binding.bindingKey.length > 0
        ? binding.bindingKey
        : `${typeof binding.serverName === 'string' && binding.serverName.length > 0 ? binding.serverName : 'unknown'}:${normalizeSharingScope(binding.sharingScope)}`,
    acquiredCount,
    sessionCounts,
    processState,
    updatedAt: updatedAt || context.updatedAt,
  }
}

function buildRunnerMcpPoolSnapshotView(
  row: Selectable<Database['runner_nodes']>,
): RunnerMcpPoolSnapshotView | null {
  if (row.latest_mcp_pool_snapshot_at === null) {
    return null
  }

  const snapshot = row.latest_mcp_pool_snapshot_json
  const bindings = resolveSnapshotBindings(snapshot).map((binding) =>
    buildMcpPoolBindingView(binding, {
      runnerNodeId: row.runner_node_id,
      hostGroupId: row.host_group_id,
      updatedAt: row.latest_mcp_pool_snapshot_at?.toISOString() ?? row.updated_at.toISOString(),
    }),
  )

  return {
    runnerNodeId: row.runner_node_id,
    hostGroupId: row.host_group_id,
    updatedAt:
      row.latest_mcp_pool_snapshot_at?.toISOString() ?? row.updated_at.toISOString(),
    bindings,
  }
}

function buildTimelineEvent(
  event: RunnerLeaseTimelineEventView['event'],
  at: Date | null,
  scope: RunnerLeaseTimelineEventView['scope'],
  input: {
    leaseAttemptId: string | null
    providerAttemptNo: number | null
    status: RunnerLeaseStatus | RunnerLeaseAttemptStatus | null
  },
): RunnerLeaseTimelineEventView | null {
  const timestamp = toIsoString(at)

  if (!timestamp) {
    return null
  }

  return {
    event,
    at: timestamp,
    scope,
    leaseAttemptId: input.leaseAttemptId,
    providerAttemptNo: input.providerAttemptNo,
    status: input.status,
  }
}

function buildRunnerLeaseTimeline(
  lease: Selectable<Database['runner_leases']>,
  attempts: Array<Selectable<Database['runner_lease_attempts']>>,
): RunnerLeaseTimelineEventView[] {
  const events: RunnerLeaseTimelineEventView[] = []

  const push = (event: RunnerLeaseTimelineEventView | null) => {
    if (event) {
      events.push(event)
    }
  }

  push(
    buildTimelineEvent('requested', lease.requested_at, 'lease', {
      leaseAttemptId: null,
      providerAttemptNo: null,
      status: lease.status,
    }),
  )
  push(
    buildTimelineEvent('acquired', lease.acquired_at, 'lease', {
      leaseAttemptId: null,
      providerAttemptNo: null,
      status: lease.status,
    }),
  )
  push(
    buildTimelineEvent('execution_started', lease.execution_started_at, 'lease', {
      leaseAttemptId: null,
      providerAttemptNo: null,
      status: lease.status,
    }),
  )

  if (lease.status === 'heartbeat_lost') {
    push(
      buildTimelineEvent(
        'heartbeat_lost',
        lease.heartbeat_expires_at ?? lease.last_heartbeat_at,
        'lease',
        {
          leaseAttemptId: null,
          providerAttemptNo: null,
          status: lease.status,
        },
      ),
    )
  }

  if (lease.status === 'expired') {
    push(
      buildTimelineEvent('expired', lease.failed_at ?? lease.heartbeat_expires_at, 'lease', {
        leaseAttemptId: null,
        providerAttemptNo: null,
        status: lease.status,
      }),
    )
  }

  push(
    buildTimelineEvent(
      'cancel_requested',
      lease.cancellation_requested_at,
      'lease',
      {
        leaseAttemptId: null,
        providerAttemptNo: null,
        status: lease.status,
      },
    ),
  )
  push(
    buildTimelineEvent('failed', lease.failed_at, 'lease', {
      leaseAttemptId: null,
      providerAttemptNo: null,
      status: lease.status,
    }),
  )
  push(
    buildTimelineEvent('completed', lease.completed_at, 'lease', {
      leaseAttemptId: null,
      providerAttemptNo: null,
      status: lease.status,
    }),
  )
  push(
    buildTimelineEvent('released', lease.released_at, 'lease', {
      leaseAttemptId: null,
      providerAttemptNo: null,
      status: lease.status,
    }),
  )

  for (const attempt of attempts) {
    push(
      buildTimelineEvent('requested', attempt.created_at, 'attempt', {
        leaseAttemptId: attempt.lease_attempt_id,
        providerAttemptNo: attempt.provider_attempt_no,
        status: attempt.status,
      }),
    )
    push(
      buildTimelineEvent('acquired', attempt.acquired_at, 'attempt', {
        leaseAttemptId: attempt.lease_attempt_id,
        providerAttemptNo: attempt.provider_attempt_no,
        status: attempt.status,
      }),
    )
    push(
      buildTimelineEvent('execution_started', attempt.execution_started_at, 'attempt', {
        leaseAttemptId: attempt.lease_attempt_id,
        providerAttemptNo: attempt.provider_attempt_no,
        status: attempt.status,
      }),
    )
    push(
      buildTimelineEvent('cancel_requested', attempt.cancel_requested_at, 'attempt', {
        leaseAttemptId: attempt.lease_attempt_id,
        providerAttemptNo: attempt.provider_attempt_no,
        status: attempt.status,
      }),
    )
    push(
      buildTimelineEvent('cancel_acknowledged', attempt.cancel_acknowledged_at, 'attempt', {
        leaseAttemptId: attempt.lease_attempt_id,
        providerAttemptNo: attempt.provider_attempt_no,
        status: attempt.status,
      }),
    )
    push(
      buildTimelineEvent('failed', attempt.failed_at, 'attempt', {
        leaseAttemptId: attempt.lease_attempt_id,
        providerAttemptNo: attempt.provider_attempt_no,
        status: attempt.status,
      }),
    )
    push(
      buildTimelineEvent('completed', attempt.completed_at, 'attempt', {
        leaseAttemptId: attempt.lease_attempt_id,
        providerAttemptNo: attempt.provider_attempt_no,
        status: attempt.status,
      }),
    )
    push(
      buildTimelineEvent('released', attempt.released_at, 'attempt', {
        leaseAttemptId: attempt.lease_attempt_id,
        providerAttemptNo: attempt.provider_attempt_no,
        status: attempt.status,
      }),
    )
  }

  return events.sort((left, right) => {
    if (left.at !== right.at) {
      return left.at.localeCompare(right.at)
    }

    const priorityDelta =
      (TIMELINE_EVENT_PRIORITY[left.event] ?? 999) -
      (TIMELINE_EVENT_PRIORITY[right.event] ?? 999)

    if (priorityDelta !== 0) {
      return priorityDelta
    }

    if (left.scope !== right.scope) {
      return left.scope === 'lease' ? -1 : 1
    }

    if ((left.providerAttemptNo ?? 0) !== (right.providerAttemptNo ?? 0)) {
      return (left.providerAttemptNo ?? 0) - (right.providerAttemptNo ?? 0)
    }

    return (left.leaseAttemptId ?? '').localeCompare(right.leaseAttemptId ?? '')
  })
}

export interface RunnerMcpPoolBindingView {
  runnerNodeId: string
  hostGroupId: string
  serverName: string
  sharingScope: McpSharingScope
  repoSlug: string | null
  bindingKey: string
  acquiredCount: number
  sessionCounts: Record<string, number>
  processState: McpProcessStateV1
  updatedAt: string
}

export interface RunnerMcpPoolSnapshotView {
  runnerNodeId: string
  hostGroupId: string
  updatedAt: string
  bindings: RunnerMcpPoolBindingView[]
}

export interface RunnerLeaseTimelineEventView {
  event:
    | 'requested'
    | 'acquired'
    | 'execution_started'
    | 'cancel_requested'
    | 'cancel_acknowledged'
    | 'heartbeat_lost'
    | 'expired'
    | 'failed'
    | 'completed'
    | 'released'
  at: string
  scope: 'lease' | 'attempt'
  leaseAttemptId: string | null
  providerAttemptNo: number | null
  status: RunnerLeaseStatus | RunnerLeaseAttemptStatus | null
}

export interface RunnerLeaseDetailView {
  lease: RunnerLeaseView
  attempts: RunnerLeaseAttemptView[]
  timeline: RunnerLeaseTimelineEventView[]
}

function serializeMcpBindingsSummary(
  bindings: McpBindingRefV1[],
): SharedJsonObject[] {
  return bindings.map((binding) => ({
    serverName: binding.serverName,
    sharingScope: binding.sharingScope,
    bindingKey: binding.bindingKey,
    reused: binding.reused,
    repoSlug: binding.repoSlug,
  }))
}

function assertRunnerExecutionMetadataMatchesAttempt(input: {
  lease: Selectable<Database['runner_leases']>
  attempt: Selectable<Database['runner_lease_attempts']>
  runnerNodeId: string
  executionMetadata: AgentExecutionMetadataV2
}): string[] {
  const { lease, attempt, runnerNodeId, executionMetadata } = input
  const mismatches: string[] = []
  const expectedTaskInstructionsRef =
    lease.task_instructions_ref ??
    buildLegacyTaskInstructionsRef(lease.issue_id, lease.run_id)
  const expectedPromptResolutionSource =
    lease.prompt_resolution_source ?? 'legacy_synthetic'

  if (executionMetadata.workflowId !== lease.workflow_id) {
    mismatches.push('executionMetadata.workflowId')
  }
  if (
    executionMetadata.workflowRunId !== null &&
    executionMetadata.workflowRunId !== lease.run_id
  ) {
    mismatches.push('executionMetadata.workflowRunId')
  }
  if (executionMetadata.requestedProvider !== lease.requested_provider) {
    mismatches.push('executionMetadata.requestedProvider')
  }
  if (executionMetadata.effectiveProvider !== attempt.effective_provider) {
    mismatches.push('executionMetadata.effectiveProvider')
  }
  if (executionMetadata.providerAttemptNo !== attempt.provider_attempt_no) {
    mismatches.push('executionMetadata.providerAttemptNo')
  }
  if (executionMetadata.runnerNodeId !== runnerNodeId) {
    mismatches.push('executionMetadata.runnerNodeId')
  }
  if (executionMetadata.hostGroupId !== attempt.host_group_id) {
    mismatches.push('executionMetadata.hostGroupId')
  }
  if (
    executionMetadata.promptVersion !==
    (lease.prompt_version ?? expectedTaskInstructionsRef)
  ) {
    mismatches.push('executionMetadata.promptVersion')
  }
  if (executionMetadata.agentLibraryReleaseId !== lease.agent_library_release_id) {
    mismatches.push('executionMetadata.agentLibraryReleaseId')
  }
  if (executionMetadata.taskInstructionsRef !== expectedTaskInstructionsRef) {
    mismatches.push('executionMetadata.taskInstructionsRef')
  }
  if (executionMetadata.roleCharterRef !== lease.role_charter_ref) {
    mismatches.push('executionMetadata.roleCharterRef')
  }
  if (
    executionMetadata.promptBundleFingerprint !==
    lease.prompt_bundle_fingerprint
  ) {
    mismatches.push('executionMetadata.promptBundleFingerprint')
  }
  if (
    !sameJsonValue(
      executionMetadata.resolvedPromptFamilyRefs,
      lease.resolved_prompt_family_refs,
    )
  ) {
    mismatches.push('executionMetadata.resolvedPromptFamilyRefs')
  }
  if (!sameJsonValue(executionMetadata.skillPackRefs, lease.skill_pack_refs)) {
    mismatches.push('executionMetadata.skillPackRefs')
  }
  if (
    !sameJsonValue(
      executionMetadata.resolvedSkillRefs,
      attempt.resolved_skill_refs,
    )
  ) {
    mismatches.push('executionMetadata.resolvedSkillRefs')
  }
  if (
    !sameJsonValue(
      executionMetadata.skippedOptionalSkillRefs,
      attempt.skipped_optional_skill_refs,
    )
  ) {
    mismatches.push('executionMetadata.skippedOptionalSkillRefs')
  }
  if (
    executionMetadata.effectiveSkillFingerprint !==
    lease.effective_skill_fingerprint
  ) {
    mismatches.push('executionMetadata.effectiveSkillFingerprint')
  }
  if (
    expectedPromptResolutionSource !== 'legacy_synthetic' &&
    executionMetadata.taskInstructionsRef === null
  ) {
    mismatches.push('executionMetadata.taskInstructionsRef')
  }

  return mismatches
}

function assertRunnerCompletionMatchesAttempt(input: {
  lease: Selectable<Database['runner_leases']>
  attempt: Selectable<Database['runner_lease_attempts']>
  runnerNodeId: string
  artifactBundle: ArtifactBundleV2
  executionMetadata: AgentExecutionMetadataV2
}): void {
  const { lease, attempt, runnerNodeId, artifactBundle, executionMetadata } = input
  const mismatches = assertRunnerExecutionMetadataMatchesAttempt({
    lease,
    attempt,
    runnerNodeId,
    executionMetadata,
  })

  if (artifactBundle.leaseId !== lease.lease_id) {
    mismatches.push('artifactBundle.leaseId')
  }
  if (artifactBundle.issueId !== lease.issue_id) {
    mismatches.push('artifactBundle.issueId')
  }
  if (artifactBundle.runId !== null && artifactBundle.runId !== lease.run_id) {
    mismatches.push('artifactBundle.runId')
  }
  if (artifactBundle.requestedProvider !== lease.requested_provider) {
    mismatches.push('artifactBundle.requestedProvider')
  }
  if (artifactBundle.effectiveProvider !== attempt.effective_provider) {
    mismatches.push('artifactBundle.effectiveProvider')
  }
  if (artifactBundle.providerAttemptNo !== attempt.provider_attempt_no) {
    mismatches.push('artifactBundle.providerAttemptNo')
  }
  if (artifactBundle.fallbackFromProvider !== attempt.fallback_from_provider) {
    mismatches.push('artifactBundle.fallbackFromProvider')
  }
  if (artifactBundle.fallbackReason !== attempt.fallback_reason) {
    mismatches.push('artifactBundle.fallbackReason')
  }
  if (artifactBundle.executionSessionKey !== attempt.execution_session_key) {
    mismatches.push('artifactBundle.executionSessionKey')
  }
  if (artifactBundle.mcpProfileRef !== attempt.mcp_profile_ref) {
    mismatches.push('artifactBundle.mcpProfileRef')
  }
  if (!sameJsonValue(artifactBundle.mcpBindingsSummary, attempt.mcp_bindings_summary)) {
    mismatches.push('artifactBundle.mcpBindingsSummary')
  }
  if (!sameJsonValue(executionMetadata.mcpBindings, artifactBundle.mcpBindings)) {
    mismatches.push('executionMetadata.mcpBindings')
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Runner completion payload does not match durable attempt state: ${mismatches.join(', ')}`,
    )
  }
}

async function assertRunnerArtifactReferencesExist(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    patchRef: string | null
    branchRef: string | null
  },
): Promise<void> {
  const stagedRefs = [input.patchRef, input.branchRef].filter(
    (value): value is string =>
      typeof value === 'string' && value.startsWith('artifact://blob/'),
  )

  if (stagedRefs.length === 0) {
    return
  }

  const rows = await db
    .selectFrom('runner_artifact_blobs')
    .select('artifact_blob_id')
    .where('lease_attempt_id', '=', input.leaseAttemptId)
    .execute()

  const availableRefs = new Set(
    rows.map((row) => buildRunnerArtifactBlobUri(row.artifact_blob_id)),
  )
  const missingRefs = stagedRefs.filter((ref) => !availableRefs.has(ref))

  if (missingRefs.length > 0) {
    throw new Error(
      `Runner completion references missing staged artifacts: ${missingRefs.join(', ')}`,
    )
  }
}

function resolveIntegrationCapabilities(
  value: unknown,
): IntegrationAgentCapabilityManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_INTEGRATION_CAPABILITIES
  }

  const candidate = value as Partial<IntegrationAgentCapabilityManifest>

  return {
    networkModesSupported: Array.isArray(candidate.networkModesSupported)
      ? candidate.networkModesSupported
      : DEFAULT_INTEGRATION_CAPABILITIES.networkModesSupported,
    allowedDocDomains: Array.isArray(candidate.allowedDocDomains)
      ? candidate.allowedDocDomains
      : DEFAULT_INTEGRATION_CAPABILITIES.allowedDocDomains,
    allowedSandboxDomains: Array.isArray(candidate.allowedSandboxDomains)
      ? candidate.allowedSandboxDomains
      : DEFAULT_INTEGRATION_CAPABILITIES.allowedSandboxDomains,
    supportsBrowserConsent:
      typeof candidate.supportsBrowserConsent === 'boolean'
        ? candidate.supportsBrowserConsent
        : DEFAULT_INTEGRATION_CAPABILITIES.supportsBrowserConsent,
    supportsSecretBroker:
      typeof candidate.supportsSecretBroker === 'boolean'
        ? candidate.supportsSecretBroker
        : DEFAULT_INTEGRATION_CAPABILITIES.supportsSecretBroker,
    supportsOAuthBroker:
      typeof candidate.supportsOAuthBroker === 'boolean'
        ? candidate.supportsOAuthBroker
        : DEFAULT_INTEGRATION_CAPABILITIES.supportsOAuthBroker,
    supportsIntegrationLab:
      typeof candidate.supportsIntegrationLab === 'boolean'
        ? candidate.supportsIntegrationLab
        : DEFAULT_INTEGRATION_CAPABILITIES.supportsIntegrationLab,
  }
}

function isIntegrationContract(contract: IssueContract | null | undefined): boolean {
  if (!contract) {
    return false
  }

  return Boolean(
    contract.providerName ||
      contract.integrationKind ||
      contract.authScheme ||
      (contract.requiredCredentials?.length ?? 0) > 0 ||
      (contract.secretSlots?.length ?? 0) > 0 ||
      contract.webhookRequired === true,
  )
}

function deriveIntegrationRequiredCapabilities(
  contract: IssueContract | null | undefined,
): string[] {
  if (!isIntegrationContract(contract)) {
    return []
  }

  const required = [
    'network_docs_allowlist',
    'network_sandbox_api_allowlist',
    'secret_broker',
    'integration_lab',
  ]

  const authScheme = contract?.authScheme as AuthScheme | null | undefined

  if (
    authScheme === 'oauth2_auth_code' ||
    authScheme === 'oauth2_client_credentials' ||
    authScheme === 'oauth2_device'
  ) {
    required.push('oauth_broker')
  }

  if (authScheme === 'oauth2_auth_code') {
    required.push('browser_consent')
  }

  return [...new Set(required)]
}

async function loadPinnedAgentLibraryRelease(
  db: Kysely<Database>,
  input: {
    issueId: string
    runId: string | null
  },
): Promise<{
  releaseId: string
  libraryFingerprint: string
}> {
  if (input.runId) {
    const run = await db
      .selectFrom('issue_runs')
      .select(['agent_library_release_id', 'agent_library_fingerprint'])
      .where('id', '=', input.runId)
      .executeTakeFirstOrThrow()

    if (run.agent_library_release_id) {
      if (run.agent_library_fingerprint) {
        return {
          releaseId: run.agent_library_release_id,
          libraryFingerprint: run.agent_library_fingerprint,
        }
      }

      const release = await db
        .selectFrom('agent_library_releases')
        .select(['library_fingerprint'])
        .where('release_id', '=', run.agent_library_release_id)
        .executeTakeFirstOrThrow()

      await db
        .updateTable('issue_runs')
        .set({
          agent_library_fingerprint: release.library_fingerprint,
        })
        .where('id', '=', input.runId)
        .execute()

      return {
        releaseId: run.agent_library_release_id,
        libraryFingerprint: release.library_fingerprint,
      }
    }
  }

  const activeRelease = await db
    .selectFrom('agent_library_releases')
    .select(['release_id', 'library_fingerprint'])
    .where('is_active_for_new_runs', '=', true)
    .executeTakeFirst()

  if (!activeRelease) {
    throw new Error(
      'No active agent-library runtime release is available for new runner leases',
    )
  }

  if (input.runId) {
    await db
      .updateTable('issue_runs')
      .set({
        agent_library_release_id: activeRelease.release_id,
        agent_library_fingerprint: activeRelease.library_fingerprint,
      })
      .where('id', '=', input.runId)
      .where('agent_library_release_id', 'is', null)
      .execute()
  }

  return {
    releaseId: activeRelease.release_id,
    libraryFingerprint: activeRelease.library_fingerprint,
  }
}

async function resolveAgentLibraryLeaseTruth(
  db: Kysely<Database>,
  input: {
    issueId: string
    runId: string | null
    requestedOwnerRole: string
    requestedStatusCode: string | null
    transitionAuditId: string | null
    runnerRequirementProfile: JsonObject
  },
): Promise<ResolvedAgentLibraryLeaseTruth> {
  const pinnedRelease = await loadPinnedAgentLibraryRelease(db, {
    issueId: input.issueId,
    runId: input.runId,
  })

  const promptBundle = await db
    .selectFrom('agent_prompt_bundles')
    .selectAll()
    .where('release_id', '=', pinnedRelease.releaseId)
    .where('role_id', '=', input.requestedOwnerRole)
    .executeTakeFirst()

  if (!promptBundle) {
    throw new Error(
      `Missing published prompt bundle for role ${input.requestedOwnerRole} in release ${pinnedRelease.releaseId}`,
    )
  }

  const latestContractSnapshot = await db
    .selectFrom('linear_issue_contract_snapshots')
    .select(['contract_json'])
    .where('issue_id', '=', input.issueId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  const latestTransition = input.transitionAuditId
    ? await db
        .selectFrom('status_transition_audit')
        .select(['trigger_code'])
        .where('id', '=', input.transitionAuditId)
        .executeTakeFirst()
    : null
  const contract =
    (latestContractSnapshot?.contract_json as IssueContract | null | undefined) ?? null
  const requiresIntegration = isIntegrationContract(contract)
  const contractTaskTypes = resolveContractTaskTypes(contract)
  const requestedTaskTypes = normalizeStringArray(
    (input.runnerRequirementProfile as { taskTypes?: unknown; task_types?: unknown })
      .taskTypes,
  )
  const snakeCaseTaskTypes = normalizeStringArray(
    (
      input.runnerRequirementProfile as {
        taskTypes?: unknown
        task_types?: unknown
      }
    ).task_types,
  )
  const taskTypes = Array.from(
    new Set([...contractTaskTypes, ...requestedTaskTypes, ...snakeCaseTaskTypes]),
  ).sort((left, right) => left.localeCompare(right))

  const routingRules = await db
    .selectFrom('agent_routing_skill_pack_rules')
    .selectAll()
    .where('release_id', '=', pinnedRelease.releaseId)
    .execute()

  const selectedSkillPackRefs = new Set(promptBundle.default_skill_pack_refs)

  for (const rule of routingRules) {
    const matchesStatus =
      rule.statuses.length === 0 ||
      (input.requestedStatusCode !== null &&
        rule.statuses.includes(input.requestedStatusCode))
    const matchesTrigger =
      rule.triggers.length === 0 ||
      (latestTransition?.trigger_code !== undefined &&
        latestTransition?.trigger_code !== null &&
        rule.triggers.includes(latestTransition.trigger_code))
    const matchesTaskType =
      rule.task_types.length === 0 ||
      taskTypes.some((taskType) => rule.task_types.includes(taskType))
    const matchesIntegration =
      rule.requires_integration === null ||
      rule.requires_integration === requiresIntegration

    if (!matchesStatus || !matchesTrigger || !matchesTaskType || !matchesIntegration) {
      continue
    }

    for (const packRef of rule.add_skill_pack_refs) {
      selectedSkillPackRefs.add(packRef)
    }
  }

  const sortedSkillPackRefs = [...selectedSkillPackRefs].sort((left, right) =>
    left.localeCompare(right),
  )

  const skillPackRows = sortedSkillPackRefs.length
    ? await db
        .selectFrom('agent_skill_packs')
        .select([
          'pack_id',
          'skill_pack_fingerprint',
          'prompt_family_refs',
        ])
        .where('release_id', '=', pinnedRelease.releaseId)
        .where('pack_id', 'in', sortedSkillPackRefs)
        .execute()
    : []
  const skillPackById = new Map(skillPackRows.map((row) => [row.pack_id, row]))
  const missingSkillPacks = sortedSkillPackRefs.filter(
    (packId) => !skillPackById.has(packId),
  )

  if (missingSkillPacks.length > 0) {
    throw new Error(
      `Prompt bundle ${promptBundle.prompt_bundle_ref} resolved missing skill packs: ${missingSkillPacks.join(', ')}`,
    )
  }

  const promptFamilyRefs = await db
    .selectFrom('agent_prompt_families')
    .select(['prompt_family_ref'])
    .where('release_id', '=', pinnedRelease.releaseId)
    .execute()
  const availablePromptFamilyRefs = new Set(
    promptFamilyRefs.map((row) => row.prompt_family_ref),
  )
  const resolvedPromptFamilyRefs = Array.from(
    new Set([
      ...promptBundle.default_prompt_family_refs,
      ...sortedSkillPackRefs
        .flatMap((packId) => skillPackById.get(packId)?.prompt_family_refs ?? [])
        .filter((promptFamilyRef) => availablePromptFamilyRefs.has(promptFamilyRef)),
    ]),
  ).sort((left, right) => left.localeCompare(right))

  const effectiveSkillFingerprint = hashSortedValue(
    sortedSkillPackRefs.map((packId) => ({
      packId,
      fingerprint: skillPackById.get(packId)?.skill_pack_fingerprint ?? null,
    })),
  )

  return {
    agentLibraryReleaseId: pinnedRelease.releaseId,
    agentLibraryFingerprint: pinnedRelease.libraryFingerprint,
    roleCharterRef: promptBundle.role_charter_ref,
    promptVersion: promptBundle.prompt_version,
    taskInstructionsRef: promptBundle.prompt_bundle_ref,
    promptBundleFingerprint: promptBundle.prompt_bundle_fingerprint,
    skillPackRefs: sortedSkillPackRefs,
    resolvedPromptFamilyRefs,
    effectiveSkillFingerprint,
    promptResolutionSource:
      promptBundle.resolution_mode === 'compatibility_alias'
        ? 'compatibility_alias'
        : 'published_bundle',
  }
}

function buildExpectedOutputs(runKind: RunnerLeaseView['requestedRunKind']): string[] {
  switch (runKind) {
    case 'build':
      return ['summary', 'changed_files', 'test_results', 'patch']
    case 'review':
      return ['summary', 'review_findings']
    case 'deploy':
      return ['summary', 'test_results']
    case 'rework_cycle':
      return ['summary', 'changed_files']
    default:
      return ['summary']
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function extractRequiredCapabilities(
  profile: JsonObject,
): string[] {
  const camelCase = profile.requiredCapabilities
  if (isStringArray(camelCase)) {
    return camelCase
  }

  const snakeCase = profile.required_capabilities
  if (isStringArray(snakeCase)) {
    return snakeCase
  }

  return []
}

function buildCapabilitySet(
  capability: Selectable<Database['runner_capabilities']>,
): Set<string> {
  const set = new Set<string>(capability.tool_baseline)
  const integration = resolveIntegrationCapabilities(
    capability.integration_capabilities_json,
  )

  if (capability.mcp_server_catalog.some((entry) => entry.sharingScope !== 'exclusive')) {
    set.add('shared_mcp')
  }
  if (capability.workspace_root.trim().length > 0) {
    set.add('workspace_access')
    set.add('context_pack_read')
    set.add('repo_guidance_read')
  }
  if (capability.worktree_root.trim().length > 0) {
    set.add('worktree_management')
  }
  if (capability.supports_artifact_upload) {
    set.add('artifact_upload')
  }
  if (
    integration.networkModesSupported.includes('docs_allowlist') &&
    integration.allowedDocDomains.length > 0
  ) {
    set.add('network_docs_allowlist')
  }
  if (
    integration.networkModesSupported.includes('sandbox_api_allowlist') &&
    integration.allowedSandboxDomains.length > 0
  ) {
    set.add('network_sandbox_api_allowlist')
  }
  if (integration.supportsBrowserConsent) {
    set.add('browser_consent')
  }
  if (integration.supportsSecretBroker) {
    set.add('secret_broker')
  }
  if (integration.supportsOAuthBroker) {
    set.add('oauth_broker')
  }
  if (integration.supportsIntegrationLab) {
    set.add('integration_lab')
  }

  return set
}

function buildMcpServerNameSet(
  capability: Selectable<Database['runner_capabilities']>,
): Set<string> {
  return new Set(capability.mcp_server_catalog.map((entry) => entry.serverName))
}

function buildRequestedMcpBindingsSummary(
  mcpServerCatalog: RunnerCapabilityManifestV1['mcpServerCatalog'],
  repoSlug: string | null,
): McpBindingRefV1[] {
  return mcpServerCatalog
    .filter((entry) => entry.sharingScope !== 'exclusive')
    .map((entry) => ({
      serverName: entry.serverName,
      sharingScope: entry.sharingScope,
      bindingKey: `requested:${entry.serverName}:${entry.sharingScope}`,
      reused: false,
      repoSlug: entry.sharingScope === 'host' ? null : repoSlug,
    }))
}

function canSatisfyRequiredCapabilities(
  capabilitySet: Set<string>,
  requiredCapabilities: string[],
): boolean {
  return requiredCapabilities.every((capability) => capabilitySet.has(capability))
}

function canSatisfyIntegrationMcpRequirements(
  capability: Selectable<Database['runner_capabilities']>,
  contract: IssueContract | null | undefined,
): boolean {
  if (!isIntegrationContract(contract)) {
    return true
  }

  const availableServers = buildMcpServerNameSet(capability)
  const requiredServers: string[] = [
    REQUIRED_INTEGRATION_MCP_SERVERS.secretBroker,
    REQUIRED_INTEGRATION_MCP_SERVERS.integrationLab,
  ]

  const authScheme = contract?.authScheme as AuthScheme | null | undefined
  if (
    authScheme === 'oauth2_auth_code' ||
    authScheme === 'oauth2_client_credentials' ||
    authScheme === 'oauth2_device'
  ) {
    requiredServers.push(REQUIRED_INTEGRATION_MCP_SERVERS.oauthBroker)
  }

  return requiredServers.every((serverName) => availableServers.has(serverName))
}

function assertLeaseAttemptOwnership(
  leaseAttemptId: string,
  expectedRunnerNodeId: string,
  actualRunnerNodeId: string | null,
): void {
  if (actualRunnerNodeId !== expectedRunnerNodeId) {
    throw new Error(
      `Runner attempt ${leaseAttemptId} is not assigned to runner ${expectedRunnerNodeId}`,
    )
  }
}

async function loadRunnerExecutionContext(
  db: Kysely<Database>,
  leaseId: string,
): Promise<{
  lease: Selectable<Database['runner_leases']>
  attempt: Selectable<Database['runner_lease_attempts']>
  contextPackId: string | null
  repoSlug: string | null
  repoCheckoutPath: string | null
  reviewedBuildArtifactId: string | null
}> {
  const lease = await db
    .selectFrom('runner_leases')
    .selectAll()
    .where('lease_id', '=', leaseId)
    .executeTakeFirstOrThrow()

  const attempt = await db
    .selectFrom('runner_lease_attempts')
    .selectAll()
    .where('lease_id', '=', leaseId)
    .where('provider_attempt_no', '=', lease.attempt_count)
    .executeTakeFirstOrThrow()

  const latestContract = await db
    .selectFrom('linear_issue_contract_snapshots')
    .select(['primary_repo'])
    .where('issue_id', '=', lease.issue_id)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  const repoSlug = latestContract?.primary_repo ?? null
  const repoRecord = repoSlug
    ? await db
        .selectFrom('repository_registry')
        .select(['local_checkout_path'])
        .where('repo_slug', '=', repoSlug)
        .executeTakeFirst()
    : null

  const exactContextPack =
    lease.context_pack_fingerprint === null
      ? null
      : await db
          .selectFrom('context_pack_cache')
          .select(['id'])
          .where('issue_id', '=', lease.issue_id)
          .where('input_fingerprint', '=', lease.context_pack_fingerprint)
          .where('superseded_at', 'is', null)
          .executeTakeFirst()

  const latestContextPack =
    exactContextPack ??
    (await db
      .selectFrom('context_pack_cache')
      .select(['id'])
      .where('issue_id', '=', lease.issue_id)
      .where('superseded_at', 'is', null)
      .orderBy('created_at', 'desc')
      .executeTakeFirst())

  const reviewedBuildLease =
    lease.requested_run_kind === 'review'
      ? await db
          .selectFrom('runner_leases')
          .select(['result_artifact_id'])
          .where('issue_id', '=', lease.issue_id)
          .where('requested_run_kind', '=', 'build')
          .where('requested_owner_role', 'in', [...PRIMARY_BUILD_EXECUTION_ROLES])
          .where('result_artifact_id', 'is not', null)
          .where((eb) =>
            lease.run_id === null
              ? eb('run_id', 'is', null)
              : eb('run_id', '=', lease.run_id),
          )
          .orderBy('completed_at', 'desc')
          .executeTakeFirst()
      : null

  return {
    lease,
    attempt,
    contextPackId: latestContextPack?.id ?? null,
    repoSlug,
    repoCheckoutPath: repoRecord?.local_checkout_path ?? null,
    reviewedBuildArtifactId: reviewedBuildLease?.result_artifact_id ?? null,
  }
}

async function buildTaskEnvelopeForLease(
  db: Kysely<Database>,
  leaseId: string,
  toolBaseline: string[],
  worktreeRoot: string,
  mcpServerCatalog: RunnerCapabilityManifestV1['mcpServerCatalog'],
): Promise<TaskEnvelopeV2> {
  const context = await loadRunnerExecutionContext(db, leaseId)
  const taskInstructionsRef =
    context.lease.task_instructions_ref ??
    buildLegacyTaskInstructionsRef(context.lease.issue_id, context.lease.run_id)

  return {
    schemaVersion: 2,
    leaseId: context.lease.lease_id,
    leaseAttemptId: context.attempt.lease_attempt_id,
    issueId: context.lease.issue_id,
    runId: context.lease.run_id,
    workflowId: context.lease.workflow_id,
    requestedProvider: context.lease.requested_provider,
    effectiveProvider: context.attempt.effective_provider,
    providerAttemptNo: context.attempt.provider_attempt_no,
    fallbackFromProvider: context.attempt.fallback_from_provider,
    fallbackReason: context.attempt.fallback_reason,
    roleExecutionPolicyVersion: context.lease.role_execution_policy_version,
    agentRole: context.lease.requested_owner_role,
    runKind: context.lease.requested_run_kind,
    repoSlug: context.repoSlug,
    localCheckoutPath: context.repoCheckoutPath,
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: `${worktreeRoot}/${context.lease.lease_id}`,
    contextPackRef: context.contextPackId,
    contextPackFingerprint: context.lease.context_pack_fingerprint,
    reviewedBuildArtifactId: context.reviewedBuildArtifactId,
    checkpointRef: context.attempt.checkpoint_ref,
    executionSessionKey: context.attempt.execution_session_key,
    mcpProfileRef: context.attempt.mcp_profile_ref,
    mcpBindingsSummary: buildRequestedMcpBindingsSummary(
      mcpServerCatalog,
      context.repoSlug,
    ),
    agentLibraryReleaseId: context.lease.agent_library_release_id,
    taskInstructionsRef,
    promptVersion: context.lease.prompt_version,
    roleCharterRef: context.lease.role_charter_ref,
    promptBundleFingerprint: context.lease.prompt_bundle_fingerprint,
    skillPackRefs: context.lease.skill_pack_refs,
    effectiveSkillFingerprint: context.lease.effective_skill_fingerprint,
    toolBaseline,
    expectedOutputs: buildExpectedOutputs(context.lease.requested_run_kind),
    issuedAt: new Date().toISOString(),
  }
}

async function insertRunnerArtifactBundle(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
  },
): Promise<string> {
  const existingArtifact = await db
    .selectFrom('artifact_registry')
    .select(['id'])
    .where('artifact_type', '=', 'runner_artifact_bundle')
    .where(
      'artifact_uri',
      '=',
      `system://runner-leases/${input.lease.lease_id}/attempts/${input.attempt.lease_attempt_id}/artifact-bundle`,
    )
    .executeTakeFirst()

  if (existingArtifact) {
    return existingArtifact.id
  }

  const inserted = await db
    .insertInto('artifact_registry')
    .values({
      issue_id: input.lease.issue_id,
      run_id: input.lease.run_id,
      transition_audit_id: null,
      artifact_type: 'runner_artifact_bundle',
      artifact_scope: input.lease.run_id ? 'run' : 'issue',
      artifact_uri: `system://runner-leases/${input.lease.lease_id}/attempts/${input.attempt.lease_attempt_id}/artifact-bundle`,
      artifact_summary:
        input.bundle.summary ??
        `Runner artifact bundle for ${input.bundle.agentRole}`,
      produced_by_role: input.bundle.agentRole,
      produced_for_status_code: null,
      metadata: input.bundle as unknown as JsonObject,
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  return inserted.id
}

async function insertRunnerExecutionMetadataArtifact(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    metadata: AgentExecutionMetadataV2
  },
): Promise<string> {
  const artifactUri = `system://runner-leases/${input.lease.lease_id}/attempts/${input.attempt.lease_attempt_id}/execution-metadata`
  const producedForStatusCode =
    (
      input.lease.runner_requirement_profile_json as
        | { requestedStatusCode?: string | null }
        | null
    )?.requestedStatusCode ?? null
  const existingArtifact = await db
    .selectFrom('artifact_registry')
    .select(['id'])
    .where('artifact_uri', '=', artifactUri)
    .executeTakeFirst()

  if (existingArtifact) {
    return existingArtifact.id
  }

  const artifact = buildAgentExecutionMetadataArtifact({
    ...input.metadata,
    issueId: input.lease.issue_id,
    transitionAuditId: null,
    runId: input.lease.run_id,
    producedForStatusCode,
  })

  const inserted = await db
    .insertInto('artifact_registry')
    .values({
      ...artifact,
      artifact_uri: artifactUri,
      artifact_summary: `Runner execution metadata for ${input.metadata.agentRole}`,
      metadata: input.metadata as unknown as JsonObject,
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  return inserted.id
}

function buildExecutionRecordArtifact(input: {
  leaseId: string
  leaseAttemptId: string
  providerAttemptNo: number
  requestedProvider: AgentProvider
  effectiveProvider: AgentProvider
  runnerNodeId: string
  mcpBindingsSummary: McpBindingRefV1[]
}): LifecycleCommandEnvelopeV1['artifacts'] {
  return [
    {
      artifactType: 'execution_record',
      artifactScope: 'run',
      artifactUri: `system://runner-leases/${input.leaseId}/attempts/${input.leaseAttemptId}/execution-record`,
      artifactSummary: `Execution record for provider attempt ${input.providerAttemptNo.toString()}`,
      producedByRole: 'orchestrator',
      metadata: {
        leaseId: input.leaseId,
        leaseAttemptId: input.leaseAttemptId,
        providerAttemptNo: input.providerAttemptNo,
        requestedProvider: input.requestedProvider,
        effectiveProvider: input.effectiveProvider,
        runnerNodeId: input.runnerNodeId,
        mcpBindingsSummary: serializeMcpBindingsSummary(input.mcpBindingsSummary),
      } satisfies SharedJsonObject,
    },
  ]
}

function buildBuildReportArtifact(input: {
  leaseId: string
  leaseAttemptId: string
  bundle: ArtifactBundleV2
}): NonNullable<LifecycleCommandEnvelopeV1['artifacts']> {
  return [
    {
      artifactType: 'build_report',
      artifactScope: 'run',
      artifactUri: `system://runner-leases/${input.leaseId}/attempts/${input.leaseAttemptId}/build-report`,
      artifactSummary:
        input.bundle.summary ??
        `Build report for provider attempt ${input.bundle.providerAttemptNo.toString()}`,
      producedByRole: input.bundle.agentRole,
      metadata: {
        runKind: input.bundle.runKind ?? null,
        changedFiles: input.bundle.changedFiles,
        testResults: input.bundle.testResults,
        patchRef: input.bundle.patchRef,
        branchRef: input.bundle.branchRef,
        reviewFindings: input.bundle.reviewFindings,
        toolUsage: input.bundle.toolUsage,
        providerExecutionMetadata: input.bundle.providerExecutionMetadata,
        mcpBindingsSummary: serializeMcpBindingsSummary(
          input.bundle.mcpBindingsSummary,
        ),
      } satisfies SharedJsonObject,
    },
  ]
}

function coerceReviewDisposition(
  disposition: ReviewDisposition | null | undefined,
): ReviewDisposition {
  if (
    disposition === 'human_gate_required' ||
    disposition === 'rework_recommended' ||
    disposition === 'review_inconclusive'
  ) {
    return disposition
  }

  return 'human_gate_required'
}

function buildReviewReportArtifact(input: {
  leaseId: string
  leaseAttemptId: string
  bundle: ArtifactBundleV2
  contextPackFingerprint: string | null
}): NonNullable<LifecycleCommandEnvelopeV1['artifacts']> {
  return [
    {
      artifactType: 'review_report',
      artifactScope: 'issue',
      artifactUri: `system://runner-leases/${input.leaseId}/attempts/${input.leaseAttemptId}/review-report`,
      artifactSummary:
        input.bundle.summary ??
        `Review report for provider attempt ${input.bundle.providerAttemptNo.toString()}`,
      producedByRole: input.bundle.agentRole,
      metadata: {
        runKind: input.bundle.runKind ?? null,
        reviewDisposition: coerceReviewDisposition(input.bundle.reviewDisposition),
        reviewFindings: input.bundle.reviewFindings,
        reviewedBuildArtifactId: input.bundle.reviewedBuildArtifactId ?? null,
        recommendedNextAction: input.bundle.recommendedNextAction ?? null,
        providerExecutionMetadata: input.bundle.providerExecutionMetadata,
        contextPackFingerprint:
          input.contextPackFingerprint ??
          input.bundle.providerExecutionMetadata.contextPackFingerprint ??
          null,
      } satisfies SharedJsonObject,
    },
  ]
}

function buildDecisionSummaryArtifact(input: {
  leaseId: string
  leaseAttemptId: string
  bundle: ArtifactBundleV2
  contextPackFingerprint: string | null
}): NonNullable<LifecycleCommandEnvelopeV1['artifacts']> {
  return [
    {
      artifactType: 'decision_summary',
      artifactScope: 'issue',
      artifactUri: `system://runner-leases/${input.leaseId}/attempts/${input.leaseAttemptId}/decision-summary`,
      artifactSummary:
        input.bundle.decisionSummary ??
        `Decision summary for provider attempt ${input.bundle.providerAttemptNo.toString()}`,
      producedByRole: input.bundle.agentRole,
      metadata: {
        summary:
          input.bundle.decisionSummary ??
          input.bundle.summary ??
          'Review completed and is awaiting a human decision.',
        reviewDisposition: coerceReviewDisposition(input.bundle.reviewDisposition),
        reviewedBuildArtifactId: input.bundle.reviewedBuildArtifactId ?? null,
        recommendedNextAction: input.bundle.recommendedNextAction ?? null,
        contextPackFingerprint:
          input.contextPackFingerprint ??
          input.bundle.providerExecutionMetadata.contextPackFingerprint ??
          null,
      } satisfies SharedJsonObject,
    },
  ]
}

function buildVerificationResultArtifact(input: {
  leaseId: string
  leaseAttemptId: string
  bundle: ArtifactBundleV2
  contextPackFingerprint: string | null
}): NonNullable<LifecycleCommandEnvelopeV1['artifacts']> {
  return [
    {
      artifactType: 'verification_result',
      artifactScope: 'issue',
      artifactUri: `system://runner-leases/${input.leaseId}/attempts/${input.leaseAttemptId}/verification-result`,
      artifactSummary:
        input.bundle.summary ??
        `Verification result for provider attempt ${input.bundle.providerAttemptNo.toString()}`,
      producedByRole: input.bundle.agentRole,
      metadata: {
        runKind: input.bundle.runKind ?? null,
        changedFiles: input.bundle.changedFiles,
        testResults: input.bundle.testResults,
        patchRef: input.bundle.patchRef,
        branchRef: input.bundle.branchRef,
        toolUsage: input.bundle.toolUsage,
        providerExecutionMetadata: input.bundle.providerExecutionMetadata,
        contextPackFingerprint:
          input.contextPackFingerprint ??
          input.bundle.providerExecutionMetadata.contextPackFingerprint ??
          null,
      } satisfies SharedJsonObject,
    },
  ]
}

function buildSecurityReviewReportArtifact(input: {
  leaseId: string
  leaseAttemptId: string
  bundle: ArtifactBundleV2
  contextPackFingerprint: string | null
}): NonNullable<LifecycleCommandEnvelopeV1['artifacts']> {
  return [
    {
      artifactType: 'security_review_report',
      artifactScope: 'issue',
      artifactUri: `system://runner-leases/${input.leaseId}/attempts/${input.leaseAttemptId}/security-review-report`,
      artifactSummary:
        input.bundle.summary ??
        `Security review report for provider attempt ${input.bundle.providerAttemptNo.toString()}`,
      producedByRole: input.bundle.agentRole,
      metadata: {
        runKind: input.bundle.runKind ?? null,
        reviewFindings: input.bundle.reviewFindings,
        recommendedNextAction: input.bundle.recommendedNextAction ?? null,
        providerExecutionMetadata: input.bundle.providerExecutionMetadata,
        contextPackFingerprint:
          input.contextPackFingerprint ??
          input.bundle.providerExecutionMetadata.contextPackFingerprint ??
          null,
      } satisfies SharedJsonObject,
    },
  ]
}

function shouldRequireSecurityReview(input: {
  highRisk: boolean
  isIntegrationHeavy: boolean
  contractRisk: string | null
  contractJson: JsonObject | null
}): boolean {
  if (input.highRisk || input.isIntegrationHeavy) {
    return true
  }

  const normalizedRisk = input.contractRisk?.trim().toLowerCase() ?? null

  if (normalizedRisk === 'high' || normalizedRisk === 'critical') {
    return true
  }

  const authAndInfraKeywords = [
    'auth',
    'oauth',
    'webhook',
    'credential',
    'token',
    'secret',
    'migration',
    'schema',
    'iac',
    'terraform',
    'pulumi',
    'cloudformation',
  ] as const

  return hasKeywordMatch(input.contractJson, authAndInfraKeywords)
}

async function insertRunnerIssueArtifacts(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    producedForStatusCode: string
  },
): Promise<void> {
  const artifacts =
    input.lease.requested_owner_role === 'test_agent'
      ? buildVerificationResultArtifact({
          leaseId: input.lease.lease_id,
          leaseAttemptId: input.attempt.lease_attempt_id,
          bundle: input.bundle,
          contextPackFingerprint: input.lease.context_pack_fingerprint,
        })
      : input.lease.requested_owner_role === 'security_agent'
        ? buildSecurityReviewReportArtifact({
            leaseId: input.lease.lease_id,
            leaseAttemptId: input.attempt.lease_attempt_id,
            bundle: input.bundle,
            contextPackFingerprint: input.lease.context_pack_fingerprint,
          })
        : []

  if (artifacts.length === 0) {
    return
  }

  await db
    .insertInto('artifact_registry')
    .values(
      artifacts.map((artifact) => ({
        issue_id: input.lease.issue_id,
        run_id: input.lease.run_id,
        transition_audit_id: null,
        artifact_type: artifact.artifactType,
        artifact_scope: artifact.artifactScope,
        artifact_uri: artifact.artifactUri,
        artifact_summary: artifact.artifactSummary ?? null,
        produced_by_role: artifact.producedByRole ?? input.bundle.agentRole,
        produced_for_status_code: input.producedForStatusCode,
        metadata: artifact.metadata ?? {},
      })),
    )
    .execute()
}

async function enqueueNextAgentReviewLease(
  db: Kysely<Database>,
  input: {
    issueId: string
    runId: string | null
    workflowId: string
    configVersion: number
    contextPackFingerprint: string | null
    commandKey: string
    requestedOwnerRole: string
    requestedRunKind: string | null
    now: Date
  },
): Promise<void> {
  const commandPayload: OutboxCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandType: 'create_runner_lease',
    issuedAt: input.now.toISOString(),
    issueId: input.issueId,
    runId: input.runId,
    workflowId: input.workflowId,
    transitionAuditId: null,
    configVersion: input.configVersion,
    commandKey: input.commandKey,
    body: {
      requestedOwnerRole: input.requestedOwnerRole,
      requestedRunKind: input.requestedRunKind,
      runnerRequirementProfile: {
        requestedStatusCode: 'agent_review',
        requestedOwnerRole: input.requestedOwnerRole,
        requestedRunKind: input.requestedRunKind,
      },
      contextPackFingerprint: input.contextPackFingerprint,
      checkpointId: null,
      intent_persisted_only: true,
    },
    intentPersistedOnly: true,
  }

  await db
    .insertInto('workflow_effect_outbox')
    .values({
      transition_audit_id: null,
      issue_id: input.issueId,
      run_id: input.runId,
      command_type: 'create_runner_lease',
      command_payload: commandPayload as unknown as JsonObject,
      idempotency_key: input.commandKey,
    })
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .execute()
}

async function maybeQueueNextAgentReviewLeaseCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    now: Date
  },
): Promise<void> {
  if (
    input.lease.requested_owner_role !== 'test_agent' &&
    input.lease.requested_owner_role !== 'security_agent'
  ) {
    return
  }

  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code', 'pinned_config_version'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'agent_review') {
    return
  }

  let nextOwnerRole: string | null = null

  if (input.lease.requested_owner_role === 'test_agent') {
    const [projection, latestContract, integrationArtifact] = await Promise.all([
      db
        .selectFrom('status_projection')
        .select(['high_risk'])
        .where('issue_id', '=', input.lease.issue_id)
        .executeTakeFirst(),
      db
        .selectFrom('linear_issue_contract_snapshots')
        .select(['risk', 'contract_json'])
        .where('issue_id', '=', input.lease.issue_id)
        .orderBy('created_at', 'desc')
        .executeTakeFirst(),
      db
        .selectFrom('artifact_registry')
        .select('id')
        .where('issue_id', '=', input.lease.issue_id)
        .where('artifact_type', 'in', [
          'integration_brief',
          'auth_decision_record',
          'credential_request',
          'credential_validation_report',
          'oauth_consent_session',
          'webhook_contract',
          'webhook_validation_report',
          'integration_smoke_report',
          'integration_go_live_checklist',
        ])
        .where('superseded_at', 'is', null)
        .executeTakeFirst(),
    ])

    nextOwnerRole = shouldRequireSecurityReview({
      highRisk: projection?.high_risk ?? false,
      isIntegrationHeavy: Boolean(integrationArtifact),
      contractRisk: latestContract?.risk ?? null,
      contractJson:
        (latestContract?.contract_json as JsonObject | null | undefined) ?? null,
    })
      ? 'security_agent'
      : 'review_agent'
  } else {
    nextOwnerRole = 'review_agent'
  }

  const nextRoleContract = await db
    .selectFrom('workflow_runtime_role_contracts')
    .select(['canonical_run_kind'])
    .where('config_version', '=', runtimeState.pinned_config_version)
    .where('role_id', '=', nextOwnerRole)
    .executeTakeFirst()

  await enqueueNextAgentReviewLease(db, {
    issueId: input.lease.issue_id,
    runId: input.lease.run_id,
    workflowId: input.lease.workflow_id,
    configVersion: runtimeState.pinned_config_version,
    contextPackFingerprint: input.lease.context_pack_fingerprint,
    commandKey: `runner-agent-review-stage:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}:${nextOwnerRole}`,
    requestedOwnerRole: nextOwnerRole,
    requestedRunKind: nextRoleContract?.canonical_run_kind ?? null,
    now: input.now,
  })
}

async function maybeQueueBuildStartedLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    runnerNodeId: string
    mcpBindingsSummary: McpBindingRefV1[]
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'ready_for_build') {
    return
  }

  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `runner-build-started:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}`,
    issueId: input.lease.issue_id,
    workflowId: input.lease.workflow_id,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.attempt.lease_attempt_id,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: 'runner-host',
    triggerCode: 'system_build_started',
    requestedStatusCode: 'coding',
    leaseId: input.lease.lease_id,
    guardOutcomes: {
      readiness_report_exists: true,
      queue_slot_reserved: true,
      active_run_opened: true,
      runner_lease_granted: true,
      no_unresolved_blockers: true,
    },
    artifacts: buildExecutionRecordArtifact({
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      requestedProvider: input.lease.requested_provider,
      effectiveProvider: input.attempt.effective_provider,
      runnerNodeId: input.runnerNodeId,
      mcpBindingsSummary: input.mcpBindingsSummary,
    }),
    metadata: {
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      executionSessionKey: input.attempt.execution_session_key,
      mcpBindingsSummary: serializeMcpBindingsSummary(input.mcpBindingsSummary),
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

// ---------------------------------------------------------------------------
// Generic completion routing system
// ---------------------------------------------------------------------------

interface RouteArtifactDef {
  artifactType: string
  artifactScope: 'issue' | 'run' | 'transition' | 'operator_question'
}

interface CompletionRoute {
  triggerCode: string
  requestedStatusCode: string
  guardOutcomes: Record<string, boolean>
  artifacts: RouteArtifactDef[]
}

/**
 * Routing table: ordered list of candidate transitions per (role, currentStatus).
 * The first route whose guards are ALL truthy wins. Routes are evaluated in order
 * so the happy path comes first, then fallbacks.
 */
interface RouteCandidate {
  triggerCode: string
  requestedStatusCode: string
  /** Guard keys that must ALL be true for this route to match. */
  requiredGuards: string[]
  artifacts: RouteArtifactDef[]
}

const COMPLETION_ROUTING_TABLE: Record<string, Record<string, RouteCandidate[]>> = {
  // intake_agent  (currentStatus: triage)
  intake_agent: {
    triage: [
      {
        triggerCode: 'system_contract_built',
        requestedStatusCode: 'planned',
        requiredGuards: ['contract_complete', 'primary_repo_resolved', 'blockers_inspected'],
        artifacts: [{ artifactType: 'intake_summary', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_duplicate_detected',
        requestedStatusCode: 'duplicate',
        requiredGuards: ['canonical_issue_identified'],
        artifacts: [{ artifactType: 'intake_summary', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_intake_complete',
        requestedStatusCode: 'needs_spec',
        requiredGuards: ['brief_valid', 'contract_incomplete'],
        artifacts: [{ artifactType: 'intake_summary', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_input_required',
        requestedStatusCode: 'needs_input',
        requiredGuards: ['critical_intake_fields_missing', 'structured_question_prepared'],
        artifacts: [
          { artifactType: 'intake_summary', artifactScope: 'issue' },
          { artifactType: 'operator_question', artifactScope: 'operator_question' },
        ],
      },
    ],
  },

  // context_agent  (supporting role, invoked at multiple statuses)
  context_agent: {
    needs_spec: [
      {
        triggerCode: 'system_context_pack_ready',
        requestedStatusCode: 'needs_spec',
        requiredGuards: ['context_pack_assembled', 'critical_sources_available'],
        artifacts: [{ artifactType: 'context_pack', artifactScope: 'issue' }],
      },
    ],
    planned: [
      {
        triggerCode: 'system_context_pack_ready',
        requestedStatusCode: 'planned',
        requiredGuards: ['context_pack_assembled', 'critical_sources_available'],
        artifacts: [{ artifactType: 'context_pack', artifactScope: 'issue' }],
      },
    ],
    ready_for_build: [
      {
        triggerCode: 'system_context_pack_ready',
        requestedStatusCode: 'ready_for_build',
        requiredGuards: ['context_pack_assembled', 'critical_sources_available'],
        artifacts: [{ artifactType: 'context_pack', artifactScope: 'issue' }],
      },
    ],
  },

  // spec_agent  (currentStatus: needs_spec)
  spec_agent: {
    needs_spec: [
      {
        triggerCode: 'system_contract_built',
        requestedStatusCode: 'planned',
        requiredGuards: ['contract_complete', 'open_questions_resolved'],
        artifacts: [{ artifactType: 'issue_contract_snapshot', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_input_required',
        requestedStatusCode: 'needs_input',
        requiredGuards: ['missing_fields_identified', 'structured_question_prepared'],
        artifacts: [
          { artifactType: 'issue_contract_snapshot', artifactScope: 'issue' },
          { artifactType: 'operator_question', artifactScope: 'operator_question' },
        ],
      },
    ],
  },

  // plan_agent  (currentStatus: planned)
  plan_agent: {
    planned: [
      {
        triggerCode: 'system_ready_check_passed',
        requestedStatusCode: 'ready_for_build',
        requiredGuards: [
          'plan_artifact_exists',
          'dependency_report_clean_or_waived',
          'context_pack_frozen',
          'no_unresolved_blockers',
          'no_unresolved_secret_slots',
          'integration_prerequisites_satisfied_or_not_required',
          'prod_access_gate_satisfied_or_not_required',
        ],
        artifacts: [
          { artifactType: 'plan_artifact', artifactScope: 'issue' },
          { artifactType: 'dependency_report', artifactScope: 'issue' },
          { artifactType: 'readiness_report', artifactScope: 'issue' },
        ],
      },
      {
        triggerCode: 'system_input_required',
        requestedStatusCode: 'needs_input',
        requiredGuards: ['structured_question_prepared', 'integration_prerequisites_missing'],
        artifacts: [
          { artifactType: 'plan_artifact', artifactScope: 'issue' },
          { artifactType: 'operator_question', artifactScope: 'operator_question' },
        ],
      },
      {
        triggerCode: 'system_block_detected',
        requestedStatusCode: 'blocked',
        requiredGuards: ['block_reason_present'],
        artifacts: [{ artifactType: 'plan_artifact', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_safety_stop',
        requestedStatusCode: 'rework',
        requiredGuards: ['planning_defect_classified'],
        artifacts: [{ artifactType: 'plan_artifact', artifactScope: 'issue' }],
      },
    ],
  },

  // release_agent  (currentStatus: deploying)
  release_agent: {
    deploying: [
      {
        triggerCode: 'system_deploy_finished',
        requestedStatusCode: 'monitoring',
        requiredGuards: ['smoke_result_present', 'deployment_identifiers_persisted'],
        artifacts: [{ artifactType: 'deploy_report', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_safety_stop',
        requestedStatusCode: 'rework',
        requiredGuards: ['deployment_failure_classified_as_rework'],
        artifacts: [{ artifactType: 'deploy_report', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_human_gate_required',
        requestedStatusCode: 'needs_human_decision',
        requiredGuards: ['escalation_memo_prepared'],
        artifacts: [{ artifactType: 'deploy_report', artifactScope: 'issue' }],
      },
    ],
  },

  // monitoring_agent  (currentStatus: monitoring)
  monitoring_agent: {
    monitoring: [
      {
        triggerCode: 'system_monitoring_passed',
        requestedStatusCode: 'done',
        requiredGuards: ['monitoring_window_elapsed', 'no_unresolved_incident_signal'],
        artifacts: [{ artifactType: 'monitoring_report', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_safety_stop',
        requestedStatusCode: 'rework',
        requiredGuards: ['incident_classified_as_rework'],
        artifacts: [{ artifactType: 'monitoring_report', artifactScope: 'issue' }],
      },
      {
        triggerCode: 'system_human_gate_required',
        requestedStatusCode: 'needs_human_decision',
        requiredGuards: ['escalation_memo_prepared'],
        artifacts: [{ artifactType: 'monitoring_report', artifactScope: 'issue' }],
      },
    ],
  },
}

/**
 * Build heuristic guard outcomes when the agent did not return explicit guards.
 * Defaults are chosen so that the most common/safe transition fires for a given
 * bundle status.
 */
function buildHeuristicGuards(
  bundle: ArtifactBundleV2,
  role: string,
): Record<string, boolean> {
  const isFailed = bundle.status === 'failed' || bundle.status === 'no_output'

  switch (role) {
    case 'context_agent':
      if (isFailed) {
        return { context_pack_assembled: false, critical_sources_available: false, known_unknowns_within_threshold: false }
      }
      return { context_pack_assembled: true, critical_sources_available: true, known_unknowns_within_threshold: true }

    case 'intake_agent':
      if (isFailed) {
        return { critical_intake_fields_missing: true, structured_question_prepared: true }
      }
      return { brief_valid: true, contract_incomplete: true }

    case 'spec_agent':
      // Without explicit guardOutcomes, assume contract is NOT complete.
      // Safe default routes to needs_input rather than blindly advancing.
      return { missing_fields_identified: true, structured_question_prepared: true }

    case 'plan_agent':
      if (isFailed) {
        return { planning_defect_classified: true }
      }
      // Without explicit guardOutcomes, assume NOT build-ready.
      // Safe default routes to needs_input rather than ready_for_build.
      return { structured_question_prepared: true, integration_prerequisites_missing: true }

    case 'release_agent':
      if (isFailed) {
        return { deployment_failure_classified_as_rework: true }
      }
      return { smoke_result_present: true, deployment_identifiers_persisted: true }

    case 'monitoring_agent':
      if (isFailed) {
        return { incident_classified_as_rework: true }
      }
      return { monitoring_window_elapsed: true, no_unresolved_incident_signal: true }

    default:
      return {}
  }
}

/**
 * Resolve guard outcomes: prefer explicit agent-returned guards, fall back to
 * heuristic defaults based on bundle status.
 */
function extractGuardOutcomesFromSummary(
  summary: string | null,
): Record<string, boolean> | null {
  if (!summary) return null

  const matches = [...summary.matchAll(/\b(\w+)\s*[=:]\s*(true|false)\b/gi)]
  if (matches.length < 2) return null

  const outcomes: Record<string, boolean> = {}

  for (const match of matches) {
    const key = match[1]
    const value = match[2].toLowerCase() === 'true'

    if (key.includes('_') && key.length >= 5 && key.length <= 60) {
      outcomes[key] = value
    }
  }

  return Object.keys(outcomes).length >= 2 ? outcomes : null
}

function resolveGuardOutcomes(
  bundle: ArtifactBundleV2,
  role: string,
): Record<string, boolean> {
  if (bundle.guardOutcomes && Object.keys(bundle.guardOutcomes).length > 0) {
    return bundle.guardOutcomes
  }
  if (bundle.summary) {
    const parsed = extractGuardOutcomesFromSummary(bundle.summary)
    if (parsed && Object.keys(parsed).length >= 2) return parsed
  }
  return buildHeuristicGuards(bundle, role)
}

/**
 * Walk the routing table for (role, currentStatus) and return the first route
 * whose required guards are all truthy, or null if nothing matches.
 */
function resolveCompletionRoute(
  guards: Record<string, boolean>,
  role: string,
  currentStatus: string,
): CompletionRoute | null {
  const roleRoutes = COMPLETION_ROUTING_TABLE[role]
  if (!roleRoutes) return null

  const candidates = roleRoutes[currentStatus]
  if (!candidates) return null

  for (const candidate of candidates) {
    const allSatisfied = candidate.requiredGuards.every((g) => guards[g] === true)
    if (allSatisfied) {
      // Build the guardOutcomes record from the required guards (all true)
      const guardOutcomes: Record<string, boolean> = {}
      for (const g of candidate.requiredGuards) {
        guardOutcomes[g] = true
      }
      return {
        triggerCode: candidate.triggerCode,
        requestedStatusCode: candidate.requestedStatusCode,
        guardOutcomes,
        artifacts: candidate.artifacts,
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Command-key prefix mapping for each role (preserves existing key patterns)
// ---------------------------------------------------------------------------
const ROLE_COMMAND_KEY_PREFIX: Record<string, string> = {
  context_agent: 'runner-context-finished',
  intake_agent: 'runner-intake-finished',
  spec_agent: 'runner-spec-finished',
  plan_agent: 'runner-plan-finished',
  release_agent: 'runner-deploy-finished',
  monitoring_agent: 'runner-monitoring-finished',
}

// ---------------------------------------------------------------------------
// Guard-aware lifecycle command functions
// ---------------------------------------------------------------------------

async function maybeQueueContextPackReadyLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState) return

  const validStatuses = ['needs_spec', 'planned', 'ready_for_build']
  if (!validStatuses.includes(runtimeState.current_status_code)) return

  const guards = resolveGuardOutcomes(input.bundle, 'context_agent')
  const route = resolveCompletionRoute(guards, 'context_agent', runtimeState.current_status_code)
  if (!route) return

  // Context_agent is a supporting role — its completion does not transition the issue.
  // It only records artifacts. The lifecycle command is a no-op self-transition
  // that records the context_pack artifact in the audit trail.
  // We skip emitting a lifecycle command to avoid unnecessary self-transitions.
  // The artifacts are already persisted by insertRunnerArtifactBundle and insertRunnerIssueArtifacts.
}

async function maybeQueueIntakeCompleteLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'triage') {
    return
  }

  const guards = resolveGuardOutcomes(input.bundle, 'intake_agent')
  const route = resolveCompletionRoute(guards, 'intake_agent', runtimeState.current_status_code)
  if (!route) return

  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `${ROLE_COMMAND_KEY_PREFIX['intake_agent']}:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}`,
    issueId: input.lease.issue_id,
    workflowId: input.lease.workflow_id,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.attempt.lease_attempt_id,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: input.bundle.agentRole,
    triggerCode: route.triggerCode,
    requestedStatusCode: route.requestedStatusCode,
    leaseId: input.lease.lease_id,
    guardOutcomes: route.guardOutcomes,
    artifacts: route.artifacts.map((a) => ({
      artifactType: a.artifactType,
      artifactScope: a.artifactScope,
      artifactUri: `system://runner-leases/${input.lease.lease_id}/attempts/${input.attempt.lease_attempt_id}/${a.artifactType}`,
      artifactSummary:
        input.bundle.summary ??
        `Intake summary for provider attempt ${input.bundle.providerAttemptNo.toString()}`,
      producedByRole: input.bundle.agentRole,
      metadata: {
        leaseId: input.lease.lease_id,
        leaseAttemptId: input.attempt.lease_attempt_id,
        providerAttemptNo: input.attempt.provider_attempt_no,
      } satisfies SharedJsonObject,
    })),
    metadata: {
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      executionSessionKey: input.attempt.execution_session_key,
      resultArtifactStatus: input.bundle.status,
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

async function maybeQueueSpecCompleteLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'needs_spec') {
    return
  }

  const guards = resolveGuardOutcomes(input.bundle, 'spec_agent')
  const route = resolveCompletionRoute(guards, 'spec_agent', runtimeState.current_status_code)
  if (!route) return

  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `${ROLE_COMMAND_KEY_PREFIX['spec_agent']}:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}`,
    issueId: input.lease.issue_id,
    workflowId: input.lease.workflow_id,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.attempt.lease_attempt_id,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: input.bundle.agentRole,
    triggerCode: route.triggerCode,
    requestedStatusCode: route.requestedStatusCode,
    leaseId: input.lease.lease_id,
    guardOutcomes: route.guardOutcomes,
    artifacts: route.artifacts.map((a) => ({
      artifactType: a.artifactType,
      artifactScope: a.artifactScope,
      artifactUri: `system://runner-leases/${input.lease.lease_id}/attempts/${input.attempt.lease_attempt_id}/${a.artifactType}`,
      artifactSummary:
        input.bundle.summary ??
        `Issue contract for provider attempt ${input.bundle.providerAttemptNo.toString()}`,
      producedByRole: input.bundle.agentRole,
      metadata: {
        leaseId: input.lease.lease_id,
        leaseAttemptId: input.attempt.lease_attempt_id,
        providerAttemptNo: input.attempt.provider_attempt_no,
      } satisfies SharedJsonObject,
    })),
    metadata: {
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      executionSessionKey: input.attempt.execution_session_key,
      resultArtifactStatus: input.bundle.status,
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

async function maybeQueuePlanCompleteLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'planned') {
    return
  }

  const guards = resolveGuardOutcomes(input.bundle, 'plan_agent')
  const route = resolveCompletionRoute(guards, 'plan_agent', runtimeState.current_status_code)
  if (!route) return

  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `${ROLE_COMMAND_KEY_PREFIX['plan_agent']}:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}`,
    issueId: input.lease.issue_id,
    workflowId: input.lease.workflow_id,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.attempt.lease_attempt_id,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: input.bundle.agentRole,
    triggerCode: route.triggerCode,
    requestedStatusCode: route.requestedStatusCode,
    leaseId: input.lease.lease_id,
    guardOutcomes: route.guardOutcomes,
    artifacts: route.artifacts.map((a) => ({
      artifactType: a.artifactType,
      artifactScope: a.artifactScope,
      artifactUri: `system://runner-leases/${input.lease.lease_id}/attempts/${input.attempt.lease_attempt_id}/${a.artifactType}`,
      artifactSummary:
        input.bundle.summary ??
        `Execution plan for provider attempt ${input.bundle.providerAttemptNo.toString()}`,
      producedByRole: input.bundle.agentRole,
      metadata: {
        leaseId: input.lease.lease_id,
        leaseAttemptId: input.attempt.lease_attempt_id,
        providerAttemptNo: input.attempt.provider_attempt_no,
      } satisfies SharedJsonObject,
    })),
    metadata: {
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      executionSessionKey: input.attempt.execution_session_key,
      resultArtifactStatus: input.bundle.status,
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

async function maybeQueueDeployCompleteLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'deploying') {
    return
  }

  const guards = resolveGuardOutcomes(input.bundle, 'release_agent')
  const route = resolveCompletionRoute(guards, 'release_agent', runtimeState.current_status_code)
  if (!route) return

  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `${ROLE_COMMAND_KEY_PREFIX['release_agent']}:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}`,
    issueId: input.lease.issue_id,
    workflowId: input.lease.workflow_id,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.attempt.lease_attempt_id,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: input.bundle.agentRole,
    triggerCode: route.triggerCode,
    requestedStatusCode: route.requestedStatusCode,
    leaseId: input.lease.lease_id,
    guardOutcomes: route.guardOutcomes,
    artifacts: [],
    metadata: {
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      executionSessionKey: input.attempt.execution_session_key,
      resultArtifactStatus: input.bundle.status,
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

async function maybeQueueMonitoringCompleteLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'monitoring') {
    return
  }

  const guards = resolveGuardOutcomes(input.bundle, 'monitoring_agent')
  const route = resolveCompletionRoute(guards, 'monitoring_agent', runtimeState.current_status_code)
  if (!route) return

  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `${ROLE_COMMAND_KEY_PREFIX['monitoring_agent']}:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}`,
    issueId: input.lease.issue_id,
    workflowId: input.lease.workflow_id,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.attempt.lease_attempt_id,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: input.bundle.agentRole,
    triggerCode: route.triggerCode,
    requestedStatusCode: route.requestedStatusCode,
    leaseId: input.lease.lease_id,
    guardOutcomes: route.guardOutcomes,
    artifacts: [],
    metadata: {
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      executionSessionKey: input.attempt.execution_session_key,
      resultArtifactStatus: input.bundle.status,
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

async function maybeQueueBuildFinishedLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'coding') {
    return
  }

  const hasChangeset =
    input.bundle.changedFiles.length > 0 ||
    input.bundle.patchRef !== null ||
    input.bundle.branchRef !== null

  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `runner-build-finished:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}`,
    issueId: input.lease.issue_id,
    workflowId: input.lease.workflow_id,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.attempt.lease_attempt_id,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: input.bundle.agentRole,
    triggerCode: 'system_build_finished',
    requestedStatusCode: 'agent_review',
    leaseId: input.lease.lease_id,
    guardOutcomes: {
      build_report_present: true,
      changeset_persisted: hasChangeset,
    },
    artifacts: buildBuildReportArtifact({
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      bundle: input.bundle,
    }),
    metadata: {
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      executionSessionKey: input.attempt.execution_session_key,
      resultArtifactStatus: input.bundle.status,
      contextPackFingerprint:
        input.lease.context_pack_fingerprint ??
        input.bundle.providerExecutionMetadata.contextPackFingerprint ??
        null,
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

async function maybeQueueReviewFinishedLifecycleCommand(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    bundle: ArtifactBundleV2
    now: Date
  },
): Promise<void> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', input.lease.issue_id)
    .executeTakeFirst()

  if (!runtimeState || runtimeState.current_status_code !== 'agent_review') {
    return
  }

  const reviewDisposition = coerceReviewDisposition(input.bundle.reviewDisposition)
  const reasonText =
    input.bundle.decisionSummary ??
    (reviewDisposition === 'rework_recommended'
      ? 'Review recommends returning to coding after a human decision.'
      : reviewDisposition === 'review_inconclusive'
        ? 'Review is inconclusive and remains visible for operator follow-up.'
        : 'Review is complete and requires a human decision.')

  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `runner-review-finished:${input.lease.lease_id}:${input.attempt.provider_attempt_no.toString()}`,
    issueId: input.lease.issue_id,
    workflowId: input.lease.workflow_id,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.attempt.lease_attempt_id,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: input.bundle.agentRole,
    triggerCode: 'system_human_gate_required',
    requestedStatusCode: 'needs_human_decision',
    leaseId: input.lease.lease_id,
    reasonText,
    guardOutcomes: {
      review_complete: true,
      human_decision_required: true,
    },
    artifacts: [
      ...buildReviewReportArtifact({
        leaseId: input.lease.lease_id,
        leaseAttemptId: input.attempt.lease_attempt_id,
        bundle: input.bundle,
        contextPackFingerprint: input.lease.context_pack_fingerprint,
      }),
      ...buildDecisionSummaryArtifact({
        leaseId: input.lease.lease_id,
        leaseAttemptId: input.attempt.lease_attempt_id,
        bundle: input.bundle,
        contextPackFingerprint: input.lease.context_pack_fingerprint,
      }),
    ],
    metadata: {
      leaseId: input.lease.lease_id,
      leaseAttemptId: input.attempt.lease_attempt_id,
      providerAttemptNo: input.attempt.provider_attempt_no,
      executionSessionKey: input.attempt.execution_session_key,
      reviewDisposition,
      reviewedBuildArtifactId: input.bundle.reviewedBuildArtifactId ?? null,
      recommendedNextAction: input.bundle.recommendedNextAction ?? null,
      contextPackFingerprint: input.lease.context_pack_fingerprint,
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

async function persistIssueBranchRefForLinearSync(
  db: Kysely<Database>,
  input: {
    issueId: string
    runId: string | null
    branchRef: string | null
  },
): Promise<void> {
  if (!input.branchRef) {
    return
  }

  if (input.runId) {
    await db
      .updateTable('issue_runs')
      .set({
        branch_ref: input.branchRef,
      })
      .where('id', '=', input.runId)
      .where((eb) =>
        eb.or([
          eb('branch_ref', 'is', null),
          eb('branch_ref', '<>', input.branchRef),
        ]),
      )
      .execute()
  }

  const latestContract = await db
    .selectFrom('linear_issue_contract_snapshots')
    .select(['primary_repo', 'affected_repos'])
    .where('issue_id', '=', input.issueId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  const candidateRepoSlugs = [
    latestContract?.primary_repo ?? null,
    ...(latestContract?.affected_repos ?? []),
  ].filter((repoSlug): repoSlug is string => typeof repoSlug === 'string' && repoSlug.length > 0)

  if (candidateRepoSlugs.length === 0) {
    return
  }

  await ensureIssueLinearSyncProjectionRepos(db, {
    issueId: input.issueId,
    repoSlugs: candidateRepoSlugs,
  })

  await upsertIssueLinearSyncProjection(db, {
    issueId: input.issueId,
    repoSlug: candidateRepoSlugs[0],
    branchRef: input.branchRef,
  })
}

async function loadLeaseAndAttemptForProtocolMutation(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    runnerNodeId: string
    executionSessionKey?: string
  },
): Promise<{
  lease: Selectable<Database['runner_leases']>
  attempt: Selectable<Database['runner_lease_attempts']>
}> {
  const attempt = await db
    .selectFrom('runner_lease_attempts')
    .selectAll()
    .where('lease_attempt_id', '=', input.leaseAttemptId)
    .executeTakeFirstOrThrow()

  assertLeaseAttemptOwnership(
    input.leaseAttemptId,
    input.runnerNodeId,
    attempt.runner_node_id,
  )

  if (
    input.executionSessionKey &&
    attempt.execution_session_key !== input.executionSessionKey
  ) {
    throw new Error(
      `Runner attempt ${input.leaseAttemptId} does not match execution session ${input.executionSessionKey}`,
    )
  }

  const lease = await db
    .selectFrom('runner_leases')
    .selectAll()
    .where('lease_id', '=', attempt.lease_id)
    .executeTakeFirstOrThrow()

  return {
    lease,
    attempt,
  }
}

export async function stageRunnerArtifactBlob(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    runnerNodeId: string
    artifactKey: string
    contentType: string
    contentBase64: string
    metadata: JsonObject
  },
): Promise<{
  artifactId: string
  artifactUri: string
  contentSha256: string
  sizeBytes: number
}> {
  const contentSha256 = buildRunnerArtifactBlobDigest(input.contentBase64)
  const sizeBytes = Buffer.from(input.contentBase64, 'base64').byteLength

  return db.transaction().execute(async (trx) => {
    await loadLeaseAndAttemptForProtocolMutation(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
      },
    )

    const existing = await trx
      .selectFrom('runner_artifact_blobs')
      .select(['artifact_blob_id'])
      .where('lease_attempt_id', '=', input.leaseAttemptId)
      .where('artifact_key', '=', input.artifactKey)
      .where('content_sha256', '=', contentSha256)
      .executeTakeFirst()

    if (existing) {
      return {
        artifactId: existing.artifact_blob_id,
        artifactUri: buildRunnerArtifactBlobUri(existing.artifact_blob_id),
        contentSha256,
        sizeBytes,
      }
    }

    const inserted = await trx
      .insertInto('runner_artifact_blobs')
      .values({
        lease_attempt_id: input.leaseAttemptId,
        artifact_key: input.artifactKey,
        content_type: input.contentType,
        content_sha256: contentSha256,
        size_bytes: sizeBytes,
        content_base64: input.contentBase64,
        metadata: input.metadata,
      })
      .returning('artifact_blob_id')
      .executeTakeFirstOrThrow()

    return {
      artifactId: inserted.artifact_blob_id,
      artifactUri: buildRunnerArtifactBlobUri(inserted.artifact_blob_id),
      contentSha256,
      sizeBytes,
    }
  })
}

export async function requestRunnerLeaseCancellation(
  db: Kysely<Database>,
  input: {
    leaseId: string
    reasonCode: string | null
    reasonText: string | null
    now?: Date
  },
): Promise<{
  leaseStatus: RunnerLeaseStatus
  leaseAttemptId: string | null
}> {
  const now = input.now ?? new Date()

  return db.transaction().execute(async (trx) => {
    const lease = await trx
      .selectFrom('runner_leases')
      .selectAll()
      .where('lease_id', '=', input.leaseId)
      .executeTakeFirstOrThrow()

    const currentAttempt = await trx
      .selectFrom('runner_lease_attempts')
      .selectAll()
      .where('lease_id', '=', input.leaseId)
      .orderBy('provider_attempt_no', 'desc')
      .executeTakeFirst()

    if (isLeaseTerminal(lease.status)) {
      return {
        leaseStatus: lease.status,
        leaseAttemptId: currentAttempt?.lease_attempt_id ?? null,
      }
    }

    if (
      lease.status === 'requested' &&
      lease.assigned_runner_node_id === null &&
      currentAttempt
    ) {
      await trx
        .updateTable('runner_lease_attempts')
        .set({
          status: 'released',
          released_at: now,
          cancel_requested_at: currentAttempt.cancel_requested_at ?? now,
          cancel_acknowledged_at: currentAttempt.cancel_acknowledged_at ?? now,
          cancel_outcome: currentAttempt.cancel_outcome ?? 'accepted',
          updated_at: now,
        })
        .where('lease_attempt_id', '=', currentAttempt.lease_attempt_id)
        .execute()

      await trx
        .updateTable('runner_leases')
        .set({
          status: 'released',
          released_at: now,
          cancellation_requested_at: lease.cancellation_requested_at ?? now,
          released_reason_code: input.reasonCode ?? 'operator_cancel_requested',
          last_error: input.reasonText,
          updated_at: now,
        })
        .where('lease_id', '=', lease.lease_id)
        .execute()

      return {
        leaseStatus: 'released',
        leaseAttemptId: currentAttempt.lease_attempt_id,
      }
    }

    await trx
      .updateTable('runner_leases')
      .set({
        status: 'cancellation_requested',
        cancellation_requested_at: lease.cancellation_requested_at ?? now,
        last_error: input.reasonText ?? lease.last_error,
        updated_at: now,
      })
      .where('lease_id', '=', lease.lease_id)
      .execute()

    if (currentAttempt && !isAttemptTerminal(currentAttempt.status)) {
      await trx
        .updateTable('runner_lease_attempts')
        .set({
          cancel_requested_at: currentAttempt.cancel_requested_at ?? now,
          updated_at: now,
        })
        .where('lease_attempt_id', '=', currentAttempt.lease_attempt_id)
        .execute()
    }

    return {
      leaseStatus: 'cancellation_requested',
      leaseAttemptId: currentAttempt?.lease_attempt_id ?? null,
    }
  })
}

export async function acknowledgeRunnerLeaseCancellation(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    runnerNodeId: string
    outcome: RunnerCancelOutcome
    checkpointRef: string | null
    now?: Date
  },
): Promise<{
  leaseStatus: RunnerLeaseStatus
  cancelOutcome: RunnerCancelOutcome
}> {
  const now = input.now ?? new Date()

  return db.transaction().execute(async (trx) => {
    const { lease, attempt } = await loadLeaseAndAttemptForProtocolMutation(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
      },
    )

    if (
      attempt.cancel_acknowledged_at &&
      attempt.cancel_outcome &&
      attempt.cancel_outcome === input.outcome
    ) {
      return {
        leaseStatus: lease.status,
        cancelOutcome: attempt.cancel_outcome,
      }
    }

    const effectiveOutcome =
      isLeaseTerminal(lease.status) || isAttemptTerminal(attempt.status)
        ? 'already_terminal'
        : input.outcome

    if (effectiveOutcome === 'accepted') {
      await trx
        .updateTable('runner_lease_attempts')
        .set({
          status: 'released',
          released_at: now,
          cancel_requested_at: attempt.cancel_requested_at ?? now,
          cancel_acknowledged_at: now,
          cancel_outcome: effectiveOutcome,
          error_class: 'canceled',
          error_message: 'Cancellation acknowledged by runner',
          checkpoint_ref: input.checkpointRef ?? attempt.checkpoint_ref,
          updated_at: now,
        })
        .where('lease_attempt_id', '=', input.leaseAttemptId)
        .execute()

      await trx
        .updateTable('runner_leases')
        .set({
          status: 'released',
          assigned_runner_node_id: null,
          released_at: now,
          released_reason_code: 'canceled_by_operator',
          last_error: 'Cancellation acknowledged by runner',
          updated_at: now,
        })
        .where('lease_id', '=', lease.lease_id)
        .execute()

      if (attempt.runner_node_id) {
        await trx
          .updateTable('runner_nodes')
          .set({
            current_active_lease_count: sql`greatest(current_active_lease_count - 1, 0)`,
            updated_at: now,
          })
          .where('runner_node_id', '=', attempt.runner_node_id)
          .execute()
      }

      return {
        leaseStatus: 'released',
        cancelOutcome: effectiveOutcome,
      }
    }

    await trx
      .updateTable('runner_lease_attempts')
      .set({
        cancel_requested_at: attempt.cancel_requested_at ?? now,
        cancel_acknowledged_at: now,
        cancel_outcome: effectiveOutcome,
        checkpoint_ref: input.checkpointRef ?? attempt.checkpoint_ref,
        updated_at: now,
      })
      .where('lease_attempt_id', '=', input.leaseAttemptId)
      .execute()

    return {
      leaseStatus: lease.status,
      cancelOutcome: effectiveOutcome,
    }
  })
}

export async function recordRunnerExecutionStarted(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    runnerNodeId: string
    executionSessionKey: string
    mcpBindingsSummary: McpBindingRefV1[]
    now?: Date
  },
): Promise<void> {
  const now = input.now ?? new Date()

  await db.transaction().execute(async (trx) => {
    const { lease, attempt } = await loadLeaseAndAttemptForProtocolMutation(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
        executionSessionKey: input.executionSessionKey,
      },
    )

    if (attempt.status === 'execution_started' || isAttemptTerminal(attempt.status)) {
      return
    }

    await trx
      .updateTable('runner_lease_attempts')
      .set({
        status: 'execution_started',
        execution_started_at: attempt.execution_started_at ?? now,
        last_heartbeat_at: now,
        mcp_bindings_summary: toJsonb(input.mcpBindingsSummary),
        updated_at: now,
      })
      .where('lease_attempt_id', '=', input.leaseAttemptId)
      .execute()

    if (!isLeaseTerminal(lease.status)) {
      await trx
        .updateTable('runner_leases')
        .set({
          status:
            lease.status === 'cancellation_requested'
              ? 'cancellation_requested'
              : 'execution_started',
          execution_started_at: lease.execution_started_at ?? now,
          last_heartbeat_at: now,
          updated_at: now,
        })
        .where('lease_id', '=', lease.lease_id)
        .execute()
    }

    await maybeQueueBuildStartedLifecycleCommand(
      trx as unknown as Kysely<Database>,
      {
        lease,
        attempt,
        runnerNodeId: input.runnerNodeId,
        mcpBindingsSummary: input.mcpBindingsSummary,
        now,
      },
    )
  })
}

export async function recordRunnerHeartbeat(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    runnerNodeId: string
    heartbeatExpiryAt: Date
    mcpPoolSnapshot?: JsonObject | null
    now?: Date
  },
): Promise<RunnerHeartbeatResponseV1> {
  const now = input.now ?? new Date()

  return db.transaction().execute(async (trx) => {
    const { lease, attempt } = await loadLeaseAndAttemptForProtocolMutation(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
      },
    )

    const cancelRequested =
      attempt.cancel_requested_at !== null &&
      attempt.cancel_acknowledged_at === null &&
      !isLeaseTerminal(lease.status) &&
      !isAttemptTerminal(attempt.status)

    if (!isAttemptTerminal(attempt.status)) {
      await trx
        .updateTable('runner_lease_attempts')
        .set({
          last_heartbeat_at: now,
          updated_at: now,
        })
        .where('lease_attempt_id', '=', input.leaseAttemptId)
        .execute()
    }

    if (!isLeaseTerminal(lease.status)) {
      await trx
        .updateTable('runner_leases')
        .set({
          last_heartbeat_at: now,
          heartbeat_expires_at: input.heartbeatExpiryAt,
          updated_at: now,
        })
        .where('lease_id', '=', lease.lease_id)
        .execute()
    }

    await trx
      .updateTable('runner_nodes')
      .set({
        last_heartbeat_at: now,
        heartbeat_expires_at: input.heartbeatExpiryAt,
        ...(input.mcpPoolSnapshot
          ? {
              latest_mcp_pool_snapshot_json: toJsonb(input.mcpPoolSnapshot),
              latest_mcp_pool_snapshot_at: now,
            }
          : {}),
        updated_at: now,
      })
      .where('runner_node_id', '=', input.runnerNodeId)
      .execute()

    return {
      schemaVersion: 1,
      cancelRequested,
    }
  })
}

export async function recordRunnerAttemptCompletion(
  db: Kysely<Database>,
  input: {
    runnerNodeId: string
    artifactBundle: ArtifactBundleV2
    executionMetadata: AgentExecutionMetadataV2
    now?: Date
  },
): Promise<{ resultArtifactId: string | null }> {
  const now = input.now ?? new Date()

  return db.transaction().execute(async (trx) => {
    const { lease, attempt } = await loadLeaseAndAttemptForProtocolMutation(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: input.artifactBundle.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
        executionSessionKey: input.artifactBundle.executionSessionKey,
      },
    )

    if (attempt.status === 'completed') {
      return {
        resultArtifactId: lease.result_artifact_id,
      }
    }

    if (isAttemptTerminal(attempt.status)) {
      throw new Error(
        `Runner attempt ${attempt.lease_attempt_id} is already terminal with status ${attempt.status}`,
      )
    }

    assertRunnerCompletionMatchesAttempt({
      lease,
      attempt,
      runnerNodeId: input.runnerNodeId,
      artifactBundle: input.artifactBundle,
      executionMetadata: input.executionMetadata,
    })
    await assertRunnerArtifactReferencesExist(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: attempt.lease_attempt_id,
        patchRef: input.artifactBundle.patchRef,
        branchRef: input.artifactBundle.branchRef,
      },
    )

    const resultArtifactId = await insertRunnerArtifactBundle(
      trx as unknown as Kysely<Database>,
      {
        lease,
        attempt,
        bundle: input.artifactBundle,
      },
    )

    await insertRunnerExecutionMetadataArtifact(
      trx as unknown as Kysely<Database>,
      {
        lease,
        attempt,
        metadata: input.executionMetadata,
      },
    )

    await completeRunnerLeaseAttemptInTransaction(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: attempt.lease_attempt_id,
        resultArtifactId,
        now,
      },
    )

    await persistIssueBranchRefForLinearSync(
      trx as unknown as Kysely<Database>,
      {
        issueId: lease.issue_id,
        runId: lease.run_id,
        branchRef: input.artifactBundle.branchRef,
      },
    )

    await insertRunnerIssueArtifacts(trx as unknown as Kysely<Database>, {
      lease,
      attempt,
      bundle: input.artifactBundle,
      producedForStatusCode:
        lease.requested_owner_role === 'test_agent' ||
        lease.requested_owner_role === 'security_agent'
          ? 'agent_review'
          : lease.requested_owner_role === 'review_agent'
            ? 'needs_human_decision'
            : 'coding',
    })

    // Guard-aware roles: route regardless of bundle.status (heuristic
    // defaults handle failed/no_output by selecting fallback transitions).
    if (lease.requested_owner_role === 'context_agent') {
      await maybeQueueContextPackReadyLifecycleCommand(
        trx as unknown as Kysely<Database>,
        {
          lease,
          attempt,
          bundle: input.artifactBundle,
          now,
        },
      )
    } else if (lease.requested_owner_role === 'intake_agent') {
      await maybeQueueIntakeCompleteLifecycleCommand(
        trx as unknown as Kysely<Database>,
        {
          lease,
          attempt,
          bundle: input.artifactBundle,
          now,
        },
      )
    } else if (lease.requested_owner_role === 'spec_agent') {
      await maybeQueueSpecCompleteLifecycleCommand(
        trx as unknown as Kysely<Database>,
        {
          lease,
          attempt,
          bundle: input.artifactBundle,
          now,
        },
      )
    } else if (lease.requested_owner_role === 'plan_agent') {
      await maybeQueuePlanCompleteLifecycleCommand(
        trx as unknown as Kysely<Database>,
        {
          lease,
          attempt,
          bundle: input.artifactBundle,
          now,
        },
      )
    } else if (lease.requested_owner_role === 'release_agent') {
      await maybeQueueDeployCompleteLifecycleCommand(
        trx as unknown as Kysely<Database>,
        {
          lease,
          attempt,
          bundle: input.artifactBundle,
          now,
        },
      )
    } else if (lease.requested_owner_role === 'monitoring_agent') {
      await maybeQueueMonitoringCompleteLifecycleCommand(
        trx as unknown as Kysely<Database>,
        {
          lease,
          attempt,
          bundle: input.artifactBundle,
          now,
        },
      )
    } else if (input.artifactBundle.status === 'completed') {
      // Non-guard-aware roles: only route on completed status
      if (lease.requested_owner_role === 'review_agent') {
        await maybeQueueReviewFinishedLifecycleCommand(
          trx as unknown as Kysely<Database>,
          {
            lease,
            attempt,
            bundle: input.artifactBundle,
            now,
          },
        )
      } else if (
        lease.requested_owner_role === 'test_agent' ||
        lease.requested_owner_role === 'security_agent'
      ) {
        await maybeQueueNextAgentReviewLeaseCommand(
          trx as unknown as Kysely<Database>,
          {
            lease,
            attempt,
            now,
          },
        )
      } else {
        await maybeQueueBuildFinishedLifecycleCommand(
          trx as unknown as Kysely<Database>,
          {
            lease,
            attempt,
            bundle: input.artifactBundle,
            now,
          },
        )
      }
    }

    return {
      resultArtifactId,
    }
  })
}

export async function recordRunnerAttemptFailure(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    runnerNodeId: string
    errorClass: ProviderFailureClass
    errorMessage: string
    fallbackReason: ProviderFallbackReason | null
    checkpointRef: string | null
    supportsCheckpointResume: boolean
    executionMetadata: AgentExecutionMetadataV2 | null
    now?: Date
  },
): Promise<{
    leaseStatus: RunnerLeaseStatus
    openedNextAttempt: boolean
    leaseAttemptId: string
  }> {
  const now = input.now ?? new Date()

  return db.transaction().execute(async (trx) => {
    const { lease, attempt } = await loadLeaseAndAttemptForProtocolMutation(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: input.leaseAttemptId,
        runnerNodeId: input.runnerNodeId,
      },
    )

    if (attempt.status === 'failed' || attempt.status === 'abandoned_for_fallback') {
      return {
        leaseStatus: lease.status,
        openedNextAttempt: lease.status === 'requested',
        leaseAttemptId: attempt.lease_attempt_id,
      }
    }

    if (
      input.executionMetadata &&
      !isLeaseTerminal(lease.status) &&
      !isAttemptTerminal(attempt.status)
    ) {
      const metadataMismatches = assertRunnerExecutionMetadataMatchesAttempt({
        lease,
        attempt,
        runnerNodeId: input.runnerNodeId,
        executionMetadata: input.executionMetadata,
      })

      if (metadataMismatches.length > 0) {
        throw new Error(
          `Runner failure payload does not match durable attempt state: ${metadataMismatches.join(', ')}`,
        )
      }

      await insertRunnerExecutionMetadataArtifact(
        trx as unknown as Kysely<Database>,
        {
          lease,
          attempt,
          metadata: input.executionMetadata,
        },
      )
    }

    return failRunnerLeaseAttemptInTransaction(
      trx as unknown as Kysely<Database>,
      {
        leaseAttemptId: input.leaseAttemptId,
        errorClass: input.errorClass,
        errorMessage: input.errorMessage,
        fallbackReason: input.fallbackReason,
        checkpointRef: input.checkpointRef,
        supportsCheckpointResume: input.supportsCheckpointResume,
        now,
      },
    )
  })
}

function mapRoleExecutionPolicy(
  row: Selectable<Database['workflow_role_execution_policies']>,
): RoleExecutionPolicyV1 {
  return {
    ownerRole: row.owner_role,
    primaryProvider: row.primary_provider,
    secondaryProvider: row.secondary_provider,
    fallbackTriggers: row.fallback_triggers,
    maxProviderFailovers: row.max_provider_failovers,
    mcpProfileRef: row.mcp_profile_ref,
    requiredCapabilities: row.required_capabilities,
  }
}

function mapRuntimeRoleContract(
  row: Selectable<Database['workflow_runtime_role_contracts']>,
): RuntimeRoleContractV1 {
  return {
    roleId: row.role_id,
    canonicalRunKind: row.canonical_run_kind,
    allowedStatusOwnership: row.allowed_status_ownership,
    requiredInputArtifactTypes: row.required_input_artifact_types,
    requiredOutputArtifactTypes: row.required_output_artifact_types,
    humanGatePolicy: row.human_gate_policy,
    escalationReasonCodes: row.escalation_reason_codes,
    activationMode: row.activation_mode,
  }
}

function mapExecutionBundleRoleCharter(
  row: Selectable<Database['agent_role_charters']>,
  roleCharterRef: string,
): RunnerExecutionBundleRoleCharterV1 {
  return {
    roleCharterRef,
    roleId: row.role_id,
    charterVersion: row.charter_version,
    canonicalRunKind: row.canonical_run_kind,
    frontmatterSummary: row.frontmatter_json,
    sourceRefs: row.source_refs,
    relativePath: row.relative_path,
    roleFingerprint: row.role_fingerprint,
    body: row.body,
  }
}

function mapExecutionBundlePromptFamily(
  row: Selectable<Database['agent_prompt_families']>,
): RunnerExecutionBundlePromptFamilyV1 {
  return {
    promptFamilyRef: row.prompt_family_ref,
    familyId: row.family_id,
    familyVersion: row.family_version,
    providerCompatibility: row.provider_compatibility,
    compatibleRoles: row.compatible_roles,
    compatibleSkillPacks: row.compatible_skill_packs,
    sourceRefs: row.source_refs,
    relativePath: row.relative_path,
    familyFingerprint: row.family_fingerprint,
    body: row.body,
  }
}

function mapExecutionBundleSkillPack(
  row: Selectable<Database['agent_skill_packs']>,
): RunnerExecutionBundleSkillPackV1 {
  return {
    packId: row.pack_id,
    packVersion: row.pack_version,
    purpose: row.purpose,
    skillRefs: row.skill_refs,
    optionalSkillRefs: row.optional_skill_refs,
    providers: row.providers,
    activationConditions: row.activation_conditions,
    promptFamilyRefs: row.prompt_family_refs,
    deniedActionsOverlay: row.denied_actions_overlay,
    humanGateOverlay: row.human_gate_overlay,
    sourceRefs: row.source_refs,
    skillPackFingerprint: row.skill_pack_fingerprint,
  }
}

function requireExecutionBundleValue<T>(
  value: T | null | undefined,
  options: { code: string; message: string; statusCode?: number },
): T {
  if (value === null || value === undefined) {
    throw new RunnerExecutionBundleError(options.message, {
      code: options.code,
      statusCode: options.statusCode ?? 404,
    })
  }

  return value
}

function stripMarkdownFrontmatter(markdown: string): {
  body: string
  frontmatter: string | null
} {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(markdown)

  if (!match) {
    return {
      body: markdown.trim(),
      frontmatter: null,
    }
  }

  return {
    body: markdown.slice(match[0].length).trim(),
    frontmatter: match[1],
  }
}

function extractFrontmatterScalar(
  frontmatter: string | null,
  key: string,
): string | null {
  if (!frontmatter) {
    return null
  }

  const match = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(frontmatter)
  return match?.[1]?.trim() ?? null
}

export async function loadExecutionBundleSystemInstruction(input: {
  releaseId: string
  roleId: string
}): Promise<RunnerExecutionBundleSystemInstructionV1 | null> {
  const candidateRoots = [
    {
      baseDir: resolveAgentReleaseFolder(input.releaseId),
      resolutionSource: 'release_snapshot' as const,
    },
    {
      baseDir: resolveAgentConfigFolder(),
      resolutionSource: 'working_tree_fallback' as const,
    },
  ]
  const candidateNames = [
    `${input.roleId}_system_instructions.md`,
    `${input.roleId}.md`,
  ]

  for (const root of candidateRoots) {
    for (const candidateName of candidateNames) {
      const relativePath = `system-instructions/${candidateName}`
      const absolutePath = path.join(root.baseDir, 'system-instructions', candidateName)

      try {
        const markdown = await readFile(absolutePath, 'utf8')
        const { body, frontmatter } = stripMarkdownFrontmatter(markdown)

        return {
          roleId: extractFrontmatterScalar(frontmatter, 'role_id') ?? input.roleId,
          instructionVersion: extractFrontmatterScalar(frontmatter, 'version'),
          relativePath,
          resolutionSource: root.resolutionSource,
          body,
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue
        }

        throw error
      }
    }
  }

  return null
}

export async function getRunnerExecutionBundle(
  db: Kysely<Database>,
  leaseAttemptId: string,
): Promise<RunnerExecutionBundleV1> {
  const attempt = await db
    .selectFrom('runner_lease_attempts as attempts')
    .innerJoin('runner_leases as leases', 'leases.lease_id', 'attempts.lease_id')
    .leftJoin(
      'agent_library_releases as releases',
      'releases.release_id',
      'leases.agent_library_release_id',
    )
    .select([
      'attempts.lease_attempt_id as lease_attempt_id',
      'attempts.provider_attempt_no as provider_attempt_no',
      'attempts.resolved_skill_refs as resolved_skill_refs',
      'attempts.skipped_optional_skill_refs as skipped_optional_skill_refs',
      'leases.lease_id as lease_id',
      'leases.attempt_count as attempt_count',
      'leases.agent_library_release_id as agent_library_release_id',
      'leases.role_execution_policy_version as role_execution_policy_version',
      'leases.requested_owner_role as requested_owner_role',
      'leases.task_instructions_ref as task_instructions_ref',
      'leases.prompt_version as prompt_version',
      'leases.role_charter_ref as role_charter_ref',
      'leases.prompt_bundle_fingerprint as prompt_bundle_fingerprint',
      'leases.skill_pack_refs as skill_pack_refs',
      'leases.resolved_prompt_family_refs as resolved_prompt_family_refs',
      'releases.library_fingerprint as library_fingerprint',
    ])
    .where('attempts.lease_attempt_id', '=', leaseAttemptId)
    .executeTakeFirst()

  if (!attempt) {
    throw new RunnerExecutionBundleError(
      `Runner execution bundle not found for lease attempt ${leaseAttemptId}`,
      {
        code: 'execution_bundle_not_found',
        statusCode: 404,
      },
    )
  }

  if (attempt.provider_attempt_no !== attempt.attempt_count) {
    throw new RunnerExecutionBundleError(
      `Lease attempt ${leaseAttemptId} is stale and no longer matches the active attempt snapshot`,
      {
        code: 'execution_bundle_stale_attempt',
        statusCode: 409,
      },
    )
  }

  const releaseId = requireExecutionBundleValue(attempt.agent_library_release_id, {
    code: 'execution_bundle_missing_release',
    message: `Lease attempt ${leaseAttemptId} is missing an agent library release pin`,
  })
  const agentLibraryFingerprint = requireExecutionBundleValue(
    attempt.library_fingerprint,
    {
      code: 'execution_bundle_missing_release_fingerprint',
      message: `Agent library release ${releaseId} is missing a mirrored library fingerprint`,
    },
  )
  const taskInstructionsRef = requireExecutionBundleValue(
    attempt.task_instructions_ref,
    {
      code: 'execution_bundle_missing_task_instructions_ref',
      message: `Lease attempt ${leaseAttemptId} is missing a taskInstructionsRef`,
    },
  )
  const promptVersion = requireExecutionBundleValue(attempt.prompt_version, {
    code: 'execution_bundle_missing_prompt_version',
    message: `Lease attempt ${leaseAttemptId} is missing a promptVersion`,
  })
  const roleCharterRef = requireExecutionBundleValue(attempt.role_charter_ref, {
    code: 'execution_bundle_missing_role_charter_ref',
    message: `Lease attempt ${leaseAttemptId} is missing a roleCharterRef`,
  })
  const promptBundleFingerprint = requireExecutionBundleValue(
    attempt.prompt_bundle_fingerprint,
    {
      code: 'execution_bundle_missing_prompt_bundle_fingerprint',
      message: `Lease attempt ${leaseAttemptId} is missing a prompt bundle fingerprint`,
    },
  )
  const resolvedPromptFamilyRefs = normalizeOrderedUniqueStringArray(
    attempt.resolved_prompt_family_refs,
  )
  const skillPackRefs = normalizeOrderedUniqueStringArray(attempt.skill_pack_refs)
  const resolvedSkillRefs = normalizeOrderedUniqueStringArray(
    attempt.resolved_skill_refs,
  )
  const skippedOptionalSkillRefs = normalizeOrderedUniqueStringArray(
    attempt.skipped_optional_skill_refs,
  )

  const [
    roleCharterRow,
    promptFamilyRows,
    skillPackRows,
    rolePolicyRow,
    runtimeRoleRow,
    systemInstruction,
  ] =
    await Promise.all([
      db
        .selectFrom('agent_role_charters')
        .selectAll()
        .where('release_id', '=', releaseId)
        .where('role_id', '=', roleCharterRef.split('/').at(-1) ?? roleCharterRef)
        .executeTakeFirst(),
      resolvedPromptFamilyRefs.length === 0
        ? Promise.resolve([])
        : db
            .selectFrom('agent_prompt_families')
            .selectAll()
            .where('release_id', '=', releaseId)
            .where('prompt_family_ref', 'in', resolvedPromptFamilyRefs)
            .execute(),
      skillPackRefs.length === 0
        ? Promise.resolve([])
        : db
            .selectFrom('agent_skill_packs')
            .selectAll()
            .where('release_id', '=', releaseId)
            .where('pack_id', 'in', skillPackRefs)
            .execute(),
      db
        .selectFrom('workflow_role_execution_policies')
        .selectAll()
        .where('config_version', '=', attempt.role_execution_policy_version)
        .where('owner_role', '=', attempt.requested_owner_role)
        .executeTakeFirst(),
      db
        .selectFrom('workflow_runtime_role_contracts')
        .selectAll()
        .where('config_version', '=', attempt.role_execution_policy_version)
        .where('role_id', '=', attempt.requested_owner_role)
        .executeTakeFirst(),
      loadExecutionBundleSystemInstruction({
        releaseId,
        roleId: attempt.requested_owner_role,
      }),
    ])

  const roleCharter = mapExecutionBundleRoleCharter(
    requireExecutionBundleValue(roleCharterRow, {
      code: 'execution_bundle_missing_role_charter',
      message: `Role charter ${roleCharterRef} is missing from mirrored runtime truth`,
    }),
    roleCharterRef,
  )

  const promptFamilyMap = new Map(
    promptFamilyRows.map((row) => [row.prompt_family_ref, row]),
  )
  const promptFamilies = resolvedPromptFamilyRefs.map((ref) =>
    mapExecutionBundlePromptFamily(
      requireExecutionBundleValue(promptFamilyMap.get(ref), {
        code: 'execution_bundle_missing_prompt_family',
        message: `Prompt family ${ref} is missing from mirrored runtime truth`,
      }),
    ),
  )

  const skillPackMap = new Map(skillPackRows.map((row) => [row.pack_id, row]))
  const skillPacks = skillPackRefs.map((ref) =>
    mapExecutionBundleSkillPack(
      requireExecutionBundleValue(skillPackMap.get(ref), {
        code: 'execution_bundle_missing_skill_pack',
        message: `Skill pack ${ref} is missing from mirrored runtime truth`,
      }),
    ),
  )

  return {
    schemaVersion: 1,
    leaseAttemptId: attempt.lease_attempt_id,
    agentLibraryReleaseId: releaseId,
    agentLibraryFingerprint,
    taskInstructionsRef,
    promptVersion,
    roleCharterRef,
    promptBundleFingerprint,
    resolvedPromptFamilyRefs,
    skillPackRefs,
    resolvedSkillRefs,
    skippedOptionalSkillRefs,
    systemInstruction,
    roleCharter,
    promptFamilies,
    skillPacks,
    runtimeRoleContract: mapRuntimeRoleContract(
      requireExecutionBundleValue(runtimeRoleRow, {
        code: 'execution_bundle_missing_runtime_role_contract',
        message: `Runtime role contract ${attempt.requested_owner_role}@${attempt.role_execution_policy_version.toString()} is missing`,
      }),
    ),
    roleExecutionPolicy: mapRoleExecutionPolicy(
      requireExecutionBundleValue(rolePolicyRow, {
        code: 'execution_bundle_missing_role_execution_policy',
        message: `Role execution policy ${attempt.requested_owner_role}@${attempt.role_execution_policy_version.toString()} is missing`,
      }),
    ),
  }
}

function mapRunnerInventoryRow(
  row: Selectable<Database['runner_inventory_view']>,
): RunnerInventoryView {
  return {
    runnerNodeId: row.runner_node_id,
    hostGroupId: row.host_group_id,
    displayName: row.display_name,
    hostName: row.host_name,
    status: row.status,
    providers: row.providers,
    skillsAvailable: normalizeUniqueStringArray(row.skills_available),
    activeAgentLibraryReleaseId: row.active_agent_library_release_id,
    activeAgentLibraryFingerprint: row.active_agent_library_fingerprint,
    skillSyncStatus: normalizeRunnerSkillSyncStatus(row.skill_sync_status),
    skillSyncError: row.skill_sync_error,
    installedSkillBundles: normalizeInstalledSkillBundles(
      row.installed_skill_bundles,
    ),
    providerSupportedSkillPackRefs: {},
    currentActiveLeaseCount: row.current_active_lease_count,
    maxConcurrentLeases: row.max_concurrent_leases,
    manifestVersion: row.manifest_version,
    lastHeartbeatAt: toIsoString(row.last_heartbeat_at),
    heartbeatExpiresAt: toIsoString(row.heartbeat_expires_at),
    sharedMcpProcessCount: row.shared_mcp_process_count,
    mcpServerCatalog: row.mcp_server_catalog,
    integrationCapabilities: resolveIntegrationCapabilities(
      row.integration_capabilities_json,
    ),
  }
}

function mapRunnerMcpPoolSnapshotRow(
  row: Selectable<Database['runner_nodes']>,
): RunnerMcpPoolSnapshotView | null {
  return buildRunnerMcpPoolSnapshotView(row)
}

function mapRunnerLeaseRow(
  row:
    | Selectable<Database['runner_leases']>
    | Selectable<Database['active_runner_leases_view']>
    | Selectable<Database['stale_runner_leases_view']>,
): RunnerLeaseView {
  return {
    leaseId: row.lease_id,
    issueId: row.issue_id,
    runId: row.run_id,
    workflowId: row.workflow_id,
    requestedProvider: row.requested_provider,
    requestedOwnerRole: row.requested_owner_role,
    requestedRunKind: row.requested_run_kind,
    roleExecutionPolicyVersion: row.role_execution_policy_version,
    agentLibraryReleaseId: row.agent_library_release_id,
    promptVersion: row.prompt_version,
    taskInstructionsRef: row.task_instructions_ref,
    roleCharterRef: row.role_charter_ref,
    promptBundleFingerprint: row.prompt_bundle_fingerprint,
    skillPackRefs: normalizeStringArray(row.skill_pack_refs),
    effectiveSkillFingerprint: row.effective_skill_fingerprint,
    contextPackFingerprint: row.context_pack_fingerprint,
    promptResolutionSource: row.prompt_resolution_source ?? 'legacy_synthetic',
    status: row.status,
    assignedRunnerNodeId: row.assigned_runner_node_id,
    requestedAt: row.requested_at.toISOString(),
    acquiredAt: toIsoString(row.acquired_at),
    executionStartedAt: toIsoString(row.execution_started_at),
    lastHeartbeatAt: toIsoString(row.last_heartbeat_at),
    heartbeatExpiresAt: toIsoString(row.heartbeat_expires_at),
    failedAt: toIsoString(row.failed_at),
    completedAt: toIsoString(row.completed_at),
    releasedAt: toIsoString(row.released_at),
    releasedReasonCode: row.released_reason_code,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
  }
}

function mapRunnerLeaseAttemptRow(
  row: Selectable<Database['runner_lease_attempts']>,
): RunnerLeaseAttemptView {
  return {
    leaseAttemptId: row.lease_attempt_id,
    leaseId: row.lease_id,
    providerAttemptNo: row.provider_attempt_no,
    requestedProvider: row.requested_provider,
    effectiveProvider: row.effective_provider,
    fallbackFromProvider: row.fallback_from_provider,
    fallbackReason: row.fallback_reason,
    executionSessionKey: row.execution_session_key,
    mcpProfileRef: row.mcp_profile_ref,
    mcpBindingsSummary: row.mcp_bindings_summary,
    installedSkillRefs: normalizeUniqueStringArray(row.installed_skill_refs),
    resolvedSkillRefs: normalizeUniqueStringArray(row.resolved_skill_refs),
    skippedOptionalSkillRefs: normalizeUniqueStringArray(
      row.skipped_optional_skill_refs,
    ),
    runnerNodeId: row.runner_node_id,
    hostGroupId: row.host_group_id,
    status: row.status,
    acquiredAt: toIsoString(row.acquired_at),
    executionStartedAt: toIsoString(row.execution_started_at),
    lastHeartbeatAt: toIsoString(row.last_heartbeat_at),
    failedAt: toIsoString(row.failed_at),
    completedAt: toIsoString(row.completed_at),
    releasedAt: toIsoString(row.released_at),
    errorClass: row.error_class,
    errorMessage: row.error_message,
    checkpointRef: row.checkpoint_ref,
    cancelRequestedAt: toIsoString(row.cancel_requested_at),
    cancelAcknowledgedAt: toIsoString(row.cancel_acknowledged_at),
    cancelOutcome: row.cancel_outcome,
  }
}

export async function getRoleExecutionPolicy(
  db: Kysely<Database>,
  input: { configVersion: number; ownerRole: string },
): Promise<RoleExecutionPolicyV1 | null> {
  const row = await db
    .selectFrom('workflow_role_execution_policies')
    .selectAll()
    .where('config_version', '=', input.configVersion)
    .where('owner_role', '=', input.ownerRole)
    .executeTakeFirst()

  return row ? mapRoleExecutionPolicy(row) : null
}

export async function listRunnerInventoryView(
  db: Kysely<Database>,
): Promise<RunnerInventoryView[]> {
  const rows = await db
    .selectFrom('runner_inventory_view')
    .selectAll()
    .orderBy('runner_node_id', 'asc')
    .execute()

  const inventoryRows = rows.map(mapRunnerInventoryRow)
  const releaseIds = [
    ...new Set(
      inventoryRows
        .map((row) => row.activeAgentLibraryReleaseId)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
    ),
  ]

  if (releaseIds.length === 0) {
    return inventoryRows
  }

  const skillPacks = await db
    .selectFrom('agent_skill_packs')
    .select(['release_id', 'pack_id', 'providers', 'skill_refs'])
    .where('release_id', 'in', releaseIds)
    .execute()

  const skillPacksByReleaseId = new Map<string, InventorySkillPackRow[]>()
  for (const pack of skillPacks) {
    const existing = skillPacksByReleaseId.get(pack.release_id) ?? []
    existing.push(pack)
    skillPacksByReleaseId.set(pack.release_id, existing)
  }

  return inventoryRows.map((row) => {
    const activeBundle =
      row.activeAgentLibraryReleaseId === null
        ? null
        : findInstalledSkillBundle(
            row.installedSkillBundles,
            row.activeAgentLibraryReleaseId,
          )
    const installedSkillSet = new Set(activeBundle?.skillIds ?? [])
    const providerSupportedSkillPackRefs = Object.fromEntries(
      row.providers.map((provider) => [
        provider,
        (
          row.activeAgentLibraryReleaseId
            ? skillPacksByReleaseId.get(row.activeAgentLibraryReleaseId) ?? []
            : []
        )
          .filter((pack) =>
            canRunnerSupportSkillPack(provider, installedSkillSet, pack),
          )
          .map((pack) => pack.pack_id)
          .sort((left, right) => left.localeCompare(right)),
      ]),
    ) as Partial<Record<AgentProvider, string[]>>

    return {
      ...row,
      providerSupportedSkillPackRefs,
    }
  })
}

export async function listRunnerMcpPoolSnapshotsView(
  db: Kysely<Database>,
): Promise<RunnerMcpPoolSnapshotView[]> {
  const rows = await db
    .selectFrom('runner_nodes')
    .selectAll()
    .where('latest_mcp_pool_snapshot_at', 'is not', null)
    .orderBy('runner_node_id', 'asc')
    .execute()

  return rows
    .map(mapRunnerMcpPoolSnapshotRow)
    .filter((snapshot): snapshot is RunnerMcpPoolSnapshotView => snapshot !== null)
}

export async function listActiveRunnerLeasesView(
  db: Kysely<Database>,
): Promise<RunnerLeaseView[]> {
  const rows = await db
    .selectFrom('active_runner_leases_view')
    .selectAll()
    .orderBy('requested_at', 'asc')
    .execute()

  return rows.map(mapRunnerLeaseRow)
}

export async function listStaleRunnerLeasesView(
  db: Kysely<Database>,
): Promise<RunnerLeaseView[]> {
  const rows = await db
    .selectFrom('stale_runner_leases_view')
    .selectAll()
    .orderBy('requested_at', 'asc')
    .execute()

  return rows.map(mapRunnerLeaseRow)
}

export async function getRunnerLeaseDetailView(
  db: Kysely<Database>,
  leaseId: string,
): Promise<RunnerLeaseDetailView | null> {
  const lease = await db
    .selectFrom('runner_leases')
    .selectAll()
    .where('lease_id', '=', leaseId)
    .executeTakeFirst()

  if (!lease) {
    return null
  }

  const attempts = await db
    .selectFrom('runner_lease_attempts')
    .selectAll()
    .where('lease_id', '=', leaseId)
    .orderBy('provider_attempt_no', 'asc')
    .execute()

  return {
    lease: mapRunnerLeaseRow(lease),
    attempts: attempts.map(mapRunnerLeaseAttemptRow),
    timeline: buildRunnerLeaseTimeline(lease, attempts),
  }
}

export async function getProviderFailoverMetricsView(
  db: Kysely<Database>,
): Promise<ProviderFailoverMetricsView> {
  const row = await db
    .selectFrom('provider_failover_metrics_view')
    .selectAll()
    .executeTakeFirst()

  return {
    totalLeases: row?.total_leases ?? 0,
    fallbackTriggeredCount: row?.fallback_triggered_count ?? 0,
    providerFallbackExhaustedCount:
      row?.provider_fallback_exhausted_count ?? 0,
    providerLimitExhaustionEvents:
      row?.provider_limit_exhaustion_events ?? 0,
    fallbackReasonCounts:
      (row?.fallback_reason_counts as Record<string, number> | undefined) ?? {},
    mcpPoolReuseRatio: row?.mcp_pool_reuse_ratio ?? null,
    sharedMcpProcessCount: row?.shared_mcp_process_count ?? 0,
  }
}

export async function upsertRunnerCapabilityManifest(
  db: Kysely<Database>,
  input: {
    manifest: RunnerCapabilityManifestV1
    authSubject: string
    displayName?: string | null
    now?: Date
  },
): Promise<void> {
  const now = input.now ?? new Date()
  const displayName = input.displayName ?? input.manifest.runnerNodeId

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('runner_nodes')
      .values({
        runner_node_id: input.manifest.runnerNodeId,
        display_name: displayName,
        host_name: input.manifest.host.hostName,
        host_group_id: input.manifest.hostGroupId,
        status: 'online',
        auth_subject: input.authSubject,
        max_concurrent_leases: input.manifest.maxConcurrentLeases,
        current_active_lease_count: 0,
        last_heartbeat_at: now,
        heartbeat_expires_at: now,
        manifest_version: input.manifest.manifestVersion,
        metadata_json: toJsonb({
          providers: input.manifest.providers,
        } satisfies JsonObject),
      })
      .onConflict((oc) =>
        oc.column('runner_node_id').doUpdateSet({
          display_name: displayName,
          host_name: input.manifest.host.hostName,
          host_group_id: input.manifest.hostGroupId,
          status: 'online',
          auth_subject: input.authSubject,
          max_concurrent_leases: input.manifest.maxConcurrentLeases,
          last_heartbeat_at: now,
          heartbeat_expires_at: now,
          manifest_version: sql`${input.manifest.manifestVersion}`,
          metadata_json: toJsonb({
            providers: input.manifest.providers,
          } satisfies JsonObject),
          updated_at: now,
        }),
      )
      .execute()

    await trx
      .updateTable('runner_capabilities')
      .set({ is_active: false })
      .where('runner_node_id', '=', input.manifest.runnerNodeId)
      .where('manifest_version', '!=', input.manifest.manifestVersion)
      .execute()

    await trx
      .insertInto('runner_capabilities')
      .values({
        runner_node_id: input.manifest.runnerNodeId,
        manifest_version: input.manifest.manifestVersion,
        providers: toJsonb(input.manifest.providers),
        provider_cli_versions: toJsonb(input.manifest.providerCliVersions),
        supported_roles: toJsonb(input.manifest.supportedRoles),
        supported_run_kinds: toJsonb(input.manifest.supportedRunKinds),
        supported_repo_kinds: toJsonb(input.manifest.supportedRepoKinds),
        mcp_server_catalog: toJsonb(input.manifest.mcpServerCatalog),
        tool_baseline: toJsonb(input.manifest.toolBaseline),
        skills_available: toJsonb(
          normalizeUniqueStringArray(input.manifest.skillsAvailable),
        ),
        active_agent_library_release_id:
          input.manifest.activeAgentLibraryReleaseId ?? null,
        active_agent_library_fingerprint:
          input.manifest.activeAgentLibraryFingerprint ?? null,
        skill_sync_status: normalizeRunnerSkillSyncStatus(
          input.manifest.skillSyncStatus ?? 'degraded',
        ),
        skill_sync_error: input.manifest.skillSyncError ?? null,
        installed_skill_bundles: toJsonb(
          normalizeInstalledSkillBundles(
            input.manifest.installedSkillBundles ?? [],
          ),
        ),
        workspace_root: input.manifest.workspaceRoot,
        worktree_root: input.manifest.worktreeRoot,
        default_shell: 'zsh',
        host_os: input.manifest.host.hostOs,
        host_arch: input.manifest.host.hostArch,
        supports_interrupt: input.manifest.supportsInterrupt,
        supports_checkpoint_resume: input.manifest.supportsCheckpointResume,
        supports_artifact_upload: input.manifest.supportsArtifactUpload,
        supports_concurrent_sessions: input.manifest.supportsConcurrentSessions,
        integration_capabilities_json: toJsonb(input.manifest.integration),
        is_active: true,
        published_at: now,
      })
      .onConflict((oc) =>
        oc.columns(['runner_node_id', 'manifest_version']).doUpdateSet({
          providers: toJsonb(input.manifest.providers),
          provider_cli_versions: toJsonb(input.manifest.providerCliVersions),
          supported_roles: toJsonb(input.manifest.supportedRoles),
          supported_run_kinds: toJsonb(input.manifest.supportedRunKinds),
          supported_repo_kinds: toJsonb(input.manifest.supportedRepoKinds),
          mcp_server_catalog: toJsonb(input.manifest.mcpServerCatalog),
          tool_baseline: toJsonb(input.manifest.toolBaseline),
          skills_available: toJsonb(
            normalizeUniqueStringArray(input.manifest.skillsAvailable),
          ),
          active_agent_library_release_id:
            input.manifest.activeAgentLibraryReleaseId ?? null,
          active_agent_library_fingerprint:
            input.manifest.activeAgentLibraryFingerprint ?? null,
          skill_sync_status: normalizeRunnerSkillSyncStatus(
            input.manifest.skillSyncStatus ?? 'degraded',
          ),
          skill_sync_error: input.manifest.skillSyncError ?? null,
          installed_skill_bundles: toJsonb(
            normalizeInstalledSkillBundles(
              input.manifest.installedSkillBundles ?? [],
            ),
          ),
          workspace_root: input.manifest.workspaceRoot,
          worktree_root: input.manifest.worktreeRoot,
          default_shell: 'zsh',
          host_os: input.manifest.host.hostOs,
          host_arch: input.manifest.host.hostArch,
          supports_interrupt: input.manifest.supportsInterrupt,
          supports_checkpoint_resume: input.manifest.supportsCheckpointResume,
          supports_artifact_upload: input.manifest.supportsArtifactUpload,
          supports_concurrent_sessions: input.manifest.supportsConcurrentSessions,
          integration_capabilities_json: toJsonb(input.manifest.integration),
          is_active: true,
          published_at: now,
        }),
      )
      .execute()
  })
}

export async function createRunnerLeaseFromCommand(
  db: Kysely<Database>,
  input: {
    commandKey: string
    issueId: string
    runId: string | null
    workflowId: string
    configVersion: number
    requestedOwnerRole: string
    requestedRunKind: string | null
    runnerRequirementProfile: JsonObject
    contextPackFingerprint: string | null
    checkpointId: string | null
    transitionAuditId?: string | null
  },
): Promise<{ leaseId: string; leaseAttemptId: string }> {
  const requestedStatusCode =
    (
      input.runnerRequirementProfile as
        | { requestedStatusCode?: string | null }
        | null
    )?.requestedStatusCode ?? null

  const normalizedRequestedOwnerRole = input.requestedOwnerRole
  const normalizedRequestedRunKind = input.requestedRunKind

  const normalizedRunnerRequirementProfile = {
    ...input.runnerRequirementProfile,
    ...(requestedStatusCode ? { requestedStatusCode } : {}),
    requestedOwnerRole: normalizedRequestedOwnerRole,
    requestedRunKind: normalizedRequestedRunKind,
  } satisfies JsonObject

  const existing = await db
    .selectFrom('runner_leases')
    .select(['lease_id'])
    .where('requested_by_command_key', '=', input.commandKey)
    .executeTakeFirst()

  if (existing) {
    const attempt = await db
      .selectFrom('runner_lease_attempts')
      .select(['lease_attempt_id'])
      .where('lease_id', '=', existing.lease_id)
      .orderBy('provider_attempt_no', 'desc')
      .executeTakeFirstOrThrow()

    return {
      leaseId: existing.lease_id,
      leaseAttemptId: attempt.lease_attempt_id,
    }
  }

  const policy = await getRoleExecutionPolicy(db, {
    configVersion: input.configVersion,
    ownerRole: normalizedRequestedOwnerRole,
  })

  if (!policy) {
    throw new Error(
      `Missing role execution policy for ${normalizedRequestedOwnerRole} at config version ${input.configVersion.toString()}`,
    )
  }

  return db.transaction().execute(async (trx) => {
    const existingLease = await trx
      .selectFrom('runner_leases')
      .select(['lease_id', 'run_id', 'agent_library_release_id'])
      .where('issue_id', '=', input.issueId)
      .where('workflow_id', '=', input.workflowId)
      .where('requested_owner_role', '=', normalizedRequestedOwnerRole)
      .where(
        'requested_run_kind',
        '=',
        normalizedRequestedRunKind as RunnerLeaseView['requestedRunKind'],
      )
      .where('status', 'in', ACTIVE_LEASE_STATUSES)
      .orderBy('requested_at', 'desc')
      .executeTakeFirst()

    if (existingLease) {
      if (input.runId !== null && existingLease.run_id === null) {
        await trx
          .updateTable('runner_leases')
          .set({
            run_id: input.runId,
            updated_at: new Date(),
          })
          .where('lease_id', '=', existingLease.lease_id)
          .execute()

        if (existingLease.agent_library_release_id) {
          const release = await trx
            .selectFrom('agent_library_releases')
            .select(['library_fingerprint'])
            .where('release_id', '=', existingLease.agent_library_release_id)
            .executeTakeFirst()

          await trx
            .updateTable('issue_runs')
            .set({
              agent_library_release_id: existingLease.agent_library_release_id,
              agent_library_fingerprint: release?.library_fingerprint ?? null,
            })
            .where('id', '=', input.runId)
            .where('agent_library_release_id', 'is', null)
            .execute()
        }
      }

      const attempt = await trx
        .selectFrom('runner_lease_attempts')
        .select(['lease_attempt_id'])
        .where('lease_id', '=', existingLease.lease_id)
        .where('status', 'in', ACTIVE_ATTEMPT_STATUSES)
        .orderBy('provider_attempt_no', 'desc')
        .executeTakeFirstOrThrow()

      return {
        leaseId: existingLease.lease_id,
        leaseAttemptId: attempt.lease_attempt_id,
      }
    }

    const resolvedAgentLibraryTruth = await resolveAgentLibraryLeaseTruth(
      trx as unknown as Kysely<Database>,
      {
        issueId: input.issueId,
        runId: input.runId,
        requestedOwnerRole: normalizedRequestedOwnerRole,
        requestedStatusCode,
        transitionAuditId: input.transitionAuditId ?? null,
        runnerRequirementProfile: normalizedRunnerRequirementProfile,
      },
    )

    const lease = await trx
      .insertInto('runner_leases')
      .values({
        issue_id: input.issueId,
        run_id: input.runId,
        workflow_id: input.workflowId,
        requested_provider: policy.primaryProvider,
        requested_owner_role: normalizedRequestedOwnerRole,
        requested_run_kind:
          normalizedRequestedRunKind as RunnerLeaseView['requestedRunKind'],
        role_execution_policy_version: input.configVersion,
        runner_requirement_profile_json: toJsonb(normalizedRunnerRequirementProfile),
        agent_library_release_id: resolvedAgentLibraryTruth.agentLibraryReleaseId,
        role_charter_ref: resolvedAgentLibraryTruth.roleCharterRef,
        prompt_version: resolvedAgentLibraryTruth.promptVersion,
        task_instructions_ref: resolvedAgentLibraryTruth.taskInstructionsRef,
        prompt_bundle_fingerprint:
          resolvedAgentLibraryTruth.promptBundleFingerprint,
        skill_pack_refs: toJsonb(resolvedAgentLibraryTruth.skillPackRefs),
        resolved_prompt_family_refs: toJsonb(
          resolvedAgentLibraryTruth.resolvedPromptFamilyRefs,
        ),
        effective_skill_fingerprint:
          resolvedAgentLibraryTruth.effectiveSkillFingerprint,
        prompt_resolution_source:
          resolvedAgentLibraryTruth.promptResolutionSource,
        context_pack_fingerprint: input.contextPackFingerprint,
        status: 'requested',
        attempt_count: 1,
        requested_by_command_key: input.commandKey,
      })
      .returning('lease_id')
      .executeTakeFirstOrThrow()

    const leaseAttempt = await trx
      .insertInto('runner_lease_attempts')
      .values({
        lease_id: lease.lease_id,
        provider_attempt_no: 1,
        requested_provider: policy.primaryProvider,
        effective_provider: policy.primaryProvider,
        fallback_from_provider: null,
        fallback_reason: null,
        execution_session_key: buildExecutionSessionKey(lease.lease_id, 1),
        mcp_profile_ref: policy.mcpProfileRef,
        mcp_bindings_summary: toJsonb([] satisfies McpBindingRefV1[]),
        installed_skill_refs: toJsonb([] satisfies string[]),
        resolved_skill_refs: toJsonb([] satisfies string[]),
        skipped_optional_skill_refs: toJsonb([] satisfies string[]),
        runner_node_id: null,
        host_group_id: null,
        status: 'requested',
        checkpoint_ref: input.checkpointId,
      })
      .returning('lease_attempt_id')
      .executeTakeFirstOrThrow()

    return {
      leaseId: lease.lease_id,
      leaseAttemptId: leaseAttempt.lease_attempt_id,
    }
  })
}

export async function releaseRunnerLeaseFromCommand(
  db: Kysely<Database>,
  input: {
    commandKey: string
    leaseId?: string | null
    issueId: string
    runId: string | null
    requestedOwnerRole?: string | null
    reasonCode: string | null
    reasonText: string | null
    now?: Date
  },
): Promise<void> {
  const now = input.now ?? new Date()

  await db.transaction().execute(async (trx) => {
    const lease = input.leaseId
      ? await trx
          .selectFrom('runner_leases')
          .selectAll()
          .where('lease_id', '=', input.leaseId)
          .executeTakeFirst()
      : input.runId
      ? await trx
          .selectFrom('runner_leases')
          .selectAll()
          .where('run_id', '=', input.runId)
          .$if(Boolean(input.requestedOwnerRole), (query) =>
            query.where(
              'requested_owner_role',
              '=',
              input.requestedOwnerRole as string,
            ),
          )
          .where('released_at', 'is', null)
          .orderBy('requested_at', 'desc')
          .executeTakeFirst()
      : await trx
          .selectFrom('runner_leases')
          .selectAll()
          .where('issue_id', '=', input.issueId)
          .$if(Boolean(input.requestedOwnerRole), (query) =>
            query.where(
              'requested_owner_role',
              '=',
              input.requestedOwnerRole as string,
            ),
          )
          .where('released_at', 'is', null)
          .orderBy('requested_at', 'desc')
          .executeTakeFirst()

    if (!lease || lease.released_at) {
      return
    }

    await trx
      .updateTable('runner_leases')
      .set({
        status: 'released',
        released_at: now,
        released_reason_code: input.reasonCode,
        last_error: input.reasonText,
        updated_at: now,
      })
      .where('lease_id', '=', lease.lease_id)
      .execute()

    await trx
      .updateTable('runner_lease_attempts')
      .set({
        status: 'released',
        released_at: now,
        updated_at: now,
      })
      .where('lease_id', '=', lease.lease_id)
      .where('status', 'in', [
        'requested',
        'acquired',
        'execution_started',
      ] satisfies RunnerLeaseAttemptStatus[])
      .execute()

    if (lease.assigned_runner_node_id) {
      await trx
        .updateTable('runner_nodes')
        .set({
          current_active_lease_count: sql`greatest(current_active_lease_count - 1, 0)`,
          updated_at: now,
        })
        .where('runner_node_id', '=', lease.assigned_runner_node_id)
        .execute()
    }
  })
}

export async function claimNextRunnerLeaseAttempt(
  db: Kysely<Database>,
  input: {
    runnerNodeId: string
    heartbeatExpiryAt: Date
    now?: Date
  },
): Promise<RunnerLeaseDetailView | null> {
  const now = input.now ?? new Date()

  return db.transaction().execute(async (trx) => {
    const runnerNode = await trx
      .selectFrom('runner_nodes')
      .selectAll()
      .where('runner_node_id', '=', input.runnerNodeId)
      .executeTakeFirstOrThrow()

    const capability = await trx
      .selectFrom('runner_capabilities')
      .selectAll()
      .where('runner_node_id', '=', input.runnerNodeId)
      .where('is_active', '=', true)
      .orderBy('manifest_version', 'desc')
      .executeTakeFirst()

    if (!capability) {
      return null
    }

    if (
      !['online', 'degraded'].includes(runnerNode.status) ||
      runnerNode.current_active_lease_count >= runnerNode.max_concurrent_leases
    ) {
      return null
    }

    const capabilitySet = buildCapabilitySet(capability)
    const candidates = await trx
      .selectFrom('runner_lease_attempts as attempts')
      .innerJoin('runner_leases as leases', 'leases.lease_id', 'attempts.lease_id')
      .innerJoin(
        'workflow_role_execution_policies as policies',
        (join) =>
          join
            .onRef(
              'policies.config_version',
              '=',
              'leases.role_execution_policy_version',
            )
            .onRef('policies.owner_role', '=', 'leases.requested_owner_role'),
      )
      .select([
        'attempts.lease_attempt_id as lease_attempt_id',
        'attempts.lease_id as lease_id',
        'attempts.effective_provider as effective_provider',
        'attempts.provider_attempt_no as provider_attempt_no',
        'leases.agent_library_release_id as agent_library_release_id',
        'leases.skill_pack_refs as skill_pack_refs',
        'leases.issue_id as issue_id',
        'leases.requested_owner_role as requested_owner_role',
        'leases.requested_run_kind as requested_run_kind',
        'leases.runner_requirement_profile_json as runner_requirement_profile_json',
        'policies.required_capabilities as required_capabilities',
      ])
      .where('attempts.status', '=', 'requested')
      .where('leases.status', '=', 'requested')
      .where('attempts.runner_node_id', 'is', null)
      .orderBy('leases.requested_at', 'asc')
      .limit(25)
      .execute()

    const installedSkillBundles = normalizeInstalledSkillBundles(
      capability.installed_skill_bundles,
    )
    const claimSkillPackCache = new Map<string, ClaimSkillPackRow[]>()

    for (const candidate of candidates) {
      if (!capability.providers.includes(candidate.effective_provider)) {
        continue
      }

      if (!capability.supported_roles.includes(candidate.requested_owner_role)) {
        continue
      }

      if (
        candidate.requested_run_kind &&
        !capability.supported_run_kinds.includes(candidate.requested_run_kind)
      ) {
        continue
      }

      const requiredCapabilities = [
        ...candidate.required_capabilities,
        ...extractRequiredCapabilities(candidate.runner_requirement_profile_json),
      ]

      const latestContract = await trx
        .selectFrom('linear_issue_contract_snapshots')
        .select(['primary_repo', 'contract_json'])
        .where('issue_id', '=', candidate.issue_id)
        .orderBy('created_at', 'desc')
        .executeTakeFirst()

      const effectiveRequiredCapabilities = [
        ...requiredCapabilities,
        ...deriveIntegrationRequiredCapabilities(latestContract?.contract_json),
      ]

      if (
        !canSatisfyRequiredCapabilities(
          capabilitySet,
          [...new Set(effectiveRequiredCapabilities)],
        )
      ) {
        continue
      }

      if (
        !canSatisfyIntegrationMcpRequirements(
          capability,
          latestContract?.contract_json,
        )
      ) {
        continue
      }

      if (latestContract?.primary_repo) {
        const repository = await trx
          .selectFrom('repository_registry')
          .select(['repo_kind'])
          .where('repo_slug', '=', latestContract.primary_repo)
          .executeTakeFirst()

        if (
          repository &&
          capability.supported_repo_kinds.length > 0 &&
          !capability.supported_repo_kinds.includes(repository.repo_kind)
        ) {
          continue
        }
      }

      const requestedSkillPackRefs = normalizeUniqueStringArray(
        candidate.skill_pack_refs,
      )
      const releaseBundle =
        candidate.agent_library_release_id === null
          ? null
          : findInstalledSkillBundle(
              installedSkillBundles,
              candidate.agent_library_release_id,
            )

      if (candidate.agent_library_release_id && !releaseBundle) {
        continue
      }

      const installedSkillRefs = releaseBundle?.skillIds ?? []
      let claimSkillSnapshot:
        | {
            resolvedSkillRefs: string[]
            skippedOptionalSkillRefs: string[]
          }
        | null = {
          resolvedSkillRefs: [],
          skippedOptionalSkillRefs: [],
        }

      if (requestedSkillPackRefs.length > 0) {
        if (!candidate.agent_library_release_id) {
          continue
        }

        const cacheKey = `${candidate.agent_library_release_id}:${requestedSkillPackRefs.join(',')}`
        let packRows = claimSkillPackCache.get(cacheKey)

        if (!packRows) {
          packRows = await trx
            .selectFrom('agent_skill_packs')
            .select(['pack_id', 'providers', 'skill_refs', 'optional_skill_refs'])
            .where('release_id', '=', candidate.agent_library_release_id)
            .where('pack_id', 'in', requestedSkillPackRefs)
            .execute()
          claimSkillPackCache.set(cacheKey, packRows)
        }

        claimSkillSnapshot = computeClaimSkillSnapshot({
          effectiveProvider: candidate.effective_provider,
          installedSkillRefs,
          skillPackRefs: requestedSkillPackRefs,
          packRows,
        })

        if (!claimSkillSnapshot) {
          continue
        }
      }

      const claimResult = await trx
        .updateTable('runner_lease_attempts')
        .set({
          installed_skill_refs: toJsonb(installedSkillRefs),
          resolved_skill_refs: toJsonb(claimSkillSnapshot.resolvedSkillRefs),
          skipped_optional_skill_refs: toJsonb(
            claimSkillSnapshot.skippedOptionalSkillRefs,
          ),
          runner_node_id: input.runnerNodeId,
          host_group_id: runnerNode.host_group_id,
          status: 'acquired',
          acquired_at: now,
          last_heartbeat_at: now,
          updated_at: now,
        })
        .where('lease_attempt_id', '=', candidate.lease_attempt_id)
        .where('status', '=', 'requested')
        .where('runner_node_id', 'is', null)
        .executeTakeFirst()

      if (Number(claimResult.numUpdatedRows ?? 0n) !== 1) {
        continue
      }

      await trx
        .updateTable('runner_leases')
        .set({
          status: 'acquired',
          assigned_runner_node_id: input.runnerNodeId,
          acquired_at: now,
          last_heartbeat_at: now,
          heartbeat_expires_at: input.heartbeatExpiryAt,
          updated_at: now,
        })
        .where('lease_id', '=', candidate.lease_id)
        .execute()

      await trx
        .updateTable('runner_nodes')
        .set({
          current_active_lease_count: sql`current_active_lease_count + 1`,
          updated_at: now,
        })
        .where('runner_node_id', '=', input.runnerNodeId)
        .execute()

      return getRunnerLeaseDetailView(
        trx as unknown as Kysely<Database>,
        candidate.lease_id,
      )
    }

    return null
  })
}

export async function claimNextRunnerTask(
  db: Kysely<Database>,
  input: {
    runnerNodeId: string
    heartbeatExpiryAt: Date
    now?: Date
  },
): Promise<TaskEnvelopeV2 | null> {
  const leaseDetail = await claimNextRunnerLeaseAttempt(db, input)

  if (!leaseDetail) {
    return null
  }

  const capability = await db
    .selectFrom('runner_capabilities')
    .select(['tool_baseline', 'worktree_root', 'mcp_server_catalog'])
    .where('runner_node_id', '=', input.runnerNodeId)
    .where('is_active', '=', true)
    .orderBy('manifest_version', 'desc')
    .executeTakeFirstOrThrow()

  return buildTaskEnvelopeForLease(
    db,
    leaseDetail.lease.leaseId,
    capability.tool_baseline,
    capability.worktree_root,
    capability.mcp_server_catalog,
  )
}

export async function markRunnerLeaseAttemptExecutionStarted(
  db: Kysely<Database>,
  input: { leaseAttemptId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date()
  const attempt = await db
    .selectFrom('runner_lease_attempts')
    .select(['lease_id'])
    .where('lease_attempt_id', '=', input.leaseAttemptId)
    .executeTakeFirstOrThrow()

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('runner_lease_attempts')
      .set({
        status: 'execution_started',
        execution_started_at: now,
        last_heartbeat_at: now,
        updated_at: now,
      })
      .where('lease_attempt_id', '=', input.leaseAttemptId)
      .execute()

    await trx
      .updateTable('runner_leases')
      .set({
        status: 'execution_started',
        execution_started_at: now,
        last_heartbeat_at: now,
        updated_at: now,
      })
      .where('lease_id', '=', attempt.lease_id)
      .execute()
  })
}

export async function heartbeatRunnerLeaseAttempt(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    heartbeatExpiresAt: Date
    now?: Date
  },
): Promise<void> {
  const now = input.now ?? new Date()
  const attempt = await db
    .selectFrom('runner_lease_attempts')
    .select(['lease_id', 'runner_node_id'])
    .where('lease_attempt_id', '=', input.leaseAttemptId)
    .executeTakeFirstOrThrow()

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('runner_lease_attempts')
      .set({
        last_heartbeat_at: now,
        updated_at: now,
      })
      .where('lease_attempt_id', '=', input.leaseAttemptId)
      .execute()

    await trx
      .updateTable('runner_leases')
      .set({
        last_heartbeat_at: now,
        heartbeat_expires_at: input.heartbeatExpiresAt,
        updated_at: now,
      })
      .where('lease_id', '=', attempt.lease_id)
      .execute()

    if (attempt.runner_node_id) {
      await trx
        .updateTable('runner_nodes')
        .set({
          last_heartbeat_at: now,
          heartbeat_expires_at: input.heartbeatExpiresAt,
          updated_at: now,
        })
        .where('runner_node_id', '=', attempt.runner_node_id)
        .execute()
    }
  })
}

async function completeRunnerLeaseAttemptInTransaction(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    resultArtifactId: string | null
    now?: Date
  },
): Promise<void> {
  const now = input.now ?? new Date()
  const attempt = await db
    .selectFrom('runner_lease_attempts')
    .select(['lease_id', 'runner_node_id'])
    .where('lease_attempt_id', '=', input.leaseAttemptId)
    .executeTakeFirstOrThrow()

  await db
    .updateTable('runner_lease_attempts')
    .set({
      status: 'completed',
      completed_at: now,
      updated_at: now,
    })
    .where('lease_attempt_id', '=', input.leaseAttemptId)
    .execute()

  await db
    .updateTable('runner_leases')
    .set({
      status: 'completed',
      completed_at: now,
      result_artifact_id: input.resultArtifactId,
      updated_at: now,
    })
    .where('lease_id', '=', attempt.lease_id)
    .execute()

  if (attempt.runner_node_id) {
    await db
      .updateTable('runner_nodes')
      .set({
        current_active_lease_count: sql`greatest(current_active_lease_count - 1, 0)`,
        updated_at: now,
      })
      .where('runner_node_id', '=', attempt.runner_node_id)
      .execute()
  }
}

export async function completeRunnerLeaseAttempt(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    resultArtifactId: string | null
    now?: Date
  },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await completeRunnerLeaseAttemptInTransaction(
      trx as unknown as Kysely<Database>,
      input,
    )
  })
}

function canFallbackProviders(input: {
  policy: RoleExecutionPolicyV1
  currentProvider: AgentProvider
  currentAttemptNo: number
  fallbackReason: ProviderFallbackReason | null
  executionStartedAt: Date | null
  checkpointRef: string | null
  supportsCheckpointResume: boolean
}): boolean {
  if (!input.fallbackReason) {
    return false
  }

  if (!input.policy.fallbackTriggers.includes(input.fallbackReason)) {
    return false
  }

  const failoversAlreadyUsed = input.currentAttemptNo - 1
  if (failoversAlreadyUsed >= input.policy.maxProviderFailovers) {
    return false
  }

  if (input.policy.secondaryProvider === input.currentProvider) {
    return false
  }

  if (input.executionStartedAt === null) {
    return true
  }

  return canResumeStartedAttempt({
    checkpointRef: input.checkpointRef,
    supportsCheckpointResume: input.supportsCheckpointResume,
  })
}

function canResumeStartedAttempt(input: {
  checkpointRef: string | null
  supportsCheckpointResume: boolean
}): boolean {
  return input.supportsCheckpointResume && input.checkpointRef !== null
}

async function enqueueRunnerOutageBlockCommand(
  db: Kysely<Database>,
  input: {
    issueId: string
    workflowId: string
    leaseId: string
    leaseAttemptId: string
    providerAttemptNo: number
    errorClass: ProviderFailureClass
    fallbackReason: ProviderFallbackReason | null
    reasonText: string
    now: Date
  },
): Promise<void> {
  const command: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: `runner-provider-exhausted:${input.leaseId}:${input.providerAttemptNo.toString()}`,
    issueId: input.issueId,
    workflowId: input.workflowId,
    signalName: 'ingestSystemCommand',
    source: 'runner_fabric',
    sourceRef: input.leaseAttemptId,
    occurredAt: input.now.toISOString(),
    actorType: 'system',
    actorId: 'runner-router',
    triggerCode: 'system_block_detected',
    requestedStatusCode: 'blocked',
    reasonCode: 'block_runner_outage',
    reasonText: input.reasonText,
    metadata: {
      leaseId: input.leaseId,
      leaseAttemptId: input.leaseAttemptId,
      providerAttemptNo: input.providerAttemptNo,
      errorClass: input.errorClass,
      fallbackReason: input.fallbackReason,
    } satisfies SharedJsonObject,
  }

  await upsertLifecycleCommand(db, command)
}

async function openRecoveryAttempt(
  db: Kysely<Database>,
  input: {
    lease: Selectable<Database['runner_leases']>
    attempt: Selectable<Database['runner_lease_attempts']>
    now: Date
  },
): Promise<string> {
  const nextAttemptNo = input.attempt.provider_attempt_no + 1
  const inserted = await db
    .insertInto('runner_lease_attempts')
    .values({
      lease_id: input.lease.lease_id,
      provider_attempt_no: nextAttemptNo,
      requested_provider: input.lease.requested_provider,
      effective_provider: input.attempt.effective_provider,
      fallback_from_provider: null,
      fallback_reason: null,
      execution_session_key: buildExecutionSessionKey(
        input.lease.lease_id,
        nextAttemptNo,
      ),
      mcp_profile_ref: input.attempt.mcp_profile_ref,
      mcp_bindings_summary: toJsonb([] satisfies McpBindingRefV1[]),
      installed_skill_refs: toJsonb([] satisfies string[]),
      resolved_skill_refs: toJsonb([] satisfies string[]),
      skipped_optional_skill_refs: toJsonb([] satisfies string[]),
      runner_node_id: null,
      host_group_id: null,
      status: 'requested',
      checkpoint_ref: input.attempt.checkpoint_ref,
    })
    .returning('lease_attempt_id')
    .executeTakeFirstOrThrow()

  await db
    .updateTable('runner_leases')
    .set({
      status: 'requested',
      assigned_runner_node_id: null,
      acquired_at: null,
      execution_started_at: null,
      last_heartbeat_at: null,
      heartbeat_expires_at: null,
      attempt_count: nextAttemptNo,
      updated_at: input.now,
    })
    .where('lease_id', '=', input.lease.lease_id)
    .execute()

  return inserted.lease_attempt_id
}

export async function recoverStaleRunnerLeases(
  db: Kysely<Database>,
  input?: {
    now?: Date
    heartbeatLostGraceMs?: number
  },
): Promise<{
  requeuedLeaseIds: string[]
  heartbeatLostLeaseIds: string[]
  expiredLeaseIds: string[]
  releasedLeaseIds: string[]
}> {
  const now = input?.now ?? new Date()
  const heartbeatLostGraceMs = input?.heartbeatLostGraceMs ?? 60_000
  const heartbeatLostDeadline = new Date(now.getTime() - heartbeatLostGraceMs)
  const requeuedLeaseIds: string[] = []
  const heartbeatLostLeaseIds: string[] = []
  const expiredLeaseIds: string[] = []
  const releasedLeaseIds: string[] = []

  const candidates = await db
    .selectFrom('runner_leases')
    .select(['lease_id'])
    .where((eb) =>
      eb.or([
        eb.and([
          eb('heartbeat_expires_at', 'is not', null),
          eb('heartbeat_expires_at', '<', now),
          eb('status', 'in', [
            'acquired',
            'execution_started',
            'cancellation_requested',
          ] satisfies RunnerLeaseStatus[]),
        ]),
        eb.and([
          eb('status', '=', 'heartbeat_lost'),
          eb('updated_at', '<=', heartbeatLostDeadline),
        ]),
      ]),
    )
    .orderBy('requested_at', 'asc')
    .execute()

  for (const candidate of candidates) {
    await db.transaction().execute(async (trx) => {
      const lease = await trx
        .selectFrom('runner_leases')
        .selectAll()
        .where('lease_id', '=', candidate.lease_id)
        .executeTakeFirst()

      if (!lease || isLeaseTerminal(lease.status)) {
        return
      }

      let attempt = await trx
        .selectFrom('runner_lease_attempts')
        .selectAll()
        .where('lease_id', '=', lease.lease_id)
        .where('status', 'in', ACTIVE_ATTEMPT_STATUSES)
        .orderBy('provider_attempt_no', 'desc')
        .executeTakeFirst()

      if (
        !attempt &&
        lease.status === 'heartbeat_lost' &&
        lease.updated_at <= heartbeatLostDeadline
      ) {
        // A prior recovery pass marks the last started attempt as failed before
        // deciding whether the lease should expire or reopen from checkpoint.
        attempt = await trx
          .selectFrom('runner_lease_attempts')
          .selectAll()
          .where('lease_id', '=', lease.lease_id)
          .orderBy('provider_attempt_no', 'desc')
          .executeTakeFirst()
      }

      if (!attempt) {
        if (lease.status === 'heartbeat_lost' && lease.updated_at <= heartbeatLostDeadline) {
          await trx
            .updateTable('runner_leases')
            .set({
              status: 'expired',
              failed_at: lease.failed_at ?? now,
              updated_at: now,
            })
            .where('lease_id', '=', lease.lease_id)
            .execute()
          expiredLeaseIds.push(lease.lease_id)
        }
        return
      }

      if (lease.assigned_runner_node_id) {
        await trx
          .updateTable('runner_nodes')
          .set({
            current_active_lease_count: sql`greatest(current_active_lease_count - 1, 0)`,
            updated_at: now,
          })
          .where('runner_node_id', '=', lease.assigned_runner_node_id)
          .execute()
      }

      if (lease.status === 'cancellation_requested') {
        await trx
          .updateTable('runner_lease_attempts')
          .set({
            status: 'released',
            cancel_acknowledged_at: now,
            cancel_outcome: 'accepted',
            released_at: now,
            updated_at: now,
          })
          .where('lease_attempt_id', '=', attempt.lease_attempt_id)
          .execute()

        await trx
          .updateTable('runner_leases')
          .set({
            status: 'released',
            assigned_runner_node_id: null,
            released_at: now,
            released_reason_code: lease.released_reason_code ?? 'operator_cancel_requested',
            last_error: 'Runner heartbeat expired after cancellation request.',
            updated_at: now,
          })
          .where('lease_id', '=', lease.lease_id)
          .execute()

        releasedLeaseIds.push(lease.lease_id)
        return
      }

      await trx
        .updateTable('runner_lease_attempts')
        .set({
          status: 'failed',
          failed_at: now,
          error_class: 'transport_error',
          error_message: 'Runner heartbeat expired before terminal acknowledgement.',
          updated_at: now,
        })
        .where('lease_attempt_id', '=', attempt.lease_attempt_id)
        .execute()

      if (lease.status === 'acquired') {
        await openRecoveryAttempt(trx as unknown as Kysely<Database>, {
          lease,
          attempt,
          now,
        })
        requeuedLeaseIds.push(lease.lease_id)
        return
      }

      if (lease.status === 'heartbeat_lost' && lease.updated_at <= heartbeatLostDeadline) {
        const runnerNodeId = attempt.runner_node_id ?? lease.assigned_runner_node_id
        const runnerCapability = runnerNodeId
          ? await trx
              .selectFrom('runner_capabilities')
              .select(['supports_checkpoint_resume'])
              .where('runner_node_id', '=', runnerNodeId)
              .where('is_active', '=', true)
              .executeTakeFirst()
          : null

        if (
          canResumeStartedAttempt({
            checkpointRef: attempt.checkpoint_ref,
            supportsCheckpointResume: runnerCapability?.supports_checkpoint_resume ?? false,
          })
        ) {
          await openRecoveryAttempt(trx as unknown as Kysely<Database>, {
            lease,
            attempt,
            now,
          })
          requeuedLeaseIds.push(lease.lease_id)
          return
        }

        await trx
          .updateTable('runner_leases')
          .set({
            status: 'expired',
            assigned_runner_node_id: null,
            failed_at: lease.failed_at ?? now,
            last_error: 'Runner heartbeat remained lost past the recovery grace period.',
            updated_at: now,
          })
          .where('lease_id', '=', lease.lease_id)
          .execute()
        expiredLeaseIds.push(lease.lease_id)
        return
      }

      await trx
        .updateTable('runner_leases')
        .set({
          status: 'heartbeat_lost',
          assigned_runner_node_id: null,
          last_error: 'Runner heartbeat expired before terminal acknowledgement.',
          updated_at: now,
        })
        .where('lease_id', '=', lease.lease_id)
        .execute()

      heartbeatLostLeaseIds.push(lease.lease_id)
    })
  }

  return {
    requeuedLeaseIds,
    heartbeatLostLeaseIds,
    expiredLeaseIds,
    releasedLeaseIds,
  }
}

async function failRunnerLeaseAttemptInTransaction(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    errorClass: ProviderFailureClass
    errorMessage: string
    fallbackReason: ProviderFallbackReason | null
    checkpointRef: string | null
    supportsCheckpointResume: boolean
    now?: Date
  },
): Promise<{
    leaseStatus: RunnerLeaseStatus
    openedNextAttempt: boolean
    leaseAttemptId: string
  }> {
  const now = input.now ?? new Date()

  const attempt = await db
    .selectFrom('runner_lease_attempts')
    .selectAll()
    .where('lease_attempt_id', '=', input.leaseAttemptId)
    .executeTakeFirstOrThrow()

  const lease = await db
    .selectFrom('runner_leases')
    .selectAll()
    .where('lease_id', '=', attempt.lease_id)
    .executeTakeFirstOrThrow()

  const policy = await getRoleExecutionPolicy(db, {
    configVersion: lease.role_execution_policy_version,
    ownerRole: lease.requested_owner_role,
  })

  if (!policy) {
    throw new Error(
      `Missing role execution policy for ${lease.requested_owner_role} at config version ${lease.role_execution_policy_version.toString()}`,
    )
  }

  const shouldFallback = canFallbackProviders({
    policy,
    currentProvider: attempt.effective_provider,
    currentAttemptNo: attempt.provider_attempt_no,
    fallbackReason: input.fallbackReason,
    executionStartedAt: attempt.execution_started_at,
    checkpointRef: input.checkpointRef ?? attempt.checkpoint_ref,
    supportsCheckpointResume: input.supportsCheckpointResume,
  })

  await db
    .updateTable('runner_lease_attempts')
    .set({
      status: shouldFallback ? 'abandoned_for_fallback' : 'failed',
      failed_at: now,
      error_class: input.errorClass,
      error_message: input.errorMessage,
      checkpoint_ref: input.checkpointRef ?? attempt.checkpoint_ref,
      updated_at: now,
    })
    .where('lease_attempt_id', '=', input.leaseAttemptId)
    .execute()

  if (attempt.runner_node_id) {
    await db
      .updateTable('runner_nodes')
      .set({
        current_active_lease_count: sql`greatest(current_active_lease_count - 1, 0)`,
        updated_at: now,
      })
      .where('runner_node_id', '=', attempt.runner_node_id)
      .execute()
  }

  if (shouldFallback) {
    const nextAttemptNo = attempt.provider_attempt_no + 1
    const nextAttempt = await db
      .insertInto('runner_lease_attempts')
      .values({
        lease_id: lease.lease_id,
        provider_attempt_no: nextAttemptNo,
        requested_provider: lease.requested_provider,
        effective_provider: policy.secondaryProvider,
        fallback_from_provider: attempt.effective_provider,
        fallback_reason: input.fallbackReason,
        execution_session_key: buildExecutionSessionKey(lease.lease_id, nextAttemptNo),
        mcp_profile_ref: policy.mcpProfileRef,
        mcp_bindings_summary: toJsonb([] satisfies McpBindingRefV1[]),
        installed_skill_refs: toJsonb([] satisfies string[]),
        resolved_skill_refs: toJsonb([] satisfies string[]),
        skipped_optional_skill_refs: toJsonb([] satisfies string[]),
        runner_node_id: null,
        host_group_id: null,
        status: 'requested',
        checkpoint_ref: input.checkpointRef ?? attempt.checkpoint_ref,
      })
      .returning('lease_attempt_id')
      .executeTakeFirstOrThrow()

    await db
      .updateTable('runner_leases')
      .set({
        status: 'requested',
        assigned_runner_node_id: null,
        acquired_at: null,
        execution_started_at: null,
        last_heartbeat_at: null,
        heartbeat_expires_at: null,
        attempt_count: nextAttemptNo,
        last_error: input.errorMessage,
        updated_at: now,
      })
      .where('lease_id', '=', lease.lease_id)
      .execute()

    return {
      leaseStatus: 'requested',
      openedNextAttempt: true,
      leaseAttemptId: nextAttempt.lease_attempt_id,
    }
  }

  const terminalStatus: RunnerLeaseStatus =
    input.fallbackReason !== null &&
    policy.fallbackTriggers.includes(input.fallbackReason)
      ? 'provider_fallback_exhausted'
      : 'failed'

  await db
    .updateTable('runner_leases')
    .set({
      status: terminalStatus,
      assigned_runner_node_id: null,
      failed_at: now,
      last_error: input.errorMessage,
      updated_at: now,
    })
    .where('lease_id', '=', lease.lease_id)
    .execute()

  if (terminalStatus === 'provider_fallback_exhausted') {
    await enqueueRunnerOutageBlockCommand(db, {
      issueId: lease.issue_id,
      workflowId: lease.workflow_id,
      leaseId: lease.lease_id,
      leaseAttemptId: attempt.lease_attempt_id,
      providerAttemptNo: attempt.provider_attempt_no,
      errorClass: input.errorClass,
      fallbackReason: input.fallbackReason,
      reasonText: input.errorMessage,
      now,
    })
  }

  return {
    leaseStatus: terminalStatus,
    openedNextAttempt: false,
    leaseAttemptId: attempt.lease_attempt_id,
  }
}

export async function failRunnerLeaseAttempt(
  db: Kysely<Database>,
  input: {
    leaseAttemptId: string
    errorClass: ProviderFailureClass
    errorMessage: string
    fallbackReason: ProviderFallbackReason | null
    checkpointRef: string | null
    supportsCheckpointResume: boolean
    now?: Date
  },
): Promise<{
    leaseStatus: RunnerLeaseStatus
    openedNextAttempt: boolean
    leaseAttemptId: string
  }> {
  return db.transaction().execute(async (trx) =>
    failRunnerLeaseAttemptInTransaction(
      trx as unknown as Kysely<Database>,
      input,
    ),
  )
}
