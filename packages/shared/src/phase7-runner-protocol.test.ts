import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  ArtifactBundleV2,
  RunnerArtifactResourceV1,
  RunnerContextPackResourceV1,
  TaskEnvelopeV2,
} from './index.js'

test('phase 7 task envelopes carry frozen context and reviewed build linkage', () => {
  const task = {
    schemaVersion: 2,
    leaseId: 'lease-phase7-1',
    leaseAttemptId: 'attempt-phase7-1',
    issueId: 'ISSUE-PHASE7-1',
    runId: 'run-phase7-1',
    workflowId: 'issue:ISSUE-PHASE7-1',
    requestedProvider: 'claude',
    effectiveProvider: 'claude',
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'review_agent',
    runKind: 'review',
    repoSlug: 'test_repo',
    localCheckoutPath: '/tmp/ai-dev-team/reference_repos/test_repo',
    branchStrategy: 'issue-branch',
    worktreePathHint: '/tmp/worktrees/test_repo/ISSUE-PHASE7-1',
    contextPackRef: 'context-pack-1',
    contextPackFingerprint: 'ctx-phase7-test',
    reviewedBuildArtifactId: 'artifact-build-1',
    checkpointRef: null,
    executionSessionKey: 'session-phase7-1',
    mcpProfileRef: 'mcp-profile-1',
    mcpBindingsSummary: [],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: null,
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/review_agent',
    promptBundleFingerprint: 'prompt-bundle-fingerprint-1',
    skillPackRefs: ['review_quality_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: ['serena', 'context7', 'obsidian'],
    expectedOutputs: ['review_report', 'decision_summary'],
    issuedAt: '2026-03-27T10:00:00.000Z',
  } satisfies TaskEnvelopeV2

  assert.equal(task.runKind, 'review')
  assert.equal(task.repoSlug, 'test_repo')
  assert.equal(task.contextPackFingerprint, 'ctx-phase7-test')
  assert.equal(task.reviewedBuildArtifactId, 'artifact-build-1')
})

test('phase 7 artifact bundles expose review disposition and reviewed build evidence', () => {
  const bundle = {
    schemaVersion: 2,
    leaseId: 'lease-phase7-1',
    leaseAttemptId: 'attempt-phase7-1',
    issueId: 'ISSUE-PHASE7-1',
    runId: 'run-phase7-1',
    requestedProvider: 'claude',
    effectiveProvider: 'claude',
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'review_agent',
    status: 'completed',
    runKind: 'review',
    summary: 'Review completed and requires a human decision.',
    changedFiles: ['src/index.ts'],
    testResults: [{ name: 'typecheck', passed: true }],
    patchRef: 'artifact://blob/patch-1',
    branchRef: 'refs/heads/issue/ISSUE-PHASE7-1',
    reviewFindings: [
      {
        severity: 'medium',
        title: 'Human decision required',
        body: 'The implementation changed behavior and needs approval.',
        filePath: 'src/index.ts',
        line: 14,
        evidenceRef: 'artifact://blob/patch-1',
      },
    ],
    reviewDisposition: 'rework_recommended',
    decisionSummary: 'The change is coherent but should return to coding before merge.',
    recommendedNextAction: 'Return the issue to coding after the human decision.',
    reviewedBuildArtifactId: 'artifact-build-1',
    executionSessionKey: 'session-phase7-1',
    mcpProfileRef: 'mcp-profile-1',
    mcpBindingsSummary: [],
    toolUsage: ['claude'],
    mcpBindings: [],
    providerExecutionMetadata: {
      mode: 'integration-test',
      contextPackFingerprint: 'ctx-phase7-test',
      reviewedBuildArtifactId: 'artifact-build-1',
    },
    producedAt: '2026-03-27T10:05:00.000Z',
  } satisfies ArtifactBundleV2

  assert.equal(bundle.runKind, 'review')
  assert.equal(bundle.reviewDisposition, 'rework_recommended')
  assert.equal(bundle.decisionSummary.includes('return to coding'), true)
  assert.equal(bundle.reviewedBuildArtifactId, 'artifact-build-1')
})

test('phase 7 runner read resources expose bounded frozen inputs', () => {
  const contextPack = {
    schemaVersion: 1,
    contextPackId: 'context-pack-1',
    issueId: 'ISSUE-PHASE7-1',
    inputFingerprint: 'ctx-phase7-test',
    bundle: {
      issue: {
        issueId: 'ISSUE-PHASE7-1',
        goal: 'Close the Phase 7 loop.',
        background: 'protocol test',
        scope: ['Verify frozen inputs'],
        nonGoals: ['GitHub automation'],
        acceptanceCriteria: ['Contracts stay stable'],
        verificationPath: {
          automated: ['corepack pnpm test:phase7'],
          manual: [],
        },
        doneWhen: ['Assertions pass'],
        risk: 'medium',
        dependencies: {
          blocks: [],
          blockedBy: [],
          external: [],
        },
        primaryRepo: 'test_repo',
        affectedRepos: [],
        docsLinks: [],
        openQuestions: [],
        issueType: 'feature',
        source: 'founder',
        mode: 'autonomous',
        humanDecisionRequired: true,
      },
      repositories: [],
      decisionSummary: ['Phase 7 protocol test'],
      latestRelevantComments: [],
      docsPack: [],
      repoGuidance: [],
      budgets: {
        contextPolicyVersion: 1,
        estimatedTokens: 1200,
        maxTokens: 16000,
        commentCount: 0,
        noteCount: 0,
        truncatedSections: [],
      },
      sourceTrace: {
        issueContractSnapshotId: 'snapshot-1',
        issueContractSnapshotHash: 'snapshot-hash-1',
        mappingIds: ['mapping-1'],
        noteSnapshotRefs: [],
        repoGuidanceRefs: [],
        commentRefs: [],
        warnings: [],
      },
    },
    createdAt: '2026-03-27T10:00:00.000Z',
  } satisfies RunnerContextPackResourceV1

  const artifact = {
    schemaVersion: 1,
    artifactId: 'artifact-build-1',
    issueId: 'ISSUE-PHASE7-1',
    runId: 'run-phase7-1',
    artifactType: 'build_report',
    artifactUri: 'artifact://bundle/artifact-build-1',
    artifactSummary: 'Build report for the frozen Phase 7 context.',
    metadata: {
      runKind: 'build',
      branchRef: 'refs/heads/issue/ISSUE-PHASE7-1',
    },
    producedAt: '2026-03-27T10:02:00.000Z',
    supersededAt: null,
  } satisfies RunnerArtifactResourceV1

  assert.equal(contextPack.inputFingerprint, 'ctx-phase7-test')
  assert.equal(artifact.artifactType, 'build_report')
  assert.equal(artifact.metadata.runKind, 'build')
})
