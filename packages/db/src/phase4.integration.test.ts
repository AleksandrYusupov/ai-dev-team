import assert from 'node:assert/strict'
import test from 'node:test'

import type { ContextPack } from '@ai-dev-team/shared'

import {
  cacheContextPack,
  getActiveContextPackCache,
  getLatestIssueContractSnapshot,
  getLatestKnowledgeNoteSnapshotStatuses,
  getLatestKnowledgeNoteSnapshots,
  getProjectRepositoryMappings,
  getRepositoryRegistryRecord,
  getRepositoryRegistryRecords,
  prepareTestDatabase,
  upsertIssueContractSnapshot,
  upsertKnowledgeNoteSnapshot,
} from './index.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

function buildContextPack(input: {
  estimatedTokens: number
  issueContractSnapshotHash: string
}): ContextPack {
  return {
    issue: {
      issueId: 'ISSUE-1',
      goal: 'Ship Phase 4',
      background: 'integration test',
      scope: ['Exercise db helpers'],
      nonGoals: ['None'],
      acceptanceCriteria: ['Helpers return persisted rows'],
      verificationPath: {
        automated: ['corepack pnpm test:integration'],
        manual: [],
      },
      doneWhen: ['Assertions pass'],
      risk: 'medium',
      dependencies: {
        blocks: [],
        blockedBy: ['ISSUE-UPSTREAM-1'],
        external: [],
      },
      primaryRepo: 'repo-primary',
      affectedRepos: ['repo-secondary'],
      docsLinks: [
        'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
      ],
      openQuestions: [],
      issueType: 'feature',
      source: 'founder',
      mode: 'autonomous',
      humanDecisionRequired: false,
    },
    repositories: [],
    decisionSummary: ['Goal: Ship Phase 4'],
    latestRelevantComments: [],
    docsPack: [],
    repoGuidance: [],
    budgets: {
      contextPolicyVersion: 1,
      estimatedTokens: input.estimatedTokens,
      maxTokens: 16_000,
      commentCount: 0,
      noteCount: 0,
      truncatedSections: [],
    },
    sourceTrace: {
      issueContractSnapshotId: 'snapshot-1',
      issueContractSnapshotHash: input.issueContractSnapshotHash,
      mappingIds: ['mapping-1'],
      noteSnapshotRefs: [],
      repoGuidanceRefs: [],
      commentRefs: [],
      warnings: [],
    },
  }
}

test('phase4 db integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'phase4 db helpers persist and read registry, snapshots, and cached context packs',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      await db
        .insertInto('repository_registry')
        .values([
          {
            repo_slug: 'repo-primary',
            github_owner: 'acme',
            github_repo: 'repo-primary',
            default_branch: 'main',
            visibility: 'private',
            linear_team_id: 'team-1',
            obsidian_root_note:
              'ai_dev_team/architecture/05_full_system_implementation_plan.md',
            agent_guidance_scope: '.',
            local_checkout_path: null,
            required_checks: toJsonInsert(['typecheck', 'test']),
            environments: toJsonInsert(['test']),
            repo_kind: 'service',
            service_dependencies: toJsonInsert([]),
          },
          {
            repo_slug: 'repo-secondary',
            github_owner: 'acme',
            github_repo: 'repo-secondary',
            default_branch: 'main',
            visibility: 'private',
            linear_team_id: 'team-1',
            obsidian_root_note:
              'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
            agent_guidance_scope: '.',
            local_checkout_path: null,
            required_checks: toJsonInsert(['typecheck']),
            environments: toJsonInsert(['test']),
            repo_kind: 'library',
            service_dependencies: toJsonInsert([]),
          },
        ])
        .execute()

      await db
        .insertInto('project_repository_mappings')
        .values([
          {
            linear_project_id: 'project-1',
            repo_slug: 'repo-primary',
            mapping_role: 'primary',
            priority_order: 1,
          },
          {
            linear_project_id: 'project-1',
            repo_slug: 'repo-secondary',
            mapping_role: 'affected',
            priority_order: 2,
          },
        ])
        .execute()

      await upsertIssueContractSnapshot(db, {
        issueId: 'ISSUE-1',
        snapshotHash: 'snapshot-hash-1',
        primaryRepo: 'repo-primary',
        affectedRepos: ['repo-secondary'],
        docsLinks: ['ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md'],
        risk: 'medium',
        dependencies: {
          blocks: [],
          blockedBy: ['ISSUE-UPSTREAM-1'],
          external: [],
        },
        contractJson: {
          project: 'project-1',
          primaryRepo: 'repo-primary',
          affectedRepos: ['repo-secondary'],
          goal: 'Ship Phase 4',
          background: 'integration test',
          scope: ['Exercise db helpers'],
          nonGoals: ['None'],
          acceptanceCriteria: ['Helpers return persisted rows'],
          verificationPath: {
            automated: ['corepack pnpm test:integration'],
            manual: [],
          },
          docsLinks: ['ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md'],
          dependencies: {
            blocks: [],
            blockedBy: ['ISSUE-UPSTREAM-1'],
            external: [],
          },
          risk: 'medium',
          doneWhen: ['Assertions pass'],
          openQuestions: [],
          humanDecisionRequired: false,
          issueType: 'feature',
          source: 'founder',
          mode: 'autonomous',
        },
      })

      await upsertKnowledgeNoteSnapshot(db, {
        notePath: 'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
        noteTitle: 'Repository registry spec',
        rootTag: '#ai_dev_team',
        contentHash: 'note-hash-1',
        resolvedLinks: [],
        sanitizedMarkdown: 'Spec content',
        summaryMarkdown: 'Spec summary',
        sourceUpdatedAt: new Date(),
        snapshotStatus: 'fresh',
        lastError: null,
      })

      await cacheContextPack(db, {
        issueId: 'ISSUE-1',
        inputFingerprint: 'fingerprint-1',
        bundleJson: {
          issue: {
            issueId: 'ISSUE-1',
            goal: 'Ship Phase 4',
            background: 'integration test',
            scope: ['Exercise db helpers'],
            nonGoals: ['None'],
            acceptanceCriteria: ['Helpers return persisted rows'],
            verificationPath: {
              automated: ['corepack pnpm test:integration'],
              manual: [],
            },
            doneWhen: ['Assertions pass'],
            risk: 'medium',
            dependencies: {
              blocks: [],
              blockedBy: ['ISSUE-UPSTREAM-1'],
              external: [],
            },
            primaryRepo: 'repo-primary',
            affectedRepos: ['repo-secondary'],
            docsLinks: [
              'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
            ],
            openQuestions: [],
            issueType: 'feature',
            source: 'founder',
            mode: 'autonomous',
            humanDecisionRequired: false,
          },
          repositories: [],
          decisionSummary: ['Goal: Ship Phase 4'],
          latestRelevantComments: [],
          docsPack: [],
          repoGuidance: [],
          budgets: {
            contextPolicyVersion: 1,
            estimatedTokens: 42,
            maxTokens: 16_000,
            commentCount: 0,
            noteCount: 0,
            truncatedSections: [],
          },
          sourceTrace: {
            issueContractSnapshotId: 'snapshot-1',
            issueContractSnapshotHash: 'snapshot-hash-1',
            mappingIds: ['mapping-1'],
            noteSnapshotRefs: [],
            repoGuidanceRefs: [],
            commentRefs: [],
            warnings: [],
          },
        },
        estimatedTokens: 42,
        sourceTraceJson: {
          issueContractSnapshotId: 'snapshot-1',
          issueContractSnapshotHash: 'snapshot-hash-1',
          mappingIds: ['mapping-1'],
          noteSnapshotRefs: [],
          repoGuidanceRefs: [],
          commentRefs: [],
          warnings: [],
        },
      })

      const repository = await getRepositoryRegistryRecord(db, 'repo-primary')
      const repositories = await getRepositoryRegistryRecords(db, [
        'repo-primary',
        'repo-secondary',
      ])
      const mappings = await getProjectRepositoryMappings(db, 'project-1')
      const snapshot = await getLatestIssueContractSnapshot(db, 'ISSUE-1')
      const noteSnapshots = await getLatestKnowledgeNoteSnapshots(db, [
        'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
      ])
      const cached = await getActiveContextPackCache(
        db,
        'ISSUE-1',
        'fingerprint-1',
      )

      assert.equal(repository?.repoSlug, 'repo-primary')
      assert.equal(repositories.length, 2)
      assert.equal(mappings.length, 2)
      assert.equal(snapshot?.primaryRepo, 'repo-primary')
      assert.equal(noteSnapshots[0]?.noteTitle, 'Repository registry spec')
      assert.equal(cached?.estimatedTokens, 42)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'phase4 db helpers prefer fresh snapshots, preserve fresh rows, and keep cache writes immutable',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const notePath =
        'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md'

      await upsertKnowledgeNoteSnapshot(db, {
        notePath,
        noteTitle: 'Repository registry spec',
        rootTag: '#ai_dev_team',
        contentHash: 'note-hash-fresh',
        resolvedLinks: [],
        sanitizedMarkdown: 'Fresh content',
        summaryMarkdown: 'Fresh summary',
        sourceUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        snapshotStatus: 'fresh',
        lastError: null,
      })

      await upsertKnowledgeNoteSnapshot(db, {
        notePath,
        noteTitle: 'Repository registry spec',
        rootTag: '#ai_dev_team',
        contentHash: 'note-hash-stale',
        resolvedLinks: [],
        sanitizedMarkdown: 'Stale content',
        summaryMarkdown: 'Stale summary',
        sourceUpdatedAt: new Date('2026-01-02T00:00:00.000Z'),
        snapshotStatus: 'stale',
        lastError: 'stale snapshot',
      })

      const latestSnapshots = await getLatestKnowledgeNoteSnapshots(db, [notePath])
      const latestStatuses = await getLatestKnowledgeNoteSnapshotStatuses(db, [
        notePath,
      ])
      assert.equal(latestSnapshots.length, 1)
      assert.equal(latestSnapshots[0]?.contentHash, 'note-hash-fresh')
      assert.equal(latestSnapshots[0]?.snapshotStatus, 'fresh')
      assert.equal(latestSnapshots[0]?.sanitizedMarkdown, 'Fresh content')
      assert.equal(latestStatuses.length, 1)
      assert.equal(latestStatuses[0]?.contentHash, 'note-hash-stale')
      assert.equal(latestStatuses[0]?.snapshotStatus, 'stale')

      await upsertKnowledgeNoteSnapshot(db, {
        notePath,
        noteTitle: 'Repository registry spec',
        rootTag: '#ai_dev_team',
        contentHash: 'note-hash-protected',
        resolvedLinks: [],
        sanitizedMarkdown: 'Protected fresh content',
        summaryMarkdown: 'Protected fresh summary',
        sourceUpdatedAt: new Date('2026-01-03T00:00:00.000Z'),
        snapshotStatus: 'fresh',
        lastError: null,
      })

      await upsertKnowledgeNoteSnapshot(db, {
        notePath,
        noteTitle: 'Repository registry spec (downgrade attempt)',
        rootTag: '#ai_dev_team',
        contentHash: 'note-hash-protected',
        resolvedLinks: ['ai_dev_team/implementation/07_phase_4_repository_registry_and_context_pipeline_implementation.md'],
        sanitizedMarkdown: 'Downgraded content',
        summaryMarkdown: 'Downgraded summary',
        sourceUpdatedAt: new Date('2026-01-04T00:00:00.000Z'),
        snapshotStatus: 'failed',
        lastError: 'sync failed',
      })

      const protectedSnapshot = await db
        .selectFrom('knowledge_note_snapshots')
        .selectAll()
        .where('note_path', '=', notePath)
        .where('content_hash', '=', 'note-hash-protected')
        .executeTakeFirstOrThrow()

      assert.equal(protectedSnapshot.snapshot_status, 'fresh')
      assert.equal(protectedSnapshot.last_error, null)
      assert.equal(protectedSnapshot.note_title, 'Repository registry spec')
      assert.equal(protectedSnapshot.sanitized_markdown, 'Protected fresh content')

      await cacheContextPack(db, {
        issueId: 'ISSUE-1',
        inputFingerprint: 'fingerprint-1',
        bundleJson: buildContextPack({
          estimatedTokens: 42,
          issueContractSnapshotHash: 'snapshot-hash-1',
        }),
        estimatedTokens: 42,
        sourceTraceJson: {
          issueContractSnapshotId: 'snapshot-1',
          issueContractSnapshotHash: 'snapshot-hash-1',
          mappingIds: ['mapping-1'],
          noteSnapshotRefs: [],
          repoGuidanceRefs: [],
          commentRefs: [],
          warnings: [],
        },
      })

      await cacheContextPack(db, {
        issueId: 'ISSUE-1',
        inputFingerprint: 'fingerprint-1',
        bundleJson: buildContextPack({
          estimatedTokens: 99,
          issueContractSnapshotHash: 'snapshot-hash-1',
        }),
        estimatedTokens: 99,
        sourceTraceJson: {
          issueContractSnapshotId: 'snapshot-1',
          issueContractSnapshotHash: 'snapshot-hash-1',
          mappingIds: ['mapping-1'],
          noteSnapshotRefs: [],
          repoGuidanceRefs: [],
          commentRefs: [],
          warnings: ['ignored rewrite'],
        },
      })

      const cachedSameFingerprint = await getActiveContextPackCache(
        db,
        'ISSUE-1',
        'fingerprint-1',
      )

      assert.equal(cachedSameFingerprint?.estimatedTokens, 42)
      assert.equal(cachedSameFingerprint?.bundleJson.budgets.estimatedTokens, 42)

      await Promise.all([
        cacheContextPack(db, {
          issueId: 'ISSUE-1',
          inputFingerprint: 'fingerprint-2',
          bundleJson: buildContextPack({
            estimatedTokens: 84,
            issueContractSnapshotHash: 'snapshot-hash-2',
          }),
          estimatedTokens: 84,
          sourceTraceJson: {
            issueContractSnapshotId: 'snapshot-2',
            issueContractSnapshotHash: 'snapshot-hash-2',
            mappingIds: ['mapping-2'],
            noteSnapshotRefs: [],
            repoGuidanceRefs: [],
            commentRefs: [],
            warnings: [],
          },
        }),
        cacheContextPack(db, {
          issueId: 'ISSUE-1',
          inputFingerprint: 'fingerprint-3',
          bundleJson: buildContextPack({
            estimatedTokens: 126,
            issueContractSnapshotHash: 'snapshot-hash-3',
          }),
          estimatedTokens: 126,
          sourceTraceJson: {
            issueContractSnapshotId: 'snapshot-3',
            issueContractSnapshotHash: 'snapshot-hash-3',
            mappingIds: ['snapshot-3-mapping'],
            noteSnapshotRefs: [],
            repoGuidanceRefs: [],
            commentRefs: [],
            warnings: [],
          },
        }),
      ])

      const cacheRows = await db
        .selectFrom('context_pack_cache')
        .selectAll()
        .where('issue_id', '=', 'ISSUE-1')
        .orderBy('context_version', 'asc')
        .execute()

      assert.equal(cacheRows.length, 3)
      assert.equal(cacheRows[0]?.superseded_at !== null, true)
      assert.equal(cacheRows[1]?.superseded_at !== null, true)
      assert.equal(cacheRows[2]?.superseded_at, null)
      assert.ok(
        cacheRows[2]?.input_fingerprint === 'fingerprint-2' ||
          cacheRows[2]?.input_fingerprint === 'fingerprint-3',
      )
      assert.equal(
        await getActiveContextPackCache(db, 'ISSUE-1', 'fingerprint-1'),
        null,
      )
      const baselineCache = cacheRows.find(
        (row) => row.input_fingerprint === 'fingerprint-1',
      )
      assert.equal(baselineCache?.bundle_json.budgets.estimatedTokens, 42)
    } finally {
      await db.destroy()
    }
  },
)
