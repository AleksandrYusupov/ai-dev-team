import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'

import type {
  AgentExecutionMetadataV2,
  AgentProvider,
  ArtifactBundleV2,
  McpBindingRefV1,
  RunnerArtifactResourceV1,
  RunnerContextPackResourceV1,
  RunnerExecutionBundleV1,
  ReviewDisposition,
  SharedJsonObject,
  TaskEnvelopeV2,
} from '@ai-dev-team/shared'

import type { RunnerHostAppConfig } from './config.js'
import type { ResolvedSkillBundle } from './skill-sync.js'
import {
  type PreparedAttemptPaths,
  stageLocalArtifact,
  writeJsonFile,
  readJsonFile,
} from './worktree.js'

export interface ProviderExecutionResult {
  status: 'completed' | 'failed' | 'canceled' | 'no_output'
  summary: string | null
  changedFiles: string[]
  testResults: SharedJsonObject[]
  patchRef: string | null
  branchRef: string | null
  reviewFindings: SharedJsonObject[]
  reviewDisposition: ReviewDisposition | null
  decisionSummary: string | null
  recommendedNextAction: string | null
  reviewedBuildArtifactId: string | null
  toolUsage: string[]
  providerExecutionMetadata: SharedJsonObject
  guardOutcomes: Record<string, boolean> | null
  stagedArtifacts: Awaited<ReturnType<typeof stageLocalArtifact>>[]
  producedAt: string
}

export interface ProviderResolvedSkillDocument {
  skillRef: string
  absolutePath: string
  markdown: string
}

export interface ProviderRunContext {
  config: RunnerHostAppConfig
  task: TaskEnvelopeV2
  attempts: PreparedAttemptPaths
  provider: AgentProvider | 'fake'
  skillBundle?: ResolvedSkillBundle | null
  executionBundle: RunnerExecutionBundleV1 | null
  resolvedSkillDocs: ProviderResolvedSkillDocument[]
  mcpBindingsSummary: McpBindingRefV1[]
  executionSessionKey: string
  cancelSignal: AbortSignal
  contextPack?: RunnerContextPackResourceV1 | null
  reviewedBuildArtifact?: RunnerArtifactResourceV1 | null
}

function signalProcessTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): boolean {
  if (typeof child.pid !== 'number') {
    return child.kill(signal)
  }

  try {
    return process.kill(-child.pid, signal)
  } catch {
    return child.kill(signal)
  }
}

export function resolveProviderCommand(
  config: RunnerHostAppConfig,
  provider: AgentProvider | 'fake',
): string | null {
  if (provider === 'fake') {
    return config.fakeProviderCommand
  }

  return config.commands[provider] ?? config.providerCliBins[provider] ?? null
}

function createProviderNotSupportedError(
  provider: AgentProvider,
): Error & { code: 'provider_not_supported'; provider: AgentProvider } {
  const error = new Error(`Provider ${provider} is not supported by this runner host`) as Error & {
    code: 'provider_not_supported'
    provider: AgentProvider
  }

  error.code = 'provider_not_supported'
  error.provider = provider

  return error
}

async function runShellWrapper(
  command: string,
  context: ProviderRunContext,
): Promise<ProviderExecutionResult> {
  const taskEnvelopePath = context.attempts.providerTaskFile
  const resultFilePath = context.attempts.providerResultFile
  const taskEnvelope = {
    schemaVersion: 1,
    runnerNodeId: context.config.runnerNodeId,
    provider: context.provider,
    task: context.task,
    attempts: context.attempts,
    executionSessionKey: context.executionSessionKey,
    contextPack: context.contextPack ?? null,
    reviewedBuildArtifact: context.reviewedBuildArtifact ?? null,
    executionBundle: context.executionBundle,
    resolvedSkillDocs: context.resolvedSkillDocs,
    mcpBindingsSummary: context.mcpBindingsSummary,
  }

  await writeJsonFile(taskEnvelopePath, taskEnvelope)

  const child = spawn('/bin/sh', ['-lc', command], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    env: {
      ...process.env,
      RUNNER_TASK_FILE: taskEnvelopePath,
      RUNNER_RESULT_FILE: resultFilePath,
      RUNNER_PROVIDER: context.provider,
      RUNNER_PROVIDER_NAME: String(context.provider),
      RUNNER_WORKTREE_PATH: context.attempts.worktreePath,
      RUNNER_WORKSPACE_PATH: context.attempts.checkoutPath,
      RUNNER_ARTIFACT_ROOT: context.attempts.artifactAttemptRoot,
      RUNNER_PROVIDER_STAGE_ROOT: context.attempts.providerStageRoot,
      RUNNER_EXECUTION_SESSION_KEY: context.executionSessionKey,
      RUNNER_MANAGED_SKILL_BUNDLE_PATH: context.skillBundle?.skillsRoot ?? '',
      RUNNER_MANAGED_SKILL_BUNDLE_RELEASE_ID: context.skillBundle?.releaseId ?? '',
      RUNNER_MANAGED_SKILL_BUNDLE_FINGERPRINT:
        context.skillBundle?.fingerprint ?? '',
      RUNNER_ISSUE_ID: context.task.issueId,
      RUNNER_LEASE_ID: context.task.leaseId,
      RUNNER_LEASE_ATTEMPT_ID: context.task.leaseAttemptId,
      RUNNER_REPO_SLUG: context.task.repoSlug ?? '',
      RUNNER_MCP_BINDINGS_JSON: JSON.stringify(context.mcpBindingsSummary),
    },
  })

  const stopHandler = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }

    const exitPromise = once(child, 'exit') as Promise<
      [number | null, NodeJS.Signals | null]
    >
    signalProcessTree(child, 'SIGTERM')

    const result = await Promise.race([
      exitPromise.then(() => 'exit' as const),
      sleep(5_000).then(() => 'timeout' as const),
    ])

    if (result === 'timeout' && child.exitCode === null && child.signalCode === null) {
      signalProcessTree(child, 'SIGKILL')
      await Promise.race([exitPromise, sleep(2_000)])
    }
  }
  const abortHandler = () => {
    void stopHandler()
  }

  if (context.cancelSignal.aborted) {
    await stopHandler()
  } else {
    context.cancelSignal.addEventListener('abort', abortHandler, { once: true })
  }

  const [exitCode, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]
  context.cancelSignal.removeEventListener('abort', abortHandler)

  const resultEnvelope = await readJsonFile<Partial<ProviderExecutionResult> & {
    status?: ProviderExecutionResult['status']
    producedAt?: string
  }>(resultFilePath).catch(() => null)

  const normalized: ProviderExecutionResult = resultEnvelope
    ? normalizeProviderResult(resultEnvelope, exitCode, signal)
    : {
        status:
          signal || context.cancelSignal.aborted
            ? 'canceled'
            : exitCode === 0
              ? 'no_output'
              : 'failed',
        summary: null,
        changedFiles: [],
        testResults: [],
        patchRef: null,
        branchRef: null,
        reviewFindings: [],
        reviewDisposition: null,
        decisionSummary: null,
        recommendedNextAction: null,
        reviewedBuildArtifactId: context.task.reviewedBuildArtifactId ?? null,
        guardOutcomes: null,
        toolUsage: [],
        providerExecutionMetadata: {
          command,
          exitCode,
          signal,
          wrapper: 'shell',
          taskEnvelopePath,
          resultFilePath,
        },
        stagedArtifacts: [],
        producedAt: new Date().toISOString(),
      }

  const withBuildChanges = await captureBuildChanges(context, normalized)
  return ensureExecutionArtifacts(context, withBuildChanges)
}

async function runGitCommand(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  const child = spawn('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })

  const [exitCode] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]

  return {
    ok: exitCode === 0,
    stdout,
  }
}

function parseChangedFiles(statusOutput: string): string[] {
  return statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 4)
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0)
}

async function captureBuildChanges(
  context: ProviderRunContext,
  result: ProviderExecutionResult,
): Promise<ProviderExecutionResult> {
  if (context.task.runKind !== 'build') {
    return result
  }

  const statusResult = await runGitCommand(context.attempts.worktreePath, [
    'status',
    '--porcelain',
  ]).catch(() => ({ ok: false, stdout: '' }))

  if (!statusResult.ok || statusResult.stdout.trim().length === 0) {
    return result
  }

  const changedFiles = Array.from(
    new Set([...result.changedFiles, ...parseChangedFiles(statusResult.stdout)]),
  )
  let patchRef = result.patchRef
  let stagedArtifacts = result.stagedArtifacts

  if (!patchRef) {
    const diffResult = await runGitCommand(context.attempts.worktreePath, [
      'diff',
      '--binary',
    ]).catch(() => ({ ok: false, stdout: '' }))

    if (diffResult.ok && diffResult.stdout.trim().length > 0) {
      const patchArtifact = await stageLocalArtifact(
        context.attempts.artifactAttemptRoot,
        `${context.task.leaseAttemptId}-build-diff`,
        diffResult.stdout,
        'text/x-diff',
      )
      patchRef = patchArtifact.uri
      stagedArtifacts = [...stagedArtifacts, patchArtifact]
    }
  }

  return {
    ...result,
    changedFiles,
    patchRef,
    stagedArtifacts,
    providerExecutionMetadata: {
      ...result.providerExecutionMetadata,
      gitStatusPreview: statusResult.stdout.slice(0, 4_000),
    },
  }
}

async function ensureExecutionArtifacts(
  context: ProviderRunContext,
  result: ProviderExecutionResult,
): Promise<ProviderExecutionResult> {
  if (result.stagedArtifacts.length > 0) {
    return result
  }

  const summaryLines = [
    `# ${String(context.provider)} runner execution report`,
    '',
    `- issueId: ${context.task.issueId}`,
    `- leaseAttemptId: ${context.task.leaseAttemptId}`,
    `- executionSessionKey: ${context.executionSessionKey}`,
    `- agentRole: ${context.task.agentRole}`,
    `- runKind: ${context.task.runKind ?? 'unknown'}`,
    `- status: ${result.status}`,
    `- producedAt: ${result.producedAt}`,
    '',
    '## Summary',
    result.summary ?? 'No textual summary was returned by the provider adapter.',
  ]
  const summaryArtifact = await stageLocalArtifact(
    context.attempts.artifactAttemptRoot,
    `${context.task.leaseAttemptId}-execution-report`,
    `${summaryLines.join('\n')}\n`,
    'text/markdown',
  )
  const metadataArtifact = await stageLocalArtifact(
    context.attempts.artifactAttemptRoot,
    `${context.task.leaseAttemptId}-execution-metadata`,
    JSON.stringify(
      {
        issueId: context.task.issueId,
        leaseId: context.task.leaseId,
        leaseAttemptId: context.task.leaseAttemptId,
        provider: context.provider,
        requestedProvider: context.task.requestedProvider,
        effectiveProvider: context.task.effectiveProvider,
        executionSessionKey: context.executionSessionKey,
        mcpBindingsSummary: context.mcpBindingsSummary,
        result,
      },
      null,
      2,
    ),
    'application/json',
  )

  return {
    ...result,
    patchRef: result.patchRef ?? summaryArtifact.uri,
    stagedArtifacts: [summaryArtifact, metadataArtifact],
    providerExecutionMetadata: {
      ...result.providerExecutionMetadata,
      generatedExecutionArtifacts: [
        summaryArtifact.uri,
        metadataArtifact.uri,
      ],
    },
  }
}

function normalizeProviderResult(
  result: Partial<ProviderExecutionResult> & {
    status?: ProviderExecutionResult['status']
    producedAt?: string
  },
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): ProviderExecutionResult {
  const status =
    result.status ??
    (signal ? 'canceled' : exitCode === 0 ? 'completed' : 'failed')

  return {
    status,
    summary: result.summary ?? null,
    changedFiles: result.changedFiles ?? [],
    testResults: result.testResults ?? [],
    patchRef: result.patchRef ?? null,
    branchRef: result.branchRef ?? null,
    reviewFindings: result.reviewFindings ?? [],
    reviewDisposition:
      result.reviewDisposition === 'human_gate_required' ||
      result.reviewDisposition === 'rework_recommended' ||
      result.reviewDisposition === 'review_inconclusive'
        ? result.reviewDisposition
        : null,
    decisionSummary: result.decisionSummary ?? null,
    recommendedNextAction: result.recommendedNextAction ?? null,
    reviewedBuildArtifactId: result.reviewedBuildArtifactId ?? null,
    toolUsage: result.toolUsage ?? [],
    providerExecutionMetadata: {
      ...(result.providerExecutionMetadata ?? {}),
      exitCode,
      signal,
      wrapper: 'shell',
    },
    guardOutcomes: isValidGuardOutcomes(result.guardOutcomes)
      ? result.guardOutcomes as Record<string, boolean>
      : null,
    stagedArtifacts: result.stagedArtifacts ?? [],
    producedAt: result.producedAt ?? new Date().toISOString(),
  }
}

function isValidGuardOutcomes(value: unknown): value is Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every((v) => typeof v === 'boolean')
}

async function runFakeProvider(
  context: ProviderRunContext,
): Promise<ProviderExecutionResult> {
  const summary = `Fake ${context.provider} execution for ${context.task.issueId}`
  const summaryArtifact = await stageLocalArtifact(
    context.attempts.artifactAttemptRoot,
    `${context.task.leaseAttemptId}-summary`,
    `${summary}\n`,
    'text/markdown',
  )
  const metadataArtifact = await stageLocalArtifact(
    context.attempts.artifactAttemptRoot,
    `${context.task.leaseAttemptId}-metadata`,
    JSON.stringify(
      {
        task: context.task,
        mcpBindingsSummary: context.mcpBindingsSummary,
        executionSessionKey: context.executionSessionKey,
      },
      null,
      2,
    ),
    'application/json',
  )

  return {
    status: 'completed',
    summary,
    changedFiles: context.task.repoSlug ? [`${context.task.repoSlug}/README.md`] : [],
    testResults: [{ name: 'fake-smoke', passed: true }],
    patchRef: summaryArtifact.uri,
    branchRef: null,
    reviewFindings: [],
    reviewDisposition:
      context.task.runKind === 'review' ? 'human_gate_required' : null,
    decisionSummary:
      context.task.runKind === 'review'
        ? `Review completed for ${context.task.issueId} and requires a human decision.`
        : null,
    recommendedNextAction:
      context.task.runKind === 'review'
        ? 'Review the findings and decide whether to return to coding.'
        : null,
    reviewedBuildArtifactId: context.task.reviewedBuildArtifactId ?? null,
    toolUsage: ['fake-provider', 'fake-mcp'],
    providerExecutionMetadata: {
      provider: context.provider,
      mode: 'fake',
      summaryArtifact: summaryArtifact.uri,
      metadataArtifact: metadataArtifact.uri,
    },
    guardOutcomes: null,
    stagedArtifacts: [summaryArtifact, metadataArtifact],
    producedAt: new Date().toISOString(),
  }
}

export async function executeProviderAttempt(
  context: ProviderRunContext,
): Promise<ProviderExecutionResult> {
  if (context.config.runtimeMode === 'fake' || context.provider === 'fake') {
    if (context.config.fakeProviderCommand) {
      return runShellWrapper(context.config.fakeProviderCommand, context)
    }

    return runFakeProvider(context)
  }

  const command = resolveProviderCommand(context.config, context.provider)

  if (!command) {
    throw createProviderNotSupportedError(context.provider)
  }

  return runShellWrapper(command, context)
}

export function buildExecutionMetadata(
  context: ProviderRunContext,
  result: ProviderExecutionResult,
  durationMs: number,
  completionReason: string,
): AgentExecutionMetadataV2 {
  return {
    schemaVersion: 2,
    agentRole: context.task.agentRole,
    promptVersion: context.task.promptVersion ?? 'legacy_synthetic',
    agentLibraryReleaseId: context.task.agentLibraryReleaseId,
    taskInstructionsRef: context.task.taskInstructionsRef,
    roleCharterRef: context.task.roleCharterRef,
    promptBundleFingerprint: context.task.promptBundleFingerprint,
    resolvedPromptFamilyRefs:
      context.executionBundle?.resolvedPromptFamilyRefs ?? [],
    skillPackRefs: context.task.skillPackRefs,
    resolvedSkillRefs: context.executionBundle?.resolvedSkillRefs ?? [],
    skippedOptionalSkillRefs:
      context.executionBundle?.skippedOptionalSkillRefs ?? [],
    effectiveSkillFingerprint: context.task.effectiveSkillFingerprint,
    contextPackFingerprint: context.task.contextPackFingerprint,
    reviewedBuildArtifactId: context.task.reviewedBuildArtifactId,
    configVersion: context.task.roleExecutionPolicyVersion,
    workflowId: context.task.workflowId,
    workflowRunId: context.task.runId,
    runKind: context.task.runKind,
    attemptNo: context.task.providerAttemptNo,
    requestedProvider: context.task.requestedProvider,
    effectiveProvider: context.task.effectiveProvider,
    providerAttemptNo: context.task.providerAttemptNo,
    fallbackFromProvider: context.task.fallbackFromProvider,
    fallbackReason: context.task.fallbackReason,
    toolsUsed: result.toolUsage,
    mcpBindings: context.mcpBindingsSummary,
    runnerNodeId: context.config.runnerNodeId,
    hostGroupId: context.config.hostGroupId,
    executionDurationMs: durationMs,
    completionReason,
  }
}

export function buildArtifactBundle(
  context: ProviderRunContext,
  result: ProviderExecutionResult,
): ArtifactBundleV2 {
  return {
    schemaVersion: 2,
    leaseId: context.task.leaseId,
    leaseAttemptId: context.task.leaseAttemptId,
    issueId: context.task.issueId,
    runId: context.task.runId,
    requestedProvider: context.task.requestedProvider,
    effectiveProvider: context.task.effectiveProvider,
    providerAttemptNo: context.task.providerAttemptNo,
    fallbackFromProvider: context.task.fallbackFromProvider,
    fallbackReason: context.task.fallbackReason,
    roleExecutionPolicyVersion: context.task.roleExecutionPolicyVersion,
    agentRole: context.task.agentRole,
    runKind: context.task.runKind,
    status: result.status,
    summary: result.summary,
    changedFiles: result.changedFiles,
    testResults: result.testResults,
    patchRef: result.patchRef,
    branchRef: result.branchRef,
    reviewFindings: result.reviewFindings,
    reviewDisposition:
      result.reviewDisposition ??
      (context.task.runKind === 'review' ? 'human_gate_required' : null),
    decisionSummary:
      result.decisionSummary ??
      (context.task.runKind === 'review'
        ? result.summary ?? 'Review completed and requires a human decision.'
        : null),
    recommendedNextAction:
      result.recommendedNextAction ??
      (context.task.runKind === 'review'
        ? 'Review the decision summary and choose whether to return to coding.'
        : null),
    reviewedBuildArtifactId:
      result.reviewedBuildArtifactId ?? context.task.reviewedBuildArtifactId,
    executionSessionKey: context.executionSessionKey,
    mcpProfileRef: context.task.mcpProfileRef,
    mcpBindingsSummary: context.mcpBindingsSummary,
    toolUsage: result.toolUsage,
    mcpBindings: context.mcpBindingsSummary,
    providerExecutionMetadata: {
      ...result.providerExecutionMetadata,
      stagedArtifacts: result.stagedArtifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        artifactPath: artifact.artifactPath,
        manifestPath: artifact.manifestPath,
        contentType: artifact.contentType,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        uri: artifact.uri,
      })),
      contextPackFingerprint: context.task.contextPackFingerprint,
      contextPackRef: context.task.contextPackRef,
      reviewedBuildArtifactId: context.task.reviewedBuildArtifactId ?? null,
      worktreePath: context.attempts.worktreePath,
      workspacePath: context.attempts.checkoutPath,
      providerStageRoot: context.attempts.providerStageRoot,
    },
    guardOutcomes: result.guardOutcomes,
    producedAt: result.producedAt,
  }
}
