import { sql, type Kysely, type Selectable } from 'kysely'

import type {
  BlockedIssueProjectionView,
  CommentLogClassification,
  ContextPack,
  ContextPackComment,
  ContextPackSourceTrace,
  IssueContractSnapshot,
  IssueLinearSyncProjectionView,
  IssueLinearSyncRepositoryLinkView,
  KnowledgeNoteSnapshot,
  IssueRuntimeStateView,
  OutboxStatus,
  ProjectRepositoryMapping,
  RepositoryRegistryRecord,
  StatusProjectionView,
  WorkflowLinearMilestonePolicy,
  WorkflowLinearStateMapping,
} from '@ai-dev-team/shared'

import type { Database, JsonObject } from './schema.js'

export interface OutboxCommandRecord {
  id: string
  transitionAuditId: string | null
  issueId: string
  runId: string | null
  commandType: string
  commandPayload: JsonObject
  idempotencyKey: string
  status: OutboxStatus
  attemptCount: number
  scheduledAt: string
  executedAt: string | null
  lastError: string | null
  createdAt: string
}

export interface CommentLogRecord extends ContextPackComment {
  issueId: string
}

export interface ContextPackCacheRecord {
  id: string
  issueId: string
  contextVersion: number
  inputFingerprint: string
  bundleJson: ContextPack
  estimatedTokens: number
  sourceTraceJson: ContextPackSourceTrace
  createdAt: string
  supersededAt: string | null
}

interface ClaimOutboxBatchInput {
  batchSize: number
  processingTimeoutMs: number
}

interface FailOutboxCommandInput {
  id: string
  maxAttempts: number
  error: string
}

function toJsonb<T>(value: T) {
  return sql<T>`${JSON.stringify(value)}::jsonb`
}

export const PHASE7_REFERENCE_REPO_SLUG = 'test_repo'
export const PHASE7_REFERENCE_PROJECT_ID = 'project-phase7'
export const DEFAULT_PHASE7_TEST_REPO_PATH =
  '/tmp/ai-dev-team/reference_repos/test_repo'
export const PHASE7_REFERENCE_ROOT_NOTE =
  'ai_dev_team/architecture/10_phase_7_first_end_to_end_build_and_review_spec.md'

export interface EnsurePhase7ReferenceRepoBootstrapInput {
  linearProjectId?: string
  localCheckoutPath?: string
}

export interface EnsurePhase7ReferenceRepoBootstrapResult {
  repoSlug: string
  linearProjectId: string
  localCheckoutPath: string
}

function mapRuntimeState(
  row: Selectable<Database['issue_runtime_state']>,
): IssueRuntimeStateView {
  return {
    issueId: row.issue_id,
    currentStatusCode: row.current_status_code,
    currentStage: row.current_stage,
    workflowId: row.workflow_id,
    activeRunId: row.active_run_id,
    pinnedConfigVersion: row.pinned_config_version,
    openOperatorQuestionId: row.open_operator_question_id,
    pauseReasonCode: row.pause_reason_code,
    pauseReasonText: row.pause_reason_text,
    resumeCondition: row.resume_condition,
    suspendedFromStatusCode: row.suspended_from_status_code,
    blockReasonCode: row.block_reason_code,
    blockReasonText: row.block_reason_text,
    blockedByIssueIds: row.blocked_by_issue_ids,
    activeLeaseId: row.active_lease_id,
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapStatusProjection(
  row: Selectable<Database['status_projection']>,
): StatusProjectionView {
  return {
    issueId: row.issue_id,
    currentStatusCode: row.current_status_code,
    currentOwnerRole: row.current_owner_role,
    isBlocked: row.is_blocked,
    isWaitingForInput: row.is_waiting_for_input,
    needsHuman: row.needs_human,
    activeLeaseId: row.active_lease_id,
    activeRunId: row.active_run_id,
    lastTransitionAt: row.last_transition_at.toISOString(),
    lastTransitionTrigger: row.last_transition_trigger,
    stuckForSeconds: row.stuck_for_seconds,
    highRisk: row.high_risk,
  }
}

function mapBlockedProjection(
  row: Selectable<Database['blocked_issues_projection']>,
): BlockedIssueProjectionView {
  return {
    issueId: row.issue_id,
    blockedByIssueIds: row.blocked_by_issue_ids,
    blockedByExternal: row.blocked_by_external,
    blockReasonCode: row.block_reason_code,
    since: row.since.toISOString(),
  }
}

function mapOutboxRow(
  row: Selectable<Database['workflow_effect_outbox']>,
): OutboxCommandRecord {
  return {
    id: row.id,
    transitionAuditId: row.transition_audit_id,
    issueId: row.issue_id,
    runId: row.run_id,
    commandType: row.command_type,
    commandPayload: row.command_payload,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: row.attempt_count,
    scheduledAt: row.scheduled_at.toISOString(),
    executedAt: row.executed_at?.toISOString() ?? null,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
  }
}

function mapRepositoryRegistryRow(
  row: Selectable<Database['repository_registry']>,
): RepositoryRegistryRecord {
  return {
    repoSlug: row.repo_slug,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    defaultBranch: row.default_branch,
    visibility: row.visibility,
    linearTeamId: row.linear_team_id,
    obsidianRootNote: row.obsidian_root_note,
    agentGuidanceScope: row.agent_guidance_scope,
    localCheckoutPath: row.local_checkout_path,
    requiredChecks: row.required_checks,
    environments: row.environments,
    repoKind: row.repo_kind,
    serviceDependencies: row.service_dependencies,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapProjectRepositoryMappingRow(
  row: Selectable<Database['project_repository_mappings']>,
): ProjectRepositoryMapping {
  return {
    id: row.id,
    linearProjectId: row.linear_project_id,
    repoSlug: row.repo_slug,
    mappingRole: row.mapping_role,
    priorityOrder: row.priority_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapIssueLinearSyncProjectionRow(
  row: Selectable<Database['issue_linear_sync_projection']>,
): IssueLinearSyncRepositoryLinkView {
  return {
    issueId: row.issue_id,
    repoSlug: row.repo_slug,
    branchRef: row.branch_ref,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    prState: row.pr_state,
    latestCheckConclusion: row.latest_check_conclusion,
    latestCheckUrl: row.latest_check_url,
    latestDeploymentEnv: row.latest_deployment_env,
    latestDeploymentState: row.latest_deployment_state,
    latestDeploymentUrl: row.latest_deployment_url,
    lastSyncedPayloadHash: row.last_synced_payload_hash,
    lastSyncOutcome: row.last_sync_outcome,
    lastSyncError: row.last_sync_error,
    lastSyncAt: row.last_sync_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  }
}

function mapIssueContractSnapshotRow(
  row: Selectable<Database['linear_issue_contract_snapshots']>,
): IssueContractSnapshot {
  return {
    id: row.id,
    issueId: row.issue_id,
    snapshotHash: row.snapshot_hash,
    primaryRepo: row.primary_repo,
    affectedRepos: row.affected_repos,
    docsLinks: row.docs_links,
    risk: row.risk,
    dependencies: row.dependencies as IssueContractSnapshot['dependencies'],
    contractJson: row.contract_json as IssueContractSnapshot['contractJson'],
    createdAt: row.created_at.toISOString(),
  }
}

function mapKnowledgeNoteSnapshotRow(
  row: Selectable<Database['knowledge_note_snapshots']>,
): KnowledgeNoteSnapshot {
  return {
    id: row.id,
    notePath: row.note_path,
    noteTitle: row.note_title,
    rootTag: row.root_tag,
    contentHash: row.content_hash,
    resolvedLinks: row.resolved_links,
    sanitizedMarkdown: row.sanitized_markdown,
    summaryMarkdown: row.summary_markdown,
    sourceUpdatedAt: row.source_updated_at?.toISOString() ?? null,
    ingestedAt: row.ingested_at.toISOString(),
    snapshotStatus: row.snapshot_status,
    lastError: row.last_error,
  }
}

function mapCommentLogRow(
  row: Selectable<Database['comment_log']>,
): CommentLogRecord {
  return {
    issueId: row.issue_id,
    providerCommentId: row.provider_comment_id,
    classification: row.classification as CommentLogClassification,
    bodyMarkdown: row.body_markdown,
    containsAsk: row.contains_ask,
    sourceCreatedAt: row.source_created_at.toISOString(),
    sourceUpdatedAt: row.source_updated_at?.toISOString() ?? null,
    authorActorType: row.author_actor_type,
    authorActorId: row.author_actor_id,
  }
}

function mapContextPackCacheRow(
  row: Selectable<Database['context_pack_cache']>,
): ContextPackCacheRecord {
  return {
    id: row.id,
    issueId: row.issue_id,
    contextVersion: row.context_version,
    inputFingerprint: row.input_fingerprint,
    bundleJson: row.bundle_json,
    estimatedTokens: row.estimated_tokens,
    sourceTraceJson: row.source_trace_json,
    createdAt: row.created_at.toISOString(),
    supersededAt: row.superseded_at?.toISOString() ?? null,
  }
}

export async function getIssueRuntimeStateView(
  db: Kysely<Database>,
  issueId: string,
): Promise<IssueRuntimeStateView | null> {
  const row = await db
    .selectFrom('issue_runtime_state')
    .selectAll()
    .where('issue_id', '=', issueId)
    .executeTakeFirst()

  return row ? mapRuntimeState(row) : null
}

export async function getStatusProjectionView(
  db: Kysely<Database>,
  issueId: string,
): Promise<StatusProjectionView | null> {
  const row = await db
    .selectFrom('status_projection')
    .selectAll()
    .where('issue_id', '=', issueId)
    .executeTakeFirst()

  return row ? mapStatusProjection(row) : null
}

export async function getBlockedIssueProjectionView(
  db: Kysely<Database>,
  issueId: string,
): Promise<BlockedIssueProjectionView | null> {
  const row = await db
    .selectFrom('blocked_issues_projection')
    .selectAll()
    .where('issue_id', '=', issueId)
    .executeTakeFirst()

  return row ? mapBlockedProjection(row) : null
}

export async function claimOutboxBatch(
  db: Kysely<Database>,
  input: ClaimOutboxBatchInput,
): Promise<OutboxCommandRecord[]> {
  const reclaimBefore = new Date(Date.now() - input.processingTimeoutMs)

  const result = await sql<Database['workflow_effect_outbox']>`
    with next_batch as (
      select id
      from workflow_effect_outbox
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
    update workflow_effect_outbox as outbox
    set
      status = 'processing',
      attempt_count = outbox.attempt_count + 1,
      scheduled_at = now(),
      last_error = null
    from next_batch
    where outbox.id = next_batch.id
    returning outbox.*
  `.execute(db)

  return result.rows.map((row) =>
    mapOutboxRow(
      row as unknown as Selectable<Database['workflow_effect_outbox']>,
    ),
  )
}

export async function completeOutboxCommand(
  db: Kysely<Database>,
  id: string,
): Promise<void> {
  await db
    .updateTable('workflow_effect_outbox')
    .set({
      status: 'done',
      executed_at: new Date(),
      last_error: null,
    })
    .where('id', '=', id)
    .execute()
}

export async function failOutboxCommand(
  db: Kysely<Database>,
  input: FailOutboxCommandInput,
): Promise<void> {
  const current = await db
    .selectFrom('workflow_effect_outbox')
    .select(['attempt_count'])
    .where('id', '=', input.id)
    .executeTakeFirstOrThrow()

  const isDeadLetter = current.attempt_count >= input.maxAttempts
  const retryDelayMs = Math.min(
    60_000,
    1_000 * 2 ** Math.max(0, current.attempt_count - 1),
  )

  await db
    .updateTable('workflow_effect_outbox')
    .set({
      status: isDeadLetter ? 'dead_letter' : 'failed',
      last_error: input.error,
      scheduled_at: isDeadLetter
        ? new Date()
        : new Date(Date.now() + retryDelayMs),
    })
    .where('id', '=', input.id)
    .execute()
}

export async function getRepositoryRegistryRecord(
  db: Kysely<Database>,
  repoSlug: string,
): Promise<RepositoryRegistryRecord | null> {
  const row = await db
    .selectFrom('repository_registry')
    .selectAll()
    .where('repo_slug', '=', repoSlug)
    .executeTakeFirst()

  return row ? mapRepositoryRegistryRow(row) : null
}

export async function listActiveRepositoryRegistryRecords(
  db: Kysely<Database>,
): Promise<RepositoryRegistryRecord[]> {
  const rows = await db
    .selectFrom('repository_registry')
    .selectAll()
    .where('is_active', '=', true)
    .orderBy('repo_slug', 'asc')
    .execute()

  return rows.map(mapRepositoryRegistryRow)
}

export async function getRepositoryRegistryRecords(
  db: Kysely<Database>,
  repoSlugs: readonly string[],
): Promise<RepositoryRegistryRecord[]> {
  if (repoSlugs.length === 0) {
    return []
  }

  const rows = await db
    .selectFrom('repository_registry')
    .selectAll()
    .where('repo_slug', 'in', [...repoSlugs])
    .orderBy('repo_slug', 'asc')
    .execute()

  return rows.map(mapRepositoryRegistryRow)
}

export async function getProjectRepositoryMappings(
  db: Kysely<Database>,
  linearProjectId: string,
): Promise<ProjectRepositoryMapping[]> {
  const rows = await db
    .selectFrom('project_repository_mappings')
    .selectAll()
    .where('linear_project_id', '=', linearProjectId)
    .orderBy('mapping_role', 'asc')
    .orderBy('priority_order', 'asc')
    .execute()

  return rows.map(mapProjectRepositoryMappingRow)
}

export async function listWorkflowLinearStateMappings(
  db: Kysely<Database>,
  configVersion: number,
): Promise<WorkflowLinearStateMapping[]> {
  const rows = await db
    .selectFrom('workflow_linear_state_mappings')
    .selectAll()
    .where('config_version', '=', configVersion)
    .orderBy('status_code', 'asc')
    .execute()

  return rows.map((row) => ({
    statusCode: row.status_code,
    linearStateName: row.linear_state_name,
    syncEnabled: row.sync_enabled,
  }))
}

export async function listWorkflowLinearMilestonePolicies(
  db: Kysely<Database>,
  configVersion: number,
): Promise<WorkflowLinearMilestonePolicy[]> {
  const rows = await db
    .selectFrom('workflow_linear_milestone_policies')
    .selectAll()
    .where('config_version', '=', configVersion)
    .orderBy('event_code', 'asc')
    .execute()

  return rows.map((row) => ({
    eventCode: row.event_code,
    eventLabel: row.event_label,
    postComment: row.post_comment,
    createProjectUpdate: row.create_project_update,
    projectUpdateHealth: row.project_update_health,
  }))
}

export async function getRepositoryRegistryRecordByFullName(
  db: Kysely<Database>,
  repositoryFullName: string,
): Promise<RepositoryRegistryRecord | null> {
  const [githubOwner, githubRepo] = repositoryFullName.split('/', 2)

  if (!githubOwner || !githubRepo) {
    return null
  }

  const row = await db
    .selectFrom('repository_registry')
    .selectAll()
    .where('github_owner', '=', githubOwner)
    .where('github_repo', '=', githubRepo)
    .executeTakeFirst()

  return row ? mapRepositoryRegistryRow(row) : null
}

export async function listIssueLinearSyncProjectionRows(
  db: Kysely<Database>,
  issueId: string,
): Promise<IssueLinearSyncRepositoryLinkView[]> {
  const rows = await db
    .selectFrom('issue_linear_sync_projection')
    .selectAll()
    .where('issue_id', '=', issueId)
    .orderBy('repo_slug', 'asc')
    .execute()

  return rows.map(mapIssueLinearSyncProjectionRow)
}

export async function listIssueLinearSyncProjectionRowsByRepo(
  db: Kysely<Database>,
  repoSlug: string,
): Promise<IssueLinearSyncRepositoryLinkView[]> {
  const rows = await db
    .selectFrom('issue_linear_sync_projection')
    .selectAll()
    .where('repo_slug', '=', repoSlug)
    .orderBy('updated_at', 'desc')
    .execute()

  return rows.map(mapIssueLinearSyncProjectionRow)
}

export async function getIssueLinearSyncProjectionView(
  db: Kysely<Database>,
  issueId: string,
): Promise<IssueLinearSyncProjectionView | null> {
  const repositories = await listIssueLinearSyncProjectionRows(db, issueId)

  if (repositories.length === 0) {
    return null
  }

  return {
    issueId,
    projectId: await getLatestIssueProjectId(db, issueId),
    repositories,
  }
}

export async function ensurePhase7ReferenceRepoBootstrap(
  db: Kysely<Database>,
  input: EnsurePhase7ReferenceRepoBootstrapInput = {},
): Promise<EnsurePhase7ReferenceRepoBootstrapResult> {
  const linearProjectId = input.linearProjectId ?? PHASE7_REFERENCE_PROJECT_ID
  const localCheckoutPath =
    input.localCheckoutPath ?? DEFAULT_PHASE7_TEST_REPO_PATH

  await db.transaction().execute(async (trx) => {
    const existingPrimary = await trx
      .selectFrom('project_repository_mappings')
      .select(['repo_slug'])
      .where('linear_project_id', '=', linearProjectId)
      .where('mapping_role', '=', 'primary')
      .executeTakeFirst()

    if (
      existingPrimary &&
      existingPrimary.repo_slug !== PHASE7_REFERENCE_REPO_SLUG
    ) {
      throw new Error(
        `Phase 7 bootstrap refused to replace primary mapping ${existingPrimary.repo_slug} for project ${linearProjectId}`,
      )
    }

    await trx
      .insertInto('repository_registry')
      .values({
        repo_slug: PHASE7_REFERENCE_REPO_SLUG,
        github_owner: 'authenticated-owner',
        github_repo: PHASE7_REFERENCE_REPO_SLUG,
        default_branch: 'main',
        visibility: 'private',
        linear_team_id: 'team-phase7',
        obsidian_root_note: PHASE7_REFERENCE_ROOT_NOTE,
        agent_guidance_scope: '.',
        local_checkout_path: localCheckoutPath,
        required_checks: toJsonb(['typecheck', 'test:phase7', 'test:phase7:live']),
        environments: toJsonb(['local']),
        repo_kind: 'application',
        service_dependencies: toJsonb([]),
        is_active: true,
      })
      .onConflict((oc) =>
        oc.column('repo_slug').doUpdateSet({
          github_owner: 'authenticated-owner',
          github_repo: PHASE7_REFERENCE_REPO_SLUG,
          default_branch: 'main',
          visibility: 'private',
          linear_team_id: 'team-phase7',
          obsidian_root_note: PHASE7_REFERENCE_ROOT_NOTE,
          agent_guidance_scope: '.',
          local_checkout_path: localCheckoutPath,
          required_checks: toJsonb([
            'typecheck',
            'test:phase7',
            'test:phase7:live',
          ]),
          environments: toJsonb(['local']),
          repo_kind: 'application',
          service_dependencies: toJsonb([]),
          is_active: true,
          updated_at: new Date(),
        }),
      )
      .execute()

    await trx
      .insertInto('project_repository_mappings')
      .values({
        linear_project_id: linearProjectId,
        repo_slug: PHASE7_REFERENCE_REPO_SLUG,
        mapping_role: 'primary',
        priority_order: 1,
      })
      .onConflict((oc) =>
        oc.columns(['linear_project_id', 'repo_slug']).doUpdateSet({
          mapping_role: 'primary',
          priority_order: 1,
          updated_at: new Date(),
        }),
      )
      .execute()
  })

  return {
    repoSlug: PHASE7_REFERENCE_REPO_SLUG,
    linearProjectId,
    localCheckoutPath,
  }
}

export async function getLatestIssueContractSnapshot(
  db: Kysely<Database>,
  issueId: string,
): Promise<IssueContractSnapshot | null> {
  const row = await db
    .selectFrom('linear_issue_contract_snapshots')
    .selectAll()
    .where('issue_id', '=', issueId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  return row ? mapIssueContractSnapshotRow(row) : null
}

export async function getLatestIssueProjectId(
  db: Kysely<Database>,
  issueId: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('raw_event_inbox')
    .select('project_id')
    .where('issue_id', '=', issueId)
    .where('project_id', 'is not', null)
    .orderBy('received_at', 'desc')
    .executeTakeFirst()

  return row?.project_id ?? null
}

export async function getLatestKnowledgeNoteSnapshots(
  db: Kysely<Database>,
  notePaths: readonly string[],
): Promise<KnowledgeNoteSnapshot[]> {
  if (notePaths.length === 0) {
    return []
  }

  const rows = await db
    .selectFrom('knowledge_note_snapshots')
    .selectAll()
    .where('note_path', 'in', [...notePaths])
    .orderBy('note_path', 'asc')
    .orderBy('ingested_at', 'desc')
    .execute()

  const latestFreshByPath = new Map<
    string,
    Selectable<Database['knowledge_note_snapshots']>
  >()

  for (const row of rows) {
    if (row.snapshot_status !== 'fresh') {
      continue
    }

    if (!latestFreshByPath.has(row.note_path)) {
      latestFreshByPath.set(row.note_path, row)
    }
  }

  return notePaths
    .map((notePath) => latestFreshByPath.get(notePath))
    .filter((row): row is Selectable<Database['knowledge_note_snapshots']> =>
      Boolean(row),
    )
    .map(mapKnowledgeNoteSnapshotRow)
}

export async function getLatestKnowledgeNoteSnapshotStatuses(
  db: Kysely<Database>,
  notePaths: readonly string[],
): Promise<KnowledgeNoteSnapshot[]> {
  if (notePaths.length === 0) {
    return []
  }

  const rows = await db
    .selectFrom('knowledge_note_snapshots')
    .selectAll()
    .where('note_path', 'in', [...notePaths])
    .orderBy('note_path', 'asc')
    .orderBy('ingested_at', 'desc')
    .execute()

  const latestByPath = new Map<
    string,
    Selectable<Database['knowledge_note_snapshots']>
  >()

  for (const row of rows) {
    if (!latestByPath.has(row.note_path)) {
      latestByPath.set(row.note_path, row)
    }
  }

  return notePaths
    .map((notePath) => latestByPath.get(notePath))
    .filter((row): row is Selectable<Database['knowledge_note_snapshots']> =>
      Boolean(row),
    )
    .map(mapKnowledgeNoteSnapshotRow)
}

export async function getLatestRelevantComments(
  db: Kysely<Database>,
  issueId: string,
  limit: number,
): Promise<CommentLogRecord[]> {
  const rows = await db
    .selectFrom('comment_log')
    .selectAll()
    .where('issue_id', '=', issueId)
    .where('deleted_at', 'is', null)
    .orderBy('source_updated_at', 'desc')
    .orderBy('source_created_at', 'desc')
    .limit(limit)
    .execute()

  return rows.map(mapCommentLogRow)
}

export async function getActiveContextPackCache(
  db: Kysely<Database>,
  issueId: string,
  inputFingerprint: string,
): Promise<ContextPackCacheRecord | null> {
  const row = await db
    .selectFrom('context_pack_cache')
    .selectAll()
    .where('issue_id', '=', issueId)
    .where('input_fingerprint', '=', inputFingerprint)
    .where('superseded_at', 'is', null)
    .executeTakeFirst()

  return row ? mapContextPackCacheRow(row) : null
}
