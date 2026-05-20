import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  ContextPackComment,
  ContextPackIssueSection,
} from '@ai-dev-team/shared'

import {
  buildContextFingerprint,
  buildDecisionSummary,
  guidanceScopeExtras,
  selectRelevantCommentsForContextPack,
} from './knowledge.js'

function buildComment(input: {
  providerCommentId: string
  classification: ContextPackComment['classification']
  bodyMarkdown: string
}): ContextPackComment {
  return {
    providerCommentId: input.providerCommentId,
    classification: input.classification,
    bodyMarkdown: input.bodyMarkdown,
    containsAsk: false,
    sourceCreatedAt: '2026-03-26T10:00:00.000Z',
    sourceUpdatedAt: '2026-03-26T10:00:00.000Z',
    authorActorType: 'user',
    authorActorId: 'user-1',
  }
}

function buildIssue(): ContextPackIssueSection {
  return {
    issueId: 'ISSUE-1',
    goal: 'Close Phase 4',
    background: null,
    scope: ['Fix context pack assembly'],
    nonGoals: [],
    acceptanceCriteria: ['Context pack is deterministic'],
    verificationPath: {
      automated: ['corepack pnpm test'],
      manual: [],
    },
    doneWhen: ['Tests are green'],
    risk: 'medium',
    dependencies: {
      blocks: [],
      blockedBy: [],
      external: [],
    },
    primaryRepo: 'repo-primary',
    affectedRepos: [],
    docsLinks: [],
    openQuestions: [],
    issueType: 'feature',
    source: 'founder',
    mode: 'autonomous',
    humanDecisionRequired: false,
  }
}

test('selectRelevantCommentsForContextPack keeps only operator-significant comments in newest-first order', () => {
  const selected = selectRelevantCommentsForContextPack({
    comments: [
      buildComment({
        providerCommentId: 'comment-3',
        classification: 'answer_candidate',
        bodyMarkdown: 'Newest answer',
      }),
      buildComment({
        providerCommentId: 'comment-2',
        classification: 'informational',
        bodyMarkdown: 'Informational note',
      }),
      buildComment({
        providerCommentId: 'comment-1',
        classification: 'prompt',
        bodyMarkdown: 'Older prompt',
      }),
    ],
    maxComments: 10,
  })

  assert.deepEqual(
    selected.map((comment) => comment.providerCommentId),
    ['comment-3', 'comment-1'],
  )
})

test('selectRelevantCommentsForContextPack force-includes triggering comment without including deleted rows', () => {
  const selected = selectRelevantCommentsForContextPack({
    comments: [
      buildComment({
        providerCommentId: 'comment-4',
        classification: 'answer_candidate',
        bodyMarkdown: 'Newest answer',
      }),
      buildComment({
        providerCommentId: 'comment-3',
        classification: 'manual_override_candidate',
        bodyMarkdown: 'Override candidate',
      }),
      buildComment({
        providerCommentId: 'comment-2',
        classification: 'informational',
        bodyMarkdown: 'Trigger this',
      }),
      buildComment({
        providerCommentId: 'comment-1',
        classification: 'deleted',
        bodyMarkdown: 'Deleted comment',
      }),
    ],
    maxComments: 2,
    triggeringCommentId: 'comment-2',
  })

  assert.deepEqual(
    selected.map((comment) => comment.providerCommentId),
    ['comment-4', 'comment-2'],
  )
})

test('guidanceScopeExtras keeps only safe relative paths', () => {
  assert.deepEqual(
    guidanceScopeExtras(
      '., repo-root, docs/runbook.md, /tmp/secret.md, ../outside.md, team\\\\playbook.md, docs/../bad.md',
    ),
    ['docs/runbook.md', 'team/playbook.md'],
  )
})

test('buildDecisionSummary references the newest relevant comment', () => {
  const summary = buildDecisionSummary({
    issue: buildIssue(),
    comments: [
      buildComment({
        providerCommentId: 'comment-newest',
        classification: 'answer_candidate',
        bodyMarkdown: 'Newest relevant comment',
      }),
      buildComment({
        providerCommentId: 'comment-older',
        classification: 'prompt',
        bodyMarkdown: 'Older relevant comment',
      }),
    ],
  })

  assert.equal(summary.at(-1), 'Latest comment: Newest relevant comment')
})

test('buildContextFingerprint changes when sanitized integration artifact refs change', () => {
  const baseInput = {
    snapshot: {
      id: 'snapshot-1',
      issueId: 'ISSUE-1',
      snapshotHash: 'snapshot-hash-1',
      primaryRepo: 'repo-primary',
      affectedRepos: [],
      docsLinks: [],
      risk: null,
      dependencies: {
        blocks: [],
        blockedBy: [],
        external: [],
      },
      contractJson: buildIssue(),
      createdAt: '2026-03-26T10:00:00.000Z',
    },
    mappings: [],
    noteRefs: [],
    guidanceRefs: [],
    commentRefs: [],
  }

  const withoutArtifacts = buildContextFingerprint(baseInput)
  const withArtifacts = buildContextFingerprint({
    ...baseInput,
    artifactRefs: [
      {
        artifactId: 'artifact-1',
        artifactType: 'integration_brief',
        producedAt: '2026-03-26T10:05:00.000Z',
      },
    ],
  })

  assert.notEqual(withoutArtifacts, withArtifacts)
})
