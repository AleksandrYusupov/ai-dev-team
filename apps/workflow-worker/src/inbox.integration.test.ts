import assert from 'node:assert/strict'
import test from 'node:test'

import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import {
  type JsonObject,
  persistRawEventDelivery,
  prepareTestDatabase,
} from '@ai-dev-team/db'
import {
  buildSupportedGitHubFixtures,
  buildSupportedLinearFixtures,
  serializePhase3FixturePayload,
} from '@ai-dev-team/shared'

import { runInboxProcessorOnce } from './inbox/executor.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

function buildWorkerConfig() {
  return loadWorkflowWorkerConfig({
    DATABASE_URL: process.env.DATABASE_URL as string,
    WEBHOOK_REPLAY_WINDOW_MS: '60000',
  })
}

async function seedRepositoryRegistry(
  db: Awaited<ReturnType<typeof prepareTestDatabase>>,
  repositories: Array<{
    repoSlug: string
    obsidianRootNote: string
  }>,
) {
  await db
    .insertInto('repository_registry')
    .values(
      repositories.map((repository) => ({
        repo_slug: repository.repoSlug,
        github_owner: 'acme',
        github_repo: repository.repoSlug,
        default_branch: 'main',
        visibility: 'private',
        linear_team_id: 'team-1',
        obsidian_root_note: repository.obsidianRootNote,
        agent_guidance_scope: '.',
        local_checkout_path: null,
        required_checks: toJsonInsert(['typecheck']),
        environments: toJsonInsert(['test']),
        repo_kind: 'service',
        service_dependencies: toJsonInsert([]),
      })),
    )
    .execute()
}

test('inbox processor integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'runInboxProcessorOnce normalizes the supported Phase 3 event families',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const now = Date.now()
      const config = buildWorkerConfig()
      const linearEvents = buildSupportedLinearFixtures(now)
      const githubEvents = buildSupportedGitHubFixtures()
      const promptFixture = linearEvents.find(
        (event) => event.providerEventType === 'Comment',
      )
      assert.ok(promptFixture)

      await seedRepositoryRegistry(db, [
        {
          repoSlug: 'repo-fixture-primary',
          obsidianRootNote:
            'ai_dev_team/architecture/05_full_system_implementation_plan.md',
        },
        {
          repoSlug: 'repo-fixture-affected',
          obsidianRootNote:
            'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
        },
      ])

      for (const event of linearEvents) {
        await persistRawEventDelivery(db, {
          provider: 'linear',
          providerEventType: event.providerEventType,
          providerAction: event.providerAction,
          deliveryId: event.deliveryId,
          signatureStatus: 'verified',
          providerTimestamp: new Date(now),
          requestHeaders: {},
          rawBody: serializePhase3FixturePayload(event),
          parsedPayload: event.payload as unknown as JsonObject,
          replayWindowValid: true,
          issueId: event.refs.issueId,
          commentId: event.refs.commentId,
          projectId: event.refs.projectId,
          repositoryFullName: null,
        })
      }

      for (const event of githubEvents) {
        await persistRawEventDelivery(db, {
          provider: 'github',
          providerEventType: event.providerEventType,
          providerAction: event.providerAction,
          deliveryId: event.deliveryId,
          signatureStatus: 'verified',
          providerTimestamp: null,
          requestHeaders: {},
          rawBody: serializePhase3FixturePayload(event),
          parsedPayload: event.payload as unknown as JsonObject,
          replayWindowValid: null,
          issueId: null,
          commentId: null,
          projectId: null,
          repositoryFullName: event.refs.repositoryFullName,
        })
      }

      const processed = await runInboxProcessorOnce(db, config)

      assert.equal(processed, linearEvents.length + githubEvents.length)

      const normalizedRows = await db
        .selectFrom('raw_event_inbox')
        .select(['provider', 'provider_event_type', 'processing_status', 'canonical_envelope'])
        .orderBy('provider', 'asc')
        .orderBy('provider_event_type', 'asc')
        .execute()

      assert.equal(
        normalizedRows.every((row) =>
          ['normalized', 'dispatched'].includes(row.processing_status),
        ),
        true,
      )

      const linearIssue = normalizedRows.find(
        (row) => row.provider === 'linear' && row.provider_event_type === 'Issue',
      )
      const linearComment = normalizedRows.find(
        (row) => row.provider === 'linear' && row.provider_event_type === 'Comment',
      )
      const githubWorkflowRun = normalizedRows.find(
        (row) =>
          row.provider === 'github' &&
          row.provider_event_type === 'workflow_run',
      )

      assert.equal(linearIssue?.canonical_envelope?.classification, 'transition_candidate')
      assert.equal(linearIssue?.canonical_envelope?.triggerCandidate, 'user_create_issue')
      assert.equal(linearIssue?.processing_status, 'dispatched')
      assert.equal(linearComment?.canonical_envelope?.triggerCandidate, 'human_comment_ask')
      assert.equal(linearComment?.processing_status, 'dispatched')
      assert.equal(githubWorkflowRun?.canonical_envelope?.classification, 'sync_only')
      assert.equal(githubWorkflowRun?.processing_status, 'normalized')

      const commentLog = await db
        .selectFrom('comment_log')
        .select(['provider_comment_id', 'classification', 'contains_ask'])
        .executeTakeFirstOrThrow()

      const issueContractSnapshot = await db
        .selectFrom('linear_issue_contract_snapshots')
        .select(['issue_id', 'primary_repo', 'affected_repos'])
        .executeTakeFirstOrThrow()

      assert.equal(commentLog.provider_comment_id, promptFixture.refs.commentId)
      assert.equal(commentLog.classification, 'prompt')
      assert.equal(commentLog.contains_ask, true)
      assert.equal(issueContractSnapshot.issue_id, 'ISSUE-FIXTURE-1')
      assert.equal(issueContractSnapshot.primary_repo, 'repo-fixture-primary')
      assert.deepEqual(issueContractSnapshot.affected_repos, [
        'repo-fixture-affected',
      ])
    } finally {
      await db.destroy()
    }
  },
)

test(
  'runInboxProcessorOnce ignores invalid rows and supports redrive from raw inbox',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const config = buildWorkerConfig()
      const staleTimestamp = new Date(Date.now() - 120_000)

      await persistRawEventDelivery(db, {
        provider: 'linear',
        providerEventType: 'Issue',
        providerAction: 'create',
        deliveryId: 'linear-stale',
        signatureStatus: 'verified',
        providerTimestamp: staleTimestamp,
        requestHeaders: {},
        rawBody: JSON.stringify({
          action: 'create',
          type: 'Issue',
          webhookTimestamp: staleTimestamp.getTime(),
          data: { id: 'ISSUE-STALE' },
        }),
        parsedPayload: {
          action: 'create',
          type: 'Issue',
          webhookTimestamp: staleTimestamp.getTime(),
          data: { id: 'ISSUE-STALE' },
        },
        replayWindowValid: false,
        issueId: 'ISSUE-STALE',
        commentId: null,
        projectId: null,
        repositoryFullName: null,
      })

      await persistRawEventDelivery(db, {
        provider: 'linear',
        providerEventType: 'Comment',
        providerAction: 'create',
        deliveryId: 'linear-redrive',
        signatureStatus: 'verified',
        providerTimestamp: new Date(),
        requestHeaders: {},
        rawBody: JSON.stringify({
          action: 'create',
          type: 'Comment',
          webhookTimestamp: Date.now(),
          actor: { id: 'user-2', type: 'user' },
          data: { id: 'comment-redrive', body: 'missing issue id' },
        }),
        parsedPayload: {
          action: 'create',
          type: 'Comment',
          webhookTimestamp: Date.now(),
          actor: { id: 'user-2', type: 'user' },
          data: { id: 'comment-redrive', body: 'missing issue id' },
        },
        replayWindowValid: true,
        issueId: null,
        commentId: 'comment-redrive',
        projectId: null,
        repositoryFullName: null,
      })

      await persistRawEventDelivery(db, {
        provider: 'github',
        providerEventType: 'check_run',
        providerAction: 'completed',
        deliveryId: 'github-invalid-signature',
        signatureStatus: 'failed',
        providerTimestamp: null,
        requestHeaders: {},
        rawBody: JSON.stringify({
          action: 'completed',
          repository: { id: 1, full_name: 'acme/repo' },
          check_run: { id: 123 },
        }),
        parsedPayload: {
          action: 'completed',
          repository: { id: 1, full_name: 'acme/repo' },
          check_run: { id: 123 },
        },
        replayWindowValid: null,
        issueId: null,
        commentId: null,
        projectId: null,
        repositoryFullName: 'acme/repo',
      })

      const firstPass = await runInboxProcessorOnce(db, config)

      assert.equal(firstPass, 3)

      const staleRow = await db
        .selectFrom('raw_event_inbox')
        .select(['processing_status', 'last_error'])
        .where('delivery_id', '=', 'linear-stale')
        .executeTakeFirstOrThrow()

      const failedRow = await db
        .selectFrom('raw_event_inbox')
        .select(['id', 'processing_status', 'last_error'])
        .where('delivery_id', '=', 'linear-redrive')
        .executeTakeFirstOrThrow()

      const invalidSignatureRow = await db
        .selectFrom('raw_event_inbox')
        .select(['processing_status', 'last_error'])
        .where('delivery_id', '=', 'github-invalid-signature')
        .executeTakeFirstOrThrow()

      assert.equal(staleRow.processing_status, 'ignored')
      assert.match(staleRow.last_error ?? '', /replay_window/)
      assert.equal(failedRow.processing_status, 'failed')
      assert.match(failedRow.last_error ?? '', /missing_identifiers/)
      assert.equal(invalidSignatureRow.processing_status, 'ignored')
      assert.match(invalidSignatureRow.last_error ?? '', /signature_not_verified/)

      await db
        .updateTable('raw_event_inbox')
        .set({
          parsed_payload: {
            action: 'create',
            type: 'Comment',
            webhookTimestamp: Date.now(),
            actor: { id: 'user-2', type: 'user' },
            data: {
              id: 'comment-redrive',
              issueId: 'ISSUE-REDRIVE',
              body: 'replayed comment',
              createdAt: new Date().toISOString(),
            },
          },
          issue_id: 'ISSUE-REDRIVE',
          replay_window_valid: true,
          processing_status: 'failed',
          last_error: null,
        })
        .where('id', '=', failedRow.id)
        .execute()

      const secondPass = await runInboxProcessorOnce(db, config)

      assert.equal(secondPass, 1)

      const redrivenRow = await db
        .selectFrom('raw_event_inbox')
        .select(['processing_status', 'canonical_envelope'])
        .where('id', '=', failedRow.id)
        .executeTakeFirstOrThrow()

      assert.equal(redrivenRow.processing_status, 'normalized')
      assert.equal(redrivenRow.canonical_envelope?.commentId, 'comment-redrive')

      const redrivenComment = await db
        .selectFrom('comment_log')
        .select(['provider_comment_id', 'issue_id'])
        .where('provider_comment_id', '=', 'comment-redrive')
        .executeTakeFirstOrThrow()

      assert.equal(redrivenComment.issue_id, 'ISSUE-REDRIVE')
    } finally {
      await db.destroy()
    }
  },
)

test(
  'runInboxProcessorOnce supports redrive for malformed Linear issue contract yaml',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const config = buildWorkerConfig()

      await seedRepositoryRegistry(db, [
        {
          repoSlug: 'repo-primary',
          obsidianRootNote:
            'ai_dev_team/architecture/05_full_system_implementation_plan.md',
        },
        {
          repoSlug: 'repo-secondary',
          obsidianRootNote:
            'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
        },
      ])

      await persistRawEventDelivery(db, {
        provider: 'linear',
        providerEventType: 'Issue',
        providerAction: 'update',
        deliveryId: 'linear-issue-contract-malformed',
        signatureStatus: 'verified',
        providerTimestamp: new Date(),
        requestHeaders: {},
        rawBody: JSON.stringify({
          action: 'update',
          type: 'Issue',
          webhookTimestamp: Date.now(),
          data: {
            id: 'ISSUE-CONTRACT-1',
            projectId: 'project-contract-1',
            description: `---
primary_repo: [broken
---
`,
          },
        }),
        parsedPayload: {
          action: 'update',
          type: 'Issue',
          webhookTimestamp: Date.now(),
          data: {
            id: 'ISSUE-CONTRACT-1',
            projectId: 'project-contract-1',
            description: `---
primary_repo: [broken
---
`,
          },
        },
        replayWindowValid: true,
        issueId: 'ISSUE-CONTRACT-1',
        commentId: null,
        projectId: 'project-contract-1',
        repositoryFullName: null,
      })

      const firstPass = await runInboxProcessorOnce(db, config)

      assert.equal(firstPass, 1)

      const failedRow = await db
        .selectFrom('raw_event_inbox')
        .select(['id', 'processing_status', 'last_error'])
        .where('delivery_id', '=', 'linear-issue-contract-malformed')
        .executeTakeFirstOrThrow()

      assert.equal(failedRow.processing_status, 'failed')
      assert.match(failedRow.last_error ?? '', /linear_issue_contract_yaml_invalid/)

      await db
        .updateTable('raw_event_inbox')
        .set({
          parsed_payload: {
            action: 'update',
            type: 'Issue',
            webhookTimestamp: Date.now(),
            data: {
              id: 'ISSUE-CONTRACT-1',
              projectId: 'project-contract-1',
              description: `---
primary_repo: repo-primary
affected_repos:
  - repo-secondary
goal: Repair malformed contract
scope: Reprocess issue event
non_goals:
  - None
acceptance_criteria:
  - Snapshot persists
verification_path:
  - corepack pnpm test:integration
docs_links:
  - ai_dev_team/architecture/06_repository_registry_and_context_pack_spec
dependencies:
  blocked_by:
    - ISSUE-UPSTREAM-1
risk: low
done_when:
  - Snapshot exists
---
`,
            },
          },
          raw_body: JSON.stringify({
            action: 'update',
            type: 'Issue',
            webhookTimestamp: Date.now(),
            data: {
              id: 'ISSUE-CONTRACT-1',
              projectId: 'project-contract-1',
              description: `---
primary_repo: repo-primary
affected_repos:
  - repo-secondary
goal: Repair malformed contract
scope: Reprocess issue event
non_goals:
  - None
acceptance_criteria:
  - Snapshot persists
verification_path:
  - corepack pnpm test:integration
docs_links:
  - ai_dev_team/architecture/06_repository_registry_and_context_pack_spec
dependencies:
  blocked_by:
    - ISSUE-UPSTREAM-1
risk: low
done_when:
  - Snapshot exists
---
`,
            },
          }),
          processing_status: 'failed',
          last_error: null,
        })
        .where('id', '=', failedRow.id)
        .execute()

      const secondPass = await runInboxProcessorOnce(db, config)

      assert.equal(secondPass, 1)

      const repairedRow = await db
        .selectFrom('raw_event_inbox')
        .select(['processing_status'])
        .where('id', '=', failedRow.id)
        .executeTakeFirstOrThrow()

      const snapshot = await db
        .selectFrom('linear_issue_contract_snapshots')
        .select(['issue_id', 'primary_repo'])
        .where('issue_id', '=', 'ISSUE-CONTRACT-1')
        .executeTakeFirstOrThrow()

      assert.equal(repairedRow.processing_status, 'normalized')
      assert.equal(snapshot.primary_repo, 'repo-primary')
    } finally {
      await db.destroy()
    }
  },
)
