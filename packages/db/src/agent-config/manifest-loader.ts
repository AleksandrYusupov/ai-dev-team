import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDocument } from 'yaml'
import { z } from 'zod'

import { AGENT_PROVIDERS, RUN_KINDS } from '@ai-dev-team/shared'

import { loadWorkflowManifestBundle } from '../workflow-config/manifest-loader.js'
import type {
  AgentLibraryBundle,
  AgentLibraryFingerprintSet,
  AgentLibraryLoadOptions,
  AgentLibraryReleaseIndex,
  AgentLibraryReleaseManifest,
  AgentLibraryValidationResult,
} from './types.js'

export class AgentLibraryValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Agent library validation failed:\n${issues.join('\n')}`)
    this.name = 'AgentLibraryValidationError'
  }
}

const NULL_FINGERPRINT = createHash('sha256').update('null').digest('hex')

const humanGateSchema = z.object({
  required: z.boolean(),
  zones: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().min(1).nullable().default(null),
})

const libraryManifestSchema = z.object({
  library_id: z.string().trim().min(1),
  version: z.string().trim().min(1),
  owners: z.array(z.string().trim().min(1)).nonempty(),
  expected_role_count: z.number().int().positive(),
  expected_skill_count: z.number().int().positive(),
  expected_provider_overlay_count: z.number().int().nonnegative().default(0),
  release_model: z.literal('immutable_snapshot'),
  layering_model: z
    .string()
    .trim()
    .min(1)
    .default('role_pack_prompt_family'),
  provider_overlay_dir: z.string().trim().min(1).nullable().default(null),
  tool_policy_manifest_path: z.string().trim().min(1).nullable().default(null),
  source_refs: z.array(z.string().trim().min(1)).nonempty(),
  always_on_guidance_refs: z.array(z.string().trim().min(1)).nonempty(),
  compatibility_policy: z.object({
    runtime_task_bundle_unchanged: z.boolean(),
    db_persistence_unchanged: z.boolean(),
    provider_wiring_unchanged: z.boolean(),
    runner_distribution_out_of_scope: z.boolean(),
  }),
  versioning_policy: z.object({
    frontmatter_version_required: z.boolean(),
    silent_mutation_forbidden: z.boolean(),
    placeholder_content_allowed: z.boolean(),
    release_id_pattern: z.string().trim().min(1),
    immutable_published_releases: z.boolean(),
    next_release_must_be_monotonic: z.boolean(),
  }),
  rollback_policy: z.object({
    runner_host_rollout_policy: z.string().trim().min(1),
    canonical_source_of_truth: z.string().trim().min(1),
    runtime_mirror_not_authoritative: z.boolean(),
    published_release_required_for_rollout: z.boolean(),
    first_release_may_omit_rollback_target: z.boolean(),
  }),
  reference_skill_policy: z.object({
    materialized: z.boolean(),
    runtime_dependency_default: z.boolean(),
    reference_only_default: z.boolean(),
  }),
})

const fingerprintRecordSchema = z.record(z.string().trim().min(1), z.string().trim().min(1))

const releaseIndexSchema = z.object({
  library_id: z.string().trim().min(1),
  release_id_pattern: z.string().trim().min(1),
  releases: z.array(
    z.object({
      release_id: z.string().trim().min(1),
      library_version: z.string().trim().min(1),
      release_manifest_path: z.string().trim().min(1),
      published_at: z.string().trim().min(1),
      library_fingerprint: z.string().trim().min(1),
    }),
  ).default([]),
})

const releaseManifestSchema = z.object({
  release_id: z.string().trim().min(1),
  library_id: z.string().trim().min(1),
  library_version: z.string().trim().min(1),
  published_at: z.string().trim().min(1),
  published_by: z.string().trim().min(1),
  changelog_path: z.string().trim().min(1),
  predecessor_release_id: z.string().trim().min(1).nullable().default(null),
  rollback_to_release_id: z.string().trim().min(1).nullable().default(null),
  source_library_fingerprint: z.string().trim().min(1),
  fingerprints: z.object({
    library_fingerprint: z.string().trim().min(1),
    skill_fingerprints: fingerprintRecordSchema.default({}),
    skill_pack_fingerprints: fingerprintRecordSchema.default({}),
    prompt_family_fingerprints: fingerprintRecordSchema.default({}),
    prompt_bundle_fingerprints: fingerprintRecordSchema.default({}),
    provider_overlay_fingerprints: fingerprintRecordSchema.default({}),
    tooling_policy_fingerprint: z.string().trim().min(1).default(NULL_FINGERPRINT),
  }),
})

const roleCharterFrontmatterSchema = z.object({
  role_id: z.string().trim().min(1),
  version: z.string().trim().min(1),
  wave: z.number().int().positive(),
  category: z.string().trim().min(1),
  visible_in_linear: z.boolean(),
  canonical_run_kind: z.enum(RUN_KINDS).nullable().default(null),
  source_refs: z.array(z.string().trim().min(1)).nonempty(),
})

const skillMetaSchema = z.object({
  id: z.string().trim().min(1),
  version: z.string().trim().min(1),
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  availability: z.string().trim().min(1),
  kind: z.enum(['foundation', 'reusable', 'custom']),
  runtime_dependency: z.boolean(),
  reference_only_default: z.boolean().default(false),
  provider_compatibility: z.array(z.enum(AGENT_PROVIDERS)).nonempty(),
  required_tools: z.array(z.string().trim().min(1)).default([]),
  required_mcp: z.array(z.string().trim().min(1)).default([]),
  sensitivity_class: z.string().trim().min(1),
  when_to_use: z.array(z.string().trim().min(1)).nonempty(),
  inputs: z.array(z.string().trim().min(1)).default([]),
  steps: z.array(z.string().trim().min(1)).default([]),
  stop_conditions: z.array(z.string().trim().min(1)).default([]),
  escalation_rules: z.array(z.string().trim().min(1)).default([]),
  anti_patterns: z.array(z.string().trim().min(1)).default([]),
  denied_actions: z.array(z.string().trim().min(1)).default([]),
  human_gate: humanGateSchema,
  description: z.string().trim().min(1),
  why: z.string().trim().min(1),
  download_ref: z
    .union([
      z.string().trim().min(1),
      z.object({
        title: z.string().trim().min(1),
        url: z.string().trim().min(1),
      }),
      z.null(),
    ])
    .default(null),
  build_spec: z.string().trim().min(1).nullable().default(null),
  source_refs: z.array(z.string().trim().min(1)).nonempty(),
})

const skillPackSchema = z.object({
  pack_id: z.string().trim().min(1),
  version: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  skill_refs: z.array(z.string().trim().min(1)).default([]),
  optional_skill_refs: z.array(z.string().trim().min(1)).default([]),
  providers: z.array(z.enum(AGENT_PROVIDERS)).nonempty(),
  activation_conditions: z.object({
    statuses: z.array(z.string().trim().min(1)).default([]),
    task_types: z.array(z.string().trim().min(1)).default([]),
    requires_integration: z.boolean().nullable().default(null),
    notes: z.string().trim().min(1).nullable().default(null),
  }),
  denied_actions_overlay: z.array(z.string().trim().min(1)).default([]),
  human_gate_overlay: humanGateSchema,
  source_refs: z.array(z.string().trim().min(1)).nonempty(),
})

const roleSkillPackMapEntrySchema = z.object({
  role_id: z.string().trim().min(1),
  default_skill_pack_refs: z.array(z.string().trim().min(1)).nonempty(),
  notes: z.string().trim().min(1).nullable().default(null),
})

const routingRuleSchema = z.object({
  rule_id: z.string().trim().min(1),
  statuses: z.array(z.string().trim().min(1)).default([]),
  triggers: z.array(z.string().trim().min(1)).default([]),
  task_types: z.array(z.string().trim().min(1)).default([]),
  requires_integration: z.boolean().nullable().default(null),
  add_skill_pack_refs: z.array(z.string().trim().min(1)).nonempty(),
  notes: z.string().trim().min(1),
})

const promptFamilyMapSchema = z.object({
  role_prompt_families: z.array(
    z.object({
      role_id: z.string().trim().min(1),
      prompt_family_ref: z.string().trim().min(1),
    }),
  ),
  pack_overlay_families: z.array(
    z.object({
      pack_id: z.string().trim().min(1),
      prompt_family_ref: z.string().trim().min(1),
    }),
  ),
})

const promptFamilyFrontmatterSchema = z.object({
  family_id: z.string().trim().min(1),
  version: z.string().trim().min(1),
  provider_compatibility: z.array(z.enum(AGENT_PROVIDERS)).nonempty(),
  compatible_roles: z.array(z.string().trim().min(1)).default([]),
  compatible_skill_packs: z.array(z.string().trim().min(1)).default([]),
  source_refs: z.array(z.string().trim().min(1)).nonempty(),
})

const providerOverlayFrontmatterSchema = z.object({
  provider: z.enum(AGENT_PROVIDERS),
  version: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  source_refs: z.array(z.string().trim().min(1)).nonempty(),
})

const toolingPolicySchema = z.object({
  role_tool_policies: z.array(
    z.object({
      role_id: z.string().trim().min(1),
      allowed_tools: z.array(z.string().trim().min(1)).default([]),
      required_mcp_refs: z.array(z.string().trim().min(1)).default([]),
      write_scopes: z.array(z.string().trim().min(1)).default([]),
      denied_tools: z.array(z.string().trim().min(1)).default([]),
      human_gated_tools: z.array(z.string().trim().min(1)).default([]),
      notes: z.string().trim().min(1).nullable().default(null),
    }),
  ).default([]),
  provider_tool_policies: z.array(
    z.object({
      provider: z.enum(AGENT_PROVIDERS),
      overlay_ref: z.string().trim().min(1),
      allowed_tools: z.array(z.string().trim().min(1)).default([]),
      denied_tools: z.array(z.string().trim().min(1)).default([]),
      human_gated_tools: z.array(z.string().trim().min(1)).default([]),
      write_scopes: z.array(z.string().trim().min(1)).default([]),
      notes: z.string().trim().min(1).nullable().default(null),
    }),
  ).default([]),
})

const sourceAgentManifestSchema = z.object({
  agents: z.array(
    z.object({
      id: z.string().trim().min(1),
    }),
  ).nonempty(),
  skills: z.array(
    z.object({
      id: z.string().trim().min(1),
      name: z.string().trim().min(1),
    }),
  ).nonempty(),
})

const REQUIRED_ROLE_CHARTER_SECTIONS = [
  '## Identity',
  '## Goal',
  '## Inputs',
  '## Required Behavior',
  '## Forbidden Behavior',
  '## Outputs',
  '## Handoff Rules',
  '## Human Gates',
]

const REQUIRED_SKILL_SECTIONS = [
  '## Summary',
  '## When To Use',
  '## Inputs',
  '## Steps',
  '## Stop Conditions',
  '## Escalation Rules',
  '## Anti-Patterns',
  '## Denied Actions',
]

const REQUIRED_PROMPT_FAMILY_SECTIONS = [
  '## Invariant Rules',
  '## Role Overlay',
  '## Pack Overlay',
  '## Provider Notes',
]

const REQUIRED_PROVIDER_OVERLAY_SECTIONS = [
  '## Summary',
  '## Transport Constraints',
  '## Tooling Notes',
  '## Escalation Notes',
]

const REQUIRED_PROMPT_FAMILIES = [
  'global-baseline',
  'planning',
  'build',
  'review',
  'integration',
  'reporting',
]

const INTEGRATION_SKILL_IDS = new Set(
  Array.from({ length: 9 }, (_, index) => `S${String(index + 46).padStart(2, '0')}`),
)
const INTEGRATION_PACK_IDS = new Set([
  'integration_boundary_core',
  'build_integrations_core',
])

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

function ensureMarkdownSections(
  label: string,
  body: string,
  sections: string[],
  collector: string[],
): void {
  for (const section of sections) {
    if (!body.includes(section)) {
      collector.push(`${label} is missing required section ${section}`)
    }
  }
}

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

function parseReleaseNumber(releaseId: string): number | null {
  const match = /^v([1-9]\d*)$/u.exec(releaseId)
  if (!match) {
    return null
  }

  return Number(match[1])
}

function buildNextReleaseId(releaseId: string): string | null {
  const releaseNumber = parseReleaseNumber(releaseId)
  if (releaseNumber === null) {
    return null
  }

  return `v${String(releaseNumber + 1)}`
}

function isPathInside(rootDir: string, targetPath: string): boolean {
  const relativePath = path.relative(rootDir, targetPath)
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
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
    throw new AgentLibraryValidationError(issues)
  }

  return document.toJS()
}

async function parseYamlValueIfExists(
  filePath: string,
  label: string,
): Promise<unknown | null> {
  try {
    return await parseYamlValue(filePath, label)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function parseJsonValue(filePath: string, label: string): Promise<unknown> {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new AgentLibraryValidationError([`${label}: ${message}`])
  }
}

async function parseMarkdownWithFrontmatter(
  filePath: string,
  label: string,
): Promise<{ frontmatter: unknown; body: string }> {
  const content = await readFile(filePath, 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(content)

  if (!match) {
    throw new AgentLibraryValidationError([
      `${label}: missing YAML frontmatter block`,
    ])
  }

  const document = parseDocument(match[1])
  const issues: string[] = []

  for (const error of document.errors) {
    issues.push(`${label}: ${error.message}`)
  }

  for (const warning of document.warnings) {
    issues.push(`${label}: ${warning.message}`)
  }

  if (issues.length > 0) {
    throw new AgentLibraryValidationError(issues)
  }

  return {
    frontmatter: document.toJS(),
    body: match[2].trim(),
  }
}

async function readMarkdownBody(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

async function readDirectoryEntriesIfExists(
  directoryPath: string,
): Promise<Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>> {
  try {
    return await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

function normalizeRelativePath(baseDir: string, filePath: string): string {
  return path.relative(baseDir, filePath).replaceAll(path.sep, '/')
}

export function resolveAgentConfigFolder(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'config/agents',
  )
}

export function resolveAgentReleaseRoot(baseDir: string = resolveAgentConfigFolder()): string {
  return path.join(baseDir, 'releases')
}

export function resolveAgentReleaseFolder(
  releaseId: string,
  baseDir: string = resolveAgentConfigFolder(),
): string {
  return path.join(resolveAgentReleaseRoot(baseDir), releaseId)
}

export function resolveAgentSourceManifestPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'building_agents/ai_dept_agents_and_skills_manifest_v2.json',
  )
}

async function loadAgentReleaseIndex(
  baseDir: string,
): Promise<AgentLibraryReleaseIndex | null> {
  const indexPath = path.join(resolveAgentReleaseRoot(baseDir), 'index.yaml')

  try {
    const raw = await parseYamlValue(indexPath, 'releases/index.yaml')
    const result = releaseIndexSchema.safeParse(raw)

    if (!result.success) {
      throw new AgentLibraryValidationError(
        result.error.issues.map((issue) => {
          const location = issue.path.length > 0 ? issue.path.join('.') : '<root>'
          return `releases/index.yaml ${location}: ${issue.message}`
        }),
      )
    }

    return {
      libraryId: result.data.library_id,
      releaseIdPattern: result.data.release_id_pattern,
      releases: result.data.releases.map((entry) => ({
        releaseId: entry.release_id,
        libraryVersion: entry.library_version,
        releaseManifestPath: entry.release_manifest_path,
        publishedAt: entry.published_at,
        libraryFingerprint: entry.library_fingerprint,
      })),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function loadAgentReleaseManifest(
  snapshotDir: string,
  baseDir: string,
): Promise<AgentLibraryReleaseManifest | null> {
  const manifestPath = path.join(snapshotDir, 'release.yaml')

  try {
    const raw = await parseYamlValue(
      manifestPath,
      normalizeRelativePath(baseDir, manifestPath),
    )
    const result = releaseManifestSchema.safeParse(raw)

    if (!result.success) {
      throw new AgentLibraryValidationError(
        result.error.issues.map((issue) => {
          const location = issue.path.length > 0 ? issue.path.join('.') : '<root>'
          return `${normalizeRelativePath(baseDir, manifestPath)} ${location}: ${issue.message}`
        }),
      )
    }

    return {
      releaseId: result.data.release_id,
      libraryId: result.data.library_id,
      libraryVersion: result.data.library_version,
      publishedAt: result.data.published_at,
      publishedBy: result.data.published_by,
      changelogPath: result.data.changelog_path,
      predecessorReleaseId: result.data.predecessor_release_id,
      rollbackToReleaseId: result.data.rollback_to_release_id,
      sourceLibraryFingerprint: result.data.source_library_fingerprint,
      fingerprints: {
        libraryFingerprint: result.data.fingerprints.library_fingerprint,
        skillFingerprints: result.data.fingerprints.skill_fingerprints,
        skillPackFingerprints: result.data.fingerprints.skill_pack_fingerprints,
        promptFamilyFingerprints: result.data.fingerprints.prompt_family_fingerprints,
        promptBundleFingerprints: result.data.fingerprints.prompt_bundle_fingerprints,
        providerOverlayFingerprints:
          result.data.fingerprints.provider_overlay_fingerprints,
        toolingPolicyFingerprint:
          result.data.fingerprints.tooling_policy_fingerprint,
      },
      relativePath: normalizeRelativePath(baseDir, manifestPath),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

function normalizeAgentLibraryLoadOptions(
  input: string | AgentLibraryLoadOptions | undefined,
): { baseDir: string; source: 'working' | 'release'; releaseId: string | undefined } {
  if (typeof input === 'string') {
    return {
      baseDir: input,
      source: 'working',
      releaseId: undefined,
    }
  }

  return {
    baseDir: input?.baseDir ?? resolveAgentConfigFolder(),
    source: input?.source ?? 'working',
    releaseId: input?.releaseId,
  }
}

export async function loadAgentLibraryBundle(
  input: string | AgentLibraryLoadOptions = resolveAgentConfigFolder(),
): Promise<AgentLibraryBundle> {
  const options = normalizeAgentLibraryLoadOptions(input)
  const baseDir = path.resolve(options.baseDir)
  const releaseIndex = await loadAgentReleaseIndex(baseDir)
  const resolvedBaseDir =
    options.source === 'release'
      ? resolveAgentReleaseFolder(options.releaseId ?? '', baseDir)
      : baseDir

  if (options.source === 'release' && !options.releaseId) {
    throw new AgentLibraryValidationError([
      'Agent library release loading requires a releaseId.',
    ])
  }

  const releaseManifest =
    options.source === 'release'
      ? await loadAgentReleaseManifest(resolvedBaseDir, baseDir)
      : null

  if (options.source === 'release' && releaseManifest === null) {
    throw new AgentLibraryValidationError([
      `Missing release manifest for ${options.releaseId ?? '<unknown release>'}.`,
    ])
  }

  const issues: string[] = []
  const roleCharterDir = path.join(resolvedBaseDir, 'role-charters')
  const skillsDir = path.join(resolvedBaseDir, 'skills')
  const skillPackDir = path.join(resolvedBaseDir, 'skill-packs')
  const promptFamilyDir = path.join(resolvedBaseDir, 'prompt-families')
  const manifestDir = path.join(resolvedBaseDir, 'manifests')
  const libraryRaw = await parseYamlValue(path.join(manifestDir, 'library.yaml'), 'library.yaml')
  const libraryResult = libraryManifestSchema.safeParse(libraryRaw)
  const providerOverlayDir = path.join(
    resolvedBaseDir,
    libraryResult.success && libraryResult.data.provider_overlay_dir
      ? libraryResult.data.provider_overlay_dir
      : 'provider-overlays',
  )
  const toolingPolicyPath = path.join(
    resolvedBaseDir,
    libraryResult.success && libraryResult.data.tool_policy_manifest_path
      ? libraryResult.data.tool_policy_manifest_path
      : 'manifests/tooling-policy.yaml',
  )

  const [
    roleCharterEntries,
    skillEntries,
    skillPackEntries,
    promptFamilyDirectories,
    providerOverlayDirectories,
  ] = await Promise.all([
    readdir(roleCharterDir, { withFileTypes: true }),
    readdir(skillsDir, { withFileTypes: true }),
    readdir(skillPackDir, { withFileTypes: true }),
    readdir(promptFamilyDir, { withFileTypes: true }),
    readDirectoryEntriesIfExists(providerOverlayDir),
  ])

  const roleCharterFiles = roleCharterEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
  const skillDirectoryNames = skillEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const skillPackFiles = skillPackEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => entry.name)
    .sort()
  const promptFamilyFiles = (
    await Promise.all(
      promptFamilyDirectories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const familyPath = path.join(promptFamilyDir, entry.name)
          const versions = await readdir(familyPath, { withFileTypes: true })
          return versions
            .filter((version) => version.isFile() && version.name.endsWith('.md'))
            .map((version) => path.join(familyPath, version.name))
        }),
    )
  )
    .flat()
    .sort()
  const providerOverlayFiles = (
    await Promise.all(
      providerOverlayDirectories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const providerPath = path.join(providerOverlayDir, entry.name)
          const versions = await readdir(providerPath, { withFileTypes: true })
          return versions
            .filter((version) => version.isFile() && version.name.endsWith('.md'))
            .map((version) => path.join(providerPath, version.name))
        }),
    )
  )
    .flat()
    .sort()

  const [
    roleSkillPackMapRaw,
    routingSkillPackMapRaw,
    promptFamilyMapRaw,
    toolingPolicyRaw,
    roleCharterRaw,
    skillsRaw,
    skillPackRaw,
    promptFamilyRaw,
    providerOverlayRaw,
  ] = await Promise.all([
    parseYamlValue(
      path.join(manifestDir, 'role-skill-pack-map.yaml'),
      'role-skill-pack-map.yaml',
    ),
    parseYamlValue(
      path.join(manifestDir, 'routing-skill-pack-map.yaml'),
      'routing-skill-pack-map.yaml',
    ),
    parseYamlValue(
      path.join(manifestDir, 'prompt-family-map.yaml'),
      'prompt-family-map.yaml',
    ),
    parseYamlValueIfExists(
      toolingPolicyPath,
      normalizeRelativePath(baseDir, toolingPolicyPath),
    ),
    Promise.all(
      roleCharterFiles.map(async (fileName) => {
        const absolutePath = path.join(roleCharterDir, fileName)
        const parsed = await parseMarkdownWithFrontmatter(
          absolutePath,
          normalizeRelativePath(baseDir, absolutePath),
        )
        return {
          ...parsed,
          relativePath: normalizeRelativePath(baseDir, absolutePath),
        }
      }),
    ),
    Promise.all(
      skillDirectoryNames.map(async (directoryName) => {
        const metaPath = path.join(skillsDir, directoryName, 'meta.json')
        const skillDocPath = path.join(skillsDir, directoryName, 'SKILL.md')

        return {
          metaRaw: await parseJsonValue(
            metaPath,
            normalizeRelativePath(baseDir, metaPath),
          ),
          body: (await readMarkdownBody(skillDocPath)).trim(),
          relativePath: normalizeRelativePath(baseDir, skillDocPath),
        }
      }),
    ),
    Promise.all(
      skillPackFiles.map(async (fileName) => {
        const absolutePath = path.join(skillPackDir, fileName)
        return {
          raw: await parseYamlValue(
            absolutePath,
            normalizeRelativePath(baseDir, absolutePath),
          ),
          relativePath: normalizeRelativePath(baseDir, absolutePath),
        }
      }),
    ),
    Promise.all(
      promptFamilyFiles.map(async (absolutePath) => {
        const parsed = await parseMarkdownWithFrontmatter(
          absolutePath,
          normalizeRelativePath(baseDir, absolutePath),
        )
        return {
          ...parsed,
          relativePath: normalizeRelativePath(baseDir, absolutePath),
        }
      }),
    ),
    Promise.all(
      providerOverlayFiles.map(async (absolutePath) => {
        const parsed = await parseMarkdownWithFrontmatter(
          absolutePath,
          normalizeRelativePath(baseDir, absolutePath),
        )
        return {
          ...parsed,
          relativePath: normalizeRelativePath(baseDir, absolutePath),
        }
      }),
    ),
  ])

  const roleSkillPackMapResult = z
    .array(roleSkillPackMapEntrySchema)
    .nonempty()
    .safeParse(roleSkillPackMapRaw)
  const routingSkillPackMapResult = z
    .array(routingRuleSchema)
    .nonempty()
    .safeParse(routingSkillPackMapRaw)
  const promptFamilyMapResult = promptFamilyMapSchema.safeParse(promptFamilyMapRaw)
  const toolingPolicyResult =
    toolingPolicyRaw === null ? null : toolingPolicySchema.safeParse(toolingPolicyRaw)

  if (!libraryResult.success) {
    normalizeFieldErrors('library.yaml', libraryResult.error.issues, issues)
  }
  if (!roleSkillPackMapResult.success) {
    normalizeFieldErrors(
      'role-skill-pack-map.yaml',
      roleSkillPackMapResult.error.issues,
      issues,
    )
  }
  if (!routingSkillPackMapResult.success) {
    normalizeFieldErrors(
      'routing-skill-pack-map.yaml',
      routingSkillPackMapResult.error.issues,
      issues,
    )
  }
  if (!promptFamilyMapResult.success) {
    normalizeFieldErrors(
      'prompt-family-map.yaml',
      promptFamilyMapResult.error.issues,
      issues,
    )
  }
  if (toolingPolicyResult && !toolingPolicyResult.success) {
    normalizeFieldErrors(
      normalizeRelativePath(baseDir, toolingPolicyPath),
      toolingPolicyResult.error.issues,
      issues,
    )
  }

  const roleCharters = roleCharterRaw
    .map((item) => {
      const result = roleCharterFrontmatterSchema.safeParse(item.frontmatter)

      if (!result.success) {
        normalizeFieldErrors(item.relativePath, result.error.issues, issues)
        return null
      }

      ensureMarkdownSections(
        item.relativePath,
        item.body,
        REQUIRED_ROLE_CHARTER_SECTIONS,
        issues,
      )

      return {
        frontmatter: {
          roleId: result.data.role_id,
          version: result.data.version,
          wave: result.data.wave,
          category: result.data.category,
          visibleInLinear: result.data.visible_in_linear,
          canonicalRunKind: result.data.canonical_run_kind,
          sourceRefs: result.data.source_refs,
        },
        body: item.body,
        relativePath: item.relativePath,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) =>
      left.frontmatter.roleId.localeCompare(right.frontmatter.roleId),
    )

  const skills = skillsRaw
    .map((item) => {
      const result = skillMetaSchema.safeParse(item.metaRaw)

      if (!result.success) {
        normalizeFieldErrors(item.relativePath, result.error.issues, issues)
        return null
      }

      ensureMarkdownSections(
        item.relativePath,
        item.body,
        REQUIRED_SKILL_SECTIONS,
        issues,
      )

      return {
        meta: {
          id: result.data.id,
          version: result.data.version,
          name: result.data.name,
          category: result.data.category,
          availability: result.data.availability,
          kind: result.data.kind,
          runtimeDependency: result.data.runtime_dependency,
          referenceOnlyDefault: result.data.reference_only_default,
          providerCompatibility: result.data.provider_compatibility,
          requiredTools: result.data.required_tools,
          requiredMcp: result.data.required_mcp,
          sensitivityClass: result.data.sensitivity_class,
          whenToUse: result.data.when_to_use,
          inputs: result.data.inputs,
          steps: result.data.steps,
          stopConditions: result.data.stop_conditions,
          escalationRules: result.data.escalation_rules,
          antiPatterns: result.data.anti_patterns,
          deniedActions: result.data.denied_actions,
          humanGate: {
            required: result.data.human_gate.required,
            zones: result.data.human_gate.zones,
            notes: result.data.human_gate.notes,
          },
          description: result.data.description,
          why: result.data.why,
          downloadRef: result.data.download_ref,
          buildSpec: result.data.build_spec,
          sourceRefs: result.data.source_refs,
        },
        body: item.body,
        relativePath: item.relativePath,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => left.meta.id.localeCompare(right.meta.id))

  const skillPacks = skillPackRaw
    .map((item) => {
      const result = skillPackSchema.safeParse(item.raw)

      if (!result.success) {
        normalizeFieldErrors(item.relativePath, result.error.issues, issues)
        return null
      }

      return {
        packId: result.data.pack_id,
        version: result.data.version,
        purpose: result.data.purpose,
        skillRefs: result.data.skill_refs,
        optionalSkillRefs: result.data.optional_skill_refs,
        providers: result.data.providers,
        activationConditions: {
          statuses: result.data.activation_conditions.statuses,
          taskTypes: result.data.activation_conditions.task_types,
          requiresIntegration:
            result.data.activation_conditions.requires_integration,
          notes: result.data.activation_conditions.notes,
        },
        deniedActionsOverlay: result.data.denied_actions_overlay,
        humanGateOverlay: {
          required: result.data.human_gate_overlay.required,
          zones: result.data.human_gate_overlay.zones,
          notes: result.data.human_gate_overlay.notes,
        },
        sourceRefs: result.data.source_refs,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => left.packId.localeCompare(right.packId))

  const promptFamilies = promptFamilyRaw
    .map((item) => {
      const result = promptFamilyFrontmatterSchema.safeParse(item.frontmatter)

      if (!result.success) {
        normalizeFieldErrors(item.relativePath, result.error.issues, issues)
        return null
      }

      ensureMarkdownSections(
        item.relativePath,
        item.body,
        REQUIRED_PROMPT_FAMILY_SECTIONS,
        issues,
      )

      if (
        !item.body.includes('## Prompt Body') &&
        !item.body.includes('## TBD Prompt Body')
      ) {
        issues.push(
          `${item.relativePath} is missing required section ## Prompt Body`,
        )
      }

      return {
        familyId: result.data.family_id,
        version: result.data.version,
        providerCompatibility: result.data.provider_compatibility,
        compatibleRoles: result.data.compatible_roles,
        compatibleSkillPacks: result.data.compatible_skill_packs,
        sourceRefs: result.data.source_refs,
        body: item.body,
        relativePath: item.relativePath,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      const leftKey = `${left.familyId}/${left.version}`
      const rightKey = `${right.familyId}/${right.version}`
      return leftKey.localeCompare(rightKey)
    })

  const providerOverlays = providerOverlayRaw
    .map((item) => {
      const result = providerOverlayFrontmatterSchema.safeParse(item.frontmatter)

      if (!result.success) {
        normalizeFieldErrors(item.relativePath, result.error.issues, issues)
        return null
      }

      ensureMarkdownSections(
        item.relativePath,
        item.body,
        REQUIRED_PROVIDER_OVERLAY_SECTIONS,
        issues,
      )

      return {
        provider: result.data.provider,
        version: result.data.version,
        purpose: result.data.purpose,
        sourceRefs: result.data.source_refs,
        body: item.body,
        relativePath: item.relativePath,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      const leftKey = `${left.provider}/${left.version}`
      const rightKey = `${right.provider}/${right.version}`
      return leftKey.localeCompare(rightKey)
    })

  if (issues.length > 0) {
    throw new AgentLibraryValidationError(issues)
  }

  if (
    !libraryResult.success ||
    !roleSkillPackMapResult.success ||
    !routingSkillPackMapResult.success ||
    !promptFamilyMapResult.success
  ) {
    throw new AgentLibraryValidationError([
      'Agent library parsing did not produce a validated manifest bundle.',
    ])
  }

  const libraryData = libraryResult.data
  const roleSkillPackMapData = roleSkillPackMapResult.data
  const routingSkillPackMapData = routingSkillPackMapResult.data
  const promptFamilyMapData = promptFamilyMapResult.data

  return {
    source: options.source,
    releaseId: options.source === 'release' ? options.releaseId ?? null : null,
    configRootDir: baseDir,
    resolvedBaseDir,
    library: {
      libraryId: libraryData.library_id,
      version: libraryData.version,
      owners: libraryData.owners,
      expectedRoleCount: libraryData.expected_role_count,
      expectedSkillCount: libraryData.expected_skill_count,
      releaseModel: libraryData.release_model,
      expectedProviderOverlayCount: libraryData.expected_provider_overlay_count,
      layeringModel: libraryData.layering_model,
      providerOverlayDir: libraryData.provider_overlay_dir,
      toolPolicyManifestPath: libraryData.tool_policy_manifest_path,
      sourceRefs: libraryData.source_refs,
      alwaysOnGuidanceRefs: libraryData.always_on_guidance_refs,
      compatibilityPolicy: {
        runtimeTaskBundleUnchanged:
          libraryData.compatibility_policy.runtime_task_bundle_unchanged,
        dbPersistenceUnchanged:
          libraryData.compatibility_policy.db_persistence_unchanged,
        providerWiringUnchanged:
          libraryData.compatibility_policy.provider_wiring_unchanged,
        runnerDistributionOutOfScope:
          libraryData.compatibility_policy.runner_distribution_out_of_scope,
      },
      versioningPolicy: {
        frontmatterVersionRequired:
          libraryData.versioning_policy.frontmatter_version_required,
        silentMutationForbidden:
          libraryData.versioning_policy.silent_mutation_forbidden,
        placeholderContentAllowed:
          libraryData.versioning_policy.placeholder_content_allowed,
        releaseIdPattern: libraryData.versioning_policy.release_id_pattern,
        immutablePublishedReleases:
          libraryData.versioning_policy.immutable_published_releases,
        nextReleaseMustBeMonotonic:
          libraryData.versioning_policy.next_release_must_be_monotonic,
      },
      rollbackPolicy: {
        runnerHostRolloutPolicy: libraryData.rollback_policy.runner_host_rollout_policy,
        canonicalSourceOfTruth: libraryData.rollback_policy.canonical_source_of_truth,
        runtimeMirrorNotAuthoritative:
          libraryData.rollback_policy.runtime_mirror_not_authoritative,
        publishedReleaseRequiredForRollout:
          libraryData.rollback_policy.published_release_required_for_rollout,
        firstReleaseMayOmitRollbackTarget:
          libraryData.rollback_policy.first_release_may_omit_rollback_target,
      },
      referenceSkillPolicy: {
        materialized: libraryData.reference_skill_policy.materialized,
        runtimeDependencyDefault:
          libraryData.reference_skill_policy.runtime_dependency_default,
        referenceOnlyDefault:
          libraryData.reference_skill_policy.reference_only_default,
      },
    },
    roleCharters,
    skills,
    skillPacks,
    roleSkillPackMap: roleSkillPackMapData.map((entry) => ({
      roleId: entry.role_id,
      defaultSkillPackRefs: entry.default_skill_pack_refs,
      notes: entry.notes,
    })),
    routingSkillPackMap: routingSkillPackMapData.map((rule) => ({
      ruleId: rule.rule_id,
      statuses: rule.statuses,
      triggers: rule.triggers,
      taskTypes: rule.task_types,
      requiresIntegration: rule.requires_integration,
      addSkillPackRefs: rule.add_skill_pack_refs,
      notes: rule.notes,
    })),
    promptFamilyMap: {
      rolePromptFamilies: promptFamilyMapData.role_prompt_families.map(
        (entry) => ({
          roleId: entry.role_id,
          promptFamilyRef: entry.prompt_family_ref,
        }),
      ),
      packOverlayFamilies: promptFamilyMapData.pack_overlay_families.map(
        (entry) => ({
          packId: entry.pack_id,
          promptFamilyRef: entry.prompt_family_ref,
        }),
      ),
    },
    promptFamilies,
    providerOverlays,
    toolingPolicy:
      toolingPolicyResult && toolingPolicyResult.success
        ? {
            roleToolPolicies: toolingPolicyResult.data.role_tool_policies.map((policy) => ({
              roleId: policy.role_id,
              allowedTools: policy.allowed_tools,
              requiredMcpRefs: policy.required_mcp_refs,
              writeScopes: policy.write_scopes,
              deniedTools: policy.denied_tools,
              humanGatedTools: policy.human_gated_tools,
              notes: policy.notes,
            })),
            providerToolPolicies: toolingPolicyResult.data.provider_tool_policies.map(
              (policy) => ({
                provider: policy.provider,
                overlayRef: policy.overlay_ref,
                allowedTools: policy.allowed_tools,
                deniedTools: policy.denied_tools,
                humanGatedTools: policy.human_gated_tools,
                writeScopes: policy.write_scopes,
                notes: policy.notes,
              }),
            ),
          }
        : null,
    releaseIndex,
    releaseManifest,
  }
}

async function loadAgentSourceManifest(
  manifestPath: string = resolveAgentSourceManifestPath(),
): Promise<z.infer<typeof sourceAgentManifestSchema>> {
  const manifestRaw = await parseJsonValue(
    manifestPath,
    normalizeRelativePath(path.dirname(manifestPath), manifestPath),
  )
  const manifestResult = sourceAgentManifestSchema.safeParse(manifestRaw)

  if (!manifestResult.success) {
    throw new AgentLibraryValidationError(
      manifestResult.error.issues.map((issue) => {
        const location = issue.path.length > 0 ? issue.path.join('.') : '<root>'
        return `source manifest ${location}: ${issue.message}`
      }),
    )
  }

  return manifestResult.data
}

function canonicalAgentLibraryValue(bundle: AgentLibraryBundle): unknown {
  return {
    library: bundle.library,
    roleCharters: bundle.roleCharters.map((role) => ({
      frontmatter: role.frontmatter,
      body: role.body,
    })),
    skills: bundle.skills.map((skill) => ({
      meta: skill.meta,
      body: skill.body,
    })),
    skillPacks: bundle.skillPacks,
    roleSkillPackMap: bundle.roleSkillPackMap,
    routingSkillPackMap: bundle.routingSkillPackMap,
    promptFamilyMap: bundle.promptFamilyMap,
    promptFamilies: bundle.promptFamilies.map((family) => ({
      familyId: family.familyId,
      version: family.version,
      providerCompatibility: family.providerCompatibility,
      compatibleRoles: family.compatibleRoles,
      compatibleSkillPacks: family.compatibleSkillPacks,
      sourceRefs: family.sourceRefs,
      body: family.body,
    })),
    providerOverlays: bundle.providerOverlays.map((overlay) => ({
      provider: overlay.provider,
      version: overlay.version,
      purpose: overlay.purpose,
      sourceRefs: overlay.sourceRefs,
      body: overlay.body,
    })),
    toolingPolicy: bundle.toolingPolicy,
  }
}

export function buildAgentLibraryFingerprints(
  bundle: AgentLibraryBundle,
): AgentLibraryFingerprintSet {
  const skillFingerprints = Object.fromEntries(
    bundle.skills.map((skill) => [
      skill.meta.id,
      hashStableValue({
        meta: skill.meta,
        body: skill.body,
      }),
    ]),
  )

  const skillPackFingerprints = Object.fromEntries(
    bundle.skillPacks.map((pack) => [
      pack.packId,
      hashStableValue({
        pack,
        referencedSkillFingerprints: [...pack.skillRefs, ...pack.optionalSkillRefs]
          .sort((left, right) => left.localeCompare(right))
          .map((skillId) => ({
            skillId,
            fingerprint: skillFingerprints[skillId] ?? null,
          })),
      }),
    ]),
  )

  const promptFamilyFingerprints = Object.fromEntries(
    bundle.promptFamilies.map((family) => [
      `${family.familyId}/${family.version}`,
      hashStableValue({
        familyId: family.familyId,
        version: family.version,
        providerCompatibility: family.providerCompatibility,
        compatibleRoles: family.compatibleRoles,
        compatibleSkillPacks: family.compatibleSkillPacks,
        sourceRefs: family.sourceRefs,
        body: family.body,
      }),
    ]),
  )

  const roleSkillPackMapByRoleId = new Map(
    bundle.roleSkillPackMap.map((entry) => [entry.roleId, entry]),
  )
  const rolePromptFamilyMapByRoleId = new Map(
    bundle.promptFamilyMap.rolePromptFamilies.map((entry) => [
      entry.roleId,
      entry.promptFamilyRef,
    ]),
  )
  const packPromptFamilyMap = new Map(
    bundle.promptFamilyMap.packOverlayFamilies.map((entry) => [
      entry.packId,
      entry.promptFamilyRef,
    ]),
  )
  const globalBaselineRefs = bundle.promptFamilies
    .filter((family) => family.familyId === 'global-baseline')
    .map((family) => `${family.familyId}/${family.version}`)
    .sort((left, right) => left.localeCompare(right))

  const promptBundleFingerprints = Object.fromEntries(
    bundle.roleCharters.map((role) => {
      const selectedPackIds = (
        roleSkillPackMapByRoleId.get(role.frontmatter.roleId)?.defaultSkillPackRefs ?? []
      ).slice().sort((left, right) => left.localeCompare(right))
      const overlayFamilyRefs = selectedPackIds
        .map((packId) => packPromptFamilyMap.get(packId))
        .filter((value): value is string => value !== undefined)
      const roleFamilyRef = rolePromptFamilyMapByRoleId.get(role.frontmatter.roleId)
      const promptFamilyRefs = [
        ...globalBaselineRefs,
        ...overlayFamilyRefs,
        ...(roleFamilyRef ? [roleFamilyRef] : []),
      ].sort((left, right) => left.localeCompare(right))

      return [
        role.frontmatter.roleId,
        hashStableValue({
          roleCharter: {
            frontmatter: role.frontmatter,
            body: role.body,
          },
          promptFamilyFingerprints: promptFamilyRefs.map((promptFamilyRef) => ({
            promptFamilyRef,
            fingerprint: promptFamilyFingerprints[promptFamilyRef] ?? null,
          })),
          skillPackFingerprints: selectedPackIds.map((packId) => ({
            packId,
            fingerprint: skillPackFingerprints[packId] ?? null,
          })),
        }),
      ]
    }),
  )

  const providerOverlayFingerprints = Object.fromEntries(
    bundle.providerOverlays.map((overlay) => [
      `${overlay.provider}/${overlay.version}`,
      hashStableValue({
        provider: overlay.provider,
        version: overlay.version,
        purpose: overlay.purpose,
        sourceRefs: overlay.sourceRefs,
        body: overlay.body,
      }),
    ]),
  )

  return {
    libraryFingerprint: hashStableValue(canonicalAgentLibraryValue(bundle)),
    skillFingerprints,
    skillPackFingerprints,
    promptFamilyFingerprints,
    promptBundleFingerprints,
    providerOverlayFingerprints,
    toolingPolicyFingerprint: hashStableValue(bundle.toolingPolicy),
  }
}

export async function validateAgentLibraryBundle(
  bundle: AgentLibraryBundle,
): Promise<AgentLibraryValidationResult> {
  const issues: string[] = []
  const workflowBundle = await loadWorkflowManifestBundle()
  const sourceManifest = await loadAgentSourceManifest()
  const expectedRoleIds = new Set(
    workflowBundle.operatingModel?.roles.map((role) => role.roleId) ?? [],
  )
  const expectedSkillIds = new Set(sourceManifest.skills.map((skill) => skill.id))
  const taskTypes = new Set(
    workflowBundle.operatingModel?.taxonomy.labelGroups.type ?? [],
  )
  const statusCodes = new Set(workflowBundle.statuses.map((status) => status.code))
  const triggerCodes = new Set(workflowBundle.triggers.map((trigger) => trigger.code))
  const runtimeContractByRoleId = new Map(
    workflowBundle.runtimeRoleContracts.map((contract) => [
      contract.roleId,
      contract,
    ]),
  )
  const operatingRoleById = new Map(
    workflowBundle.operatingModel?.roles.map((role) => [role.roleId, role]) ?? [],
  )
  const promptFamilyRefs = new Set(
    bundle.promptFamilies.map((family) => `${family.familyId}/${family.version}`),
  )
  const packIds = new Set(bundle.skillPacks.map((pack) => pack.packId))
  const skillIds = new Set(bundle.skills.map((skill) => skill.meta.id))
  const roleIds = new Set(bundle.roleCharters.map((role) => role.frontmatter.roleId))

  ensureUnique(
    bundle.roleCharters.map((role) => role.frontmatter.roleId),
    'role charter',
    issues,
  )
  ensureUnique(
    bundle.skills.map((skill) => skill.meta.id),
    'skill id',
    issues,
  )
  ensureUnique(
    bundle.skillPacks.map((pack) => pack.packId),
    'skill pack id',
    issues,
  )
  ensureUnique(
    bundle.routingSkillPackMap.map((rule) => rule.ruleId),
    'routing rule id',
    issues,
  )
  ensureUnique(
    bundle.promptFamilies.map((family) => `${family.familyId}/${family.version}`),
    'prompt family ref',
    issues,
  )

  if (bundle.roleCharters.length !== bundle.library.expectedRoleCount) {
    issues.push(
      `Role charter count ${bundle.roleCharters.length} does not match library expected_role_count ${bundle.library.expectedRoleCount}`,
    )
  }

  if (bundle.skills.length !== bundle.library.expectedSkillCount) {
    issues.push(
      `Skill count ${bundle.skills.length} does not match library expected_skill_count ${bundle.library.expectedSkillCount}`,
    )
  }

  for (const expectedRoleId of expectedRoleIds) {
    if (!roleIds.has(expectedRoleId)) {
      issues.push(`Missing role charter for workflow role ${expectedRoleId}`)
    }
  }

  for (const roleId of roleIds) {
    if (!expectedRoleIds.has(roleId)) {
      issues.push(`Unknown role charter not present in operating_model.yaml: ${roleId}`)
    }
  }

  for (const roleCharter of bundle.roleCharters) {
    const operatingRole = operatingRoleById.get(roleCharter.frontmatter.roleId)
    const runtimeContract = runtimeContractByRoleId.get(roleCharter.frontmatter.roleId)

    if (!operatingRole) {
      continue
    }

    if (roleCharter.frontmatter.wave !== operatingRole.wave) {
      issues.push(
        `${roleCharter.relativePath} wave ${roleCharter.frontmatter.wave} does not match operating model wave ${operatingRole.wave}`,
      )
    }

    if (roleCharter.frontmatter.category !== operatingRole.category) {
      issues.push(
        `${roleCharter.relativePath} category ${roleCharter.frontmatter.category} does not match operating model category ${operatingRole.category}`,
      )
    }

    if (roleCharter.frontmatter.visibleInLinear !== operatingRole.visibleInLinear) {
      issues.push(
        `${roleCharter.relativePath} visible_in_linear does not match operating model truth`,
      )
    }

    if (
      runtimeContract &&
      roleCharter.frontmatter.canonicalRunKind !== runtimeContract.canonicalRunKind
    ) {
      issues.push(
        `${roleCharter.relativePath} canonical_run_kind does not match runtime role contract`,
      )
    }
  }

  for (const expectedSkillId of expectedSkillIds) {
    if (!skillIds.has(expectedSkillId)) {
      issues.push(`Missing skill materialization for source skill ${expectedSkillId}`)
    }
  }

  for (const skill of bundle.skills) {
    if (!expectedSkillIds.has(skill.meta.id)) {
      issues.push(`Unknown skill materialized outside the source manifest: ${skill.meta.id}`)
    }

    if (skill.meta.id.startsWith('R')) {
      if (skill.meta.runtimeDependency) {
        issues.push(`${skill.relativePath} must set runtime_dependency=false for R* skills`)
      }

      if (!skill.meta.referenceOnlyDefault) {
        issues.push(
          `${skill.relativePath} must set reference_only_default=true for R* skills`,
        )
      }
    }

    if (
      skill.meta.sensitivityClass === 'credential_boundary' ||
      skill.meta.sensitivityClass === 'human_gate_required'
    ) {
      if (!skill.meta.humanGate.required || skill.meta.humanGate.zones.length === 0) {
        issues.push(
          `${skill.relativePath} must declare non-empty human_gate metadata for risky skills`,
        )
      }

      if (skill.meta.deniedActions.length === 0) {
        issues.push(
          `${skill.relativePath} must declare denied_actions for risky skills`,
        )
      }
    }
  }

  for (const integrationSkillId of INTEGRATION_SKILL_IDS) {
    const integrationSkill = bundle.skills.find(
      (skill) => skill.meta.id === integrationSkillId,
    )

    if (!integrationSkill) {
      continue
    }

    const deniedActionText = integrationSkill.meta.deniedActions.join(' ').toLowerCase()

    if (!deniedActionText.includes('raw secrets')) {
      issues.push(
        `${integrationSkill.relativePath} must prohibit raw-secret handling for integration skills`,
      )
    }

    if (
      !deniedActionText.includes('metadata plane') ||
      !deniedActionText.includes('credential plane')
    ) {
      issues.push(
        `${integrationSkill.relativePath} must preserve the metadata plane vs credential plane split`,
      )
    }
  }

  const roleIdsInRolePackMap = new Set(
    bundle.roleSkillPackMap.map((entry) => entry.roleId),
  )

  for (const expectedRoleId of expectedRoleIds) {
    if (!roleIdsInRolePackMap.has(expectedRoleId)) {
      issues.push(`Missing role-skill-pack mapping for role ${expectedRoleId}`)
    }
  }

  for (const entry of bundle.roleSkillPackMap) {
    if (!expectedRoleIds.has(entry.roleId)) {
      issues.push(`role-skill-pack map references unknown role ${entry.roleId}`)
    }

    for (const packRef of entry.defaultSkillPackRefs) {
      if (!packIds.has(packRef)) {
        issues.push(
          `role-skill-pack map for ${entry.roleId} references unknown pack ${packRef}`,
        )
      }
    }
  }

  for (const pack of bundle.skillPacks) {
    if (
      INTEGRATION_PACK_IDS.has(pack.packId) &&
      pack.activationConditions.requiresIntegration !== true
    ) {
      issues.push(
        `${pack.packId} must require integration activation in its pack manifest`,
      )
    }

    for (const skillRef of pack.skillRefs) {
      if (!skillIds.has(skillRef)) {
        issues.push(`${pack.packId} references unknown skill ${skillRef}`)
      }
    }

    for (const skillRef of pack.optionalSkillRefs) {
      const optionalSkill = bundle.skills.find((skill) => skill.meta.id === skillRef)

      if (!optionalSkill) {
        issues.push(`${pack.packId} references unknown optional skill ${skillRef}`)
        continue
      }

      if (!optionalSkill.meta.referenceOnlyDefault) {
        issues.push(
          `${pack.packId} optional skill ${skillRef} must remain reference_only_default=true`,
        )
      }
    }

    for (const taskType of pack.activationConditions.taskTypes) {
      if (!taskTypes.has(taskType)) {
        issues.push(`${pack.packId} references unknown activation task_type ${taskType}`)
      }
    }
  }

  for (const rule of bundle.routingSkillPackMap) {
    if (
      rule.addSkillPackRefs.some((packRef) => INTEGRATION_PACK_IDS.has(packRef)) &&
      rule.requiresIntegration !== true
    ) {
      issues.push(
        `${rule.ruleId} must set requires_integration=true when activating integration packs`,
      )
    }

    for (const status of rule.statuses) {
      if (!statusCodes.has(status)) {
        issues.push(`${rule.ruleId} references unknown status ${status}`)
      }
    }

    for (const trigger of rule.triggers) {
      if (!triggerCodes.has(trigger)) {
        issues.push(`${rule.ruleId} references unknown trigger ${trigger}`)
      }
    }

    for (const taskType of rule.taskTypes) {
      if (!taskTypes.has(taskType)) {
        issues.push(`${rule.ruleId} references unknown task_type ${taskType}`)
      }
    }

    for (const packRef of rule.addSkillPackRefs) {
      if (!packIds.has(packRef)) {
        issues.push(`${rule.ruleId} references unknown skill pack ${packRef}`)
      }
    }
  }

  for (const requiredFamily of REQUIRED_PROMPT_FAMILIES) {
    if (![...promptFamilyRefs].some((ref) => ref.startsWith(`${requiredFamily}/`))) {
      issues.push(`Missing required prompt family ${requiredFamily}`)
    }
  }

  const roleIdsInPromptFamilyMap = new Set(
    bundle.promptFamilyMap.rolePromptFamilies.map((entry) => entry.roleId),
  )

  for (const expectedRoleId of expectedRoleIds) {
    if (!roleIdsInPromptFamilyMap.has(expectedRoleId)) {
      issues.push(`Missing prompt family mapping for role ${expectedRoleId}`)
    }
  }

  for (const entry of bundle.promptFamilyMap.rolePromptFamilies) {
    if (!expectedRoleIds.has(entry.roleId)) {
      issues.push(`prompt-family role map references unknown role ${entry.roleId}`)
    }

    if (!promptFamilyRefs.has(entry.promptFamilyRef)) {
      issues.push(
        `prompt-family role map for ${entry.roleId} references unknown family ${entry.promptFamilyRef}`,
      )
    }
  }

  const packIdsInPromptFamilyMap = new Set(
    bundle.promptFamilyMap.packOverlayFamilies.map((entry) => entry.packId),
  )

  for (const packId of packIds) {
    if (!packIdsInPromptFamilyMap.has(packId)) {
      issues.push(`Missing prompt family mapping for pack ${packId}`)
    }
  }

  for (const entry of bundle.promptFamilyMap.packOverlayFamilies) {
    if (!packIds.has(entry.packId)) {
      issues.push(`prompt-family pack map references unknown pack ${entry.packId}`)
    }

    if (!promptFamilyRefs.has(entry.promptFamilyRef)) {
      issues.push(
        `prompt-family pack map for ${entry.packId} references unknown family ${entry.promptFamilyRef}`,
      )
    }
  }

  const currentReleaseNumber = parseReleaseNumber(bundle.library.version) ?? 0
  const providerOverlayRefs = new Set(
    bundle.providerOverlays.map((overlay) => `${overlay.provider}/${overlay.version}`),
  )

  ensureUnique(
    bundle.providerOverlays.map((overlay) => overlay.provider),
    'provider overlay provider',
    issues,
  )

  if (bundle.providerOverlays.length !== bundle.library.expectedProviderOverlayCount) {
    issues.push(
      `Provider overlay count ${bundle.providerOverlays.length} does not match library expected_provider_overlay_count ${bundle.library.expectedProviderOverlayCount}`,
    )
  }

  if (currentReleaseNumber >= 2) {
    for (const provider of AGENT_PROVIDERS) {
      if (!bundle.providerOverlays.some((overlay) => overlay.provider === provider)) {
        issues.push(`Missing provider overlay for provider ${provider}`)
      }
    }

    if (bundle.toolingPolicy === null) {
      issues.push(
        `Library version ${bundle.library.version} must define ${bundle.library.toolPolicyManifestPath ?? 'manifests/tooling-policy.yaml'}`,
      )
    }
  }

  if (bundle.toolingPolicy) {
    ensureUnique(
      bundle.toolingPolicy.roleToolPolicies.map((policy) => policy.roleId),
      'role tooling policy',
      issues,
    )
    ensureUnique(
      bundle.toolingPolicy.providerToolPolicies.map((policy) => policy.provider),
      'provider tooling policy',
      issues,
    )

    const roleIdsInToolPolicy = new Set(
      bundle.toolingPolicy.roleToolPolicies.map((policy) => policy.roleId),
    )
    for (const expectedRoleId of expectedRoleIds) {
      if (!roleIdsInToolPolicy.has(expectedRoleId)) {
        issues.push(`Missing tooling policy for role ${expectedRoleId}`)
      }
    }

    for (const policy of bundle.toolingPolicy.roleToolPolicies) {
      if (!expectedRoleIds.has(policy.roleId)) {
        issues.push(`tooling policy references unknown role ${policy.roleId}`)
      }
    }

    const providerPolicies = new Set(
      bundle.toolingPolicy.providerToolPolicies.map((policy) => policy.provider),
    )
    for (const provider of AGENT_PROVIDERS) {
      if (!providerPolicies.has(provider)) {
        issues.push(`Missing provider tooling policy for provider ${provider}`)
      }
    }

    for (const policy of bundle.toolingPolicy.providerToolPolicies) {
      if (!providerOverlayRefs.has(policy.overlayRef)) {
        issues.push(
          `provider tooling policy for ${policy.provider} references unknown overlay ${policy.overlayRef}`,
        )
      }

      const expectedOverlayPrefix = `${policy.provider}/`
      if (!policy.overlayRef.startsWith(expectedOverlayPrefix)) {
        issues.push(
          `provider tooling policy for ${policy.provider} must reference an overlay for the same provider`,
        )
      }
    }
  }

  let releaseIdPattern: RegExp | null = null

  try {
    releaseIdPattern = new RegExp(bundle.library.versioningPolicy.releaseIdPattern, 'u')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    issues.push(`Invalid release_id_pattern: ${message}`)
  }

  if (releaseIdPattern && !releaseIdPattern.test(bundle.library.version)) {
    issues.push(
      `Library version ${bundle.library.version} does not match release_id_pattern ${bundle.library.versioningPolicy.releaseIdPattern}`,
    )
  }

  if (bundle.releaseIndex) {
    if (bundle.releaseIndex.libraryId !== bundle.library.libraryId) {
      issues.push(
        `Release index library_id ${bundle.releaseIndex.libraryId} does not match bundle library_id ${bundle.library.libraryId}`,
      )
    }

    if (bundle.releaseIndex.releaseIdPattern !== bundle.library.versioningPolicy.releaseIdPattern) {
      issues.push('Release index release_id_pattern does not match library manifest policy')
    }

    ensureUnique(
      bundle.releaseIndex.releases.map((entry) => entry.releaseId),
      'release id',
      issues,
    )

    let previousReleaseNumber = 0
    for (const entry of bundle.releaseIndex.releases) {
      const releaseNumber = parseReleaseNumber(entry.releaseId)
      if (releaseNumber === null) {
        issues.push(`Release index contains invalid release id ${entry.releaseId}`)
        continue
      }

      if (entry.libraryVersion !== entry.releaseId) {
        issues.push(
          `Release index entry ${entry.releaseId} must keep library_version aligned with release_id`,
        )
      }

      if (releaseNumber <= previousReleaseNumber) {
        issues.push('Release index must remain append-only in ascending release order')
      }

      previousReleaseNumber = releaseNumber
    }
  }

  const fingerprints = buildAgentLibraryFingerprints(bundle)
  const latestPublishedRelease = bundle.releaseIndex?.releases.at(-1) ?? null

  if (bundle.source === 'working') {
    if (bundle.releaseIndex && bundle.releaseIndex.releases.length === 0 && bundle.library.version !== 'v1') {
      issues.push('Working tree must start at release id v1 before any releases are published')
    }

    const matchingPublishedRelease = bundle.releaseIndex?.releases.find(
      (entry) => entry.releaseId === bundle.library.version,
    )

    if (matchingPublishedRelease) {
      const publishedBundle = await loadAgentLibraryBundle({
        baseDir: bundle.configRootDir,
        source: 'release',
        releaseId: matchingPublishedRelease.releaseId,
      })
      const publishedFingerprints = buildAgentLibraryFingerprints(publishedBundle)

      if (matchingPublishedRelease.libraryFingerprint !== publishedFingerprints.libraryFingerprint) {
        issues.push(
          `Release index fingerprint for ${matchingPublishedRelease.releaseId} does not match its published snapshot`,
        )
      }

      if (
        bundle.library.versioningPolicy.silentMutationForbidden &&
        publishedFingerprints.libraryFingerprint !== fingerprints.libraryFingerprint
      ) {
        issues.push(
          `Working tree version ${bundle.library.version} diverges from published release ${matchingPublishedRelease.releaseId}; bump to ${buildNextReleaseId(matchingPublishedRelease.releaseId) ?? 'the next release id'} before changing content`,
        )
      }
    } else if (
      latestPublishedRelease &&
      bundle.library.versioningPolicy.nextReleaseMustBeMonotonic
    ) {
      const expectedNextReleaseId = buildNextReleaseId(latestPublishedRelease.releaseId)

      if (expectedNextReleaseId === null || bundle.library.version !== expectedNextReleaseId) {
        issues.push(
          `Working tree version ${bundle.library.version} must equal the next monotonic release id ${expectedNextReleaseId ?? '<invalid>'}`,
        )
      }
    }
  }

  if (bundle.source === 'release') {
    const releaseManifest = bundle.releaseManifest
    if (!releaseManifest) {
      issues.push(`Published release ${bundle.releaseId ?? '<unknown>'} is missing release.yaml`)
    } else {
      if (releaseManifest.releaseId !== bundle.releaseId) {
        issues.push(
          `Release manifest release_id ${releaseManifest.releaseId} does not match requested release ${bundle.releaseId}`,
        )
      }

      if (releaseManifest.libraryId !== bundle.library.libraryId) {
        issues.push(
          `Release manifest library_id ${releaseManifest.libraryId} does not match bundle library_id ${bundle.library.libraryId}`,
        )
      }

      if (releaseManifest.libraryVersion !== bundle.library.version) {
        issues.push(
          `Release manifest library_version ${releaseManifest.libraryVersion} does not match bundle library version ${bundle.library.version}`,
        )
      }

      if (releaseManifest.libraryVersion !== releaseManifest.releaseId) {
        issues.push(
          `Release manifest library_version ${releaseManifest.libraryVersion} must match release_id ${releaseManifest.releaseId}`,
        )
      }

      if (releaseManifest.sourceLibraryFingerprint !== fingerprints.libraryFingerprint) {
        issues.push(
          `Release manifest source_library_fingerprint does not match the published snapshot fingerprint for ${releaseManifest.releaseId}`,
        )
      }

      if (
        hashStableValue(releaseManifest.fingerprints) !==
        hashStableValue(fingerprints)
      ) {
        issues.push(
          `Release manifest fingerprint map does not match computed fingerprints for ${releaseManifest.releaseId}`,
        )
      }

      const snapshotDir = bundle.resolvedBaseDir
      const changelogPath = path.resolve(snapshotDir, releaseManifest.changelogPath)
      if (!isPathInside(snapshotDir, changelogPath)) {
        issues.push(
          `Release manifest changelog_path must stay inside the snapshot: ${releaseManifest.changelogPath}`,
        )
      } else {
        try {
          const changelog = await readFile(changelogPath, 'utf8')
          if (changelog.trim().length === 0) {
            issues.push(`Release changelog is empty for ${releaseManifest.releaseId}`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          issues.push(`Release changelog could not be read for ${releaseManifest.releaseId}: ${message}`)
        }
      }

      const currentIndexEntry = bundle.releaseIndex?.releases.find(
        (entry) => entry.releaseId === releaseManifest.releaseId,
      )

      if (!currentIndexEntry) {
        issues.push(`Release index is missing entry for published release ${releaseManifest.releaseId}`)
      } else {
        const expectedManifestPath = `${releaseManifest.releaseId}/release.yaml`
        if (currentIndexEntry.releaseManifestPath !== expectedManifestPath) {
          issues.push(
            `Release index manifest path for ${releaseManifest.releaseId} must be ${expectedManifestPath}`,
          )
        }

        if (currentIndexEntry.libraryVersion !== releaseManifest.libraryVersion) {
          issues.push(
            `Release index library_version for ${releaseManifest.releaseId} does not match release manifest`,
          )
        }

        if (currentIndexEntry.libraryFingerprint !== fingerprints.libraryFingerprint) {
          issues.push(
            `Release index fingerprint for ${releaseManifest.releaseId} does not match computed library fingerprint`,
          )
        }
      }

      if (releaseManifest.predecessorReleaseId !== null) {
        const predecessorRelease = bundle.releaseIndex?.releases.find(
          (entry) => entry.releaseId === releaseManifest.predecessorReleaseId,
        )
        if (!predecessorRelease) {
          issues.push(
            `Release ${releaseManifest.releaseId} references unknown predecessor ${releaseManifest.predecessorReleaseId}`,
          )
        } else if (
          (parseReleaseNumber(predecessorRelease.releaseId) ?? Number.POSITIVE_INFINITY) >=
          (parseReleaseNumber(releaseManifest.releaseId) ?? Number.NEGATIVE_INFINITY)
        ) {
          issues.push(
            `Release predecessor ${predecessorRelease.releaseId} must be older than ${releaseManifest.releaseId}`,
          )
        }
      }

      if (releaseManifest.rollbackToReleaseId !== null) {
        const rollbackRelease = bundle.releaseIndex?.releases.find(
          (entry) => entry.releaseId === releaseManifest.rollbackToReleaseId,
        )
        if (!rollbackRelease) {
          issues.push(
            `Release ${releaseManifest.releaseId} references unknown rollback target ${releaseManifest.rollbackToReleaseId}`,
          )
        } else if (
          (parseReleaseNumber(rollbackRelease.releaseId) ?? Number.POSITIVE_INFINITY) >=
          (parseReleaseNumber(releaseManifest.releaseId) ?? Number.NEGATIVE_INFINITY)
        ) {
          issues.push(
            `Release rollback target ${rollbackRelease.releaseId} must be older than ${releaseManifest.releaseId}`,
          )
        }
      } else if (
        (parseReleaseNumber(releaseManifest.releaseId) ?? 0) > 1 &&
        !bundle.library.rollbackPolicy.firstReleaseMayOmitRollbackTarget
      ) {
        issues.push(
          `Release ${releaseManifest.releaseId} must declare rollback_to_release_id`,
        )
      }
    }
  }

  if (issues.length > 0) {
    throw new AgentLibraryValidationError(issues)
  }

  return {
    bundle,
    summary: {
      roleCount: bundle.roleCharters.length,
      skillCount: bundle.skills.length,
      packCount: bundle.skillPacks.length,
      promptFamilyCount: bundle.promptFamilies.length,
      providerOverlayCount: bundle.providerOverlays.length,
      rolePackMapCount: bundle.roleSkillPackMap.length,
      routingRuleCount: bundle.routingSkillPackMap.length,
      roleToolPolicyCount: bundle.toolingPolicy?.roleToolPolicies.length ?? 0,
      providerToolPolicyCount: bundle.toolingPolicy?.providerToolPolicies.length ?? 0,
      referenceOnlySkillCount: bundle.skills.filter(
        (skill) => skill.meta.referenceOnlyDefault,
      ).length,
      integrationSensitiveSkillCount: bundle.skills.filter(
        (skill) => skill.meta.sensitivityClass === 'credential_boundary',
      ).length,
      riskySkillCount: bundle.skills.filter((skill) => skill.meta.humanGate.required)
        .length,
    },
    fingerprints,
  }
}

export function agentLibraryFingerprint(bundle: AgentLibraryBundle): string {
  return buildAgentLibraryFingerprints(bundle).libraryFingerprint
}
