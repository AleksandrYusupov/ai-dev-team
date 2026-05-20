import type { ColumnType, Generated } from 'kysely'

import type {
  AgentProvider,
  AuthScheme,
  ArtifactScope,
  CredentialSlotStatus,
  CommentLogClassification,
  ContextPack,
  ContextPackSourceTrace,
  McpBindingRefV1,
  McpServerCatalogEntryV1,
  EffectOnLease,
  EffectOnRun,
  HookFailureMode,
  HookType,
  IntegrationAgentCapabilityManifest,
  IssueContract,
  KnowledgeSnapshotStatus,
  LifecycleCommandInboxStatus,
  LinearProjectUpdateHealth,
  LinearSyncMilestoneEventCode,
  LinearSyncOutcome,
  OAuthClientType,
  OAuthConsentStatus,
  ProviderFailureClass,
  ProviderFallbackReason,
  PromptResolutionSource,
  RawEventProcessingStatus,
  OutboxStatus,
  ProjectRepositoryMappingRole,
  RuntimeRoleActivationMode,
  RuntimeRoleHumanGatePolicyV1,
  RunKind,
  RunnerCancelOutcome,
  RunnerLeaseAttemptStatus,
  RunnerLeaseStatus,
  RunnerInstalledSkillBundleV1,
  RunnerNodeStatus,
  RunnerSkillSyncStatus,
  RunStatus,
  TokenHandleStatus,
  WebhookProvider,
  WebhookRegistrationStatus,
  WebhookSignatureStatus,
  WorkflowConfigSetStatus,
} from '@ai-dev-team/shared'

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

type JsonColumn<T> = ColumnType<T, T | string, T | string>
type JsonColumnWithDefault<T> = ColumnType<T, T | string | undefined, T | string>
type NullableColumn<T> = ColumnType<T | null, T | null | undefined, T | null>
type AgentPromptBundleResolutionMode = 'canonical' | 'compatibility_alias'

export interface BootstrapMarkersTable {
  id: Generated<number>
  name: string
  created_at: Generated<Date>
}

export interface WorkflowConfigSetsTable {
  config_version: number
  status: WorkflowConfigSetStatus
  is_active_for_new_runs: Generated<boolean>
  published_by: string | null
  published_at: Date | null
  notes: string | null
  created_at: Generated<Date>
}

export interface WorkflowStatusCatalogTable {
  id: Generated<string>
  code: string
  label: string
  group_code: string
  kind: string
  is_terminal: boolean
  manual_entry_allowed: boolean
  manual_exit_allowed: boolean
  requires_human: boolean
  blocks_execution: boolean
  sort_order: number
  description: string
  config_version: number
  created_at: Generated<Date>
}

export interface WorkflowTriggerCatalogTable {
  id: Generated<string>
  code: string
  actor_type: string
  is_manual: boolean
  requires_comment: boolean
  requires_artifact: boolean
  description: string
  config_version: number
  created_at: Generated<Date>
}

export interface WorkflowTransitionRulesTable {
  id: Generated<string>
  rule_id: string
  from_status_code: string
  to_status_code: string
  trigger_code: string
  owner_role: string
  allowed_actor_types: JsonColumn<string[]>
  guard_conditions: JsonColumn<string[]>
  required_artifact_types: JsonColumn<string[]>
  artifact_scope: ArtifactScope
  requires_reason_code: boolean
  requires_checkpoint: boolean
  requires_active_run: boolean
  requires_human_approval: boolean
  effect_on_run: EffectOnRun
  opened_run_kind: RunKind | null
  effect_on_lease: EffectOnLease
  notes: string
  config_version: number
  is_enabled: Generated<boolean>
  created_at: Generated<Date>
}

export interface WorkflowStatusEntryHooksTable {
  id: Generated<string>
  status_code: string
  hook_order: number
  hook_type: HookType
  hook_name: string
  owner_role: string
  target_owner_role: string | null
  is_required: boolean
  failure_mode: HookFailureMode
  produces_artifact_type: string | null
  emits_command_type: string | null
  notes: string
  config_version: number
  created_at: Generated<Date>
}

export interface WorkflowReasonCodesTable {
  id: Generated<string>
  code: string
  category: string
  description: string
  allowed_on_transitions: JsonColumn<string[]>
  config_version: number
  created_at: Generated<Date>
}

export interface WorkflowRoleExecutionPoliciesTable {
  id: Generated<string>
  owner_role: string
  primary_provider: AgentProvider
  secondary_provider: AgentProvider
  fallback_triggers: JsonColumn<ProviderFallbackReason[]>
  max_provider_failovers: number
  mcp_profile_ref: string
  required_capabilities: JsonColumn<string[]>
  config_version: number
  created_at: Generated<Date>
}

export interface WorkflowRuntimeRoleContractsTable {
  id: Generated<string>
  role_id: string
  canonical_run_kind: RunKind | null
  allowed_status_ownership: JsonColumn<string[]>
  required_input_artifact_types: JsonColumn<string[]>
  required_output_artifact_types: JsonColumn<string[]>
  human_gate_policy: JsonColumn<RuntimeRoleHumanGatePolicyV1>
  escalation_reason_codes: JsonColumn<string[]>
  activation_mode: RuntimeRoleActivationMode
  config_version: number
  created_at: Generated<Date>
}

export interface WorkflowLinearStateMappingsTable {
  id: Generated<string>
  status_code: string
  linear_state_name: string | null
  sync_enabled: Generated<boolean>
  config_version: number
  created_at: Generated<Date>
}

export interface WorkflowLinearMilestonePoliciesTable {
  id: Generated<string>
  event_code: LinearSyncMilestoneEventCode
  event_label: string
  post_comment: Generated<boolean>
  create_project_update: Generated<boolean>
  project_update_health: LinearProjectUpdateHealth | null
  config_version: number
  created_at: Generated<Date>
}

export interface AgentLibraryReleasesTable {
  release_id: string
  library_id: string
  library_version: string
  library_fingerprint: string
  published_at: Date
  published_by: string
  source_library_fingerprint: string
  is_active_for_new_runs: Generated<boolean>
  created_at: Generated<Date>
}

export interface AgentRoleChartersTable {
  id: Generated<string>
  release_id: string
  role_id: string
  charter_version: string
  canonical_run_kind: RunKind | null
  frontmatter_json: JsonColumn<JsonObject>
  source_refs: JsonColumn<string[]>
  body: string
  relative_path: string
  role_fingerprint: string
  created_at: Generated<Date>
}

export interface AgentPromptFamiliesTable {
  id: Generated<string>
  release_id: string
  prompt_family_ref: string
  family_id: string
  family_version: string
  provider_compatibility: JsonColumn<AgentProvider[]>
  compatible_roles: JsonColumn<string[]>
  compatible_skill_packs: JsonColumn<string[]>
  source_refs: JsonColumn<string[]>
  body: string
  relative_path: string
  family_fingerprint: string
  created_at: Generated<Date>
}

export interface AgentSkillPacksTable {
  id: Generated<string>
  release_id: string
  pack_id: string
  pack_version: string
  purpose: string
  skill_refs: JsonColumn<string[]>
  optional_skill_refs: JsonColumn<string[]>
  providers: JsonColumn<AgentProvider[]>
  activation_conditions: JsonColumn<JsonObject>
  prompt_family_refs: JsonColumn<string[]>
  denied_actions_overlay: JsonColumn<string[]>
  human_gate_overlay: JsonColumn<JsonObject>
  source_refs: JsonColumn<string[]>
  skill_pack_fingerprint: string
  created_at: Generated<Date>
}

export interface AgentPromptBundlesTable {
  id: Generated<string>
  release_id: string
  role_id: string
  prompt_bundle_ref: string
  role_charter_ref: string
  prompt_version: string
  prompt_bundle_fingerprint: string
  default_skill_pack_refs: JsonColumn<string[]>
  default_prompt_family_refs: JsonColumn<string[]>
  resolution_mode: AgentPromptBundleResolutionMode
  created_at: Generated<Date>
}

export interface AgentRoutingSkillPackRulesTable {
  id: Generated<string>
  release_id: string
  rule_id: string
  statuses: JsonColumn<string[]>
  triggers: JsonColumn<string[]>
  task_types: JsonColumn<string[]>
  requires_integration: boolean | null
  add_skill_pack_refs: JsonColumn<string[]>
  notes: string
  created_at: Generated<Date>
}

export interface IssueRunsTable {
  id: Generated<string>
  issue_id: string
  workflow_id: string
  sequence_no: number
  run_kind: RunKind
  status: RunStatus
  config_version: number
  opened_by_transition_id: string
  closed_by_transition_id: string | null
  branch_ref: string | null
  runner_requirements: JsonColumn<JsonObject>
  checkpoint_id: string | null
  agent_library_release_id: string | null
  agent_library_fingerprint: string | null
  opened_at: Generated<Date>
  closed_at: Date | null
}

export interface StatusTransitionAuditTable {
  id: Generated<string>
  issue_id: string
  run_id: string | null
  workflow_id: string | null
  config_version: number
  from_status_code: string | null
  to_status_code: string
  trigger_code: string
  rule_id: string | null
  actor_type: string
  actor_id: string
  owner_role: string | null
  reason_code: string | null
  reason_text: string | null
  comment_id: string | null
  artifact_links: JsonColumn<string[]>
  checkpoint_id: string | null
  lease_id: string | null
  metadata: JsonColumn<JsonObject>
  created_at: Generated<Date>
}

export interface IssueRuntimeStateTable {
  issue_id: string
  current_status_code: string
  current_stage: string | null
  workflow_id: string
  active_run_id: string | null
  pinned_config_version: number
  open_operator_question_id: string | null
  pause_reason_code: string | null
  pause_reason_text: string | null
  resume_condition: JsonColumn<JsonObject | null>
  suspended_from_status_code: string | null
  block_reason_code: string | null
  block_reason_text: string | null
  blocked_by_issue_ids: JsonColumn<string[]>
  active_lease_id: string | null
  updated_at: Generated<Date>
}

export interface ArtifactRegistryTable {
  id: Generated<string>
  issue_id: string
  run_id: string | null
  transition_audit_id: string | null
  artifact_type: string
  artifact_scope: ArtifactScope
  artifact_uri: string
  artifact_summary: string | null
  produced_by_role: string | null
  produced_for_status_code: string | null
  superseded_at: Date | null
  metadata: JsonColumn<JsonObject>
  produced_at: Generated<Date>
}

export interface RunnerNodesTable {
  runner_node_id: string
  display_name: string
  host_name: string
  host_group_id: string
  status: RunnerNodeStatus
  auth_subject: string
  max_concurrent_leases: number
  current_active_lease_count: number
  last_heartbeat_at: Date | null
  heartbeat_expires_at: Date | null
  latest_mcp_pool_snapshot_json: JsonColumn<JsonObject | null>
  latest_mcp_pool_snapshot_at: Date | null
  manifest_version: number
  metadata_json: JsonColumn<JsonObject>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface RunnerCapabilitiesTable {
  id: Generated<string>
  runner_node_id: string
  manifest_version: number
  providers: JsonColumn<AgentProvider[]>
  provider_cli_versions: JsonColumn<Partial<Record<AgentProvider, string>>>
  supported_roles: JsonColumn<string[]>
  supported_run_kinds: JsonColumn<RunKind[]>
  supported_repo_kinds: JsonColumn<string[]>
  mcp_server_catalog: JsonColumn<McpServerCatalogEntryV1[]>
  tool_baseline: JsonColumn<string[]>
  skills_available: JsonColumn<string[]>
  active_agent_library_release_id: string | null
  active_agent_library_fingerprint: string | null
  skill_sync_status: RunnerSkillSyncStatus
  skill_sync_error: string | null
  installed_skill_bundles: JsonColumn<RunnerInstalledSkillBundleV1[]>
  workspace_root: string
  worktree_root: string
  default_shell: string
  host_os: string
  host_arch: string
  supports_interrupt: boolean
  supports_checkpoint_resume: boolean
  supports_artifact_upload: boolean
  supports_concurrent_sessions: boolean
  integration_capabilities_json: JsonColumn<IntegrationAgentCapabilityManifest>
  is_active: Generated<boolean>
  published_at: Generated<Date>
}

export interface RunnerLeasesTable {
  lease_id: Generated<string>
  issue_id: string
  run_id: string | null
  workflow_id: string
  requested_provider: AgentProvider
  requested_owner_role: string
  requested_run_kind: RunKind | null
  role_execution_policy_version: number
  runner_requirement_profile_json: JsonColumn<JsonObject>
  agent_library_release_id: NullableColumn<string>
  role_charter_ref: NullableColumn<string>
  prompt_version: NullableColumn<string>
  task_instructions_ref: NullableColumn<string>
  prompt_bundle_fingerprint: NullableColumn<string>
  skill_pack_refs: JsonColumnWithDefault<string[]>
  resolved_prompt_family_refs: JsonColumnWithDefault<string[]>
  effective_skill_fingerprint: NullableColumn<string>
  prompt_resolution_source: NullableColumn<PromptResolutionSource>
  context_pack_fingerprint: NullableColumn<string>
  status: RunnerLeaseStatus
  requested_at: Generated<Date>
  acquired_at: Date | null
  execution_started_at: Date | null
  last_heartbeat_at: Date | null
  heartbeat_expires_at: Date | null
  failed_at: Date | null
  completed_at: Date | null
  released_at: Date | null
  cancellation_requested_at: Date | null
  released_reason_code: string | null
  assigned_runner_node_id: string | null
  result_artifact_id: string | null
  attempt_count: number
  last_error: string | null
  requested_by_command_key: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface RunnerLeaseAttemptsTable {
  lease_attempt_id: Generated<string>
  lease_id: string
  provider_attempt_no: number
  requested_provider: AgentProvider
  effective_provider: AgentProvider
  fallback_from_provider: AgentProvider | null
  fallback_reason: ProviderFallbackReason | null
  execution_session_key: string
  mcp_profile_ref: string
  mcp_bindings_summary: JsonColumn<McpBindingRefV1[]>
  installed_skill_refs: JsonColumn<string[]>
  resolved_skill_refs: JsonColumn<string[]>
  skipped_optional_skill_refs: JsonColumn<string[]>
  runner_node_id: string | null
  host_group_id: string | null
  status: RunnerLeaseAttemptStatus
  acquired_at: Date | null
  execution_started_at: Date | null
  last_heartbeat_at: Date | null
  cancel_requested_at: Date | null
  cancel_acknowledged_at: Date | null
  cancel_outcome: RunnerCancelOutcome | null
  failed_at: Date | null
  completed_at: Date | null
  released_at: Date | null
  error_class: ProviderFailureClass | null
  error_message: string | null
  checkpoint_ref: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface RunnerArtifactBlobsTable {
  artifact_blob_id: Generated<string>
  lease_attempt_id: string
  artifact_key: string
  content_type: string
  content_sha256: string
  size_bytes: number
  content_base64: string
  metadata: JsonColumn<JsonObject>
  created_at: Generated<Date>
}

export interface WorkflowEffectOutboxTable {
  id: Generated<string>
  transition_audit_id: string | null
  issue_id: string
  run_id: string | null
  command_type: string
  command_payload: JsonColumn<JsonObject>
  idempotency_key: string
  status: Generated<OutboxStatus>
  attempt_count: Generated<number>
  scheduled_at: Generated<Date>
  executed_at: Date | null
  last_error: string | null
  created_at: Generated<Date>
}

export interface LifecycleCommandInboxTable {
  id: Generated<string>
  command_key: string
  issue_id: string
  workflow_id: string
  signal_name: string
  source: string
  source_ref: string
  payload: JsonColumn<JsonObject>
  status: Generated<LifecycleCommandInboxStatus>
  attempt_count: Generated<number>
  scheduled_at: Generated<Date>
  accepted_at: Date | null
  rejected_at: Date | null
  processed_at: Date | null
  last_error: string | null
  transition_audit_id: string | null
  rejection_payload: JsonColumn<JsonObject | null>
  created_at: Generated<Date>
}

export interface RawEventInboxTable {
  id: Generated<string>
  provider: WebhookProvider
  provider_event_type: string
  provider_action: string | null
  delivery_id: string
  signature_status: WebhookSignatureStatus
  provider_timestamp: Date | null
  received_at: Generated<Date>
  first_seen_at: Generated<Date>
  last_seen_at: Generated<Date>
  delivery_attempt_count: Generated<number>
  replay_window_valid: boolean | null
  request_headers: JsonColumn<JsonObject>
  raw_body: string
  parsed_payload: JsonColumn<JsonObject>
  canonical_envelope: JsonColumn<JsonObject | null>
  processing_status: Generated<RawEventProcessingStatus>
  processing_attempt_count: Generated<number>
  processed_at: Date | null
  last_error: string | null
  issue_id: string | null
  comment_id: string | null
  project_id: string | null
  repository_full_name: string | null
  dedupe_scope: string
  created_at: Generated<Date>
}

export interface CommentLogTable {
  id: Generated<string>
  issue_id: string
  provider_comment_id: string
  source_inbox_event_id: string
  author_actor_type: string
  author_actor_id: string
  body_markdown: string
  contains_ask: boolean
  classification: CommentLogClassification
  source_created_at: Date
  source_updated_at: Date | null
  deleted_at: Date | null
  metadata: JsonColumn<JsonObject>
  ingested_at: Generated<Date>
}

export interface StatusProjectionTable {
  issue_id: string
  current_status_code: string
  current_owner_role: string | null
  is_blocked: boolean
  is_waiting_for_input: boolean
  needs_human: boolean
  active_lease_id: string | null
  active_run_id: string | null
  last_transition_at: Date
  last_transition_trigger: string
  stuck_for_seconds: number
  high_risk: boolean
}

export interface BlockedIssuesProjectionTable {
  issue_id: string
  blocked_by_issue_ids: JsonColumn<string[]>
  blocked_by_external: boolean
  block_reason_code: string | null
  since: Date
}

export interface AgentMetricsDailyTable {
  metric_date: ColumnType<string, string, string>
  transition_count: Generated<number>
  lifecycle_command_accepted_count: Generated<number>
  lifecycle_command_rejected_count: Generated<number>
  duplicate_suppression_count: Generated<number>
  run_open_counts: JsonColumn<JsonObject>
  run_close_counts: JsonColumn<JsonObject>
  dwell_p50_seconds: JsonColumn<JsonObject>
  dwell_p90_seconds: JsonColumn<JsonObject>
  updated_at: Generated<Date>
}

export interface RunnerInventoryViewTable {
  runner_node_id: string
  host_group_id: string
  display_name: string
  host_name: string
  status: RunnerNodeStatus
  providers: JsonColumn<AgentProvider[]>
  skills_available: JsonColumn<string[]>
  active_agent_library_release_id: string | null
  active_agent_library_fingerprint: string | null
  skill_sync_status: RunnerSkillSyncStatus
  skill_sync_error: string | null
  installed_skill_bundles: JsonColumn<RunnerInstalledSkillBundleV1[]>
  current_active_lease_count: number
  max_concurrent_leases: number
  manifest_version: number
  last_heartbeat_at: Date | null
  heartbeat_expires_at: Date | null
  shared_mcp_process_count: number
  mcp_server_catalog: JsonColumn<McpServerCatalogEntryV1[]>
  integration_capabilities_json: JsonColumn<IntegrationAgentCapabilityManifest>
}

export interface ActiveRunnerLeasesViewTable {
  lease_id: string
  issue_id: string
  run_id: string | null
  workflow_id: string
  requested_provider: AgentProvider
  requested_owner_role: string
  requested_run_kind: RunKind | null
  role_execution_policy_version: number
  agent_library_release_id: string | null
  role_charter_ref: string | null
  prompt_version: string | null
  task_instructions_ref: string | null
  prompt_bundle_fingerprint: string | null
  skill_pack_refs: JsonColumn<string[]>
  resolved_prompt_family_refs: JsonColumn<string[]>
  effective_skill_fingerprint: string | null
  prompt_resolution_source: PromptResolutionSource | null
  context_pack_fingerprint: string | null
  status: RunnerLeaseStatus
  assigned_runner_node_id: string | null
  requested_at: Date
  acquired_at: Date | null
  execution_started_at: Date | null
  last_heartbeat_at: Date | null
  heartbeat_expires_at: Date | null
  failed_at: Date | null
  completed_at: Date | null
  released_at: Date | null
  released_reason_code: string | null
  attempt_count: number
  last_error: string | null
}

export interface StaleRunnerLeasesViewTable {
  lease_id: string
  issue_id: string
  run_id: string | null
  workflow_id: string
  requested_provider: AgentProvider
  requested_owner_role: string
  requested_run_kind: RunKind | null
  role_execution_policy_version: number
  agent_library_release_id: string | null
  role_charter_ref: string | null
  prompt_version: string | null
  task_instructions_ref: string | null
  prompt_bundle_fingerprint: string | null
  skill_pack_refs: JsonColumn<string[]>
  resolved_prompt_family_refs: JsonColumn<string[]>
  effective_skill_fingerprint: string | null
  prompt_resolution_source: PromptResolutionSource | null
  context_pack_fingerprint: string | null
  status: RunnerLeaseStatus
  assigned_runner_node_id: string | null
  requested_at: Date
  acquired_at: Date | null
  execution_started_at: Date | null
  last_heartbeat_at: Date | null
  heartbeat_expires_at: Date | null
  failed_at: Date | null
  completed_at: Date | null
  released_at: Date | null
  released_reason_code: string | null
  attempt_count: number
  last_error: string | null
}

export interface ProviderFailoverMetricsViewTable {
  total_leases: number
  fallback_triggered_count: number
  provider_fallback_exhausted_count: number
  provider_limit_exhaustion_events: number
  fallback_reason_counts: JsonColumn<Record<string, number>>
  mcp_pool_reuse_ratio: number | null
  shared_mcp_process_count: number
}

export interface MvStatusDwellTimesTable {
  issue_id: string
  status_code: string
  entered_at: Date
  exited_at: Date | null
  dwell_seconds: number | null
}

export interface RepositoryRegistryTable {
  repo_slug: string
  github_owner: string
  github_repo: string
  default_branch: string
  visibility: string
  linear_team_id: string
  obsidian_root_note: string
  agent_guidance_scope: string
  local_checkout_path: string | null
  required_checks: JsonColumn<string[]>
  environments: JsonColumn<string[]>
  repo_kind: string
  service_dependencies: JsonColumn<string[]>
  is_active: Generated<boolean>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface ProjectRepositoryMappingsTable {
  id: Generated<string>
  linear_project_id: string
  repo_slug: string
  mapping_role: ProjectRepositoryMappingRole
  priority_order: Generated<number>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface LinearIssueContractSnapshotsTable {
  id: Generated<string>
  issue_id: string
  snapshot_hash: string
  primary_repo: string | null
  affected_repos: JsonColumn<string[]>
  docs_links: JsonColumn<string[]>
  risk: string | null
  dependencies: JsonColumn<IssueContract['dependencies']>
  contract_json: JsonColumn<IssueContract>
  created_at: Generated<Date>
}

export interface IssueLinearSyncProjectionTable {
  issue_id: string
  repo_slug: string
  branch_ref: string | null
  pr_number: number | null
  pr_url: string | null
  pr_state: string | null
  latest_check_conclusion: string | null
  latest_check_url: string | null
  latest_deployment_env: string | null
  latest_deployment_state: string | null
  latest_deployment_url: string | null
  last_synced_payload_hash: string | null
  last_sync_outcome: LinearSyncOutcome | null
  last_sync_error: string | null
  last_sync_at: Date | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface KnowledgeNoteSnapshotsTable {
  id: Generated<string>
  note_path: string
  note_title: string
  root_tag: string
  content_hash: string
  resolved_links: JsonColumn<string[]>
  sanitized_markdown: string
  summary_markdown: string
  source_updated_at: Date | null
  ingested_at: Generated<Date>
  snapshot_status: KnowledgeSnapshotStatus
  last_error: string | null
}

export interface ContextPackCacheTable {
  id: Generated<string>
  issue_id: string
  context_version: number
  input_fingerprint: string
  bundle_json: JsonColumn<ContextPack>
  estimated_tokens: number
  source_trace_json: JsonColumn<ContextPackSourceTrace>
  created_at: Generated<Date>
  superseded_at: Date | null
}

export interface CredentialSlotsTable {
  id: Generated<string>
  issue_id: string
  provider_name: string
  credential_key: string
  environment: string
  secret_alias: string
  owner_actor_type: string
  owner_actor_id: string
  auth_scheme: AuthScheme
  status: CredentialSlotStatus
  scopes: JsonColumn<string[]>
  metadata: JsonColumn<JsonObject>
  validation_checked_at: Date | null
  expires_at: Date | null
  rotated_at: Date | null
  last_error: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface OauthClientRegistrationsTable {
  id: Generated<string>
  issue_id: string
  provider_name: string
  environment: string
  client_type: OAuthClientType
  auth_scheme: AuthScheme
  client_id_alias: string
  client_secret_alias: string | null
  redirect_uris: JsonColumn<string[]>
  scopes: JsonColumn<string[]>
  registration_state: string
  metadata: JsonColumn<JsonObject>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface OauthConsentSessionsTable {
  id: Generated<string>
  issue_id: string
  provider_name: string
  registration_id: string | null
  state: string
  pkce_verifier_alias: string | null
  code_challenge_method: string | null
  requested_scopes: JsonColumn<string[]>
  granted_scopes: JsonColumn<string[]>
  status: OAuthConsentStatus
  consent_url: string | null
  callback_received_at: Date | null
  completed_at: Date | null
  last_error: string | null
  metadata: JsonColumn<JsonObject>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface TokenHandlesTable {
  id: Generated<string>
  issue_id: string
  provider_name: string
  consent_session_id: string | null
  token_kind: string
  secret_alias: string
  status: TokenHandleStatus
  scopes: JsonColumn<string[]>
  expires_at: Date | null
  rotated_at: Date | null
  last_checked_at: Date | null
  last_error: string | null
  metadata: JsonColumn<JsonObject>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface WebhookRegistrationsTable {
  id: Generated<string>
  issue_id: string
  provider_name: string
  environment: string
  callback_url: string
  event_types: JsonColumn<string[]>
  signing_secret_alias: string | null
  status: WebhookRegistrationStatus
  last_validated_at: Date | null
  last_error: string | null
  metadata: JsonColumn<JsonObject>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface IntegrationValidationRunsTable {
  id: Generated<string>
  issue_id: string
  provider_name: string
  validation_type: string
  environment: string
  status: string
  summary: string | null
  artifact_id: string | null
  metadata: JsonColumn<JsonObject>
  executed_at: Generated<Date>
}

export interface Database {
  bootstrap_markers: BootstrapMarkersTable
  workflow_config_sets: WorkflowConfigSetsTable
  workflow_status_catalog: WorkflowStatusCatalogTable
  workflow_trigger_catalog: WorkflowTriggerCatalogTable
  workflow_transition_rules: WorkflowTransitionRulesTable
  workflow_status_entry_hooks: WorkflowStatusEntryHooksTable
  workflow_reason_codes: WorkflowReasonCodesTable
  workflow_role_execution_policies: WorkflowRoleExecutionPoliciesTable
  workflow_runtime_role_contracts: WorkflowRuntimeRoleContractsTable
  workflow_linear_state_mappings: WorkflowLinearStateMappingsTable
  workflow_linear_milestone_policies: WorkflowLinearMilestonePoliciesTable
  agent_library_releases: AgentLibraryReleasesTable
  agent_role_charters: AgentRoleChartersTable
  agent_prompt_families: AgentPromptFamiliesTable
  agent_skill_packs: AgentSkillPacksTable
  agent_prompt_bundles: AgentPromptBundlesTable
  agent_routing_skill_pack_rules: AgentRoutingSkillPackRulesTable
  issue_runs: IssueRunsTable
  status_transition_audit: StatusTransitionAuditTable
  issue_runtime_state: IssueRuntimeStateTable
  artifact_registry: ArtifactRegistryTable
  runner_nodes: RunnerNodesTable
  runner_capabilities: RunnerCapabilitiesTable
  runner_leases: RunnerLeasesTable
  runner_lease_attempts: RunnerLeaseAttemptsTable
  runner_artifact_blobs: RunnerArtifactBlobsTable
  workflow_effect_outbox: WorkflowEffectOutboxTable
  lifecycle_command_inbox: LifecycleCommandInboxTable
  raw_event_inbox: RawEventInboxTable
  comment_log: CommentLogTable
  status_projection: StatusProjectionTable
  blocked_issues_projection: BlockedIssuesProjectionTable
  agent_metrics_daily: AgentMetricsDailyTable
  runner_inventory_view: RunnerInventoryViewTable
  active_runner_leases_view: ActiveRunnerLeasesViewTable
  stale_runner_leases_view: StaleRunnerLeasesViewTable
  provider_failover_metrics_view: ProviderFailoverMetricsViewTable
  mv_status_dwell_times: MvStatusDwellTimesTable
  repository_registry: RepositoryRegistryTable
  project_repository_mappings: ProjectRepositoryMappingsTable
  linear_issue_contract_snapshots: LinearIssueContractSnapshotsTable
  issue_linear_sync_projection: IssueLinearSyncProjectionTable
  knowledge_note_snapshots: KnowledgeNoteSnapshotsTable
  context_pack_cache: ContextPackCacheTable
  credential_slots: CredentialSlotsTable
  oauth_client_registrations: OauthClientRegistrationsTable
  oauth_consent_sessions: OauthConsentSessionsTable
  token_handles: TokenHandlesTable
  webhook_registrations: WebhookRegistrationsTable
  integration_validation_runs: IntegrationValidationRunsTable
}
