import { sql } from 'kysely'

import type { DbClient, JsonObject } from '@ai-dev-team/db'
import type {
  LifecycleTimerIntentV1,
  OutboxCommandEnvelopeV1,
} from '@ai-dev-team/shared'

import { applyRunLifecycle } from './run-lifecycle.js'
import { writeProjections } from './projection-writer.js'
import { validateTransition } from './validate-transition.js'
import { enqueueLinearStateSyncCommand } from '../../linear-sync.js'
import type {
  ApplyTransitionInput,
  ApplyTransitionResult,
  BootstrapIssueInput,
  BootstrapIssueResult,
  TransitionArtifactInput,
} from './types.js'

function buildHookArtifact(
  issueId: string,
  toStatus: string,
  hookName: string,
  artifactType: string,
  ownerRole: string,
  requestedOwnerRole: string | null,
  requestedRunKind: string | null,
): TransitionArtifactInput {
  const metadata: JsonObject = {
    generatedByHook: true,
    hookName,
    ownerRole,
  }

  if (artifactType === 'runner_requirement_profile') {
    metadata.requestedOwnerRole = requestedOwnerRole ?? ownerRole
    metadata.requestedRunKind = requestedRunKind
    metadata.profileSource = 'status_entry_hook'
  }

  return {
    artifactType,
    artifactScope: 'transition',
    artifactUri: `system://workflow/${issueId}/${toStatus}/${hookName}/${artifactType}`,
    artifactSummary: `Auto-generated artifact for ${toStatus}:${hookName}`,
    producedByRole: ownerRole,
    metadata,
  }
}

async function loadLatestArtifactMetadata(
  db: DbClient,
  issueId: string,
  artifactType: string,
): Promise<JsonObject | null> {
  const artifact = await db
    .selectFrom('artifact_registry')
    .select('metadata')
    .where('issue_id', '=', issueId)
    .where('artifact_type', '=', artifactType)
    .where('superseded_at', 'is', null)
    .orderBy('produced_at', 'desc')
    .executeTakeFirst()

  return artifact?.metadata ?? null
}

function buildOutboxCommandBody(input: {
  commandType: string
  toStatus: string
  ownerRole: string
  targetOwnerRole: string | null
  activeLeaseId: string | null
  requestedRunKind: string | null
  checkpointId: string | null
  reasonCode: string | null
  reasonText: string | null
  contextPackFingerprint: string | null
  runnerRequirementProfile: JsonObject | null
}): JsonObject {
  if (input.commandType === 'create_runner_lease') {
    const requestedOwnerRole = input.targetOwnerRole ?? input.ownerRole
    const runnerRequirementProfile = {
      ...(input.runnerRequirementProfile ?? {}),
      requestedStatusCode: input.toStatus,
      requestedOwnerRole,
      requestedRunKind: input.requestedRunKind,
    } satisfies JsonObject

    return {
      requestedRunKind: input.requestedRunKind,
      requestedOwnerRole,
      runnerRequirementProfile,
      contextPackFingerprint: input.contextPackFingerprint,
      checkpointId: input.checkpointId,
      intent_persisted_only: true,
    }
  }

  if (input.commandType === 'release_runner_lease') {
    return {
      leaseId: input.activeLeaseId,
      requestedOwnerRole: input.targetOwnerRole ?? input.ownerRole,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      checkpointId: input.checkpointId,
      intent_persisted_only: true,
    }
  }

  return {
    toStatus: input.toStatus,
    requestedOwnerRole: input.targetOwnerRole ?? input.ownerRole,
    checkpointId: input.checkpointId,
    intent_persisted_only: true,
  }
}

function compileOutboxPayload(input: {
  issueId: string
  runId: string | null
  workflowId: string
  transitionAuditId: string
  configVersion: number
  commandKey: string
  commandType: string
  body: JsonObject
  issuedAt: string
}): OutboxCommandEnvelopeV1 {
  return {
    schemaVersion: 1,
    commandType: input.commandType,
    issuedAt: input.issuedAt,
    issueId: input.issueId,
    runId: input.runId,
    workflowId: input.workflowId,
    transitionAuditId: input.transitionAuditId,
    configVersion: input.configVersion,
    commandKey: input.commandKey,
    body: input.body,
    intentPersistedOnly: true,
  }
}

function toJsonb<T>(value: T) {
  return sql<T>`${JSON.stringify(value)}::jsonb`
}

function activeLeaseIdForTransition(
  effectOnLease: string,
  currentLeaseId: string | null,
  requestedLeaseId: string | null | undefined,
): string | null {
  if (effectOnLease === 'create' || effectOnLease === 'restore') {
    return requestedLeaseId ?? currentLeaseId
  }

  if (effectOnLease === 'none' || effectOnLease === 'resume') {
    return currentLeaseId
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKeywordMatch(value: unknown, keywords: readonly string[]): boolean {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    return keywords.some((keyword) => normalized.includes(keyword))
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasKeywordMatch(entry, keywords))
  }

  if (isRecord(value)) {
    return Object.values(value).some((entry) => hasKeywordMatch(entry, keywords))
  }

  return false
}

function isHumanGateStatus(statusCode: string): boolean {
  return statusCode === 'needs_input' || statusCode === 'needs_human_decision'
}

function shouldRequireSecurityReview(input: {
  highRisk: boolean
  isIntegrationHeavy: boolean
  contractRisk: string | null
  contractJson: JsonObject | null
}): boolean {
  if (input.highRisk || input.isIntegrationHeavy) {
    return true
  }

  const normalizedRisk = input.contractRisk?.trim().toLowerCase() ?? null

  if (normalizedRisk === 'high' || normalizedRisk === 'critical') {
    return true
  }

  const authAndInfraKeywords = [
    'auth',
    'oauth',
    'webhook',
    'credential',
    'token',
    'secret',
    'migration',
    'schema',
    'iac',
    'terraform',
    'pulumi',
    'cloudformation',
  ] as const

  return hasKeywordMatch(input.contractJson, authAndInfraKeywords)
}

function shouldUseIntegrationRoute(input: {
  triggerCode: string
  stagedArtifacts: readonly TransitionArtifactInput[]
  existingIntegrationArtifactsPresent: boolean
  contractJson: JsonObject | null
}): boolean {
  if (input.existingIntegrationArtifactsPresent) {
    return true
  }

  if (
    [
      'credential_validated',
      'oauth_consent_completed',
      'webhook_registered',
      'integration_verified',
    ].includes(input.triggerCode)
  ) {
    return true
  }

  if (
    input.stagedArtifacts.some((artifact) =>
      [
        'integration_brief',
        'auth_decision_record',
        'credential_request',
        'credential_validation_report',
        'oauth_consent_session',
        'webhook_contract',
        'webhook_validation_report',
        'integration_smoke_report',
        'integration_go_live_checklist',
      ].includes(artifact.artifactType),
    )
  ) {
    return true
  }

  if (!isRecord(input.contractJson)) {
    return false
  }

  const contract = input.contractJson
  const issueType =
    typeof contract.issueType === 'string'
      ? contract.issueType.trim().toLowerCase()
      : null

  return Boolean(
    (typeof contract.providerName === 'string' &&
      contract.providerName.trim().length > 0) ||
      (typeof contract.integrationKind === 'string' &&
        contract.integrationKind.trim().length > 0) ||
      (typeof contract.authScheme === 'string' &&
        contract.authScheme.trim().length > 0) ||
      issueType === 'integration' ||
      (Array.isArray(contract.requiredCredentials) &&
        contract.requiredCredentials.length > 0) ||
      (Array.isArray(contract.secretSlots) && contract.secretSlots.length > 0) ||
      contract.webhookRequired === true,
  )
}

function buildBlockedResumeCondition(
  suspendedFromStatusCode: string,
): JsonObject {
  return {
    triggerCode: 'system_block_cleared',
    fromStatus: 'blocked',
    suspendedFromStatus: suspendedFromStatusCode,
  }
}

function normalizeTimerIntent(value: unknown): LifecycleTimerIntentV1 | null {
  if (!isRecord(value)) {
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

function extractHumanGateTimerIntents(
  metadata: JsonObject | undefined,
): LifecycleTimerIntentV1[] {
  if (!metadata || !isRecord(metadata)) {
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
  const timerIntents: LifecycleTimerIntentV1[] = []

  for (const candidate of candidates) {
    const timerIntent = normalizeTimerIntent(candidate)

    if (!timerIntent || seen.has(timerIntent.timerKey)) {
      continue
    }

    seen.add(timerIntent.timerKey)
    timerIntents.push(timerIntent)
  }

  return timerIntents
}

function buildHumanGateResumeCondition(
  statusCode: string,
  timerIntents: readonly LifecycleTimerIntentV1[],
  suspendedFromStatusCode: string | null,
): JsonObject {
  const resumeCondition: JsonObject = {
    triggerCode:
      statusCode === 'needs_human_decision'
        ? 'human_decision_given'
        : 'human_input_received',
    fromStatus: statusCode,
  }

  if (suspendedFromStatusCode) {
    resumeCondition.suspendedFromStatus = suspendedFromStatusCode
  }

  if (timerIntents.length > 0) {
    resumeCondition.activeTimerIntents = timerIntents as unknown as JsonObject[keyof JsonObject]
  }

  return resumeCondition
}

export async function bootstrapIssueRuntimeState(
  db: DbClient,
  input: BootstrapIssueInput,
): Promise<BootstrapIssueResult> {
  return db.transaction().execute(async (trx) => {
    await sql`set transaction isolation level repeatable read`.execute(trx)

    const existing = await trx
      .selectFrom('issue_runtime_state')
      .select('issue_id')
      .where('issue_id', '=', input.issueId)
      .executeTakeFirst()

    if (existing) {
      throw new Error(`Issue runtime state already exists for ${input.issueId}`)
    }

    const activeConfig = await trx
      .selectFrom('workflow_config_sets')
      .selectAll()
      .where('is_active_for_new_runs', '=', true)
      .executeTakeFirstOrThrow()

    const audit = await trx
      .insertInto('status_transition_audit')
      .values({
        issue_id: input.issueId,
        workflow_id: input.workflowId,
        config_version: activeConfig.config_version,
        from_status_code: null,
        to_status_code: 'triage',
        trigger_code: 'user_create_issue',
        actor_type: 'system',
        actor_id: input.actorId,
        owner_role: 'system',
        artifact_links: toJsonb(
          input.rawIssueArtifactUri ? [input.rawIssueArtifactUri] : [],
        ),
        metadata: input.metadata ?? {},
      })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('issue_runtime_state')
      .values({
        issue_id: input.issueId,
        current_status_code: 'triage',
        current_stage: 'intake',
        workflow_id: input.workflowId,
        active_run_id: null,
        pinned_config_version: activeConfig.config_version,
        open_operator_question_id: null,
        pause_reason_code: null,
        pause_reason_text: null,
        resume_condition: null,
        suspended_from_status_code: null,
        block_reason_code: null,
        block_reason_text: null,
        blocked_by_issue_ids: toJsonb([]),
        active_lease_id: null,
      })
      .execute()

    if (input.rawIssueArtifactUri) {
      await trx
        .insertInto('artifact_registry')
        .values({
          issue_id: input.issueId,
          run_id: null,
          transition_audit_id: audit.id,
          artifact_type: 'raw_issue_record',
          artifact_scope: 'issue',
          artifact_uri: input.rawIssueArtifactUri,
          artifact_summary: 'Initial issue payload',
          produced_by_role: 'system',
          produced_for_status_code: 'triage',
          metadata: input.metadata ?? {},
        })
        .execute()
    }

    await writeProjections(trx, {
      issueId: input.issueId,
      toStatus: 'triage',
      ownerRole: 'system',
      activeLeaseId: null,
      activeRunId: null,
      lastTransitionTrigger: 'user_create_issue',
      blockedByIssueIds: [],
      blockReasonCode: null,
      highRisk: Boolean(input.metadata?.highRisk),
    })

    const entryHooks = await trx
      .selectFrom('workflow_status_entry_hooks')
      .selectAll()
      .where('config_version', '=', activeConfig.config_version)
      .where('status_code', '=', 'triage')
      .where('emits_command_type', 'is not', null)
      .orderBy('hook_order', 'asc')
      .execute()

    const now = new Date()
    const outboxValues = entryHooks
      .filter((hook) => hook.emits_command_type)
      .map((hook) => {
        const commandType = hook.emits_command_type as string
        const commandKey = `${audit.id}:${hook.hook_order.toString()}:${commandType}`

        return {
          transition_audit_id: audit.id,
          issue_id: input.issueId,
          run_id: null,
          command_type: commandType,
          command_payload: compileOutboxPayload({
            issueId: input.issueId,
            runId: null,
            workflowId: input.workflowId,
            transitionAuditId: audit.id,
            configVersion: activeConfig.config_version,
            commandKey,
            commandType,
            body: buildOutboxCommandBody({
              commandType,
              toStatus: 'triage',
              ownerRole: hook.owner_role,
              targetOwnerRole: hook.target_owner_role ?? null,
              activeLeaseId: null,
              requestedRunKind: null,
              checkpointId: null,
              reasonCode: null,
              reasonText: null,
              contextPackFingerprint: null,
              runnerRequirementProfile: null,
            }),
            issuedAt: now.toISOString(),
          }) as unknown as JsonObject,
          idempotency_key: commandKey,
        }
      })

    if (outboxValues.length > 0) {
      await trx.insertInto('workflow_effect_outbox').values(outboxValues).execute()
    }

    return {
      transitionAuditId: audit.id,
      runtimeStateIssueId: input.issueId,
      configVersion: activeConfig.config_version,
    }
  })
}

export async function applyTransition(
  db: DbClient,
  input: ApplyTransitionInput,
): Promise<ApplyTransitionResult> {
  return db.transaction().execute(async (trx) => {
    await sql`set transaction isolation level repeatable read`.execute(trx)
    await sql`select issue_id from issue_runtime_state where issue_id = ${input.issueId} for update`.execute(
      trx,
    )

    const runtimeState = await trx
      .selectFrom('issue_runtime_state')
      .selectAll()
      .where('issue_id', '=', input.issueId)
      .executeTakeFirstOrThrow()
    const currentProjection = await trx
      .selectFrom('status_projection')
      .select(['high_risk'])
      .where('issue_id', '=', input.issueId)
      .executeTakeFirst()

    const validation = await validateTransition(trx, input)
    if (!validation.ok) {
      throw Object.assign(new Error(validation.error.message), {
        name: 'TransitionValidationError',
        validatorError: validation.error,
      })
    }

    const hooks = await trx
      .selectFrom('workflow_status_entry_hooks')
      .selectAll()
      .where('config_version', '=', runtimeState.pinned_config_version)
      .where('status_code', '=', validation.toStatus)
      .orderBy('hook_order', 'asc')
      .execute()
    const runtimeRoleContracts = await trx
      .selectFrom('workflow_runtime_role_contracts')
      .select(['role_id', 'canonical_run_kind'])
      .where('config_version', '=', runtimeState.pinned_config_version)
      .execute()

    const now = new Date()
    const integrationHeavyArtifactTypes = [
      'integration_brief',
      'auth_decision_record',
      'credential_request',
      'credential_validation_report',
      'oauth_consent_session',
      'webhook_contract',
      'webhook_validation_report',
      'integration_smoke_report',
      'integration_go_live_checklist',
    ] as const
    const integrationArtifact = await trx
      .selectFrom('artifact_registry')
      .select('id')
      .where('issue_id', '=', input.issueId)
      .where('artifact_type', 'in', [...integrationHeavyArtifactTypes])
      .where('superseded_at', 'is', null)
      .executeTakeFirst()
    const latestContract = await trx
      .selectFrom('linear_issue_contract_snapshots')
      .select(['risk', 'contract_json'])
      .where('issue_id', '=', input.issueId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()
    const effectiveHighRisk =
      typeof input.metadata?.highRisk === 'boolean'
        ? input.metadata.highRisk
        : (currentProjection?.high_risk ?? false)
    const isIntegrationHeavy = shouldUseIntegrationRoute({
      triggerCode: input.triggerCode,
      stagedArtifacts: input.artifacts ?? [],
      existingIntegrationArtifactsPresent: Boolean(integrationArtifact),
      contractJson:
        (latestContract?.contract_json as JsonObject | null | undefined) ?? null,
    })
    const requiresSecurityReview = shouldRequireSecurityReview({
      highRisk: effectiveHighRisk,
      isIntegrationHeavy,
      contractRisk: latestContract?.risk ?? null,
      contractJson:
        (latestContract?.contract_json as JsonObject | null | undefined) ?? null,
    })
    const roleRunKindById = new Map(
      runtimeRoleContracts.map((contract) => [
        contract.role_id,
        contract.canonical_run_kind,
      ]),
    )
    const resolveBuildProfileRole = (role: string | null): string | null => {
      if (!role) {
        return null
      }

      if (role === 'build_agent' || role === 'build_agent_backend') {
        return isIntegrationHeavy ? 'build_agent_integrations' : 'build_agent_backend'
      }

      return role
    }
    const resolvedHooks = hooks.map((hook) => {
      const resolvedOwnerRole = resolveBuildProfileRole(hook.owner_role) ?? hook.owner_role
      const resolvedTargetOwnerRole =
        resolveBuildProfileRole(hook.target_owner_role) ?? hook.target_owner_role
      const requestedOwnerRole = resolvedTargetOwnerRole ?? resolvedOwnerRole

      return {
        ...hook,
        resolvedOwnerRole,
        resolvedTargetOwnerRole,
        requestedRunKind:
          requestedOwnerRole !== null
            ? roleRunKindById.get(requestedOwnerRole) ?? validation.openedRunKind
            : validation.openedRunKind,
      }
    }).filter((hook) => {
      if (
        validation.toStatus === 'agent_review' &&
        hook.resolvedTargetOwnerRole === 'security_agent'
      ) {
        return requiresSecurityReview
      }

      if (
        hook.resolvedOwnerRole === 'integration_agent' ||
        hook.resolvedTargetOwnerRole === 'integration_agent'
      ) {
        return isIntegrationHeavy
      }

      return true
    })
    const stagedArtifacts = [...(input.artifacts ?? [])]

    for (const hook of resolvedHooks) {
      if (
        hook.produces_artifact_type &&
        !stagedArtifacts.some(
          (artifact) => artifact.artifactType === hook.produces_artifact_type,
        )
      ) {
        stagedArtifacts.push(
          buildHookArtifact(
            input.issueId,
            validation.toStatus,
            hook.hook_name,
            hook.produces_artifact_type,
            hook.resolvedOwnerRole,
            hook.resolvedTargetOwnerRole,
            hook.requestedRunKind,
          ),
        )
      }
    }

    const audit = await trx
      .insertInto('status_transition_audit')
      .values({
        issue_id: input.issueId,
        run_id: runtimeState.active_run_id,
        workflow_id: runtimeState.workflow_id,
        config_version: runtimeState.pinned_config_version,
        from_status_code: runtimeState.current_status_code,
        to_status_code: validation.toStatus,
        trigger_code: input.triggerCode,
        rule_id: validation.selectedRuleId,
        actor_type: input.actorType,
        actor_id: input.actorId,
        owner_role: validation.ownerRole,
        reason_code: input.reasonCode ?? null,
        reason_text: input.reasonText ?? null,
        comment_id: input.commentId ?? null,
        artifact_links: toJsonb(
          stagedArtifacts.map((artifact) => artifact.artifactUri),
        ),
        checkpoint_id: input.checkpointId ?? null,
        lease_id: input.leaseId ?? runtimeState.active_lease_id,
        metadata: input.metadata ?? {},
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    const runLifecycle = await applyRunLifecycle(trx, {
      issueId: input.issueId,
      workflowId: runtimeState.workflow_id,
      effectOnRun: validation.effectOnRun,
      openedRunKind: validation.openedRunKind,
      configVersion: runtimeState.pinned_config_version,
      existingRunId: runtimeState.active_run_id,
      transitionAuditId: audit.id,
    })

    if (runLifecycle.openedRunId) {
      await trx
        .updateTable('status_transition_audit')
        .set({ run_id: runLifecycle.openedRunId })
        .where('id', '=', audit.id)
        .execute()
    }

    const nextIsHumanGate = isHumanGateStatus(validation.toStatus)

    if (runtimeState.open_operator_question_id && validation.toStatus !== 'needs_input') {
      await trx
        .updateTable('artifact_registry')
        .set({ superseded_at: now })
        .where('id', '=', runtimeState.open_operator_question_id)
        .execute()
    }

    let openOperatorQuestionId: string | null =
      validation.toStatus === 'needs_input'
        ? runtimeState.open_operator_question_id
        : null

    for (const artifact of stagedArtifacts) {
      if (
        artifact.artifactType === 'operator_question' &&
        runtimeState.open_operator_question_id
      ) {
        await trx
          .updateTable('artifact_registry')
          .set({ superseded_at: now })
          .where('id', '=', runtimeState.open_operator_question_id)
          .execute()
      }

      const insertedArtifact = await trx
        .insertInto('artifact_registry')
        .values({
          issue_id: input.issueId,
          run_id:
            artifact.artifactScope === 'run' ? runLifecycle.activeRunId : null,
          transition_audit_id: audit.id,
          artifact_type: artifact.artifactType,
          artifact_scope: artifact.artifactScope,
          artifact_uri: artifact.artifactUri,
          artifact_summary: artifact.artifactSummary ?? null,
          produced_by_role: artifact.producedByRole ?? validation.ownerRole,
          produced_for_status_code: validation.toStatus,
          metadata: artifact.metadata ?? {},
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      if (artifact.artifactType === 'operator_question') {
        openOperatorQuestionId = insertedArtifact.id
      }
    }

    const runnerRequirementProfile = resolvedHooks.some(
      (hook) => hook.emits_command_type === 'create_runner_lease',
    )
      ? await loadLatestArtifactMetadata(
          trx,
          input.issueId,
          'runner_requirement_profile',
        )
      : null

    const contextPackFingerprint =
      typeof input.metadata?.contextPackFingerprint === 'string'
        ? input.metadata.contextPackFingerprint
        : null

    const outboxValues = resolvedHooks
      .filter((hook) => hook.emits_command_type)
      .map((hook) => {
        const commandType = hook.emits_command_type as string
        const commandKey = `${audit.id}:${hook.hook_order.toString()}:${commandType}`
        const commandRunId =
          commandType === 'release_runner_lease'
            ? runtimeState.active_run_id
            : runLifecycle.activeRunId

        return {
          transition_audit_id: audit.id,
          issue_id: input.issueId,
          run_id: commandRunId,
          command_type: commandType,
          command_payload: compileOutboxPayload({
            issueId: input.issueId,
            runId: commandRunId,
            workflowId: runtimeState.workflow_id,
            transitionAuditId: audit.id,
            configVersion: runtimeState.pinned_config_version,
            commandKey,
            commandType,
            body: buildOutboxCommandBody({
              commandType,
              toStatus: validation.toStatus,
              ownerRole: hook.resolvedOwnerRole,
              targetOwnerRole: hook.resolvedTargetOwnerRole,
              activeLeaseId: runtimeState.active_lease_id,
              requestedRunKind: hook.requestedRunKind,
              checkpointId: input.checkpointId ?? null,
              reasonCode: input.reasonCode ?? null,
              reasonText: input.reasonText ?? null,
              contextPackFingerprint,
              runnerRequirementProfile,
            }),
            issuedAt: now.toISOString(),
          }) as unknown as JsonObject,
          idempotency_key: commandKey,
        }
      })

    if (outboxValues.length > 0) {
      await trx.insertInto('workflow_effect_outbox').values(outboxValues).execute()
    }

    const nextActiveLeaseId = activeLeaseIdForTransition(
      validation.effectOnLease,
      runtimeState.active_lease_id,
      input.leaseId,
    )

    if (runLifecycle.openedRunId && nextActiveLeaseId) {
      await trx
        .updateTable('runner_leases')
        .set({
          run_id: runLifecycle.openedRunId,
          updated_at: now,
        })
        .where('lease_id', '=', nextActiveLeaseId)
        .execute()
    }

    const activeTimerIntents = nextIsHumanGate
      ? extractHumanGateTimerIntents(input.metadata)
      : []
    const suspendedFromStatusCode =
      validation.toStatus === 'needs_input' || validation.toStatus === 'blocked'
        ? runtimeState.current_status_code
        : null
    const resumeCondition =
      validation.toStatus === 'blocked' && suspendedFromStatusCode
        ? buildBlockedResumeCondition(suspendedFromStatusCode)
        : nextIsHumanGate
          ? buildHumanGateResumeCondition(
              validation.toStatus,
              activeTimerIntents,
              runtimeState.current_status_code,
            )
          : null

    await trx
      .updateTable('issue_runtime_state')
      .set({
        current_status_code: validation.toStatus,
        current_stage: validation.toStatus,
        active_run_id: runLifecycle.activeRunId,
        open_operator_question_id:
          nextIsHumanGate && openOperatorQuestionId ? openOperatorQuestionId : null,
        pause_reason_code: nextIsHumanGate ? input.reasonCode ?? null : null,
        pause_reason_text: nextIsHumanGate ? input.reasonText ?? null : null,
        resume_condition: resumeCondition,
        suspended_from_status_code: suspendedFromStatusCode,
        block_reason_code:
          validation.toStatus === 'blocked' ? input.reasonCode ?? null : null,
        block_reason_text:
          validation.toStatus === 'blocked' ? input.reasonText ?? null : null,
        blocked_by_issue_ids: toJsonb(
          validation.toStatus === 'blocked' ? input.blockedByIssueIds ?? [] : [],
        ),
        active_lease_id: nextActiveLeaseId,
        updated_at: now,
      })
      .where('issue_id', '=', input.issueId)
      .execute()

    await writeProjections(trx, {
      issueId: input.issueId,
      toStatus: validation.toStatus,
      ownerRole: validation.ownerRole,
      activeLeaseId: nextActiveLeaseId,
      activeRunId: runLifecycle.activeRunId,
      lastTransitionTrigger: input.triggerCode,
      blockedByIssueIds:
        validation.toStatus === 'blocked' ? input.blockedByIssueIds ?? [] : [],
      blockReasonCode:
        validation.toStatus === 'blocked' ? input.reasonCode ?? null : null,
      highRisk: effectiveHighRisk,
    })

    const linearSync = await enqueueLinearStateSyncCommand(trx, {
      issueId: input.issueId,
      transitionAuditId: audit.id,
      runId: runLifecycle.activeRunId,
      milestoneEvent: null,
    })

    return {
      transitionAuditId: audit.id,
      issueId: input.issueId,
      fromStatus: runtimeState.current_status_code,
      toStatus: validation.toStatus,
      activeRunId: runLifecycle.activeRunId,
      configVersion: runtimeState.pinned_config_version,
      openOperatorQuestionId,
      activeTimerIntents,
      outboxCommandCount: outboxValues.length + (linearSync.enqueued ? 1 : 0),
    }
  })
}
