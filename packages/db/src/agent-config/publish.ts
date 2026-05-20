import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'

import { sql, type Kysely } from 'kysely'

import type { Database, JsonObject } from '../schema.js'
import { executeWithSerializationRetry } from '../workflow-config/publish.js'
import {
  AgentLibraryValidationError,
  loadAgentLibraryBundle,
  resolveAgentConfigFolder,
  resolveAgentReleaseRoot,
  validateAgentLibraryBundle,
} from './manifest-loader.js'
import type {
  AgentLibraryReleaseSummary,
  AgentPromptBundleResolutionMode,
  PublishAgentRuntimeReleaseInput,
  PublishAgentRuntimeReleaseResult,
  PublishedAgentRuntimeBundle,
  PublishedAgentRuntimePromptBundle,
  PublishedAgentRuntimeRoleCharter,
} from './types.js'

const AGENT_RUNTIME_PUBLISH_LOCK_ID = 820_335_500_002n
const COMPATIBILITY_PROMPT_BUNDLE_ALIASES = [
  {
    aliasRoleId: 'build_agent',
    canonicalRoleId: 'build_agent_backend',
  },
] as const

function toJsonb<T>(value: T) {
  return sql<T>`${JSON.stringify(value)}::jsonb`
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry))
  }

  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = stableSortValue(
          (value as Record<string, unknown>)[key],
        )
        return accumulator
      }, {})
  }

  return value
}

function hashStableValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableSortValue(value)))
    .digest('hex')
}

function buildPromptBundleRef(releaseId: string, roleId: string): string {
  return `agent-library://releases/${releaseId}/prompt-bundles/${roleId}`
}

function buildRoleCharterRef(releaseId: string, roleId: string): string {
  return `agent-library://releases/${releaseId}/role-charters/${roleId}`
}

function parseReleaseSequence(releaseId: string): number {
  const match = /^v(\d+)$/u.exec(releaseId)
  return match ? Number(match[1]) : Number.NaN
}

async function resolveDefaultReleaseId(baseDir: string): Promise<string> {
  const releaseRoot = resolveAgentReleaseRoot(baseDir)
  const entries = await readdir(releaseRoot, { withFileTypes: true })
  const releaseIds = entries
    .filter((entry) => entry.isDirectory() && /^v\d+$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => parseReleaseSequence(left) - parseReleaseSequence(right))

  const latestReleaseId = releaseIds.at(-1)
  if (!latestReleaseId) {
    throw new AgentLibraryValidationError([
      `No published agent-library releases found under ${releaseRoot}`,
    ])
  }

  return latestReleaseId
}

function mapAgentLibraryReleaseSummary(row: {
  release_id: string
  library_id: string
  library_version: string
  library_fingerprint: string
  published_at: Date
  published_by: string
  source_library_fingerprint: string
  is_active_for_new_runs: boolean
  created_at: Date
}): AgentLibraryReleaseSummary {
  return {
    releaseId: row.release_id,
    libraryId: row.library_id,
    libraryVersion: row.library_version,
    libraryFingerprint: row.library_fingerprint,
    publishedAt: row.published_at.toISOString(),
    publishedBy: row.published_by,
    sourceLibraryFingerprint: row.source_library_fingerprint,
    isActiveForNewRuns: row.is_active_for_new_runs,
    createdAt: row.created_at.toISOString(),
  }
}

function buildPromptBundles(input: {
  releaseId: string
  libraryVersion: string
  bundle: Awaited<ReturnType<typeof validateAgentLibraryBundle>>['bundle']
  promptBundleFingerprints: Record<string, string>
}): PublishedAgentRuntimePromptBundle[] {
  const roleSkillPackMapByRoleId = new Map(
    input.bundle.roleSkillPackMap.map((entry) => [entry.roleId, entry]),
  )
  const rolePromptFamilyMapByRoleId = new Map(
    input.bundle.promptFamilyMap.rolePromptFamilies.map((entry) => [
      entry.roleId,
      entry.promptFamilyRef,
    ]),
  )
  const packPromptFamilyMap = new Map(
    input.bundle.promptFamilyMap.packOverlayFamilies.map((entry) => [
      entry.packId,
      entry.promptFamilyRef,
    ]),
  )
  const globalBaselineRefs = input.bundle.promptFamilies
    .filter((family) => family.familyId === 'global-baseline')
    .map((family) => `${family.familyId}/${family.version}`)
    .sort((left, right) => left.localeCompare(right))

  const canonicalBundles = input.bundle.roleCharters.map((role) => {
    const defaultSkillPackRefs = (
      roleSkillPackMapByRoleId.get(role.frontmatter.roleId)?.defaultSkillPackRefs ?? []
    ).slice().sort((left, right) => left.localeCompare(right))
    const overlayPromptFamilyRefs = defaultSkillPackRefs
      .map((packId) => packPromptFamilyMap.get(packId))
      .filter((value): value is string => typeof value === 'string')
    const rolePromptFamilyRef = rolePromptFamilyMapByRoleId.get(role.frontmatter.roleId)
    const defaultPromptFamilyRefs = Array.from(
      new Set([
        ...globalBaselineRefs,
        ...overlayPromptFamilyRefs,
        ...(rolePromptFamilyRef ? [rolePromptFamilyRef] : []),
      ]),
    ).sort((left, right) => left.localeCompare(right))

    return {
      releaseId: input.releaseId,
      roleId: role.frontmatter.roleId,
      promptBundleRef: buildPromptBundleRef(input.releaseId, role.frontmatter.roleId),
      roleCharterRef: buildRoleCharterRef(input.releaseId, role.frontmatter.roleId),
      promptVersion: input.libraryVersion,
      promptBundleFingerprint:
        input.promptBundleFingerprints[role.frontmatter.roleId] ?? '',
      defaultSkillPackRefs,
      defaultPromptFamilyRefs,
      resolutionMode: 'canonical' as AgentPromptBundleResolutionMode,
    } satisfies PublishedAgentRuntimePromptBundle
  })

  const canonicalBundleByRoleId = new Map(
    canonicalBundles.map((bundle) => [bundle.roleId, bundle]),
  )

  const aliasBundles = COMPATIBILITY_PROMPT_BUNDLE_ALIASES.map((alias) => {
    const sourceBundle = canonicalBundleByRoleId.get(alias.canonicalRoleId)
    if (!sourceBundle) {
      throw new AgentLibraryValidationError([
        `Missing canonical prompt bundle ${alias.canonicalRoleId} for compatibility alias ${alias.aliasRoleId}`,
      ])
    }

    return {
      ...sourceBundle,
      roleId: alias.aliasRoleId,
      promptBundleRef: buildPromptBundleRef(input.releaseId, alias.aliasRoleId),
      resolutionMode: 'compatibility_alias' as AgentPromptBundleResolutionMode,
    }
  })

  return [...canonicalBundles, ...aliasBundles]
}

export async function getActiveAgentLibraryReleaseSummary(
  db: Kysely<Database>,
): Promise<AgentLibraryReleaseSummary | null> {
  const row = await db
    .selectFrom('agent_library_releases')
    .selectAll()
    .where('is_active_for_new_runs', '=', true)
    .executeTakeFirst()

  return row ? mapAgentLibraryReleaseSummary(row) : null
}

export async function loadPublishedAgentRuntimeBundle(
  db: Kysely<Database>,
  releaseId: string,
): Promise<PublishedAgentRuntimeBundle | null> {
  const releaseRow = await db
    .selectFrom('agent_library_releases')
    .selectAll()
    .where('release_id', '=', releaseId)
    .executeTakeFirst()

  if (!releaseRow) {
    return null
  }

  const [
    roleCharters,
    promptFamilies,
    skillPacks,
    promptBundles,
    routingSkillPackRules,
  ] = await Promise.all([
    db
      .selectFrom('agent_role_charters')
      .selectAll()
      .where('release_id', '=', releaseId)
      .orderBy('role_id', 'asc')
      .execute(),
    db
      .selectFrom('agent_prompt_families')
      .selectAll()
      .where('release_id', '=', releaseId)
      .orderBy('prompt_family_ref', 'asc')
      .execute(),
    db
      .selectFrom('agent_skill_packs')
      .selectAll()
      .where('release_id', '=', releaseId)
      .orderBy('pack_id', 'asc')
      .execute(),
    db
      .selectFrom('agent_prompt_bundles')
      .selectAll()
      .where('release_id', '=', releaseId)
      .orderBy('role_id', 'asc')
      .execute(),
    db
      .selectFrom('agent_routing_skill_pack_rules')
      .selectAll()
      .where('release_id', '=', releaseId)
      .orderBy('rule_id', 'asc')
      .execute(),
  ])

  return {
    release: mapAgentLibraryReleaseSummary(releaseRow),
    roleCharters: roleCharters.map((row) => ({
      releaseId: row.release_id,
      roleId: row.role_id,
      charterVersion: row.charter_version,
      canonicalRunKind: row.canonical_run_kind,
      frontmatter:
        row.frontmatter_json as unknown as PublishedAgentRuntimeRoleCharter['frontmatter'],
      sourceRefs: row.source_refs,
      body: row.body,
      relativePath: row.relative_path,
      roleFingerprint: row.role_fingerprint,
    })),
    promptFamilies: promptFamilies.map((row) => ({
      releaseId: row.release_id,
      promptFamilyRef: row.prompt_family_ref,
      familyId: row.family_id,
      familyVersion: row.family_version,
      providerCompatibility: row.provider_compatibility,
      compatibleRoles: row.compatible_roles,
      compatibleSkillPacks: row.compatible_skill_packs,
      sourceRefs: row.source_refs,
      body: row.body,
      relativePath: row.relative_path,
      familyFingerprint: row.family_fingerprint,
    })),
    skillPacks: skillPacks.map((row) => ({
      releaseId: row.release_id,
      packId: row.pack_id,
      packVersion: row.pack_version,
      purpose: row.purpose,
      skillRefs: row.skill_refs,
      optionalSkillRefs: row.optional_skill_refs,
      providers: row.providers,
      activationConditions:
        row.activation_conditions as unknown as {
          statuses: string[]
          taskTypes: string[]
          requiresIntegration: boolean | null
          notes: string | null
        },
      promptFamilyRefs: row.prompt_family_refs,
      deniedActionsOverlay: row.denied_actions_overlay,
      humanGateOverlay:
        row.human_gate_overlay as unknown as {
          required: boolean
          zones: string[]
          notes: string | null
        },
      sourceRefs: row.source_refs,
      skillPackFingerprint: row.skill_pack_fingerprint,
    })),
    promptBundles: promptBundles.map((row) => ({
      releaseId: row.release_id,
      roleId: row.role_id,
      promptBundleRef: row.prompt_bundle_ref,
      roleCharterRef: row.role_charter_ref,
      promptVersion: row.prompt_version,
      promptBundleFingerprint: row.prompt_bundle_fingerprint,
      defaultSkillPackRefs: row.default_skill_pack_refs,
      defaultPromptFamilyRefs: row.default_prompt_family_refs,
      resolutionMode: row.resolution_mode,
    })),
    routingSkillPackRules: routingSkillPackRules.map((row) => ({
      releaseId: row.release_id,
      ruleId: row.rule_id,
      statuses: row.statuses,
      triggers: row.triggers,
      taskTypes: row.task_types,
      requiresIntegration: row.requires_integration,
      addSkillPackRefs: row.add_skill_pack_refs,
      notes: row.notes,
    })),
  }
}

export async function publishAgentRuntimeRelease(
  db: Kysely<Database>,
  input: PublishAgentRuntimeReleaseInput,
): Promise<PublishAgentRuntimeReleaseResult> {
  const baseDir = input.baseDir ? input.baseDir : resolveAgentConfigFolder()
  const releaseId = input.releaseId ?? (await resolveDefaultReleaseId(baseDir))
  const bundle = await loadAgentLibraryBundle({
    baseDir,
    source: 'release',
    releaseId,
  })
  const result = await validateAgentLibraryBundle(bundle)
  const releaseManifest = result.bundle.releaseManifest

  if (!releaseManifest) {
    throw new AgentLibraryValidationError([
      `Release ${releaseId} is not published and cannot be mirrored into runtime state`,
    ])
  }

  const promptBundles = buildPromptBundles({
    releaseId,
    libraryVersion: releaseManifest.libraryVersion,
    bundle: result.bundle,
    promptBundleFingerprints: result.fingerprints.promptBundleFingerprints,
  })
  const promptFamilyRefsByPackId = new Map<string, string[]>(
    result.bundle.skillPacks.map((pack) => [
      pack.packId,
      result.bundle.promptFamilyMap.packOverlayFamilies
        .filter((entry) => entry.packId === pack.packId)
        .map((entry) => entry.promptFamilyRef)
        .sort((left, right) => left.localeCompare(right)),
    ]),
  )
  const roleFingerprintByRoleId = new Map(
    result.bundle.roleCharters.map((role) => [
      role.frontmatter.roleId,
      hashStableValue({
        frontmatter: role.frontmatter,
        body: role.body,
      }),
    ]),
  )
  const familyFingerprintByRef = result.fingerprints.promptFamilyFingerprints
  const skillPackFingerprintByPackId = result.fingerprints.skillPackFingerprints

  return executeWithSerializationRetry(() =>
    db.transaction().execute(async (trx) => {
      await sql`set transaction isolation level serializable`.execute(trx)
      await sql`select pg_advisory_xact_lock(${AGENT_RUNTIME_PUBLISH_LOCK_ID})`.execute(
        trx,
      )

      const existing = await trx
        .selectFrom('agent_library_releases')
        .selectAll()
        .where('release_id', '=', releaseId)
        .executeTakeFirst()

      if (
        existing &&
        existing.library_fingerprint !== result.fingerprints.libraryFingerprint
      ) {
        throw new Error(
          `Agent-library runtime release ${releaseId} already exists with different content`,
        )
      }

      const previousActive = await trx
        .selectFrom('agent_library_releases')
        .select(['release_id'])
        .where('is_active_for_new_runs', '=', true)
        .executeTakeFirst()

      let inserted = false

      if (!existing) {
        await trx
          .insertInto('agent_library_releases')
          .values({
            release_id: releaseManifest.releaseId,
            library_id: releaseManifest.libraryId,
            library_version: releaseManifest.libraryVersion,
            library_fingerprint: result.fingerprints.libraryFingerprint,
            published_at: new Date(releaseManifest.publishedAt),
            published_by: input.publishedBy || releaseManifest.publishedBy,
            source_library_fingerprint: releaseManifest.sourceLibraryFingerprint,
            is_active_for_new_runs: false,
          })
          .execute()

        await trx
          .insertInto('agent_role_charters')
          .values(
            result.bundle.roleCharters.map((role) => ({
              release_id: releaseManifest.releaseId,
              role_id: role.frontmatter.roleId,
              charter_version: role.frontmatter.version,
              canonical_run_kind: role.frontmatter.canonicalRunKind,
              frontmatter_json: toJsonb(
                role.frontmatter as unknown as JsonObject,
              ),
              source_refs: toJsonb(role.frontmatter.sourceRefs),
              body: role.body,
              relative_path: role.relativePath,
              role_fingerprint:
                roleFingerprintByRoleId.get(role.frontmatter.roleId) ?? '',
            })),
          )
          .execute()

        await trx
          .insertInto('agent_prompt_families')
          .values(
            result.bundle.promptFamilies.map((family) => ({
              release_id: releaseManifest.releaseId,
              prompt_family_ref: `${family.familyId}/${family.version}`,
              family_id: family.familyId,
              family_version: family.version,
              provider_compatibility: toJsonb(family.providerCompatibility),
              compatible_roles: toJsonb(family.compatibleRoles),
              compatible_skill_packs: toJsonb(family.compatibleSkillPacks),
              source_refs: toJsonb(family.sourceRefs),
              body: family.body,
              relative_path: family.relativePath,
              family_fingerprint:
                familyFingerprintByRef[`${family.familyId}/${family.version}`] ?? '',
            })),
          )
          .execute()

        await trx
          .insertInto('agent_skill_packs')
          .values(
            result.bundle.skillPacks.map((pack) => ({
              release_id: releaseManifest.releaseId,
              pack_id: pack.packId,
              pack_version: pack.version,
              purpose: pack.purpose,
              skill_refs: toJsonb(pack.skillRefs),
              optional_skill_refs: toJsonb(pack.optionalSkillRefs),
              providers: toJsonb(pack.providers),
              activation_conditions: toJsonb(
                pack.activationConditions as unknown as JsonObject,
              ),
              prompt_family_refs: toJsonb(
                promptFamilyRefsByPackId.get(pack.packId) ?? [],
              ),
              denied_actions_overlay: toJsonb(pack.deniedActionsOverlay),
              human_gate_overlay: toJsonb(
                pack.humanGateOverlay as unknown as JsonObject,
              ),
              source_refs: toJsonb(pack.sourceRefs),
              skill_pack_fingerprint:
                skillPackFingerprintByPackId[pack.packId] ?? '',
            })),
          )
          .execute()

        await trx
          .insertInto('agent_prompt_bundles')
          .values(
            promptBundles.map((promptBundle) => ({
              release_id: promptBundle.releaseId,
              role_id: promptBundle.roleId,
              prompt_bundle_ref: promptBundle.promptBundleRef,
              role_charter_ref: promptBundle.roleCharterRef,
              prompt_version: promptBundle.promptVersion,
              prompt_bundle_fingerprint: promptBundle.promptBundleFingerprint,
              default_skill_pack_refs: toJsonb(promptBundle.defaultSkillPackRefs),
              default_prompt_family_refs: toJsonb(
                promptBundle.defaultPromptFamilyRefs,
              ),
              resolution_mode: promptBundle.resolutionMode,
            })),
          )
          .execute()

        await trx
          .insertInto('agent_routing_skill_pack_rules')
          .values(
            result.bundle.routingSkillPackMap.map((rule) => ({
              release_id: releaseManifest.releaseId,
              rule_id: rule.ruleId,
              statuses: toJsonb(rule.statuses),
              triggers: toJsonb(rule.triggers),
              task_types: toJsonb(rule.taskTypes),
              requires_integration: rule.requiresIntegration,
              add_skill_pack_refs: toJsonb(rule.addSkillPackRefs),
              notes: rule.notes,
            })),
          )
          .execute()

        inserted = true
      }

      let activationChanged = false
      if (input.activateForNewRuns) {
        await trx
          .updateTable('agent_library_releases')
          .set({ is_active_for_new_runs: false })
          .where('library_id', '=', releaseManifest.libraryId)
          .where('is_active_for_new_runs', '=', true)
          .execute()

        await trx
          .updateTable('agent_library_releases')
          .set({ is_active_for_new_runs: true })
          .where('release_id', '=', releaseManifest.releaseId)
          .execute()

        activationChanged = previousActive?.release_id !== releaseManifest.releaseId
      }

      const persisted = await trx
        .selectFrom('agent_library_releases')
        .selectAll()
        .where('release_id', '=', releaseManifest.releaseId)
        .executeTakeFirstOrThrow()

      return {
        releaseId: releaseManifest.releaseId,
        libraryId: releaseManifest.libraryId,
        libraryVersion: releaseManifest.libraryVersion,
        fingerprint: persisted.library_fingerprint,
        inserted,
        isActiveForNewRuns: persisted.is_active_for_new_runs,
        activationChanged,
      } satisfies PublishAgentRuntimeReleaseResult
    }),
  )
}

export {
  buildPromptBundleRef as buildAgentPromptBundleRef,
  buildRoleCharterRef as buildAgentRoleCharterRef,
}
