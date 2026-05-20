import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDocument } from 'yaml'
import { z } from 'zod'

import type {
  StandardsBundle,
  StandardsFingerprintSet,
  StandardsReleaseIndex,
  StandardsValidationResult,
} from './types.js'

export class StandardsBundleValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Standards bundle validation failed:\n${issues.join('\n')}`)
    this.name = 'StandardsBundleValidationError'
  }
}

const documentSchema = z.object({
  document_id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  path: z.string().trim().min(1),
  required: z.boolean(),
})

const libraryManifestSchema = z.object({
  standards_bundle_id: z.string().trim().min(1),
  version: z.string().trim().min(1),
  owners: z.array(z.string().trim().min(1)).nonempty(),
  release_model: z.literal('manifest_indexed'),
  source_refs: z.array(z.string().trim().min(1)).nonempty(),
  documents: z.array(documentSchema).nonempty(),
  required_document_ids: z.array(z.string().trim().min(1)).nonempty(),
  expected_document_count: z.number().int().positive(),
  expected_project_profile_count: z.number().int().positive(),
  project_profile_dir: z.string().trim().min(1),
  layering_policy_path: z.string().trim().min(1),
  versioning_policy: z.object({
    release_id_pattern: z.string().trim().min(1),
    immutable_release_manifests: z.boolean(),
    document_hash_required: z.boolean(),
    silent_mutation_forbidden: z.boolean(),
    next_release_must_be_monotonic: z.boolean(),
  }),
  release_policy: z.object({
    published_release_required_for_rollout: z.boolean(),
    release_manifest_is_authoritative: z.boolean(),
    fingerprint_scoped_separately_from_runtime_library: z.boolean(),
  }),
})

const layeringPolicySchema = z.object({
  precedence_order: z.array(z.string().trim().min(1)).nonempty(),
  merge_rules: z.object({
    lower_layer_cannot_relax_upper: z.boolean(),
    additive_overlays_only: z.boolean(),
    stricter_constraint_wins: z.boolean(),
    unresolved_conflict_action: z.string().trim().min(1),
  }),
  multi_repo_policy: z.object({
    load_project_profile_first: z.boolean(),
    load_all_affected_repository_rules: z.boolean(),
    primary_repo_resolution_order: z.array(z.string().trim().min(1)).nonempty(),
    conflict_resolution: z.string().trim().min(1),
    missing_primary_repo_action: z.string().trim().min(1),
  }),
  knowledge_routing: z.object({
    standards_documents_are_centralized: z.boolean(),
    project_profile_required: z.boolean(),
    repo_guidance_files: z.array(z.string().trim().min(1)).nonempty(),
    affected_repo_loading_mode: z.string().trim().min(1),
  }),
  changelog_routing: z.object({
    system_standards_changelog_path: z.string().trim().min(1),
    project_changelog_mode: z.string().trim().min(1),
    project_changelog_profile_key: z.string().trim().min(1),
    repository_changelog_filename: z.string().trim().min(1),
    repository_code_change_log_required: z.boolean(),
  }),
  exception_policy: z.object({
    default_behavior: z.string().trim().min(1),
    exception_classes: z.array(z.string().trim().min(1)).nonempty(),
    required_fields: z.array(z.string().trim().min(1)).nonempty(),
    temporary_override_requires_human_approval: z.boolean(),
    manual_override_requires_audit_entry: z.boolean(),
  }),
  cross_project_policy: z.object({
    isolation_required: z.boolean(),
    allow_cross_project_mix_only_when_registry_marks_multi_project: z.boolean(),
    cross_project_default_action: z.string().trim().min(1),
  }),
})

const projectProfileSchema = z.object({
  project_id: z.string().trim().min(1),
  version: z.string().trim().min(1),
  standards_bundle_ref: z.string().trim().min(1),
  kb_root: z.string().trim().min(1),
  entry_note: z.string().trim().min(1),
  changelog_note: z.string().trim().min(1),
  project_tag: z.string().trim().min(1),
  repos: z.array(
    z.object({
      repo_slug: z.string().trim().min(1),
      mapping_role: z.string().trim().min(1),
      local_repo_path: z.string().trim().min(1),
      repo_guidance_files: z.array(z.string().trim().min(1)).nonempty(),
      repo_changelog_path: z.string().trim().min(1),
    }),
  ).nonempty(),
  repository_registry: z.object({
    source_of_truth: z.string().trim().min(1),
    resolution_doc_ref: z.string().trim().min(1),
    primary_repo_resolution_order: z.array(z.string().trim().min(1)).nonempty(),
    affected_repo_resolution_order: z.array(z.string().trim().min(1)).nonempty(),
  }),
  cross_repo_routing: z.object({
    load_project_profile_before_repo_rules: z.boolean(),
    load_all_affected_repo_rules: z.boolean(),
    conflict_resolution: z.string().trim().min(1),
    fail_when_primary_repo_missing: z.boolean(),
    fail_when_repo_rules_missing: z.boolean(),
  }),
  default_tool_policy: z.object({
    runtime_providers: z.array(z.string().trim().min(1)).nonempty(),
    shared_mcp_refs: z.array(z.string().trim().min(1)).nonempty(),
    runner_distribution_ref: z.string().trim().min(1),
  }),
  escalation_owners: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  human_gates: z.array(z.string().trim().min(1)).nonempty(),
  naming_conventions: z.object({
    root_folder_tag: z.string().trim().min(1),
    root_note_ref: z.string().trim().min(1),
    repo_changelog_filename: z.string().trim().min(1),
    standards_bundle_ref_format: z.string().trim().min(1),
  }),
})

const releaseIndexSchema = z.object({
  standards_bundle_id: z.string().trim().min(1),
  release_id_pattern: z.string().trim().min(1),
  releases: z.array(
    z.object({
      release_id: z.string().trim().min(1),
      published_at: z.string().trim().min(1),
      release_manifest_path: z.string().trim().min(1),
      bundle_fingerprint: z.string().trim().min(1),
    }),
  ).default([]),
})

function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableSortObject(item))
  }

  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = stableSortObject(
          (value as Record<string, unknown>)[key],
        )
        return accumulator
      }, {})
  }

  return value
}

function hashStableValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableSortObject(value)))
    .digest('hex')
}

function normalizeFieldErrors(
  prefix: string,
  issues: z.ZodIssue[],
  collector: string[],
): void {
  for (const issue of issues) {
    const location = issue.path.length > 0 ? issue.path.join('.') : '<root>'
    collector.push(`${prefix} ${location}: ${issue.message}`)
  }
}

function ensureUnique(values: string[], label: string, collector: string[]): void {
  const seen = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      collector.push(`Duplicate ${label}: ${value}`)
      continue
    }

    seen.add(value)
  }
}

async function parseYamlValue(filePath: string, label: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf8')
  const document = parseDocument(content)
  const issues: string[] = []

  for (const error of document.errors) {
    issues.push(`${label}: ${error.message}`)
  }

  for (const warning of document.warnings) {
    issues.push(`${label}: ${warning.message}`)
  }

  if (issues.length > 0) {
    throw new StandardsBundleValidationError(issues)
  }

  return document.toJS()
}

function normalizeRelativePath(baseDir: string, filePath: string): string {
  return path.relative(baseDir, filePath).replaceAll(path.sep, '/')
}

export function resolveAgentStandardsFolder(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'config/agent-standards',
  )
}

async function loadStandardsReleaseIndex(
  baseDir: string,
): Promise<StandardsReleaseIndex | null> {
  const indexPath = path.join(baseDir, 'releases', 'index.yaml')

  try {
    const raw = await parseYamlValue(indexPath, normalizeRelativePath(baseDir, indexPath))
    const result = releaseIndexSchema.safeParse(raw)

    if (!result.success) {
      throw new StandardsBundleValidationError(
        result.error.issues.map((issue) => {
          const location = issue.path.length > 0 ? issue.path.join('.') : '<root>'
          return `${normalizeRelativePath(baseDir, indexPath)} ${location}: ${issue.message}`
        }),
      )
    }

    return {
      standardsBundleId: result.data.standards_bundle_id,
      releaseIdPattern: result.data.release_id_pattern,
      releases: result.data.releases.map((entry) => ({
        releaseId: entry.release_id,
        publishedAt: entry.published_at,
        releaseManifestPath: entry.release_manifest_path,
        bundleFingerprint: entry.bundle_fingerprint,
      })),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export async function loadStandardsBundle(
  baseDir: string = resolveAgentStandardsFolder(),
): Promise<StandardsBundle> {
  const resolvedBaseDir = path.resolve(baseDir)
  const manifestDir = path.join(resolvedBaseDir, 'manifests')
  const libraryPath = path.join(manifestDir, 'library.yaml')
  const libraryRaw = await parseYamlValue(libraryPath, normalizeRelativePath(resolvedBaseDir, libraryPath))
  const libraryResult = libraryManifestSchema.safeParse(libraryRaw)
  const issues: string[] = []

  if (!libraryResult.success) {
    normalizeFieldErrors(
      normalizeRelativePath(resolvedBaseDir, libraryPath),
      libraryResult.error.issues,
      issues,
    )
    throw new StandardsBundleValidationError(issues)
  }

  const libraryData = libraryResult.data
  const layeringPolicyPath = path.join(resolvedBaseDir, libraryData.layering_policy_path)
  const projectProfileDir = path.join(resolvedBaseDir, libraryData.project_profile_dir)

  const [layeringRaw, profileEntries, releaseIndex] = await Promise.all([
    parseYamlValue(
      layeringPolicyPath,
      normalizeRelativePath(resolvedBaseDir, layeringPolicyPath),
    ),
    readdir(projectProfileDir, { withFileTypes: true }),
    loadStandardsReleaseIndex(resolvedBaseDir),
  ])

  const layeringResult = layeringPolicySchema.safeParse(layeringRaw)
  if (!layeringResult.success) {
    normalizeFieldErrors(
      normalizeRelativePath(resolvedBaseDir, layeringPolicyPath),
      layeringResult.error.issues,
      issues,
    )
  }

  const profileFiles = profileEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => path.join(projectProfileDir, entry.name))
    .sort()

  const profilesRaw = await Promise.all(
    profileFiles.map(async (profilePath) => ({
      raw: await parseYamlValue(
        profilePath,
        normalizeRelativePath(resolvedBaseDir, profilePath),
      ),
      relativePath: normalizeRelativePath(resolvedBaseDir, profilePath),
    })),
  )

  const projectProfiles = profilesRaw
    .map((entry) => {
      const result = projectProfileSchema.safeParse(entry.raw)

      if (!result.success) {
        normalizeFieldErrors(entry.relativePath, result.error.issues, issues)
        return null
      }

      return {
        projectId: result.data.project_id,
        version: result.data.version,
        standardsBundleRef: result.data.standards_bundle_ref,
        kbRoot: result.data.kb_root,
        entryNote: result.data.entry_note,
        changelogNote: result.data.changelog_note,
        projectTag: result.data.project_tag,
        repos: result.data.repos.map((repo) => ({
          repoSlug: repo.repo_slug,
          mappingRole: repo.mapping_role,
          localRepoPath: repo.local_repo_path,
          repoGuidanceFiles: repo.repo_guidance_files,
          repoChangelogPath: repo.repo_changelog_path,
        })),
        repositoryRegistry: {
          sourceOfTruth: result.data.repository_registry.source_of_truth,
          resolutionDocRef: result.data.repository_registry.resolution_doc_ref,
          primaryRepoResolutionOrder:
            result.data.repository_registry.primary_repo_resolution_order,
          affectedRepoResolutionOrder:
            result.data.repository_registry.affected_repo_resolution_order,
        },
        crossRepoRouting: {
          loadProjectProfileBeforeRepoRules:
            result.data.cross_repo_routing.load_project_profile_before_repo_rules,
          loadAllAffectedRepoRules:
            result.data.cross_repo_routing.load_all_affected_repo_rules,
          conflictResolution: result.data.cross_repo_routing.conflict_resolution,
          failWhenPrimaryRepoMissing:
            result.data.cross_repo_routing.fail_when_primary_repo_missing,
          failWhenRepoRulesMissing:
            result.data.cross_repo_routing.fail_when_repo_rules_missing,
        },
        defaultToolPolicy: {
          runtimeProviders: result.data.default_tool_policy.runtime_providers,
          sharedMcpRefs: result.data.default_tool_policy.shared_mcp_refs,
          runnerDistributionRef: result.data.default_tool_policy.runner_distribution_ref,
        },
        escalationOwners: result.data.escalation_owners,
        humanGates: result.data.human_gates,
        namingConventions: {
          rootFolderTag: result.data.naming_conventions.root_folder_tag,
          rootNoteRef: result.data.naming_conventions.root_note_ref,
          repoChangelogFilename: result.data.naming_conventions.repo_changelog_filename,
          standardsBundleRefFormat:
            result.data.naming_conventions.standards_bundle_ref_format,
        },
        relativePath: entry.relativePath,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  const documents = await Promise.all(
    libraryData.documents.map(async (document) => {
      const resolvedDocumentPath = path.resolve(manifestDir, document.path)
      return {
        documentId: document.document_id,
        title: document.title,
        kind: document.kind,
        required: document.required,
        declaredPath: document.path,
        resolvedPath: resolvedDocumentPath,
        relativePath: normalizeRelativePath(resolvedBaseDir, resolvedDocumentPath),
        body: await readFile(resolvedDocumentPath, 'utf8'),
      }
    }),
  )

  if (issues.length > 0 || !layeringResult.success) {
    throw new StandardsBundleValidationError(issues)
  }

  return {
    source: 'working',
    configRootDir: resolvedBaseDir,
    resolvedBaseDir,
    library: {
      standardsBundleId: libraryData.standards_bundle_id,
      version: libraryData.version,
      owners: libraryData.owners,
      releaseModel: libraryData.release_model,
      sourceRefs: libraryData.source_refs,
      documents: libraryData.documents.map((document) => ({
        documentId: document.document_id,
        title: document.title,
        kind: document.kind,
        path: document.path,
        required: document.required,
      })),
      requiredDocumentIds: libraryData.required_document_ids,
      expectedDocumentCount: libraryData.expected_document_count,
      expectedProjectProfileCount: libraryData.expected_project_profile_count,
      projectProfileDir: libraryData.project_profile_dir,
      layeringPolicyPath: libraryData.layering_policy_path,
      versioningPolicy: {
        releaseIdPattern: libraryData.versioning_policy.release_id_pattern,
        immutableReleaseManifests:
          libraryData.versioning_policy.immutable_release_manifests,
        documentHashRequired: libraryData.versioning_policy.document_hash_required,
        silentMutationForbidden:
          libraryData.versioning_policy.silent_mutation_forbidden,
        nextReleaseMustBeMonotonic:
          libraryData.versioning_policy.next_release_must_be_monotonic,
      },
      releasePolicy: {
        publishedReleaseRequiredForRollout:
          libraryData.release_policy.published_release_required_for_rollout,
        releaseManifestIsAuthoritative:
          libraryData.release_policy.release_manifest_is_authoritative,
        fingerprintScopedSeparatelyFromRuntimeLibrary:
          libraryData.release_policy.fingerprint_scoped_separately_from_runtime_library,
      },
    },
    documents,
    layeringPolicy: {
      precedenceOrder: layeringResult.data.precedence_order,
      mergeRules: {
        lowerLayerCannotRelaxUpper:
          layeringResult.data.merge_rules.lower_layer_cannot_relax_upper,
        additiveOverlaysOnly:
          layeringResult.data.merge_rules.additive_overlays_only,
        stricterConstraintWins:
          layeringResult.data.merge_rules.stricter_constraint_wins,
        unresolvedConflictAction:
          layeringResult.data.merge_rules.unresolved_conflict_action,
      },
      multiRepoPolicy: {
        loadProjectProfileFirst:
          layeringResult.data.multi_repo_policy.load_project_profile_first,
        loadAllAffectedRepositoryRules:
          layeringResult.data.multi_repo_policy.load_all_affected_repository_rules,
        primaryRepoResolutionOrder:
          layeringResult.data.multi_repo_policy.primary_repo_resolution_order,
        conflictResolution: layeringResult.data.multi_repo_policy.conflict_resolution,
        missingPrimaryRepoAction:
          layeringResult.data.multi_repo_policy.missing_primary_repo_action,
      },
      knowledgeRouting: {
        standardsDocumentsAreCentralized:
          layeringResult.data.knowledge_routing.standards_documents_are_centralized,
        projectProfileRequired:
          layeringResult.data.knowledge_routing.project_profile_required,
        repoGuidanceFiles: layeringResult.data.knowledge_routing.repo_guidance_files,
        affectedRepoLoadingMode:
          layeringResult.data.knowledge_routing.affected_repo_loading_mode,
      },
      changelogRouting: {
        systemStandardsChangelogPath:
          layeringResult.data.changelog_routing.system_standards_changelog_path,
        projectChangelogMode: layeringResult.data.changelog_routing.project_changelog_mode,
        projectChangelogProfileKey:
          layeringResult.data.changelog_routing.project_changelog_profile_key,
        repositoryChangelogFilename:
          layeringResult.data.changelog_routing.repository_changelog_filename,
        repositoryCodeChangeLogRequired:
          layeringResult.data.changelog_routing.repository_code_change_log_required,
      },
      exceptionPolicy: {
        defaultBehavior: layeringResult.data.exception_policy.default_behavior,
        exceptionClasses: layeringResult.data.exception_policy.exception_classes,
        requiredFields: layeringResult.data.exception_policy.required_fields,
        temporaryOverrideRequiresHumanApproval:
          layeringResult.data.exception_policy.temporary_override_requires_human_approval,
        manualOverrideRequiresAuditEntry:
          layeringResult.data.exception_policy.manual_override_requires_audit_entry,
      },
      crossProjectPolicy: {
        isolationRequired:
          layeringResult.data.cross_project_policy.isolation_required,
        allowCrossProjectMixOnlyWhenRegistryMarksMultiProject:
          layeringResult.data.cross_project_policy.allow_cross_project_mix_only_when_registry_marks_multi_project,
        crossProjectDefaultAction:
          layeringResult.data.cross_project_policy.cross_project_default_action,
      },
    },
    projectProfiles,
    releaseIndex,
  }
}

export function buildStandardsBundleFingerprints(
  bundle: StandardsBundle,
): StandardsFingerprintSet {
  const documentFingerprints = Object.fromEntries(
    bundle.documents.map((document) => [
      document.documentId,
      hashStableValue({
        documentId: document.documentId,
        title: document.title,
        kind: document.kind,
        body: document.body,
      }),
    ]),
  )

  const projectProfileFingerprints = Object.fromEntries(
    bundle.projectProfiles.map((profile) => [
      profile.projectId,
      hashStableValue({
        projectId: profile.projectId,
        version: profile.version,
        standardsBundleRef: profile.standardsBundleRef,
        kbRoot: profile.kbRoot,
        changelogNote: profile.changelogNote,
        repos: profile.repos,
        repositoryRegistry: profile.repositoryRegistry,
        crossRepoRouting: profile.crossRepoRouting,
        defaultToolPolicy: profile.defaultToolPolicy,
        escalationOwners: profile.escalationOwners,
        humanGates: profile.humanGates,
        namingConventions: profile.namingConventions,
      }),
    ]),
  )

  return {
    bundleFingerprint: hashStableValue({
      library: bundle.library,
      documents: bundle.documents.map((document) => ({
        documentId: document.documentId,
        title: document.title,
        kind: document.kind,
        body: document.body,
      })),
      layeringPolicy: bundle.layeringPolicy,
      projectProfiles: bundle.projectProfiles.map((profile) => ({
        projectId: profile.projectId,
        version: profile.version,
        standardsBundleRef: profile.standardsBundleRef,
        kbRoot: profile.kbRoot,
        changelogNote: profile.changelogNote,
        repos: profile.repos,
        repositoryRegistry: profile.repositoryRegistry,
        crossRepoRouting: profile.crossRepoRouting,
        defaultToolPolicy: profile.defaultToolPolicy,
        escalationOwners: profile.escalationOwners,
        humanGates: profile.humanGates,
        namingConventions: profile.namingConventions,
      })),
    }),
    documentFingerprints,
    projectProfileFingerprints,
  }
}

export async function validateStandardsBundle(
  bundle: StandardsBundle,
): Promise<StandardsValidationResult> {
  const issues: string[] = []

  ensureUnique(
    bundle.documents.map((document) => document.documentId),
    'standards document id',
    issues,
  )
  ensureUnique(
    bundle.projectProfiles.map((profile) => profile.projectId),
    'project profile id',
    issues,
  )

  if (bundle.documents.length !== bundle.library.expectedDocumentCount) {
    issues.push(
      `Standards document count ${bundle.documents.length} does not match expected_document_count ${bundle.library.expectedDocumentCount}`,
    )
  }

  if (bundle.projectProfiles.length !== bundle.library.expectedProjectProfileCount) {
    issues.push(
      `Project profile count ${bundle.projectProfiles.length} does not match expected_project_profile_count ${bundle.library.expectedProjectProfileCount}`,
    )
  }

  for (const requiredDocumentId of bundle.library.requiredDocumentIds) {
    if (!bundle.documents.some((document) => document.documentId === requiredDocumentId)) {
      issues.push(`Missing required standards document ${requiredDocumentId}`)
    }
  }

  for (const document of bundle.documents) {
    if (document.required && document.body.trim().length === 0) {
      issues.push(`Required standards document ${document.documentId} is empty`)
    }
  }

  if (bundle.layeringPolicy.precedenceOrder.join(' > ') !== 'system > project > repository > agent_runtime > provider') {
    issues.push('Layering policy precedence_order must be system > project > repository > agent_runtime > provider')
  }

  if (!bundle.layeringPolicy.mergeRules.lowerLayerCannotRelaxUpper) {
    issues.push('Layering policy must forbid lower layers from relaxing upper layers')
  }

  if (!bundle.layeringPolicy.crossProjectPolicy.isolationRequired) {
    issues.push('Cross-project isolation must remain required')
  }

  for (const profile of bundle.projectProfiles) {
    if (profile.standardsBundleRef !== `${bundle.library.standardsBundleId}/${bundle.library.version}`) {
      issues.push(
        `${profile.relativePath} standards_bundle_ref must target ${bundle.library.standardsBundleId}/${bundle.library.version}`,
      )
    }

    if (profile.repos.length === 0) {
      issues.push(`${profile.relativePath} must declare at least one repository`)
    }

    if (
      profile.namingConventions.repoChangelogFilename !==
      bundle.layeringPolicy.changelogRouting.repositoryChangelogFilename
    ) {
      issues.push(
        `${profile.relativePath} repo changelog filename must match layering policy`,
      )
    }
  }

  if (bundle.releaseIndex) {
    if (bundle.releaseIndex.standardsBundleId !== bundle.library.standardsBundleId) {
      issues.push('Standards release index bundle id does not match the library manifest')
    }

    if (bundle.releaseIndex.releaseIdPattern !== bundle.library.versioningPolicy.releaseIdPattern) {
      issues.push('Standards release index release_id_pattern does not match versioning policy')
    }
  }

  if (issues.length > 0) {
    throw new StandardsBundleValidationError(issues)
  }

  const fingerprints = buildStandardsBundleFingerprints(bundle)

  return {
    bundle,
    summary: {
      documentCount: bundle.documents.length,
      requiredDocumentCount: bundle.documents.filter((document) => document.required).length,
      projectProfileCount: bundle.projectProfiles.length,
      repoCount: bundle.projectProfiles.flatMap((profile) => profile.repos).length,
    },
    fingerprints,
  }
}
