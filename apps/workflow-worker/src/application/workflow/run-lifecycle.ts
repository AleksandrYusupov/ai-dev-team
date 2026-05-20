import type { DbSession, JsonObject } from '@ai-dev-team/db'

import type { RunKind } from '@ai-dev-team/shared'

import type { RunLifecycleResult } from './types.js'

interface RunLifecycleInput {
  issueId: string
  workflowId: string
  effectOnRun: string
  openedRunKind: RunKind | null
  configVersion: number
  existingRunId: string | null
  transitionAuditId: string
}

async function loadLatestRunnerRequirementProfile(
  db: DbSession,
  issueId: string,
): Promise<JsonObject> {
  const artifact = await db
    .selectFrom('artifact_registry')
    .select('metadata')
    .where('issue_id', '=', issueId)
    .where('artifact_type', '=', 'runner_requirement_profile')
    .where('superseded_at', 'is', null)
    .orderBy('produced_at', 'desc')
    .executeTakeFirst()

  if (!artifact) {
    throw new Error(
      `Missing runner_requirement_profile artifact for run-open transition on ${issueId}`,
    )
  }

  return artifact.metadata
}

export async function applyRunLifecycle(
  db: DbSession,
  input: RunLifecycleInput,
): Promise<RunLifecycleResult> {
  if (input.effectOnRun === 'none') {
    return {
      activeRunId: input.existingRunId,
      openedRunId: null,
      closedRunId: null,
      closedRunStatus: null,
    }
  }

  if (input.effectOnRun === 'open') {
    if (!input.openedRunKind) {
      throw new Error(
        `Transition opening a run requires openedRunKind for ${input.issueId}`,
      )
    }

    const runnerRequirements = await loadLatestRunnerRequirementProfile(
      db,
      input.issueId,
    )
    const currentMaxSequence = await db
      .selectFrom('issue_runs')
      .select((eb) => eb.fn.max<number>('sequence_no').as('max_sequence'))
      .where('issue_id', '=', input.issueId)
      .executeTakeFirst()

    const openedRun = await db
      .insertInto('issue_runs')
      .values({
        issue_id: input.issueId,
        workflow_id: input.workflowId,
        sequence_no: (currentMaxSequence?.max_sequence ?? 0) + 1,
        run_kind: input.openedRunKind,
        status: 'open',
        config_version: input.configVersion,
        opened_by_transition_id: input.transitionAuditId,
        runner_requirements: runnerRequirements,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    return {
      activeRunId: openedRun.id,
      openedRunId: openedRun.id,
      closedRunId: null,
      closedRunStatus: null,
    }
  }

  if (input.effectOnRun === 'continue' || input.effectOnRun === 'resume') {
    return {
      activeRunId: input.existingRunId,
      openedRunId: null,
      closedRunId: null,
      closedRunStatus: null,
    }
  }

  if (!input.existingRunId) {
    throw new Error(`Transition requires an active run for effect ${input.effectOnRun}`)
  }

  const closedRunStatus = input.effectOnRun === 'close_success' ? 'completed' : 'aborted'

  await db
    .updateTable('issue_runs')
    .set({
      status: closedRunStatus,
      closed_by_transition_id: input.transitionAuditId,
      closed_at: new Date(),
    })
    .where('id', '=', input.existingRunId)
    .executeTakeFirst()

  return {
    activeRunId: null,
    openedRunId: null,
    closedRunId: input.existingRunId,
    closedRunStatus,
  }
}
