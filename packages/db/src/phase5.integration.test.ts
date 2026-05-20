import assert from 'node:assert/strict'
import test from 'node:test'

import type { LifecycleCommandEnvelopeV1 } from '@ai-dev-team/shared'
import type { JsonObject } from './schema.js'

import {
  getLifecycleSnapshotView,
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
} from './index.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const operatorQuestionId = '11111111-1111-4111-8111-111111111111'

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

function buildLifecycleCommandEnvelope(input: {
  commandKey: string
  issueId: string
  occurredAt: string
}): LifecycleCommandEnvelopeV1 {
  return {
    schemaVersion: 1,
    commandKey: input.commandKey,
    issueId: input.issueId,
    workflowId: `issue:${input.issueId}`,
    signalName: 'ingestSystemCommand',
    source: 'test',
    sourceRef: input.commandKey,
    occurredAt: input.occurredAt,
    actorType: 'human',
    actorId: 'test-user',
    triggerCode: 'human_input_received',
    metadata: {},
  }
}

test('phase5 db integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'getLifecycleSnapshotView returns persisted lifecycle truth for human gates and timer intents',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()
    const issueId = 'ISSUE-PHASE5-SNAPSHOT'

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'db-phase5-test',
      })

      await db
        .insertInto('artifact_registry')
        .values({
          id: operatorQuestionId,
          issue_id: issueId,
          run_id: null,
          transition_audit_id: null,
          artifact_type: 'operator_question',
          artifact_scope: 'operator_question',
          artifact_uri: `artifact://operator-question/${issueId}`,
          artifact_summary: 'Need founder input on scope',
          produced_by_role: 'spec_agent',
          produced_for_status_code: 'needs_input',
          produced_at: new Date('2026-03-26T08:10:00.000Z'),
          metadata: toJsonInsert({
            question: 'Do we keep the legacy webhook contract?',
          }),
        })
        .execute()

      await db
        .insertInto('issue_runtime_state')
        .values({
          issue_id: issueId,
          workflow_id: `issue:${issueId}`,
          current_status_code: 'needs_human_decision',
          current_stage: 'needs_human_decision',
          active_run_id: null,
          pinned_config_version: 1,
          open_operator_question_id: operatorQuestionId,
          pause_reason_code: 'founder_input_required',
          pause_reason_text: 'Need product clarification',
          resume_condition: toJsonInsert({
            triggerCode: 'human_decision_given',
            fromStatus: 'needs_human_decision',
            activeTimerIntents: [
              {
                timerKey: `gate-timeout:${issueId}`,
                dueAt: '2026-03-26T08:15:00.000Z',
                reason: 'human_gate_timeout',
              },
              {
                timerKey: `gate-reminder:${issueId}`,
                dueAt: '2026-03-26T08:20:00.000Z',
                reason: 'human_gate_reminder',
              },
            ],
          }),
          suspended_from_status_code: null,
          block_reason_code: null,
          block_reason_text: null,
          blocked_by_issue_ids: toJsonInsert([]),
          active_lease_id: null,
        })
        .execute()

      await db
        .insertInto('lifecycle_command_inbox')
        .values([
          {
            command_key: 'cmd-1',
            issue_id: issueId,
            workflow_id: `issue:${issueId}`,
            signal_name: 'ingestSystemCommand',
            source: 'test',
            source_ref: 'cmd-1',
            payload: toJsonInsert(
              buildLifecycleCommandEnvelope({
                commandKey: 'cmd-1',
                issueId,
                occurredAt: '2026-03-26T08:00:00.000Z',
              }) as unknown as JsonObject,
            ),
            status: 'accepted',
            accepted_at: new Date('2026-03-26T08:00:01.000Z'),
            processed_at: new Date('2026-03-26T08:00:01.000Z'),
          },
          {
            command_key: 'cmd-2',
            issue_id: issueId,
            workflow_id: `issue:${issueId}`,
            signal_name: 'ingestSystemCommand',
            source: 'test',
            source_ref: 'cmd-2',
            payload: toJsonInsert(
              buildLifecycleCommandEnvelope({
                commandKey: 'cmd-2',
                issueId,
                occurredAt: '2026-03-26T08:05:00.000Z',
              }) as unknown as JsonObject,
            ),
            status: 'accepted',
            accepted_at: new Date('2026-03-26T08:05:01.000Z'),
            processed_at: new Date('2026-03-26T08:05:01.000Z'),
          },
        ])
        .execute()

      const snapshot = await getLifecycleSnapshotView(db, issueId)

      assert.ok(snapshot)
      assert.equal(snapshot.issueId, issueId)
      assert.equal(snapshot.workflowId, `issue:${issueId}`)
      assert.equal(snapshot.lastProcessedCommandKey, 'cmd-2')
      assert.deepEqual(snapshot.recentCommandKeys, ['cmd-1', 'cmd-2'])
      assert.deepEqual(snapshot.activeTimerIntents, [
        {
          timerKey: `gate-timeout:${issueId}`,
          dueAt: '2026-03-26T08:15:00.000Z',
          reason: 'human_gate_timeout',
        },
        {
          timerKey: `gate-reminder:${issueId}`,
          dueAt: '2026-03-26T08:20:00.000Z',
          reason: 'human_gate_reminder',
        },
      ])
      assert.equal(snapshot.terminal, false)
      assert.ok(snapshot.openHumanGate)
      assert.equal(snapshot.openHumanGate?.statusCode, 'needs_human_decision')
      assert.equal(
        snapshot.openHumanGate?.questionArtifactId,
        operatorQuestionId,
      )
      assert.equal(
        snapshot.openHumanGate?.reasonCode,
        'founder_input_required',
      )
      assert.equal(
        snapshot.openHumanGate?.reasonText,
        'Need product clarification',
      )
      assert.equal(
        snapshot.openHumanGate?.openedAt,
        '2026-03-26T08:10:00.000Z',
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'issue_runtime_state pause fields are rejected outside human-gate statuses',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'db-phase5-test',
      })

      await assert.rejects(
        db
          .insertInto('issue_runtime_state')
          .values({
            issue_id: 'ISSUE-BAD-GATE',
            workflow_id: 'issue:ISSUE-BAD-GATE',
            current_status_code: 'triage',
            current_stage: 'triage',
            active_run_id: null,
            pinned_config_version: 1,
            open_operator_question_id: null,
            pause_reason_code: 'should_fail',
            pause_reason_text: 'should fail',
            resume_condition: toJsonInsert({
              triggerCode: 'human_input_received',
              fromStatus: 'needs_input',
            }),
            suspended_from_status_code: null,
            block_reason_code: null,
            block_reason_text: null,
            blocked_by_issue_ids: toJsonInsert([]),
            active_lease_id: null,
          })
          .execute(),
      )

      const rowCount = await db
        .selectFrom('issue_runtime_state')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-BAD-GATE')
        .executeTakeFirstOrThrow()

      assert.equal(Number(rowCount.count), 0)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'lifecycle_command_inbox accepts the widened phase5 signal contract',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'db-phase5-test',
      })

      await db
        .insertInto('lifecycle_command_inbox')
        .values([
          {
            command_key: 'signal-check-timer-fired',
            issue_id: 'ISSUE-SIGNAL-CHECK',
            workflow_id: 'issue:ISSUE-SIGNAL-CHECK',
            signal_name: 'ingestTimerFired',
            source: 'system_timer',
            source_ref: 'signal-check-timer-fired',
            payload: toJsonInsert({
              schemaVersion: 1,
              commandKey: 'signal-check-timer-fired',
              issueId: 'ISSUE-SIGNAL-CHECK',
              workflowId: 'issue:ISSUE-SIGNAL-CHECK',
              signalName: 'ingestTimerFired',
              source: 'system_timer',
              sourceRef: 'signal-check-timer-fired',
              occurredAt: '2026-03-26T08:15:00.000Z',
              actorType: 'system',
              actorId: 'test-timer',
              metadata: {},
            } as JsonObject),
          },
          {
            command_key: 'signal-check-cancel-gate',
            issue_id: 'ISSUE-SIGNAL-CHECK',
            workflow_id: 'issue:ISSUE-SIGNAL-CHECK',
            signal_name: 'cancelOpenHumanGate',
            source: 'operator_api',
            source_ref: 'signal-check-cancel-gate',
            payload: toJsonInsert({
              schemaVersion: 1,
              commandKey: 'signal-check-cancel-gate',
              issueId: 'ISSUE-SIGNAL-CHECK',
              workflowId: 'issue:ISSUE-SIGNAL-CHECK',
              signalName: 'cancelOpenHumanGate',
              source: 'operator_api',
              sourceRef: 'signal-check-cancel-gate',
              occurredAt: '2026-03-26T08:16:00.000Z',
              actorType: 'human',
              actorId: 'test-user',
              metadata: {},
            } as JsonObject),
          },
        ])
        .execute()

      const rows = await db
        .selectFrom('lifecycle_command_inbox')
        .select(['command_key', 'signal_name'])
        .where('issue_id', '=', 'ISSUE-SIGNAL-CHECK')
        .orderBy('command_key', 'asc')
        .execute()

      assert.deepEqual(rows, [
        {
          command_key: 'signal-check-cancel-gate',
          signal_name: 'cancelOpenHumanGate',
        },
        {
          command_key: 'signal-check-timer-fired',
          signal_name: 'ingestTimerFired',
        },
      ])
    } finally {
      await db.destroy()
    }
  },
)
