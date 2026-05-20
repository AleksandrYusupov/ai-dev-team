/**
 * Orchestrates issue context enrichment: fetches Linear content, resolves repos,
 * assembles a ContextPack, stores it, and registers artifacts.
 *
 * Designed to run as a Temporal activity after issue bootstrap.
 * Forward-compatible with Wave 2 context_agent.
 */

import type { Kysely } from 'kysely'

import { cacheContextPack, type Database } from '@ai-dev-team/db'

import {
  fetchLinearIssueContent,
  extractIssueContentFromWebhookPayload,
  type LinearIssueContent,
} from './linear-issue-fetcher.js'
import { resolveRepoContext } from './repo-resolver.js'
import { assembleContextPack } from './context-pack-assembler.js'

export interface EnrichIssueContextInput {
  issueId: string
  projectId: string | null
  workflowId: string
  linearApiBaseUrl: string
  linearApiToken: string | null
  fallbackRepoSlug: string | null
  guidanceFileNames?: string[]
}

export interface EnrichIssueContextResult {
  contextPackFingerprint: string | null
  primaryRepo: string | null
  affectedRepos: string[]
  warnings: string[]
  source: 'linear_api' | 'webhook_fallback' | 'minimal'
}

async function fetchIssueContent(
  input: EnrichIssueContextInput,
  db: Kysely<Database>,
): Promise<{ content: LinearIssueContent; source: EnrichIssueContextResult['source']; warnings: string[] }> {
  const warnings: string[] = []

  if (input.linearApiToken) {
    try {
      const content = await fetchLinearIssueContent({
        apiBaseUrl: input.linearApiBaseUrl,
        apiToken: input.linearApiToken,
        issueId: input.issueId,
      })
      return { content, source: 'linear_api', warnings }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Linear API fetch failed, falling back to webhook payload: ${message}`)
    }
  } else {
    warnings.push('LINEAR_API_TOKEN not configured, falling back to webhook payload')
  }

  const rawEvent = await db
    .selectFrom('raw_event_inbox')
    .select(['parsed_payload'])
    .where('provider', '=', 'linear')
    .where('issue_id', '=', input.issueId)
    .orderBy('received_at', 'desc')
    .executeTakeFirst()

  if (rawEvent?.parsed_payload) {
    const payload = rawEvent.parsed_payload as Record<string, unknown>
    const content = extractIssueContentFromWebhookPayload(payload)

    if (content) {
      return { content, source: 'webhook_fallback', warnings }
    }

    warnings.push('Could not extract issue content from webhook payload')
  } else {
    warnings.push('No raw event found in raw_event_inbox for this issue')
  }

  const minimalContent: LinearIssueContent = {
    issueId: input.issueId,
    identifier: null,
    title: '(no description provided)',
    description: null,
    priority: null,
    priorityLabel: null,
    stateName: null,
    stateType: null,
    labels: [],
    assigneeName: null,
    assigneeEmail: null,
    projectId: input.projectId,
    projectName: null,
    comments: [],
  }

  warnings.push('Using minimal issue content — no source data available')
  return { content: minimalContent, source: 'minimal', warnings }
}

export async function enrichIssueContext(
  db: Kysely<Database>,
  input: EnrichIssueContextInput,
): Promise<EnrichIssueContextResult> {
  const allWarnings: string[] = []

  const { content: issueContent, source, warnings: fetchWarnings } = await fetchIssueContent(input, db)
  allWarnings.push(...fetchWarnings)

  const repoResolution = await resolveRepoContext(db, {
    projectId: input.projectId ?? issueContent.projectId,
    fallbackRepoSlug: input.fallbackRepoSlug,
    guidanceFileNames: input.guidanceFileNames,
  })
  allWarnings.push(...repoResolution.warnings)

  const { bundle, inputFingerprint, estimatedTokens, sourceTrace } = assembleContextPack({
    issueContent,
    repoResolution,
    warnings: allWarnings,
  })

  await cacheContextPack(db, {
    issueId: input.issueId,
    inputFingerprint,
    bundleJson: bundle,
    estimatedTokens,
    sourceTraceJson: sourceTrace,
  })

  const contextPackRow = await db
    .selectFrom('context_pack_cache')
    .select(['input_fingerprint'])
    .where('issue_id', '=', input.issueId)
    .where('input_fingerprint', '=', inputFingerprint)
    .where('superseded_at', 'is', null)
    .executeTakeFirst()

  await registerEnrichmentArtifacts(db, {
    issueId: input.issueId,
    issueContent,
    primaryRepo: repoResolution.primaryRepo,
    affectedRepos: repoResolution.affectedRepos,
    source,
  })

  return {
    contextPackFingerprint: contextPackRow ? inputFingerprint : null,
    primaryRepo: repoResolution.primaryRepo,
    affectedRepos: repoResolution.affectedRepos,
    warnings: allWarnings,
    source,
  }
}

async function registerEnrichmentArtifacts(
  db: Kysely<Database>,
  input: {
    issueId: string
    issueContent: LinearIssueContent
    primaryRepo: string | null
    affectedRepos: string[]
    source: string
  },
): Promise<void> {
  const now = new Date()

  const existingIssueContent = await db
    .selectFrom('artifact_registry')
    .select(['id'])
    .where('issue_id', '=', input.issueId)
    .where('artifact_type', '=', 'issue_content')
    .where('superseded_at', 'is', null)
    .executeTakeFirst()

  if (existingIssueContent) {
    await db
      .updateTable('artifact_registry')
      .set({ superseded_at: now })
      .where('id', '=', existingIssueContent.id)
      .execute()
  }

  await db
    .insertInto('artifact_registry')
    .values({
      issue_id: input.issueId,
      run_id: null,
      transition_audit_id: null,
      artifact_type: 'issue_content',
      artifact_scope: 'issue',
      artifact_uri: `linear-issue://${input.issueId}`,
      artifact_summary: input.issueContent.title.slice(0, 200),
      produced_by_role: 'system_enrichment',
      produced_for_status_code: 'triage',
      metadata: {
        source: input.source,
        identifier: input.issueContent.identifier,
        priority: input.issueContent.priority,
        priorityLabel: input.issueContent.priorityLabel,
        labels: input.issueContent.labels,
        hasDescription: input.issueContent.description !== null,
        commentCount: input.issueContent.comments.length,
      },
    })
    .execute()

  const existingRepoMapping = await db
    .selectFrom('artifact_registry')
    .select(['id'])
    .where('issue_id', '=', input.issueId)
    .where('artifact_type', '=', 'initial_repo_mapping')
    .where('superseded_at', 'is', null)
    .executeTakeFirst()

  if (existingRepoMapping) {
    await db
      .updateTable('artifact_registry')
      .set({ superseded_at: now })
      .where('id', '=', existingRepoMapping.id)
      .execute()
  }

  await db
    .insertInto('artifact_registry')
    .values({
      issue_id: input.issueId,
      run_id: null,
      transition_audit_id: null,
      artifact_type: 'initial_repo_mapping',
      artifact_scope: 'issue',
      artifact_uri: `system://enrichment/${input.issueId}/repo-mapping`,
      artifact_summary: input.primaryRepo
        ? `Primary: ${input.primaryRepo}, affected: [${input.affectedRepos.join(', ')}]`
        : 'No primary repo resolved',
      produced_by_role: 'system_enrichment',
      produced_for_status_code: 'triage',
      metadata: {
        primaryRepo: input.primaryRepo,
        affectedRepos: input.affectedRepos,
      },
    })
    .execute()
}
