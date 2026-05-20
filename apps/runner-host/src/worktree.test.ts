import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildAttemptPaths,
  cleanupAttemptPaths,
  prepareAttemptPaths,
  stageLocalArtifact,
} from './worktree.js'

async function runGit(args: string[], cwd: string): Promise<string> {
  const child = spawn('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const [code, signal] = await Promise.race([
    once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>,
    once(child, 'error').then(([error]) => {
      throw error
    }),
  ]) as [number | null, NodeJS.Signals | null]

  if (code !== 0 || signal) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}: ${stderr.trim() || signal || code}`,
    )
  }

  return stdout.trim()
}

test('worktree paths are deterministic and artifact staging is local', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-worktree-'))
  const workspaceRoot = path.join(sandboxRoot, 'workspace')
  const worktreeRoot = path.join(sandboxRoot, 'worktrees')
  const artifactRoot = path.join(sandboxRoot, 'artifacts')
  const checkoutPath = path.join(sandboxRoot, 'checkout')
  const worktreeHint = path.join(sandboxRoot, 'task-worktree')

  const paths = buildAttemptPaths({
    workspaceRoot,
    worktreeRoot,
    artifactRoot,
    runnerNodeId: 'runner/node-1',
    repoSlug: 'acme/repo',
    leaseAttemptId: 'attempt-1',
  })
  assert.ok(paths.worktreePath.includes('runner_node-1'))
  assert.ok(paths.workspaceAttemptPath.includes('acme_repo'))

  await mkdir(checkoutPath, { recursive: true })
  await writeFile(path.join(checkoutPath, 'README.md'), '# checkout\n')

  const prepared = await prepareAttemptPaths(paths, {
    checkoutPath,
    worktreePathHint: worktreeHint,
  })
  assert.equal(prepared.checkoutPath, checkoutPath)
  assert.equal(prepared.worktreePath, worktreeHint)

  const staged = await stageLocalArtifact(
    prepared.artifactAttemptRoot,
    'summary artifact',
    'hello\n',
    'text/plain',
  )
  assert.ok(staged.uri.startsWith('file://'))
  assert.equal(staged.contentType, 'text/plain')

  await cleanupAttemptPaths(prepared)
  await assert.rejects(readFile(path.join(worktreeHint, 'README.md'), 'utf8'))
  assert.equal(await readFile(path.join(checkoutPath, 'README.md'), 'utf8'), '# checkout\n')
  await rm(sandboxRoot, { recursive: true, force: true })
})

test('prepareAttemptPaths creates an issue-scoped git worktree branch when a checkout is available', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-git-worktree-'))
  const workspaceRoot = path.join(sandboxRoot, 'workspace')
  const worktreeRoot = path.join(sandboxRoot, 'worktrees')
  const artifactRoot = path.join(sandboxRoot, 'artifacts')
  const checkoutPath = path.join(sandboxRoot, 'checkout')
  const worktreeHint = path.join(sandboxRoot, 'task-worktree')

  await mkdir(checkoutPath, { recursive: true })
  await runGit(['init', '-b', 'main'], checkoutPath)
  await runGit(['config', 'user.email', 'runner@example.com'], checkoutPath)
  await runGit(['config', 'user.name', 'Runner Host'], checkoutPath)
  await writeFile(path.join(checkoutPath, 'README.md'), '# checkout\n')
  await runGit(['add', 'README.md'], checkoutPath)
  await runGit(['commit', '-m', 'init'], checkoutPath)

  const paths = buildAttemptPaths({
    workspaceRoot,
    worktreeRoot,
    artifactRoot,
    runnerNodeId: 'runner/node-1',
    repoSlug: 'acme/repo',
    leaseAttemptId: 'attempt-branch',
  })

  const prepared = await prepareAttemptPaths(paths, {
    branchStrategy: 'issue-scoped-worktree',
    checkoutPath,
    issueId: 'ISSUE-123',
    leaseAttemptId: 'attempt-branch',
    worktreePathHint: worktreeHint,
  })

  assert.equal(prepared.branchRef, 'refs/heads/issue/issue-123')
  assert.equal(await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], prepared.worktreePath), 'issue/issue-123')
  assert.equal(await readFile(path.join(prepared.worktreePath, 'README.md'), 'utf8'), '# checkout\n')

  await cleanupAttemptPaths(prepared)
  await rm(sandboxRoot, { recursive: true, force: true })
})
