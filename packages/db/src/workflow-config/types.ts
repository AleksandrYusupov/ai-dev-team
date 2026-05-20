import type {
  AgentProvider,
  ActorType,
  ArtifactScope,
  EffectOnLease,
  EffectOnRun,
  HookFailureMode,
  HookType,
  LinearProjectUpdateHealth,
  LinearSyncMilestoneEventCode,
  ProviderFallbackReason,
  RuntimeRoleActivationMode,
  RuntimeRoleHumanGateMode,
  RunKind,
  WorkflowConfigSetStatus,
} from '@ai-dev-team/shared'

export interface WorkflowConfigSetManifest {
  configVersion: number
  status: WorkflowConfigSetStatus
  isActiveForNewRuns: boolean
  notes: string | null
}

export interface WorkflowStatusManifest {
  code: string
  label: string
  group: string
  kind: string
  isTerminal: boolean
  manualEntryAllowed: boolean
  manualExitAllowed: boolean
  requiresHuman: boolean
  blocksExecution: boolean
  sortOrder: number
  description: string
}

export interface WorkflowTriggerManifest {
  code: string
  actorType: ActorType
  isManual: boolean
  requiresComment: boolean
  requiresArtifact: boolean
  description: string
}

export interface WorkflowTransitionRuleManifest {
  ruleId: string
  fromStatus: string
  toStatus: string
  triggerCode: string
  ownerRole: string
  allowedActorTypes: ActorType[]
  guardConditions: string[]
  requiredArtifactTypes: string[]
  artifactScope: ArtifactScope
  requiresReasonCode: boolean
  requiresCheckpoint: boolean
  requiresActiveRun: boolean
  requiresHumanApproval: boolean
  effectOnRun: EffectOnRun
  openedRunKind: RunKind | null
  effectOnLease: EffectOnLease
  notes: string
}

export interface WorkflowStatusEntryHookManifest {
  statusCode: string
  hookOrder: number
  hookType: HookType
  hookName: string
  ownerRole: string
  targetOwnerRole: string | null
  isRequired: boolean
  failureMode: HookFailureMode
  producesArtifactType: string | null
  emitsCommandType: string | null
  notes: string
}

export interface WorkflowReasonCodeManifest {
  code: string
  category: string
  description: string
  allowedOnTransitions: string[]
}

export interface WorkflowRoleExecutionPolicyManifest {
  ownerRole: string
  primaryProvider: AgentProvider
  secondaryProvider: AgentProvider
  fallbackTriggers: ProviderFallbackReason[]
  maxProviderFailovers: number
  mcpProfileRef: string
  requiredCapabilities: string[]
}

export interface WorkflowRuntimeRoleHumanGatePolicyManifest {
  mode: RuntimeRoleHumanGateMode
  requiredHumanOwnedZones: string[]
  notes: string | null
}

export interface WorkflowRuntimeRoleContractManifest {
  roleId: string
  canonicalRunKind: RunKind | null
  allowedStatusOwnership: string[]
  requiredInputArtifactTypes: string[]
  requiredOutputArtifactTypes: string[]
  humanGatePolicy: WorkflowRuntimeRoleHumanGatePolicyManifest
  escalationReasonCodes: string[]
  activationMode: RuntimeRoleActivationMode
}

export interface WorkflowOperatingModelRoleManifest {
  roleId: string
  wave: number
  category: string
  visibleInLinear: boolean
}

export interface WorkflowOperatingModelVisibleSurfaceManifest {
  primaryActorRole: string
  optionalFutureLinearActors: string[]
}

export interface WorkflowOperatingModelTaxonomyManifest {
  labelGroups: {
    type: string[]
    risk: string[]
    source: string[]
    mode: string[]
    human: string[]
  }
  reasonCodeGroups: {
    needs: string[]
    blocked: string[]
    rework: string[]
  }
}

export interface WorkflowOperatingModelManifest {
  roles: WorkflowOperatingModelRoleManifest[]
  visibleLinearSurface: WorkflowOperatingModelVisibleSurfaceManifest
  humanOwnedZones: string[]
  taxonomy: WorkflowOperatingModelTaxonomyManifest
}

export interface WorkflowLinearStateMappingManifest {
  statusCode: string
  linearStateName: string | null
  syncEnabled: boolean
}

export interface WorkflowLinearMilestonePolicyManifest {
  eventCode: LinearSyncMilestoneEventCode
  eventLabel: string
  postComment: boolean
  createProjectUpdate: boolean
  projectUpdateHealth: LinearProjectUpdateHealth | null
}

export interface WorkflowManifestBundle {
  configSet: WorkflowConfigSetManifest
  statuses: WorkflowStatusManifest[]
  triggers: WorkflowTriggerManifest[]
  transitionRules: WorkflowTransitionRuleManifest[]
  statusEntryHooks: WorkflowStatusEntryHookManifest[]
  reasonCodes: WorkflowReasonCodeManifest[]
  roleExecutionPolicies: WorkflowRoleExecutionPolicyManifest[]
  runtimeRoleContracts: WorkflowRuntimeRoleContractManifest[]
  linearStateMappings: WorkflowLinearStateMappingManifest[]
  linearMilestonePolicies: WorkflowLinearMilestonePolicyManifest[]
  operatingModel?: WorkflowOperatingModelManifest
}

export interface WorkflowManifestValidationResult {
  bundle: WorkflowManifestBundle
  summary: {
    statusCount: number
    triggerCount: number
    transitionRuleCount: number
    hookCount: number
    reasonCodeCount: number
    roleExecutionPolicyCount: number
    runtimeRoleContractCount: number
    linearStateMappingCount: number
    linearMilestonePolicyCount: number
    canonicalRoleCount: number
    visibleLinearActorCount: number
  }
}

export interface PublishWorkflowConfigInput {
  publishedBy: string
}

export interface PublishWorkflowConfigResult {
  configVersion: number
  inserted: boolean
  isActiveForNewRuns: boolean
  fingerprint: string
}
