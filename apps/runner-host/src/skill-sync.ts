import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import type {
  RunnerInstalledSkillBundleV1,
  RunnerManagedSkillPayloadV1,
  RunnerManagedSkillSummaryV1,
  RunnerSkillSyncStatus,
} from '@ai-dev-team/shared'

import type { RunnerHostAppConfig } from './config.js'
import type { RunnerControlApiClient } from './control-api-client.js'

interface StoredSkillBundleManifest extends RunnerInstalledSkillBundleV1 {
  schemaVersion: 1
  installedAt: string
}

export interface ResolvedSkillBundle {
  releaseId: string
  fingerprint: string
  skillIds: string[]
  bundleRoot: string
  skillsRoot: string
}

export interface SkillSyncManifestState {
  skillsAvailable: string[]
  activeAgentLibraryReleaseId: string | null
  activeAgentLibraryFingerprint: string | null
  skillSyncStatus: RunnerSkillSyncStatus
  skillSyncError: string | null
  installedSkillBundles: RunnerInstalledSkillBundleV1[]
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function hasProviderCompatibility(
  providers: string[],
  hostProviders: string[],
): boolean {
  return providers.some((provider) => hostProviders.includes(provider))
}

function stateEquals(
  left: SkillSyncManifestState,
  right: SkillSyncManifestState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readBundleManifest(
  bundleRoot: string,
): Promise<StoredSkillBundleManifest | null> {
  try {
    const raw = await readFile(path.join(bundleRoot, 'bundle.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredSkillBundleManifest>

    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.releaseId !== 'string' ||
      typeof parsed.fingerprint !== 'string' ||
      !Array.isArray(parsed.skillIds)
    ) {
      return null
    }

    return {
      schemaVersion: 1,
      releaseId: parsed.releaseId,
      fingerprint: parsed.fingerprint,
      skillIds: uniqueSorted(
        parsed.skillIds.filter((value): value is string => typeof value === 'string'),
      ),
      installedAt:
        typeof parsed.installedAt === 'string'
          ? parsed.installedAt
          : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

async function ensureFileDigest(
  filePath: string,
  expectedSha256: string,
): Promise<void> {
  const actual = hashSha256(await readFile(filePath, 'utf8'))

  if (actual !== expectedSha256) {
    throw new Error(
      `Skill cache integrity mismatch for ${filePath}: expected ${expectedSha256}, received ${actual}`,
    )
  }
}

export class SkillSyncManager {
  private readonly releasesRoot: string
  private readonly stagingRoot: string
  private state: SkillSyncManifestState

  constructor(
    private readonly config: RunnerHostAppConfig,
    private readonly client: RunnerControlApiClient,
  ) {
    this.releasesRoot = path.join(config.skillCacheRoot, 'releases')
    this.stagingRoot = path.join(config.skillCacheRoot, 'staging')
    this.state = this.buildInitialState()
  }

  getManifestState(): SkillSyncManifestState {
    return {
      skillsAvailable: [...this.state.skillsAvailable],
      activeAgentLibraryReleaseId: this.state.activeAgentLibraryReleaseId,
      activeAgentLibraryFingerprint: this.state.activeAgentLibraryFingerprint,
      skillSyncStatus: this.state.skillSyncStatus,
      skillSyncError: this.state.skillSyncError,
      installedSkillBundles: this.state.installedSkillBundles.map((bundle) => ({
        ...bundle,
        skillIds: [...bundle.skillIds],
      })),
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.releasesRoot, { recursive: true })
    await mkdir(this.stagingRoot, { recursive: true })
    await this.cleanupOrphanedStagingDirs()

    if (this.config.runtimeMode === 'fake') {
      await this.ensureFakeInstalledBundles()
      this.state = this.buildInitialState()
      return
    }

    await this.refreshActiveRelease()
  }

  async refreshActiveRelease(): Promise<boolean> {
    if (this.config.runtimeMode === 'fake') {
      await this.ensureFakeInstalledBundles()
      const nextState = this.buildInitialState()
      const changed = !stateEquals(this.state, nextState)
      this.state = nextState
      return changed
    }

    await mkdir(this.releasesRoot, { recursive: true })
    await mkdir(this.stagingRoot, { recursive: true })
    await this.cleanupOrphanedStagingDirs()

    const currentState = this.getManifestState()

    try {
      const summary = await this.client.fetchActiveSkillReleaseSummary()
      const nextState = await this.resolveStateFromSummary(summary)
      const changed = !stateEquals(currentState, nextState)
      this.state = nextState
      return changed
    } catch (error) {
      const installedSkillBundles = await this.listInstalledSkillBundles()
      const nextState = this.buildDegradedState(
        error instanceof Error ? error.message : 'skill sync failed',
        installedSkillBundles,
      )
      const changed = !stateEquals(currentState, nextState)
      this.state = nextState
      return changed
    }
  }

  async resolveExecutionBundle(
    releaseId: string | null,
  ): Promise<ResolvedSkillBundle | null> {
    if (!releaseId) {
      return null
    }

    const bundleRoot = path.join(this.releasesRoot, releaseId)
    const bundleManifest = await readBundleManifest(bundleRoot)

    if (!bundleManifest) {
      return null
    }

    return {
      releaseId: bundleManifest.releaseId,
      fingerprint: bundleManifest.fingerprint,
      skillIds: [...bundleManifest.skillIds],
      bundleRoot,
      skillsRoot: path.join(bundleRoot, 'skills'),
    }
  }

  private buildInitialState(): SkillSyncManifestState {
    if (this.config.runtimeMode !== 'fake') {
      return {
        skillsAvailable: [],
        activeAgentLibraryReleaseId: null,
        activeAgentLibraryFingerprint: null,
        skillSyncStatus: 'degraded',
        skillSyncError: null,
        installedSkillBundles: [],
      }
    }

    const activeAgentLibraryReleaseId =
      this.config.fakeAgentLibraryReleaseId ??
      (this.config.skillsAvailable.length > 0 ? 'v1' : null)
    const activeAgentLibraryFingerprint =
      activeAgentLibraryReleaseId === null
        ? null
        : this.config.fakeAgentLibraryFingerprint ?? 'fake-release-fingerprint'
    const installedSkillBundles =
      activeAgentLibraryReleaseId && activeAgentLibraryFingerprint
        ? [
            {
              releaseId: activeAgentLibraryReleaseId,
              fingerprint: activeAgentLibraryFingerprint,
              skillIds: [...this.config.skillsAvailable],
            },
          ]
        : []

    return {
      skillsAvailable: [...this.config.skillsAvailable],
      activeAgentLibraryReleaseId,
      activeAgentLibraryFingerprint,
      skillSyncStatus: 'ready',
      skillSyncError: null,
      installedSkillBundles,
    }
  }

  private buildDegradedState(
    errorMessage: string,
    installedSkillBundles: RunnerInstalledSkillBundleV1[],
  ): SkillSyncManifestState {
    return {
      skillsAvailable: [],
      activeAgentLibraryReleaseId: null,
      activeAgentLibraryFingerprint: null,
      skillSyncStatus: 'degraded',
      skillSyncError: errorMessage,
      installedSkillBundles,
    }
  }

  private async resolveStateFromSummary(
    summary: RunnerManagedSkillSummaryV1,
  ): Promise<SkillSyncManifestState> {
    const installedSkillBundles = await this.listInstalledSkillBundles()

    if (!summary.releaseId || !summary.releaseFingerprint) {
      return this.buildDegradedState(
        'No active agent-library release is available for managed skill sync.',
        installedSkillBundles,
      )
    }

    const providerCompatibleSkills = summary.skills.filter((skill) =>
      hasProviderCompatibility(skill.providerCompatibility, this.config.providers),
    )

    if (summary.skills.length > 0 && providerCompatibleSkills.length === 0) {
      return this.buildDegradedState(
        `Active release ${summary.releaseId} has no runtime skills compatible with providers ${this.config.providers.join(', ') || 'none'}.`,
        installedSkillBundles,
      )
    }

    let activeBundle = installedSkillBundles.find(
      (bundle) =>
        bundle.releaseId === summary.releaseId &&
        bundle.fingerprint === summary.releaseFingerprint,
    )

    if (!activeBundle) {
      await this.installRelease(summary)
      const refreshedBundles = await this.listInstalledSkillBundles()
      activeBundle = refreshedBundles.find(
        (bundle) =>
          bundle.releaseId === summary.releaseId &&
          bundle.fingerprint === summary.releaseFingerprint,
      )

      if (!activeBundle) {
        return this.buildDegradedState(
          `Managed skill release ${summary.releaseId} was fetched but is not available in the local cache.`,
          refreshedBundles,
        )
      }

      return {
        skillsAvailable: [...activeBundle.skillIds],
        activeAgentLibraryReleaseId: activeBundle.releaseId,
        activeAgentLibraryFingerprint: activeBundle.fingerprint,
        skillSyncStatus: 'ready',
        skillSyncError: null,
        installedSkillBundles: refreshedBundles,
      }
    }

    const summarySkillIds = uniqueSorted(summary.skills.map((skill) => skill.skillId))

    if (!sameStringArray(activeBundle.skillIds, summarySkillIds)) {
      return this.buildDegradedState(
        `Installed managed skill bundle ${summary.releaseId} does not match the active release summary.`,
        installedSkillBundles,
      )
    }

    return {
      skillsAvailable: [...activeBundle.skillIds],
      activeAgentLibraryReleaseId: activeBundle.releaseId,
      activeAgentLibraryFingerprint: activeBundle.fingerprint,
      skillSyncStatus: 'ready',
      skillSyncError: null,
      installedSkillBundles,
    }
  }

  private async listInstalledSkillBundles(): Promise<RunnerInstalledSkillBundleV1[]> {
    try {
      const releaseEntries = await readdir(this.releasesRoot, {
        withFileTypes: true,
      })
      const manifests = await Promise.all(
        releaseEntries
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            readBundleManifest(path.join(this.releasesRoot, entry.name)),
          ),
      )

      return manifests
        .filter((manifest): manifest is StoredSkillBundleManifest => manifest !== null)
        .map((manifest) => ({
          releaseId: manifest.releaseId,
          fingerprint: manifest.fingerprint,
          skillIds: [...manifest.skillIds],
        }))
        .sort((left, right) => left.releaseId.localeCompare(right.releaseId))
    } catch {
      return []
    }
  }

  private async cleanupOrphanedStagingDirs(): Promise<void> {
    try {
      const entries = await readdir(this.stagingRoot, { withFileTypes: true })

      await Promise.all(
        entries.map((entry) =>
          rm(path.join(this.stagingRoot, entry.name), {
            recursive: true,
            force: true,
          }),
        ),
      )
    } catch {
      // Best-effort staging cleanup should not block lease processing.
    }
  }

  private async ensureFakeInstalledBundles(): Promise<void> {
    const activeAgentLibraryReleaseId =
      this.config.fakeAgentLibraryReleaseId ??
      (this.config.skillsAvailable.length > 0 ? 'v1' : null)
    const activeAgentLibraryFingerprint =
      activeAgentLibraryReleaseId === null
        ? null
        : this.config.fakeAgentLibraryFingerprint ?? 'fake-release-fingerprint'

    if (!activeAgentLibraryReleaseId || !activeAgentLibraryFingerprint) {
      return
    }

    const bundleRoot = path.join(this.releasesRoot, activeAgentLibraryReleaseId)
    const expectedSkillIds = uniqueSorted(this.config.skillsAvailable)
    const existingBundle = await readBundleManifest(bundleRoot)

    if (
      existingBundle &&
      existingBundle.fingerprint === activeAgentLibraryFingerprint &&
      sameStringArray(existingBundle.skillIds, expectedSkillIds)
    ) {
      return
    }

    await rm(bundleRoot, { recursive: true, force: true })
    await mkdir(path.join(bundleRoot, 'skills'), { recursive: true })

    for (const skillId of expectedSkillIds) {
      const skillRoot = path.join(bundleRoot, 'skills', skillId)
      await mkdir(skillRoot, { recursive: true })
      await writeFile(
        path.join(skillRoot, 'meta.json'),
        `${JSON.stringify(
          {
            skillId,
            fingerprint: `fake-skill-${skillId}`,
            providerCompatibility: [...this.config.providers],
            runtimeDependency: true,
            source: 'runner-host-fake',
          },
          null,
          2,
        )}\n`,
      )
      await writeFile(
        path.join(skillRoot, 'SKILL.md'),
        `# ${skillId}\n\nFake managed skill bundle placeholder for runner-host tests.\n`,
      )
    }

    const bundleManifest: StoredSkillBundleManifest = {
      schemaVersion: 1,
      releaseId: activeAgentLibraryReleaseId,
      fingerprint: activeAgentLibraryFingerprint,
      skillIds: expectedSkillIds,
      installedAt: new Date().toISOString(),
    }

    await writeFile(
      path.join(bundleRoot, 'bundle.json'),
      `${JSON.stringify(bundleManifest, null, 2)}\n`,
    )
  }

  private async installRelease(
    summary: RunnerManagedSkillSummaryV1,
  ): Promise<void> {
    if (!summary.releaseId || !summary.releaseFingerprint) {
      throw new Error('Managed skill install requires an active release id and fingerprint.')
    }

    const payload = await this.client.fetchSkillReleasePayload(summary.releaseId)
    await this.validatePayload(summary, payload)

    const existingBundleRoot = path.join(this.releasesRoot, payload.releaseId)
    const existingBundle = await readBundleManifest(existingBundleRoot)

    if (existingBundle) {
      if (existingBundle.fingerprint !== payload.releaseFingerprint) {
        throw new Error(
          `Managed skill release ${payload.releaseId} already exists with fingerprint ${existingBundle.fingerprint}, expected ${payload.releaseFingerprint}.`,
        )
      }

      return
    }

    const stagingParent = await mkdtemp(path.join(this.stagingRoot, `${payload.releaseId}-`))
    const stagingRoot = path.join(stagingParent, payload.releaseId)
    const bundleManifest: StoredSkillBundleManifest = {
      schemaVersion: 1,
      releaseId: payload.releaseId,
      fingerprint: payload.releaseFingerprint,
      skillIds: uniqueSorted(payload.skills.map((skill) => skill.skillId)),
      installedAt: new Date().toISOString(),
    }

    try {
      await mkdir(path.join(stagingRoot, 'skills'), { recursive: true })

      for (const skill of payload.skills) {
        const skillRoot = path.join(stagingRoot, 'skills', skill.skillId)
        const metaPath = path.join(skillRoot, 'meta.json')
        const markdownPath = path.join(skillRoot, 'SKILL.md')

        await mkdir(skillRoot, { recursive: true })
        await writeFile(metaPath, skill.metaJson)
        await writeFile(markdownPath, skill.skillMarkdown)
        await ensureFileDigest(metaPath, skill.metaSha256)
        await ensureFileDigest(markdownPath, skill.skillMarkdownSha256)
      }

      await writeFile(
        path.join(stagingRoot, 'bundle.json'),
        `${JSON.stringify(bundleManifest, null, 2)}\n`,
      )

      await rename(stagingRoot, existingBundleRoot)
    } catch (error) {
      await rm(stagingParent, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    await rm(stagingParent, { recursive: true, force: true }).catch(() => undefined)
  }

  private async validatePayload(
    summary: RunnerManagedSkillSummaryV1,
    payload: RunnerManagedSkillPayloadV1,
  ): Promise<void> {
    if (summary.releaseId === null || summary.releaseFingerprint === null) {
      throw new Error('Managed skill payload validation requires an active summary.')
    }

    if (
      payload.releaseId !== summary.releaseId ||
      payload.releaseFingerprint !== summary.releaseFingerprint
    ) {
      throw new Error(
        `Managed skill payload mismatch: expected ${summary.releaseId}/${summary.releaseFingerprint}, received ${payload.releaseId}/${payload.releaseFingerprint}.`,
      )
    }

    const summaryBySkillId = new Map(
      summary.skills.map((skill) => [skill.skillId, skill]),
    )
    const payloadSkillIds = uniqueSorted(payload.skills.map((skill) => skill.skillId))
    const summarySkillIds = uniqueSorted(summary.skills.map((skill) => skill.skillId))

    if (!sameStringArray(payloadSkillIds, summarySkillIds)) {
      throw new Error(
        `Managed skill payload ${payload.releaseId} does not match the active summary skill set.`,
      )
    }

    for (const skill of payload.skills) {
      const summarySkill = summaryBySkillId.get(skill.skillId)

      if (!summarySkill || summarySkill.fingerprint !== skill.fingerprint) {
        throw new Error(
          `Managed skill payload fingerprint mismatch for ${skill.skillId}.`,
        )
      }

      if (hashSha256(skill.metaJson) !== skill.metaSha256) {
        throw new Error(`Managed skill meta digest mismatch for ${skill.skillId}.`)
      }

      if (hashSha256(skill.skillMarkdown) !== skill.skillMarkdownSha256) {
        throw new Error(`Managed skill markdown digest mismatch for ${skill.skillId}.`)
      }
    }
  }
}
