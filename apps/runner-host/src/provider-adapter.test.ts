import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type {
  RunnerArtifactResourceV1,
  RunnerContextPackResourceV1,
  RunnerExecutionBundleV1,
  TaskEnvelopeV2,
} from '@ai-dev-team/shared'

import {
  buildExecutionPrompt,
  prepareClaudeSkillBundleStage,
  prepareIsolatedCodexHome,
} from './provider-adapter.js'

function buildEnvelope(overrides: Partial<TaskEnvelopeV2> = {}) {
  const task: TaskEnvelopeV2 = {
    schemaVersion: 2,
    leaseId: 'lease-1',
    leaseAttemptId: 'attempt-1',
    issueId: 'issue-1',
    runId: 'run-1',
    workflowId: 'workflow-1',
    requestedProvider: 'codex',
    effectiveProvider: 'codex',
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: overrides.runKind === 'review' ? 'review_agent' : 'build_agent',
    runKind: overrides.runKind ?? 'build',
    repoSlug: 'test_repo',
    localCheckoutPath:
      '/tmp/ai-dev-team/reference_repos/test_repo',
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: '/tmp/phase7/worktrees/attempt-1',
    contextPackRef: 'ctx-pack-1',
    contextPackFingerprint: 'ctx-fingerprint-1',
    reviewedBuildArtifactId:
      overrides.runKind === 'review' ? 'artifact-build-1' : null,
    checkpointRef: null,
    executionSessionKey: 'session-1',
    mcpProfileRef: 'default',
    mcpBindingsSummary: [],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: 'agent-library://releases/v1/prompt-bundles/build_agent',
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: 'bundle-fingerprint-1',
    skillPackRefs: ['build_backend_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: ['serena', 'context7'],
    expectedOutputs: ['summary'],
    issuedAt: new Date().toISOString(),
    ...overrides,
  }

  const contextPack: RunnerContextPackResourceV1 = {
    schemaVersion: 1,
    contextPackId: 'ctx-pack-1',
    issueId: task.issueId,
    inputFingerprint: 'ctx-fingerprint-1',
    bundle: {
      issue: {
        issueId: task.issueId,
        goal: 'Exercise provider prompt contract',
        background: null,
        scope: ['phase7'],
        nonGoals: [],
        acceptanceCriteria: ['prompt includes contract details'],
        verificationPath: { automated: ['node --test'], manual: [] },
        doneWhen: ['prompt is explicit'],
        risk: null,
        dependencies: { blocks: [], blockedBy: [], external: [] },
        primaryRepo: 'test_repo',
        affectedRepos: [],
        docsLinks: [],
        openQuestions: [],
        issueType: null,
        source: null,
        mode: null,
        humanDecisionRequired: task.runKind === 'review',
      },
      repositories: [],
      latestRelevantComments: [],
      docsPack: [],
      repoGuidance: [],
      integrationArtifacts: [],
      decisionSummary: [],
      budgets: {
        contextPolicyVersion: 1,
        estimatedTokens: 128,
        maxTokens: 1024,
        commentCount: 0,
        noteCount: 0,
        truncatedSections: [],
      },
      sourceTrace: {
        issueContractSnapshotId: 'snapshot-1',
        issueContractSnapshotHash: 'snapshot-hash-1',
        mappingIds: [],
        noteSnapshotRefs: [],
        repoGuidanceRefs: [],
        commentRefs: [],
        artifactRefs: [],
        warnings: [],
      },
    },
    createdAt: new Date().toISOString(),
  }
  const reviewedBuildArtifact: RunnerArtifactResourceV1 | null =
    task.runKind === 'review'
      ? {
          schemaVersion: 1,
          artifactId: 'artifact-build-1',
          issueId: task.issueId,
          runId: task.runId,
          artifactType: 'runner_artifact_bundle',
          artifactUri: 'system://artifacts/build-bundle',
          artifactSummary: 'Build bundle',
          metadata: { source: 'build' },
          producedAt: new Date().toISOString(),
          supersededAt: null,
        }
      : null
  const executionBundle: RunnerExecutionBundleV1 = {
    schemaVersion: 1,
    leaseAttemptId: task.leaseAttemptId,
    agentLibraryReleaseId: 'v1',
    agentLibraryFingerprint: 'library-fingerprint-v1',
    taskInstructionsRef:
      task.taskInstructionsRef ??
      'agent-library://releases/v1/prompt-bundles/build_agent',
    promptVersion: task.promptVersion ?? 'v1',
    roleCharterRef:
      task.roleCharterRef ??
      'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: task.promptBundleFingerprint ?? 'bundle-fingerprint-1',
    resolvedPromptFamilyRefs: [
      `${task.runKind === 'review' ? 'review' : 'build'}/v1`,
      'global-baseline/v1',
    ],
    skillPackRefs: task.skillPackRefs,
    resolvedSkillRefs: ['S46'],
    skippedOptionalSkillRefs: ['S47'],
    systemInstruction: {
      roleId: task.agentRole,
      instructionVersion: 'v1',
      relativePath: `system-instructions/${task.agentRole}_system_instructions.md`,
      resolutionSource: 'working_tree_fallback',
      body: '# System instruction\nUse role-specific runtime rules before acting.',
    },
    roleCharter: {
      roleCharterRef:
        task.roleCharterRef ??
        'agent-library://releases/v1/role-charters/build_agent_backend',
      roleId: task.agentRole,
      charterVersion: 'v1',
      canonicalRunKind: task.runKind,
      frontmatterSummary: { owner_role: task.agentRole, run_kind: task.runKind },
      sourceRefs: ['role-charters/build_agent_backend.md'],
      relativePath: 'role-charters/build_agent_backend.md',
      roleFingerprint: 'role-fingerprint-1',
      body: '# Role charter\nDeliver precise execution.',
    },
    promptFamilies: [
      {
        promptFamilyRef: 'global-baseline/v1',
        familyId: 'global-baseline',
        familyVersion: 'v1',
        providerCompatibility: ['codex', 'claude'],
        compatibleRoles: [task.agentRole],
        compatibleSkillPacks: task.skillPackRefs,
        sourceRefs: ['config/agents/prompt-families/global-baseline/v1.md'],
        relativePath: 'config/agents/prompt-families/global-baseline/v1.md',
        familyFingerprint: 'family-fingerprint-global',
        body: '# Global baseline\nUse the repo as source of truth.',
      },
      {
        promptFamilyRef: `${task.runKind === 'review' ? 'review' : 'build'}/v1`,
        familyId: task.runKind === 'review' ? 'review' : 'build',
        familyVersion: 'v1',
        providerCompatibility: ['codex', 'claude'],
        compatibleRoles: [task.agentRole],
        compatibleSkillPacks: task.skillPackRefs,
        sourceRefs: ['config/agents/prompt-families/build/v1.md'],
        relativePath: 'config/agents/prompt-families/build/v1.md',
        familyFingerprint: 'family-fingerprint-role',
        body:
          task.runKind === 'review'
            ? '# Review family\nLead with findings.'
            : '# Build family\nKeep changes minimal.',
      },
    ],
    skillPacks: [
      {
        packId: 'build_backend_core',
        packVersion: 'v1',
        purpose: 'Backend implementation',
        skillRefs: ['S46'],
        optionalSkillRefs: ['S47'],
        providers: ['codex', 'claude'],
        activationConditions: { role: task.agentRole },
        promptFamilyRefs: ['build'],
        deniedActionsOverlay: [],
        humanGateOverlay: {},
        sourceRefs: ['config/agents/skill-packs/build_backend_core.yaml'],
        skillPackFingerprint: 'skill-pack-fingerprint-1',
      },
    ],
    runtimeRoleContract: {
      roleId: task.agentRole,
      canonicalRunKind: task.runKind,
      allowedStatusOwnership: ['coding'],
      requiredInputArtifactTypes: [],
      requiredOutputArtifactTypes: ['build_report'],
      humanGatePolicy: {
        mode: task.runKind === 'review' ? 'always' : 'conditional',
        requiredHumanOwnedZones: [],
        notes: null,
      },
      escalationReasonCodes: [],
      activationMode: 'active',
    },
    roleExecutionPolicy: {
      ownerRole: task.agentRole,
      primaryProvider: task.effectiveProvider,
      secondaryProvider: task.effectiveProvider,
      fallbackTriggers: [],
      maxProviderFailovers: 0,
      mcpProfileRef: 'default',
      requiredCapabilities: ['workspace_access'],
    },
  }

  return {
    schemaVersion: 1,
    runnerNodeId: 'runner-node-1',
    provider: 'codex',
    task,
    attempts: {
      worktreePath: '/tmp/phase7/worktrees/attempt-1',
      checkoutPath: '/tmp/phase7/checkouts/test_repo',
      providerStageRoot: '/tmp/phase7/providers/attempt-1',
    },
    executionSessionKey: task.executionSessionKey,
    contextPack,
    reviewedBuildArtifact,
    executionBundle,
    resolvedSkillDocs: [
      {
        skillRef: 'S46',
        absolutePath: '/tmp/managed-skills/S46/SKILL.md',
        markdown: '# Skill S46\nOnly this skill should be mounted.',
      },
    ],
  }
}

test('buildExecutionPrompt composes the resolved bundle for backend builds', () => {
  const prompt = buildExecutionPrompt('codex', buildEnvelope())

  assert.match(prompt, /Backend build execution contract/)
  const globalBaselineIndex = prompt.indexOf('## Prompt family global-baseline/v1')
  const buildFamilyIndex = prompt.indexOf('## Prompt family build/v1')
  assert.notEqual(globalBaselineIndex, -1)
  assert.notEqual(buildFamilyIndex, -1)
  assert.ok(globalBaselineIndex < buildFamilyIndex)
  assert.match(prompt, /System instruction build_agent/)
  assert.match(prompt, /Use role-specific runtime rules before acting/)
  assert.match(prompt, /Role charter agent-library:\/\/releases\/v1\/role-charters\/build_agent_backend/)
  assert.match(prompt, /Skill S46/)
  assert.match(prompt, /Repository checkout path: \/tmp\/phase7\/checkouts\/test_repo/)
  assert.match(prompt, /Source artifact ids: none/)
  assert.doesNotMatch(prompt, /Phase 7 live proof/)
})

test('buildExecutionPrompt declares the review contract and reviewed artifact id', () => {
  const prompt = buildExecutionPrompt(
    'claude',
    buildEnvelope({
      requestedProvider: 'claude',
      effectiveProvider: 'claude',
      runKind: 'review',
    }),
  )

  assert.match(prompt, /Review execution contract/)
  assert.match(prompt, /Do not modify files and do not run mutating shell commands/)
  assert.match(prompt, /Lead with findings/)
  assert.match(prompt, /Reviewed build artifact id: artifact-build-1/)
  assert.match(prompt, /Source artifact ids: artifact-build-1/)
})

test('prepareIsolatedCodexHome stages only the selected resolved skill docs', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-codex-home-test-'))
  const authHome = path.join(sandboxRoot, 'source-home')

  await mkdir(authHome, { recursive: true })
  await writeFile(path.join(authHome, 'auth.json'), '{"token":"test"}\n')

  const originalCodeHome = process.env.CODEX_HOME
  process.env.CODEX_HOME = authHome

  try {
    const isolatedHome = await prepareIsolatedCodexHome([
      {
        skillRef: 'skill-a',
        absolutePath: '/tmp/skill-a/SKILL.md',
        markdown: '# skill-a\n',
      },
    ])
    const copiedAuth = await readFile(
      path.join(isolatedHome.envOverrides.CODEX_HOME ?? '', 'auth.json'),
      'utf8',
    )
    const mountedSkill = await readFile(
      path.join(isolatedHome.envOverrides.CODEX_HOME ?? '', 'skills', 'skill-a', 'SKILL.md'),
      'utf8',
    )

    assert.match(copiedAuth, /token/)
    assert.match(mountedSkill, /skill-a/)

    await isolatedHome.cleanup()
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = originalCodeHome
    }

    await rm(sandboxRoot, { recursive: true, force: true })
  }
})

test('prepareClaudeSkillBundleStage creates a stable provider-local bundle path from resolved skills only', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-claude-skills-'))
  const providerStageRoot = path.join(sandboxRoot, 'provider-stage')

  try {
    const stagedBundlePath = await prepareClaudeSkillBundleStage(
      providerStageRoot,
      [
        {
          skillRef: 'skill-b',
          absolutePath: '/tmp/skill-b/SKILL.md',
          markdown: '# skill-b\n',
        },
      ],
    )

    assert.equal(stagedBundlePath, path.join(providerStageRoot, 'managed-skills'))
    const stagedSkill = await readFile(
      path.join(stagedBundlePath ?? '', 'skill-b', 'SKILL.md'),
      'utf8',
    )
    assert.match(stagedSkill, /skill-b/)
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
})
