import { sql } from 'kysely'

import type { DbSession } from '@ai-dev-team/db'

interface ProjectionInput {
  issueId: string
  toStatus: string
  ownerRole: string
  activeLeaseId: string | null
  activeRunId: string | null
  lastTransitionTrigger: string
  blockedByIssueIds: string[]
  blockReasonCode: string | null
  highRisk: boolean
}

function toJsonb<T>(value: T) {
  return sql<T>`${JSON.stringify(value)}::jsonb`
}

export async function writeProjections(
  db: DbSession,
  input: ProjectionInput,
): Promise<void> {
  await db
    .insertInto('status_projection')
    .values({
      issue_id: input.issueId,
      current_status_code: input.toStatus,
      current_owner_role: input.ownerRole,
      is_blocked: input.toStatus === 'blocked',
      is_waiting_for_input: input.toStatus === 'needs_input',
      needs_human: input.toStatus === 'needs_human_decision',
      active_lease_id: input.activeLeaseId,
      active_run_id: input.activeRunId,
      last_transition_at: new Date(),
      last_transition_trigger: input.lastTransitionTrigger,
      stuck_for_seconds: 0,
      high_risk: input.highRisk,
    })
    .onConflict((conflict) =>
      conflict.column('issue_id').doUpdateSet({
        current_status_code: input.toStatus,
        current_owner_role: input.ownerRole,
        is_blocked: input.toStatus === 'blocked',
        is_waiting_for_input: input.toStatus === 'needs_input',
        needs_human: input.toStatus === 'needs_human_decision',
        active_lease_id: input.activeLeaseId,
        active_run_id: input.activeRunId,
        last_transition_at: new Date(),
        last_transition_trigger: input.lastTransitionTrigger,
        stuck_for_seconds: 0,
        high_risk: input.highRisk,
      }),
    )
    .execute()

  if (input.toStatus === 'blocked') {
    await db
      .insertInto('blocked_issues_projection')
      .values({
        issue_id: input.issueId,
        blocked_by_issue_ids: toJsonb(input.blockedByIssueIds),
        blocked_by_external: input.blockedByIssueIds.length === 0,
        block_reason_code: input.blockReasonCode,
        since: new Date(),
      })
      .onConflict((conflict) =>
        conflict.column('issue_id').doUpdateSet({
          blocked_by_issue_ids: toJsonb(input.blockedByIssueIds),
          blocked_by_external: input.blockedByIssueIds.length === 0,
          block_reason_code: input.blockReasonCode,
          since: new Date(),
        }),
      )
      .execute()
  } else {
    await db
      .deleteFrom('blocked_issues_projection')
      .where('issue_id', '=', input.issueId)
      .execute()
  }
}
