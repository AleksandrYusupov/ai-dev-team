/**
 * Fetches full issue content from Linear GraphQL API for context enrichment.
 * Falls back to extracting content from the raw webhook payload when the API is unavailable.
 */

export interface LinearIssueContent {
  issueId: string
  identifier: string | null
  title: string
  description: string | null
  priority: number | null
  priorityLabel: string | null
  stateName: string | null
  stateType: string | null
  labels: string[]
  assigneeName: string | null
  assigneeEmail: string | null
  projectId: string | null
  projectName: string | null
  comments: LinearIssueComment[]
}

export interface LinearIssueComment {
  id: string
  body: string
  createdAt: string
  userName: string | null
}

const ISSUE_ENRICH_QUERY = `
  query IssueEnrich($issueId: String!) {
    issue(id: $issueId) {
      id
      identifier
      title
      description
      priority
      priorityLabel
      state { name type }
      labels { nodes { name } }
      assignee { name email }
      project { id name }
      comments(first: 20) {
        nodes { id body createdAt user { name } }
      }
    }
  }
`

interface LinearGraphqlIssueResponse {
  issue: {
    id: string
    identifier: string
    title: string
    description: string | null
    priority: number | null
    priorityLabel: string | null
    state: { name: string; type: string } | null
    labels: { nodes: Array<{ name: string }> }
    assignee: { name: string; email: string } | null
    project: { id: string; name: string } | null
    comments: {
      nodes: Array<{
        id: string
        body: string
        createdAt: string
        user: { name: string } | null
      }>
    }
  }
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

export async function fetchLinearIssueContent(input: {
  apiBaseUrl: string
  apiToken: string
  issueId: string
}): Promise<LinearIssueContent> {
  const data = await postGraphql<LinearGraphqlIssueResponse>({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    query: ISSUE_ENRICH_QUERY,
    variables: { issueId: input.issueId },
  })

  const issue = data.issue

  return {
    issueId: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    stateName: issue.state?.name ?? null,
    stateType: issue.state?.type ?? null,
    labels: issue.labels.nodes.map((l) => l.name),
    assigneeName: issue.assignee?.name ?? null,
    assigneeEmail: issue.assignee?.email ?? null,
    projectId: issue.project?.id ?? null,
    projectName: issue.project?.name ?? null,
    comments: issue.comments.nodes.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      userName: c.user?.name ?? null,
    })),
  }
}

function getString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function getNumber(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key]
  return typeof value === 'number' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function extractIssueContentFromWebhookPayload(
  parsedPayload: Record<string, unknown>,
): LinearIssueContent | null {
  const data = isRecord(parsedPayload.data) ? parsedPayload.data : null

  if (!data) {
    return null
  }

  const issueId = getString(data, 'id')
  const title = getString(data, 'title')

  if (!issueId || !title) {
    return null
  }

  let labels: string[] = []

  if (Array.isArray(data.labels)) {
    labels = data.labels
      .filter((l): l is Record<string, unknown> => isRecord(l))
      .map((l) => getString(l, 'name'))
      .filter((name): name is string => name !== null)
  } else if (isRecord(data.labels) && Array.isArray((data.labels as Record<string, unknown>).nodes)) {
    labels = ((data.labels as Record<string, unknown>).nodes as unknown[])
      .filter((l): l is Record<string, unknown> => isRecord(l))
      .map((l) => getString(l, 'name'))
      .filter((name): name is string => name !== null)
  }

  const assignee = isRecord(data.assignee) ? data.assignee : null
  const project = isRecord(data.project) ? data.project : null

  return {
    issueId,
    identifier: getString(data, 'identifier'),
    title,
    description: getString(data, 'description'),
    priority: getNumber(data, 'priority'),
    priorityLabel: getString(data, 'priorityLabel'),
    stateName: isRecord(data.state) ? getString(data.state, 'name') : null,
    stateType: isRecord(data.state) ? getString(data.state, 'type') : null,
    labels,
    assigneeName: assignee ? getString(assignee, 'name') : null,
    assigneeEmail: assignee ? getString(assignee, 'email') : null,
    projectId: project ? getString(project, 'id') : null,
    projectName: project ? getString(project, 'name') : null,
    comments: [],
  }
}
