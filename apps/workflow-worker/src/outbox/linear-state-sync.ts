import {
  markIssueLinearSyncProjectionSyncState,
  unwrapOutboxCommandEnvelope,
  type DbClient,
  type OutboxCommandRecord,
} from '@ai-dev-team/db'
import type {
  LinearProjectUpdateHealth,
  LinearSyncMilestoneEventCode,
} from '@ai-dev-team/shared'

import type { WorkflowWorkerConfig } from '@ai-dev-team/config'

export type LinearStateSyncHandler = (command: OutboxCommandRecord) => Promise<void>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function buildAuthorizationHeader(apiToken: string): string {
  if (apiToken.startsWith('lin_api_')) {
    return apiToken
  }

  return apiToken.startsWith('Bearer ') ? apiToken : `Bearer ${apiToken}`
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function postGraphql<TData>(input: {
  apiBaseUrl: string
  apiToken: string
  query: string
  variables: Record<string, unknown>
}): Promise<TData> {
  const response = await fetch(input.apiBaseUrl, {
    method: 'POST',
    headers: {
      Authorization: buildAuthorizationHeader(input.apiToken),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: input.query,
      variables: input.variables,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Linear GraphQL call failed: ${response.status} ${response.statusText} ${await response.text()}`,
    )
  }

  const body = (await response.json()) as {
    data?: TData
    errors?: Array<{ message?: string }>
  }

  if (body.errors && body.errors.length > 0) {
    throw new Error(`Linear GraphQL returned errors: ${stringifyJson(body.errors)}`)
  }

  if (!body.data) {
    throw new Error('Linear GraphQL response did not include data')
  }

  return body.data
}

interface LinearIssueContext {
  id: string
  identifier: string
  title: string
  state: {
    id: string
    name: string
  } | null
  team: {
    id: string
    name: string
    states: {
      nodes: Array<{
        id: string
        name: string
      }>
    }
  } | null
  project: {
    id: string
    name: string
  } | null
  attachments: {
    nodes: Array<{
      url: string | null
      title: string | null
    }>
  } | null
}

async function fetchIssueContext(input: {
  apiBaseUrl: string
  apiToken: string
  issueId: string
}): Promise<LinearIssueContext> {
  const data = await postGraphql<{
    issue: LinearIssueContext | null
  }>({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    query: `
      query LinearSyncIssueContext($issueId: String!) {
        issue(id: $issueId) {
          id
          identifier
          title
          state {
            id
            name
          }
          team {
            id
            name
            states {
              nodes {
                id
                name
              }
            }
          }
          project {
            id
            name
          }
          attachments {
            nodes {
              url
              title
            }
          }
        }
      }
    `,
    variables: {
      issueId: input.issueId,
    },
  })

  if (!data.issue) {
    throw new Error(`Linear issue ${input.issueId} was not found`)
  }

  return data.issue
}

async function updateIssueState(input: {
  apiBaseUrl: string
  apiToken: string
  issueId: string
  stateId: string
}): Promise<void> {
  const data = await postGraphql<{
    issueUpdate?: { success?: boolean }
  }>({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    query: `
      mutation LinearSyncIssueUpdate($issueId: String!, $stateId: String!) {
        issueUpdate(id: $issueId, input: { stateId: $stateId }) {
          success
        }
      }
    `,
    variables: {
      issueId: input.issueId,
      stateId: input.stateId,
    },
  })

  if (!data.issueUpdate?.success) {
    throw new Error(`Linear issueUpdate did not succeed for ${input.issueId}`)
  }
}

async function createIssueAttachment(input: {
  apiBaseUrl: string
  apiToken: string
  issueId: string
  title: string
  url: string
}): Promise<void> {
  const data = await postGraphql<{
    attachmentCreate?: { success?: boolean }
  }>({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    query: `
      mutation LinearSyncAttachmentCreate(
        $issueId: String!
        $title: String!
        $url: String!
      ) {
        attachmentCreate(input: {
          issueId: $issueId
          title: $title
          url: $url
        }) {
          success
        }
      }
    `,
    variables: {
      issueId: input.issueId,
      title: input.title,
      url: input.url,
    },
  })

  if (!data.attachmentCreate?.success) {
    throw new Error(`Linear attachmentCreate did not succeed for ${input.url}`)
  }
}

async function createIssueComment(input: {
  apiBaseUrl: string
  apiToken: string
  issueId: string
  body: string
}): Promise<void> {
  const data = await postGraphql<{
    commentCreate?: { success?: boolean }
  }>({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    query: `
      mutation LinearSyncCommentCreate($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }
    `,
    variables: {
      issueId: input.issueId,
      body: input.body,
    },
  })

  if (!data.commentCreate?.success) {
    throw new Error(`Linear commentCreate did not succeed for ${input.issueId}`)
  }
}

async function createProjectUpdate(input: {
  apiBaseUrl: string
  apiToken: string
  projectId: string
  body: string
  health: LinearProjectUpdateHealth
}): Promise<void> {
  const data = await postGraphql<{
    projectUpdateCreate?: { success?: boolean }
  }>({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    query: `
      mutation LinearSyncProjectUpdateCreate(
        $projectId: String!
        $body: String!
        $health: ProjectUpdateHealthType!
      ) {
        projectUpdateCreate(input: {
          projectId: $projectId
          body: $body
          health: $health
        }) {
          success
        }
      }
    `,
    variables: {
      projectId: input.projectId,
      body: input.body,
      health: input.health,
    },
  })

  if (!data.projectUpdateCreate?.success) {
    throw new Error(`Linear projectUpdateCreate did not succeed for ${input.projectId}`)
  }
}

function parseCommandBody(command: OutboxCommandRecord): {
  payloadHash: string
  milestoneEvent: LinearSyncMilestoneEventCode | null
} {
  const envelope = unwrapOutboxCommandEnvelope(command.commandPayload)
  const body = isRecord(envelope.body) ? envelope.body : {}
  const payloadHash = getString(body.payloadHash)

  if (!payloadHash) {
    throw new Error(`sync_linear_state missing payloadHash for ${command.id}`)
  }

  const milestoneEvent = getString(body.milestoneEvent)

  return {
    payloadHash,
    milestoneEvent:
      milestoneEvent === 'pr_opened' ||
      milestoneEvent === 'ci_failed' ||
      milestoneEvent === 'ci_green' ||
      milestoneEvent === 'deploy_failed' ||
      milestoneEvent === 'deploy_healthy'
        ? milestoneEvent
        : null,
  }
}

function buildMilestoneComment(input: {
  issueIdentifier: string
  issueTitle: string
  currentStatusCode: string
  eventLabel: string
  payloadHash: string
  repositories: Array<{
    repoSlug: string
    prUrl: string | null
    latestCheckConclusion: string | null
    latestCheckUrl: string | null
    latestDeploymentEnv: string | null
    latestDeploymentState: string | null
    latestDeploymentUrl: string | null
  }>
}): string {
  const lines = [
    `Linear sync milestone: ${input.eventLabel}`,
    '',
    `Issue: ${input.issueIdentifier} ${input.issueTitle}`,
    `Internal status: ${input.currentStatusCode}`,
  ]

  for (const repository of input.repositories) {
    lines.push('', `Repo: ${repository.repoSlug}`)
    lines.push(`PR: ${repository.prUrl ?? 'n/a'}`)
    lines.push(
      `CI: ${
        repository.latestCheckConclusion
          ? `${repository.latestCheckConclusion} (${repository.latestCheckUrl ?? 'n/a'})`
          : 'n/a'
      }`,
    )
    lines.push(
      `Deploy: ${
        repository.latestDeploymentState
          ? `${repository.latestDeploymentEnv ?? 'unknown'} ${repository.latestDeploymentState} (${repository.latestDeploymentUrl ?? 'n/a'})`
          : 'n/a'
      }`,
    )
  }

  lines.push('', `<!-- linear-sync:${input.payloadHash} -->`)

  return lines.join('\n')
}

function buildProjectUpdateBody(input: {
  issueIdentifier: string
  issueTitle: string
  currentStatusCode: string
  eventLabel: string
  payloadHash: string
  repositories: Array<{
    repoSlug: string
    prUrl: string | null
    latestCheckConclusion: string | null
    latestCheckUrl: string | null
    latestDeploymentEnv: string | null
    latestDeploymentState: string | null
    latestDeploymentUrl: string | null
  }>
}): string {
  return buildMilestoneComment(input)
}

export function buildSyncLinearStateHandler(
  db: DbClient,
  config: WorkflowWorkerConfig,
): LinearStateSyncHandler {
  return async (command) => {
    if (!config.linear.apiToken) {
      throw new Error(
        'sync_linear_state requires LINEAR_API_TOKEN to be configured',
      )
    }

    const { payloadHash, milestoneEvent } = parseCommandBody(command)

    try {
      const runtimeState = await db
        .selectFrom('issue_runtime_state')
        .select(['current_status_code', 'pinned_config_version'])
        .where('issue_id', '=', command.issueId)
        .executeTakeFirstOrThrow()

      const [stateMappings, milestonePolicies, projections, issueContext] =
        await Promise.all([
          db
            .selectFrom('workflow_linear_state_mappings')
            .select(['status_code', 'linear_state_name', 'sync_enabled'])
            .where('config_version', '=', runtimeState.pinned_config_version)
            .execute(),
          db
            .selectFrom('workflow_linear_milestone_policies')
            .selectAll()
            .where('config_version', '=', runtimeState.pinned_config_version)
            .execute(),
          db
            .selectFrom('issue_linear_sync_projection')
            .selectAll()
            .where('issue_id', '=', command.issueId)
            .orderBy('repo_slug', 'asc')
            .execute(),
          fetchIssueContext({
            apiBaseUrl: config.linear.apiBaseUrl,
            apiToken: config.linear.apiToken,
            issueId: command.issueId,
          }),
        ])

      if (
        projections.length > 0 &&
        projections.every(
          (row) =>
            row.last_synced_payload_hash === payloadHash &&
            row.last_sync_outcome === 'succeeded',
        )
      ) {
        return
      }

      const stateMapping = stateMappings.find(
        (mapping) => mapping.status_code === runtimeState.current_status_code,
      )

      if (!stateMapping) {
        throw new Error(
          `Missing linear state mapping for ${runtimeState.current_status_code}`,
        )
      }

      if (stateMapping.sync_enabled && stateMapping.linear_state_name) {
        const targetState = issueContext.team?.states.nodes.find(
          (state) => state.name === stateMapping.linear_state_name,
        )

        if (!targetState) {
          throw new Error(
            `Linear state ${stateMapping.linear_state_name} was not found in issue team ${issueContext.team?.name ?? 'unknown'}`,
          )
        }

        if (issueContext.state?.id !== targetState.id) {
          await updateIssueState({
            apiBaseUrl: config.linear.apiBaseUrl,
            apiToken: config.linear.apiToken,
            issueId: command.issueId,
            stateId: targetState.id,
          })
        }
      }

      const repositoryRows = projections.map((row) => ({
        repoSlug: row.repo_slug,
        prUrl: row.pr_url,
        latestCheckConclusion: row.latest_check_conclusion,
        latestCheckUrl: row.latest_check_url,
        latestDeploymentEnv: row.latest_deployment_env,
        latestDeploymentState: row.latest_deployment_state,
        latestDeploymentUrl: row.latest_deployment_url,
      }))

      const repositoryRegistryRows =
        projections.length > 0
          ? await db
              .selectFrom('repository_registry')
              .select(['repo_slug', 'github_owner', 'github_repo'])
              .where(
                'repo_slug',
                'in',
                projections.map((row) => row.repo_slug),
              )
              .execute()
          : []

      const existingAttachmentUrls = new Set(
        issueContext.attachments?.nodes
          .map((attachment) => getString(attachment.url))
          .filter((url): url is string => Boolean(url)) ?? [],
      )

      for (const projection of projections) {
        const repository = repositoryRegistryRows.find(
          (row) => row.repo_slug === projection.repo_slug,
        )
        const desiredAttachments: Array<{ title: string; url: string | null }> = [
          repository
            ? {
                title: `Repository: ${projection.repo_slug}`,
                url: `https://github.com/${repository.github_owner}/${repository.github_repo}`,
              }
            : {
                title: `Repository: ${projection.repo_slug}`,
                url: null,
              },
          {
            title:
              projection.pr_number !== null
                ? `PR #${projection.pr_number.toString()}`
                : `PR: ${projection.repo_slug}`,
            url: projection.pr_url,
          },
          {
            title: `CI: ${projection.repo_slug}`,
            url: projection.latest_check_url,
          },
          {
            title:
              projection.latest_deployment_env !== null
                ? `Deploy: ${projection.latest_deployment_env}`
                : `Deploy: ${projection.repo_slug}`,
            url: projection.latest_deployment_url,
          },
        ]

        for (const attachment of desiredAttachments) {
          if (!attachment.url || existingAttachmentUrls.has(attachment.url)) {
            continue
          }

          await createIssueAttachment({
            apiBaseUrl: config.linear.apiBaseUrl,
            apiToken: config.linear.apiToken,
            issueId: command.issueId,
            title: attachment.title,
            url: attachment.url,
          })

          existingAttachmentUrls.add(attachment.url)
        }
      }

      if (milestoneEvent) {
        const policy = milestonePolicies.find(
          (candidate) => candidate.event_code === milestoneEvent,
        )

        if (!policy) {
          throw new Error(`Missing linear milestone policy for ${milestoneEvent}`)
        }

        const commentBody = buildMilestoneComment({
          issueIdentifier: issueContext.identifier,
          issueTitle: issueContext.title,
          currentStatusCode: runtimeState.current_status_code,
          eventLabel: policy.event_label,
          payloadHash,
          repositories: repositoryRows,
        })

        if (policy.post_comment) {
          await createIssueComment({
            apiBaseUrl: config.linear.apiBaseUrl,
            apiToken: config.linear.apiToken,
            issueId: command.issueId,
            body: commentBody,
          })
        }

        if (
          policy.create_project_update &&
          issueContext.project?.id &&
          getString(policy.project_update_health)
        ) {
          await createProjectUpdate({
            apiBaseUrl: config.linear.apiBaseUrl,
            apiToken: config.linear.apiToken,
            projectId: issueContext.project.id,
            body: buildProjectUpdateBody({
              issueIdentifier: issueContext.identifier,
              issueTitle: issueContext.title,
              currentStatusCode: runtimeState.current_status_code,
              eventLabel: policy.event_label,
              payloadHash,
              repositories: repositoryRows,
            }),
            health: policy.project_update_health as LinearProjectUpdateHealth,
          })
        }
      }

      await markIssueLinearSyncProjectionSyncState(db, {
        issueId: command.issueId,
        payloadHash,
        outcome: 'succeeded',
        error: null,
      })
    } catch (error) {
      await markIssueLinearSyncProjectionSyncState(db, {
        issueId: command.issueId,
        payloadHash,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })

      throw error
    }
  }
}
