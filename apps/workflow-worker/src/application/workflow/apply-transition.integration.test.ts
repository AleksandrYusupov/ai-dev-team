import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import {
  prepareTestDatabase,
  loadWorkflowManifestBundle,
  publishWorkflowConfig,
} from '@ai-dev-team/db'

import { runOutboxExecutorOnce } from '../../outbox/executor.js'
import { applyTransition, bootstrapIssueRuntimeState } from './apply-transition.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const linearStateNames = [
  'Triage',
  'Rework',
  'Needs Spec',
  'Needs Input',
  'Planned',
  'Ready for Build',
  'Coding',
  'Agent Review',
  'Blocked',
  'Needs Human Decision',
  'Ready to Merge',
  'Deploying',
  'Monitoring',
  'Done',
  'Canceled',
  'Duplicate',
]

async function withTemporaryEnv<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }

  try {
    return await fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function buildLinearStubBody(payload: unknown): Record<string, unknown> {
  const requestPayload =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const query =
    typeof requestPayload.query === 'string' ? requestPayload.query : ''
  const variables =
    requestPayload.variables &&
    typeof requestPayload.variables === 'object' &&
    !Array.isArray(requestPayload.variables)
      ? (requestPayload.variables as Record<string, unknown>)
      : {}
  const issueId =
    typeof variables.issueId === 'string' && variables.issueId.length > 0
      ? variables.issueId
      : 'ISSUE-STUB-1'

  if (query.includes('query LinearSyncIssueContext')) {
    return {
      data: {
        issue: {
          id: issueId,
          identifier: issueId,
          title: `Stub ${issueId}`,
          state: {
            id: 'state-triage',
            name: 'Triage',
          },
          team: {
            id: 'team-stub',
            name: 'Stub Team',
            states: {
              nodes: linearStateNames.map((name) => ({
                id: `state-${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
                name,
              })),
            },
          },
          project: {
            id: 'project-stub',
            name: 'Stub Project',
          },
          attachments: {
            nodes: [],
          },
        },
      },
    }
  }

  if (query.includes('issueUpdate(')) {
    return { data: { issueUpdate: { success: true } } }
  }

  if (query.includes('attachmentCreate(')) {
    return { data: { attachmentCreate: { success: true } } }
  }

  if (query.includes('projectUpdateCreate(')) {
    return { data: { projectUpdateCreate: { success: true } } }
  }

  if (query.includes('commentCreate(')) {
    return { data: { commentCreate: { success: true } } }
  }

  return { data: {} }
}

async function startLinearStubServer() {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      const payload = rawBody ? JSON.parse(rawBody) : null
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(buildLinearStubBody(payload)))
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind Linear stub server')
  }

  return {
    apiBaseUrl: `http://127.0.0.1:${address.port.toString()}/graphql`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      }),
  }
}

test(
  'workflow transition integration is skipped without DATABASE_URL',
  { skip: hasDatabase },
  () => {
    assert.ok(true)
  },
)

test(
  'bootstrapIssueRuntimeState and applyTransition persist runtime state, audit, projections, and outbox atomically',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const linearStub = await startLinearStubServer()

    try {
      await withTemporaryEnv(
        {
          LINEAR_API_TOKEN: 'linear-sync-test-token',
          LINEAR_API_BASE_URL: linearStub.apiBaseUrl,
        },
        async () => {
          const db = await prepareTestDatabase()

          try {
            const bundle = await loadWorkflowManifestBundle()
            await publishWorkflowConfig(db, bundle, {
              publishedBy: 'worker-test',
            })

      const bootstrap = await bootstrapIssueRuntimeState(db, {
        issueId: 'ISSUE-1',
        workflowId: 'workflow-1',
        actorId: 'system/bootstrap',
        rawIssueArtifactUri: 'linear://ISSUE-1',
        metadata: {
          highRisk: true,
        },
      })

      assert.equal(bootstrap.configVersion, 1)

      await applyTransition(db, {
        issueId: 'ISSUE-1',
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
            artifactUri: 'artifact://intake-summary',
          },
        ],
      })

      await applyTransition(db, {
        issueId: 'ISSUE-1',
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
            artifactUri: 'artifact://issue-contract',
          },
        ],
      })

      const readyForBuildTransition = await applyTransition(db, {
        issueId: 'ISSUE-1',
        triggerCode: 'system_ready_check_passed',
        actorType: 'system',
        actorId: 'plan-agent',
        guardOutcomes: {
          plan_artifact_exists: true,
          dependency_report_clean_or_waived: true,
          context_pack_frozen: true,
          no_unresolved_blockers: true,
          no_unresolved_secret_slots: true,
          integration_prerequisites_satisfied_or_not_required: true,
          prod_access_gate_satisfied_or_not_required: true,
        },
        artifacts: [
          {
            artifactType: 'plan_artifact',
            artifactScope: 'issue',
            artifactUri: 'artifact://plan',
          },
          {
            artifactType: 'dependency_report',
            artifactScope: 'issue',
            artifactUri: 'artifact://dependency-report',
          },
          {
            artifactType: 'readiness_report',
            artifactScope: 'issue',
            artifactUri: 'artifact://readiness-report',
          },
        ],
      })

            assert.equal(readyForBuildTransition.toStatus, 'ready_for_build')
            assert.equal(readyForBuildTransition.outboxCommandCount, 2)

            const readyOutboxBefore = await db
              .selectFrom('workflow_effect_outbox')
              .select(['status', 'command_type'])
              .where('issue_id', '=', 'ISSUE-1')
              .orderBy('created_at', 'asc')
              .execute()

            assert.equal(readyOutboxBefore.length, 4)
            assert.deepEqual(
              readyOutboxBefore.map((row) => row.command_type).sort(),
              [
                'create_runner_lease',
                'sync_linear_state',
                'sync_linear_state',
                'sync_linear_state',
              ],
            )
            assert.deepEqual(
              readyOutboxBefore.map((row) => row.status).sort(),
              ['pending', 'pending', 'pending', 'pending'],
            )

            const readyProcessed = await runOutboxExecutorOnce(
              db,
              loadWorkflowWorkerConfig(process.env),
            )

            assert.equal(readyProcessed, 4)

      const requestedLease = await db
        .selectFrom('runner_leases')
        .select(['lease_id', 'status'])
        .where('issue_id', '=', 'ISSUE-1')
        .orderBy('created_at', 'desc')
        .executeTakeFirstOrThrow()

      assert.equal(requestedLease.status, 'requested')

      const codingTransition = await applyTransition(db, {
        issueId: 'ISSUE-1',
        triggerCode: 'system_build_started',
        actorType: 'system',
        actorId: 'orchestrator',
        leaseId: requestedLease.lease_id,
        guardOutcomes: {
          readiness_report_exists: true,
          queue_slot_reserved: true,
          active_run_opened: true,
          runner_lease_granted: true,
          no_unresolved_blockers: true,
        },
        artifacts: [
          {
            artifactType: 'execution_record',
            artifactScope: 'run',
            artifactUri: 'artifact://execution-record',
          },
        ],
      })

            assert.equal(codingTransition.toStatus, 'coding')
            assert.ok(codingTransition.activeRunId)
            assert.equal(codingTransition.outboxCommandCount, 1)

      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .selectAll()
        .where('issue_id', '=', 'ISSUE-1')
        .executeTakeFirstOrThrow()

      assert.equal(runtimeState.current_status_code, 'coding')
      assert.equal(runtimeState.active_lease_id, requestedLease.lease_id)
      assert.ok(runtimeState.active_run_id)

      const statusProjection = await db
        .selectFrom('status_projection')
        .selectAll()
        .where('issue_id', '=', 'ISSUE-1')
        .executeTakeFirstOrThrow()

      assert.equal(statusProjection.current_status_code, 'coding')
      assert.equal(statusProjection.active_lease_id, requestedLease.lease_id)

            const outboxBefore = await db
              .selectFrom('workflow_effect_outbox')
              .select(['status', 'command_type'])
              .where('issue_id', '=', 'ISSUE-1')
              .orderBy('created_at', 'asc')
              .execute()

            assert.equal(outboxBefore.length, 5)
            assert.deepEqual(
              outboxBefore.map((row) => row.command_type).sort(),
              [
                'create_runner_lease',
                'sync_linear_state',
                'sync_linear_state',
                'sync_linear_state',
                'sync_linear_state',
              ],
            )
            assert.deepEqual(
              outboxBefore.map((row) => row.status),
              ['done', 'done', 'done', 'done', 'pending'],
            )

            const processed = await runOutboxExecutorOnce(
              db,
              loadWorkflowWorkerConfig(process.env),
            )

            assert.equal(processed, 1)

      const outboxAfter = await db
        .selectFrom('workflow_effect_outbox')
        .select(['status'])
        .where('issue_id', '=', 'ISSUE-1')
        .orderBy('created_at', 'asc')
        .execute()

            assert.deepEqual(
              outboxAfter.map((row) => row.status),
              ['done', 'done', 'done', 'done', 'done'],
            )

      const agentReviewTransition = await applyTransition(db, {
        issueId: 'ISSUE-1',
        triggerCode: 'system_build_finished',
        actorType: 'system',
        actorId: 'build-agent',
        leaseId: requestedLease.lease_id,
        guardOutcomes: {
          build_report_present: true,
          changeset_persisted: true,
        },
        artifacts: [
          {
            artifactType: 'build_report',
            artifactScope: 'run',
            artifactUri: 'artifact://build-report',
          },
        ],
      })

            assert.equal(agentReviewTransition.toStatus, 'agent_review')
            assert.equal(agentReviewTransition.outboxCommandCount, 3)

      const handoffOutbox = await db
        .selectFrom('workflow_effect_outbox')
        .select(['command_type', 'command_payload'])
        .where('issue_id', '=', 'ISSUE-1')
        .where('transition_audit_id', '=', agentReviewTransition.transitionAuditId)
        .orderBy('created_at', 'asc')
        .execute()

            assert.deepEqual(
              handoffOutbox
                .map((row) => row.command_type)
                .sort(),
              [
                'create_runner_lease',
                'release_runner_lease',
                'sync_linear_state',
              ],
            )

      const createTestLease = handoffOutbox.find(
        (row) => row.command_type === 'create_runner_lease',
      )
      const releaseBuildLease = handoffOutbox.find(
        (row) => row.command_type === 'release_runner_lease',
      )

            assert.ok(createTestLease)
            assert.ok(releaseBuildLease)

      const createTestLeaseBody = createTestLease.command_payload.body as {
        requestedOwnerRole?: string
        requestedRunKind?: string | null
        runnerRequirementProfile?: {
          requestedStatusCode?: string | null
          requestedOwnerRole?: string
          requestedRunKind?: string | null
        }
      }
      const releaseBuildLeaseBody = releaseBuildLease.command_payload.body as {
        requestedOwnerRole?: string
      }

            assert.equal(createTestLeaseBody.requestedOwnerRole, 'test_agent')
            assert.equal(createTestLeaseBody.requestedRunKind ?? null, 'build')
            assert.equal(
              createTestLeaseBody.runnerRequirementProfile?.requestedOwnerRole,
              'test_agent',
            )
            assert.equal(
              createTestLeaseBody.runnerRequirementProfile?.requestedRunKind ?? null,
              'build',
            )
            assert.equal(
              createTestLeaseBody.runnerRequirementProfile?.requestedStatusCode,
              'agent_review',
            )
            assert.equal(
              releaseBuildLeaseBody.requestedOwnerRole,
              'build_agent_backend',
            )

      const stagedReviewArtifacts = await db
        .selectFrom('artifact_registry')
        .select(['artifact_type', 'produced_by_role', 'produced_for_status_code'])
        .where('transition_audit_id', '=', agentReviewTransition.transitionAuditId)
        .where('artifact_type', 'in', ['review_report', 'verification_result'])
        .orderBy('artifact_type', 'asc')
        .execute()

            assert.deepEqual(stagedReviewArtifacts, [])
          } finally {
            await db.destroy()
          }
        },
      )
    } finally {
      await linearStub.close()
    }
  },
)

test(
  'integration-specific transitions unblock needs_input and promote planned issues after verification',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'worker-test',
      })

      const cases = [
        {
          issueId: 'ISSUE-INTEGRATION-CRED',
          triggerCode: 'credential_validated',
          artifactType: 'credential_validation_report',
        },
        {
          issueId: 'ISSUE-INTEGRATION-OAUTH',
          triggerCode: 'oauth_consent_completed',
          artifactType: 'oauth_consent_session',
        },
        {
          issueId: 'ISSUE-INTEGRATION-WEBHOOK',
          triggerCode: 'webhook_registered',
          artifactType: 'webhook_validation_report',
        },
      ] as const

      for (const testCase of cases) {
        await bootstrapIssueRuntimeState(db, {
          issueId: testCase.issueId,
          workflowId: `issue:${testCase.issueId}`,
          actorId: 'system/bootstrap',
          rawIssueArtifactUri: `linear://${testCase.issueId}`,
          metadata: {
            highRisk: false,
          },
        })

        await applyTransition(db, {
          issueId: testCase.issueId,
          triggerCode: 'system_contract_built',
          actorType: 'system',
          actorId: 'spec-agent',
          guardOutcomes: {
            contract_complete: true,
            primary_repo_resolved: true,
            blockers_inspected: true,
          },
          artifacts: [
            {
              artifactType: 'issue_contract_snapshot',
              artifactScope: 'issue',
              artifactUri: `artifact://${testCase.issueId}/contract`,
            },
          ],
        })

        await applyTransition(db, {
          issueId: testCase.issueId,
          triggerCode: 'system_input_required',
          actorType: 'system',
          actorId: 'integration-agent',
          reasonCode: 'integration_missing_credentials',
          reasonText: 'Integration prerequisites still require operator action.',
          guardOutcomes: {
            structured_question_prepared: true,
            integration_prerequisites_missing: true,
          },
          artifacts: [
            {
              artifactType: 'operator_question',
              artifactScope: 'operator_question',
              artifactUri: `artifact://${testCase.issueId}/operator-question`,
            },
          ],
        })

        const transition = await applyTransition(db, {
          issueId: testCase.issueId,
          triggerCode: testCase.triggerCode,
          actorType: 'system',
          actorId: 'integration-agent',
          guardOutcomes:
            testCase.triggerCode === 'credential_validated'
              ? {
                  credential_slots_validated: true,
                  planned_contract_still_current: true,
                }
              : testCase.triggerCode === 'oauth_consent_completed'
                ? {
                    oauth_consent_session_validated: true,
                    required_scopes_granted: true,
                  }
                : {
                    webhook_registration_verified: true,
                    replay_safe_signature_check_passed: true,
                  },
          artifacts: [
            {
              artifactType: testCase.artifactType,
              artifactScope: 'issue',
              artifactUri: `artifact://${testCase.issueId}/${testCase.artifactType}`,
            },
          ],
        })

        assert.equal(transition.toStatus, 'planned')

        const runtimeState = await db
          .selectFrom('issue_runtime_state')
          .select(['current_status_code', 'open_operator_question_id'])
          .where('issue_id', '=', testCase.issueId)
          .executeTakeFirstOrThrow()

        assert.equal(runtimeState.current_status_code, 'planned')
        assert.equal(runtimeState.open_operator_question_id, null)
      }

      const verifiedIssueId = 'ISSUE-INTEGRATION-READY'
      await bootstrapIssueRuntimeState(db, {
        issueId: verifiedIssueId,
        workflowId: `issue:${verifiedIssueId}`,
        actorId: 'system/bootstrap',
        rawIssueArtifactUri: `linear://${verifiedIssueId}`,
        metadata: {
          highRisk: false,
        },
      })

      await applyTransition(db, {
        issueId: verifiedIssueId,
        triggerCode: 'system_contract_built',
        actorType: 'system',
        actorId: 'spec-agent',
        guardOutcomes: {
          contract_complete: true,
          primary_repo_resolved: true,
          blockers_inspected: true,
        },
        artifacts: [
          {
            artifactType: 'issue_contract_snapshot',
            artifactScope: 'issue',
            artifactUri: `artifact://${verifiedIssueId}/contract`,
          },
        ],
      })

      const readyTransition = await applyTransition(db, {
        issueId: verifiedIssueId,
        triggerCode: 'integration_verified',
        actorType: 'system',
        actorId: 'integration-agent',
        guardOutcomes: {
          integration_smoke_passed: true,
          no_unresolved_secret_slots: true,
          integration_go_live_checklist_prepared: true,
          prod_access_gate_satisfied_or_not_required: true,
          no_unresolved_blockers: true,
        },
        artifacts: [
          {
            artifactType: 'integration_smoke_report',
            artifactScope: 'issue',
            artifactUri: `artifact://${verifiedIssueId}/integration-smoke`,
          },
          {
            artifactType: 'integration_go_live_checklist',
            artifactScope: 'issue',
            artifactUri: `artifact://${verifiedIssueId}/go-live-checklist`,
          },
        ],
      })

      assert.equal(readyTransition.toStatus, 'ready_for_build')

      const readyState = await db
        .selectFrom('issue_runtime_state')
        .select('current_status_code')
        .where('issue_id', '=', verifiedIssueId)
        .executeTakeFirstOrThrow()

      assert.equal(readyState.current_status_code, 'ready_for_build')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'applyTransition rolls back audit and artifacts when a staged artifact write fails mid-transaction',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'worker-test',
      })

      await bootstrapIssueRuntimeState(db, {
        issueId: 'ISSUE-ROLLBACK-1',
        workflowId: 'issue:ISSUE-ROLLBACK-1',
        actorId: 'system/bootstrap',
        rawIssueArtifactUri: 'linear://ISSUE-ROLLBACK-1',
        metadata: {
          highRisk: false,
        },
      })

      const transitionCountBefore = await db
        .selectFrom('status_transition_audit')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-ROLLBACK-1')
        .executeTakeFirstOrThrow()
      const artifactCountBefore = await db
        .selectFrom('artifact_registry')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-ROLLBACK-1')
        .executeTakeFirstOrThrow()

      await assert.rejects(
        applyTransition(db, {
          issueId: 'ISSUE-ROLLBACK-1',
          triggerCode: 'system_input_required',
          actorType: 'system',
          actorId: 'spec-agent',
          reasonCode: 'missing_scope_answers',
          reasonText: 'Need two answers before planning',
          guardOutcomes: {
            critical_intake_fields_missing: true,
            structured_question_prepared: true,
          },
          artifacts: [
            {
              artifactType: 'operator_question',
              artifactScope: 'operator_question',
              artifactUri: 'artifact://operator-question/ISSUE-ROLLBACK-1/a',
              artifactSummary: 'Primary operator question',
              producedByRole: 'spec_agent',
            },
            {
              artifactType: 'operator_question',
              artifactScope: 'operator_question',
              artifactUri: 'artifact://operator-question/ISSUE-ROLLBACK-1/b',
              artifactSummary: 'Duplicate operator question to force rollback',
              producedByRole: 'spec_agent',
            },
          ],
        }),
      )

      const transitionCountAfter = await db
        .selectFrom('status_transition_audit')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-ROLLBACK-1')
        .executeTakeFirstOrThrow()
      const artifactCountAfter = await db
        .selectFrom('artifact_registry')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('issue_id', '=', 'ISSUE-ROLLBACK-1')
        .executeTakeFirstOrThrow()
      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code', 'open_operator_question_id'])
        .where('issue_id', '=', 'ISSUE-ROLLBACK-1')
        .executeTakeFirstOrThrow()

      assert.equal(transitionCountAfter.count, transitionCountBefore.count)
      assert.equal(artifactCountAfter.count, artifactCountBefore.count)
      assert.equal(runtimeState.current_status_code, 'triage')
      assert.equal(runtimeState.open_operator_question_id, null)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'applyTransition supports the integration onboarding path from planned to ready_for_build',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'worker-test',
      })

      await bootstrapIssueRuntimeState(db, {
        issueId: 'ISSUE-INTEGRATION-1',
        workflowId: 'issue:ISSUE-INTEGRATION-1',
        actorId: 'system/bootstrap',
        rawIssueArtifactUri: 'linear://ISSUE-INTEGRATION-1',
        metadata: {
          highRisk: false,
        },
      })

      await applyTransition(db, {
        issueId: 'ISSUE-INTEGRATION-1',
        triggerCode: 'system_contract_built',
        actorType: 'system',
        actorId: 'spec-agent',
        guardOutcomes: {
          contract_complete: true,
          primary_repo_resolved: true,
          blockers_inspected: true,
        },
        artifacts: [
          {
            artifactType: 'issue_contract_snapshot',
            artifactScope: 'issue',
            artifactUri: 'artifact://integration-issue-contract',
          },
        ],
      })

      const transition = await applyTransition(db, {
        issueId: 'ISSUE-INTEGRATION-1',
        triggerCode: 'integration_verified',
        actorType: 'system',
        actorId: 'integration-agent',
        guardOutcomes: {
          integration_smoke_passed: true,
          no_unresolved_secret_slots: true,
          integration_go_live_checklist_prepared: true,
          prod_access_gate_satisfied_or_not_required: true,
          no_unresolved_blockers: true,
        },
        artifacts: [
          {
            artifactType: 'integration_smoke_report',
            artifactScope: 'issue',
            artifactUri: 'artifact://integration-smoke-report',
          },
          {
            artifactType: 'integration_go_live_checklist',
            artifactScope: 'issue',
            artifactUri: 'artifact://integration-go-live-checklist',
          },
        ],
      })

      assert.equal(transition.toStatus, 'ready_for_build')

      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code'])
        .where('issue_id', '=', 'ISSUE-INTEGRATION-1')
        .executeTakeFirstOrThrow()

      assert.equal(runtimeState.current_status_code, 'ready_for_build')
    } finally {
      await db.destroy()
    }
  },
)
