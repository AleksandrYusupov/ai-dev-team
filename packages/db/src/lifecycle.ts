import { sql, type Kysely, type Selectable, type Transaction } from 'kysely'

import type {
  AgentExecutionMetadataV2,
  LifecycleCommandEnvelopeV1,
  LifecycleCommandInboxStatus,
  LifecycleCommandSignalName,
  LifecycleSnapshotV1,
  LifecycleTimerIntentV1,
  OutboxCommandEnvelopeV1,
  RunKind,
} from '@ai-dev-team/shared'

import type { Database, JsonObject } from './schema.js'

type DbSession = Kysely<Database> | Transaction<Database>
const RECENT_LIFECYCLE_COMMAND_LIMIT = 25
type LifecycleCommandInboxSignalName = LifecycleCommandSignalName

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function toMetricDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  return value
}

export interface LifecycleCommandInboxRecord {
  id: string
  commandKey: string
  issueId: string
  workflowId: string
  signalName: LifecycleCommandInboxSignalName
  source: string
  sourceRef: string
  payload: LifecycleCommandEnvelopeV1
  status: LifecycleCommandInboxStatus
  attemptCount: number
  scheduledAt: string
  acceptedAt: string | null
  rejectedAt: string | null
  processedAt: string | null
  lastError: string | null
  transitionAuditId: string | null
  rejectionPayload: JsonObject | null
  createdAt: string
}

export interface UpsertLifecycleCommandResult {
  record: LifecycleCommandInboxRecord
  inserted: boolean
}

export interface ClaimLifecycleCommandBatchInput {
  batchSize: number
  processingTimeoutMs: number
}

export interface MarkLifecycleCommandAcceptedInput {
  commandKey: string
  transitionAuditId: string | null
  resultPayload?: JsonObject | null
}

export interface MarkLifecycleCommandRejectedInput {
  commandKey: string
  validatorPayload: JsonObject
  errorMessage: string
}

export interface FailLifecycleCommandInput {
  commandKey: string
  maxAttempts: number
  error: string
}

export interface IssueJourneyView {
  issueId: string
  transitions: Array<{
    id: string
    fromStatusCode: string | null
    toStatusCode: string
    triggerCode: string
    actorType: string
    actorId: string
    ownerRole: string | null
    reasonCode: string | null
    reasonText: string | null
    commentId: string | null
    checkpointId: string | null
    leaseId: string | null
    runId: string | null
    workflowId: string | null
    createdAt: string
  }>
  runs: Array<{
    id: string
    sequenceNo: number
    runKind: RunKind
    status: string
    checkpointId: string | null
    runnerRequirements: JsonObject
    openedAt: string
    closedAt: string | null
  }>
  artifacts: Array<{
    id: string
    artifactType: string
    artifactScope: string
    runId: string | null
    transitionAuditId: string | null
    artifactUri: string
    producedForStatusCode: string | null
    producedAt: string
    supersededAt: string | null
    metadata: JsonObject
  }>
  commands: LifecycleCommandInboxRecord[]
}

export interface SystemHealthView {
  openIssueCount: number
  openWorkflowCount: number
  rawInboxLagCount: number
  rawInboxOldestAgeSeconds: number | null
  lifecycleCommandLagCount: number
  lifecycleCommandOldestAgeSeconds: number | null
  outboxLagCount: number
  outboxOldestAgeSeconds: number | null
  stuckIssueCount: number
  generatedAt: string
}

export interface StuckIssueView {
  issueId: string
  currentStatusCode: string
  currentOwnerRole: string | null
  stuckForSeconds: number
  lastTransitionAt: string
  lastTransitionTrigger: string
  highRisk: boolean
}

export interface AgentMetricsDailyView {
  metricDate: string
  transitionCount: number
  lifecycleCommandAcceptedCount: number
  lifecycleCommandRejectedCount: number
  duplicateSuppressionCount: number
  runOpenCounts: JsonObject
  runCloseCounts: JsonObject
  dwellP50Seconds: JsonObject
  dwellP90Seconds: JsonObject
  updatedAt: string
}

function isHumanGateStatus(statusCode: string | null | undefined): boolean {
  return statusCode === 'needs_input' || statusCode === 'needs_human_decision'
}

function mapLifecycleCommandInboxRow(
  row: Selectable<Database['lifecycle_command_inbox']>,
): LifecycleCommandInboxRecord {
  return {
    id: row.id,
    commandKey: row.command_key,
    issueId: row.issue_id,
    workflowId: row.workflow_id,
    signalName: row.signal_name as LifecycleCommandInboxSignalName,
    source: row.source,
    sourceRef: row.source_ref,
    payload: row.payload as unknown as LifecycleCommandEnvelopeV1,
    status: row.status,
    attemptCount: row.attempt_count,
    scheduledAt: row.scheduled_at.toISOString(),
    acceptedAt: toIsoString(row.accepted_at),
    rejectedAt: toIsoString(row.rejected_at),
    processedAt: toIsoString(row.processed_at),
    lastError: row.last_error,
    transitionAuditId: row.transition_audit_id,
    rejectionPayload: row.rejection_payload,
    createdAt: row.created_at.toISOString(),
  }
}

function normalizeTimerIntent(value: unknown): LifecycleTimerIntentV1 | null {
  const candidate = asRecord(value)
  const timerKey =
    typeof candidate.timerKey === 'string' && candidate.timerKey.trim().length > 0
      ? candidate.timerKey.trim()
      : null
  const dueAt =
    typeof candidate.dueAt === 'string' && candidate.dueAt.trim().length > 0
      ? candidate.dueAt.trim()
      : null
  const reason =
    typeof candidate.reason === 'string' && candidate.reason.trim().length > 0
      ? candidate.reason.trim()
      : null

  if (!timerKey || !dueAt || !reason) {
    return null
  }

  const parsedDueAt = new Date(dueAt)

  if (Number.isNaN(parsedDueAt.getTime())) {
    return null
  }

  return {
    timerKey,
    dueAt: parsedDueAt.toISOString(),
    reason,
  }
}

function extractActiveTimerIntents(
  resumeCondition: unknown,
): LifecycleTimerIntentV1[] {
  const payload = asRecord(resumeCondition)
  const candidates = Array.isArray(payload.activeTimerIntents)
    ? payload.activeTimerIntents
    : payload.timerIntent !== undefined
      ? [payload.timerIntent]
      : []
  const seen = new Set<string>()
  const timerIntents: LifecycleTimerIntentV1[] = []

  for (const candidate of candidates) {
    const timerIntent = normalizeTimerIntent(candidate)

    if (!timerIntent || seen.has(timerIntent.timerKey)) {
      continue
    }

    seen.add(timerIntent.timerKey)
    timerIntents.push(timerIntent)
  }

  return timerIntents
}

function buildRunCountMap(
  rows: ReadonlyArray<{ run_kind: string; count: number }>,
): JsonObject {
  const counts: JsonObject = {}

  for (const row of rows) {
    counts[row.run_kind] = row.count
  }

  return counts
}

function buildDwellCountMap(
  rows: ReadonlyArray<{ status_code: string; p50: number | null; p90: number | null }>,
  key: 'p50' | 'p90',
): JsonObject {
  const counts: JsonObject = {}

  for (const row of rows) {
    const value = row[key]

    if (value !== null) {
      counts[row.status_code] = value
    }
  }

  return counts
}

export async function getLifecycleCommandByCommandKey(
  db: DbSession,
  commandKey: string,
): Promise<LifecycleCommandInboxRecord | null> {
  const row = await db
    .selectFrom('lifecycle_command_inbox')
    .selectAll()
    .where('command_key', '=', commandKey)
    .executeTakeFirst()

  return row ? mapLifecycleCommandInboxRow(row) : null
}

export async function upsertLifecycleCommand(
  db: DbSession,
  payload: LifecycleCommandEnvelopeV1,
): Promise<UpsertLifecycleCommandResult> {
  try {
    const row = await db
      .insertInto('lifecycle_command_inbox')
      .values({
        command_key: payload.commandKey,
        issue_id: payload.issueId,
        workflow_id: payload.workflowId,
        signal_name: payload.signalName,
        source: payload.source,
        source_ref: payload.sourceRef,
        payload: payload as unknown as JsonObject,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return {
      record: mapLifecycleCommandInboxRow(row),
      inserted: true,
    }
  } catch (error) {
    const details = asRecord(error)

    if (details.code !== '23505') {
      throw error
    }

    const existing = await getLifecycleCommandByCommandKey(db, payload.commandKey)

    if (!existing) {
      throw error
    }

    return {
      record: existing,
      inserted: false,
    }
  }
}

export async function claimLifecycleCommandBatch(
  db: DbSession,
  input: ClaimLifecycleCommandBatchInput,
): Promise<LifecycleCommandInboxRecord[]> {
  const reclaimBefore = new Date(Date.now() - input.processingTimeoutMs)

  const result = await sql<Database['lifecycle_command_inbox']>`
    with next_batch as (
      select id
      from lifecycle_command_inbox
      where (
        status in ('pending', 'failed')
        and scheduled_at <= now()
      ) or (
        status = 'processing'
        and scheduled_at <= ${reclaimBefore}
      )
      order by scheduled_at asc
      limit ${input.batchSize}
      for update skip locked
    )
    update lifecycle_command_inbox as inbox
    set
      status = 'processing',
      attempt_count = inbox.attempt_count + 1,
      scheduled_at = now(),
      last_error = null
    from next_batch
    where inbox.id = next_batch.id
    returning inbox.*
  `.execute(db)

  return result.rows.map((row) =>
    mapLifecycleCommandInboxRow(
      row as unknown as Selectable<Database['lifecycle_command_inbox']>,
    ),
  )
}

export async function markLifecycleCommandAccepted(
  db: DbSession,
  input: MarkLifecycleCommandAcceptedInput,
): Promise<void> {
  await db
    .updateTable('lifecycle_command_inbox')
    .set({
      status: 'accepted',
      accepted_at: new Date(),
      processed_at: new Date(),
      last_error: null,
      transition_audit_id: input.transitionAuditId,
      rejection_payload: input.resultPayload ?? null,
    })
    .where('command_key', '=', input.commandKey)
    .execute()
}

export async function markLifecycleCommandRejected(
  db: DbSession,
  input: MarkLifecycleCommandRejectedInput,
): Promise<void> {
  await db
    .updateTable('lifecycle_command_inbox')
    .set({
      status: 'rejected',
      rejected_at: new Date(),
      processed_at: new Date(),
      last_error: input.errorMessage,
      rejection_payload: input.validatorPayload,
    })
    .where('command_key', '=', input.commandKey)
    .execute()
}

export async function failLifecycleCommand(
  db: DbSession,
  input: FailLifecycleCommandInput,
): Promise<void> {
  const current = await db
    .selectFrom('lifecycle_command_inbox')
    .select('attempt_count')
    .where('command_key', '=', input.commandKey)
    .executeTakeFirstOrThrow()

  const isDeadLetter = current.attempt_count >= input.maxAttempts
  const retryDelayMs = Math.min(
    60_000,
    1_000 * 2 ** Math.max(0, current.attempt_count - 1),
  )

  await db
    .updateTable('lifecycle_command_inbox')
    .set({
      status: isDeadLetter ? 'dead_letter' : 'failed',
      last_error: input.error,
      scheduled_at: isDeadLetter
        ? new Date()
        : new Date(Date.now() + retryDelayMs),
    })
    .where('command_key', '=', input.commandKey)
    .execute()
}

export async function refreshAgentMetricsDaily(
  db: DbSession,
  metricDate: string | Date,
): Promise<AgentMetricsDailyView> {
  const resolvedMetricDate = toMetricDate(metricDate)

  await sql.raw(`refresh materialized view mv_status_dwell_times`).execute(db)

  const [
    transitionRow,
    acceptedRejectedRow,
    runOpenRows,
    runCloseRows,
    dwellRows,
  ] = await Promise.all([
    sql<{ count: string }>`
      select count(*)::text as count
      from status_transition_audit
      where created_at::date = ${resolvedMetricDate}::date
    `.execute(db),
    sql<{
      accepted_count: string
      rejected_count: string
      duplicate_count: string
    }>`
      select
        count(*) filter (where status = 'accepted')::text as accepted_count,
        count(*) filter (where status = 'rejected')::text as rejected_count,
        count(*) filter (
          where status = 'accepted'
            and coalesce(rejection_payload->>'status', '') = 'duplicate'
        )::text as duplicate_count
      from lifecycle_command_inbox
      where processed_at::date = ${resolvedMetricDate}::date
    `.execute(db),
    sql<{ run_kind: string; count: number }>`
      select run_kind, count(*)::int as count
      from issue_runs
      where opened_at::date = ${resolvedMetricDate}::date
      group by run_kind
    `.execute(db),
    sql<{ run_kind: string; count: number }>`
      select run_kind, count(*)::int as count
      from issue_runs
      where closed_at is not null
        and closed_at::date = ${resolvedMetricDate}::date
      group by run_kind
    `.execute(db),
    sql<{ status_code: string; p50: number | null; p90: number | null }>`
      select
        status_code,
        percentile_cont(0.5) within group (order by dwell_seconds) as p50,
        percentile_cont(0.9) within group (order by dwell_seconds) as p90
      from mv_status_dwell_times
      where dwell_seconds is not null
        and entered_at::date = ${resolvedMetricDate}::date
      group by status_code
    `.execute(db),
  ])

  const transitionCount = Number.parseInt(transitionRow.rows[0]?.count ?? '0', 10)
  const acceptedCount = Number.parseInt(
    acceptedRejectedRow.rows[0]?.accepted_count ?? '0',
    10,
  )
  const rejectedCount = Number.parseInt(
    acceptedRejectedRow.rows[0]?.rejected_count ?? '0',
    10,
  )
  const duplicateCount = Number.parseInt(
    acceptedRejectedRow.rows[0]?.duplicate_count ?? '0',
    10,
  )

  const runOpenCounts = buildRunCountMap(runOpenRows.rows)
  const runCloseCounts = buildRunCountMap(runCloseRows.rows)
  const dwellP50Seconds = buildDwellCountMap(dwellRows.rows, 'p50')
  const dwellP90Seconds = buildDwellCountMap(dwellRows.rows, 'p90')

  await db
    .insertInto('agent_metrics_daily')
    .values({
      metric_date: resolvedMetricDate,
      transition_count: transitionCount,
      lifecycle_command_accepted_count: acceptedCount,
      lifecycle_command_rejected_count: rejectedCount,
      duplicate_suppression_count: duplicateCount,
      run_open_counts: runOpenCounts,
      run_close_counts: runCloseCounts,
      dwell_p50_seconds: dwellP50Seconds,
      dwell_p90_seconds: dwellP90Seconds,
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.column('metric_date').doUpdateSet({
        transition_count: transitionCount,
        lifecycle_command_accepted_count: acceptedCount,
        lifecycle_command_rejected_count: rejectedCount,
        duplicate_suppression_count: duplicateCount,
        run_open_counts: runOpenCounts,
        run_close_counts: runCloseCounts,
        dwell_p50_seconds: dwellP50Seconds,
        dwell_p90_seconds: dwellP90Seconds,
        updated_at: new Date(),
      }),
    )
    .execute()

  const row = await db
    .selectFrom('agent_metrics_daily')
    .selectAll()
    .where('metric_date', '=', resolvedMetricDate)
    .executeTakeFirstOrThrow()

  return {
    metricDate: row.metric_date,
    transitionCount: row.transition_count,
    lifecycleCommandAcceptedCount: row.lifecycle_command_accepted_count,
    lifecycleCommandRejectedCount: row.lifecycle_command_rejected_count,
    duplicateSuppressionCount: row.duplicate_suppression_count,
    runOpenCounts: row.run_open_counts,
    runCloseCounts: row.run_close_counts,
    dwellP50Seconds: row.dwell_p50_seconds,
    dwellP90Seconds: row.dwell_p90_seconds,
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function getAgentMetricsDaily(
  db: DbSession,
  metricDate: string,
): Promise<AgentMetricsDailyView | null> {
  const row = await db
    .selectFrom('agent_metrics_daily')
    .selectAll()
    .where('metric_date', '=', metricDate)
    .executeTakeFirst()

  if (!row) {
    return null
  }

  return {
    metricDate: row.metric_date,
    transitionCount: row.transition_count,
    lifecycleCommandAcceptedCount: row.lifecycle_command_accepted_count,
    lifecycleCommandRejectedCount: row.lifecycle_command_rejected_count,
    duplicateSuppressionCount: row.duplicate_suppression_count,
    runOpenCounts: row.run_open_counts,
    runCloseCounts: row.run_close_counts,
    dwellP50Seconds: row.dwell_p50_seconds,
    dwellP90Seconds: row.dwell_p90_seconds,
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function getSystemHealthView(
  db: DbSession,
): Promise<SystemHealthView> {
  const [
    openCounts,
    rawInboxLag,
    lifecycleCommandLag,
    outboxLag,
    stuckIssueCount,
  ] = await Promise.all([
    sql<{ open_issue_count: string; open_workflow_count: string }>`
      select
        count(*)::text as open_issue_count,
        count(distinct state.workflow_id)::text as open_workflow_count
      from issue_runtime_state as state
      inner join workflow_status_catalog as catalog
        on catalog.code = state.current_status_code
       and catalog.config_version = state.pinned_config_version
      where catalog.is_terminal = false
    `.execute(db),
    sql<{ lag_count: string; oldest_age_seconds: number | null }>`
      select
        count(*)::text as lag_count,
        max(extract(epoch from now() - received_at))::int as oldest_age_seconds
      from raw_event_inbox
      where processing_status in ('received', 'failed')
    `.execute(db),
    sql<{ lag_count: string; oldest_age_seconds: number | null }>`
      select
        count(*)::text as lag_count,
        max(extract(epoch from now() - created_at))::int as oldest_age_seconds
      from lifecycle_command_inbox
      where status in ('pending', 'failed', 'processing')
    `.execute(db),
    sql<{ lag_count: string; oldest_age_seconds: number | null }>`
      select
        count(*)::text as lag_count,
        max(extract(epoch from now() - created_at))::int as oldest_age_seconds
      from workflow_effect_outbox
      where status in ('pending', 'failed', 'processing')
    `.execute(db),
    sql<{ stuck_issue_count: string }>`
      select count(*)::text as stuck_issue_count
      from status_projection
      where stuck_for_seconds >= 3600
    `.execute(db),
  ])

  return {
    openIssueCount: Number.parseInt(
      openCounts.rows[0]?.open_issue_count ?? '0',
      10,
    ),
    openWorkflowCount: Number.parseInt(
      openCounts.rows[0]?.open_workflow_count ?? '0',
      10,
    ),
    rawInboxLagCount: Number.parseInt(rawInboxLag.rows[0]?.lag_count ?? '0', 10),
    rawInboxOldestAgeSeconds: rawInboxLag.rows[0]?.oldest_age_seconds ?? null,
    lifecycleCommandLagCount: Number.parseInt(
      lifecycleCommandLag.rows[0]?.lag_count ?? '0',
      10,
    ),
    lifecycleCommandOldestAgeSeconds:
      lifecycleCommandLag.rows[0]?.oldest_age_seconds ?? null,
    outboxLagCount: Number.parseInt(outboxLag.rows[0]?.lag_count ?? '0', 10),
    outboxOldestAgeSeconds: outboxLag.rows[0]?.oldest_age_seconds ?? null,
    stuckIssueCount: Number.parseInt(
      stuckIssueCount.rows[0]?.stuck_issue_count ?? '0',
      10,
    ),
    generatedAt: new Date().toISOString(),
  }
}

export async function getLifecycleSnapshotView(
  db: DbSession,
  issueId: string,
): Promise<LifecycleSnapshotV1 | null> {
  const [runtimeState, processedCommands, latestCommand] = await Promise.all([
    db
      .selectFrom('issue_runtime_state as state')
      .leftJoin('workflow_status_catalog as catalog', (join) =>
        join
          .onRef('catalog.code', '=', 'state.current_status_code')
          .onRef('catalog.config_version', '=', 'state.pinned_config_version'),
      )
      .select([
        'state.workflow_id as workflow_id',
        'state.current_status_code as current_status_code',
        'state.open_operator_question_id as open_operator_question_id',
        'state.pause_reason_code as pause_reason_code',
        'state.pause_reason_text as pause_reason_text',
        'state.resume_condition as resume_condition',
        'state.updated_at as updated_at',
        sql<boolean>`coalesce(catalog.is_terminal, false)`.as('is_terminal'),
      ])
      .where('state.issue_id', '=', issueId)
      .executeTakeFirst(),
    db
      .selectFrom('lifecycle_command_inbox')
      .select(['command_key', 'processed_at'])
      .where('issue_id', '=', issueId)
      .where('processed_at', 'is not', null)
      .orderBy('processed_at', 'desc')
      .limit(RECENT_LIFECYCLE_COMMAND_LIMIT)
      .execute(),
    db
      .selectFrom('lifecycle_command_inbox')
      .select(['workflow_id', 'created_at'])
      .where('issue_id', '=', issueId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst(),
  ])

  if (!runtimeState && !latestCommand) {
    return null
  }

  const openQuestionArtifact =
    runtimeState?.open_operator_question_id !== null &&
    runtimeState?.open_operator_question_id !== undefined
      ? await db
          .selectFrom('artifact_registry')
          .select(['id', 'produced_at'])
          .where('id', '=', runtimeState.open_operator_question_id)
          .executeTakeFirst()
      : null
  const [
    latestDecisionSummaryArtifact,
    latestReviewReportArtifact,
    latestReviewExecutionMetadataArtifact,
  ] =
    runtimeState && isHumanGateStatus(runtimeState.current_status_code)
      ? await Promise.all([
          db
            .selectFrom('artifact_registry')
            .select(['id', 'metadata'])
            .where('issue_id', '=', issueId)
            .where('artifact_type', '=', 'decision_summary')
            .where('superseded_at', 'is', null)
            .orderBy('produced_at', 'desc')
            .executeTakeFirst(),
          db
            .selectFrom('artifact_registry')
            .select(['metadata'])
            .where('issue_id', '=', issueId)
            .where('artifact_type', '=', 'review_report')
            .where('superseded_at', 'is', null)
            .orderBy('produced_at', 'desc')
            .executeTakeFirst(),
          db
            .selectFrom('artifact_registry')
            .select(['metadata'])
            .where('issue_id', '=', issueId)
            .where('artifact_type', '=', 'agent_execution_metadata')
            .where('produced_by_role', '=', 'review_agent')
            .where('superseded_at', 'is', null)
            .orderBy('produced_at', 'desc')
            .executeTakeFirst(),
        ])
      : [null, null, null]
  const latestReviewMetadata = asRecord(latestReviewReportArtifact?.metadata ?? null)
  const latestReviewExecutionMetadata = asRecord(
    latestReviewExecutionMetadataArtifact?.metadata ?? null,
  )
  const contextPackFingerprint =
    typeof latestReviewMetadata.contextPackFingerprint === 'string'
      ? latestReviewMetadata.contextPackFingerprint
      : typeof latestReviewExecutionMetadata.contextPackFingerprint === 'string'
        ? latestReviewExecutionMetadata.contextPackFingerprint
      : null
  const reviewedBuildArtifactId =
    typeof latestReviewMetadata.reviewedBuildArtifactId === 'string'
      ? latestReviewMetadata.reviewedBuildArtifactId
      : typeof latestReviewExecutionMetadata.reviewedBuildArtifactId === 'string'
        ? latestReviewExecutionMetadata.reviewedBuildArtifactId
      : null
  const reviewDisposition =
    latestReviewMetadata.reviewDisposition === 'human_gate_required' ||
    latestReviewMetadata.reviewDisposition === 'rework_recommended' ||
    latestReviewMetadata.reviewDisposition === 'review_inconclusive'
      ? latestReviewMetadata.reviewDisposition
      : null

  const lastProcessedCommand = processedCommands[0] ?? null
  const recentCommandKeys = processedCommands
    .slice()
    .reverse()
    .map((row) => row.command_key)
  const updatedAt = [
    runtimeState?.updated_at ?? null,
    lastProcessedCommand?.processed_at ?? null,
    latestCommand?.created_at ?? null,
  ].reduce<Date>(
    (latest, candidate) =>
      candidate && candidate.getTime() > latest.getTime() ? candidate : latest,
    new Date(0),
  )
  return {
    schemaVersion: 1,
    issueId,
    workflowId: runtimeState?.workflow_id ?? latestCommand?.workflow_id ?? `issue:${issueId}`,
    lastProcessedCommandKey: lastProcessedCommand?.command_key ?? null,
    recentCommandKeys,
    openHumanGate:
      runtimeState && isHumanGateStatus(runtimeState.current_status_code)
        ? {
            statusCode: runtimeState.current_status_code,
            questionArtifactId: openQuestionArtifact?.id ?? null,
            decisionSummaryArtifactId: latestDecisionSummaryArtifact?.id ?? null,
            reasonCode: runtimeState.pause_reason_code,
            reasonText: runtimeState.pause_reason_text,
            openedAt: toIsoString(openQuestionArtifact?.produced_at ?? null),
            reviewDisposition,
            reviewedBuildArtifactId,
            contextPackFingerprint,
          }
        : null,
    activeTimerIntents: extractActiveTimerIntents(
      runtimeState?.resume_condition ?? null,
    ),
    versionMarker: 1,
    terminal: runtimeState?.is_terminal ?? false,
    updatedAt:
      updatedAt.getTime() > 0 ? updatedAt.toISOString() : new Date().toISOString(),
  }
}

export async function listStuckIssues(
  db: DbSession,
): Promise<StuckIssueView[]> {
  const rows = await db
    .selectFrom('status_projection')
    .selectAll()
    .where('stuck_for_seconds', '>=', 3600)
    .orderBy('stuck_for_seconds', 'desc')
    .orderBy('last_transition_at', 'asc')
    .execute()

  return rows.map((row) => ({
    issueId: row.issue_id,
    currentStatusCode: row.current_status_code,
    currentOwnerRole: row.current_owner_role,
    stuckForSeconds: row.stuck_for_seconds,
    lastTransitionAt: row.last_transition_at.toISOString(),
    lastTransitionTrigger: row.last_transition_trigger,
    highRisk: row.high_risk,
  }))
}

export async function getIssueJourney(
  db: DbSession,
  issueId: string,
): Promise<IssueJourneyView> {
  const [transitionRows, runRows, artifactRows, commandRows] = await Promise.all([
    db
      .selectFrom('status_transition_audit')
      .selectAll()
      .where('issue_id', '=', issueId)
      .orderBy('created_at', 'asc')
      .execute(),
    db
      .selectFrom('issue_runs')
      .selectAll()
      .where('issue_id', '=', issueId)
      .orderBy('sequence_no', 'asc')
      .execute(),
    db
      .selectFrom('artifact_registry')
      .selectAll()
      .where('issue_id', '=', issueId)
      .orderBy('produced_at', 'asc')
      .execute(),
    db
      .selectFrom('lifecycle_command_inbox')
      .selectAll()
      .where('issue_id', '=', issueId)
      .orderBy('created_at', 'asc')
      .execute(),
  ])

  return {
    issueId,
    transitions: transitionRows.map((row) => ({
      id: row.id,
      fromStatusCode: row.from_status_code,
      toStatusCode: row.to_status_code,
      triggerCode: row.trigger_code,
      actorType: row.actor_type,
      actorId: row.actor_id,
      ownerRole: row.owner_role,
      reasonCode: row.reason_code,
      reasonText: row.reason_text,
      commentId: row.comment_id,
      checkpointId: row.checkpoint_id,
      leaseId: row.lease_id,
      runId: row.run_id,
      workflowId: row.workflow_id,
      createdAt: row.created_at.toISOString(),
    })),
    runs: runRows.map((row) => ({
      id: row.id,
      sequenceNo: row.sequence_no,
      runKind: row.run_kind,
      status: row.status,
      checkpointId: row.checkpoint_id,
      runnerRequirements: row.runner_requirements,
      openedAt: row.opened_at.toISOString(),
      closedAt: toIsoString(row.closed_at),
    })),
    artifacts: artifactRows.map((row) => ({
      id: row.id,
      artifactType: row.artifact_type,
      artifactScope: row.artifact_scope,
      runId: row.run_id,
      transitionAuditId: row.transition_audit_id,
      artifactUri: row.artifact_uri,
      producedForStatusCode: row.produced_for_status_code,
      producedAt: row.produced_at.toISOString(),
      supersededAt: toIsoString(row.superseded_at),
      metadata: row.metadata,
    })),
    commands: commandRows.map(mapLifecycleCommandInboxRow),
  }
}

export function buildAgentExecutionMetadataArtifact(
  input: AgentExecutionMetadataV2 & {
    issueId: string
    transitionAuditId: string | null
    runId: string | null
    producedForStatusCode: string | null
  },
): {
  issue_id: string
  run_id: string | null
  transition_audit_id: string | null
  artifact_type: string
  artifact_scope: 'transition' | 'issue' | 'run'
  artifact_uri: string
  artifact_summary: string
  produced_by_role: string
  produced_for_status_code: string | null
  metadata: AgentExecutionMetadataV2
} {
  return {
    issue_id: input.issueId,
    run_id: input.runId,
    transition_audit_id: input.transitionAuditId,
    artifact_type: 'agent_execution_metadata',
    artifact_scope: input.transitionAuditId
      ? 'transition'
      : input.runId
        ? 'run'
        : 'issue',
    artifact_uri: `system://workflow/${input.workflowId}/agent-execution-metadata/${input.promptVersion}`,
    artifact_summary: `Agent execution metadata for ${input.agentRole}`,
    produced_by_role: input.agentRole,
    produced_for_status_code: input.producedForStatusCode,
    metadata: input,
  }
}

export function unwrapOutboxCommandEnvelope(
  payload: JsonObject,
): OutboxCommandEnvelopeV1 {
  return payload as unknown as OutboxCommandEnvelopeV1
}
