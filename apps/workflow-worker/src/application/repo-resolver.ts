/**
 * Resolves primary repository and reads repo guidance files for context enrichment.
 * Resolution order follows the project profile's primary_repo_resolution_order:
 *   1. project_repository_mappings (primary mapping for the Linear project)
 *   2. Fallback to first repo in project profile
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Kysely } from 'kysely'

import type { Database } from '@ai-dev-team/db'

export interface RepoGuidanceFile {
  repoSlug: string
  filePath: string
  content: string
}

export interface RepoRegistryEntry {
  repoSlug: string
  githubOwner: string
  githubRepo: string
  defaultBranch: string
  localCheckoutPath: string | null
  agentGuidanceScope: string
}

export interface RepoResolutionResult {
  primaryRepo: string | null
  primaryRepoEntry: RepoRegistryEntry | null
  affectedRepos: string[]
  guidanceFiles: RepoGuidanceFile[]
  warnings: string[]
}

const DEFAULT_GUIDANCE_FILES = [
  'AGENTS.md',
  'PLAN.md',
  'TESTPLAN.md',
  'RELEASE.md',
  'ENVIRONMENT.md',
]

export async function resolvePrimaryRepo(
  db: Kysely<Database>,
  input: {
    projectId: string | null
    fallbackRepoSlug: string | null
  },
): Promise<{ primaryRepo: string | null; source: string; warnings: string[] }> {
  const warnings: string[] = []

  if (input.projectId) {
    const mapping = await db
      .selectFrom('project_repository_mappings')
      .select(['repo_slug'])
      .where('linear_project_id', '=', input.projectId)
      .where('mapping_role', '=', 'primary')
      .orderBy('priority_order', 'asc')
      .executeTakeFirst()

    if (mapping) {
      return { primaryRepo: mapping.repo_slug, source: 'project_repository_mappings', warnings }
    }

    warnings.push(`No primary mapping found for project ${input.projectId}`)
  }

  if (input.fallbackRepoSlug) {
    return { primaryRepo: input.fallbackRepoSlug, source: 'project_profile_fallback', warnings }
  }

  warnings.push('Could not resolve primary repo from any source')
  return { primaryRepo: null, source: 'none', warnings }
}

export async function resolveAffectedRepos(
  db: Kysely<Database>,
  input: {
    projectId: string | null
    primaryRepo: string | null
  },
): Promise<string[]> {
  if (!input.projectId) {
    return []
  }

  const mappings = await db
    .selectFrom('project_repository_mappings')
    .select(['repo_slug'])
    .where('linear_project_id', '=', input.projectId)
    .where('mapping_role', '=', 'affected')
    .orderBy('priority_order', 'asc')
    .execute()

  return mappings
    .map((m) => m.repo_slug)
    .filter((slug) => slug !== input.primaryRepo)
}

export async function getRepoRegistryEntry(
  db: Kysely<Database>,
  repoSlug: string,
): Promise<RepoRegistryEntry | null> {
  const row = await db
    .selectFrom('repository_registry')
    .select([
      'repo_slug',
      'github_owner',
      'github_repo',
      'default_branch',
      'local_checkout_path',
      'agent_guidance_scope',
    ])
    .where('repo_slug', '=', repoSlug)
    .where('is_active', '=', true)
    .executeTakeFirst()

  if (!row) {
    return null
  }

  return {
    repoSlug: row.repo_slug,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    defaultBranch: row.default_branch,
    localCheckoutPath: row.local_checkout_path,
    agentGuidanceScope: row.agent_guidance_scope,
  }
}

export async function readGuidanceFiles(
  repoSlug: string,
  localCheckoutPath: string,
  fileNames?: string[],
): Promise<{ files: RepoGuidanceFile[]; warnings: string[] }> {
  const files: RepoGuidanceFile[] = []
  const warnings: string[] = []
  const targetFiles = fileNames ?? DEFAULT_GUIDANCE_FILES

  for (const fileName of targetFiles) {
    const filePath = join(localCheckoutPath, fileName)

    try {
      const content = await readFile(filePath, 'utf-8')

      if (content.trim().length > 0) {
        files.push({ repoSlug, filePath: fileName, content })
      }
    } catch {
      warnings.push(`Guidance file not found: ${repoSlug}/${fileName}`)
    }
  }

  return { files, warnings }
}

export async function resolveRepoContext(
  db: Kysely<Database>,
  input: {
    projectId: string | null
    fallbackRepoSlug: string | null
    guidanceFileNames?: string[]
  },
): Promise<RepoResolutionResult> {
  const allWarnings: string[] = []

  const { primaryRepo, warnings: resolveWarnings } = await resolvePrimaryRepo(db, {
    projectId: input.projectId,
    fallbackRepoSlug: input.fallbackRepoSlug,
  })
  allWarnings.push(...resolveWarnings)

  if (!primaryRepo) {
    return {
      primaryRepo: null,
      primaryRepoEntry: null,
      affectedRepos: [],
      guidanceFiles: [],
      warnings: allWarnings,
    }
  }

  const primaryRepoEntry = await getRepoRegistryEntry(db, primaryRepo)

  if (!primaryRepoEntry) {
    allWarnings.push(`Primary repo "${primaryRepo}" not found in repository_registry`)
    return {
      primaryRepo,
      primaryRepoEntry: null,
      affectedRepos: [],
      guidanceFiles: [],
      warnings: allWarnings,
    }
  }

  const guidanceFiles: RepoGuidanceFile[] = []

  if (primaryRepoEntry.localCheckoutPath) {
    const { files, warnings: guidanceWarnings } = await readGuidanceFiles(
      primaryRepo,
      primaryRepoEntry.localCheckoutPath,
      input.guidanceFileNames,
    )
    guidanceFiles.push(...files)
    allWarnings.push(...guidanceWarnings)
  } else {
    allWarnings.push(`Primary repo "${primaryRepo}" has no local_checkout_path`)
  }

  const affectedRepos = await resolveAffectedRepos(db, {
    projectId: input.projectId,
    primaryRepo,
  })

  for (const affectedSlug of affectedRepos) {
    const entry = await getRepoRegistryEntry(db, affectedSlug)

    if (entry?.localCheckoutPath) {
      const { files, warnings: guidanceWarnings } = await readGuidanceFiles(
        affectedSlug,
        entry.localCheckoutPath,
        input.guidanceFileNames,
      )
      guidanceFiles.push(...files)
      allWarnings.push(...guidanceWarnings)
    }
  }

  return {
    primaryRepo,
    primaryRepoEntry,
    affectedRepos,
    guidanceFiles,
    warnings: allWarnings,
  }
}
