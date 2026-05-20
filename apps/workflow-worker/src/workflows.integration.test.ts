import assert from 'node:assert/strict'
import test from 'node:test'

import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import {
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
  type DbClient,
} from '@ai-dev-team/db'
import type { Client } from '@temporalio/client'

import {
  applyTransition,
  bootstrapIssueRuntimeState,
} from './application/workflow/apply-transition.js'
import {
  cancelOpenHumanGateSignal,
  CommentResponseWorkflow,
  IssueLifecycleWorkflow,
  getLifecycleSnapshotQuery,
  ingestCanonicalEventSignal,
  ingestSystemCommandSignal,
} from './workflows/index.js'
import {
  buildLifecycleCommand,
  createTemporalTestEnvironment,
  createTemporalTestWorker,
  type TemporalTestWorkerHandle,
  shutdownTemporalTestWorker,
  waitForCondition,
} from './testing/temporal.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)

function buildWorkflowConfig() {
  return loadWorkflowWorkerConfig(process.env)
}

async function seedNeedsInputState(
  db: DbClient,
  input: { issueId: string; workflowId: string },
): Promise<string> {
  const bundle = await loadWorkflowManifestBundle()
  await publishWorkflowConfig(db, bundle, { publishedBy: 'workflow-test' })

  await bootstrapIssueRuntimeState(db, {
    issueId: input.issueId,
    workflowId: input.workflowId,
    actorId: 'system/bootstrap',
    rawIssueArtifactUri: `linear://${input.issueId}`,
    metadata: {
      highRisk: false,
    },
  })

  await applyTransition(db, {
    issueId: input.issueId,
    triggerCode: 'system_input_required',
    actorType: 'system',
    actorId: 'spec-agent',
    guardOutcomes: {
      critical_intake_fields_missing: true,
      structured_question_prepared: true,
    },
    artifacts: [
      {
        artifactType: 'operator_question',
        artifactScope: 'operator_question',
        artifactUri: `artifact://operator-question/${input.issueId}`,
        artifactSummary: 'Operator question',
        producedByRole: 'spec_agent',
      },
    ],
  })

  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .selectAll()
    .where('issue_id', '=', input.issueId)
    .executeTakeFirstOrThrow()

  assert.ok(runtimeState.open_operator_question_id)

  return runtimeState.open_operator_question_id as string
}

async function seedPlannedState(
  db: DbClient,
  input: { issueId: string; workflowId: string },
): Promise<void> {
  const bundle = await loadWorkflowManifestBundle()
  await publishWorkflowConfig(db, bundle, { publishedBy: 'workflow-test' })

  await bootstrapIssueRuntimeState(db, {
    issueId: input.issueId,
    workflowId: input.workflowId,
    actorId: 'system/bootstrap',
    rawIssueArtifactUri: `linear://${input.issueId}`,
    metadata: {
      highRisk: false,
    },
  })

  await applyTransition(db, {
    issueId: input.issueId,
    triggerCode: 'system_intake_complete',
    actorType: 'system',
    actorId: 'intake-agent',
    guardOutcomes: {
      brief_valid: true,
      contract_incomplete: true,
    },
    artifacts: [
      {
        artifactType: 'intake_summary',
        artifactScope: 'issue',
        artifactUri: `artifact://intake-summary/${input.issueId}`,
      },
    ],
  })

  await applyTransition(db, {
    issueId: input.issueId,
    triggerCode: 'system_contract_built',
    actorType: 'system',
    actorId: 'spec-agent',
    guardOutcomes: {
      contract_complete: true,
      open_questions_resolved: true,
    },
    artifacts: [
      {
        artifactType: 'issue_contract_snapshot',
        artifactScope: 'issue',
        artifactUri: `artifact://issue-contract/${input.issueId}`,
      },
    ],
  })
}

test('shutdownTemporalTestWorker is idempotent for repeated teardown calls', async () => {
  let shutdownCalls = 0
  let resolveRunPromise: (() => void) | null = null

  const handle = {
    worker: {
      shutdown: async (): Promise<void> => {
        shutdownCalls += 1
        resolveRunPromise?.()
      },
    } as unknown as TemporalTestWorkerHandle['worker'],
    runPromise: new Promise<void>((resolve) => {
      resolveRunPromise = resolve
    }),
  } as TemporalTestWorkerHandle

  await Promise.all([
    shutdownTemporalTestWorker(handle),
    shutdownTemporalTestWorker(handle),
  ])
  await shutdownTemporalTestWorker(handle)

  assert.equal(shutdownCalls, 1)
})

test(
  'IssueLifecycleWorkflow suppresses duplicate commands and carries state across continue-as-new',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const worker = await createTemporalTestWorker(env, workflowConfig)
    const workflowId = 'issue:ISSUE-WORKFLOW-1'

    try {
      await seedNeedsInputState(db, {
        issueId: 'ISSUE-WORKFLOW-1',
        workflowId,
      })

      const client = env.client as Client
      const handle = client.workflow.getHandle(workflowId)

      await client.workflow.start(IssueLifecycleWorkflow, {
        workflowId,
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [],
      })

      const initialDescribe = await handle.describe()

      const command = buildLifecycleCommand({
        commandKey: 'issue-workflow-human-input',
        issueId: 'ISSUE-WORKFLOW-1',
        workflowId,
        triggerCode: 'human_input_received',
        requestedStatusCode: 'needs_spec',
        actorType: 'human',
        actorId: 'human-test',
        commentId: 'comment-1',
        source: 'linear_webhook',
        sourceRef: 'comment-1',
        signalName: 'ingestCanonicalEvent',
        metadata: {
          contextPackFingerprint: 'fingerprint-1',
        },
      })

      await handle.signal(ingestSystemCommandSignal, command)

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)

        return (
          snapshot.lastProcessedCommandKey ===
            `${command.commandKey}:comment-response` &&
          snapshot.openHumanGate === null
        )
      })

      const transitionCountAfterFirstSignal = await db
        .selectFrom('status_transition_audit')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-WORKFLOW-1')
        .executeTakeFirstOrThrow()

      for (let index = 0; index < 50; index += 1) {
        await handle.signal(ingestCanonicalEventSignal, command)
      }

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)
        const describe = await handle.describe()

        return (
          snapshot.lastProcessedCommandKey === command.commandKey &&
          snapshot.recentCommandKeys.length === 2 &&
          describe.runId !== initialDescribe.runId
        )
      })

      const transitionCountAfterDuplicates = await db
        .selectFrom('status_transition_audit')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-WORKFLOW-1')
        .executeTakeFirstOrThrow()

      assert.equal(transitionCountAfterFirstSignal.count, transitionCountAfterDuplicates.count)

      const snapshot = await handle.query(getLifecycleSnapshotQuery)

      assert.equal(snapshot.lastProcessedCommandKey, command.commandKey)
      assert.deepEqual(snapshot.recentCommandKeys, [
        command.commandKey,
        `${command.commandKey}:comment-response`,
      ])
      assert.equal(snapshot.issueId, 'ISSUE-WORKFLOW-1')
    } finally {
      await shutdownTemporalTestWorker(worker)
      await env.teardown()
      await db.destroy()
    }
  },
)

test(
  'CommentResponseWorkflow hands human input back to the issue workflow',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const issueWorker = await createTemporalTestWorker(env, workflowConfig)
    const workflowId = 'issue:ISSUE-COMMENT-1'

    try {
      await seedNeedsInputState(db, {
        issueId: 'ISSUE-COMMENT-1',
        workflowId,
      })

      const client = env.client as Client
      const issueHandle = client.workflow.getHandle(workflowId)

      await client.workflow.start(IssueLifecycleWorkflow, {
        workflowId,
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [],
      })

      const command = buildLifecycleCommand({
        commandKey: 'comment-response-human-input',
        issueId: 'ISSUE-COMMENT-1',
        workflowId,
        triggerCode: 'human_input_received',
        requestedStatusCode: 'needs_spec',
        actorType: 'human',
        actorId: 'human-test',
        commentId: 'comment-2',
        source: 'linear_webhook',
        sourceRef: 'comment-2',
        signalName: 'ingestCanonicalEvent',
        metadata: {
          contextPackFingerprint: 'fingerprint-2',
        },
      })

      const commentHandle = await client.workflow.start(CommentResponseWorkflow, {
        workflowId: 'comment-response:comment-2',
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [{ command }],
      })

      await commentHandle.result()

      await waitForCondition(async () => {
        const snapshot = await issueHandle.query(getLifecycleSnapshotQuery)

        return snapshot.lastProcessedCommandKey === `${command.commandKey}:comment-response`
      })

      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code', 'open_operator_question_id'])
        .where('issue_id', '=', 'ISSUE-COMMENT-1')
        .executeTakeFirstOrThrow()

      const openQuestionArtifact = await db
        .selectFrom('artifact_registry')
        .select('superseded_at')
        .where('issue_id', '=', 'ISSUE-COMMENT-1')
        .where('artifact_type', '=', 'operator_question')
        .where('superseded_at', 'is not', null)
        .executeTakeFirst()
      const contractDraftArtifact = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type', 'artifact_uri'])
        .where('issue_id', '=', 'ISSUE-COMMENT-1')
        .where('artifact_type', '=', 'updated_issue_contract_draft')
        .orderBy('produced_at', 'desc')
        .executeTakeFirst()

      assert.equal(runtimeState.current_status_code, 'needs_spec')
      assert.equal(runtimeState.open_operator_question_id, null)
      assert.ok(openQuestionArtifact?.superseded_at)
      assert.equal(contractDraftArtifact?.artifact_type, 'updated_issue_contract_draft')
      assert.equal(
        contractDraftArtifact?.artifact_uri,
        'linear-comment://comment-2',
      )
    } finally {
      await shutdownTemporalTestWorker(issueWorker)
      await env.teardown()
      await db.destroy()
    }
  },
)

test(
  'CommentResponseWorkflow resolves planning-ready human input directly to planned',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const issueWorker = await createTemporalTestWorker(env, workflowConfig)
    const workflowId = 'issue:ISSUE-COMMENT-PLANNED-1'

    try {
      await seedNeedsInputState(db, {
        issueId: 'ISSUE-COMMENT-PLANNED-1',
        workflowId,
      })

      const client = env.client as Client
      const issueHandle = await client.workflow.start(IssueLifecycleWorkflow, {
        workflowId,
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [],
      })

      const command = buildLifecycleCommand({
        commandKey: 'comment-response-planned',
        issueId: 'ISSUE-COMMENT-PLANNED-1',
        workflowId,
        triggerCode: 'human_input_received',
        actorType: 'human',
        actorId: 'human-test',
        commentId: 'comment-planned-1',
        source: 'linear_webhook',
        sourceRef: 'comment-planned-1',
        signalName: 'ingestCanonicalEvent',
        guardOutcomes: {
          contract_complete_enough_for_planning: true,
        },
        metadata: {
          contextPackFingerprint: 'fingerprint-planned-1',
        },
      })

      await issueHandle.signal(ingestCanonicalEventSignal, command)

      await waitForCondition(async () => {
        const snapshot = await issueHandle.query(getLifecycleSnapshotQuery)

        return (
          snapshot.lastProcessedCommandKey ===
            `${command.commandKey}:comment-response` &&
          snapshot.openHumanGate === null
        )
      })

      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code', 'open_operator_question_id'])
        .where('issue_id', '=', 'ISSUE-COMMENT-PLANNED-1')
        .executeTakeFirstOrThrow()
      const contractSnapshotArtifact = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type', 'artifact_uri'])
        .where('issue_id', '=', 'ISSUE-COMMENT-PLANNED-1')
        .where('artifact_type', '=', 'updated_issue_contract_snapshot')
        .orderBy('produced_at', 'desc')
        .executeTakeFirst()

      assert.equal(runtimeState.current_status_code, 'planned')
      assert.equal(runtimeState.open_operator_question_id, null)
      assert.equal(
        contractSnapshotArtifact?.artifact_type,
        'updated_issue_contract_snapshot',
      )
      assert.equal(
        contractSnapshotArtifact?.artifact_uri,
        'linear-comment://comment-planned-1',
      )
    } finally {
      await shutdownTemporalTestWorker(issueWorker)
      await env.teardown()
      await db.destroy()
    }
  },
)

test(
  'CommentResponseWorkflow no-ops for already-closed human gates and preserves non-default configVersion',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const issueWorker = await createTemporalTestWorker(env, workflowConfig)
    const workflowId = 'issue:ISSUE-COMMENT-CLOSED-1'

    try {
      await seedPlannedState(db, {
        issueId: 'ISSUE-COMMENT-CLOSED-1',
        workflowId,
      })

      await db
        .insertInto('workflow_config_sets')
        .values({
          config_version: 7,
          status: 'published',
          is_active_for_new_runs: false,
          published_by: 'workflow-test',
          published_at: new Date('2026-03-26T12:00:00.000Z'),
          notes: 'regression-test fixture',
        })
        .execute()
      await db
        .insertInto('workflow_status_catalog')
        .values({
          code: 'planned',
          label: 'Planned',
          group_code: 'delivery',
          kind: 'active',
          is_terminal: false,
          manual_entry_allowed: true,
          manual_exit_allowed: true,
          requires_human: false,
          blocks_execution: false,
          sort_order: 40,
          description: 'Regression fixture status for config version 7',
          config_version: 7,
        })
        .execute()

      await db
        .updateTable('issue_runtime_state')
        .set({ pinned_config_version: 7 })
        .where('issue_id', '=', 'ISSUE-COMMENT-CLOSED-1')
        .execute()

      const transitionCountBefore = await db
        .selectFrom('status_transition_audit')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-COMMENT-CLOSED-1')
        .executeTakeFirstOrThrow()

      const client = env.client as Client
      const command = buildLifecycleCommand({
        commandKey: 'comment-response-closed-gate',
        issueId: 'ISSUE-COMMENT-CLOSED-1',
        workflowId,
        triggerCode: 'human_input_received',
        actorType: 'human',
        actorId: 'human-test',
        commentId: 'comment-closed-1',
        source: 'linear_webhook',
        sourceRef: 'comment-closed-1',
        signalName: 'ingestCanonicalEvent',
      })

      const commentHandle = await client.workflow.start(CommentResponseWorkflow, {
        workflowId: 'comment-response:comment-closed-1',
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [{ command }],
      })

      await commentHandle.result()

      const transitionCountAfter = await db
        .selectFrom('status_transition_audit')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-COMMENT-CLOSED-1')
        .executeTakeFirstOrThrow()
      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code', 'pinned_config_version'])
        .where('issue_id', '=', 'ISSUE-COMMENT-CLOSED-1')
        .executeTakeFirstOrThrow()
      const executionMetadata = await db
        .selectFrom('artifact_registry')
        .select(['metadata', 'produced_for_status_code'])
        .where('issue_id', '=', 'ISSUE-COMMENT-CLOSED-1')
        .where('artifact_type', '=', 'agent_execution_metadata')
        .orderBy('produced_at', 'desc')
        .executeTakeFirstOrThrow()

      assert.equal(transitionCountAfter.count, transitionCountBefore.count)
      assert.equal(runtimeState.current_status_code, 'planned')
      assert.equal(runtimeState.pinned_config_version, 7)
      assert.equal(executionMetadata.produced_for_status_code, null)
      assert.equal(
        (executionMetadata.metadata as { completionReason?: string }).completionReason,
        'issue_not_waiting_for_input',
      )
      assert.equal(
        (executionMetadata.metadata as { configVersion?: number }).configVersion,
        7,
      )
    } finally {
      await shutdownTemporalTestWorker(issueWorker)
      await env.teardown()
      await db.destroy()
    }
  },
)

test(
  'IssueLifecycleWorkflow tracks and cancels explicit human-gate timers without mutating business status',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const worker = await createTemporalTestWorker(env, workflowConfig)
    const workflowId = 'issue:ISSUE-GATE-TIMER-1'

    try {
      await seedPlannedState(db, {
        issueId: 'ISSUE-GATE-TIMER-1',
        workflowId,
      })

      const client = env.client as Client
      const handle = await client.workflow.start(IssueLifecycleWorkflow, {
        workflowId,
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [],
      })

      const dueAt = new Date(Date.now() + 60_000).toISOString()
      const humanGateCommand = buildLifecycleCommand({
        commandKey: 'manual-human-gate-timer-1',
        issueId: 'ISSUE-GATE-TIMER-1',
        workflowId,
        triggerCode: 'human_status_change',
        requestedStatusCode: 'needs_human_decision',
        actorType: 'human',
        actorId: 'human-test',
        signalName: 'ingestSystemCommand',
        source: 'operator_api',
        sourceRef: 'manual-human-gate-timer-1',
        reasonCode: 'human_review_requested',
        reasonText: 'Need explicit approval before merge',
        guardOutcomes: {
          manual_override_allowed: true,
          reason_comment_present: true,
        },
        artifacts: [
          {
            artifactType: 'decision_memo',
            artifactScope: 'issue',
            artifactUri: 'artifact://decision-memo/ISSUE-GATE-TIMER-1',
          },
        ],
        metadata: {
          timerIntent: {
            timerKey: 'approval-reminder',
            dueAt,
            reason: 'human_gate_reminder',
          },
        },
      })

      await handle.signal(ingestSystemCommandSignal, humanGateCommand)

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)

        return (
          snapshot.lastProcessedCommandKey === humanGateCommand.commandKey &&
          snapshot.activeTimerIntents.length === 1
        )
      })

      const cancelCommand = buildLifecycleCommand({
        commandKey: 'manual-human-gate-cancel-1',
        issueId: 'ISSUE-GATE-TIMER-1',
        workflowId,
        signalName: 'cancelOpenHumanGate',
        source: 'operator_api',
        sourceRef: 'manual-human-gate-cancel-1',
        actorType: 'human',
        actorId: 'human-test',
      })

      await handle.signal(cancelOpenHumanGateSignal, cancelCommand)

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)

        return (
          snapshot.lastProcessedCommandKey === cancelCommand.commandKey &&
          snapshot.activeTimerIntents.length === 0
        )
      })

      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code'])
        .where('issue_id', '=', 'ISSUE-GATE-TIMER-1')
        .executeTakeFirstOrThrow()
      const snapshot = await handle.query(getLifecycleSnapshotQuery)

      assert.equal(runtimeState.current_status_code, 'needs_human_decision')
      assert.equal(snapshot.openHumanGate?.statusCode, 'needs_human_decision')
      assert.deepEqual(snapshot.activeTimerIntents, [])
    } finally {
      await shutdownTemporalTestWorker(worker)
      await env.teardown()
      await db.destroy()
    }
  },
)

test(
  'IssueLifecycleWorkflow preserves the active run after worker restart',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const workflowId = 'issue:ISSUE-RESTART-1'
    let worker: TemporalTestWorkerHandle | null = null

    try {
      await seedNeedsInputState(db, {
        issueId: 'ISSUE-RESTART-1',
        workflowId,
      })

      worker = await createTemporalTestWorker(env, workflowConfig)
      const client = env.client as Client
      const handle = client.workflow.getHandle(workflowId)

      await client.workflow.start(IssueLifecycleWorkflow, {
        workflowId,
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [],
      })

      const initialDescribe = await handle.describe()

      const command = buildLifecycleCommand({
        commandKey: 'restart-duplication-test',
        issueId: 'ISSUE-RESTART-1',
        workflowId,
        triggerCode: 'human_input_received',
        requestedStatusCode: 'needs_spec',
        actorType: 'human',
        actorId: 'human-test',
        commentId: 'comment-3',
        source: 'linear_webhook',
        sourceRef: 'comment-3',
        signalName: 'ingestCanonicalEvent',
        metadata: {
          contextPackFingerprint: 'fingerprint-3',
        },
      })

      await handle.signal(ingestCanonicalEventSignal, command)

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)

        return (
          snapshot.lastProcessedCommandKey ===
          `${command.commandKey}:comment-response`
        )
      })

      await shutdownTemporalTestWorker(worker)

      worker = await createTemporalTestWorker(env, workflowConfig)

      const describeAfterRestart = await handle.describe()

      const duplicateCount = await db
        .selectFrom('status_transition_audit')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-RESTART-1')
        .executeTakeFirstOrThrow()

      assert.equal(describeAfterRestart.runId, initialDescribe.runId)
      assert.equal(Number(duplicateCount.count), 3)
    } finally {
      // The worker may already be shut down in the restart test.
      if (worker) {
        await shutdownTemporalTestWorker(worker).catch(() => undefined)
      }
      await env.teardown()
      await db.destroy()
    }
  },
)

test(
  'IssueLifecycleWorkflow applies manual human override from planned to needs_human_decision',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const workflowId = 'issue:ISSUE-MANUAL-1'
    const worker = await createTemporalTestWorker(env, workflowConfig)

    try {
      await seedPlannedState(db, {
        issueId: 'ISSUE-MANUAL-1',
        workflowId,
      })

      const client = env.client as Client
      const handle = await client.workflow.start(IssueLifecycleWorkflow, {
        workflowId,
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [],
      })

      const command = buildLifecycleCommand({
        commandKey: 'manual-override-1',
        issueId: 'ISSUE-MANUAL-1',
        workflowId,
        triggerCode: 'human_status_change',
        requestedStatusCode: 'needs_human_decision',
        actorType: 'human',
        actorId: 'human-test',
        signalName: 'ingestSystemCommand',
        source: 'operator_api',
        sourceRef: 'manual-override-1',
        guardOutcomes: {
          manual_override_allowed: true,
          reason_comment_present: true,
        },
        artifacts: [
          {
            artifactType: 'decision_memo',
            artifactScope: 'issue',
            artifactUri: 'artifact://decision-memo/ISSUE-MANUAL-1',
          },
        ],
      })

      await handle.signal(ingestCanonicalEventSignal, command)

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)

        return snapshot.lastProcessedCommandKey === command.commandKey
      })

      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code'])
        .where('issue_id', '=', 'ISSUE-MANUAL-1')
        .executeTakeFirstOrThrow()
      const snapshot = await handle.query(getLifecycleSnapshotQuery)

      assert.equal(runtimeState.current_status_code, 'needs_human_decision')
      assert.equal(snapshot.openHumanGate?.statusCode, 'needs_human_decision')
      assert.equal(snapshot.openHumanGate?.questionArtifactId, null)
    } finally {
      await shutdownTemporalTestWorker(worker)
      await env.teardown()
      await db.destroy()
    }
  },
)

test(
  'IssueLifecycleWorkflow handles system block detect and clear transitions',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const env = await createTemporalTestEnvironment()
    const workflowConfig = buildWorkflowConfig()
    const workflowId = 'issue:ISSUE-BLOCK-1'
    const worker = await createTemporalTestWorker(env, workflowConfig)

    try {
      await seedPlannedState(db, {
        issueId: 'ISSUE-BLOCK-1',
        workflowId,
      })

      const client = env.client as Client
      const handle = await client.workflow.start(IssueLifecycleWorkflow, {
        workflowId,
        taskQueue: workflowConfig.temporal.taskQueue,
        args: [],
      })

      const blockCommand = buildLifecycleCommand({
        commandKey: 'system-block-1',
        issueId: 'ISSUE-BLOCK-1',
        workflowId,
        triggerCode: 'system_block_detected',
        actorType: 'system',
        actorId: 'orchestrator',
        signalName: 'ingestSystemCommand',
        source: 'orchestrator',
        sourceRef: 'system-block-1',
        reasonCode: 'block_external_dependency',
        reasonText: 'Waiting for upstream system',
        blockedByIssueIds: ['ISSUE-UPSTREAM-1'],
        guardOutcomes: {
          block_reason_present: true,
        },
        artifacts: [
          {
            artifactType: 'block_record',
            artifactScope: 'issue',
            artifactUri: 'artifact://block-record/ISSUE-BLOCK-1',
          },
        ],
      })

      await handle.signal(ingestSystemCommandSignal, blockCommand)

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)

        return snapshot.lastProcessedCommandKey === blockCommand.commandKey
      })

      const clearCommand = buildLifecycleCommand({
        commandKey: 'system-unblock-1',
        issueId: 'ISSUE-BLOCK-1',
        workflowId,
        triggerCode: 'system_block_cleared',
        requestedStatusCode: 'ready_for_build',
        actorType: 'system',
        actorId: 'orchestrator',
        signalName: 'ingestSystemCommand',
        source: 'orchestrator',
        sourceRef: 'system-unblock-1',
        reasonCode: 'blocker_cleared',
        reasonText: 'Dependency resolved',
        guardOutcomes: {
          no_checkpoint_resume_required: true,
          blocker_cleared: true,
        },
        artifacts: [
          {
            artifactType: 'unblock_record',
            artifactScope: 'issue',
            artifactUri: 'artifact://unblock-record/ISSUE-BLOCK-1',
          },
        ],
      })

      await handle.signal(ingestSystemCommandSignal, clearCommand)

      await waitForCondition(async () => {
        const snapshot = await handle.query(getLifecycleSnapshotQuery)

        return snapshot.lastProcessedCommandKey === clearCommand.commandKey
      })

      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code', 'block_reason_code'])
        .where('issue_id', '=', 'ISSUE-BLOCK-1')
        .executeTakeFirstOrThrow()

      assert.equal(runtimeState.current_status_code, 'ready_for_build')
      assert.equal(runtimeState.block_reason_code, null)
    } finally {
      await shutdownTemporalTestWorker(worker)
      await env.teardown()
      await db.destroy()
    }
  },
)
