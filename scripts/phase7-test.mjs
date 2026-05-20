#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = process.env.DATABASE_URL ?? null

function run(command, args, label, extraEnv = {}) {
  process.stdout.write(`\n> ${label}\n`)
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  })
}

const failures = []

for (const [command, args, label] of [
  ['corepack', ['pnpm', '--filter', '@ai-dev-team/shared', 'build'], 'build shared'],
  [
    'node',
    [
      '--test',
      'packages/shared/dist/phase6-runner-protocol.test.js',
      'packages/shared/dist/phase7-runner-protocol.test.js',
    ],
    'run shared phase 6 and phase 7 protocol tests',
  ],
  ['corepack', ['pnpm', '--filter', '@ai-dev-team/db', 'compile'], 'compile db'],
  ['corepack', ['pnpm', '--filter', '@ai-dev-team/control-api', 'compile'], 'compile control-api'],
  [
    'corepack',
    ['pnpm', '--filter', '@ai-dev-team/workflow-worker', 'compile'],
    'compile workflow-worker',
  ],
  ['corepack', ['pnpm', '--filter', '@ai-dev-team/runner-host', 'test'], 'run runner-host tests'],
  ['corepack', ['pnpm', '--filter', '@ai-dev-team/control-api', 'test'], 'run control-api tests'],
  ['corepack', ['pnpm', '--filter', '@ai-dev-team/workflow-worker', 'test'], 'run workflow-worker unit tests'],
  ['corepack', ['pnpm', '--filter', '@ai-dev-team/db', 'test'], 'run db unit tests'],
]) {
  try {
    run(command, args, label)
  } catch (error) {
    failures.push({ label, error })
  }
}

if (!databaseUrl) {
  failures.push({
    label: 'database-backed phase 7 verification requires DATABASE_URL',
    error: new Error('DATABASE_URL is not set'),
  })
}

if (failures.length > 0) {
  process.stderr.write('\nPhase 7 verification blockers:\n')
  for (const failure of failures) {
    process.stderr.write(`- ${failure.label}\n`)
  }
  process.exitCode = 1
} else {
  for (const [command, args, label] of [
    [
      '/bin/zsh',
      [
        '-lc',
        `DATABASE_URL=${databaseUrl} corepack pnpm --filter @ai-dev-team/db test:integration`,
      ],
      'run db phase 7 integration tests',
    ],
    [
      '/bin/zsh',
      [
        '-lc',
        `DATABASE_URL=${databaseUrl} corepack pnpm --filter @ai-dev-team/workflow-worker test:integration`,
      ],
      'run workflow-worker phase 7 integration tests',
    ],
    [
      '/bin/zsh',
      [
        '-lc',
        `DATABASE_URL=${databaseUrl} corepack pnpm --filter @ai-dev-team/control-api test:integration`,
      ],
      'run control-api phase 7 integration tests',
    ],
  ]) {
    try {
      run(command, args, label)
    } catch (error) {
      failures.push({ label, error })
    }
  }

  if (failures.length > 0) {
    process.stderr.write('\nPhase 7 verification blockers:\n')
    for (const failure of failures) {
      process.stderr.write(`- ${failure.label}\n`)
    }
    process.exitCode = 1
  }
}
