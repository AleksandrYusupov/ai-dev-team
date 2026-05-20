import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import {
  loadWorkflowManifestBundle,
  prepareTestDatabase,
  publishWorkflowConfig,
} from '@ai-dev-team/db'

import { runOutboxExecutorOnce } from './executor.js'

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

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

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

async function seedPostLinearCommentOutbox(db: Awaited<ReturnType<typeof prepareTestDatabase>>) {
  const bundle = await loadWorkflowManifestBundle()
  await publishWorkflowConfig(db, bundle, {
    publishedBy: 'workflow-worker-outbox-test',
  })

  const transitionAudit = await db
    .insertInto('status_transition_audit')
    .values({
      issue_id: 'ISSUE-OUTBOX-1',
      run_id: null,
      workflow_id: 'issue:ISSUE-OUTBOX-1',
      config_version: 1,
      from_status_code: 'agent_review',
      to_status_code: 'needs_human_decision',
      trigger_code: 'system_human_gate_required',
      rule_id: null,
      actor_type: 'system',
      actor_id: 'review_agent',
      owner_role: 'review_agent',
      reason_code: null,
      reason_text: 'Review completed and requires a human decision.',
      comment_id: null,
      artifact_links: toJsonInsert([]),
      checkpoint_id: null,
      lease_id: null,
      metadata: toJsonInsert({}),
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  await db
    .insertInto('artifact_registry')
    .values([
      {
        issue_id: 'ISSUE-OUTBOX-1',
        run_id: null,
        transition_audit_id: transitionAudit.id,
        artifact_type: 'decision_summary',
        artifact_scope: 'issue',
        artifact_uri: 'artifact://phase7/outbox/decision-summary',
        artifact_summary: 'Decision summary',
        produced_by_role: 'review_agent',
        produced_for_status_code: 'needs_human_decision',
        metadata: toJsonInsert({
          summary: 'Review summary for human follow-up.',
          recommendedNextAction: 'Review the summary and choose the next action.',
        }),
      },
      {
        issue_id: 'ISSUE-OUTBOX-1',
        run_id: null,
        transition_audit_id: transitionAudit.id,
        artifact_type: 'review_report',
        artifact_scope: 'issue',
        artifact_uri: 'artifact://phase7/outbox/review-report',
        artifact_summary: 'Review report',
        produced_by_role: 'review_agent',
        produced_for_status_code: 'needs_human_decision',
        metadata: toJsonInsert({
          reviewDisposition: 'rework_recommended',
          reviewedBuildArtifactId: 'artifact-build-1',
          reviewFindings: [{ severity: 'medium', summary: 'Needs follow-up' }],
        }),
      },
    ])
    .execute()

  const outbox = await db
    .insertInto('workflow_effect_outbox')
    .values({
      transition_audit_id: transitionAudit.id,
      issue_id: 'ISSUE-OUTBOX-1',
      run_id: null,
      command_type: 'post_linear_comment',
      command_payload: toJsonInsert({
        schemaVersion: 1,
        commandKey: 'outbox-post-linear-comment-1',
        issueId: 'ISSUE-OUTBOX-1',
        runId: null,
        workflowId: 'issue:ISSUE-OUTBOX-1',
        transitionAuditId: transitionAudit.id,
        configVersion: 1,
        body: {},
        issuedAt: new Date().toISOString(),
      }),
      idempotency_key: 'outbox-post-linear-comment-1',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  return {
    outboxId: outbox.id,
    transitionAuditId: transitionAudit.id,
  }
}

async function seedSyncLinearStateOutbox(
  db: Awaited<ReturnType<typeof prepareTestDatabase>>,
) {
  const bundle = await loadWorkflowManifestBundle()
  await publishWorkflowConfig(db, bundle, {
    publishedBy: 'workflow-worker-linear-sync-test',
  })

  await db
    .insertInto('issue_runtime_state')
    .values({
      issue_id: 'ISSUE-LINEAR-SYNC-1',
      current_status_code: 'monitoring',
      current_stage: 'monitoring',
      workflow_id: 'issue:ISSUE-LINEAR-SYNC-1',
      active_run_id: null,
      pinned_config_version: 1,
      open_operator_question_id: null,
      pause_reason_code: null,
      pause_reason_text: null,
      resume_condition: null,
      suspended_from_status_code: null,
      block_reason_code: null,
      block_reason_text: null,
      blocked_by_issue_ids: toJsonInsert([]),
      active_lease_id: null,
    })
    .execute()

  await db
    .insertInto('repository_registry')
    .values({
      repo_slug: 'repo/frontend',
      github_owner: 'acme',
      github_repo: 'frontend',
      default_branch: 'main',
      visibility: 'private',
      linear_team_id: 'team-stub',
      obsidian_root_note: '[[repo/frontend]]',
      agent_guidance_scope: 'default',
      local_checkout_path: null,
      required_checks: toJsonInsert(['ci']),
      environments: toJsonInsert(['production']),
      repo_kind: 'application',
      service_dependencies: toJsonInsert([]),
    })
    .execute()

  await db
    .insertInto('issue_linear_sync_projection')
    .values({
      issue_id: 'ISSUE-LINEAR-SYNC-1',
      repo_slug: 'repo/frontend',
      branch_ref: 'refs/heads/issue-linear-sync-1',
      pr_number: 42,
      pr_url: 'https://github.com/acme/frontend/pull/42',
      pr_state: 'open',
      latest_check_conclusion: 'success',
      latest_check_url: 'https://github.com/acme/frontend/actions/runs/101',
      latest_deployment_env: 'production',
      latest_deployment_state: 'healthy',
      latest_deployment_url: 'https://deploy.example.com/releases/42',
      last_synced_payload_hash: null,
      last_sync_outcome: null,
      last_sync_error: null,
      last_sync_at: null,
    })
    .execute()

  const outbox = await db
    .insertInto('workflow_effect_outbox')
    .values({
      transition_audit_id: null,
      issue_id: 'ISSUE-LINEAR-SYNC-1',
      run_id: null,
      command_type: 'sync_linear_state',
      command_payload: toJsonInsert({
        schemaVersion: 1,
        commandType: 'sync_linear_state',
        commandKey: 'sync-linear-state-outbox-1',
        issueId: 'ISSUE-LINEAR-SYNC-1',
        runId: null,
        workflowId: 'issue:ISSUE-LINEAR-SYNC-1',
        transitionAuditId: null,
        configVersion: 1,
        body: {
          payloadHash: 'payload-hash-linear-sync-1',
          milestoneEvent: 'deploy_healthy',
        },
        issuedAt: new Date().toISOString(),
        intentPersistedOnly: true,
      }),
      idempotency_key: 'sync-linear-state-outbox-1',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  return {
    outboxId: outbox.id,
    payloadHash: 'payload-hash-linear-sync-1',
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

async function startLinearStubServer(statusCode = 200) {
  const requests: Array<{
    headers: Record<string, string | string[] | undefined>
    payload: unknown
  }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      requests.push({
        headers: request.headers,
        payload: rawBody ? JSON.parse(rawBody) : null,
      })
      response.writeHead(statusCode, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify(
          statusCode === 200
            ? buildLinearStubBody(rawBody ? JSON.parse(rawBody) : null)
            : { errors: [{ message: 'stub failure' }] },
        ),
      )
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
    requests,
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
  'runOutboxExecutorOnce posts the Phase 7 Linear decision summary when Linear is configured',
  { skip: !hasDatabase },
  async () => {
    const linearStub = await startLinearStubServer(200)

    try {
      await withTemporaryEnv(
        {
          LINEAR_API_TOKEN: 'linear-phase7-token',
          LINEAR_API_BASE_URL: linearStub.apiBaseUrl,
        },
        async () => {
          const db = await prepareTestDatabase()

          try {
            const seeded = await seedPostLinearCommentOutbox(db)
            const config = loadWorkflowWorkerConfig(process.env)
            const processed = await runOutboxExecutorOnce(db, config)

            assert.equal(processed, 1)
            assert.equal(linearStub.requests.length, 1)
            const outboxRow = await db
              .selectFrom('workflow_effect_outbox')
              .select(['status', 'last_error', 'attempt_count'])
              .where('id', '=', seeded.outboxId)
              .executeTakeFirstOrThrow()

            assert.equal(outboxRow.status, 'done')
            assert.equal(outboxRow.last_error, null)
            assert.equal(outboxRow.attempt_count, 1)
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
  'runOutboxExecutorOnce syncs Linear state, attachments, and milestone updates',
  { skip: !hasDatabase },
  async () => {
    const linearStub = await startLinearStubServer(200)

    try {
      await withTemporaryEnv(
        {
          LINEAR_API_TOKEN: 'linear-phase8-token',
          LINEAR_API_BASE_URL: linearStub.apiBaseUrl,
        },
        async () => {
          const db = await prepareTestDatabase()

          try {
            const seeded = await seedSyncLinearStateOutbox(db)
            const config = loadWorkflowWorkerConfig(process.env)
            const processed = await runOutboxExecutorOnce(db, config)

            assert.equal(processed, 1)

            const requestQueries = linearStub.requests.map((request) => {
              const payload =
                request.payload && typeof request.payload === 'object'
                  ? (request.payload as Record<string, unknown>)
                  : {}

              return typeof payload.query === 'string' ? payload.query : ''
            })

            assert.equal(
              requestQueries.filter((query) => query.includes('LinearSyncIssueContext')).length,
              1,
            )
            assert.equal(
              requestQueries.filter((query) => query.includes('issueUpdate(')).length,
              1,
            )
            assert.equal(
              requestQueries.filter((query) => query.includes('attachmentCreate(')).length,
              4,
            )
            assert.equal(
              requestQueries.filter((query) => query.includes('commentCreate(')).length,
              1,
            )
            assert.equal(
              requestQueries.filter((query) => query.includes('projectUpdateCreate(')).length,
              1,
            )

            const outboxRow = await db
              .selectFrom('workflow_effect_outbox')
              .select(['status', 'last_error', 'attempt_count'])
              .where('id', '=', seeded.outboxId)
              .executeTakeFirstOrThrow()

            assert.equal(outboxRow.status, 'done')
            assert.equal(outboxRow.last_error, null)
            assert.equal(outboxRow.attempt_count, 1)

            const projection = await db
              .selectFrom('issue_linear_sync_projection')
              .select([
                'last_synced_payload_hash',
                'last_sync_outcome',
                'last_sync_error',
              ])
              .where('issue_id', '=', 'ISSUE-LINEAR-SYNC-1')
              .where('repo_slug', '=', 'repo/frontend')
              .executeTakeFirstOrThrow()

            assert.equal(projection.last_synced_payload_hash, seeded.payloadHash)
            assert.equal(projection.last_sync_outcome, 'succeeded')
            assert.equal(projection.last_sync_error, null)
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
  'runOutboxExecutorOnce marks sync_linear_state failed when Linear returns an error',
  { skip: !hasDatabase },
  async () => {
    const linearStub = await startLinearStubServer(500)

    try {
      await withTemporaryEnv(
        {
          LINEAR_API_TOKEN: 'linear-phase8-token',
          LINEAR_API_BASE_URL: linearStub.apiBaseUrl,
        },
        async () => {
          const db = await prepareTestDatabase()

          try {
            const seeded = await seedSyncLinearStateOutbox(db)
            const config = loadWorkflowWorkerConfig(process.env)
            const processed = await runOutboxExecutorOnce(db, config)

            assert.equal(processed, 1)

            const outboxRow = await db
              .selectFrom('workflow_effect_outbox')
              .select(['status', 'last_error', 'attempt_count'])
              .where('id', '=', seeded.outboxId)
              .executeTakeFirstOrThrow()

            assert.equal(outboxRow.status, 'failed')
            assert.match(outboxRow.last_error ?? '', /Linear GraphQL call failed/)
            assert.equal(outboxRow.attempt_count, 1)

            const projection = await db
              .selectFrom('issue_linear_sync_projection')
              .select([
                'last_synced_payload_hash',
                'last_sync_outcome',
                'last_sync_error',
              ])
              .where('issue_id', '=', 'ISSUE-LINEAR-SYNC-1')
              .where('repo_slug', '=', 'repo/frontend')
              .executeTakeFirstOrThrow()

            assert.equal(projection.last_synced_payload_hash, seeded.payloadHash)
            assert.equal(projection.last_sync_outcome, 'failed')
            assert.match(projection.last_sync_error ?? '', /Linear GraphQL call failed/)
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
  'runOutboxExecutorOnce fails closed when LINEAR_API_TOKEN is missing',
  { skip: !hasDatabase },
  async () => {
    await withTemporaryEnv(
      {
        LINEAR_API_TOKEN: '',
      },
      async () => {
        const db = await prepareTestDatabase()

        try {
          const seeded = await seedPostLinearCommentOutbox(db)
          const config = loadWorkflowWorkerConfig(process.env)
          const processed = await runOutboxExecutorOnce(db, config)

          assert.equal(processed, 1)
          const outboxRow = await db
            .selectFrom('workflow_effect_outbox')
            .select(['status', 'last_error', 'attempt_count'])
            .where('id', '=', seeded.outboxId)
            .executeTakeFirstOrThrow()

          assert.equal(outboxRow.status, 'failed')
          assert.match(outboxRow.last_error ?? '', /LINEAR_API_TOKEN/)
          assert.equal(outboxRow.attempt_count, 1)
        } finally {
          await db.destroy()
        }
      },
    )
  },
)

test(
  'runOutboxExecutorOnce retries when Linear returns an error response',
  { skip: !hasDatabase },
  async () => {
    const linearStub = await startLinearStubServer(500)

    try {
      await withTemporaryEnv(
        {
          LINEAR_API_TOKEN: 'linear-phase7-token',
          LINEAR_API_BASE_URL: linearStub.apiBaseUrl,
        },
        async () => {
          const db = await prepareTestDatabase()

          try {
            const seeded = await seedPostLinearCommentOutbox(db)
            const config = loadWorkflowWorkerConfig(process.env)
            const processed = await runOutboxExecutorOnce(db, config)

            assert.equal(processed, 1)
            assert.equal(linearStub.requests.length, 1)
            const outboxRow = await db
              .selectFrom('workflow_effect_outbox')
              .select(['status', 'last_error', 'attempt_count'])
              .where('id', '=', seeded.outboxId)
              .executeTakeFirstOrThrow()

            assert.equal(outboxRow.status, 'failed')
            assert.match(outboxRow.last_error ?? '', /Linear comment post failed/)
            assert.equal(outboxRow.attempt_count, 1)
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
