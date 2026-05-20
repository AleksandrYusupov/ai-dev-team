import assert from 'node:assert/strict'
import test from 'node:test'

import type { RawEventInboxRecord } from '@ai-dev-team/db'
import {
  isSupportedGitHubEventType,
  isSupportedLinearEventType,
} from '@ai-dev-team/shared'

import {
  classifyLinearComment,
  containsAskDirective,
  resolveLinearReplayWindowValid,
} from './normalizers.js'

function buildRawEventInboxRecord(
  overrides?: Partial<RawEventInboxRecord>,
): RawEventInboxRecord {
  const receivedAt = new Date('2026-03-25T12:00:00.000Z')

  return {
    id: 'raw-event-1',
    provider: 'linear',
    providerEventType: 'Issue',
    providerAction: 'create',
    deliveryId: 'delivery-1',
    signatureStatus: 'verified',
    providerTimestamp: receivedAt,
    receivedAt,
    firstSeenAt: receivedAt,
    lastSeenAt: receivedAt,
    deliveryAttemptCount: 1,
    requestHeaders: {},
    rawBody: '{}',
    parsedPayload: {},
    replayWindowValid: null,
    canonicalEnvelope: null,
    processingStatus: 'received',
    processingAttemptCount: 0,
    processedAt: null,
    lastError: null,
    issueId: 'ISSUE-1',
    commentId: null,
    projectId: null,
    repositoryFullName: null,
    dedupeScope: 'provider_delivery_id',
    createdAt: receivedAt,
    ...overrides,
  }
}

test('supported event guards accept only the Phase 3 provider families', () => {
  assert.equal(isSupportedLinearEventType('Issue'), true)
  assert.equal(isSupportedLinearEventType('Cycle'), false)
  assert.equal(isSupportedGitHubEventType('workflow_run'), true)
  assert.equal(isSupportedGitHubEventType('check_suite'), false)
})

test('containsAskDirective ignores code blocks, quotes, and inline code', () => {
  assert.equal(containsAskDirective('@ask please continue'), true)
  assert.equal(containsAskDirective('`@ask` inside inline code'), false)
  assert.equal(containsAskDirective('> @ask quoted line'), false)
  assert.equal(
    containsAskDirective('```md\n@ask hidden in code fence\n```'),
    false,
  )
})

test('classifyLinearComment keeps prompt semantics for @ask comments', () => {
  const classification = classifyLinearComment({
    action: 'create',
    containsAsk: true,
    openOperatorQuestionId: 'question-1',
  })

  assert.deepEqual(classification, {
    commentClassification: 'prompt',
    classification: 'transition_candidate',
    triggerCandidate: 'human_comment_ask',
    answerValidationStatus: null,
  })
})

test('classifyLinearComment keeps answer candidates sync-only until validation exists', () => {
  const classification = classifyLinearComment({
    action: 'create',
    containsAsk: false,
    openOperatorQuestionId: 'question-1',
  })

  assert.deepEqual(classification, {
    commentClassification: 'answer_candidate',
    classification: 'sync_only',
    triggerCandidate: null,
    answerValidationStatus: 'not_evaluated',
  })
})

test('classifyLinearComment distinguishes informational and deleted comments', () => {
  assert.deepEqual(
    classifyLinearComment({
      action: 'update',
      containsAsk: false,
      openOperatorQuestionId: null,
    }),
    {
      commentClassification: 'informational',
      classification: 'sync_only',
      triggerCandidate: null,
      answerValidationStatus: null,
    },
  )

  assert.deepEqual(
    classifyLinearComment({
      action: 'remove',
      containsAsk: false,
      openOperatorQuestionId: 'question-1',
    }),
    {
      commentClassification: 'deleted',
      classification: 'sync_only',
      triggerCandidate: null,
      answerValidationStatus: null,
    },
  )
})

test('resolveLinearReplayWindowValid uses persisted values first and falls back for legacy rows', () => {
  assert.equal(
    resolveLinearReplayWindowValid(
      buildRawEventInboxRecord({ replayWindowValid: true }),
      60_000,
    ),
    true,
  )

  assert.equal(
    resolveLinearReplayWindowValid(
      buildRawEventInboxRecord({ replayWindowValid: false }),
      60_000,
    ),
    false,
  )

  assert.equal(
    resolveLinearReplayWindowValid(
      buildRawEventInboxRecord({
        replayWindowValid: null,
        providerTimestamp: new Date('2026-03-25T11:59:30.000Z'),
      }),
      60_000,
    ),
    true,
  )

  assert.equal(
    resolveLinearReplayWindowValid(
      buildRawEventInboxRecord({
        replayWindowValid: null,
        providerTimestamp: new Date('2026-03-25T11:57:00.000Z'),
      }),
      60_000,
    ),
    false,
  )
})
