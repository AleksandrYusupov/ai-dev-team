import {
  COMMENT_RESPONSE_WORKFLOW_NAME,
  ISSUE_LIFECYCLE_WORKFLOW_NAME,
  LIFECYCLE_SNAPSHOT_QUERY_NAME,
  type LifecycleCommandEnvelopeV1,
  type LifecycleCommandResultV1,
  type LifecycleHumanGateSummaryV1,
  type LifecycleSnapshotV1,
  type LifecycleTimerIntentV1,
  type RunKind,
  type SharedJsonObject,
} from '@ai-dev-team/shared'
import {
  CancellationScope,
  type ChildWorkflowHandle,
  ParentClosePolicy,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  getExternalWorkflowHandle,
  isCancellation,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
} from '@temporalio/workflow'

import type * as activities from '../activities/index.js'

const ISSUE_LIFECYCLE_PROMPT_VERSION = 'issue-lifecycle/phase5/v1'
const COMMENT_RESPONSE_PROMPT_VERSION = 'comment-response/phase5/v1'
const RECENT_COMMAND_KEY_LIMIT = 25
const CONTINUE_AS_NEW_AFTER_COMMANDS = 50
const TERMINAL_STATUS_CODES = new Set(['canceled', 'done', 'duplicate'])

export const ingestCanonicalEventSignal = defineSignal<[LifecycleCommandEnvelopeV1]>(
  'ingestCanonicalEvent',
)
export const ingestSystemCommandSignal = defineSignal<[LifecycleCommandEnvelopeV1]>(
  'ingestSystemCommand',
)
export const ingestTimerFiredSignal = defineSignal<[LifecycleCommandEnvelopeV1]>(
  'ingestTimerFired',
)
export const cancelOpenHumanGateSignal = defineSignal<[LifecycleCommandEnvelopeV1]>(
  'cancelOpenHumanGate',
)
export const getLifecycleSnapshotQuery = defineQuery<LifecycleSnapshotV1>(
  LIFECYCLE_SNAPSHOT_QUERY_NAME,
)

const {
  acceptLifecycleCommandActivity,
  applyLifecycleTransitionFromCommand,
  emitAgentExecutionMetadataActivity,
  ensureIssueBootstrappedFromCommand,
  prepareCommentResponseCommandActivity,
  rejectLifecycleCommandActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
})

interface IssueLifecycleWorkflowInput {
  snapshot?: LifecycleSnapshotV1
  continueAsNewAfterCommands?: number
}

interface CommentResponseWorkflowInput {
  command: LifecycleCommandEnvelopeV1
}

type IntegrationOnboardingEventCode =
  | 'credential_required'
  | 'credential_validated'
  | 'oauth_consent_completed'
  | 'webhook_registered'
  | 'integration_verified'

interface IntegrationOnboardingWorkflowInput {
  issueId: string
  providerName: string
  initialPendingAction?: string | null
}

interface IntegrationOnboardingEvent {
  code: IntegrationOnboardingEventCode
  occurredAt: string
  pendingAction?: string | null
  metadata?: SharedJsonObject
}

interface IntegrationOnboardingSnapshot {
  issueId: string
  providerName: string
  lastEventCode: IntegrationOnboardingEventCode | null
  pendingAction: string | null
  completed: boolean
  updatedAt: string
}

interface ActiveCommentResponseChild {
  commandKey: string
  sourceRef: string
  workflowId: string
  scope: CancellationScope
  handle: ChildWorkflowHandle<typeof CommentResponseWorkflow>
}

interface ActiveTimerState {
  intent: LifecycleTimerIntentV1
  scope: CancellationScope
}

export const ingestIntegrationOnboardingEventSignal = defineSignal<
  [IntegrationOnboardingEvent]
>('ingestIntegrationOnboardingEvent')
export const getIntegrationOnboardingSnapshotQuery =
  defineQuery<IntegrationOnboardingSnapshot>('getIntegrationOnboardingSnapshot')

function nowIsoString(): string {
  return new Date().toISOString()
}

function resolveContinueAsNewThreshold(
  input: IssueLifecycleWorkflowInput | undefined,
): number {
  const configuredThreshold = input?.continueAsNewAfterCommands

  return typeof configuredThreshold === 'number' && configuredThreshold > 0
    ? Math.floor(configuredThreshold)
    : CONTINUE_AS_NEW_AFTER_COMMANDS
}

function buildCommentResponseWorkflowId(command: LifecycleCommandEnvelopeV1): string {
  return `comment-response:${command.commentId ?? command.commandKey}`
}

function shouldPersistCommandResult(command: LifecycleCommandEnvelopeV1): boolean {
  return command.source !== 'comment_response_workflow'
}

function isHumanGateStatusCode(statusCode: string | null | undefined): boolean {
  return statusCode === 'needs_input' || statusCode === 'needs_human_decision'
}

function extractConfigVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function isSharedJsonObject(value: unknown): value is SharedJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


function normalizeTimerIntent(value: unknown): LifecycleTimerIntentV1 | null {
  if (!isSharedJsonObject(value)) {
    return null
  }

  const timerKey =
    typeof value.timerKey === 'string' && value.timerKey.trim().length > 0
      ? value.timerKey.trim()
      : null
  const dueAt =
    typeof value.dueAt === 'string' && value.dueAt.trim().length > 0
      ? value.dueAt.trim()
      : null
  const reason =
    typeof value.reason === 'string' && value.reason.trim().length > 0
      ? value.reason.trim()
      : null

  if (!timerKey || !dueAt || !reason) {
    return null
  }

  const parsedDueAt = new Date(dueAt)

  if (Number.isNaN(parsedDueAt.getTime())) {
    return null
  }

  return {
    timerKey,
    dueAt: parsedDueAt.toISOString(),
    reason,
  }
}

function extractActiveTimerIntents(metadata: unknown): LifecycleTimerIntentV1[] {
  if (!isSharedJsonObject(metadata)) {
    return []
  }

  const candidates = Array.isArray(metadata.activeTimerIntents)
    ? metadata.activeTimerIntents
    : metadata.timerIntent !== undefined
      ? [metadata.timerIntent]
      : metadata.humanGateTimer !== undefined
        ? [metadata.humanGateTimer]
        : []

  const seen = new Set<string>()
  const intents: LifecycleTimerIntentV1[] = []

  for (const candidate of candidates) {
    const timerIntent = normalizeTimerIntent(candidate)

    if (!timerIntent || seen.has(timerIntent.timerKey)) {
      continue
    }

    seen.add(timerIntent.timerKey)
    intents.push(timerIntent)
  }

  return intents
}

function makeInitialSnapshot(input: IssueLifecycleWorkflowInput | undefined): LifecycleSnapshotV1 {
  if (input?.snapshot) {
    return input.snapshot
  }

  return {
    schemaVersion: 1,
    issueId: '',
    workflowId: '',
    lastProcessedCommandKey: null,
    recentCommandKeys: [],
    openHumanGate: null,
    activeTimerIntents: [],
    versionMarker: 1,
    terminal: false,
    updatedAt: nowIsoString(),
  }
}

function pushRecentCommandKey(snapshot: LifecycleSnapshotV1, commandKey: string): void {
  if (snapshot.recentCommandKeys.includes(commandKey)) {
    return
  }

  snapshot.recentCommandKeys = [...snapshot.recentCommandKeys, commandKey].slice(
    -RECENT_COMMAND_KEY_LIMIT,
  )
}

function buildDuplicateResult(
  command: LifecycleCommandEnvelopeV1,
): LifecycleCommandResultV1 {
  return {
    schemaVersion: 1,
    commandKey: command.commandKey,
    issueId: command.issueId,
    workflowId: command.workflowId,
    status: 'duplicate',
    transitionAuditId: null,
    fromStatusCode: null,
    toStatusCode: null,
    activeRunId: null,
    validatorError: null,
    intentPersistedOnly: true,
    completionReason: 'duplicate_suppressed',
    processedAt: nowIsoString(),
    metadata: {},
  }
}

function buildIntentPersistedOnlyResult(
  command: LifecycleCommandEnvelopeV1,
  completionReason: string,
  metadata: SharedJsonObject = {},
): LifecycleCommandResultV1 {
  return {
    schemaVersion: 1,
    commandKey: command.commandKey,
    issueId: command.issueId,
    workflowId: command.workflowId,
    status: 'accepted',
    transitionAuditId: null,
    fromStatusCode: null,
    toStatusCode: null,
    activeRunId: null,
    validatorError: null,
    intentPersistedOnly: true,
    completionReason,
    processedAt: nowIsoString(),
    metadata,
  }
}

async function persistCommandResultIfNeeded(
  command: LifecycleCommandEnvelopeV1,
  result: LifecycleCommandResultV1,
): Promise<void> {
  if (!shouldPersistCommandResult(command)) {
    return
  }

  if (result.status === 'rejected') {
    await rejectLifecycleCommandActivity({
      commandKey: command.commandKey,
      validatorPayload: result.validatorError,
      errorMessage: result.validatorError?.message ?? result.completionReason,
    })
    return
  }

  await acceptLifecycleCommandActivity({
    commandKey: command.commandKey,
    transitionAuditId: result.transitionAuditId,
    resultPayload: result,
  })
}

async function emitIssueLifecycleExecutionMetadata(
  command: LifecycleCommandEnvelopeV1,
  result: LifecycleCommandResultV1,
): Promise<void> {
  await emitAgentExecutionMetadataActivity({
    issueId: command.issueId,
    transitionAuditId: result.transitionAuditId,
    runId: result.activeRunId,
    producedForStatusCode: result.toStatusCode,
    metadata: {
      schemaVersion: 2,
      agentRole: ISSUE_LIFECYCLE_WORKFLOW_NAME,
      promptVersion: ISSUE_LIFECYCLE_PROMPT_VERSION,
      agentLibraryReleaseId: null,
      taskInstructionsRef: null,
      roleCharterRef: null,
      promptBundleFingerprint: null,
      resolvedPromptFamilyRefs: [],
      skillPackRefs: [],
      resolvedSkillRefs: [],
      skippedOptionalSkillRefs: [],
      effectiveSkillFingerprint: null,
      contextPackFingerprint:
        typeof command.metadata.contextPackFingerprint === 'string'
          ? command.metadata.contextPackFingerprint
          : null,
      configVersion:
        extractConfigVersion(result.metadata.configVersion) ??
        extractConfigVersion(command.metadata.configVersion),
      workflowId: command.workflowId,
      workflowRunId: null,
      runKind:
        typeof command.metadata.requestedRunKind === 'string'
          ? (command.metadata.requestedRunKind as RunKind)
          : null,
      attemptNo: 1,
      requestedProvider: null,
      effectiveProvider: null,
      providerAttemptNo: null,
      fallbackFromProvider: null,
      fallbackReason: null,
      toolsUsed: [],
      mcpBindings: [],
      runnerNodeId: null,
      hostGroupId: null,
      executionDurationMs: 0,
      completionReason: result.completionReason,
    },
  })
}

function updateHumanGateSummary(
  current: LifecycleHumanGateSummaryV1 | null,
  command: LifecycleCommandEnvelopeV1,
  result: LifecycleCommandResultV1,
): LifecycleHumanGateSummaryV1 | null {
  if (result.status !== 'accepted' || !result.toStatusCode) {
    return current
  }

  if (isHumanGateStatusCode(result.toStatusCode)) {
    const reviewDisposition =
      command.metadata.reviewDisposition === 'human_gate_required' ||
      command.metadata.reviewDisposition === 'rework_recommended' ||
      command.metadata.reviewDisposition === 'review_inconclusive'
        ? command.metadata.reviewDisposition
        : null

    return {
      statusCode: result.toStatusCode,
      questionArtifactId:
        typeof result.metadata.openOperatorQuestionId === 'string'
          ? result.metadata.openOperatorQuestionId
          : null,
      decisionSummaryArtifactId: current?.decisionSummaryArtifactId ?? null,
      reasonCode: command.reasonCode ?? null,
      reasonText: command.reasonText ?? null,
      openedAt: result.processedAt,
      reviewDisposition,
      reviewedBuildArtifactId:
        typeof command.metadata.reviewedBuildArtifactId === 'string'
          ? command.metadata.reviewedBuildArtifactId
          : null,
      contextPackFingerprint:
        typeof command.metadata.contextPackFingerprint === 'string'
          ? command.metadata.contextPackFingerprint
          : null,
    }
  }

  return null
}

function buildTimerFiredCommand(
  issueId: string,
  workflowId: string,
  timerIntent: LifecycleTimerIntentV1,
): LifecycleCommandEnvelopeV1 {
  return {
    schemaVersion: 1,
    commandKey: `timer-fired:${timerIntent.timerKey}:${timerIntent.dueAt}`,
    issueId,
    workflowId,
    signalName: 'ingestTimerFired',
    source: 'system_timer',
    sourceRef: timerIntent.timerKey,
    occurredAt: timerIntent.dueAt,
    actorType: 'system',
    actorId: 'issue-lifecycle/timer',
    triggerCode: null,
    requestedStatusCode: null,
    commentId: null,
    reasonCode: null,
    reasonText: null,
    checkpointId: null,
    leaseId: null,
    blockedByIssueIds: [],
    guardOutcomes: {},
    metadata: {
      timerIntent: {
        timerKey: timerIntent.timerKey,
        dueAt: timerIntent.dueAt,
        reason: timerIntent.reason,
      },
    },
  }
}

async function processIssueLifecycleCommand(
  snapshot: LifecycleSnapshotV1,
  command: LifecycleCommandEnvelopeV1,
  startCommentResponseChild: (
    command: LifecycleCommandEnvelopeV1,
  ) => Promise<void>,
): Promise<LifecycleCommandResultV1> {
  if (
    snapshot.lastProcessedCommandKey === command.commandKey ||
    snapshot.recentCommandKeys.includes(command.commandKey)
  ) {
    const duplicateResult = buildDuplicateResult(command)
    await persistCommandResultIfNeeded(command, duplicateResult)
    await emitIssueLifecycleExecutionMetadata(command, duplicateResult)
    return duplicateResult
  }

  if (command.signalName === 'cancelOpenHumanGate') {
    const result = buildIntentPersistedOnlyResult(
      command,
      'human_gate_cancelled',
    )
    await persistCommandResultIfNeeded(command, result)
    await emitIssueLifecycleExecutionMetadata(command, result)
    return result
  }

  if (command.signalName === 'ingestTimerFired') {
    const timerIntent = normalizeTimerIntent(command.metadata.timerIntent)
    const result = buildIntentPersistedOnlyResult(
      command,
      'human_gate_timer_fired',
      timerIntent
        ? {
            timerKey: timerIntent.timerKey,
          }
        : {},
    )
    await persistCommandResultIfNeeded(command, result)
    await emitIssueLifecycleExecutionMetadata(command, result)
    return result
  }

  if (command.triggerCode === 'user_create_issue') {
    const result = await ensureIssueBootstrappedFromCommand(command)
    await persistCommandResultIfNeeded(command, result)
    await emitIssueLifecycleExecutionMetadata(command, result)
    return result
  }

  if (
    command.triggerCode === 'human_input_received' &&
    command.commentId &&
    command.source !== 'comment_response_workflow'
  ) {
    await startCommentResponseChild(command)

    const result = buildIntentPersistedOnlyResult(
      command,
      'comment_response_started',
      {
        commentResponseWorkflowId: buildCommentResponseWorkflowId(command),
      },
    )
    await persistCommandResultIfNeeded(command, result)
    await emitIssueLifecycleExecutionMetadata(command, result)
    return result
  }

  if (command.triggerCode === 'human_comment_ask') {
    const result = buildIntentPersistedOnlyResult(
      command,
      'ask_intent_persisted_only',
    )
    await persistCommandResultIfNeeded(command, result)
    await emitIssueLifecycleExecutionMetadata(command, result)
    return result
  }

  const result = await applyLifecycleTransitionFromCommand(command)
  await persistCommandResultIfNeeded(command, result)
  await emitIssueLifecycleExecutionMetadata(command, result)
  return result
}

export async function IssueLifecycleWorkflow(
  input?: IssueLifecycleWorkflowInput,
): Promise<void> {
  const snapshot = makeInitialSnapshot(input)
  const queue: LifecycleCommandEnvelopeV1[] = []
  const activeTimerStates = new Map<string, ActiveTimerState>()
  let processedCommands = 0
  let activeCommentResponseChild: ActiveCommentResponseChild | null = null
  const continueAsNewAfterCommands = resolveContinueAsNewThreshold(input)

  const cancelTimerIntents = (timerKeys?: readonly string[]): void => {
    const timerKeySet = timerKeys ? new Set(timerKeys) : null

    for (const [timerKey, timerState] of activeTimerStates.entries()) {
      if (timerKeySet && !timerKeySet.has(timerKey)) {
        continue
      }

      timerState.scope.cancel()
      activeTimerStates.delete(timerKey)
    }

    snapshot.activeTimerIntents = timerKeySet
      ? snapshot.activeTimerIntents.filter(
          (timerIntent) => !timerKeySet.has(timerIntent.timerKey),
        )
      : []
  }

  const startTimerIntent = (timerIntent: LifecycleTimerIntentV1): void => {
    const existingTimer = activeTimerStates.get(timerIntent.timerKey)

    if (
      existingTimer &&
      existingTimer.intent.dueAt === timerIntent.dueAt &&
      existingTimer.intent.reason === timerIntent.reason
    ) {
      return
    }

    if (existingTimer) {
      existingTimer.scope.cancel()
      activeTimerStates.delete(timerIntent.timerKey)
    }

    const scope = new CancellationScope({ cancellable: true })
    activeTimerStates.set(timerIntent.timerKey, {
      intent: timerIntent,
      scope,
    })

    void scope.run(async () => {
      const delayMs = Math.max(0, Date.parse(timerIntent.dueAt) - Date.now())

      if (delayMs > 0) {
        await sleep(delayMs)
      }

      activeTimerStates.delete(timerIntent.timerKey)
      queue.push(
        buildTimerFiredCommand(
          snapshot.issueId,
          snapshot.workflowId,
          timerIntent,
        ),
      )
    }).catch((error) => {
      if (!isCancellation(error)) {
        throw error
      }
    })
  }

  const syncTimerIntents = (timerIntents: readonly LifecycleTimerIntentV1[]): void => {
    const nextTimerKeys = new Set(timerIntents.map((timerIntent) => timerIntent.timerKey))

    for (const existingTimerKey of activeTimerStates.keys()) {
      if (!nextTimerKeys.has(existingTimerKey)) {
        cancelTimerIntents([existingTimerKey])
      }
    }

    snapshot.activeTimerIntents = [...timerIntents]

    for (const timerIntent of timerIntents) {
      startTimerIntent(timerIntent)
    }
  }

  const cancelActiveCommentResponseChild = async (): Promise<void> => {
    if (!activeCommentResponseChild) {
      return
    }

    const childToCancel = activeCommentResponseChild
    activeCommentResponseChild = null

    try {
      childToCancel.scope.cancel()
      await childToCancel.handle.result().catch(() => undefined)
    } catch {
      // The child may already be completed or cancelled.
    }
  }

  const startCommentResponseChild = async (
    command: LifecycleCommandEnvelopeV1,
  ): Promise<void> => {
    await cancelActiveCommentResponseChild()

    const workflowId = buildCommentResponseWorkflowId(command)
    const scope = new CancellationScope({ cancellable: true })
    const handle = await scope.run(() =>
      startChild(CommentResponseWorkflow, {
        workflowId,
        args: [{ command }],
        parentClosePolicy: ParentClosePolicy.REQUEST_CANCEL,
      }),
    )

    activeCommentResponseChild = {
      commandKey: command.commandKey,
      sourceRef: command.commentId ?? command.commandKey,
      workflowId,
      scope,
      handle,
    }
  }

  setHandler(getLifecycleSnapshotQuery, () => snapshot)
  setHandler(ingestCanonicalEventSignal, (command) => {
    queue.push(command)
  })
  setHandler(ingestSystemCommandSignal, (command) => {
    queue.push(command)
  })
  setHandler(ingestTimerFiredSignal, (command) => {
    queue.push(command)
  })
  setHandler(cancelOpenHumanGateSignal, (command) => {
    queue.push(command)
  })

  while (true) {
    await condition(() => queue.length > 0)

    while (queue.length > 0) {
      const command = queue.shift()

      if (!command) {
        continue
      }

      snapshot.issueId = command.issueId
      snapshot.workflowId = command.workflowId

      if (
        activeCommentResponseChild &&
        command.source === 'comment_response_workflow'
      ) {
        activeCommentResponseChild = null
      }

      const result = await processIssueLifecycleCommand(
        snapshot,
        command,
        startCommentResponseChild,
      )

      snapshot.lastProcessedCommandKey = command.commandKey
      pushRecentCommandKey(snapshot, command.commandKey)
      snapshot.openHumanGate = updateHumanGateSummary(
        snapshot.openHumanGate,
        command,
        result,
      )

      if (
        result.status === 'accepted' &&
        command.signalName === 'cancelOpenHumanGate'
      ) {
        await cancelActiveCommentResponseChild()
        cancelTimerIntents()
      }

      if (
        result.status === 'accepted' &&
        command.signalName === 'ingestTimerFired'
      ) {
        const timerKey =
          typeof result.metadata.timerKey === 'string'
            ? result.metadata.timerKey
            : command.sourceRef

        cancelTimerIntents([timerKey])
      }

      if (result.status === 'accepted' && isHumanGateStatusCode(result.toStatusCode)) {
        syncTimerIntents(extractActiveTimerIntents(result.metadata))
      }

      if (
        result.status === 'accepted' &&
        result.toStatusCode !== null &&
        !isHumanGateStatusCode(result.toStatusCode)
      ) {
        await cancelActiveCommentResponseChild()
        cancelTimerIntents()
      }

      snapshot.terminal =
        snapshot.terminal ||
        (result.toStatusCode !== null &&
          TERMINAL_STATUS_CODES.has(result.toStatusCode))

      if (snapshot.terminal) {
        await cancelActiveCommentResponseChild()
        cancelTimerIntents()
      }

      snapshot.updatedAt = nowIsoString()

      processedCommands += 1

      if (
        processedCommands >= continueAsNewAfterCommands &&
        queue.length === 0 &&
        activeCommentResponseChild === null &&
        activeTimerStates.size === 0
      ) {
        await continueAsNew<typeof IssueLifecycleWorkflow>({
          snapshot,
          continueAsNewAfterCommands,
        })
      }
    }
  }
}

export async function CommentResponseWorkflow(
  input: CommentResponseWorkflowInput,
): Promise<void> {
  const prepared = await prepareCommentResponseCommandActivity({
    command: input.command,
  })

  if (prepared.command) {
    const issueHandle = getExternalWorkflowHandle(prepared.command.workflowId)

    await issueHandle.signal(ingestSystemCommandSignal, prepared.command)
  }

  await emitAgentExecutionMetadataActivity({
    issueId: input.command.issueId,
    transitionAuditId: null,
    runId: null,
    producedForStatusCode: null,
    metadata: {
      schemaVersion: 2,
      agentRole: COMMENT_RESPONSE_WORKFLOW_NAME,
      promptVersion: COMMENT_RESPONSE_PROMPT_VERSION,
      agentLibraryReleaseId: null,
      taskInstructionsRef: null,
      roleCharterRef: null,
      promptBundleFingerprint: null,
      resolvedPromptFamilyRefs: [],
      skillPackRefs: [],
      resolvedSkillRefs: [],
      skippedOptionalSkillRefs: [],
      effectiveSkillFingerprint: null,
      contextPackFingerprint:
        typeof input.command.metadata.contextPackFingerprint === 'string'
          ? input.command.metadata.contextPackFingerprint
          : null,
      configVersion: prepared.configVersion,
      workflowId: buildCommentResponseWorkflowId(input.command),
      workflowRunId: null,
      runKind: prepared.runKind,
      attemptNo: 1,
      requestedProvider: null,
      effectiveProvider: null,
      providerAttemptNo: null,
      fallbackFromProvider: null,
      fallbackReason: null,
      toolsUsed: [],
      mcpBindings: [],
      runnerNodeId: null,
      hostGroupId: null,
      executionDurationMs: 0,
      completionReason: prepared.completionReason,
    },
  })
}

export async function IntegrationOnboardingWorkflow(
  input: IntegrationOnboardingWorkflowInput,
): Promise<void> {
  const queue: IntegrationOnboardingEvent[] = []
  const snapshot: IntegrationOnboardingSnapshot = {
    issueId: input.issueId,
    providerName: input.providerName,
    lastEventCode: null,
    pendingAction: input.initialPendingAction ?? null,
    completed: false,
    updatedAt: nowIsoString(),
  }

  setHandler(ingestIntegrationOnboardingEventSignal, (event) => {
    queue.push(event)
  })

  setHandler(getIntegrationOnboardingSnapshotQuery, () => snapshot)

  while (!snapshot.completed) {
    await condition(() => queue.length > 0)

    while (queue.length > 0) {
      const event = queue.shift() as IntegrationOnboardingEvent

      snapshot.lastEventCode = event.code
      snapshot.pendingAction =
        event.pendingAction === undefined
          ? snapshot.pendingAction
          : event.pendingAction
      snapshot.updatedAt = event.occurredAt

      if (event.code === 'credential_required') {
        snapshot.completed = false
        continue
      }

      if (event.code === 'integration_verified') {
        snapshot.completed = true
        snapshot.pendingAction = null
      }
    }
  }
}
