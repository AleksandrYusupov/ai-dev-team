import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { prepareTestDatabase } from '@ai-dev-team/db'

import { runKnowledgeSyncOnce } from './knowledge-sync.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)

function toJsonInsert<T>(value: T): T {
  return JSON.stringify(value) as unknown as T
}

async function seedRepositoryRegistry(db: Awaited<ReturnType<typeof prepareTestDatabase>>) {
  await db
    .insertInto('repository_registry')
    .values({
      repo_slug: 'repo-primary',
      github_owner: 'acme',
      github_repo: 'repo-primary',
      default_branch: 'main',
      visibility: 'private',
      linear_team_id: 'team-1',
      obsidian_root_note:
        'ai_dev_team/architecture/05_full_system_implementation_plan.md',
      agent_guidance_scope: 'repo-root',
      local_checkout_path: process.cwd(),
      required_checks: toJsonInsert(['corepack pnpm test']),
      environments: toJsonInsert(['test']),
      repo_kind: 'service',
      service_dependencies: toJsonInsert([]),
    })
    .execute()
}

test('knowledge sync integration is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'runKnowledgeSyncOnce makes progress across multiple runs when the vault exceeds batchSize',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-dev-team-vault-'))

    try {
      await mkdir(path.join(vaultRoot, 'ai_dev_team', 'notes'), {
        recursive: true,
      })

      await writeFile(path.join(vaultRoot, 'ai_dev_team', 'notes', 'alpha.md'), '# Alpha\n')
      await writeFile(path.join(vaultRoot, 'ai_dev_team', 'notes', 'beta.md'), '# Beta\n')
      await writeFile(path.join(vaultRoot, 'ai_dev_team', 'notes', 'gamma.md'), '# Gamma\n')

      await seedRepositoryRegistry(db)

      const firstProcessed = await runKnowledgeSyncOnce(db, {
        database: {
          url: process.env.DATABASE_URL as string,
          poolMax: 1,
        },
        vaultRoot,
        batchSize: 1,
        maxNoteBytes: 128,
      })

      assert.equal(firstProcessed, 1)

      const firstRunSnapshots = await db
        .selectFrom('knowledge_note_snapshots')
        .select(['note_path', 'snapshot_status'])
        .where('note_path', 'in', [
          'ai_dev_team/notes/alpha.md',
          'ai_dev_team/notes/beta.md',
          'ai_dev_team/notes/gamma.md',
        ])
        .orderBy('note_path', 'asc')
        .execute()

      assert.deepEqual(firstRunSnapshots, [
        {
          note_path: 'ai_dev_team/notes/alpha.md',
          snapshot_status: 'fresh',
        },
      ])

      const secondProcessed = await runKnowledgeSyncOnce(db, {
        database: {
          url: process.env.DATABASE_URL as string,
          poolMax: 1,
        },
        vaultRoot,
        batchSize: 1,
        maxNoteBytes: 128,
      })

      assert.equal(secondProcessed, 1)

      const secondRunSnapshots = await db
        .selectFrom('knowledge_note_snapshots')
        .select(['note_path', 'snapshot_status'])
        .where('note_path', 'in', [
          'ai_dev_team/notes/alpha.md',
          'ai_dev_team/notes/beta.md',
          'ai_dev_team/notes/gamma.md',
        ])
        .orderBy('note_path', 'asc')
        .execute()

      assert.deepEqual(secondRunSnapshots, [
        {
          note_path: 'ai_dev_team/notes/alpha.md',
          snapshot_status: 'fresh',
        },
        {
          note_path: 'ai_dev_team/notes/beta.md',
          snapshot_status: 'fresh',
        },
      ])

      const thirdProcessed = await runKnowledgeSyncOnce(db, {
        database: {
          url: process.env.DATABASE_URL as string,
          poolMax: 1,
        },
        vaultRoot,
        batchSize: 1,
        maxNoteBytes: 128,
      })

      assert.equal(thirdProcessed, 1)

      const thirdRunSnapshots = await db
        .selectFrom('knowledge_note_snapshots')
        .select(['note_path', 'snapshot_status'])
        .where('note_path', 'in', [
          'ai_dev_team/notes/alpha.md',
          'ai_dev_team/notes/beta.md',
          'ai_dev_team/notes/gamma.md',
        ])
        .orderBy('note_path', 'asc')
        .execute()

      assert.deepEqual(thirdRunSnapshots, [
        {
          note_path: 'ai_dev_team/notes/alpha.md',
          snapshot_status: 'fresh',
        },
        {
          note_path: 'ai_dev_team/notes/beta.md',
          snapshot_status: 'fresh',
        },
        {
          note_path: 'ai_dev_team/notes/gamma.md',
          snapshot_status: 'fresh',
        },
      ])
    } finally {
      await rm(vaultRoot, {
        recursive: true,
        force: true,
      })
      await db.destroy()
    }
  },
)

test(
  'runKnowledgeSyncOnce resolves relative and short wiki-links using the vault index',
  { skip: !hasDatabase },
  async () => {
    const db = await prepareTestDatabase()
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-dev-team-vault-'))

    try {
      await mkdir(path.join(vaultRoot, 'ai_dev_team', 'architecture'), {
        recursive: true,
      })
      await mkdir(path.join(vaultRoot, 'ai_dev_team', 'notes', 'links'), {
        recursive: true,
      })
      await mkdir(path.join(vaultRoot, 'ai_dev_team', 'reference'), {
        recursive: true,
      })
      await mkdir(path.join(vaultRoot, 'ai_dev_team', 'elsewhere'), {
        recursive: true,
      })
      await mkdir(path.join(vaultRoot, 'helpers'), {
        recursive: true,
      })

      await writeFile(
        path.join(
          vaultRoot,
          'ai_dev_team',
          'architecture',
          '05_full_system_implementation_plan.md',
        ),
        '# Phase 4 Plan\n',
      )
      await writeFile(
        path.join(
          vaultRoot,
          'ai_dev_team',
          'architecture',
          '06_repository_registry_and_context_pack_spec.md',
        ),
        '# Repository Registry Spec\n',
      )
      await writeFile(
        path.join(vaultRoot, 'ai_dev_team', 'notes', 'links', 'current.md'),
        `# Current

See [[sibling]], [[ai_dev_team/architecture/06_repository_registry_and_context_pack_spec]], [[unique-note]], [[ambiguous]].
`,
      )
      await writeFile(
        path.join(vaultRoot, 'ai_dev_team', 'notes', 'links', 'sibling.md'),
        '# Local sibling\n',
      )
      await writeFile(
        path.join(vaultRoot, 'ai_dev_team', 'elsewhere', 'sibling.md'),
        '# Elsewhere sibling\n',
      )
      await writeFile(
        path.join(vaultRoot, 'ai_dev_team', 'reference', 'unique-note.md'),
        '# Unique note\n',
      )
      await writeFile(
        path.join(vaultRoot, 'ai_dev_team', 'notes', 'links', 'ambiguous.md'),
        '# Ambiguous one\n',
      )
      await writeFile(
        path.join(vaultRoot, 'helpers', 'ambiguous.md'),
        '# Ambiguous two\n',
      )

      await seedRepositoryRegistry(db)

      const processed = await runKnowledgeSyncOnce(db, {
        database: {
          url: process.env.DATABASE_URL as string,
          poolMax: 1,
        },
        vaultRoot,
        batchSize: 20,
        maxNoteBytes: 512,
      })

      assert.ok(processed > 0)

      const currentNote = await db
        .selectFrom('knowledge_note_snapshots')
        .select(['note_path', 'snapshot_status', 'resolved_links'])
        .where('note_path', '=', 'ai_dev_team/notes/links/current.md')
        .executeTakeFirstOrThrow()

      assert.equal(currentNote.snapshot_status, 'fresh')
      assert.deepEqual(currentNote.resolved_links, [
        'ai_dev_team/notes/links/sibling.md',
        'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec.md',
        'ai_dev_team/reference/unique-note.md',
        'ai_dev_team/notes/links/ambiguous.md',
      ])
    } finally {
      await rm(vaultRoot, {
        recursive: true,
        force: true,
      })
      await db.destroy()
    }
  },
)
