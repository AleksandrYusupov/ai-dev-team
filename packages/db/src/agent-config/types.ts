import type { AgentProvider, RunKind } from '@ai-dev-team/shared'

export type AgentLibrarySource = 'working' | 'release'

export interface AgentSkillDownloadRef {
  title: string
  url: string
}

export interface AgentLibraryManifest {
  libraryId: string
  version: string
  owners: string[]
  expectedRoleCount: number
  expectedSkillCount: number
  expectedProviderOverlayCount: number
  releaseModel: 'immutable_snapshot'
  layeringModel: string
  providerOverlayDir: string | null
  toolPolicyManifestPath: string | null
  sourceRefs: string[]
  alwaysOnGuidanceRefs: string[]
  compatibilityPolicy: {
    runtimeTaskBundleUnchanged: boolean
    dbPersistenceUnchanged: boolean
    providerWiringUnchanged: boolean
    runnerDistributionOutOfScope: boolean
  }
  versioningPolicy: {
    frontmatterVersionRequired: boolean
    silentMutationForbidden: boolean
    placeholderContentAllowed: boolean
    releaseIdPattern: string
    immutablePublishedReleases: boolean
    nextReleaseMustBeMonotonic: boolean
  }
  rollbackPolicy: {
    runnerHostRolloutPolicy: string
    canonicalSourceOfTruth: string
    runtimeMirrorNotAuthoritative: boolean
    publishedReleaseRequiredForRollout: boolean
    firstReleaseMayOmitRollbackTarget: boolean
  }
  referenceSkillPolicy: {
    materialized: boolean
    runtimeDependencyDefault: boolean
    referenceOnlyDefault: boolean
  }
}

export interface AgentRoleCharterFrontmatter {
  roleId: string
  version: string
  wave: number
  category: string
  visibleInLinear: boolean
  canonicalRunKind: RunKind | null
  sourceRefs: string[]
}

export interface AgentRoleCharterDocument {
  frontmatter: AgentRoleCharterFrontmatter
  body: string
  relativePath: string
}

export interface AgentSkillHumanGate {
  required: boolean
  zones: string[]
  notes: string | null
}

export interface AgentSkillMeta {
  id: string
  version: string
  name: string
  category: string
  availability: string
  kind: 'foundation' | 'reusable' | 'custom'
  runtimeDependency: boolean
  referenceOnlyDefault: boolean
  providerCompatibility: AgentProvider[]
  requiredTools: string[]
  requiredMcp: string[]
  sensitivityClass: string
  whenToUse: string[]
  inputs: string[]
  steps: string[]
  stopConditions: string[]
  escalationRules: string[]
  antiPatterns: string[]
  deniedActions: string[]
  humanGate: AgentSkillHumanGate
  description: string
  why: string
  downloadRef: string | AgentSkillDownloadRef | null
  buildSpec: string | null
  sourceRefs: string[]
}

export interface AgentSkillDocument {
  meta: AgentSkillMeta
  body: string
  relativePath: string
}

export interface AgentSkillPackManifest {
  packId: string
  version: string
  purpose: string
  skillRefs: string[]
  optionalSkillRefs: string[]
  providers: AgentProvider[]
  activationConditions: {
    statuses: string[]
    taskTypes: string[]
    requiresIntegration: boolean | null
    notes: string | null
  }
  deniedActionsOverlay: string[]
  humanGateOverlay: AgentSkillHumanGate
  sourceRefs: string[]
}

export interface AgentRoleSkillPackMapEntry {
  roleId: string
  defaultSkillPackRefs: string[]
  notes: string | null
}

export interface AgentRoutingSkillPackRule {
  ruleId: string
  statuses: string[]
  triggers: string[]
  taskTypes: string[]
  requiresIntegration: boolean | null
  addSkillPackRefs: string[]
  notes: string
}

export interface AgentPromptFamilyRoleMapEntry {
  roleId: string
  promptFamilyRef: string
}

export interface AgentPromptFamilyPackMapEntry {
  packId: string
  promptFamilyRef: string
}

export interface AgentPromptFamilyMapManifest {
  rolePromptFamilies: AgentPromptFamilyRoleMapEntry[]
  packOverlayFamilies: AgentPromptFamilyPackMapEntry[]
}

export interface AgentProviderOverlayDocument {
  provider: AgentProvider
  version: string
  purpose: string
  sourceRefs: string[]
  body: string
  relativePath: string
}

export interface AgentRoleToolPolicy {
  roleId: string
  allowedTools: string[]
  requiredMcpRefs: string[]
  writeScopes: string[]
  deniedTools: string[]
  humanGatedTools: string[]
  notes: string | null
}

export interface AgentProviderToolPolicy {
  provider: AgentProvider
  overlayRef: string
  allowedTools: string[]
  deniedTools: string[]
  humanGatedTools: string[]
  writeScopes: string[]
  notes: string | null
}

export interface AgentToolingPolicyManifest {
  roleToolPolicies: AgentRoleToolPolicy[]
  providerToolPolicies: AgentProviderToolPolicy[]
}

export interface AgentPromptFamilyManifest {
  familyId: string
  version: string
  providerCompatibility: AgentProvider[]
  compatibleRoles: string[]
  compatibleSkillPacks: string[]
  sourceRefs: string[]
  body: string
  relativePath: string
}

export interface AgentLibraryReleaseIndexEntry {
  releaseId: string
  libraryVersion: string
  releaseManifestPath: string
  publishedAt: string
  libraryFingerprint: string
}

export interface AgentLibraryReleaseIndex {
  libraryId: string
  releaseIdPattern: string
  releases: AgentLibraryReleaseIndexEntry[]
}

export interface AgentLibraryFingerprintSet {
  libraryFingerprint: string
  skillFingerprints: Record<string, string>
  skillPackFingerprints: Record<string, string>
  promptFamilyFingerprints: Record<string, string>
  promptBundleFingerprints: Record<string, string>
  providerOverlayFingerprints: Record<string, string>
  toolingPolicyFingerprint: string
}

export interface AgentLibraryReleaseManifest {
  releaseId: string
  libraryId: string
  libraryVersion: string
  publishedAt: string
  publishedBy: string
  changelogPath: string
  predecessorReleaseId: string | null
  rollbackToReleaseId: string | null
  sourceLibraryFingerprint: string
  fingerprints: AgentLibraryFingerprintSet
  relativePath: string
}

export interface AgentLibraryLoadOptions {
  baseDir?: string
  source?: AgentLibrarySource
  releaseId?: string
}

export interface AgentLibraryBundle {
  source: AgentLibrarySource
  releaseId: string | null
  configRootDir: string
  resolvedBaseDir: string
  library: AgentLibraryManifest
  roleCharters: AgentRoleCharterDocument[]
  skills: AgentSkillDocument[]
  skillPacks: AgentSkillPackManifest[]
  roleSkillPackMap: AgentRoleSkillPackMapEntry[]
  routingSkillPackMap: AgentRoutingSkillPackRule[]
  promptFamilyMap: AgentPromptFamilyMapManifest
  promptFamilies: AgentPromptFamilyManifest[]
  providerOverlays: AgentProviderOverlayDocument[]
  toolingPolicy: AgentToolingPolicyManifest | null
  releaseIndex: AgentLibraryReleaseIndex | null
  releaseManifest: AgentLibraryReleaseManifest | null
}

export interface AgentLibraryValidationSummary {
  roleCount: number
  skillCount: number
  packCount: number
  promptFamilyCount: number
  providerOverlayCount: number
  rolePackMapCount: number
  routingRuleCount: number
  roleToolPolicyCount: number
  providerToolPolicyCount: number
  referenceOnlySkillCount: number
  integrationSensitiveSkillCount: number
  riskySkillCount: number
}

export interface AgentLibraryValidationResult {
  bundle: AgentLibraryBundle
  summary: AgentLibraryValidationSummary
  fingerprints: AgentLibraryFingerprintSet
}

export type AgentPromptBundleResolutionMode =
  | 'canonical'
  | 'compatibility_alias'

export interface AgentLibraryReleaseSummary {
  releaseId: string
  libraryId: string
  libraryVersion: string
  libraryFingerprint: string
  publishedAt: string
  publishedBy: string
  sourceLibraryFingerprint: string
  isActiveForNewRuns: boolean
  createdAt: string
}

export interface PublishedAgentRuntimeRoleCharter {
  releaseId: string
  roleId: string
  charterVersion: string
  canonicalRunKind: RunKind | null
  frontmatter: AgentRoleCharterFrontmatter
  sourceRefs: string[]
  body: string
  relativePath: string
  roleFingerprint: string
}

export interface PublishedAgentRuntimePromptFamily {
  releaseId: string
  promptFamilyRef: string
  familyId: string
  familyVersion: string
  providerCompatibility: AgentProvider[]
  compatibleRoles: string[]
  compatibleSkillPacks: string[]
  sourceRefs: string[]
  body: string
  relativePath: string
  familyFingerprint: string
}

export interface PublishedAgentRuntimeSkillPack {
  releaseId: string
  packId: string
  packVersion: string
  purpose: string
  skillRefs: string[]
  optionalSkillRefs: string[]
  providers: AgentProvider[]
  activationConditions: AgentSkillPackManifest['activationConditions']
  promptFamilyRefs: string[]
  deniedActionsOverlay: string[]
  humanGateOverlay: AgentSkillHumanGate
  sourceRefs: string[]
  skillPackFingerprint: string
}

export interface PublishedAgentRuntimePromptBundle {
  releaseId: string
  roleId: string
  promptBundleRef: string
  roleCharterRef: string
  promptVersion: string
  promptBundleFingerprint: string
  defaultSkillPackRefs: string[]
  defaultPromptFamilyRefs: string[]
  resolutionMode: AgentPromptBundleResolutionMode
}

export interface PublishedAgentRuntimeRoutingSkillPackRule {
  releaseId: string
  ruleId: string
  statuses: string[]
  triggers: string[]
  taskTypes: string[]
  requiresIntegration: boolean | null
  addSkillPackRefs: string[]
  notes: string
}

export interface PublishedAgentRuntimeBundle {
  release: AgentLibraryReleaseSummary
  roleCharters: PublishedAgentRuntimeRoleCharter[]
  promptFamilies: PublishedAgentRuntimePromptFamily[]
  skillPacks: PublishedAgentRuntimeSkillPack[]
  promptBundles: PublishedAgentRuntimePromptBundle[]
  routingSkillPackRules: PublishedAgentRuntimeRoutingSkillPackRule[]
}

export interface PublishAgentRuntimeReleaseInput {
  baseDir?: string
  releaseId?: string
  publishedBy: string
  activateForNewRuns?: boolean
}

export interface PublishAgentRuntimeReleaseResult {
  releaseId: string
  libraryId: string
  libraryVersion: string
  fingerprint: string
  inserted: boolean
  isActiveForNewRuns: boolean
  activationChanged: boolean
}
