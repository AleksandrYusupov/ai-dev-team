import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ensurePhase7ReferenceRepoBootstrap,
  getProjectRepositoryMappings,
  getRepositoryRegistryRecord,
  PHASE7_REFERENCE_PROJECT_ID,
  PHASE7_REFERENCE_REPO_SLUG,
  prepareTestDatabase,
} from './index.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

test(
  'ensurePhase7ReferenceRepoBootstrap upserts the canonical repo and primary mapping idempotently',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const localCheckoutPath =
        '/tmp/ai-dev-team/reference_repos/test_repo'
      const first = await ensurePhase7ReferenceRepoBootstrap(db, {
        localCheckoutPath,
      })
      const second = await ensurePhase7ReferenceRepoBootstrap(db, {
        localCheckoutPath,
      })

      assert.equal(first.repoSlug, PHASE7_REFERENCE_REPO_SLUG)
      assert.equal(first.linearProjectId, PHASE7_REFERENCE_PROJECT_ID)
      assert.equal(second.repoSlug, PHASE7_REFERENCE_REPO_SLUG)

      const repoRecord = await getRepositoryRegistryRecord(
        db,
        PHASE7_REFERENCE_REPO_SLUG,
      )
      const mappings = await getProjectRepositoryMappings(
        db,
        PHASE7_REFERENCE_PROJECT_ID,
      )

      assert.ok(repoRecord)
      assert.equal(repoRecord?.localCheckoutPath, localCheckoutPath)
      assert.deepEqual(repoRecord?.requiredChecks, [
        'typecheck',
        'test:phase7',
        'test:phase7:live',
      ])
      assert.equal(mappings.length, 1)
      assert.equal(mappings[0]?.repoSlug, PHASE7_REFERENCE_REPO_SLUG)
      assert.equal(mappings[0]?.mappingRole, 'primary')
      assert.equal(mappings[0]?.priorityOrder, 1)
    } finally {
      await db.destroy()
    }
  },
)

test(
  'ensurePhase7ReferenceRepoBootstrap rejects a conflicting primary mapping',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()

    try {
      await db
        .insertInto('repository_registry')
        .values({
          repo_slug: 'other_repo',
          github_owner: 'authenticated-owner',
          github_repo: 'other_repo',
          default_branch: 'main',
          visibility: 'private',
          linear_team_id: 'team-phase7',
          obsidian_root_note: 'ai_dev_team/architecture/other_repo.md',
          agent_guidance_scope: '.',
          local_checkout_path:
            '/tmp/ai-dev-team/reference_repos/other_repo',
          required_checks: toJsonInsert(['typecheck']),
          environments: toJsonInsert(['local']),
          repo_kind: 'application',
          service_dependencies: toJsonInsert([]),
        })
        .execute()

      await db
        .insertInto('project_repository_mappings')
        .values({
          linear_project_id: PHASE7_REFERENCE_PROJECT_ID,
          repo_slug: 'other_repo',
          mapping_role: 'primary',
          priority_order: 1,
        })
        .execute()

      await assert.rejects(
        ensurePhase7ReferenceRepoBootstrap(db),
        /refused to replace primary mapping other_repo/,
      )
    } finally {
      await db.destroy()
    }
  },
)
