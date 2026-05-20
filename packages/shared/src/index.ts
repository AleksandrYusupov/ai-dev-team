export const APP_ENVIRONMENTS = [
  'development',
  'test',
  'production',
] as const

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number]

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

export const DEFAULT_TEMPORAL_NAMESPACE = 'default'
export const DEFAULT_TEMPORAL_TASK_QUEUE = 'ai-dev-team'

export const ACTOR_TYPES = ['human', 'system', 'agent'] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

export const RUN_KINDS = ['build', 'review', 'deploy', 'rework_cycle'] as const
export type RunKind = (typeof RUN_KINDS)[number]

export const AGENT_PROVIDERS = ['codex', 'claude'] as const
export type AgentProvider = (typeof AGENT_PROVIDERS)[number]

export const RUNTIME_ROLE_ACTIVATION_MODES = [
  'active',
  'defined_only',
  'compatibility_only',
] as const
export type RuntimeRoleActivationMode =
  (typeof RUNTIME_ROLE_ACTIVATION_MODES)[number]

export const RUNTIME_ROLE_HUMAN_GATE_MODES = [
  'none',
  'conditional',
  'always',
] as const
export type RuntimeRoleHumanGateMode =
  (typeof RUNTIME_ROLE_HUMAN_GATE_MODES)[number]

export const MCP_SHARING_SCOPES = ['host', 'repo', 'exclusive'] as const
export type McpSharingScope = (typeof MCP_SHARING_SCOPES)[number]

export const MCP_REUSE_POLICIES = [
  'shared_by_scope',
  'exclusive_per_execution',
] as const
export type McpReusePolicy = (typeof MCP_REUSE_POLICIES)[number]

export const RUNNER_NODE_STATUSES = [
  'online',
  'degraded',
  'offline',
  'draining',
] as const
export type RunnerNodeStatus = (typeof RUNNER_NODE_STATUSES)[number]

export const PROVIDER_FALLBACK_REASONS = [
  'quota_exhausted',
  'rate_limited_exhausted',
  'auth_unavailable',
  'provider_unhealthy',
  'no_eligible_runner',
] as const
export type ProviderFallbackReason =
  (typeof PROVIDER_FALLBACK_REASONS)[number]

export const PROVIDER_FAILURE_CLASSES = [
  ...PROVIDER_FALLBACK_REASONS,
  'transport_error',
  'worker_error',
  'artifact_upload_failed',
  'provider_not_supported',
  'canceled',
] as const
export type ProviderFailureClass = (typeof PROVIDER_FAILURE_CLASSES)[number]

export const RUNNER_LEASE_STATUSES = [
  'requested',
  'acquired',
  'execution_started',
  'heartbeat_lost',
  'expired',
  'cancellation_requested',
  'completed',
  'failed',
  'released',
  'provider_fallback_exhausted',
] as const
export type RunnerLeaseStatus = (typeof RUNNER_LEASE_STATUSES)[number]

export const RUNNER_LEASE_ATTEMPT_STATUSES = [
  'requested',
  'acquired',
  'execution_started',
  'failed',
  'completed',
  'released',
  'abandoned_for_fallback',
] as const
export type RunnerLeaseAttemptStatus =
  (typeof RUNNER_LEASE_ATTEMPT_STATUSES)[number]

export const RUNNER_CANCEL_OUTCOMES = [
  'accepted',
  'already_terminal',
  'unsupported',
] as const
export type RunnerCancelOutcome = (typeof RUNNER_CANCEL_OUTCOMES)[number]

export const PROMPT_RESOLUTION_SOURCES = [
  'published_bundle',
  'compatibility_alias',
  'legacy_synthetic',
] as const
export type PromptResolutionSource =
  (typeof PROMPT_RESOLUTION_SOURCES)[number]

export const INTEGRATION_KINDS = [
  'external_api',
  'service_to_service',
  'webhook',
] as const
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]

export const AUTH_SCHEMES = [
  'api_key',
  'basic',
  'hmac',
  'oauth2_auth_code',
  'oauth2_client_credentials',
  'oauth2_device',
  'webhook_signature',
  'mtls',
] as const
export type AuthScheme = (typeof AUTH_SCHEMES)[number]

export const INTEGRATION_LABELS = [
  'area:integration',
  'int:external-api',
  'int:service-to-service',
  'int:webhook',
  'auth:api-key',
  'auth:oauth2-authcode',
  'auth:oauth2-client-credentials',
  'auth:oauth2-device',
  'auth:webhook-signature',
  'auth:mtls',
  'needs:vendor-console',
  'needs:secret-upload',
  'needs:oauth-consent',
  'needs:test-account',
  'needs:webhook-registration',
  'needs:redirect-uri',
  'sandbox:required',
  'sandbox:ready',
  'prod-access:requested',
  'prod-access:approved',
] as const
export type IntegrationLabel = (typeof INTEGRATION_LABELS)[number]

export const CREDENTIAL_SLOT_STATUSES = [
  'required',
  'awaiting_upload',
  'uploaded',
  'validated',
  'invalid',
  'expired',
  'revoked',
] as const
export type CredentialSlotStatus = (typeof CREDENTIAL_SLOT_STATUSES)[number]

export const OAUTH_CLIENT_TYPES = [
  'public',
  'confidential',
  'machine',
] as const
export type OAuthClientType = (typeof OAUTH_CLIENT_TYPES)[number]

export const OAUTH_CONSENT_STATUSES = [
  'pending',
  'consent_required',
  'callback_received',
  'validated',
  'failed',
  'expired',
  'revoked',
] as const
export type OAuthConsentStatus = (typeof OAUTH_CONSENT_STATUSES)[number]

export const TOKEN_HANDLE_STATUSES = [
  'active',
  'refresh_required',
  'expired',
  'revoked',
  'invalid',
] as const
export type TokenHandleStatus = (typeof TOKEN_HANDLE_STATUSES)[number]

export const WEBHOOK_REGISTRATION_STATUSES = [
  'required',
  'registered',
  'validated',
  'failed',
  'disabled',
] as const
export type WebhookRegistrationStatus =
  (typeof WEBHOOK_REGISTRATION_STATUSES)[number]

export const INTEGRATION_NETWORK_MODES = [
  'docs_allowlist',
  'sandbox_api_allowlist',
  'release_broker_only',
] as const
export type IntegrationNetworkMode =
  (typeof INTEGRATION_NETWORK_MODES)[number]

export const INTEGRATION_ARTIFACT_TYPES = [
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
export type IntegrationArtifactType =
  (typeof INTEGRATION_ARTIFACT_TYPES)[number]

export const RUN_STATUSES = [
  'open',
  'completed',
  'aborted',
  'superseded',
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const HOOK_TYPES = [
  'validation',
  'artifact_generation',
  'command_enqueue',
  'timer_enqueue',
  'sync_enqueue',
] as const
export type HookType = (typeof HOOK_TYPES)[number]

export const HOOK_FAILURE_MODES = [
  'block_transition',
  'retry',
  'move_to_blocked',
  'warn_only',
] as const
export type HookFailureMode = (typeof HOOK_FAILURE_MODES)[number]

export const EFFECT_ON_RUNS = [
  'none',
  'open',
  'continue',
  'close_success',
  'close_aborted',
  'resume',
] as const
export type EffectOnRun = (typeof EFFECT_ON_RUNS)[number]

export const EFFECT_ON_LEASES = [
  'none',
  'create',
  'release',
  'suspend',
  'resume',
  'restore',
] as const
export type EffectOnLease = (typeof EFFECT_ON_LEASES)[number]

export const ARTIFACT_SCOPES = [
  'issue',
  'run',
  'transition',
  'operator_question',
] as const
export type ArtifactScope = (typeof ARTIFACT_SCOPES)[number]

export const WORKFLOW_CONFIG_SET_STATUSES = [
  'draft',
  'published',
  'deprecated',
] as const
export type WorkflowConfigSetStatus =
  (typeof WORKFLOW_CONFIG_SET_STATUSES)[number]

export const LINEAR_PROJECT_UPDATE_HEALTHS = [
  'onTrack',
  'atRisk',
  'offTrack',
] as const
export type LinearProjectUpdateHealth =
  (typeof LINEAR_PROJECT_UPDATE_HEALTHS)[number]

export const LINEAR_SYNC_OUTCOMES = [
  'pending',
  'succeeded',
  'failed',
] as const
export type LinearSyncOutcome = (typeof LINEAR_SYNC_OUTCOMES)[number]

export const LINEAR_SYNC_MILESTONE_EVENT_CODES = [
  'pr_opened',
  'ci_failed',
  'ci_green',
  'deploy_failed',
  'deploy_healthy',
] as const
export type LinearSyncMilestoneEventCode =
  (typeof LINEAR_SYNC_MILESTONE_EVENT_CODES)[number]

export const OUTBOX_STATUSES = [
  'pending',
  'processing',
  'done',
  'failed',
  'dead_letter',
] as const
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number]

export const WEBHOOK_PROVIDERS = ['linear', 'github'] as const
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number]

export const WEBHOOK_SIGNATURE_STATUSES = [
  'verified',
  'failed',
  'missing',
] as const
export type WebhookSignatureStatus =
  (typeof WEBHOOK_SIGNATURE_STATUSES)[number]

export const RAW_EVENT_PROCESSING_STATUSES = [
  'received',
  'duplicate',
  'normalized',
  'dispatched',
  'ignored',
  'failed',
  'dead_letter',
] as const
export type RawEventProcessingStatus =
  (typeof RAW_EVENT_PROCESSING_STATUSES)[number]

export const LIFECYCLE_COMMAND_SIGNAL_NAMES = [
  'ingestCanonicalEvent',
  'ingestSystemCommand',
  'ingestTimerFired',
  'cancelOpenHumanGate',
] as const
export type LifecycleCommandSignalName =
  (typeof LIFECYCLE_COMMAND_SIGNAL_NAMES)[number]

export const LIFECYCLE_COMMAND_INBOX_STATUSES = [
  'pending',
  'processing',
  'accepted',
  'rejected',
  'failed',
  'dead_letter',
] as const
export type LifecycleCommandInboxStatus =
  (typeof LIFECYCLE_COMMAND_INBOX_STATUSES)[number]

export const LIFECYCLE_COMMAND_RESULT_STATUSES = [
  'accepted',
  'rejected',
  'duplicate',
] as const
export type LifecycleCommandResultStatus =
  (typeof LIFECYCLE_COMMAND_RESULT_STATUSES)[number]

export const VALIDATOR_ERROR_CODES = [
  'runtime_state_not_found',
  'no_matching_rule',
  'validation_failed',
  'ambiguous_transition',
  'rule_not_loaded',
] as const
export type ValidatorErrorCode = (typeof VALIDATOR_ERROR_CODES)[number]

export const LIFECYCLE_SNAPSHOT_QUERY_NAME = 'getLifecycleSnapshot'
export const ISSUE_LIFECYCLE_WORKFLOW_NAME = 'IssueLifecycleWorkflow'
export const COMMENT_RESPONSE_WORKFLOW_NAME = 'CommentResponseWorkflow'
export const INTEGRATION_ONBOARDING_WORKFLOW_NAME =
  'IntegrationOnboardingWorkflow'

export const CANONICAL_EVENT_CLASSIFICATIONS = [
  'transition_candidate',
  'metadata_refresh',
  'context_refresh',
  'sync_only',
  'ignored',
  'dead_letter',
] as const
export type CanonicalEventClassification =
  (typeof CANONICAL_EVENT_CLASSIFICATIONS)[number]

export const COMMENT_LOG_CLASSIFICATIONS = [
  'informational',
  'prompt',
  'answer_candidate',
  'manual_override_candidate',
  'deleted',
] as const
export type CommentLogClassification =
  (typeof COMMENT_LOG_CLASSIFICATIONS)[number]

export type SharedJsonPrimitive = boolean | number | string | null
export type SharedJsonValue =
  | SharedJsonPrimitive
  | SharedJsonObject
  | SharedJsonValue[]

export interface SharedJsonObject {
  [key: string]: SharedJsonValue
}

export const PROJECT_REPOSITORY_MAPPING_ROLES = [
  'primary',
  'affected',
] as const
export type ProjectRepositoryMappingRole =
  (typeof PROJECT_REPOSITORY_MAPPING_ROLES)[number]

export const KNOWLEDGE_SNAPSHOT_STATUSES = [
  'fresh',
  'stale',
  'failed',
] as const
export type KnowledgeSnapshotStatus =
  (typeof KNOWLEDGE_SNAPSHOT_STATUSES)[number]

export const PHASE4_ERROR_CODES = [
  'context_pack_budget_exceeded',
  'issue_contract_incomplete',
  'issue_contract_snapshot_not_found',
  'knowledge_snapshot_stale',
  'primary_repo_root_note_missing',
  'project_repository_mapping_ambiguous',
  'project_repository_mapping_not_found',
  'repository_registry_not_found',
] as const
export type Phase4ErrorCode = (typeof PHASE4_ERROR_CODES)[number]
export const CONTEXT_POLICY_VERSION = 1

export interface CanonicalEventEnvelope {
  envelopeVersion: number
  provider: WebhookProvider
  providerEventType: string
  providerAction: string | null
  deliveryId: string
  providerTimestamp: string | null
  receivedAt: string
  signatureVerified: boolean
  subjectType: string
  subjectId: string | null
  issueId: string | null
  commentId: string | null
  projectId: string | null
  repositoryId: string | null
  repositoryFullName: string | null
  installationId: string | null
  routingKey: string
  classification: CanonicalEventClassification
  triggerCandidate: string | null
  payloadRef: string
  metadata: Record<string, unknown>
}

export interface WorkflowConfigSummary {
  configVersion: number
  status: WorkflowConfigSetStatus
  isActiveForNewRuns: boolean
  publishedBy: string | null
  publishedAt: string | null
  notes: string | null
  createdAt: string
}

export interface WorkflowLinearStateMapping {
  statusCode: string
  linearStateName: string | null
  syncEnabled: boolean
}

export interface WorkflowLinearMilestonePolicy {
  eventCode: LinearSyncMilestoneEventCode
  eventLabel: string
  postComment: boolean
  createProjectUpdate: boolean
  projectUpdateHealth: LinearProjectUpdateHealth | null
}

export interface IssueRuntimeStateView {
  issueId: string
  currentStatusCode: string
  currentStage: string | null
  workflowId: string
  activeRunId: string | null
  pinnedConfigVersion: number
  openOperatorQuestionId: string | null
  pauseReasonCode: string | null
  pauseReasonText: string | null
  resumeCondition: Record<string, unknown> | null
  suspendedFromStatusCode: string | null
  blockReasonCode: string | null
  blockReasonText: string | null
  blockedByIssueIds: string[]
  activeLeaseId: string | null
  updatedAt: string
}

export interface StatusProjectionView {
  issueId: string
  currentStatusCode: string
  currentOwnerRole: string | null
  isBlocked: boolean
  isWaitingForInput: boolean
  needsHuman: boolean
  activeLeaseId: string | null
  activeRunId: string | null
  lastTransitionAt: string
  lastTransitionTrigger: string
  stuckForSeconds: number
  highRisk: boolean
}

export interface BlockedIssueProjectionView {
  issueId: string
  blockedByIssueIds: string[]
  blockedByExternal: boolean
  blockReasonCode: string | null
  since: string
}

export interface LifecycleCommandEnvelopeV1 {
  schemaVersion: 1
  commandKey: string
  issueId: string
  workflowId: string
  signalName: LifecycleCommandSignalName
  source: string
  sourceRef: string
  occurredAt: string
  actorType: ActorType
  actorId: string
  canonicalEventId?: string | null
  triggerCode?: string | null
  requestedStatusCode?: string | null
  commentId?: string | null
  reasonCode?: string | null
  reasonText?: string | null
  checkpointId?: string | null
  leaseId?: string | null
  blockedByIssueIds?: string[]
  guardOutcomes?: Record<string, boolean>
  artifacts?: TransitionArtifactV1[]
  metadata: SharedJsonObject
}

export interface TransitionArtifactV1 {
  artifactType: string
  artifactScope: ArtifactScope
  artifactUri: string
  artifactSummary?: string | null
  producedByRole?: string | null
  metadata?: SharedJsonObject
}

export interface ValidatorErrorCandidateV1 {
  ruleId: string
  toStatus: string
  reasonCodes: string[]
}

export interface ValidatorErrorV1 {
  schemaVersion: 1
  code: ValidatorErrorCode
  message: string
  issueId: string
  triggerCode: string
  currentStatusCode: string
  candidateRuleIds: string[]
  rejectedCandidates: ValidatorErrorCandidateV1[]
  metadata: SharedJsonObject
}

export interface LifecycleCommandResultV1 {
  schemaVersion: 1
  commandKey: string
  issueId: string
  workflowId: string
  status: LifecycleCommandResultStatus
  transitionAuditId: string | null
  fromStatusCode: string | null
  toStatusCode: string | null
  activeRunId: string | null
  validatorError: ValidatorErrorV1 | null
  intentPersistedOnly: boolean
  completionReason: string
  processedAt: string
  metadata: SharedJsonObject
}

export interface LifecycleHumanGateSummaryV1 {
  statusCode: string
  questionArtifactId: string | null
  decisionSummaryArtifactId?: string | null
  reasonCode: string | null
  reasonText: string | null
  openedAt: string | null
  reviewDisposition?: ReviewDisposition | null
  reviewedBuildArtifactId?: string | null
  contextPackFingerprint?: string | null
}

export interface LifecycleTimerIntentV1 {
  timerKey: string
  dueAt: string
  reason: string
}

export interface LifecycleSnapshotV1 {
  schemaVersion: 1
  issueId: string
  workflowId: string
  lastProcessedCommandKey: string | null
  recentCommandKeys: string[]
  openHumanGate: LifecycleHumanGateSummaryV1 | null
  activeTimerIntents: LifecycleTimerIntentV1[]
  versionMarker: number
  terminal: boolean
  updatedAt: string
}

export interface OutboxCommandEnvelopeV1 {
  schemaVersion: 1
  commandType: string
  issuedAt: string
  issueId: string
  runId: string | null
  workflowId: string
  transitionAuditId: string | null
  configVersion: number
  commandKey: string
  body: SharedJsonObject
  intentPersistedOnly?: boolean
}

export interface McpBindingRefV1 {
  serverName: string
  sharingScope: McpSharingScope
  bindingKey: string
  reused: boolean
  repoSlug: string | null
}

export const MCP_PROCESS_STATES = [
  'starting',
  'running',
  'stopped',
  'failed',
] as const
export type McpProcessStateV1 = (typeof MCP_PROCESS_STATES)[number]

export interface RunnerMcpPoolBindingSnapshotV1 {
  serverName: string
  sharingScope: McpSharingScope
  bindingKey: string
  repoSlug: string | null
  acquiredCount: number
  sessionCounts: Record<string, number>
  processState: McpProcessStateV1
  updatedAt: string
}

export interface RunnerMcpPoolSnapshotV1 {
  schemaVersion: 1
  runnerNodeId: string
  configHash: string
  capturedAt: string
  bindings: RunnerMcpPoolBindingSnapshotV1[]
}

export interface RunnerMcpPoolBindingView {
  runnerNodeId: string
  hostGroupId: string
  serverName: string
  sharingScope: McpSharingScope
  repoSlug: string | null
  bindingKey: string
  acquiredCount: number
  sessionCounts: Record<string, number>
  processState: McpProcessStateV1
  updatedAt: string
}

export interface RunnerMcpPoolSnapshotView {
  runnerNodeId: string
  hostGroupId: string
  updatedAt: string
  bindings: RunnerMcpPoolBindingView[]
}

export interface RoleExecutionPolicyV1 {
  ownerRole: string
  primaryProvider: AgentProvider
  secondaryProvider: AgentProvider
  fallbackTriggers: ProviderFallbackReason[]
  maxProviderFailovers: number
  mcpProfileRef: string
  requiredCapabilities: string[]
}

export interface RuntimeRoleHumanGatePolicyV1 {
  mode: RuntimeRoleHumanGateMode
  requiredHumanOwnedZones: string[]
  notes: string | null
}

export interface RuntimeRoleContractV1 {
  roleId: string
  canonicalRunKind: RunKind | null
  allowedStatusOwnership: string[]
  requiredInputArtifactTypes: string[]
  requiredOutputArtifactTypes: string[]
  humanGatePolicy: RuntimeRoleHumanGatePolicyV1
  escalationReasonCodes: string[]
  activationMode: RuntimeRoleActivationMode
}

export interface McpServerCatalogEntryV1 {
  serverName: string
  sharingScope: McpSharingScope
  reusePolicy: McpReusePolicy
  supportsConcurrentSessions: boolean
  configHash: string
}

export const RUNNER_SKILL_SYNC_STATUSES = ['ready', 'degraded'] as const
export type RunnerSkillSyncStatus =
  (typeof RUNNER_SKILL_SYNC_STATUSES)[number]

export interface RunnerInstalledSkillBundleV1 {
  releaseId: string
  fingerprint: string
  skillIds: string[]
}

export interface RunnerManagedSkillSummaryEntryV1 {
  skillId: string
  fingerprint: string
  providerCompatibility: AgentProvider[]
}

export interface RunnerManagedSkillSummaryV1 {
  schemaVersion: 1
  releaseId: string | null
  releaseFingerprint: string | null
  publishedAt: string | null
  skills: RunnerManagedSkillSummaryEntryV1[]
}

export interface RunnerManagedSkillPayloadEntryV1 {
  skillId: string
  fingerprint: string
  relativePath: string
  metaJson: string
  metaSha256: string
  skillMarkdown: string
  skillMarkdownSha256: string
  providerCompatibility: AgentProvider[]
}

export interface RunnerManagedSkillPayloadV1 {
  schemaVersion: 1
  releaseId: string
  releaseFingerprint: string
  publishedAt: string
  skillCount: number
  skills: RunnerManagedSkillPayloadEntryV1[]
}

export interface RunnerExecutionBundleRoleCharterV1 {
  roleCharterRef: string
  roleId: string
  charterVersion: string
  canonicalRunKind: RunKind | null
  frontmatterSummary: SharedJsonObject
  sourceRefs: string[]
  relativePath: string
  roleFingerprint: string
  body: string
}

export interface RunnerExecutionBundlePromptFamilyV1 {
  promptFamilyRef: string
  familyId: string
  familyVersion: string
  providerCompatibility: AgentProvider[]
  compatibleRoles: string[]
  compatibleSkillPacks: string[]
  sourceRefs: string[]
  relativePath: string
  familyFingerprint: string
  body: string
}

export interface RunnerExecutionBundleSkillPackV1 {
  packId: string
  packVersion: string
  purpose: string
  skillRefs: string[]
  optionalSkillRefs: string[]
  providers: AgentProvider[]
  activationConditions: SharedJsonObject
  promptFamilyRefs: string[]
  deniedActionsOverlay: string[]
  humanGateOverlay: SharedJsonObject
  sourceRefs: string[]
  skillPackFingerprint: string
}

export interface RunnerExecutionBundleSystemInstructionV1 {
  roleId: string
  instructionVersion: string | null
  relativePath: string
  resolutionSource: 'release_snapshot' | 'working_tree_fallback'
  body: string
}

export interface RunnerExecutionBundleV1 {
  schemaVersion: 1
  leaseAttemptId: string
  agentLibraryReleaseId: string
  agentLibraryFingerprint: string
  taskInstructionsRef: string
  promptVersion: string
  roleCharterRef: string
  promptBundleFingerprint: string
  resolvedPromptFamilyRefs: string[]
  skillPackRefs: string[]
  resolvedSkillRefs: string[]
  skippedOptionalSkillRefs: string[]
  systemInstruction: RunnerExecutionBundleSystemInstructionV1 | null
  roleCharter: RunnerExecutionBundleRoleCharterV1
  promptFamilies: RunnerExecutionBundlePromptFamilyV1[]
  skillPacks: RunnerExecutionBundleSkillPackV1[]
  runtimeRoleContract: RuntimeRoleContractV1
  roleExecutionPolicy: RoleExecutionPolicyV1
}

export interface RunnerCapabilityManifestV1 {
  schemaVersion: 1
  runnerNodeId: string
  hostGroupId: string
  manifestVersion: number
  providers: AgentProvider[]
  providerCliVersions: Partial<Record<AgentProvider, string>>
  supportedRoles: string[]
  supportedRunKinds: RunKind[]
  supportedRepoKinds: string[]
  mcpServerCatalog: McpServerCatalogEntryV1[]
  toolBaseline: string[]
  skillsAvailable: string[]
  activeAgentLibraryReleaseId?: string | null
  activeAgentLibraryFingerprint?: string | null
  skillSyncStatus?: RunnerSkillSyncStatus
  skillSyncError?: string | null
  installedSkillBundles?: RunnerInstalledSkillBundleV1[]
  workspaceRoot: string
  worktreeRoot: string
  maxConcurrentLeases: number
  supportsInterrupt: boolean
  supportsCheckpointResume: boolean
  supportsArtifactUpload: boolean
  supportsConcurrentSessions: boolean
  integration: IntegrationAgentCapabilityManifest
  host: {
    hostName: string
    hostOs: string
    hostArch: string
  }
  publishedAt: string
}

export interface RunnerLeaseAttemptV1 {
  schemaVersion: 1
  leaseId: string
  leaseAttemptId: string
  providerAttemptNo: number
  requestedProvider: AgentProvider
  effectiveProvider: AgentProvider
  fallbackFromProvider: AgentProvider | null
  fallbackReason: ProviderFallbackReason | null
  executionSessionKey: string
  mcpProfileRef: string
  mcpBindingsSummary: McpBindingRefV1[]
  runnerNodeId: string | null
  hostGroupId: string | null
  status: RunnerLeaseAttemptStatus
  checkpointRef: string | null
  cancelRequestedAt: string | null
  cancelAcknowledgedAt: string | null
  cancelOutcome: RunnerCancelOutcome | null
}

export interface RunnerManifestUpsertRequestV1 {
  schemaVersion: 1
  manifest: RunnerCapabilityManifestV1
}

export interface RunnerManifestUpsertResponseV1 {
  schemaVersion: 1
  accepted: boolean
}

export interface RunnerLeaseClaimRequestV1 {
  schemaVersion: 1
  runnerNodeId: string
  heartbeatExpiryAt: string
}

export interface RunnerLeaseClaimResponseV1 {
  schemaVersion: 1
  task: TaskEnvelopeV2 | null
}

export interface RunnerExecutionStartedRequestV1 {
  schemaVersion: 1
  runnerNodeId: string
  leaseAttemptId: string
  executionSessionKey: string
  mcpBindingsSummary: McpBindingRefV1[]
}

export interface RunnerHeartbeatRequestV1 {
  schemaVersion: 1
  runnerNodeId: string
  leaseAttemptId: string
  heartbeatExpiryAt: string
  mcpPoolSnapshot?: RunnerMcpPoolSnapshotV1 | null
}

export interface RunnerHeartbeatResponseV1 {
  schemaVersion: 1
  cancelRequested: boolean
}

export interface RunnerArtifactStageRequestV1 {
  schemaVersion: 1
  runnerNodeId: string
  leaseAttemptId: string
  artifactKey: string
  contentType: string
  contentBase64: string
  metadata: SharedJsonObject
}

export interface RunnerArtifactStageResponseV1 {
  schemaVersion: 1
  artifactId: string
  artifactUri: string
  contentSha256: string
  sizeBytes: number
}

export interface RunnerAttemptCancelRequestV1 {
  schemaVersion: 1
  runnerNodeId: string
  leaseAttemptId: string
  outcome: RunnerCancelOutcome
  checkpointRef: string | null
}

export interface RunnerAttemptCancelResponseV1 {
  schemaVersion: 1
  leaseStatus: RunnerLeaseStatus
  cancelOutcome: RunnerCancelOutcome
}

export interface TaskEnvelopeV2 {
  schemaVersion: 2
  leaseId: string
  leaseAttemptId: string
  issueId: string
  runId: string | null
  workflowId: string
  requestedProvider: AgentProvider
  effectiveProvider: AgentProvider
  providerAttemptNo: number
  fallbackFromProvider: AgentProvider | null
  fallbackReason: ProviderFallbackReason | null
  roleExecutionPolicyVersion: number
  agentRole: string
  runKind: RunKind | null
  repoSlug: string | null
  localCheckoutPath: string | null
  branchStrategy: string | null
  worktreePathHint: string | null
  contextPackRef: string | null
  contextPackFingerprint: string | null
  reviewedBuildArtifactId?: string | null
  checkpointRef: string | null
  executionSessionKey: string
  mcpProfileRef: string
  mcpBindingsSummary: McpBindingRefV1[]
  agentLibraryReleaseId: string | null
  taskInstructionsRef: string | null
  promptVersion: string | null
  roleCharterRef: string | null
  promptBundleFingerprint: string | null
  skillPackRefs: string[]
  effectiveSkillFingerprint: string | null
  toolBaseline: string[]
  expectedOutputs: string[]
  issuedAt: string
}

export const REVIEW_DISPOSITIONS = [
  'human_gate_required',
  'rework_recommended',
  'review_inconclusive',
] as const
export type ReviewDisposition = (typeof REVIEW_DISPOSITIONS)[number]

export type ReviewFindingV2 = SharedJsonObject

export interface ArtifactBundleV2 {
  schemaVersion: 2
  leaseId: string
  leaseAttemptId: string
  issueId: string
  runId: string | null
  requestedProvider: AgentProvider
  effectiveProvider: AgentProvider
  providerAttemptNo: number
  fallbackFromProvider: AgentProvider | null
  fallbackReason: ProviderFallbackReason | null
  roleExecutionPolicyVersion: number
  agentRole: string
  runKind?: RunKind | null
  status: 'completed' | 'failed' | 'canceled' | 'no_output'
  summary: string | null
  changedFiles: string[]
  testResults: SharedJsonObject[]
  patchRef: string | null
  branchRef: string | null
  reviewFindings: SharedJsonObject[]
  reviewDisposition?: ReviewDisposition | null
  decisionSummary?: string | null
  recommendedNextAction?: string | null
  reviewedBuildArtifactId?: string | null
  executionSessionKey: string
  mcpProfileRef: string
  mcpBindingsSummary: McpBindingRefV1[]
  toolUsage: string[]
  mcpBindings: McpBindingRefV1[]
  providerExecutionMetadata: SharedJsonObject
  guardOutcomes?: Record<string, boolean> | null
  producedAt: string
}

export interface RunnerAttemptCompletionRequestV1 {
  schemaVersion: 1
  runnerNodeId: string
  artifactBundle: ArtifactBundleV2
  executionMetadata: AgentExecutionMetadataV2
}

export interface RunnerAttemptFailureRequestV1 {
  schemaVersion: 1
  runnerNodeId: string
  leaseAttemptId: string
  errorClass: ProviderFailureClass
  errorMessage: string
  fallbackReason: ProviderFallbackReason | null
  checkpointRef: string | null
  supportsCheckpointResume: boolean
  executionMetadata: AgentExecutionMetadataV2 | null
}

export interface AgentExecutionMetadataV2 {
  schemaVersion: 2
  agentRole: string
  promptVersion: string
  agentLibraryReleaseId: string | null
  taskInstructionsRef: string | null
  roleCharterRef: string | null
  promptBundleFingerprint: string | null
  resolvedPromptFamilyRefs: string[]
  skillPackRefs: string[]
  resolvedSkillRefs: string[]
  skippedOptionalSkillRefs: string[]
  effectiveSkillFingerprint: string | null
  contextPackFingerprint: string | null
  reviewedBuildArtifactId?: string | null
  configVersion: number
  workflowId: string
  workflowRunId: string | null
  runKind: RunKind | null
  attemptNo: number
  requestedProvider: AgentProvider | null
  effectiveProvider: AgentProvider | null
  providerAttemptNo: number | null
  fallbackFromProvider: AgentProvider | null
  fallbackReason: ProviderFallbackReason | null
  toolsUsed: string[]
  mcpBindings: McpBindingRefV1[]
  runnerNodeId: string | null
  hostGroupId: string | null
  executionDurationMs: number
  completionReason: string
}
export type AgentExecutionMetadataV1 = AgentExecutionMetadataV2

export interface RunnerContextPackResourceV1 {
  schemaVersion: 1
  contextPackId: string
  issueId: string
  inputFingerprint: string
  bundle: ContextPack
  createdAt: string
}

export interface RunnerArtifactResourceV1 {
  schemaVersion: 1
  artifactId: string
  issueId: string
  runId: string | null
  artifactType: string
  artifactUri: string
  artifactSummary: string | null
  metadata: SharedJsonObject
  producedAt: string
  supersededAt: string | null
}

export interface RunnerInventoryView {
  runnerNodeId: string
  hostGroupId: string
  displayName: string
  hostName: string
  status: RunnerNodeStatus
  providers: AgentProvider[]
  currentActiveLeaseCount: number
  maxConcurrentLeases: number
  manifestVersion: number
  lastHeartbeatAt: string | null
  heartbeatExpiresAt: string | null
  sharedMcpProcessCount: number
  mcpServerCatalog: McpServerCatalogEntryV1[]
  skillsAvailable: string[]
  activeAgentLibraryReleaseId: string | null
  activeAgentLibraryFingerprint: string | null
  skillSyncStatus: RunnerSkillSyncStatus
  skillSyncError: string | null
  installedSkillBundles: RunnerInstalledSkillBundleV1[]
  providerSupportedSkillPackRefs: Partial<Record<AgentProvider, string[]>>
  integrationCapabilities: IntegrationAgentCapabilityManifest
}

export interface RunnerLeaseView {
  leaseId: string
  issueId: string
  runId: string | null
  workflowId: string
  requestedProvider: AgentProvider
  requestedOwnerRole: string
  requestedRunKind: RunKind | null
  roleExecutionPolicyVersion: number
  agentLibraryReleaseId: string | null
  promptVersion: string | null
  taskInstructionsRef: string | null
  roleCharterRef: string | null
  promptBundleFingerprint: string | null
  skillPackRefs: string[]
  effectiveSkillFingerprint: string | null
  contextPackFingerprint: string | null
  promptResolutionSource: PromptResolutionSource
  status: RunnerLeaseStatus
  assignedRunnerNodeId: string | null
  requestedAt: string
  acquiredAt: string | null
  executionStartedAt: string | null
  lastHeartbeatAt: string | null
  heartbeatExpiresAt: string | null
  failedAt: string | null
  completedAt: string | null
  releasedAt: string | null
  releasedReasonCode: string | null
  attemptCount: number
  lastError: string | null
}

export interface RunnerLeaseAttemptView {
  leaseAttemptId: string
  leaseId: string
  providerAttemptNo: number
  requestedProvider: AgentProvider
  effectiveProvider: AgentProvider
  fallbackFromProvider: AgentProvider | null
  fallbackReason: ProviderFallbackReason | null
  executionSessionKey: string
  mcpProfileRef: string
  mcpBindingsSummary: McpBindingRefV1[]
  installedSkillRefs: string[]
  resolvedSkillRefs: string[]
  skippedOptionalSkillRefs: string[]
  runnerNodeId: string | null
  hostGroupId: string | null
  status: RunnerLeaseAttemptStatus
  acquiredAt: string | null
  executionStartedAt: string | null
  lastHeartbeatAt: string | null
  failedAt: string | null
  completedAt: string | null
  releasedAt: string | null
  errorClass: ProviderFailureClass | null
  errorMessage: string | null
  checkpointRef: string | null
  cancelRequestedAt: string | null
  cancelAcknowledgedAt: string | null
  cancelOutcome: RunnerCancelOutcome | null
}

export interface RunnerLeaseTimelineEventView {
  event:
    | 'requested'
    | 'acquired'
    | 'execution_started'
    | 'cancel_requested'
    | 'cancel_acknowledged'
    | 'heartbeat_lost'
    | 'expired'
    | 'failed'
    | 'completed'
    | 'released'
  at: string
  scope: 'lease' | 'attempt'
  leaseAttemptId: string | null
  providerAttemptNo: number | null
  status: RunnerLeaseStatus | RunnerLeaseAttemptStatus | null
}

export type RunnerLeaseTimelineV1 = RunnerLeaseTimelineEventView[]

export interface RunnerLeaseDetailView {
  lease: RunnerLeaseView
  attempts: RunnerLeaseAttemptView[]
  timeline: RunnerLeaseTimelineV1
}

export interface ProviderFailoverMetricsView {
  totalLeases: number
  fallbackTriggeredCount: number
  providerFallbackExhaustedCount: number
  providerLimitExhaustionEvents: number
  fallbackReasonCounts: Record<string, number>
  mcpPoolReuseRatio: number | null
  sharedMcpProcessCount: number
}

export interface HealthReport {
  status: 'ok'
  service: string
  environment: AppEnvironment
  version: string
  time: string
}

export interface RepositoryRegistryRecord {
  repoSlug: string
  githubOwner: string
  githubRepo: string
  defaultBranch: string
  visibility: string
  linearTeamId: string
  obsidianRootNote: string
  agentGuidanceScope: string
  localCheckoutPath: string | null
  requiredChecks: string[]
  environments: string[]
  repoKind: string
  serviceDependencies: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProjectRepositoryMapping {
  id: string
  linearProjectId: string
  repoSlug: string
  mappingRole: ProjectRepositoryMappingRole
  priorityOrder: number
  createdAt: string
  updatedAt: string
}

export interface ProjectRepositoryMappingView {
  linearProjectId: string
  primaryRepo: string
  affectedRepos: string[]
  mappings: ProjectRepositoryMapping[]
}

export interface IssueLinearSyncRepositoryLinkView {
  issueId: string
  repoSlug: string
  branchRef: string | null
  prNumber: number | null
  prUrl: string | null
  prState: string | null
  latestCheckConclusion: string | null
  latestCheckUrl: string | null
  latestDeploymentEnv: string | null
  latestDeploymentState: string | null
  latestDeploymentUrl: string | null
  lastSyncedPayloadHash: string | null
  lastSyncOutcome: LinearSyncOutcome | null
  lastSyncError: string | null
  lastSyncAt: string | null
  updatedAt: string
  createdAt: string
}

export interface IssueLinearSyncProjectionView {
  issueId: string
  projectId: string | null
  repositories: IssueLinearSyncRepositoryLinkView[]
}

export interface IssueContractVerificationPath {
  automated: string[]
  manual: string[]
}

export interface IssueContractDependencies {
  blocks: string[]
  blockedBy: string[]
  external: string[]
}

export interface IntegrationCredentialRequirement {
  key: string
  label: string
  environment: string
  optional: boolean
  description: string | null
}

export interface IssueContract {
  project: string | null
  primaryRepo: string | null
  affectedRepos: string[]
  goal: string
  background: string | null
  scope: string[]
  nonGoals: string[]
  acceptanceCriteria: string[]
  verificationPath: IssueContractVerificationPath
  docsLinks: string[]
  dependencies: IssueContractDependencies
  risk: string | null
  doneWhen: string[]
  openQuestions: string[]
  humanDecisionRequired: boolean | null
  issueType: string | null
  source: string | null
  mode: string | null
  providerName?: string | null
  integrationKind?: IntegrationKind | null
  authScheme?: AuthScheme | null
  requiredCredentials?: IntegrationCredentialRequirement[]
  secretSlots?: string[]
  requiredScopes?: string[]
  oauthRedirectUris?: string[]
  sandboxAccountRequired?: boolean | null
  webhookRequired?: boolean | null
  webhookCallbackUrls?: string[]
  rateLimitNotes?: string | null
  errorModel?: string[]
  testStrategy?: string[]
  goLiveChecklist?: string[]
  rollbackPlan?: string[]
}

export interface IssueContractSnapshot {
  id: string
  issueId: string
  snapshotHash: string
  primaryRepo: string | null
  affectedRepos: string[]
  docsLinks: string[]
  risk: string | null
  dependencies: IssueContractDependencies
  contractJson: IssueContract
  createdAt: string
}

export interface KnowledgeNoteSnapshot {
  id: string
  notePath: string
  noteTitle: string
  rootTag: string
  contentHash: string
  resolvedLinks: string[]
  sanitizedMarkdown: string
  summaryMarkdown: string
  sourceUpdatedAt: string | null
  ingestedAt: string
  snapshotStatus: KnowledgeSnapshotStatus
  lastError: string | null
}

export interface ContextPackIssueSection {
  issueId: string
  goal: string
  background: string | null
  scope: string[]
  nonGoals: string[]
  acceptanceCriteria: string[]
  verificationPath: IssueContractVerificationPath
  doneWhen: string[]
  risk: string | null
  dependencies: IssueContractDependencies
  primaryRepo: string
  affectedRepos: string[]
  docsLinks: string[]
  openQuestions: string[]
  issueType: string | null
  source: string | null
  mode: string | null
  humanDecisionRequired: boolean | null
  providerName?: string | null
  integrationKind?: IntegrationKind | null
  authScheme?: AuthScheme | null
  requiredCredentials?: IntegrationCredentialRequirement[]
  secretSlots?: string[]
  requiredScopes?: string[]
  oauthRedirectUris?: string[]
  sandboxAccountRequired?: boolean | null
  webhookRequired?: boolean | null
  webhookCallbackUrls?: string[]
  rateLimitNotes?: string | null
  errorModel?: string[]
  testStrategy?: string[]
  goLiveChecklist?: string[]
  rollbackPlan?: string[]
}

export interface ContextPackRepositorySection {
  repoSlug: string
  githubOwner: string
  githubRepo: string
  defaultBranch: string
  repoKind: string
  requiredChecks: string[]
  environments: string[]
  agentGuidanceScope: string
}

export interface ContextPackComment {
  providerCommentId: string
  classification: CommentLogClassification
  bodyMarkdown: string
  containsAsk: boolean
  sourceCreatedAt: string
  sourceUpdatedAt: string | null
  authorActorType: string
  authorActorId: string
}

export interface ContextPackNote {
  notePath: string
  noteTitle: string
  contentHash: string
  summaryMarkdown: string
  excerptMarkdown: string
  truncated: boolean
  snapshotStatus: KnowledgeSnapshotStatus
}

export interface ContextPackGuidanceEntry {
  repoSlug: string
  filePath: string
  contentHash: string
  excerptMarkdown: string
  truncated: boolean
}

export interface ContextPackIntegrationArtifact {
  artifactId: string
  artifactType: IntegrationArtifactType
  artifactUri: string
  artifactSummary: string | null
  producedByRole: string | null
  producedAt: string
}

export interface ContextPackBudgets {
  contextPolicyVersion: number
  estimatedTokens: number
  maxTokens: number
  commentCount: number
  noteCount: number
  truncatedSections: string[]
}

export interface ContextPackSourceTraceNoteRef {
  id: string
  notePath: string
  contentHash: string
}

export interface ContextPackSourceTraceGuidanceRef {
  repoSlug: string
  filePath: string
  contentHash: string
}

export interface ContextPackSourceTraceCommentRef {
  providerCommentId: string
  sourceCreatedAt: string
  sourceUpdatedAt: string | null
}

export interface ContextPackSourceTraceArtifactRef {
  artifactId: string
  artifactType: IntegrationArtifactType
  producedAt: string
}

export interface ContextPackSourceTrace {
  issueContractSnapshotId: string
  issueContractSnapshotHash: string
  mappingIds: string[]
  noteSnapshotRefs: ContextPackSourceTraceNoteRef[]
  repoGuidanceRefs: ContextPackSourceTraceGuidanceRef[]
  commentRefs: ContextPackSourceTraceCommentRef[]
  artifactRefs?: ContextPackSourceTraceArtifactRef[]
  warnings: string[]
}

export interface ContextPack {
  issue: ContextPackIssueSection
  repositories: ContextPackRepositorySection[]
  decisionSummary: string[]
  latestRelevantComments: ContextPackComment[]
  docsPack: ContextPackNote[]
  repoGuidance: ContextPackGuidanceEntry[]
  integrationArtifacts?: ContextPackIntegrationArtifact[]
  budgets: ContextPackBudgets
  sourceTrace: ContextPackSourceTrace
}

export interface IntegrationAgentCapabilityManifest {
  networkModesSupported: IntegrationNetworkMode[]
  allowedDocDomains: string[]
  allowedSandboxDomains: string[]
  supportsBrowserConsent: boolean
  supportsSecretBroker: boolean
  supportsOAuthBroker: boolean
  supportsIntegrationLab: boolean
}

export interface CredentialSlotRecordV1 {
  schemaVersion: 1
  id: string
  issueId: string
  providerName: string
  credentialKey: string
  environment: string
  secretAlias: string
  ownerActorType: string
  ownerActorId: string
  authScheme: AuthScheme
  status: CredentialSlotStatus
  scopes: string[]
  metadata: SharedJsonObject
  validationCheckedAt: string | null
  expiresAt: string | null
  rotatedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface OAuthClientRegistrationRecordV1 {
  schemaVersion: 1
  id: string
  issueId: string
  providerName: string
  environment: string
  clientType: OAuthClientType
  authScheme: AuthScheme
  clientIdAlias: string
  clientSecretAlias: string | null
  redirectUris: string[]
  scopes: string[]
  registrationState: string
  metadata: SharedJsonObject
  createdAt: string
  updatedAt: string
}

export interface OAuthConsentSessionRecordV1 {
  schemaVersion: 1
  id: string
  issueId: string
  providerName: string
  registrationId: string | null
  state: string
  pkceVerifierAlias: string | null
  codeChallengeMethod: string | null
  requestedScopes: string[]
  grantedScopes: string[]
  status: OAuthConsentStatus
  consentUrl: string | null
  callbackReceivedAt: string | null
  completedAt: string | null
  lastError: string | null
  metadata: SharedJsonObject
  createdAt: string
  updatedAt: string
}

export interface TokenHandleRecordV1 {
  schemaVersion: 1
  id: string
  issueId: string
  providerName: string
  consentSessionId: string | null
  tokenKind: string
  secretAlias: string
  status: TokenHandleStatus
  scopes: string[]
  expiresAt: string | null
  rotatedAt: string | null
  lastCheckedAt: string | null
  lastError: string | null
  metadata: SharedJsonObject
  createdAt: string
  updatedAt: string
}

export interface WebhookRegistrationRecordV1 {
  schemaVersion: 1
  id: string
  issueId: string
  providerName: string
  environment: string
  callbackUrl: string
  eventTypes: string[]
  signingSecretAlias: string | null
  status: WebhookRegistrationStatus
  lastValidatedAt: string | null
  lastError: string | null
  metadata: SharedJsonObject
  createdAt: string
  updatedAt: string
}

export interface IntegrationValidationRunRecordV1 {
  schemaVersion: 1
  id: string
  issueId: string
  providerName: string
  validationType: string
  environment: string
  status: 'pending' | 'passed' | 'failed'
  summary: string | null
  artifactId: string | null
  metadata: SharedJsonObject
  executedAt: string
}

export interface SecretBrokerCredentialSlotRefV1 {
  schemaVersion: 1
  slotId: string
  issueId: string
  providerName: string
  credentialKey: string
  environment: string
  secretAlias: string
  authScheme: AuthScheme
  status: CredentialSlotStatus
}

export interface SecretBrokerCredentialValidationResultV1 {
  schemaVersion: 1
  slotId: string
  issueId: string
  status: CredentialSlotStatus
  validatedAt: string | null
  error: string | null
}

export interface OAuthBrokerConsentSessionRefV1 {
  schemaVersion: 1
  sessionId: string
  issueId: string
  providerName: string
  registrationId: string | null
  status: OAuthConsentStatus
  requestedScopes: string[]
  grantedScopes: string[]
  callbackReceivedAt: string | null
  completedAt: string | null
  error: string | null
}

export interface OAuthBrokerConsentResultV1 {
  schemaVersion: 1
  sessionId: string
  issueId: string
  providerName: string
  status: OAuthConsentStatus
  grantedScopes: string[]
  callbackReceivedAt: string | null
  completedAt: string | null
  error: string | null
}

export interface OAuthConsentSessionViewV1 {
  schemaVersion: 1
  sessionId: string
  issueId: string
  providerName: string
  status: OAuthConsentStatus
  requestedScopes: string[]
  grantedScopes: string[]
  consentUrl: string | null
  receivedAt: string | null
  completedAt: string | null
  error: string | null
}

export interface IntegrationLabValidationRequestV1 {
  schemaVersion: 1
  issueId: string
  providerName: string
  validationType: string
  environment: string
  networkMode: IntegrationNetworkMode
  allowedDomains: string[]
  authScheme: AuthScheme | null
  webhookRequired: boolean
}

export interface IntegrationLabValidationResultV1 {
  schemaVersion: 1
  issueId: string
  providerName: string
  validationType: string
  environment: string
  status: 'pending' | 'passed' | 'failed'
  summary: string | null
  artifactId: string | null
  executedAt: string
}

export * from './ingress.js'
