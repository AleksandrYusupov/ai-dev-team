import { sql, type Kysely, type Selectable, type Transaction } from 'kysely'

import type {
  CanonicalEventEnvelope,
  CommentLogClassification,
  ContextPack,
  ContextPackSourceTrace,
  IssueContract,
  IssueContractDependencies,
  KnowledgeSnapshotStatus,
  LinearSyncOutcome,
  RawEventProcessingStatus,
  WebhookProvider,
  WebhookSignatureStatus,
} from '@ai-dev-team/shared'

import type { Database, JsonObject } from './schema.js'
import { executeWithSerializationRetry } from './workflow-config/publish.js'

type DbSession = Kysely<Database> | Transaction<Database>

function toJsonb<T>(value: T) {
  return sql<T>`${JSON.stringify(value)}::jsonb`
}

function serializeJson<T>(value: T): string {
  return JSON.stringify(value)
}

function mapRawEventInboxRow(
  row: Selectable<Database['raw_event_inbox']>,
): RawEventInboxRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerEventType: row.provider_event_type,
    providerAction: row.provider_action,
    deliveryId: row.delivery_id,
    signatureStatus: row.signature_status,
    providerTimestamp: row.provider_timestamp,
    receivedAt: row.received_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    deliveryAttemptCount: row.delivery_attempt_count,
    replayWindowValid: row.replay_window_valid,
    requestHeaders: row.request_headers,
    rawBody: row.raw_body,
    parsedPayload: row.parsed_payload,
    canonicalEnvelope: row.canonical_envelope as CanonicalEventEnvelope | null,
    processingStatus: row.processing_status,
    processingAttemptCount: row.processing_attempt_count,
    processedAt: row.processed_at,
    lastError: row.last_error,
    issueId: row.issue_id,
    commentId: row.comment_id,
    projectId: row.project_id,
    repositoryFullName: row.repository_full_name,
    dedupeScope: row.dedupe_scope,
    createdAt: row.created_at,
  }
}

export interface PersistRawEventDeliveryInput {
  provider: WebhookProvider
  providerEventType: string
  providerAction: string | null
  deliveryId: string
  signatureStatus: WebhookSignatureStatus
  providerTimestamp: Date | null
  replayWindowValid: boolean | null
  requestHeaders: JsonObject
  rawBody: string
  parsedPayload: JsonObject
  issueId: string | null
  commentId: string | null
  projectId: string | null
  repositoryFullName: string | null
}

export interface PersistRawEventDeliveryResult {
  id: string
  wasDuplicate: boolean
  deliveryAttemptCount: number
  processingStatus: RawEventProcessingStatus
}

export interface RawEventInboxRecord {
  id: string
  provider: WebhookProvider
  providerEventType: string
  providerAction: string | null
  deliveryId: string
  signatureStatus: WebhookSignatureStatus
  providerTimestamp: Date | null
  receivedAt: Date
  firstSeenAt: Date
  lastSeenAt: Date
  deliveryAttemptCount: number
  replayWindowValid: boolean | null
  requestHeaders: JsonObject
  rawBody: string
  parsedPayload: JsonObject
  canonicalEnvelope: CanonicalEventEnvelope | null
  processingStatus: RawEventProcessingStatus
  processingAttemptCount: number
  processedAt: Date | null
  lastError: string | null
  issueId: string | null
  commentId: string | null
  projectId: string | null
  repositoryFullName: string | null
  dedupeScope: string
  createdAt: Date
}

export interface MarkRawEventInboxProcessedInput {
  id: string
  processingStatus: Exclude<
    RawEventProcessingStatus,
    'received' | 'failed' | 'duplicate'
  >
  canonicalEnvelope: CanonicalEventEnvelope | null
  issueId: string | null
  commentId: string | null
  projectId: string | null
  repositoryFullName: string | null
  lastError?: string | null
}

export interface FailRawEventInboxRowInput {
  id: string
  maxAttempts: number
  error: string
}

export interface UpsertCommentLogEntryInput {
  issueId: string
  providerCommentId: string
  sourceInboxEventId: string
  authorActorType: string
  authorActorId: string
  bodyMarkdown: string
  containsAsk: boolean
  classification: CommentLogClassification
  sourceCreatedAt: Date
  sourceUpdatedAt: Date | null
  deletedAt: Date | null
  metadata: JsonObject
}

export interface UpsertIssueContractSnapshotInput {
  issueId: string
  snapshotHash: string
  primaryRepo: string | null
  affectedRepos: string[]
  docsLinks: string[]
  risk: string | null
  dependencies: IssueContractDependencies
  contractJson: IssueContract
}

export interface UpsertKnowledgeNoteSnapshotInput {
  notePath: string
  noteTitle: string
  rootTag: string
  contentHash: string
  resolvedLinks: string[]
  sanitizedMarkdown: string
  summaryMarkdown: string
  sourceUpdatedAt: Date | null
  snapshotStatus: KnowledgeSnapshotStatus
  lastError: string | null
}

export interface CacheContextPackInput {
  issueId: string
  inputFingerprint: string
  bundleJson: ContextPack
  estimatedTokens: number
  sourceTraceJson: ContextPackSourceTrace
}

export interface EnsureIssueLinearSyncProjectionReposInput {
  issueId: string
  repoSlugs: readonly string[]
}

export interface UpsertIssueLinearSyncProjectionInput {
  issueId: string
  repoSlug: string
  branchRef?: string | null
  prNumber?: number | null
  prUrl?: string | null
  prState?: string | null
  latestCheckConclusion?: string | null
  latestCheckUrl?: string | null
  latestDeploymentEnv?: string | null
  latestDeploymentState?: string | null
  latestDeploymentUrl?: string | null
}

export interface MarkIssueLinearSyncProjectionSyncStateInput {
  issueId: string
  payloadHash: string
  outcome: LinearSyncOutcome
  error: string | null
  syncedAt?: Date
}

export async function persistRawEventDelivery(
  db: DbSession,
  input: PersistRawEventDeliveryInput,
): Promise<PersistRawEventDeliveryResult> {
  const result = await sql<{
    id: string
    inserted: boolean
    delivery_attempt_count: number
    processing_status: RawEventProcessingStatus
  }>`
    insert into raw_event_inbox (
      provider,
      provider_event_type,
      provider_action,
      delivery_id,
      signature_status,
      provider_timestamp,
      replay_window_valid,
      request_headers,
      raw_body,
      parsed_payload,
      issue_id,
      comment_id,
      project_id,
      repository_full_name
    ) values (
      ${input.provider},
      ${input.providerEventType},
      ${input.providerAction},
      ${input.deliveryId},
      ${input.signatureStatus},
      ${input.providerTimestamp},
      ${input.replayWindowValid},
      ${toJsonb(input.requestHeaders)},
      ${input.rawBody},
      ${toJsonb(input.parsedPayload)},
      ${input.issueId},
      ${input.commentId},
      ${input.projectId},
      ${input.repositoryFullName}
    )
    on conflict (provider, delivery_id)
    do update set
      last_seen_at = now(),
      delivery_attempt_count = raw_event_inbox.delivery_attempt_count + 1
    returning
      raw_event_inbox.id,
      (xmax = 0) as inserted,
      raw_event_inbox.delivery_attempt_count,
      raw_event_inbox.processing_status
  `.execute(db)

  const row = result.rows[0]

  if (!row) {
    throw new Error('Failed to persist raw event delivery')
  }

  return {
    id: row.id,
    wasDuplicate: !row.inserted,
    deliveryAttemptCount: row.delivery_attempt_count,
    processingStatus: row.processing_status,
  }
}

export async function claimRawEventInboxBatch(
  db: DbSession,
  batchSize: number,
): Promise<RawEventInboxRecord[]> {
  const result = await sql<Database['raw_event_inbox']>`
    with next_batch as (
      select id
      from raw_event_inbox
      where processing_status in ('received', 'failed')
      order by received_at asc
      limit ${batchSize}
      for update skip locked
    )
    update raw_event_inbox as inbox
    set processing_attempt_count = inbox.processing_attempt_count + 1
    from next_batch
    where inbox.id = next_batch.id
    returning inbox.*
  `.execute(db)

  return result.rows.map((row) =>
    mapRawEventInboxRow(
      row as unknown as Selectable<Database['raw_event_inbox']>,
    ),
  )
}

export async function markRawEventInboxProcessed(
  db: DbSession,
  input: MarkRawEventInboxProcessedInput,
): Promise<void> {
  await db
    .updateTable('raw_event_inbox')
    .set({
      canonical_envelope:
        input.canonicalEnvelope === null
          ? null
          : serializeJson(input.canonicalEnvelope),
      processing_status: input.processingStatus,
      processed_at: new Date(),
      last_error: input.lastError ?? null,
      issue_id: input.issueId,
      comment_id: input.commentId,
      project_id: input.projectId,
      repository_full_name: input.repositoryFullName,
    })
    .where('id', '=', input.id)
    .execute()
}

export async function failRawEventInboxRow(
  db: DbSession,
  input: FailRawEventInboxRowInput,
): Promise<void> {
  const current = await db
    .selectFrom('raw_event_inbox')
    .select('processing_attempt_count')
    .where('id', '=', input.id)
    .executeTakeFirstOrThrow()

  const isDeadLetter = current.processing_attempt_count >= input.maxAttempts

  await db
    .updateTable('raw_event_inbox')
    .set({
      processing_status: isDeadLetter ? 'dead_letter' : 'failed',
      processed_at: isDeadLetter ? new Date() : null,
      last_error: input.error,
    })
    .where('id', '=', input.id)
    .execute()
}

export async function upsertCommentLogEntry(
  db: DbSession,
  input: UpsertCommentLogEntryInput,
): Promise<void> {
  await db
    .insertInto('comment_log')
    .values({
      issue_id: input.issueId,
      provider_comment_id: input.providerCommentId,
      source_inbox_event_id: input.sourceInboxEventId,
      author_actor_type: input.authorActorType,
      author_actor_id: input.authorActorId,
      body_markdown: input.bodyMarkdown,
      contains_ask: input.containsAsk,
      classification: input.classification,
      source_created_at: input.sourceCreatedAt,
      source_updated_at: input.sourceUpdatedAt,
      deleted_at: input.deletedAt,
      metadata: serializeJson(input.metadata),
    })
    .onConflict((oc) =>
      oc.column('provider_comment_id').doUpdateSet({
        source_inbox_event_id: input.sourceInboxEventId,
        author_actor_type: input.authorActorType,
        author_actor_id: input.authorActorId,
        body_markdown: input.bodyMarkdown,
        contains_ask: input.containsAsk,
        classification: input.classification,
        source_created_at: input.sourceCreatedAt,
        source_updated_at: input.sourceUpdatedAt,
        deleted_at: input.deletedAt,
        metadata: serializeJson(input.metadata),
        ingested_at: new Date(),
      }),
    )
    .execute()
}

export async function upsertIssueContractSnapshot(
  db: DbSession,
  input: UpsertIssueContractSnapshotInput,
): Promise<void> {
  await db
    .insertInto('linear_issue_contract_snapshots')
    .values({
      issue_id: input.issueId,
      snapshot_hash: input.snapshotHash,
      primary_repo: input.primaryRepo,
      affected_repos: serializeJson(input.affectedRepos),
      docs_links: serializeJson(input.docsLinks),
      risk: input.risk,
      dependencies: serializeJson(input.dependencies),
      contract_json: serializeJson(input.contractJson),
    })
    .onConflict((oc) =>
      oc.columns(['issue_id', 'snapshot_hash']).doNothing(),
    )
    .execute()
}

export async function ensureIssueLinearSyncProjectionRepos(
  db: DbSession,
  input: EnsureIssueLinearSyncProjectionReposInput,
): Promise<void> {
  const repoSlugs = [...new Set(
    input.repoSlugs
      .map((repoSlug) => repoSlug.trim())
      .filter((repoSlug) => repoSlug.length > 0),
  )]

  if (repoSlugs.length === 0) {
    return
  }

  await db
    .insertInto('issue_linear_sync_projection')
    .values(
      repoSlugs.map((repoSlug) => ({
        issue_id: input.issueId,
        repo_slug: repoSlug,
      })),
    )
    .onConflict((oc) => oc.columns(['issue_id', 'repo_slug']).doNothing())
    .execute()
}

function hasOwnProperty<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

export async function upsertIssueLinearSyncProjection(
  db: DbSession,
  input: UpsertIssueLinearSyncProjectionInput,
): Promise<{ changed: boolean }> {
  const current = await db
    .selectFrom('issue_linear_sync_projection')
    .selectAll()
    .where('issue_id', '=', input.issueId)
    .where('repo_slug', '=', input.repoSlug)
    .executeTakeFirst()

  if (!current) {
    await db
      .insertInto('issue_linear_sync_projection')
      .values({
        issue_id: input.issueId,
        repo_slug: input.repoSlug,
        branch_ref: input.branchRef ?? null,
        pr_number: input.prNumber ?? null,
        pr_url: input.prUrl ?? null,
        pr_state: input.prState ?? null,
        latest_check_conclusion: input.latestCheckConclusion ?? null,
        latest_check_url: input.latestCheckUrl ?? null,
        latest_deployment_env: input.latestDeploymentEnv ?? null,
        latest_deployment_state: input.latestDeploymentState ?? null,
        latest_deployment_url: input.latestDeploymentUrl ?? null,
      })
      .execute()

    return { changed: true }
  }

  const patch: Partial<{
    branch_ref: string | null
    pr_number: number | null
    pr_url: string | null
    pr_state: string | null
    latest_check_conclusion: string | null
    latest_check_url: string | null
    latest_deployment_env: string | null
    latest_deployment_state: string | null
    latest_deployment_url: string | null
  }> = {}
  let changed = false

  if (
    hasOwnProperty(input, 'branchRef') &&
    isDefined(input.branchRef) &&
    current.branch_ref !== input.branchRef
  ) {
    patch.branch_ref = input.branchRef ?? null
    changed = true
  }
  if (
    hasOwnProperty(input, 'prNumber') &&
    isDefined(input.prNumber) &&
    current.pr_number !== input.prNumber
  ) {
    patch.pr_number = input.prNumber ?? null
    changed = true
  }
  if (
    hasOwnProperty(input, 'prUrl') &&
    isDefined(input.prUrl) &&
    current.pr_url !== input.prUrl
  ) {
    patch.pr_url = input.prUrl ?? null
    changed = true
  }
  if (
    hasOwnProperty(input, 'prState') &&
    isDefined(input.prState) &&
    current.pr_state !== input.prState
  ) {
    patch.pr_state = input.prState ?? null
    changed = true
  }
  if (
    hasOwnProperty(input, 'latestCheckConclusion') &&
    isDefined(input.latestCheckConclusion) &&
    current.latest_check_conclusion !== input.latestCheckConclusion
  ) {
    patch.latest_check_conclusion = input.latestCheckConclusion ?? null
    changed = true
  }
  if (
    hasOwnProperty(input, 'latestCheckUrl') &&
    isDefined(input.latestCheckUrl) &&
    current.latest_check_url !== input.latestCheckUrl
  ) {
    patch.latest_check_url = input.latestCheckUrl ?? null
    changed = true
  }
  if (
    hasOwnProperty(input, 'latestDeploymentEnv') &&
    isDefined(input.latestDeploymentEnv) &&
    current.latest_deployment_env !== input.latestDeploymentEnv
  ) {
    patch.latest_deployment_env = input.latestDeploymentEnv ?? null
    changed = true
  }
  if (
    hasOwnProperty(input, 'latestDeploymentState') &&
    isDefined(input.latestDeploymentState) &&
    current.latest_deployment_state !== input.latestDeploymentState
  ) {
    patch.latest_deployment_state = input.latestDeploymentState ?? null
    changed = true
  }
  if (
    hasOwnProperty(input, 'latestDeploymentUrl') &&
    isDefined(input.latestDeploymentUrl) &&
    current.latest_deployment_url !== input.latestDeploymentUrl
  ) {
    patch.latest_deployment_url = input.latestDeploymentUrl ?? null
    changed = true
  }

  if (!changed) {
    return { changed: false }
  }

  await db
    .updateTable('issue_linear_sync_projection')
    .set({
      ...patch,
      updated_at: new Date(),
    })
    .where('issue_id', '=', input.issueId)
    .where('repo_slug', '=', input.repoSlug)
    .execute()

  return { changed: true }
}

export async function markIssueLinearSyncProjectionSyncState(
  db: DbSession,
  input: MarkIssueLinearSyncProjectionSyncStateInput,
): Promise<void> {
  await db
    .updateTable('issue_linear_sync_projection')
    .set({
      last_synced_payload_hash: input.payloadHash,
      last_sync_outcome: input.outcome,
      last_sync_error: input.error,
      last_sync_at: input.syncedAt ?? new Date(),
      updated_at: new Date(),
    })
    .where('issue_id', '=', input.issueId)
    .execute()
}

export async function upsertKnowledgeNoteSnapshot(
  db: DbSession,
  input: UpsertKnowledgeNoteSnapshotInput,
): Promise<void> {
  await db
    .insertInto('knowledge_note_snapshots')
    .values({
      note_path: input.notePath,
      note_title: input.noteTitle,
      root_tag: input.rootTag,
      content_hash: input.contentHash,
      resolved_links: serializeJson(input.resolvedLinks),
      sanitized_markdown: input.sanitizedMarkdown,
      summary_markdown: input.summaryMarkdown,
      source_updated_at: input.sourceUpdatedAt,
      snapshot_status: input.snapshotStatus,
      last_error: input.lastError,
    })
    .onConflict((oc) =>
      oc
        .columns(['note_path', 'content_hash'])
        .doUpdateSet({
          note_title: input.noteTitle,
          root_tag: input.rootTag,
          resolved_links: serializeJson(input.resolvedLinks),
          sanitized_markdown: input.sanitizedMarkdown,
          summary_markdown: input.summaryMarkdown,
          source_updated_at: input.sourceUpdatedAt,
          snapshot_status: input.snapshotStatus,
          last_error: input.lastError,
          ingested_at: new Date(),
        })
        .where(
          sql<boolean>`
            knowledge_note_snapshots.snapshot_status <> 'fresh'
            or excluded.snapshot_status = 'fresh'
          `,
        ),
    )
    .execute()
}

export async function cacheContextPack(
  db: Kysely<Database>,
  input: CacheContextPackInput,
): Promise<void> {
  await executeWithSerializationRetry(() =>
    db.transaction().setIsolationLevel('serializable').execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(
        hashtext('context_pack_cache'),
        hashtext(${input.issueId})
      )`.execute(trx)

      const existing = await trx
        .selectFrom('context_pack_cache')
        .select(['id'])
        .where('issue_id', '=', input.issueId)
        .where('input_fingerprint', '=', input.inputFingerprint)
        .where('superseded_at', 'is', null)
        .executeTakeFirst()

      if (existing) {
        return
      }

      const currentVersion = await trx
        .selectFrom('context_pack_cache')
        .select((eb) =>
          eb.fn.max<number>('context_version').as('max_context_version'),
        )
        .where('issue_id', '=', input.issueId)
        .executeTakeFirst()

      const nextVersion = (currentVersion?.max_context_version ?? 0) + 1

      await trx
        .updateTable('context_pack_cache')
        .set({
          superseded_at: new Date(),
        })
        .where('issue_id', '=', input.issueId)
        .where('superseded_at', 'is', null)
        .execute()

      await trx
        .insertInto('context_pack_cache')
        .values({
          issue_id: input.issueId,
          context_version: nextVersion,
          input_fingerprint: input.inputFingerprint,
          bundle_json: serializeJson(input.bundleJson),
          estimated_tokens: input.estimatedTokens,
          source_trace_json: serializeJson(input.sourceTraceJson),
        })
        .execute()
    }),
  )
}

export async function backfillLeaseContextPackFingerprint(
  db: Kysely<Database>,
  input: { issueId: string; fingerprint: string },
): Promise<number> {
  const result = await db
    .updateTable('runner_leases')
    .set({ context_pack_fingerprint: input.fingerprint })
    .where('issue_id', '=', input.issueId)
    .where('context_pack_fingerprint', 'is', null)
    .where('status', '=', 'requested')
    .executeTakeFirst()

  return Number(result.numUpdatedRows)
}
