#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULT_PHASE7_TEST_REPO_PATH =
  '/tmp/ai-dev-team/reference_repos/test_repo'

function loadEnvFiles() {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(rootDir, fileName)

    if (!existsSync(filePath)) {
      continue
    }

    const raw = readFileSync(filePath, 'utf8')

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      const normalized = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length).trimStart()
        : trimmed
      const equalsIndex = normalized.indexOf('=')

      if (equalsIndex <= 0) {
        continue
      }

      const key = normalized.slice(0, equalsIndex).trim()

      if (process.env[key]?.trim()) {
        continue
      }

      process.env[key] = normalized.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    }
  }
}

function runGit(repoPath, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', repoPath, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
  })

  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    )
  }

  return result
}

function writeFileIfChanged(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true })

  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) {
    return false
  }

  writeFileSync(filePath, content)
  return true
}

function buildBaselineFiles() {
  return new Map([
    [
      '.phase7-reference-repo.json',
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repoSlug: 'test_repo',
          purpose: 'Canonical Phase 7 local reference repository',
        },
        null,
        2,
      )}\n`,
    ],
    [
      'package.json',
      `${JSON.stringify(
        {
          name: 'test_repo',
          private: true,
          version: '0.1.0',
          type: 'module',
          scripts: {
            build: 'node scripts/build.mjs',
            test: 'node --test',
          },
        },
        null,
        2,
      )}\n`,
    ],
    [
      'README.md',
      [
        '# test_repo',
        '',
        'Canonical local reference repository for the honest Phase 7 build/review proof.',
        '',
        '- Minimal application slice with one deterministic build path.',
        '- One predictable review surface for runner-host build/review loops.',
      ].join('\n') + '\n',
    ],
    [
      'scripts/build.mjs',
      [
        "import { readFile } from 'node:fs/promises'",
        '',
        "const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))",
        "process.stdout.write(`build-ok:${packageJson.name}\\n`)",
      ].join('\n') + '\n',
    ],
    [
      'src/index.js',
      [
        'export function formatStatusLine(issueId) {',
        "  return `Issue ${issueId}: phase7 reference repo is ready.`",
        '}',
        '',
        'export function buildSummary(issueId) {',
        '  return {',
        '    issueId,',
        "    status: 'ready',",
        "    summary: formatStatusLine(issueId),",
        '  }',
        '}',
      ].join('\n') + '\n',
    ],
    [
      'src/index.test.js',
      [
        "import assert from 'node:assert/strict'",
        "import test from 'node:test'",
        '',
        "import { buildSummary, formatStatusLine } from './index.js'",
        '',
        "test('formatStatusLine returns a stable summary', () => {",
        "  assert.equal(formatStatusLine('ISSUE-1'), 'Issue ISSUE-1: phase7 reference repo is ready.')",
        '})',
        '',
        "test('buildSummary returns the deterministic buildable slice', () => {",
        "  assert.deepEqual(buildSummary('ISSUE-1'), {",
        "    issueId: 'ISSUE-1',",
        "    status: 'ready',",
        "    summary: 'Issue ISSUE-1: phase7 reference repo is ready.',",
        '  })',
        '})',
      ].join('\n') + '\n',
    ],
  ])
}

async function main() {
  loadEnvFiles()
  const repoPath = path.resolve(
    process.env.PHASE7_TEST_REPO_PATH?.trim() || DEFAULT_PHASE7_TEST_REPO_PATH,
  )
  const repoExists = existsSync(path.join(repoPath, '.git'))

  mkdirSync(repoPath, { recursive: true })

  if (!repoExists) {
    runGit(repoPath, ['init', '--initial-branch=main'])
  }

  runGit(repoPath, ['config', 'user.name', 'Phase7 Bootstrap'])
  runGit(repoPath, ['config', 'user.email', 'phase7-bootstrap@example.com'])

  const headResult = runGit(repoPath, ['rev-parse', '--verify', 'HEAD'], {
    allowFailure: true,
  })
  const hasHead = headResult.status === 0

  if (hasHead) {
    const statusResult = runGit(repoPath, ['status', '--porcelain'])

    if (statusResult.stdout.trim().length > 0) {
      throw new Error(
        `Phase 7 reference repo at ${repoPath} is dirty. Clean it before re-running bootstrap.`,
      )
    }
  }

  let changed = false

  for (const [relativePath, content] of buildBaselineFiles().entries()) {
    changed = writeFileIfChanged(path.join(repoPath, relativePath), content) || changed
  }

  if (!hasHead) {
    runGit(repoPath, ['add', '.'])
    runGit(repoPath, ['commit', '-m', 'Bootstrap canonical Phase 7 reference repo'])
  } else if (changed) {
    throw new Error(
      `Phase 7 reference repo at ${repoPath} already has commits but baseline files drifted. Repair it manually before promotion.`,
    )
  }

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required for Phase 7 reference repo bootstrap')
  }

  const [{ createDb, ensurePhase7ReferenceRepoBootstrap }, { loadDatabaseConfig }] =
    await Promise.all([
      import('../packages/db/dist/index.js'),
      import('../packages/config/dist/index.js'),
    ])

  const db = createDb(loadDatabaseConfig(process.env))

  try {
    const result = await ensurePhase7ReferenceRepoBootstrap(db, {
      localCheckoutPath: repoPath,
    })

    process.stdout.write(
      `${JSON.stringify(
        {
          repoPath,
          repoSlug: result.repoSlug,
          linearProjectId: result.linearProjectId,
          populated: !hasHead,
        },
        null,
        2,
      )}\n`,
    )
  } finally {
    await db.destroy()
  }
}

await main()
