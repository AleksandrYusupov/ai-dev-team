import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { ControlApiConfig } from '@ai-dev-team/config'
import type { DbClient } from '@ai-dev-team/db'
import {
  cacheContextPack,
  getActiveContextPackCache,
  getLatestIntegrationContextArtifacts,
  getLatestIssueContractSnapshot,
  getLatestIssueProjectId,
  getLatestKnowledgeNoteSnapshotStatuses,
  getLatestKnowledgeNoteSnapshots,
  getLatestRelevantComments,
  getProjectRepositoryMappings,
  getRepositoryRegistryRecord,
  getRepositoryRegistryRecords,
} from '@ai-dev-team/db'
import {
  CONTEXT_POLICY_VERSION,
} from '@ai-dev-team/shared'
import type {
  ContextPack,
  ContextPackBudgets,
  ContextPackComment,
  ContextPackGuidanceEntry,
  ContextPackIssueSection,
  ContextPackNote,
  ContextPackRepositorySection,
  ContextPackSourceTrace,
  ContextPackSourceTraceArtifactRef,
  ContextPackSourceTraceGuidanceRef,
  ContextPackSourceTraceNoteRef,
  ContextPackSourceTraceCommentRef,
  IssueContractSnapshot,
  Phase4ErrorCode,
  ProjectRepositoryMapping,
  ProjectRepositoryMappingView,
  RepositoryRegistryRecord,
} from '@ai-dev-team/shared'

const NOTE_EXCERPT_LIMIT = 1_200
const GUIDANCE_EXCERPT_LIMIT = 1_200
const DECISION_SUMMARY_ITEM_LIMIT = 240
const CONTEXT_PACK_COMMENT_FETCH_MULTIPLIER = 5
const CONTEXT_PACK_COMMENT_FETCH_MIN = 25
const RELEVANT_CONTEXT_COMMENT_CLASSIFICATIONS: ReadonlySet<
  ContextPackComment['classification']
> = new Set([
  'prompt',
  'answer_candidate',
  'manual_override_candidate',
])
const GUIDANCE_FILES = [
  'AGENTS.md',
  'PLAN.md',
  'TESTPLAN.md',
  'ENVIRONMENT.md',
  'RELEASE.md',
] as const

class KnowledgeRouteError extends Error {
  readonly code: Phase4ErrorCode
  readonly statusCode: number

  constructor(statusCode: number, code: Phase4ErrorCode, message: string) {
    super(message)
    this.name = 'KnowledgeRouteError'
    this.code = code
    this.statusCode = statusCode
  }
}

export interface KnowledgeReadRepository {
  getRepository(repoSlug: string): Promise<RepositoryRegistryRecord | null>
  getProjectRepositoryMapping(
    projectId: string,
  ): Promise<ProjectRepositoryMappingView>
  getContextPack(issueId: string): Promise<ContextPack>
}

function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function estimateTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4)
}

function normalizeNotePath(notePath: string): string {
  const trimmed = notePath.trim()
  const withoutWiki = trimmed.startsWith('[[') && trimmed.endsWith(']]')
    ? trimmed.slice(2, -2)
    : trimmed
  const withoutAlias = withoutWiki.split('|')[0]?.trim() ?? ''
  const normalized = withoutAlias.replace(/\\/g, '/').replace(/^\/+/, '')

  return normalized.endsWith('.md') ? normalized : `${normalized}.md`
}

function uniqueOrdered(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue
    }

    seen.add(value)
    result.push(value)
  }

  return result
}

function truncateText(
  value: string,
  limit: number,
): { text: string; truncated: boolean } {
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false,
    }
  }

  return {
    text: `${value.slice(0, limit).trimEnd()}\n...[truncated]`,
    truncated: true,
  }
}

export function buildDecisionSummary(input: {
  issue: ContextPackIssueSection
  comments: readonly ContextPackComment[]
}): string[] {
  const summary = [
    `Goal: ${input.issue.goal}`,
    `Scope: ${input.issue.scope.join('; ') || 'n/a'}`,
    `Acceptance: ${input.issue.acceptanceCriteria.join('; ') || 'n/a'}`,
    `Verification: ${[
      ...input.issue.verificationPath.automated,
      ...input.issue.verificationPath.manual,
    ].join('; ') || 'n/a'}`,
  ]

  const latestComment = input.comments[0]

  if (latestComment) {
    summary.push(
      `Latest comment: ${truncateText(
        latestComment.bodyMarkdown,
        DECISION_SUMMARY_ITEM_LIMIT,
      ).text.replace(/\s+/g, ' ')}`,
    )
  }

  return summary
}

function validateIssueSection(issue: ContextPackIssueSection): void {
  const verificationSteps = [
    ...issue.verificationPath.automated,
    ...issue.verificationPath.manual,
  ]

  if (
    issue.goal.trim().length === 0 ||
    issue.scope.length === 0 ||
    issue.acceptanceCriteria.length === 0 ||
    verificationSteps.length === 0 ||
    issue.doneWhen.length === 0
  ) {
    throw new KnowledgeRouteError(
      422,
      'issue_contract_incomplete',
      'Issue contract is missing required summary fields',
    )
  }
}

function noteAllowlistRoots(
  repositories: readonly RepositoryRegistryRecord[],
): Set<string> {
  const roots = new Set<string>(['ai_dev_team', 'helpers'])

  for (const repository of repositories) {
    const normalized = normalizeNotePath(repository.obsidianRootNote)
    const root = normalized.split('/')[0]

    if (root) {
      roots.add(root)
    }
  }

  return roots
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath)

  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  )
}

function normalizeGuidanceScopeEntry(entry: string): string | null {
  const trimmed = entry.trim()

  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === 'repo-root' ||
    path.isAbsolute(trimmed)
  ) {
    return null
  }

  const normalized = trimmed.replace(/\\/g, '/')
  const segments = normalized.split('/').filter((segment) => segment.length > 0)

  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return null
  }

  return segments.join('/')
}

export function guidanceScopeExtras(scope: string): string[] {
  return uniqueOrdered(
    scope
      .split(',')
      .map((entry) => normalizeGuidanceScopeEntry(entry))
      .filter((entry): entry is string => entry !== null),
  )
}

export function selectRelevantCommentsForContextPack(input: {
  comments: readonly ContextPackComment[]
  maxComments: number
  triggeringCommentId?: string | null
}): ContextPackComment[] {
  const selectedCommentIds = new Set<string>()

  for (const comment of input.comments) {
    if (comment.classification === 'deleted') {
      continue
    }

    if (!RELEVANT_CONTEXT_COMMENT_CLASSIFICATIONS.has(comment.classification)) {
      continue
    }

    selectedCommentIds.add(comment.providerCommentId)
  }

  if (input.triggeringCommentId) {
    selectedCommentIds.add(input.triggeringCommentId)
  }

  const filtered = input.comments
    .filter((comment) => comment.classification !== 'deleted')
    .filter((comment) => selectedCommentIds.has(comment.providerCommentId))

  const capped = filtered.slice(0, input.maxComments)

  if (
    input.triggeringCommentId &&
    !capped.some(
      (comment) => comment.providerCommentId === input.triggeringCommentId,
    )
  ) {
    const triggeringComment = filtered.find(
      (comment) => comment.providerCommentId === input.triggeringCommentId,
    )

    if (triggeringComment) {
      return [...capped.slice(0, Math.max(0, input.maxComments - 1)), triggeringComment]
    }
  }

  return capped
}

function resolveProjectMapping(
  mappings: readonly ProjectRepositoryMapping[],
  explicitPrimaryRepo: string | null,
  explicitAffectedRepos: readonly string[],
): ProjectRepositoryMappingView {
  const primaryMappings = mappings.filter(
    (mapping) => mapping.mappingRole === 'primary',
  )

  if (!explicitPrimaryRepo) {
    if (primaryMappings.length === 0) {
      throw new KnowledgeRouteError(
        404,
        'project_repository_mapping_not_found',
        'No primary repository mapping found for project',
      )
    }

    if (primaryMappings.length > 1) {
      throw new KnowledgeRouteError(
        409,
        'project_repository_mapping_ambiguous',
        'Multiple primary repository mappings found for project',
      )
    }
  }

  const primaryRepo = explicitPrimaryRepo ?? primaryMappings[0]?.repoSlug

  if (!primaryRepo) {
    throw new KnowledgeRouteError(
      404,
      'project_repository_mapping_not_found',
      'No primary repository could be resolved',
    )
  }

  const affectedRepos =
    explicitAffectedRepos.length > 0
      ? uniqueOrdered(explicitAffectedRepos.filter((repoSlug) => repoSlug !== primaryRepo))
      : uniqueOrdered(
          mappings
            .filter((mapping) => mapping.mappingRole === 'affected')
            .sort((left, right) => left.priorityOrder - right.priorityOrder)
            .map((mapping) => mapping.repoSlug)
            .filter((repoSlug) => repoSlug !== primaryRepo),
        )

  return {
    linearProjectId:
      mappings[0]?.linearProjectId ??
      'unknown-project',
    primaryRepo,
    affectedRepos,
    mappings: [...mappings].sort((left, right) => {
      if (left.mappingRole === right.mappingRole) {
        return left.priorityOrder - right.priorityOrder
      }

      return left.mappingRole === 'primary' ? -1 : 1
    }),
  }
}

async function buildRepoGuidance(
  repositories: readonly RepositoryRegistryRecord[],
): Promise<{
  entries: ContextPackGuidanceEntry[]
  refs: ContextPackSourceTraceGuidanceRef[]
  warnings: string[]
  truncated: boolean
}> {
  const entries: ContextPackGuidanceEntry[] = []
  const refs: ContextPackSourceTraceGuidanceRef[] = []
  const warnings: string[] = []
  let truncated = false

  for (const repository of repositories) {
    if (!repository.localCheckoutPath) {
      warnings.push(`repo_guidance_missing_checkout_path:${repository.repoSlug}`)
      continue
    }

    const candidateFiles = uniqueOrdered([
      ...GUIDANCE_FILES,
      ...guidanceScopeExtras(repository.agentGuidanceScope),
    ])
    const scopeEntries = repository.agentGuidanceScope
      .split(',')
      .map((entry) => entry.trim())
      .filter(
        (entry) =>
          entry.length > 0 &&
          entry !== '.' &&
          entry !== 'repo-root' &&
          !candidateFiles.includes(entry.replace(/\\/g, '/')),
      )

    for (const invalidScopeEntry of scopeEntries) {
      warnings.push(
        `repo_guidance_invalid_scope_path:${repository.repoSlug}:${invalidScopeEntry}`,
      )
    }

    for (const relativeFilePath of candidateFiles) {
      const absoluteFilePath = path.resolve(
        repository.localCheckoutPath,
        relativeFilePath,
      )

      if (!isPathWithinRoot(repository.localCheckoutPath, absoluteFilePath)) {
        warnings.push(
          `repo_guidance_invalid_scope_path:${repository.repoSlug}:${relativeFilePath}`,
        )
        continue
      }

      try {
        const content = await readFile(absoluteFilePath, 'utf8')
        const excerpt = truncateText(content, GUIDANCE_EXCERPT_LIMIT)
        const contentHash = hashContent(content)

        entries.push({
          repoSlug: repository.repoSlug,
          filePath: absoluteFilePath,
          contentHash,
          excerptMarkdown: excerpt.text,
          truncated: excerpt.truncated,
        })
        refs.push({
          repoSlug: repository.repoSlug,
          filePath: absoluteFilePath,
          contentHash,
        })
        truncated ||= excerpt.truncated
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException

        if (nodeError.code !== 'ENOENT') {
          warnings.push(
            `repo_guidance_read_failed:${repository.repoSlug}:${relativeFilePath}`,
          )
        }
      }
    }
  }

  return {
    entries,
    refs,
    warnings,
    truncated,
  }
}

async function buildDocsPack(input: {
  db: DbClient
  primaryRepository: RepositoryRegistryRecord
  repositories: readonly RepositoryRegistryRecord[]
  docsLinks: readonly string[]
  maxNotes: number
}): Promise<{
  notes: ContextPackNote[]
  refs: ContextPackSourceTraceNoteRef[]
  warnings: string[]
  truncated: boolean
}> {
  const warnings: string[] = []
  let truncated = false

  const primaryRootNote = normalizeNotePath(input.primaryRepository.obsidianRootNote)
  const affectedRootNotes = input.repositories
    .filter((repository) => repository.repoSlug !== input.primaryRepository.repoSlug)
    .map((repository) => normalizeNotePath(repository.obsidianRootNote))
  const seedPaths = uniqueOrdered([
    ...input.docsLinks.map(normalizeNotePath),
    primaryRootNote,
    ...affectedRootNotes,
  ])
  const seedSnapshots = await getLatestKnowledgeNoteSnapshots(input.db, seedPaths)
  const seedLatestStatuses = await getLatestKnowledgeNoteSnapshotStatuses(
    input.db,
    seedPaths,
  )
  const seedMap = new Map(seedSnapshots.map((snapshot) => [snapshot.notePath, snapshot]))
  const seedLatestStatusMap = new Map(
    seedLatestStatuses.map((snapshot) => [snapshot.notePath, snapshot]),
  )

  if (!seedMap.has(primaryRootNote)) {
    const primaryLatestStatus = seedLatestStatusMap.get(primaryRootNote)

    if (primaryLatestStatus) {
      throw new KnowledgeRouteError(
        422,
        'knowledge_snapshot_stale',
        `Primary root note snapshot is ${primaryLatestStatus.snapshotStatus}`,
      )
    }

    throw new KnowledgeRouteError(
      422,
      'primary_repo_root_note_missing',
      `Missing required primary root note snapshot for ${primaryRootNote}`,
    )
  }

  const allowlistRoots = noteAllowlistRoots(input.repositories)
  const expansionSeedPaths: string[] = []

  for (const seedPath of seedPaths) {
    const snapshot = seedMap.get(seedPath)
    const latestStatus = seedLatestStatusMap.get(seedPath)

    if (!snapshot) {
      if (latestStatus) {
        warnings.push(
          `knowledge_snapshot_not_fresh:${seedPath}:${latestStatus.snapshotStatus}`,
        )
      } else {
        warnings.push(`knowledge_note_missing:${seedPath}`)
      }
      continue
    }

    if (latestStatus && latestStatus.snapshotStatus !== 'fresh') {
      warnings.push(
        `knowledge_snapshot_not_fresh:${seedPath}:${latestStatus.snapshotStatus}`,
      )
    }

    for (const resolvedLink of snapshot.resolvedLinks) {
      const normalizedLink = normalizeNotePath(resolvedLink)
      const root = normalizedLink.split('/')[0]

      if (root && allowlistRoots.has(root) && !seedPaths.includes(normalizedLink)) {
        expansionSeedPaths.push(normalizedLink)
      }
    }
  }

  const expandedPaths = uniqueOrdered(expansionSeedPaths)
  const expandedSnapshots = await getLatestKnowledgeNoteSnapshots(
    input.db,
    expandedPaths,
  )
  const expandedLatestStatuses = await getLatestKnowledgeNoteSnapshotStatuses(
    input.db,
    expandedPaths,
  )
  const expandedMap = new Map(
    expandedSnapshots.map((snapshot) => [snapshot.notePath, snapshot]),
  )
  const expandedLatestStatusMap = new Map(
    expandedLatestStatuses.map((snapshot) => [snapshot.notePath, snapshot]),
  )

  for (const expandedPath of expandedPaths) {
    const snapshot = expandedMap.get(expandedPath)
    const latestStatus = expandedLatestStatusMap.get(expandedPath)

    if (!snapshot) {
      if (latestStatus) {
        warnings.push(
          `knowledge_snapshot_not_fresh:${expandedPath}:${latestStatus.snapshotStatus}`,
        )
      } else {
        warnings.push(`knowledge_note_missing:${expandedPath}`)
      }
      continue
    }

    if (latestStatus && latestStatus.snapshotStatus !== 'fresh') {
      warnings.push(
        `knowledge_snapshot_not_fresh:${expandedPath}:${latestStatus.snapshotStatus}`,
      )
    }
  }

  const orderedSnapshots = [...seedPaths, ...expandedPaths]
    .map((notePath) => seedMap.get(notePath) ?? expandedMap.get(notePath))
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot))

  const cappedSnapshots = orderedSnapshots.slice(0, input.maxNotes)

  if (orderedSnapshots.length > input.maxNotes) {
    truncated = true
    warnings.push('docs_pack_capped_by_max_notes')
  }

  const notes = cappedSnapshots.map((snapshot) => {
    const excerpt = truncateText(snapshot.sanitizedMarkdown, NOTE_EXCERPT_LIMIT)
    truncated ||= excerpt.truncated

    return {
      notePath: snapshot.notePath,
      noteTitle: snapshot.noteTitle,
      contentHash: snapshot.contentHash,
      summaryMarkdown: snapshot.summaryMarkdown,
      excerptMarkdown: excerpt.text,
      truncated: excerpt.truncated,
      snapshotStatus: snapshot.snapshotStatus,
    }
  })

  const refs = cappedSnapshots.map<ContextPackSourceTraceNoteRef>((snapshot) => ({
    id: snapshot.id,
    notePath: snapshot.notePath,
    contentHash: snapshot.contentHash,
  }))

  return {
    notes,
    refs,
    warnings,
    truncated,
  }
}

export function buildContextFingerprint(input: {
  snapshot: Pick<IssueContractSnapshot, 'snapshotHash'>
  mappings: readonly ProjectRepositoryMapping[]
  noteRefs: readonly ContextPackSourceTraceNoteRef[]
  guidanceRefs: readonly ContextPackSourceTraceGuidanceRef[]
  commentRefs: readonly ContextPackSourceTraceCommentRef[]
  artifactRefs?: readonly ContextPackSourceTraceArtifactRef[]
}): string {
  return hashContent(
    JSON.stringify({
      issueContractSnapshotHash: input.snapshot.snapshotHash,
      mappingIds: input.mappings.map((mapping) => mapping.id),
      noteHashes: input.noteRefs.map((ref) => ref.contentHash),
      guidanceHashes: input.guidanceRefs.map((ref) => ref.contentHash),
      commentRefs: input.commentRefs,
      artifactRefs: (input.artifactRefs ?? []).map((ref) => ({
        artifactId: ref.artifactId,
        artifactType: ref.artifactType,
        producedAt: ref.producedAt,
      })),
      contextPolicyVersion: CONTEXT_POLICY_VERSION,
    }),
  )
}

export function createKnowledgeReadRepository(input: {
  db: DbClient
  config: ControlApiConfig
}): KnowledgeReadRepository {
  async function getProjectRepositoryMapping(
    projectId: string,
  ): Promise<ProjectRepositoryMappingView> {
    const mappings = await getProjectRepositoryMappings(input.db, projectId)

    return resolveProjectMapping(mappings, null, [])
  }

  async function getContextPack(issueId: string): Promise<ContextPack> {
    const snapshot = await getLatestIssueContractSnapshot(input.db, issueId)

    if (!snapshot) {
      throw new KnowledgeRouteError(
        404,
        'issue_contract_snapshot_not_found',
        `No issue contract snapshot found for ${issueId}`,
      )
    }

    const latestProjectId = await getLatestIssueProjectId(input.db, issueId)
    const mappings = latestProjectId
      ? await getProjectRepositoryMappings(input.db, latestProjectId)
      : []
    const mappingView = resolveProjectMapping(
      mappings,
      snapshot.primaryRepo,
      snapshot.affectedRepos,
    )
    const repositories = await getRepositoryRegistryRecords(input.db, [
      mappingView.primaryRepo,
      ...mappingView.affectedRepos,
    ])
    const repositoryMap = new Map(
      repositories.map((repository) => [repository.repoSlug, repository]),
    )
    const orderedRepositories = [mappingView.primaryRepo, ...mappingView.affectedRepos]
      .map((repoSlug) => repositoryMap.get(repoSlug))
      .filter((repository): repository is RepositoryRegistryRecord => {
        if (!repository) {
          throw new KnowledgeRouteError(
            404,
            'repository_registry_not_found',
            'Resolved repository is missing from repository registry',
          )
        }

        return true
      })
    const primaryRepository = orderedRepositories[0]

    const docsPack = await buildDocsPack({
      db: input.db,
      primaryRepository,
      repositories: orderedRepositories,
      docsLinks: snapshot.docsLinks,
      maxNotes: input.config.knowledge.contextPackMaxNotes,
    })
    const latestComments = selectRelevantCommentsForContextPack({
      comments: await getLatestRelevantComments(
        input.db,
        issueId,
        Math.max(
          input.config.knowledge.contextPackMaxComments *
            CONTEXT_PACK_COMMENT_FETCH_MULTIPLIER,
          CONTEXT_PACK_COMMENT_FETCH_MIN,
        ),
      ),
      maxComments: input.config.knowledge.contextPackMaxComments,
    })
    const repoGuidance = await buildRepoGuidance(orderedRepositories)
    const issueSection: ContextPackIssueSection = {
      issueId,
      goal: snapshot.contractJson.goal,
      background: snapshot.contractJson.background,
      scope: snapshot.contractJson.scope,
      nonGoals: snapshot.contractJson.nonGoals,
      acceptanceCriteria: snapshot.contractJson.acceptanceCriteria,
      verificationPath: snapshot.contractJson.verificationPath,
      doneWhen: snapshot.contractJson.doneWhen,
      risk: snapshot.contractJson.risk,
      dependencies: snapshot.contractJson.dependencies,
      primaryRepo: mappingView.primaryRepo,
      affectedRepos: mappingView.affectedRepos,
      docsLinks: snapshot.contractJson.docsLinks,
      openQuestions: snapshot.contractJson.openQuestions,
      issueType: snapshot.contractJson.issueType,
      source: snapshot.contractJson.source,
      mode: snapshot.contractJson.mode,
      humanDecisionRequired: snapshot.contractJson.humanDecisionRequired,
      providerName: snapshot.contractJson.providerName ?? null,
      integrationKind: snapshot.contractJson.integrationKind ?? null,
      authScheme: snapshot.contractJson.authScheme ?? null,
      requiredCredentials: snapshot.contractJson.requiredCredentials ?? [],
      secretSlots: snapshot.contractJson.secretSlots ?? [],
      requiredScopes: snapshot.contractJson.requiredScopes ?? [],
      oauthRedirectUris: snapshot.contractJson.oauthRedirectUris ?? [],
      sandboxAccountRequired:
        snapshot.contractJson.sandboxAccountRequired ?? null,
      webhookRequired: snapshot.contractJson.webhookRequired ?? null,
      webhookCallbackUrls: snapshot.contractJson.webhookCallbackUrls ?? [],
      rateLimitNotes: snapshot.contractJson.rateLimitNotes ?? null,
      errorModel: snapshot.contractJson.errorModel ?? [],
      testStrategy: snapshot.contractJson.testStrategy ?? [],
      goLiveChecklist: snapshot.contractJson.goLiveChecklist ?? [],
      rollbackPlan: snapshot.contractJson.rollbackPlan ?? [],
    }
    const repositoriesSection = orderedRepositories.map<ContextPackRepositorySection>(
      (repository) => ({
        repoSlug: repository.repoSlug,
        githubOwner: repository.githubOwner,
        githubRepo: repository.githubRepo,
        defaultBranch: repository.defaultBranch,
        repoKind: repository.repoKind,
        requiredChecks: repository.requiredChecks,
        environments: repository.environments,
        agentGuidanceScope: repository.agentGuidanceScope,
      }),
    )
    validateIssueSection(issueSection)
    const commentRefs = latestComments.map<ContextPackSourceTraceCommentRef>(
      (comment) => ({
        providerCommentId: comment.providerCommentId,
        sourceCreatedAt: comment.sourceCreatedAt,
        sourceUpdatedAt: comment.sourceUpdatedAt,
      }),
    )
    const warnings = [
      ...docsPack.warnings,
      ...repoGuidance.warnings,
    ]
    const truncatedSections: string[] = []

    if (docsPack.truncated) {
      truncatedSections.push('docs_pack')
    }

    if (repoGuidance.truncated) {
      truncatedSections.push('repo_guidance')
    }

    const integrationArtifacts = await getLatestIntegrationContextArtifacts(
      input.db,
      issueId,
    )
    const sourceTrace: ContextPackSourceTrace = {
      issueContractSnapshotId: snapshot.id,
      issueContractSnapshotHash: snapshot.snapshotHash,
      mappingIds: mappingView.mappings.map((mapping) => mapping.id),
      noteSnapshotRefs: docsPack.refs,
      repoGuidanceRefs: repoGuidance.refs,
      commentRefs,
      artifactRefs: integrationArtifacts.refs,
      warnings,
    }

    const budgets: ContextPackBudgets = {
      contextPolicyVersion: CONTEXT_POLICY_VERSION,
      estimatedTokens: 0,
      maxTokens: input.config.knowledge.contextPackMaxTokens,
      commentCount: latestComments.length,
      noteCount: docsPack.notes.length,
      truncatedSections,
    }
    const bundle: ContextPack = {
      issue: issueSection,
      repositories: repositoriesSection,
      decisionSummary: buildDecisionSummary({
        issue: issueSection,
        comments: latestComments,
      }),
      latestRelevantComments: latestComments,
      docsPack: docsPack.notes,
      repoGuidance: repoGuidance.entries,
      integrationArtifacts: integrationArtifacts.artifacts,
      budgets,
      sourceTrace,
    }
    const estimatedTokens = estimateTokens(bundle)
    const finalizedBundle: ContextPack = {
      ...bundle,
      budgets: {
        ...bundle.budgets,
        estimatedTokens,
      },
    }

    if (estimatedTokens > input.config.knowledge.contextPackMaxTokens) {
      throw new KnowledgeRouteError(
        422,
        'context_pack_budget_exceeded',
        `Context pack exceeds configured token budget (${estimatedTokens})`,
      )
    }

    const inputFingerprint = buildContextFingerprint({
      snapshot,
      mappings: mappingView.mappings,
      noteRefs: docsPack.refs,
      guidanceRefs: repoGuidance.refs,
      commentRefs,
      artifactRefs: integrationArtifacts.refs,
    })
    const cached = await getActiveContextPackCache(
      input.db,
      issueId,
      inputFingerprint,
    )

    if (cached) {
      return cached.bundleJson
    }

    await cacheContextPack(input.db, {
      issueId,
      inputFingerprint,
      bundleJson: finalizedBundle,
      estimatedTokens,
      sourceTraceJson: sourceTrace,
    })

    return finalizedBundle
  }

  return {
    getRepository: (repoSlug) => getRepositoryRegistryRecord(input.db, repoSlug),
    getProjectRepositoryMapping,
    getContextPack,
  }
}
