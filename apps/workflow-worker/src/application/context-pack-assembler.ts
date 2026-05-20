/**
 * Assembles a ContextPack bundle from Linear issue content, repo resolution, and guidance files.
 * Computes an input fingerprint for idempotent caching via cacheContextPack().
 */

import { createHash } from 'node:crypto'

import type {
  ContextPack,
  ContextPackBudgets,
  ContextPackGuidanceEntry,
  ContextPackIssueSection,
  ContextPackRepositorySection,
  ContextPackSourceTrace,
} from '@ai-dev-team/shared'

import type { LinearIssueContent } from './linear-issue-fetcher.js'
import type { RepoResolutionResult } from './repo-resolver.js'

export interface AssembleContextPackInput {
  issueContent: LinearIssueContent
  repoResolution: RepoResolutionResult
  warnings: string[]
}

export interface AssembleContextPackResult {
  bundle: ContextPack
  inputFingerprint: string
  estimatedTokens: number
  sourceTrace: ContextPackSourceTrace
}

function computeSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function buildIssueSection(
  issueContent: LinearIssueContent,
  repoResolution: RepoResolutionResult,
): ContextPackIssueSection {
  return {
    issueId: issueContent.issueId,
    goal: issueContent.title,
    background: issueContent.description,
    scope: [],
    nonGoals: [],
    acceptanceCriteria: [],
    verificationPath: { automated: [], manual: [] },
    doneWhen: [],
    risk: null,
    dependencies: { blocks: [], blockedBy: [], external: [] },
    primaryRepo: repoResolution.primaryRepo ?? '',
    affectedRepos: repoResolution.affectedRepos,
    docsLinks: [],
    openQuestions: [],
    issueType: null,
    source: 'linear',
    mode: null,
    humanDecisionRequired: null,
  }
}

function buildRepositorySections(
  repoResolution: RepoResolutionResult,
): ContextPackRepositorySection[] {
  const sections: ContextPackRepositorySection[] = []

  if (repoResolution.primaryRepoEntry) {
    const entry = repoResolution.primaryRepoEntry
    sections.push({
      repoSlug: entry.repoSlug,
      githubOwner: entry.githubOwner,
      githubRepo: entry.githubRepo,
      defaultBranch: entry.defaultBranch,
      repoKind: 'monorepo',
      requiredChecks: [],
      environments: [],
      agentGuidanceScope: entry.agentGuidanceScope,
    })
  }

  return sections
}

function buildComments(issueContent: LinearIssueContent) {
  return issueContent.comments.map((c) => ({
    providerCommentId: c.id,
    classification: 'informational' as const,
    bodyMarkdown: c.body,
    containsAsk: false,
    sourceCreatedAt: c.createdAt,
    sourceUpdatedAt: null,
    authorActorType: 'human',
    authorActorId: c.userName ?? 'unknown',
  }))
}

function buildGuidanceEntries(
  repoResolution: RepoResolutionResult,
): ContextPackGuidanceEntry[] {
  return repoResolution.guidanceFiles.map((f) => ({
    repoSlug: f.repoSlug,
    filePath: f.filePath,
    contentHash: computeSha256(f.content),
    excerptMarkdown: f.content,
    truncated: false,
  }))
}

function buildBudgets(
  totalTokens: number,
  commentCount: number,
): ContextPackBudgets {
  return {
    contextPolicyVersion: 1,
    estimatedTokens: totalTokens,
    maxTokens: 100_000,
    commentCount,
    noteCount: 0,
    truncatedSections: [],
  }
}

function buildSourceTrace(
  repoResolution: RepoResolutionResult,
  issueContent: LinearIssueContent,
  warnings: string[],
): ContextPackSourceTrace {
  return {
    issueContractSnapshotId: '',
    issueContractSnapshotHash: '',
    mappingIds: [],
    noteSnapshotRefs: [],
    repoGuidanceRefs: repoResolution.guidanceFiles.map((f) => ({
      repoSlug: f.repoSlug,
      filePath: f.filePath,
      contentHash: computeSha256(f.content),
    })),
    commentRefs: issueContent.comments.map((c) => ({
      providerCommentId: c.id,
      sourceCreatedAt: c.createdAt,
      sourceUpdatedAt: null,
    })),
    artifactRefs: [],
    warnings,
  }
}

function computeInputFingerprint(
  issueContent: LinearIssueContent,
  repoResolution: RepoResolutionResult,
): string {
  const parts: string[] = [
    issueContent.issueId,
    issueContent.title,
    issueContent.description ?? '',
    issueContent.comments.map((c) => `${c.id}:${c.body}`).join('|'),
    repoResolution.primaryRepo ?? '',
    repoResolution.guidanceFiles.map((f) => `${f.repoSlug}/${f.filePath}:${computeSha256(f.content)}`).join('|'),
  ]

  return computeSha256(parts.join('\n'))
}

export function assembleContextPack(
  input: AssembleContextPackInput,
): AssembleContextPackResult {
  const { issueContent, repoResolution, warnings } = input

  const issueSection = buildIssueSection(issueContent, repoResolution)
  const repositorySections = buildRepositorySections(repoResolution)
  const comments = buildComments(issueContent)
  const guidanceEntries = buildGuidanceEntries(repoResolution)

  const allContent = [
    issueContent.title,
    issueContent.description ?? '',
    ...issueContent.comments.map((c) => c.body),
    ...repoResolution.guidanceFiles.map((f) => f.content),
  ].join('\n')

  const totalTokens = estimateTokens(allContent)

  const allWarnings = [...warnings, ...repoResolution.warnings]

  const sourceTrace = buildSourceTrace(repoResolution, issueContent, allWarnings)

  const bundle: ContextPack = {
    issue: issueSection,
    repositories: repositorySections,
    decisionSummary: [],
    latestRelevantComments: comments,
    docsPack: [],
    repoGuidance: guidanceEntries,
    budgets: buildBudgets(totalTokens, comments.length),
    sourceTrace,
  }

  const inputFingerprint = computeInputFingerprint(issueContent, repoResolution)

  return {
    bundle,
    inputFingerprint,
    estimatedTokens: totalTokens,
    sourceTrace,
  }
}
