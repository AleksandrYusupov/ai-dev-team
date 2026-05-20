import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export interface AttemptPaths {
  workspaceAttemptPath: string
  worktreePath: string
  artifactAttemptRoot: string
  providerStageRoot: string
  providerTaskFile: string
  providerResultFile: string
}

export interface PreparedAttemptPaths extends AttemptPaths {
  checkoutPath: string
  checkoutPathManaged: boolean
  gitWorktreeSourcePath: string | null
  branchRef: string | null
}

async function runGitCommand(
  args: string[],
  cwd: string,
): Promise<void> {
  const child = spawn('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const [code, signal] = await Promise.race([
    once(child, 'exit') as Promise<
      [number | null, NodeJS.Signals | null]
    >,
    once(child, 'error').then(([error]) => {
      throw error
    }),
  ]) as [number | null, NodeJS.Signals | null]

  if (code !== 0 || signal) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}: ${stderr.trim() || signal || code}`,
    )
  }
}

async function runGitCommandWithStdout(
  args: string[],
  cwd: string,
): Promise<string> {
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
    once(child, 'exit') as Promise<
      [number | null, NodeJS.Signals | null]
    >,
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

async function isGitRepository(root: string): Promise<boolean> {
  try {
    await stat(path.join(root, '.git'))
    return true
  } catch {
    return false
  }
}

async function copyCheckout(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  })
}

export interface LocalArtifactStage {
  artifactId: string
  artifactPath: string
  manifestPath: string
  contentType: string
  sha256: string
  sizeBytes: number
  uri: string
}

function sanitizeSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_')

  return normalized.replace(/^_+|_+$/g, '') || 'default'
}

function buildManagedBranchName(issueId: string | null, leaseAttemptId: string | null): string {
  const branchSegment = sanitizeSegment(issueId ?? leaseAttemptId ?? 'attempt').toLowerCase()

  return `issue/${branchSegment}`
}

async function resolveGitBranchRef(worktreePath: string): Promise<string | null> {
  try {
    const branchName = await runGitCommandWithStdout(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      worktreePath,
    )

    if (!branchName || branchName === 'HEAD') {
      return null
    }

    return `refs/heads/${branchName}`
  } catch {
    return null
  }
}

export function buildAttemptPaths(options: {
  workspaceRoot: string
  worktreeRoot: string
  artifactRoot: string
  runnerNodeId: string
  repoSlug: string | null
  leaseAttemptId: string
}): AttemptPaths {
  const repoSegment = sanitizeSegment(options.repoSlug ?? 'no-repo')
  const runnerSegment = sanitizeSegment(options.runnerNodeId)
  const attemptSegment = sanitizeSegment(options.leaseAttemptId)
  const attemptParent = path.join(options.worktreeRoot, repoSegment, runnerSegment)
  const workspaceAttemptPath = path.join(options.workspaceRoot, repoSegment, attemptSegment)
  const worktreePath = path.join(attemptParent, attemptSegment)
  const artifactAttemptRoot = path.join(options.artifactRoot, repoSegment, runnerSegment, attemptSegment)
  const providerStageRoot = path.join(artifactAttemptRoot, 'provider-stage')
  const providerTaskFile = path.join(providerStageRoot, 'task.json')
  const providerResultFile = path.join(providerStageRoot, 'result.json')

  return {
    workspaceAttemptPath,
    worktreePath,
    artifactAttemptRoot,
    providerStageRoot,
    providerTaskFile,
    providerResultFile,
  }
}

export async function prepareAttemptPaths(
  paths: AttemptPaths,
  options: {
    checkoutPath?: string | null
    branchStrategy?: string | null
    issueId?: string | null
    leaseAttemptId?: string | null
    worktreePathHint?: string | null
  } = {},
): Promise<PreparedAttemptPaths> {
  const checkoutPath =
    options.checkoutPath?.trim() || paths.workspaceAttemptPath
  const worktreePath =
    options.worktreePathHint?.trim() || paths.worktreePath
  const checkoutPathManaged = options.checkoutPath == null
  const gitWorktreeSourcePath =
    checkoutPath !== worktreePath && (await isGitRepository(checkoutPath))
      ? checkoutPath
      : null
  let branchRef: string | null = null

  await rm(paths.providerStageRoot, { recursive: true, force: true })
  if (worktreePath !== checkoutPath || checkoutPathManaged) {
    await rm(worktreePath, { recursive: true, force: true })
  }
  if (checkoutPathManaged) {
    await rm(checkoutPath, { recursive: true, force: true })
  }

  await mkdir(path.dirname(checkoutPath), { recursive: true })
  await mkdir(path.dirname(worktreePath), { recursive: true })
  await mkdir(paths.artifactAttemptRoot, { recursive: true })
  await mkdir(paths.providerStageRoot, { recursive: true })
  await mkdir(checkoutPath, { recursive: true })

  if (gitWorktreeSourcePath) {
    const managedBranchName =
      options.branchStrategy === 'issue-scoped-worktree'
        ? buildManagedBranchName(options.issueId ?? null, options.leaseAttemptId ?? null)
        : null

    try {
      await runGitCommand(
        managedBranchName
          ? ['worktree', 'add', '--force', '-B', managedBranchName, worktreePath, 'HEAD']
          : ['worktree', 'add', '--detach', '--force', worktreePath, 'HEAD'],
        gitWorktreeSourcePath,
      )
      branchRef = await resolveGitBranchRef(worktreePath)
    } catch {
      await copyCheckout(checkoutPath, worktreePath)
    }
  } else if (worktreePath !== checkoutPath) {
    await copyCheckout(checkoutPath, worktreePath)
  }

  if (!branchRef) {
    branchRef = await resolveGitBranchRef(worktreePath)
  }

  return {
    ...paths,
    checkoutPath,
    checkoutPathManaged,
    branchRef,
    gitWorktreeSourcePath,
    worktreePath,
  }
}

export async function cleanupAttemptPaths(paths: PreparedAttemptPaths): Promise<void> {
  if (paths.gitWorktreeSourcePath) {
    try {
      await runGitCommand(
        ['worktree', 'remove', '--force', paths.worktreePath],
        paths.gitWorktreeSourcePath,
      )
      await runGitCommand(['worktree', 'prune', '--expire=now'], paths.gitWorktreeSourcePath)
    } catch {
      await rm(paths.worktreePath, { recursive: true, force: true })
    }
  } else if (paths.worktreePath !== paths.checkoutPath || paths.checkoutPathManaged) {
    await rm(paths.worktreePath, { recursive: true, force: true })
  }

  if (paths.checkoutPathManaged) {
    await rm(paths.checkoutPath, { recursive: true, force: true })
  }

  await rm(paths.providerStageRoot, { recursive: true, force: true })
}

function stableArtifactName(name: string): string {
  return sanitizeSegment(name)
}

export async function stageLocalArtifact(
  artifactRoot: string,
  artifactName: string,
  contents: string | Buffer,
  contentType: string,
): Promise<LocalArtifactStage> {
  const stageName = stableArtifactName(artifactName)
  const artifactId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const artifactDir = path.join(artifactRoot, 'staged', stageName, artifactId)
  const artifactPath = path.join(artifactDir, 'artifact')
  const manifestPath = path.join(artifactDir, 'artifact.manifest.json')
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  await mkdir(artifactDir, { recursive: true })
  await writeFile(artifactPath, buffer)
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        artifactId,
        artifactName,
        contentType,
        sha256,
        sizeBytes: buffer.byteLength,
        artifactPath,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )

  return {
    artifactId,
    artifactPath,
    manifestPath,
    contentType,
    sha256,
    sizeBytes: buffer.byteLength,
    uri: pathToFileURL(artifactPath).toString(),
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8')

  return JSON.parse(raw) as T
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}
