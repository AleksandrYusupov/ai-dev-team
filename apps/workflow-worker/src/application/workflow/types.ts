import type {
  ActorType,
  EffectOnLease,
  EffectOnRun,
  LifecycleTimerIntentV1,
  RunKind,
  RunStatus,
  TransitionArtifactV1,
  ValidatorErrorV1,
} from '@ai-dev-team/shared'

import type { JsonObject } from '@ai-dev-team/db'

export type TransitionArtifactInput = TransitionArtifactV1

export interface BootstrapIssueInput {
  issueId: string
  workflowId: string
  actorId: string
  rawIssueArtifactUri?: string
  metadata?: JsonObject
}

export interface BootstrapIssueResult {
  transitionAuditId: string
  runtimeStateIssueId: string
  configVersion: number
}

export interface ApplyTransitionInput {
  issueId: string
  triggerCode: string
  requestedStatusCode?: string | null
  actorType: ActorType
  actorId: string
  reasonCode?: string | null
  reasonText?: string | null
  commentId?: string | null
  checkpointId?: string | null
  leaseId?: string | null
  blockedByIssueIds?: string[]
  guardOutcomes?: Record<string, boolean>
  artifacts?: TransitionArtifactInput[]
  metadata?: JsonObject
}

export interface TransitionValidationCandidate {
  ruleId: string
  toStatus: string
  reasonCodes: string[]
}

export interface TransitionValidationSuccess {
  ok: true
  selectedRuleId: string
  toStatus: string
  ownerRole: string
  effectOnRun: EffectOnRun
  openedRunKind: RunKind | null
  effectOnLease: EffectOnLease
  candidateCount: number
  rejectedCandidates: TransitionValidationCandidate[]
}

export interface TransitionValidationFailure {
  ok: false
  error: ValidatorErrorV1
}

export type TransitionValidationResult =
  | TransitionValidationSuccess
  | TransitionValidationFailure

export interface ApplyTransitionResult {
  transitionAuditId: string
  issueId: string
  fromStatus: string
  toStatus: string
  activeRunId: string | null
  configVersion: number
  openOperatorQuestionId: string | null
  activeTimerIntents: LifecycleTimerIntentV1[]
  outboxCommandCount: number
}

export interface RunLifecycleResult {
  activeRunId: string | null
  openedRunId: string | null
  closedRunId: string | null
  closedRunStatus: RunStatus | null
}
