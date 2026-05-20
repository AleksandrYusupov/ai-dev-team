import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadKnowledgeSyncConfig, type KnowledgeSyncConfig } from '@ai-dev-team/config'
import {
  createDb,
  getLatestKnowledgeNoteSnapshots,
  listActiveRepositoryRegistryRecords,
  upsertKnowledgeNoteSnapshot,
  type DbClient,
} from '@ai-dev-team/db'

function normalizeVaultRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function normalizeNotePath(relativePath: string): string {
  const normalized = normalizeVaultRelativePath(relativePath)

  return normalized.endsWith('.md') ? normalized : `${normalized}.md`
}

function normalizeRootTag(notePath: string): string {
  const root = notePath.split('/')[0] ?? 'vault_root'

  return `#${root
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')}`
}

function extractNoteTitle(notePath: string, markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()

  if (heading) {
    return heading
  }

  return path.basename(notePath, '.md')
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*/u, '')
}

function extractWikiLinkTargets(markdown: string): string[] {
  const links: string[] = []

  for (const match of markdown.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const raw = match[1]?.split('|')[0]?.split('#')[0]?.trim()

    if (raw) {
      links.push(normalizeNotePath(raw))
    }
  }

  return [...new Set(links)]
}

export interface VaultIndex {
  notePaths: Set<string>
  basenames: Map<string, string[]>
}

function getNoteStem(notePath: string): string {
  return path.posix.basename(notePath, '.md')
}

function buildVaultIndex(markdownFiles: readonly string[], vaultRoot: string): VaultIndex {
  const notePaths = new Set<string>()
  const basenames = new Map<string, string[]>()

  for (const absoluteFilePath of markdownFiles) {
    const notePath = normalizeNotePath(path.relative(vaultRoot, absoluteFilePath))
    notePaths.add(notePath)

    const stem = getNoteStem(notePath)
    const bucket = basenames.get(stem) ?? []

    bucket.push(notePath)
    basenames.set(stem, bucket)
  }

  return {
    notePaths,
    basenames,
  }
}

function resolveWikiLinkCandidate(
  rawLink: string,
  currentNotePath: string,
  vaultIndex: VaultIndex,
): string | null {
  const trimmed = rawLink.trim()

  if (!trimmed) {
    return null
  }

  if (trimmed.includes('..')) {
    return null
  }

  const vaultRelative = trimmed.replace(/^\/+/, '')

  if (vaultRelative.includes('/')) {
    const candidatePath = normalizeNotePath(vaultRelative)

    return candidatePath.startsWith('..') || !vaultIndex.notePaths.has(candidatePath)
      ? null
      : candidatePath
  }

  const currentDirectory = path.posix.dirname(currentNotePath)
  const relativeCandidate = normalizeNotePath(
    path.posix.join(currentDirectory, vaultRelative),
  )

  if (!relativeCandidate.startsWith('..') && vaultIndex.notePaths.has(relativeCandidate)) {
    return relativeCandidate
  }

  const basenameMatches = vaultIndex.basenames.get(
    getNoteStem(normalizeNotePath(vaultRelative)),
  ) ?? []

  if (basenameMatches.length === 1) {
    return basenameMatches[0] ?? null
  }

  return null
}

export function resolveWikiLinks(
  markdown: string,
  currentNotePath: string,
  vaultIndex: VaultIndex,
): string[] {
  const resolved = new Set<string>()

  for (const rawLink of extractWikiLinkTargets(markdown)) {
    const resolvedLink = resolveWikiLinkCandidate(rawLink, currentNotePath, vaultIndex)

    if (resolvedLink) {
      resolved.add(resolvedLink)
    }
  }

  return [...resolved]
}

function sanitizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\0/g, '').trim()
}

export function summarizeMarkdown(markdown: string): string {
  const lines = stripFrontmatter(markdown)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 6)

  const summary = lines.join(' ')

  if (summary.length <= 600) {
    return summary
  }

  return `${summary.slice(0, 600).trimEnd()} ...[truncated]`
}

function summarizeForStorage(markdown: string): string {
  const lines = stripFrontmatter(markdown)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 6)

  const summary = lines.join('\n')

  if (summary.length <= 600) {
    return summary
  }

  return `${summary.slice(0, 600).trimEnd()}\n...[truncated]`
}

function allowedRootDirectories(obsidianRootNotes: readonly string[]): string[] {
  const roots = new Set<string>(['ai_dev_team', 'helpers'])

  for (const notePath of obsidianRootNotes) {
    const root = normalizeNotePath(notePath).split('/')[0]

    if (root) {
      roots.add(root)
    }
  }

  return [...roots].sort()
}

async function collectMarkdownFiles(
  directoryPath: string,
): Promise<string[]> {
  const entries = await readdir(directoryPath, {
    withFileTypes: true,
  })
  const files: string[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(absolutePath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(absolutePath)
    }
  }

  return files
}

type ScannedMarkdownFile = {
  relativeFilePath: string
  fileStats: Awaited<ReturnType<typeof stat>>
  rawMarkdown: string | null
  readError: string | null
  contentHash: string | null
  sanitizedMarkdown: string
}

async function scanMarkdownFiles(
  markdownFiles: readonly string[],
  vaultRoot: string,
): Promise<ScannedMarkdownFile[]> {
  const scannedFiles: ScannedMarkdownFile[] = []

  for (const absoluteFilePath of markdownFiles) {
    const relativeFilePath = normalizeNotePath(path.relative(vaultRoot, absoluteFilePath))
    const fileStats = await stat(absoluteFilePath)

    try {
      const rawMarkdown = await readFile(absoluteFilePath, 'utf8')

      scannedFiles.push({
        relativeFilePath,
        fileStats,
        rawMarkdown,
        readError: null,
        contentHash: createHash('sha256').update(rawMarkdown).digest('hex'),
        sanitizedMarkdown: sanitizeMarkdown(rawMarkdown),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      scannedFiles.push({
        relativeFilePath,
        fileStats,
        rawMarkdown: null,
        readError: message,
        contentHash: null,
        sanitizedMarkdown: '',
      })
    }
  }

  return scannedFiles
}

function isCurrentSnapshotFresh(
  latestSnapshot:
    | Awaited<ReturnType<typeof getLatestKnowledgeNoteSnapshots>>[number]
    | undefined,
  currentContentHash: string | null,
): boolean {
  return Boolean(
    latestSnapshot &&
      latestSnapshot.snapshotStatus === 'fresh' &&
      currentContentHash !== null &&
      latestSnapshot.contentHash === currentContentHash,
  )
}

export async function runKnowledgeSyncOnce(
  db: DbClient,
  config: KnowledgeSyncConfig,
): Promise<number> {
  const repositories = await listActiveRepositoryRegistryRecords(db)
  const allowedRoots = allowedRootDirectories(
    repositories.map((repository) => repository.obsidianRootNote),
  )
  const markdownFiles: string[] = []

  for (const root of allowedRoots) {
    const absoluteRoot = path.join(config.vaultRoot, root)

    try {
      const rootStats = await stat(absoluteRoot)

      if (!rootStats.isDirectory()) {
        continue
      }

      markdownFiles.push(...(await collectMarkdownFiles(absoluteRoot)))
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException

      if (nodeError.code !== 'ENOENT') {
        throw error
      }
    }
  }

  const vaultIndex = buildVaultIndex(markdownFiles, config.vaultRoot)
  const scannedFiles = await scanMarkdownFiles(markdownFiles, config.vaultRoot)
  const latestSnapshots = await getLatestKnowledgeNoteSnapshots(
    db,
    scannedFiles.map((file) => file.relativeFilePath),
  )
  const latestSnapshotByPath = new Map(
    latestSnapshots.map((snapshot) => [snapshot.notePath, snapshot] as const),
  )
  const pendingFiles = scannedFiles
    .filter((file) => {
      if (file.readError) {
        return true
      }

      const latestSnapshot = latestSnapshotByPath.get(file.relativeFilePath)

      return !isCurrentSnapshotFresh(latestSnapshot, file.contentHash)
    })
    .sort((left, right) => {
      const leftSnapshot = latestSnapshotByPath.get(left.relativeFilePath)
      const rightSnapshot = latestSnapshotByPath.get(right.relativeFilePath)
      const leftAttemptAt = leftSnapshot?.ingestedAt ?? ''
      const rightAttemptAt = rightSnapshot?.ingestedAt ?? ''

      if (leftAttemptAt !== rightAttemptAt) {
        return leftAttemptAt.localeCompare(rightAttemptAt)
      }

      return left.relativeFilePath.localeCompare(right.relativeFilePath)
    })

  const filesToProcess = pendingFiles.slice(0, config.batchSize)

  for (const file of filesToProcess) {
    const { relativeFilePath, fileStats } = file

    try {
      if (file.readError) {
        throw new Error(file.readError)
      }

      if (file.rawMarkdown === null || file.contentHash === null) {
        throw new Error('knowledge_sync_missing_markdown_payload')
      }

      if (Buffer.byteLength(file.rawMarkdown, 'utf8') > config.maxNoteBytes) {
        await upsertKnowledgeNoteSnapshot(db, {
          notePath: relativeFilePath,
          noteTitle: extractNoteTitle(relativeFilePath, relativeFilePath),
          rootTag: normalizeRootTag(relativeFilePath),
          contentHash: createHash('sha256')
            .update(`${relativeFilePath}:too-large`)
            .digest('hex'),
          resolvedLinks: [],
          sanitizedMarkdown: '',
          summaryMarkdown: '',
          sourceUpdatedAt: fileStats.mtime,
          snapshotStatus: 'failed',
          lastError: 'knowledge_note_too_large',
        })
        continue
      }

      await upsertKnowledgeNoteSnapshot(db, {
        notePath: relativeFilePath,
        noteTitle: extractNoteTitle(relativeFilePath, file.sanitizedMarkdown),
        rootTag: normalizeRootTag(relativeFilePath),
        contentHash: file.contentHash,
        resolvedLinks: resolveWikiLinks(file.sanitizedMarkdown, relativeFilePath, vaultIndex),
        sanitizedMarkdown: file.sanitizedMarkdown,
        summaryMarkdown: summarizeForStorage(file.sanitizedMarkdown),
        sourceUpdatedAt: fileStats.mtime,
        snapshotStatus: 'fresh',
        lastError: null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      await upsertKnowledgeNoteSnapshot(db, {
        notePath: relativeFilePath,
        noteTitle: extractNoteTitle(relativeFilePath, relativeFilePath),
        rootTag: normalizeRootTag(relativeFilePath),
        contentHash: createHash('sha256')
          .update(`${relativeFilePath}:${message}`)
          .digest('hex'),
        resolvedLinks: [],
        sanitizedMarkdown: '',
        summaryMarkdown: '',
        sourceUpdatedAt: null,
        snapshotStatus: 'failed',
        lastError: message,
      })
    }
  }

  return filesToProcess.length
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadKnowledgeSyncConfig(process.env)
  const db = createDb(config.database)

  try {
    const processed = await runKnowledgeSyncOnce(db, config)
    console.info(`knowledge-sync processed ${processed} notes`)
  } finally {
    await db.destroy()
  }
}
