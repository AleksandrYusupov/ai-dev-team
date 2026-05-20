import type { DbSession } from '@ai-dev-team/db'
import type { ValidatorErrorV1 } from '@ai-dev-team/shared'

import { evaluateGuardConditions } from './guard-evaluator.js'
import { validateRequiredArtifacts } from './artifact-policy.js'
import type {
  ApplyTransitionInput,
  TransitionValidationCandidate,
  TransitionValidationResult,
} from './types.js'

function buildValidatorError(input: {
  code: ValidatorErrorV1['code']
  message: string
  issueId: string
  triggerCode: string
  currentStatusCode: string
  candidateRuleIds?: string[]
  rejectedCandidates?: TransitionValidationCandidate[]
}): ValidatorErrorV1 {
  return {
    schemaVersion: 1,
    code: input.code,
    message: input.message,
    issueId: input.issueId,
    triggerCode: input.triggerCode,
    currentStatusCode: input.currentStatusCode,
    candidateRuleIds: input.candidateRuleIds ?? [],
    rejectedCandidates:
      input.rejectedCandidates?.map((candidate) => ({
        ruleId: candidate.ruleId,
        toStatus: candidate.toStatus,
        reasonCodes: [...candidate.reasonCodes],
      })) ?? [],
    metadata: {},
  }
}

export async function validateTransition(
  db: DbSession,
  input: ApplyTransitionInput,
): Promise<TransitionValidationResult> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .selectAll()
    .where('issue_id', '=', input.issueId)
    .executeTakeFirst()

  if (!runtimeState) {
    return {
      ok: false,
      error: buildValidatorError({
        code: 'runtime_state_not_found',
        message: `No runtime state found for ${input.issueId}`,
        issueId: input.issueId,
        triggerCode: input.triggerCode,
        currentStatusCode: '<missing>',
      }),
    }
  }

  const [candidateRules, persistedArtifacts] = await Promise.all([
    db
      .selectFrom('workflow_transition_rules')
      .selectAll()
      .where('config_version', '=', runtimeState.pinned_config_version)
      .where('from_status_code', '=', runtimeState.current_status_code)
      .where('trigger_code', '=', input.triggerCode)
      .where('is_enabled', '=', true)
      .orderBy('rule_id', 'asc')
      .execute(),
    db
      .selectFrom('artifact_registry')
      .selectAll()
      .where('issue_id', '=', input.issueId)
      .execute(),
  ])

  if (candidateRules.length === 0) {
    return {
      ok: false,
      error: buildValidatorError({
        code: 'no_matching_rule',
        message: `No transition rule found for ${runtimeState.current_status_code}:${input.triggerCode}:${runtimeState.pinned_config_version.toString()}`,
        issueId: input.issueId,
        triggerCode: input.triggerCode,
        currentStatusCode: runtimeState.current_status_code,
      }),
    }
  }

  const effectiveRequestedStatusCode =
    input.requestedStatusCode ??
    ((runtimeState.current_status_code === 'needs_input' ||
      runtimeState.current_status_code === 'blocked') &&
    runtimeState.suspended_from_status_code
      ? runtimeState.suspended_from_status_code
      : null)

  const guardOutcomes = input.guardOutcomes ?? {}
  const stagedArtifacts = input.artifacts ?? []
  const validCandidates: TransitionValidationCandidate[] = []
  const rejectedCandidates: TransitionValidationCandidate[] = []

  for (const candidate of candidateRules) {
    const reasonCodes: string[] = []

    if (!candidate.allowed_actor_types.includes(input.actorType)) {
      reasonCodes.push(`actor_type_not_allowed:${input.actorType}`)
    }

    if (
      effectiveRequestedStatusCode &&
      candidate.to_status_code !== effectiveRequestedStatusCode
    ) {
      reasonCodes.push(
        `requested_status_mismatch:${effectiveRequestedStatusCode}`,
      )
    }

    if (candidate.requires_reason_code && !input.reasonCode) {
      reasonCodes.push('missing_reason_code')
    }

    if (candidate.requires_checkpoint && !input.checkpointId) {
      reasonCodes.push('missing_checkpoint')
    }

    if (candidate.requires_active_run && !runtimeState.active_run_id) {
      reasonCodes.push('missing_active_run')
    }

    if (candidate.requires_human_approval && input.actorType !== 'human') {
      reasonCodes.push('human_approval_required')
    }

    reasonCodes.push(
      ...evaluateGuardConditions(candidate.guard_conditions, guardOutcomes),
    )

    reasonCodes.push(
      ...validateRequiredArtifacts({
        requiredArtifactTypes: candidate.required_artifact_types,
        artifactScope: candidate.artifact_scope,
        issueId: input.issueId,
        activeRunId: runtimeState.active_run_id,
        persistedArtifacts,
        stagedArtifacts,
      }),
    )

    const candidateResult = {
      ruleId: candidate.rule_id,
      toStatus: candidate.to_status_code,
      reasonCodes,
    }

    if (reasonCodes.length === 0) {
      validCandidates.push(candidateResult)
    } else {
      rejectedCandidates.push(candidateResult)
    }
  }

  if (validCandidates.length === 0) {
    return {
      ok: false,
      error: buildValidatorError({
        code: 'validation_failed',
        message: `Transition validation failed for ${input.issueId}`,
        issueId: input.issueId,
        triggerCode: input.triggerCode,
        currentStatusCode: runtimeState.current_status_code,
        candidateRuleIds: candidateRules.map((rule) => rule.rule_id),
        rejectedCandidates,
      }),
    }
  }

  if (validCandidates.length > 1) {
    return {
      ok: false,
      error: buildValidatorError({
        code: 'ambiguous_transition',
        message: `Transition validation is ambiguous for ${input.issueId}`,
        issueId: input.issueId,
        triggerCode: input.triggerCode,
        currentStatusCode: runtimeState.current_status_code,
        candidateRuleIds: validCandidates.map((candidate) => candidate.ruleId),
        rejectedCandidates,
      }),
    }
  }

  const selected = validCandidates[0]
  const selectedRule = candidateRules.find((rule) => rule.rule_id === selected.ruleId)

  if (!selectedRule) {
    return {
      ok: false,
      error: buildValidatorError({
        code: 'rule_not_loaded',
        message: `Selected transition rule ${selected.ruleId} was not loaded`,
        issueId: input.issueId,
        triggerCode: input.triggerCode,
        currentStatusCode: runtimeState.current_status_code,
        candidateRuleIds: [selected.ruleId],
      }),
    }
  }

  return {
    ok: true,
    selectedRuleId: selected.ruleId,
    toStatus: selected.toStatus,
    ownerRole: selectedRule.owner_role,
    effectOnRun: selectedRule.effect_on_run,
    openedRunKind: selectedRule.opened_run_kind,
    effectOnLease: selectedRule.effect_on_lease,
    candidateCount: candidateRules.length,
    rejectedCandidates,
  }
}
