import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { loadRunnerHostAppConfig } from './config.js'
import { buildAttemptPaths, cleanupAttemptPaths, prepareAttemptPaths } from './worktree.js'
import { executeProviderAttempt, buildArtifactBundle, buildExecutionMetadata } from './providers.js'

test('fake provider execution produces a deterministic artifact bundle', async () => {
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
  })
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-provider-'))
  const paths = buildAttemptPaths({
    workspaceRoot: path.join(sandboxRoot, 'workspace'),
    worktreeRoot: path.join(sandboxRoot, 'worktrees'),
    artifactRoot: path.join(sandboxRoot, 'artifacts'),
    runnerNodeId: config.runnerNodeId,
    repoSlug: 'acme/repo',
    leaseAttemptId: 'attempt-1',
  })

  const prepared = await prepareAttemptPaths(paths)
  const task = {
    schemaVersion: 2 as const,
    leaseId: 'lease-1',
    leaseAttemptId: 'attempt-1',
    issueId: 'issue-1',
    runId: 'run-1',
    workflowId: 'workflow-1',
    requestedProvider: 'codex' as const,
    effectiveProvider: 'codex' as const,
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'build_agent',
    runKind: 'build' as const,
    repoSlug: 'acme/repo',
    localCheckoutPath: paths.workspaceAttemptPath,
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: null,
    contextPackRef: null,
    contextPackFingerprint: null,
    reviewedBuildArtifactId: null,
    checkpointRef: null,
    executionSessionKey: 'session-1',
    mcpProfileRef: 'default',
    mcpBindingsSummary: [],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: 'instructions',
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: 'bundle-fingerprint-1',
    skillPackRefs: ['build_backend_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: config.toolBaseline,
    expectedOutputs: ['summary'],
    issuedAt: new Date().toISOString(),
  }

  const result = await executeProviderAttempt({
    config,
    task,
    attempts: prepared,
    provider: 'fake',
    executionBundle: null,
    resolvedSkillDocs: [],
    mcpBindingsSummary: [],
    executionSessionKey: task.executionSessionKey,
    cancelSignal: new AbortController().signal,
  })
  const bundle = buildArtifactBundle(
    {
      config,
      task,
      attempts: prepared,
      provider: 'fake',
      executionBundle: null,
      resolvedSkillDocs: [],
      mcpBindingsSummary: [],
      executionSessionKey: task.executionSessionKey,
      cancelSignal: new AbortController().signal,
    },
    result,
  )
  const metadata = buildExecutionMetadata(
    {
      config,
      task,
      attempts: prepared,
      provider: 'fake',
      executionBundle: null,
      resolvedSkillDocs: [],
      mcpBindingsSummary: [],
      executionSessionKey: task.executionSessionKey,
      cancelSignal: new AbortController().signal,
    },
    result,
    5,
    'completed',
  )

  assert.equal(result.status, 'completed')
  assert.equal(bundle.leaseAttemptId, 'attempt-1')
  assert.equal(metadata.completionReason, 'completed')
  assert.ok(result.stagedArtifacts.length >= 2)

  await cleanupAttemptPaths(prepared)
  await rm(sandboxRoot, { recursive: true, force: true })
})

test('shell provider wrapper reads task and writes result files', async () => {
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_FAKE_PROVIDER_COMMAND:
      "node -e \"const fs=require('node:fs'); const task=process.env.RUNNER_TASK_FILE; const result=process.env.RUNNER_RESULT_FILE; fs.writeFileSync(result, JSON.stringify({status:'completed',summary:'wrapped',changedFiles:['a.ts'],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['wrapper'],providerExecutionMetadata:{mode:'wrapper'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
  })
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-wrapper-'))
  const paths = buildAttemptPaths({
    workspaceRoot: path.join(sandboxRoot, 'workspace'),
    worktreeRoot: path.join(sandboxRoot, 'worktrees'),
    artifactRoot: path.join(sandboxRoot, 'artifacts'),
    runnerNodeId: config.runnerNodeId,
    repoSlug: 'acme/repo',
    leaseAttemptId: 'attempt-2',
  })

  const prepared = await prepareAttemptPaths(paths)
  const task = {
    schemaVersion: 2 as const,
    leaseId: 'lease-2',
    leaseAttemptId: 'attempt-2',
    issueId: 'issue-2',
    runId: 'run-2',
    workflowId: 'workflow-2',
    requestedProvider: 'codex' as const,
    effectiveProvider: 'codex' as const,
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'build_agent',
    runKind: 'build' as const,
    repoSlug: 'acme/repo',
    localCheckoutPath: paths.workspaceAttemptPath,
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: null,
    contextPackRef: null,
    contextPackFingerprint: null,
    reviewedBuildArtifactId: null,
    checkpointRef: null,
    executionSessionKey: 'session-2',
    mcpProfileRef: 'default',
    mcpBindingsSummary: [],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: 'instructions',
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: 'bundle-fingerprint-1',
    skillPackRefs: ['build_backend_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: config.toolBaseline,
    expectedOutputs: ['summary'],
    issuedAt: new Date().toISOString(),
  }

  const result = await executeProviderAttempt({
    config,
    task,
    attempts: prepared,
    provider: 'fake',
    executionBundle: null,
    resolvedSkillDocs: [],
    mcpBindingsSummary: [],
    executionSessionKey: task.executionSessionKey,
    cancelSignal: new AbortController().signal,
  })

  assert.equal(result.summary, 'wrapped')
  assert.deepEqual(result.changedFiles, ['a.ts'])
  assert.equal(result.toolUsage[0], 'wrapper')

  await cleanupAttemptPaths(prepared)
  await rm(sandboxRoot, { recursive: true, force: true })
})

test('shell provider wrapper honors abort signals with escalation', async () => {
  const config = loadRunnerHostAppConfig({
    RUNNER_RUNTIME_MODE: 'fake',
    RUNNER_FAKE_PROVIDER_COMMAND: 'node -e "setInterval(() => {}, 1000)"',
  })
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-cancel-'))
  const paths = buildAttemptPaths({
    workspaceRoot: path.join(sandboxRoot, 'workspace'),
    worktreeRoot: path.join(sandboxRoot, 'worktrees'),
    artifactRoot: path.join(sandboxRoot, 'artifacts'),
    runnerNodeId: config.runnerNodeId,
    repoSlug: 'acme/repo',
    leaseAttemptId: 'attempt-3',
  })

  const prepared = await prepareAttemptPaths(paths)
  const task = {
    schemaVersion: 2 as const,
    leaseId: 'lease-3',
    leaseAttemptId: 'attempt-3',
    issueId: 'issue-3',
    runId: 'run-3',
    workflowId: 'workflow-3',
    requestedProvider: 'codex' as const,
    effectiveProvider: 'codex' as const,
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'build_agent',
    runKind: 'build' as const,
    repoSlug: 'acme/repo',
    localCheckoutPath: prepared.checkoutPath,
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: prepared.worktreePath,
    contextPackRef: null,
    contextPackFingerprint: null,
    reviewedBuildArtifactId: null,
    checkpointRef: null,
    executionSessionKey: 'session-3',
    mcpProfileRef: 'default',
    mcpBindingsSummary: [],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: 'instructions',
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: 'bundle-fingerprint-1',
    skillPackRefs: ['build_backend_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: config.toolBaseline,
    expectedOutputs: ['summary'],
    issuedAt: new Date().toISOString(),
  }

  const abortController = new AbortController()
  setTimeout(() => abortController.abort(new Error('test abort')), 50)
  const result = await executeProviderAttempt({
    config,
    task,
    attempts: prepared,
    provider: 'fake',
    executionBundle: null,
    resolvedSkillDocs: [],
    mcpBindingsSummary: [],
    executionSessionKey: task.executionSessionKey,
    cancelSignal: abortController.signal,
  })

  assert.equal(result.status, 'canceled')

  await cleanupAttemptPaths(prepared)
  await rm(sandboxRoot, { recursive: true, force: true })
})

test('real provider execution falls back to provider cli bin when adapter command is absent', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-provider-bin-'))
  const config = loadRunnerHostAppConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    RUNNER_NODE_ID: 'runner-node',
    RUNNER_HOST_GROUP_ID: 'host-group',
    RUNNER_AUTH_TOKEN: 'runner-token',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_MCP_CONFIG_HASH: 'config-hash',
    RUNNER_PROVIDERS: 'codex',
    CODEX_COMMAND: '',
    CODEX_CLI_BIN:
      "node -e \"const fs=require('node:fs'); const result=process.env.RUNNER_RESULT_FILE; fs.writeFileSync(result, JSON.stringify({status:'completed',summary:'cli-bin',changedFiles:[],testResults:[],patchRef:null,branchRef:null,reviewFindings:[],toolUsage:['cli-bin'],providerExecutionMetadata:{mode:'bin'},stagedArtifacts:[],producedAt:new Date().toISOString()}));\"",
    CLAUDE_CODE_COMMAND: '',
    CLAUDE_CLI_BIN: '',
  })
  const paths = buildAttemptPaths({
    workspaceRoot: config.workspaceRoot,
    worktreeRoot: config.worktreeRoot,
    artifactRoot: config.artifactRoot,
    runnerNodeId: config.runnerNodeId,
    repoSlug: 'acme/repo',
    leaseAttemptId: 'attempt-bin',
  })
  const prepared = await prepareAttemptPaths(paths)
  const task = {
    schemaVersion: 2 as const,
    leaseId: 'lease-bin',
    leaseAttemptId: 'attempt-bin',
    issueId: 'issue-bin',
    runId: 'run-bin',
    workflowId: 'workflow-bin',
    requestedProvider: 'codex' as const,
    effectiveProvider: 'codex' as const,
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'build_agent',
    runKind: 'build' as const,
    repoSlug: 'acme/repo',
    localCheckoutPath: prepared.checkoutPath,
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: prepared.worktreePath,
    contextPackRef: null,
    contextPackFingerprint: null,
    reviewedBuildArtifactId: null,
    checkpointRef: null,
    executionSessionKey: 'session-bin',
    mcpProfileRef: 'default',
    mcpBindingsSummary: [],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: 'instructions',
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: 'bundle-fingerprint-1',
    skillPackRefs: ['build_backend_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: config.toolBaseline,
    expectedOutputs: ['summary'],
    issuedAt: new Date().toISOString(),
  }

  const result = await executeProviderAttempt({
    config,
    task,
    attempts: prepared,
    provider: 'codex',
    executionBundle: null,
    resolvedSkillDocs: [],
    mcpBindingsSummary: [],
    executionSessionKey: task.executionSessionKey,
    cancelSignal: new AbortController().signal,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.summary, 'cli-bin')
  assert.equal(result.toolUsage[0], 'cli-bin')

  await cleanupAttemptPaths(prepared)
  await rm(sandboxRoot, { recursive: true, force: true })
})

test('real provider execution fails fast when no provider command is available', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'runner-host-provider-missing-'))
  const config = loadRunnerHostAppConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    RUNNER_NODE_ID: 'runner-node',
    RUNNER_HOST_GROUP_ID: 'host-group',
    RUNNER_AUTH_TOKEN: 'runner-token',
    RUNNER_WORKSPACE_ROOT: path.join(sandboxRoot, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(sandboxRoot, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(sandboxRoot, 'artifacts'),
    RUNNER_MCP_CONFIG_HASH: 'config-hash',
    RUNNER_PROVIDERS: 'codex',
    CODEX_COMMAND: '',
    CODEX_CLI_BIN: '',
    CLAUDE_CODE_COMMAND: '',
    CLAUDE_CLI_BIN: '',
  })
  const paths = buildAttemptPaths({
    workspaceRoot: config.workspaceRoot,
    worktreeRoot: config.worktreeRoot,
    artifactRoot: config.artifactRoot,
    runnerNodeId: config.runnerNodeId,
    repoSlug: 'acme/repo',
    leaseAttemptId: 'attempt-missing',
  })
  const prepared = await prepareAttemptPaths(paths)
  const task = {
    schemaVersion: 2 as const,
    leaseId: 'lease-missing',
    leaseAttemptId: 'attempt-missing',
    issueId: 'issue-missing',
    runId: 'run-missing',
    workflowId: 'workflow-missing',
    requestedProvider: 'codex' as const,
    effectiveProvider: 'codex' as const,
    providerAttemptNo: 1,
    fallbackFromProvider: null,
    fallbackReason: null,
    roleExecutionPolicyVersion: 1,
    agentRole: 'build_agent',
    runKind: 'build' as const,
    repoSlug: 'acme/repo',
    localCheckoutPath: prepared.checkoutPath,
    branchStrategy: 'issue-scoped-worktree',
    worktreePathHint: prepared.worktreePath,
    contextPackRef: null,
    contextPackFingerprint: null,
    reviewedBuildArtifactId: null,
    checkpointRef: null,
    executionSessionKey: 'session-missing',
    mcpProfileRef: 'default',
    mcpBindingsSummary: [],
    agentLibraryReleaseId: 'v1',
    taskInstructionsRef: 'instructions',
    promptVersion: 'v1',
    roleCharterRef: 'agent-library://releases/v1/role-charters/build_agent_backend',
    promptBundleFingerprint: 'bundle-fingerprint-1',
    skillPackRefs: ['build_backend_core'],
    effectiveSkillFingerprint: 'effective-skill-fingerprint-1',
    toolBaseline: config.toolBaseline,
    expectedOutputs: ['summary'],
    issuedAt: new Date().toISOString(),
  }

  await assert.rejects(
    executeProviderAttempt({
      config,
      task,
      attempts: prepared,
      provider: 'codex',
      executionBundle: null,
      resolvedSkillDocs: [],
      mcpBindingsSummary: [],
      executionSessionKey: task.executionSessionKey,
      cancelSignal: new AbortController().signal,
    }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'provider_not_supported',
  )

  await cleanupAttemptPaths(prepared)
  await rm(sandboxRoot, { recursive: true, force: true })
})
