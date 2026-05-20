import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  McpBindingRefV1,
  RunnerArtifactResourceV1,
  RunnerContextPackResourceV1,
  RunnerExecutionBundleV1,
  TaskEnvelopeV2,
} from '@ai-dev-team/shared'

interface AdapterAttemptPaths {
  worktreePath: string
  checkoutPath: string
  providerStageRoot: string
}

interface RunnerTaskEnvelope {
  schemaVersion: number
  runnerNodeId: string
  provider: string
  task: TaskEnvelopeV2
  attempts: AdapterAttemptPaths
  executionSessionKey: string
  contextPack: RunnerContextPackResourceV1 | null
  reviewedBuildArtifact: RunnerArtifactResourceV1 | null
  executionBundle: RunnerExecutionBundleV1 | null
  resolvedSkillDocs: Array<{
    skillRef: string
    absolutePath: string
    markdown: string
  }>
  mcpBindingsSummary?: McpBindingRefV1[]
}

interface AdapterResultEnvelope {
  status: 'completed' | 'failed' | 'canceled' | 'no_output'
  summary: string | null
  changedFiles: string[]
  testResults: Array<{ name: string; passed: boolean }>
  patchRef: string | null
  branchRef: string | null
  reviewFindings: Array<Record<string, unknown>>
  reviewDisposition?: 'human_gate_required' | 'rework_recommended' | 'review_inconclusive' | null
  decisionSummary?: string | null
  recommendedNextAction?: string | null
  reviewedBuildArtifactId?: string | null
  toolUsage: string[]
  providerExecutionMetadata: Record<string, unknown>
  guardOutcomes?: Record<string, boolean> | null
  stagedArtifacts: unknown[]
  producedAt: string
}

interface CommandExecutionResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

interface PromptContractDetails {
  contractHeading: string
  executionRules: string[]
  sourceArtifactIds: string[]
  outputFraming: string[]
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value
}

const MCP_SERVER_ENV_VARS: Record<string, string[]> = {
  linear: ['LINEAR_API_TOKEN'],
  obsidian: ['KNOWLEDGE_SYNC_VAULT_ROOT'],
  context7: [],
  'sequential-thinking': [],
  postgres: ['DATABASE_URL'],
  github: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  filesystem: ['RUNNER_WORKSPACE_ROOT'],
  fetch: [],
  memory: [],
  git: [],
  serena: [],
  'secret-broker': ['INTERNAL_API_BEARER_TOKEN'],
  'oauth-broker': ['INTERNAL_API_BEARER_TOKEN'],
  'integration-lab': ['INTERNAL_API_BEARER_TOKEN'],
  'policy-guard': ['TOOLING_POLICY_PATH'],
}

function parseMcpCommandTemplate(commandTemplate: string): { command: string; args: string[] } {
  const parts = commandTemplate.trim().split(/\s+/)
  const command = parts[0]
  const args = parts.slice(1).map((arg) => {
    const envMatch = arg.match(/^\$\{(\w+)\}$/)

    if (envMatch) {
      return process.env[envMatch[1]] ?? ''
    }

    return arg
  })

  return { command, args }
}

function buildMcpConfigJson(
  bindings: McpBindingRefV1[] | undefined,
): string {
  if (!bindings || bindings.length === 0) {
    return '{"mcpServers":{}}'
  }

  const commandsJson = process.env.RUNNER_MCP_COMMANDS_JSON

  if (!commandsJson) {
    return '{"mcpServers":{}}'
  }

  let commandsByServer: Record<string, string>

  try {
    commandsByServer = JSON.parse(commandsJson) as Record<string, string>
  } catch {
    return '{"mcpServers":{}}'
  }

  const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {}

  for (const binding of bindings) {
    const commandTemplate = commandsByServer[binding.serverName]

    if (!commandTemplate) continue

    const { command, args } = parseMcpCommandTemplate(commandTemplate)
    const envVarNames = MCP_SERVER_ENV_VARS[binding.serverName] ?? []
    const env: Record<string, string> = {}

    for (const envVar of envVarNames) {
      const value = process.env[envVar]

      if (value) {
        env[envVar] = value
      }
    }

    mcpServers[binding.serverName] = Object.keys(env).length > 0
      ? { command, args, env }
      : { command, args }
  }

  return JSON.stringify({ mcpServers })
}

async function readTaskEnvelope(): Promise<RunnerTaskEnvelope> {
  const taskFile = requiredEnv('RUNNER_TASK_FILE')
  const raw = await readFile(taskFile, 'utf8')

  return JSON.parse(raw) as RunnerTaskEnvelope
}

async function writeResultFile(result: AdapterResultEnvelope): Promise<void> {
  const resultFile = requiredEnv('RUNNER_RESULT_FILE')
  await mkdir(path.dirname(resultFile), { recursive: true })
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`)
}

function resolveCodexAuthSourcePath(): string | null {
  const explicitHome = process.env.CODEX_HOME?.trim()

  if (explicitHome) {
    return path.join(explicitHome, 'auth.json')
  }

  const home = process.env.HOME?.trim()

  if (home) {
    return path.join(home, '.codex', 'auth.json')
  }

  return null
}

export async function prepareIsolatedCodexHome(
  resolvedSkillDocs: RunnerTaskEnvelope['resolvedSkillDocs'] = [],
  mcpBindings?: McpBindingRefV1[],
): Promise<{
  envOverrides: NodeJS.ProcessEnv
  cleanup: () => Promise<void>
}> {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'runner-codex-home-'))
  const codexHome = path.join(homeRoot, '.codex')
  await mkdir(codexHome, { recursive: true })

  const authSource = resolveCodexAuthSourcePath()

  if (authSource) {
    await copyFile(authSource, path.join(codexHome, 'auth.json')).catch(() => undefined)
  }

  if (resolvedSkillDocs.length > 0) {
    const targetSkillsRoot = path.join(codexHome, 'skills')

    for (const skillDoc of resolvedSkillDocs) {
      const skillRoot = path.join(targetSkillsRoot, skillDoc.skillRef)
      await mkdir(skillRoot, { recursive: true })
      await writeFile(path.join(skillRoot, 'SKILL.md'), skillDoc.markdown)
    }
  }

  if (mcpBindings && mcpBindings.length > 0) {
    const mcpConfig = buildMcpConfigJson(mcpBindings)
    await writeFile(path.join(codexHome, 'mcp.json'), mcpConfig)
  }

  return {
    envOverrides: {
      HOME: homeRoot,
      CODEX_HOME: codexHome,
    },
    cleanup: async () => {
      await rm(homeRoot, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

export async function prepareClaudeSkillBundleStage(
  providerStageRoot: string,
  resolvedSkillDocs: RunnerTaskEnvelope['resolvedSkillDocs'],
): Promise<string | null> {
  if (resolvedSkillDocs.length === 0) {
    return null
  }

  const stagedBundlePath = path.join(providerStageRoot, 'managed-skills')
  await rm(stagedBundlePath, { recursive: true, force: true }).catch(() => undefined)

  for (const skillDoc of resolvedSkillDocs) {
    const skillRoot = path.join(stagedBundlePath, skillDoc.skillRef)
    await mkdir(skillRoot, { recursive: true })
    await writeFile(path.join(skillRoot, 'SKILL.md'), skillDoc.markdown)
  }

  return stagedBundlePath
}

function truncateText(value: string | null | undefined, maxLength = 4_000): string | null {
  const normalized = value?.trim()

  if (!normalized) {
    return null
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized
}

function buildContextPackPreview(
  contextPack: RunnerContextPackResourceV1 | null,
): string[] {
  if (!contextPack) {
    return ['Frozen context pack: none']
  }

  return [
    `Frozen context pack id: ${contextPack.contextPackId}`,
    `Frozen context fingerprint: ${contextPack.inputFingerprint}`,
    'Frozen context pack bundle:',
    truncateText(JSON.stringify(contextPack.bundle, null, 2), 8_000) ?? '{}',
  ]
}

function buildReviewedArtifactPreview(
  artifact: RunnerArtifactResourceV1 | null,
): string[] {
  if (!artifact) {
    return ['Reviewed build artifact: none']
  }

  return [
    `Reviewed build artifact id: ${artifact.artifactId}`,
    `Reviewed build artifact type: ${artifact.artifactType}`,
    `Reviewed build artifact uri: ${artifact.artifactUri}`,
    'Reviewed build artifact metadata:',
    truncateText(JSON.stringify(artifact.metadata, null, 2), 8_000) ?? '{}',
  ]
}

function buildListSection(heading: string, lines: string[]): string[] {
  return [heading, ...(lines.length > 0 ? lines : ['(none)']), '']
}

function buildPromptBundleSections(envelope: RunnerTaskEnvelope): string[] {
  const bundle = envelope.executionBundle

  if (!bundle) {
    return ['## Resolved prompt bundle', '(missing execution bundle)', '']
  }

  const orderedPromptFamilies = [
    ...bundle.promptFamilies.filter((family) =>
      family.familyId === 'global-baseline' ||
      family.promptFamilyRef.startsWith('global-baseline'),
    ),
    ...bundle.promptFamilies.filter(
      (family) =>
        family.familyId !== 'global-baseline' &&
        !family.promptFamilyRef.startsWith('global-baseline'),
    ),
  ]

  const sections: string[] = [
    '## Resolved prompt bundle',
    `taskInstructionsRef: ${bundle.taskInstructionsRef}`,
    `roleCharterRef: ${bundle.roleCharterRef}`,
    `promptBundleFingerprint: ${bundle.promptBundleFingerprint}`,
    `resolvedPromptFamilyRefs: ${bundle.resolvedPromptFamilyRefs.join(', ') || 'none'}`,
    `skillPackRefs: ${bundle.skillPackRefs.join(', ') || 'none'}`,
    `resolvedSkillRefs: ${bundle.resolvedSkillRefs.join(', ') || 'none'}`,
    `skippedOptionalSkillRefs: ${bundle.skippedOptionalSkillRefs.join(', ') || 'none'}`,
    '',
  ]

  for (const promptFamily of orderedPromptFamilies) {
    sections.push(
      `## Prompt family ${promptFamily.promptFamilyRef}`,
      `familyVersion: ${promptFamily.familyVersion}`,
      promptFamily.body.trim(),
      '',
    )
  }

  if (bundle.systemInstruction) {
    sections.push(
      `## System instruction ${bundle.systemInstruction.roleId}`,
      `instructionVersion: ${bundle.systemInstruction.instructionVersion ?? 'unknown'}`,
      `relativePath: ${bundle.systemInstruction.relativePath}`,
      `resolutionSource: ${bundle.systemInstruction.resolutionSource}`,
      bundle.systemInstruction.body.trim(),
      '',
    )
  }

  sections.push(
    `## Role charter ${bundle.roleCharter.roleCharterRef}`,
    `charterVersion: ${bundle.roleCharter.charterVersion}`,
    `frontmatterSummary: ${JSON.stringify(bundle.roleCharter.frontmatterSummary, null, 2)}`,
    bundle.roleCharter.body.trim(),
    '',
  )

  return sections
}

function buildResolvedSkillSections(envelope: RunnerTaskEnvelope): string[] {
  if (envelope.resolvedSkillDocs.length === 0) {
    return ['## Selected local skill docs', '(none)', '']
  }

  const sections: string[] = ['## Selected local skill docs']

  for (const skillDoc of envelope.resolvedSkillDocs) {
    sections.push(
      `### Skill ${skillDoc.skillRef}`,
      `path: ${skillDoc.absolutePath}`,
      skillDoc.markdown.trim(),
      '',
    )
  }

  return sections
}

function buildRoleOverlay(
  envelope: RunnerTaskEnvelope,
): Pick<PromptContractDetails, 'contractHeading' | 'executionRules' | 'outputFraming'> {
  switch (envelope.task.agentRole) {
    case 'build_agent':
    case 'build_agent_backend':
      return {
        contractHeading: 'Backend build execution contract',
        executionRules: [
          'You may inspect and modify files inside the checked-out repository worktree.',
          'Keep the patch minimal, production-oriented, and constrained to the task scope.',
          'Preserve API, schema, and migration safety; call out any contract risk explicitly.',
        ],
        outputFraming: [
          'State what changed in the repository and what remains intentionally untouched.',
          'List concrete verification performed or explain exactly what could not be verified.',
        ],
      }
    case 'build_agent_integrations':
    case 'integration_agent':
      return {
        contractHeading: 'Integration execution contract',
        executionRules: [
          'Treat every secret, token, webhook, and OAuth flow as externally controlled state; never invent or simulate credentials.',
          'Respect the pinned network and broker capability envelope and surface any missing prerequisite explicitly.',
          'Keep integration-side effects documented and isolate vendor-specific assumptions.',
        ],
        outputFraming: [
          'Summarize vendor-facing assumptions, credential dependencies, and any remaining external blockers.',
          'Highlight exactly which integration paths were implemented, mocked, or left for human follow-up.',
        ],
      }
    case 'review_agent':
      return {
        contractHeading: 'Review execution contract',
        executionRules: [
          'Do not modify files and do not run mutating shell commands.',
          'Review findings must be evidence-based, severity-ordered, and tied to concrete code or artifact references.',
          'End with a human-decision-ready summary rather than implementation advice alone.',
        ],
        outputFraming: [
          'Lead with findings, then residual risks, then the recommended next step for the reviewer.',
        ],
      }
    case 'test_agent':
      return {
        contractHeading: 'Verification execution contract',
        executionRules: [
          'Prioritize reproducing behavior and validating existing changes before adding new code.',
          'If you touch code, keep it strictly in service of testability or deterministic verification.',
          'Separate observed failures from inferred root causes.',
        ],
        outputFraming: [
          'Report failing and passing checks distinctly, with command-level specificity when possible.',
        ],
      }
    case 'security_agent':
      return {
        contractHeading: 'Security review contract',
        executionRules: [
          'Operate as a high-signal security reviewer: no speculative findings, no cosmetic commentary.',
          'Focus on exploitability, exposure, and concrete mitigation paths.',
          'Treat secrets, auth, permissions, and data-boundary changes as top priority.',
        ],
        outputFraming: [
          'Classify findings by severity and explicitly state exploit preconditions.',
        ],
      }
    case 'docs_agent':
      return {
        contractHeading: 'Documentation execution contract',
        executionRules: [
          'Change only documentation, runbooks, or adjacent scaffolding needed to keep behavior descriptions accurate.',
          'Prefer updating existing source-of-truth documents over adding new parallel docs.',
          'Ensure operator-facing steps stay executable and concrete.',
        ],
        outputFraming: [
          'Summarize the documentation delta and any operational follow-ups still needed.',
        ],
      }
    case 'release_agent':
      return {
        contractHeading: 'Release execution contract',
        executionRules: [
          'Treat release actions as high-risk; preserve traceability for every deployment or packaging step.',
          'Do not hide skipped gates, missing approvals, or unverifiable rollout assumptions.',
          'Keep execution limited to release-critical surfaces.',
        ],
        outputFraming: [
          'State release readiness, blockers, rollback considerations, and next operator action.',
        ],
      }
    case 'monitoring_agent':
      return {
        contractHeading: 'Monitoring execution contract',
        executionRules: [
          'Focus on observability coverage, alert quality, and operational blind spots.',
          'Differentiate missing telemetry from missing validation of existing telemetry.',
          'Avoid broad architecture commentary unless it directly affects detection or response.',
        ],
        outputFraming: [
          'Report observability gaps, validated coverage, and the next highest-leverage instrumentation change.',
        ],
      }
    default:
      return {
        contractHeading:
          envelope.task.runKind === 'review'
            ? 'Review execution contract'
            : 'Build execution contract',
        executionRules:
          envelope.task.runKind === 'review'
            ? [
                'Do not modify files and do not run mutating shell commands.',
                'Use the frozen context pack and reviewed artifact as the authoritative review scope.',
              ]
            : [
                'You may inspect and modify files inside the checked-out repository worktree.',
                'Keep all changes scoped to the repository checkout for this lease attempt.',
              ],
        outputFraming: [
          'Return a concise execution report with outcome, concrete risks, and the next step.',
        ],
      }
  }
}

function buildPromptContractDetails(
  envelope: RunnerTaskEnvelope,
): PromptContractDetails {
  const overlay = buildRoleOverlay(envelope)
  const requiredCapabilities =
    envelope.executionBundle?.roleExecutionPolicy.requiredCapabilities ?? []
  const runtimeRoleContract = envelope.executionBundle?.runtimeRoleContract
  return {
    contractHeading: overlay.contractHeading,
    executionRules: [
      ...overlay.executionRules,
      `Canonical run kind: ${runtimeRoleContract?.canonicalRunKind ?? envelope.task.runKind ?? 'unknown'}`,
      `Allowed status ownership: ${runtimeRoleContract?.allowedStatusOwnership.join(', ') || 'none'}`,
      `Required input artifact types: ${runtimeRoleContract?.requiredInputArtifactTypes.join(', ') || 'none'}`,
      `Required output artifact types: ${runtimeRoleContract?.requiredOutputArtifactTypes.join(', ') || 'none'}`,
      `Human gate policy: ${runtimeRoleContract?.humanGatePolicy.mode ?? 'unknown'}`,
      `Required capabilities: ${requiredCapabilities.join(', ') || 'none'}`,
      `Expected outputs: ${envelope.task.expectedOutputs.join(', ') || 'none'}`,
    ],
    sourceArtifactIds: [
      envelope.reviewedBuildArtifact?.artifactId ??
        envelope.task.reviewedBuildArtifactId ??
        'none',
    ],
    outputFraming: overlay.outputFraming,
  }
}

function buildGuardOutcomeInstructions(agentRole: string): string[] {
  const header = [
    '## Guard Outcome Evaluation',
    '',
    'CRITICAL: You MUST evaluate the guards listed below and include the results in the `guardOutcomes` field of your result JSON.',
    'Each guard is a boolean. Set `true` if the condition is satisfied, `false` if not.',
    'The guard outcomes determine what happens next — which workflow status the issue transitions to.',
    '',
  ]

  const guardsByRole: Record<string, string[]> = {
    intake_agent: [
      'Guards for intake_agent (current status: triage):',
      '- `brief_valid`: Is the issue brief well-formed and actionable? (true if you can understand what is being requested)',
      '- `contract_incomplete`: Does the issue still need a full spec phase? (true = needs spec work, which is the usual case for free-form issues)',
      '- `contract_complete`: Is the issue contract already fully specified with goal, scope, acceptance_criteria, primary_repo? (mutually exclusive with contract_incomplete)',
      '- `primary_repo_resolved`: Has the target repository been identified from the issue context?',
      '- `blockers_inspected`: Have you checked for dependencies or blockers?',
      '- `critical_intake_fields_missing`: Are there critical fields you cannot determine without asking the human? (set true only if you truly cannot proceed)',
      '- `structured_question_prepared`: If you need human input, have you prepared a specific question in the summary? (required when routing to Needs Input)',
      '- `canonical_issue_identified`: Is this issue a duplicate of an existing one?',
      '',
      'Routing logic (the system uses your guards to decide):',
      '- brief_valid=true AND contract_incomplete=true → issue moves to Needs Spec (most common path)',
      '- contract_complete=true AND primary_repo_resolved=true AND blockers_inspected=true → issue moves to Planned (skips spec)',
      '- critical_intake_fields_missing=true AND structured_question_prepared=true → issue moves to Needs Input (human will be asked your question)',
      '- canonical_issue_identified=true → issue marked as Duplicate',
    ],
    spec_agent: [
      'Guards for spec_agent (current status: needs_spec):',
      '- `contract_complete`: Have all required contract fields been filled? (goal, scope, acceptance_criteria, primary_repo, verification_path)',
      '- `open_questions_resolved`: Are there any unresolved questions that would block planning? (true = no open questions, safe to proceed)',
      '- `missing_fields_identified`: Did you identify specific fields that are missing or unclear?',
      '- `structured_question_prepared`: If there are open questions, have you prepared a specific question for the human in the summary?',
      '',
      'Routing logic:',
      '- contract_complete=true AND open_questions_resolved=true → issue moves to Planned',
      '- missing_fields_identified=true AND structured_question_prepared=true → issue moves to Needs Input (human answers your question, then returns here)',
    ],
    plan_agent: [
      'Guards for plan_agent (current status: planned):',
      '- `plan_artifact_exists`: Have you created an execution plan with steps, dependencies, and ordering?',
      '- `dependency_report_clean_or_waived`: Are all dependencies resolved or explicitly waived?',
      '- `context_pack_frozen`: Is the context sufficient for a build agent to start execution?',
      '- `no_unresolved_blockers`: Are there no blocking issues preventing build?',
      '- `no_unresolved_secret_slots`: Are all required credentials/secrets available or explicitly not needed?',
      '- `integration_prerequisites_satisfied_or_not_required`: Are integration prerequisites met (or not applicable)?',
      '- `prod_access_gate_satisfied_or_not_required`: Is production access available if needed (or not applicable)?',
      '- `structured_question_prepared`: If you cannot proceed, have you prepared a specific question?',
      '- `integration_prerequisites_missing`: Are there missing integration prerequisites that require human action?',
      '- `planning_defect_classified`: Is there a fundamental defect in the approach that requires rework from scratch?',
      '- `block_reason_present`: Is there an external blocker that prevents proceeding?',
      '',
      'Routing logic:',
      '- All readiness guards true → issue moves to Ready for Build',
      '- structured_question_prepared=true AND integration_prerequisites_missing=true → Needs Input',
      '- block_reason_present=true → Blocked',
      '- planning_defect_classified=true → Rework',
    ],
    release_agent: [
      'Guards for release_agent:',
      '',
      'If current status is ready_to_merge:',
      '- `deploy_required`: Are there deployable code changes?',
      '- `approvals_exist`: Have required approvals been collected?',
      '- `checks_green`: Has CI/CD passed?',
      '- `merge_record_opened`: Has a merge request been created?',
      '- `merge_gate_failed_or_new_defect_found`: Did pre-merge checks reveal issues?',
      '',
      'If current status is deploying:',
      '- `smoke_result_present`: Have smoke tests been executed and recorded?',
      '- `deployment_identifiers_persisted`: Have deploy URLs/IDs been captured?',
      '- `deployment_failure_classified_as_rework`: Did deployment fail, requiring rework?',
      '- `escalation_memo_prepared`: Is there an issue requiring human decision?',
      '',
      'Routing logic (ready_to_merge):',
      '- All deploy guards true → issue moves to Deploying',
      '- merge_gate_failed_or_new_defect_found=true → Rework',
      '',
      'Routing logic (deploying):',
      '- smoke_result_present=true AND deployment_identifiers_persisted=true → Monitoring',
      '- deployment_failure_classified_as_rework=true → Rework',
      '- escalation_memo_prepared=true → Needs Human Decision',
    ],
    monitoring_agent: [
      'Guards for monitoring_agent (current status: monitoring):',
      '- `monitoring_window_elapsed`: Has the monitoring observation period completed?',
      '- `no_unresolved_incident_signal`: Are there no production incidents detected?',
      '- `incident_classified_as_rework`: Has an incident been identified that requires code rework?',
      '- `escalation_memo_prepared`: Is there an issue requiring human decision?',
      '',
      'Routing logic:',
      '- monitoring_window_elapsed=true AND no_unresolved_incident_signal=true → Done',
      '- incident_classified_as_rework=true → Rework',
      '- escalation_memo_prepared=true → Needs Human Decision',
    ],
  }

  const roleGuards = guardsByRole[agentRole]

  if (!roleGuards) {
    return []
  }

  return [...header, ...roleGuards, '']
}

function buildResultFileSchemaSection(): string[] {
  return [
    '## Result File Contract',
    '',
    'After completing your work, write a JSON result to the file specified by $RUNNER_RESULT_FILE.',
    'The `guardOutcomes` field is CRITICAL — it determines the next workflow state for this issue.',
    '',
    'Required JSON schema:',
    '```json',
    '{',
    '  "status": "completed",',
    '  "summary": "Brief description of what was accomplished or decided",',
    '  "guardOutcomes": {',
    '    "guard_name_1": true,',
    '    "guard_name_2": false',
    '  },',
    '  "changedFiles": [],',
    '  "testResults": [],',
    '  "patchRef": null,',
    '  "branchRef": null,',
    '  "reviewFindings": [],',
    '  "toolUsage": [],',
    '  "providerExecutionMetadata": {},',
    '  "stagedArtifacts": [],',
    '  "producedAt": "' + new Date().toISOString().split('T')[0] + 'T00:00:00.000Z"',
    '}',
    '```',
    '',
    'If you set a guard to `false`, the system routes the issue to an appropriate fallback state (Needs Input, Needs Human Decision, Blocked, or Rework).',
    'If you need human input, set the relevant guard to false AND include your question in the `summary` field.',
    '',
  ]
}

export function buildExecutionPrompt(
  provider: 'codex' | 'claude',
  envelope: RunnerTaskEnvelope,
): string {
  const { task } = envelope
  const contract = buildPromptContractDetails(envelope)

  return [
    `You are the ${provider} provider adapter executing an ai-dev-team runner task.`,
    `Provider transport note: keep provider-specific behavior thin and subordinate to the resolved bundle.`,
    '',
    `# ${contract.contractHeading}`,
    ...contract.executionRules,
    '',
    '## Execution metadata',
    `Issue ID: ${task.issueId}`,
    `Workflow ID: ${task.workflowId}`,
    `Lease attempt ID: ${task.leaseAttemptId}`,
    `Agent role: ${task.agentRole}`,
    `Requested provider: ${task.requestedProvider}`,
    `Effective provider: ${task.effectiveProvider}`,
    `Run kind: ${task.runKind ?? 'unknown'}`,
    `Repo slug: ${task.repoSlug ?? 'none'}`,
    `Repository checkout path: ${envelope.attempts.checkoutPath}`,
    `Repository worktree path: ${envelope.attempts.worktreePath}`,
    `Expected outputs: ${task.expectedOutputs.join(', ')}`,
    `Agent library release: ${task.agentLibraryReleaseId ?? 'legacy_synthetic'}`,
    `Task instructions ref: ${task.taskInstructionsRef ?? 'legacy_synthetic'}`,
    `Prompt version: ${task.promptVersion ?? 'legacy_synthetic'}`,
    `Role charter ref: ${task.roleCharterRef ?? 'legacy_synthetic'}`,
    `Prompt bundle fingerprint: ${task.promptBundleFingerprint ?? 'legacy_synthetic'}`,
    `Skill packs: ${task.skillPackRefs.join(', ') || 'none'}`,
    `Execution session key: ${envelope.executionSessionKey}`,
    `Source artifact ids: ${contract.sourceArtifactIds.join(', ') || 'none'}`,
    '',
    ...buildPromptBundleSections(envelope),
    ...buildResolvedSkillSections(envelope),
    ...buildContextPackPreview(envelope.contextPack),
    '',
    ...buildReviewedArtifactPreview(envelope.reviewedBuildArtifact),
    '',
    ...buildListSection('## Output framing', contract.outputFraming),
    '',
    ...buildGuardOutcomeInstructions(task.agentRole),
    ...buildResultFileSchemaSection(),
    'Respond with exactly these sections:',
    'Outcome:',
    'Risks:',
    'Next step:',
  ].join('\n')
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<CommandExecutionResult> {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...envOverrides,
    },
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

  const timeoutHandle = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
      }, 2_000).unref?.()
    }
  }, timeoutMs)
  timeoutHandle.unref?.()

  try {
    const [exitCode, signal] = await Promise.race([
      once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>,
      once(child, 'error').then(([error]) => {
        throw error
      }),
    ]) as [number | null, NodeJS.Signals | null]

    return {
      exitCode,
      signal,
      stdout,
      stderr,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function extractGuardOutcomesFromText(
  text: string | null,
): Record<string, boolean> | null {
  if (!text) return null

  const matches = [...text.matchAll(/\b(\w+)\s*[=:]\s*(true|false)\b/gi)]
  if (matches.length < 2) return null

  const outcomes: Record<string, boolean> = {}

  for (const match of matches) {
    const key = match[1]
    const value = match[2].toLowerCase() === 'true'

    if (key.includes('_') && key.length >= 5 && key.length <= 60) {
      outcomes[key] = value
    }
  }

  return Object.keys(outcomes).length >= 2 ? outcomes : null
}

function buildResultEnvelope(input: {
  provider: 'codex' | 'claude'
  envelope: RunnerTaskEnvelope
  summary: string | null
  commandResult: CommandExecutionResult
  cliBin: string
  prompt: string
}): AdapterResultEnvelope {
  const { commandResult, summary, provider, cliBin, prompt, envelope } = input
  const failed = commandResult.signal !== null || commandResult.exitCode !== 0

  return {
    status: failed ? 'failed' : summary ? 'completed' : 'no_output',
    summary:
      summary ??
      truncateText(commandResult.stderr) ??
      truncateText(commandResult.stdout),
    changedFiles: [],
    testResults: [
      {
        name: `${provider}-adapter-cli`,
        passed: !failed,
      },
    ],
    patchRef: null,
    branchRef: null,
    reviewFindings: [],
    reviewDisposition:
      envelope.task.runKind === 'review' ? 'human_gate_required' : null,
    decisionSummary:
      envelope.task.runKind === 'review'
        ? summary ??
          'Review completed and requires a human decision.'
        : null,
    recommendedNextAction:
      envelope.task.runKind === 'review'
        ? 'Review the decision summary and choose whether to return to coding.'
        : null,
    reviewedBuildArtifactId:
      envelope.task.runKind === 'review'
        ? envelope.task.reviewedBuildArtifactId ?? null
        : null,
    toolUsage: [`${provider}-adapter`],
    providerExecutionMetadata: {
      provider,
      runKind: envelope.task.runKind,
      adapter: `${provider}-adapter`,
      cliBin,
      contextPackFingerprint: envelope.task.contextPackFingerprint,
      agentLibraryReleaseId: envelope.task.agentLibraryReleaseId,
      taskInstructionsRef: envelope.task.taskInstructionsRef,
      roleCharterRef: envelope.task.roleCharterRef,
      promptBundleFingerprint: envelope.task.promptBundleFingerprint,
      resolvedPromptFamilyRefs:
        envelope.executionBundle?.resolvedPromptFamilyRefs ?? [],
      skillPackRefs: envelope.task.skillPackRefs,
      resolvedSkillRefs: envelope.executionBundle?.resolvedSkillRefs ?? [],
      skippedOptionalSkillRefs:
        envelope.executionBundle?.skippedOptionalSkillRefs ?? [],
      effectiveSkillFingerprint: envelope.task.effectiveSkillFingerprint,
      sourceArtifactIds:
        envelope.task.runKind === 'review' && envelope.task.reviewedBuildArtifactId
          ? [envelope.task.reviewedBuildArtifactId]
          : [],
      exitCode: commandResult.exitCode,
      signal: commandResult.signal,
      stdoutPreview: truncateText(commandResult.stdout, 1_500),
      stderrPreview: truncateText(commandResult.stderr, 1_500),
      promptPreview: truncateText(prompt, 1_500),
    },
    guardOutcomes: extractGuardOutcomesFromText(summary),
    stagedArtifacts: [],
    producedAt: new Date().toISOString(),
  }
}

export async function runCodexAdapter(): Promise<void> {
  const cliBin = requiredEnv('CODEX_CLI_BIN')
  const envelope = await readTaskEnvelope()
  const prompt = buildExecutionPrompt('codex', envelope)
  const responseFile = path.join(
    envelope.attempts.providerStageRoot,
    'codex-last-message.txt',
  )
  const mcpBindings = envelope.mcpBindingsSummary ?? envelope.task.mcpBindingsSummary
  const isolatedHome = await prepareIsolatedCodexHome(
    envelope.resolvedSkillDocs,
    mcpBindings,
  )

  try {
    const commandResult = await runCommand(
      cliBin,
      [
        'exec',
        '--skip-git-repo-check',
        '--cd',
        envelope.attempts.worktreePath,
        '--sandbox',
        envelope.task.runKind === 'build' ? 'workspace-write' : 'read-only',
        '--output-last-message',
        responseFile,
        prompt,
      ],
      envelope.attempts.worktreePath,
      Number.parseInt(process.env.RUNNER_PROVIDER_TIMEOUT_MS ?? '180000', 10),
      isolatedHome.envOverrides,
    )

    const summary = truncateText(
      await readFile(responseFile, 'utf8').catch(() => commandResult.stdout),
    )

    await writeResultFile(
      buildResultEnvelope({
        provider: 'codex',
        envelope,
        summary,
        commandResult,
        cliBin,
        prompt,
      }),
    )
  } finally {
    await isolatedHome.cleanup()
  }
}

export async function runClaudeAdapter(): Promise<void> {
  const cliBin = requiredEnv('CLAUDE_CLI_BIN')
  const envelope = await readTaskEnvelope()
  const prompt = buildExecutionPrompt('claude', envelope)
  const stagedSkillBundlePath = await prepareClaudeSkillBundleStage(
    envelope.attempts.providerStageRoot,
    envelope.resolvedSkillDocs,
  )
  const mcpConfig = buildMcpConfigJson(
    envelope.mcpBindingsSummary ?? envelope.task.mcpBindingsSummary,
  )
  const commandResult = await runCommand(
    cliBin,
    ['--print', '--mcp-config', mcpConfig, '--', prompt],
    envelope.attempts.worktreePath,
    Number.parseInt(process.env.RUNNER_PROVIDER_TIMEOUT_MS ?? '180000', 10),
    stagedSkillBundlePath
      ? {
          RUNNER_MANAGED_SKILL_BUNDLE_PATH: stagedSkillBundlePath,
        }
      : {},
  )

  await writeResultFile(
    buildResultEnvelope({
      provider: 'claude',
      envelope,
      summary: truncateText(commandResult.stdout),
      commandResult,
      cliBin,
      prompt,
    }),
  )
}
