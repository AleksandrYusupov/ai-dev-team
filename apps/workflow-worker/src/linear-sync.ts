import { createHash } from 'node:crypto'

import type { DbSession, JsonObject } from '@ai-dev-team/db'
import {
  ensureIssueLinearSyncProjectionRepos,
  upsertIssueLinearSyncProjection,
} from '@ai-dev-team/db'
import type {
  LinearSyncMilestoneEventCode,
  OutboxCommandEnvelopeV1,
} from '@ai-dev-team/shared'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getNestedObject(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  return isRecord(value[key]) ? value[key] : null
}

function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortObject(entry))
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableSortObject(entryValue)]),
    )
  }

  return value
}

function hashLinearSyncPayload(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableSortObject(value)))
    .digest('hex')
}

export function normalizeBranchRef(value: string | null): string | null {
  if (!value) {
    return null
  }

  return value.startsWith('refs/') ? value : `refs/heads/${value}`
}

function buildOutboxCommandPayload(input: {
  issueId: string
  runId: string | null
  workflowId: string
  transitionAuditId: string | null
  configVersion: number
  commandKey: string
  payloadHash: string
  milestoneEvent: LinearSyncMilestoneEventCode | null
}): OutboxCommandEnvelopeV1 {
  return {
    schemaVersion: 1,
    commandType: 'sync_linear_state',
    issuedAt: new Date().toISOString(),
    issueId: input.issueId,
    runId: input.runId,
    workflowId: input.workflowId,
    transitionAuditId: input.transitionAuditId,
    configVersion: input.configVersion,
    commandKey: input.commandKey,
    body: {
      payloadHash: input.payloadHash,
      milestoneEvent: input.milestoneEvent,
      intent_persisted_only: true,
    },
    intentPersistedOnly: true,
  }
}

export async function enqueueLinearStateSyncCommand(
  db: DbSession,
  input: {
    issueId: string
    transitionAuditId: string | null
    runId?: string | null
    milestoneEvent?: LinearSyncMilestoneEventCode | null
  },
): Promise<{ enqueued: boolean; payloadHash: string | null }> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select([
      'current_status_code',
      'pinned_config_version',
      'active_run_id',
      'workflow_id',
    ])
    .where('issue_id', '=', input.issueId)
    .executeTakeFirst()

  if (!runtimeState) {
    return {
      enqueued: false,
      payloadHash: null,
    }
  }

  const [stateMappings, projections, latestProjectRow] = await Promise.all([
    db
      .selectFrom('workflow_linear_state_mappings')
      .select(['status_code', 'linear_state_name', 'sync_enabled'])
      .where('config_version', '=', runtimeState.pinned_config_version)
      .execute(),
    db
      .selectFrom('issue_linear_sync_projection')
      .selectAll()
      .where('issue_id', '=', input.issueId)
      .orderBy('repo_slug', 'asc')
      .execute(),
    db
      .selectFrom('raw_event_inbox')
      .select('project_id')
      .where('issue_id', '=', input.issueId)
      .where('project_id', 'is not', null)
      .orderBy('received_at', 'desc')
      .executeTakeFirst(),
  ])

  const stateMapping = stateMappings.find(
    (mapping) => mapping.status_code === runtimeState.current_status_code,
  )

  if (!stateMapping) {
    throw new Error(
      `Missing linear state mapping for ${runtimeState.current_status_code} at config version ${runtimeState.pinned_config_version.toString()}`,
    )
  }

  if (!stateMapping.sync_enabled && !input.milestoneEvent) {
    return {
      enqueued: false,
      payloadHash: null,
    }
  }

  const payloadHash = hashLinearSyncPayload({
    issueId: input.issueId,
    currentStatusCode: runtimeState.current_status_code,
    linearStateName: stateMapping.linear_state_name,
    configVersion: runtimeState.pinned_config_version,
    projectId: latestProjectRow?.project_id ?? null,
    milestoneEvent: input.milestoneEvent ?? null,
    repositories: projections.map((row) => ({
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
    })),
  })

  if (
    projections.length > 0 &&
    projections.every(
      (row) =>
        row.last_synced_payload_hash === payloadHash &&
        row.last_sync_outcome === 'succeeded',
    )
  ) {
    return {
      enqueued: false,
      payloadHash,
    }
  }

  const commandKey = `sync-linear-state:${input.issueId}:${payloadHash}`
  const commandPayload = buildOutboxCommandPayload({
    issueId: input.issueId,
    runId: input.runId ?? runtimeState.active_run_id,
    workflowId: runtimeState.workflow_id,
    transitionAuditId: input.transitionAuditId,
    configVersion: runtimeState.pinned_config_version,
    commandKey,
    payloadHash,
    milestoneEvent: input.milestoneEvent ?? null,
  })

  const insertedCommand = await db
    .insertInto('workflow_effect_outbox')
    .values({
      transition_audit_id: input.transitionAuditId,
      issue_id: input.issueId,
      run_id: input.runId ?? runtimeState.active_run_id,
      command_type: 'sync_linear_state',
      command_payload: commandPayload as unknown as JsonObject,
      idempotency_key: commandKey,
    })
    .onConflict((conflict) => conflict.column('idempotency_key').doNothing())
    .returning('id')
    .executeTakeFirst()

  if (!insertedCommand) {
    return {
      enqueued: false,
      payloadHash,
    }
  }

  if (projections.length > 0) {
    await db
      .updateTable('issue_linear_sync_projection')
      .set({
        last_sync_outcome: 'pending',
        last_sync_error: null,
        updated_at: new Date(),
      })
      .where('issue_id', '=', input.issueId)
      .execute()
  }

  return {
    enqueued: true,
    payloadHash,
  }
}

export async function ensureIssueLinearSyncProjectionFromContract(
  db: DbSession,
  input: {
    issueId: string
    primaryRepo: string | null
    affectedRepos: readonly string[]
  },
): Promise<void> {
  const repoSlugs = [
    input.primaryRepo,
    ...input.affectedRepos,
  ].filter((repoSlug): repoSlug is string => typeof repoSlug === 'string' && repoSlug.length > 0)

  await ensureIssueLinearSyncProjectionRepos(db, {
    issueId: input.issueId,
    repoSlugs,
  })
}

interface GitHubProjectionChange {
  branchRef: string | null
  prNumber?: number | null
  prUrl?: string | null
  prState?: string | null
  latestCheckConclusion?: string | null
  latestCheckUrl?: string | null
  latestDeploymentEnv?: string | null
  latestDeploymentState?: string | null
  latestDeploymentUrl?: string | null
  milestoneEvent: LinearSyncMilestoneEventCode | null
}

function isCiFailure(conclusion: string | null): boolean {
  return ['failure', 'timed_out', 'cancelled', 'action_required'].includes(
    conclusion ?? '',
  )
}

function isDeploymentFailure(state: string | null): boolean {
  return ['failure', 'error'].includes(state ?? '')
}

function buildGitHubProjectionChange(input: {
  providerEventType: string
  providerAction: string | null
  payload: JsonObject
}): GitHubProjectionChange | null {
  switch (input.providerEventType) {
    case 'pull_request': {
      const pullRequest = getNestedObject(input.payload, 'pull_request')

      if (!pullRequest) {
        return null
      }

      const merged = pullRequest.merged === true

      return {
        branchRef: normalizeBranchRef(
          getString(getNestedObject(pullRequest, 'head')?.ref),
        ),
        prNumber: getNumber(input.payload.number) ?? getNumber(pullRequest.number),
        prUrl: getString(pullRequest.html_url),
        prState: merged ? 'merged' : getString(pullRequest.state),
        milestoneEvent:
          input.providerAction === 'opened' ||
          input.providerAction === 'reopened' ||
          input.providerAction === 'ready_for_review'
            ? 'pr_opened'
            : null,
      }
    }
    case 'pull_request_review': {
      const pullRequest = getNestedObject(input.payload, 'pull_request')

      if (!pullRequest) {
        return null
      }

      return {
        branchRef: normalizeBranchRef(
          getString(getNestedObject(pullRequest, 'head')?.ref),
        ),
        prNumber: getNumber(input.payload.number) ?? getNumber(pullRequest.number),
        prUrl: getString(pullRequest.html_url),
        prState: getString(pullRequest.state),
        milestoneEvent: null,
      }
    }
    case 'workflow_run': {
      const workflowRun = getNestedObject(input.payload, 'workflow_run')

      if (!workflowRun) {
        return null
      }

      const conclusion = getString(workflowRun.conclusion) ?? getString(workflowRun.status)

      return {
        branchRef: normalizeBranchRef(getString(workflowRun.head_branch)),
        latestCheckConclusion: conclusion,
        latestCheckUrl: getString(workflowRun.html_url),
        milestoneEvent:
          input.providerAction === 'completed'
            ? conclusion === 'success'
              ? 'ci_green'
              : isCiFailure(conclusion)
                ? 'ci_failed'
                : null
            : null,
      }
    }
    case 'check_run': {
      const checkRun = getNestedObject(input.payload, 'check_run')

      if (!checkRun) {
        return null
      }

      const conclusion = getString(checkRun.conclusion) ?? getString(checkRun.status)
      const pullRequestRef = Array.isArray(checkRun.pull_requests)
        ? checkRun.pull_requests[0]
        : null

      return {
        branchRef: normalizeBranchRef(
          getString(getNestedObject(checkRun, 'check_suite')?.head_branch),
        ),
        prNumber:
          isRecord(pullRequestRef) && getNumber(pullRequestRef.number) !== null
            ? getNumber(pullRequestRef.number)
            : null,
        latestCheckConclusion: conclusion,
        latestCheckUrl:
          getString(checkRun.details_url) ?? getString(checkRun.html_url),
        milestoneEvent:
          input.providerAction === 'completed'
            ? conclusion === 'success'
              ? 'ci_green'
              : isCiFailure(conclusion)
                ? 'ci_failed'
                : null
            : null,
      }
    }
    case 'deployment_status': {
      const deploymentStatus = getNestedObject(input.payload, 'deployment_status')
      const deployment = getNestedObject(input.payload, 'deployment')

      if (!deploymentStatus) {
        return null
      }

      const state = getString(deploymentStatus.state)

      return {
        branchRef: normalizeBranchRef(getString(deployment?.ref)),
        latestDeploymentEnv:
          getString(deploymentStatus.environment) ??
          getString(deployment?.environment),
        latestDeploymentState: state,
        latestDeploymentUrl:
          getString(deploymentStatus.target_url) ??
          getString(deploymentStatus.log_url),
        milestoneEvent:
          state === 'success'
            ? 'deploy_healthy'
            : isDeploymentFailure(state)
              ? 'deploy_failed'
              : null,
      }
    }
    default:
      return null
  }
}

function selectProjectionIssueId(input: {
  repoRows: Array<{
    issue_id: string
    repo_slug: string
    branch_ref: string | null
    pr_number: number | null
  }>
  change: GitHubProjectionChange
}): string | null {
  if (input.change.prNumber !== undefined && input.change.prNumber !== null) {
    const exactPrMatches = input.repoRows.filter(
      (row) => row.pr_number === input.change.prNumber,
    )

    if (exactPrMatches.length === 1) {
      return exactPrMatches[0].issue_id
    }
  }

  if (input.change.branchRef) {
    const branchMatches = input.repoRows.filter(
      (row) => row.branch_ref === input.change.branchRef,
    )

    if (branchMatches.length === 1) {
      return branchMatches[0].issue_id
    }

    const unassignedBranchRows = input.repoRows.filter((row) => row.branch_ref === null)
    const issueIds = [...new Set(unassignedBranchRows.map((row) => row.issue_id))]

    if (issueIds.length === 1) {
      return issueIds[0]
    }
  }

  if (input.repoRows.length === 1) {
    return input.repoRows[0].issue_id
  }

  return null
}

export async function reconcileGitHubLinearSyncProjection(
  db: DbSession,
  input: {
    providerEventType: string
    providerAction: string | null
    repositoryFullName: string | null
    payload: JsonObject
  },
): Promise<{
  issueId: string | null
  changed: boolean
  milestoneEvent: LinearSyncMilestoneEventCode | null
}> {
  if (!input.repositoryFullName) {
    return {
      issueId: null,
      changed: false,
      milestoneEvent: null,
    }
  }

  const repositoryFullNameParts = input.repositoryFullName.split('/', 2)

  if (repositoryFullNameParts.length !== 2) {
    return {
      issueId: null,
      changed: false,
      milestoneEvent: null,
    }
  }

  const repository = await db
    .selectFrom('repository_registry')
    .select(['repo_slug'])
    .where('github_owner', '=', repositoryFullNameParts[0])
    .where('github_repo', '=', repositoryFullNameParts[1])
    .executeTakeFirst()

  if (!repository) {
    return {
      issueId: null,
      changed: false,
      milestoneEvent: null,
    }
  }

  const change = buildGitHubProjectionChange({
    providerEventType: input.providerEventType,
    providerAction: input.providerAction,
    payload: input.payload,
  })

  if (!change) {
    return {
      issueId: null,
      changed: false,
      milestoneEvent: null,
    }
  }

  const repoRows = await db
    .selectFrom('issue_linear_sync_projection')
    .select(['issue_id', 'repo_slug', 'branch_ref', 'pr_number'])
    .where('repo_slug', '=', repository.repo_slug)
    .orderBy('updated_at', 'desc')
    .execute()

  const issueId = selectProjectionIssueId({
    repoRows,
    change,
  })

  if (!issueId) {
    return {
      issueId: null,
      changed: false,
      milestoneEvent: null,
    }
  }

  await ensureIssueLinearSyncProjectionRepos(db, {
    issueId,
    repoSlugs: [repository.repo_slug],
  })

  const result = await upsertIssueLinearSyncProjection(db, {
    issueId,
    repoSlug: repository.repo_slug,
    branchRef: change.branchRef,
    prNumber: change.prNumber,
    prUrl: change.prUrl,
    prState: change.prState,
    latestCheckConclusion: change.latestCheckConclusion,
    latestCheckUrl: change.latestCheckUrl,
    latestDeploymentEnv: change.latestDeploymentEnv,
    latestDeploymentState: change.latestDeploymentState,
    latestDeploymentUrl: change.latestDeploymentUrl,
  })

  return {
    issueId,
    changed: result.changed,
    milestoneEvent: result.changed ? change.milestoneEvent : null,
  }
}
