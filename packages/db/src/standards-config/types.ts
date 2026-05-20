export type StandardsBundleSource = 'working'

export interface StandardsDocumentManifest {
  documentId: string
  title: string
  kind: string
  path: string
  required: boolean
}

export interface StandardsBundleManifest {
  standardsBundleId: string
  version: string
  owners: string[]
  releaseModel: 'manifest_indexed'
  sourceRefs: string[]
  documents: StandardsDocumentManifest[]
  requiredDocumentIds: string[]
  expectedDocumentCount: number
  expectedProjectProfileCount: number
  projectProfileDir: string
  layeringPolicyPath: string
  versioningPolicy: {
    releaseIdPattern: string
    immutableReleaseManifests: boolean
    documentHashRequired: boolean
    silentMutationForbidden: boolean
    nextReleaseMustBeMonotonic: boolean
  }
  releasePolicy: {
    publishedReleaseRequiredForRollout: boolean
    releaseManifestIsAuthoritative: boolean
    fingerprintScopedSeparatelyFromRuntimeLibrary: boolean
  }
}

export interface StandardsResolvedDocument {
  documentId: string
  title: string
  kind: string
  required: boolean
  declaredPath: string
  resolvedPath: string
  relativePath: string
  body: string
}

export interface StandardsLayeringPolicy {
  precedenceOrder: string[]
  mergeRules: {
    lowerLayerCannotRelaxUpper: boolean
    additiveOverlaysOnly: boolean
    stricterConstraintWins: boolean
    unresolvedConflictAction: string
  }
  multiRepoPolicy: {
    loadProjectProfileFirst: boolean
    loadAllAffectedRepositoryRules: boolean
    primaryRepoResolutionOrder: string[]
    conflictResolution: string
    missingPrimaryRepoAction: string
  }
  knowledgeRouting: {
    standardsDocumentsAreCentralized: boolean
    projectProfileRequired: boolean
    repoGuidanceFiles: string[]
    affectedRepoLoadingMode: string
  }
  changelogRouting: {
    systemStandardsChangelogPath: string
    projectChangelogMode: string
    projectChangelogProfileKey: string
    repositoryChangelogFilename: string
    repositoryCodeChangeLogRequired: boolean
  }
  exceptionPolicy: {
    defaultBehavior: string
    exceptionClasses: string[]
    requiredFields: string[]
    temporaryOverrideRequiresHumanApproval: boolean
    manualOverrideRequiresAuditEntry: boolean
  }
  crossProjectPolicy: {
    isolationRequired: boolean
    allowCrossProjectMixOnlyWhenRegistryMarksMultiProject: boolean
    crossProjectDefaultAction: string
  }
}

export interface StandardsProjectRepoProfile {
  repoSlug: string
  mappingRole: string
  localRepoPath: string
  repoGuidanceFiles: string[]
  repoChangelogPath: string
}

export interface StandardsProjectProfile {
  projectId: string
  version: string
  standardsBundleRef: string
  kbRoot: string
  entryNote: string
  changelogNote: string
  projectTag: string
  repos: StandardsProjectRepoProfile[]
  repositoryRegistry: {
    sourceOfTruth: string
    resolutionDocRef: string
    primaryRepoResolutionOrder: string[]
    affectedRepoResolutionOrder: string[]
  }
  crossRepoRouting: {
    loadProjectProfileBeforeRepoRules: boolean
    loadAllAffectedRepoRules: boolean
    conflictResolution: string
    failWhenPrimaryRepoMissing: boolean
    failWhenRepoRulesMissing: boolean
  }
  defaultToolPolicy: {
    runtimeProviders: string[]
    sharedMcpRefs: string[]
    runnerDistributionRef: string
  }
  escalationOwners: Record<string, string>
  humanGates: string[]
  namingConventions: {
    rootFolderTag: string
    rootNoteRef: string
    repoChangelogFilename: string
    standardsBundleRefFormat: string
  }
  relativePath: string
}

export interface StandardsReleaseIndexEntry {
  releaseId: string
  publishedAt: string
  releaseManifestPath: string
  bundleFingerprint: string
}

export interface StandardsReleaseIndex {
  standardsBundleId: string
  releaseIdPattern: string
  releases: StandardsReleaseIndexEntry[]
}

export interface StandardsFingerprintSet {
  bundleFingerprint: string
  documentFingerprints: Record<string, string>
  projectProfileFingerprints: Record<string, string>
}

export interface StandardsBundle {
  source: StandardsBundleSource
  configRootDir: string
  resolvedBaseDir: string
  library: StandardsBundleManifest
  documents: StandardsResolvedDocument[]
  layeringPolicy: StandardsLayeringPolicy
  projectProfiles: StandardsProjectProfile[]
  releaseIndex: StandardsReleaseIndex | null
}

export interface StandardsValidationSummary {
  documentCount: number
  requiredDocumentCount: number
  projectProfileCount: number
  repoCount: number
}

export interface StandardsValidationResult {
  bundle: StandardsBundle
  summary: StandardsValidationSummary
  fingerprints: StandardsFingerprintSet
}
