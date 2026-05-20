import type {
  CanonicalEventClassification,
  CommentLogClassification,
  WebhookProvider,
} from './index.js'

export const SUPPORTED_LINEAR_EVENT_TYPES = [
  'Issue',
  'Comment',
  'Project',
  'Document',
  'ProjectUpdate',
  'IssueLabel',
] as const

export type SupportedLinearEventType =
  (typeof SUPPORTED_LINEAR_EVENT_TYPES)[number]

export const SUPPORTED_GITHUB_EVENT_TYPES = [
  'pull_request',
  'pull_request_review',
  'push',
  'workflow_run',
  'check_run',
  'deployment_status',
] as const

export type SupportedGitHubEventType =
  (typeof SUPPORTED_GITHUB_EVENT_TYPES)[number]

export type SupportedPhase3EventType =
  | SupportedLinearEventType
  | SupportedGitHubEventType

export function isSupportedLinearEventType(
  value: string,
): value is SupportedLinearEventType {
  return SUPPORTED_LINEAR_EVENT_TYPES.includes(value as SupportedLinearEventType)
}

export function isSupportedGitHubEventType(
  value: string,
): value is SupportedGitHubEventType {
  return SUPPORTED_GITHUB_EVENT_TYPES.includes(value as SupportedGitHubEventType)
}

export function isSupportedPhase3EventType(
  provider: WebhookProvider,
  value: string,
): value is SupportedPhase3EventType {
  if (provider === 'linear') {
    return isSupportedLinearEventType(value)
  }

  return isSupportedGitHubEventType(value)
}

export interface Phase3FixtureRefs {
  issueId: string | null
  commentId: string | null
  projectId: string | null
  repositoryFullName: string | null
}

export interface Phase3FixtureExpectation {
  subjectType: string
  classification: CanonicalEventClassification
  triggerCandidate: string | null
  commentLogClassification?: CommentLogClassification
  containsAsk?: boolean
}

export interface Phase3WebhookFixture {
  provider: WebhookProvider
  providerEventType: SupportedPhase3EventType
  providerAction: string | null
  deliveryId: string
  payload: Record<string, unknown>
  refs: Phase3FixtureRefs
  expected: Phase3FixtureExpectation
}

export function serializePhase3FixturePayload(
  fixture: Phase3WebhookFixture,
): string {
  return JSON.stringify(fixture.payload)
}

export function buildSupportedLinearFixtures(
  baseTimestampMs: number,
): Phase3WebhookFixture[] {
  const timestamp = new Date(baseTimestampMs).toISOString()

  return [
    {
      provider: 'linear',
      providerEventType: 'Issue',
      providerAction: 'create',
      deliveryId: 'fixture-linear-issue',
      payload: {
        action: 'create',
        type: 'Issue',
        webhookTimestamp: baseTimestampMs,
        data: {
          id: 'ISSUE-FIXTURE-1',
          title: 'Fixture issue',
          projectId: 'project-fixture-1',
          description: `---
primary_repo: repo-fixture-primary
affected_repos:
  - repo-fixture-affected
goal: Ship the fixture flow
scope: Implement fixture-backed Phase 4 behavior
non_goals:
  - Redesign the whole system
acceptance_criteria:
  - Fixture flow is implemented
verification_path:
  - corepack pnpm test
docs_links:
  - ai_dev_team/architecture/05_full_system_implementation_plan
dependencies:
  blocked_by:
    - ISSUE-UPSTREAM-1
risk: medium
done_when:
  - Tests are green
---

## Background
Fixture issue used by integration tests.
`,
        },
      },
      refs: {
        issueId: 'ISSUE-FIXTURE-1',
        commentId: null,
        projectId: 'project-fixture-1',
        repositoryFullName: null,
      },
      expected: {
        subjectType: 'issue',
        classification: 'transition_candidate',
        triggerCandidate: 'user_create_issue',
      },
    },
    {
      provider: 'linear',
      providerEventType: 'Comment',
      providerAction: 'create',
      deliveryId: 'fixture-linear-comment-prompt',
      payload: {
        action: 'create',
        type: 'Comment',
        webhookTimestamp: baseTimestampMs,
        actor: {
          id: 'user-prompt',
          type: 'user',
        },
        data: {
          id: 'comment-prompt-1',
          issueId: 'ISSUE-FIXTURE-1',
          body: '@ask please continue',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      refs: {
        issueId: 'ISSUE-FIXTURE-1',
        commentId: 'comment-prompt-1',
        projectId: null,
        repositoryFullName: null,
      },
      expected: {
        subjectType: 'comment',
        classification: 'transition_candidate',
        triggerCandidate: 'human_comment_ask',
        commentLogClassification: 'prompt',
        containsAsk: true,
      },
    },
    {
      provider: 'linear',
      providerEventType: 'Project',
      providerAction: 'update',
      deliveryId: 'fixture-linear-project',
      payload: {
        action: 'update',
        type: 'Project',
        webhookTimestamp: baseTimestampMs,
        data: {
          id: 'project-fixture-1',
          name: 'Fixture project',
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: 'project-fixture-1',
        repositoryFullName: null,
      },
      expected: {
        subjectType: 'project',
        classification: 'metadata_refresh',
        triggerCandidate: null,
      },
    },
    {
      provider: 'linear',
      providerEventType: 'Document',
      providerAction: 'update',
      deliveryId: 'fixture-linear-document',
      payload: {
        action: 'update',
        type: 'Document',
        webhookTimestamp: baseTimestampMs,
        data: {
          id: 'document-fixture-1',
          projectId: 'project-fixture-1',
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: 'project-fixture-1',
        repositoryFullName: null,
      },
      expected: {
        subjectType: 'document',
        classification: 'context_refresh',
        triggerCandidate: null,
      },
    },
    {
      provider: 'linear',
      providerEventType: 'ProjectUpdate',
      providerAction: 'create',
      deliveryId: 'fixture-linear-project-update',
      payload: {
        action: 'create',
        type: 'ProjectUpdate',
        webhookTimestamp: baseTimestampMs,
        data: {
          id: 'project-update-fixture-1',
          projectId: 'project-fixture-1',
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: 'project-fixture-1',
        repositoryFullName: null,
      },
      expected: {
        subjectType: 'project_update',
        classification: 'context_refresh',
        triggerCandidate: null,
      },
    },
    {
      provider: 'linear',
      providerEventType: 'IssueLabel',
      providerAction: 'update',
      deliveryId: 'fixture-linear-issue-label',
      payload: {
        action: 'update',
        type: 'IssueLabel',
        webhookTimestamp: baseTimestampMs,
        data: {
          id: 'label-fixture-1',
          issueId: 'ISSUE-FIXTURE-1',
        },
      },
      refs: {
        issueId: 'ISSUE-FIXTURE-1',
        commentId: null,
        projectId: null,
        repositoryFullName: null,
      },
      expected: {
        subjectType: 'issue_label',
        classification: 'metadata_refresh',
        triggerCandidate: null,
      },
    },
  ]
}

export function buildSupportedGitHubFixtures(): Phase3WebhookFixture[] {
  return [
    {
      provider: 'github',
      providerEventType: 'pull_request',
      providerAction: 'opened',
      deliveryId: 'fixture-github-pull-request',
      payload: {
        action: 'opened',
        repository: {
          id: 1,
          full_name: 'acme/repo',
          private: false,
        },
        pull_request: {
          id: 10,
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: null,
        repositoryFullName: 'acme/repo',
      },
      expected: {
        subjectType: 'pull_request',
        classification: 'sync_only',
        triggerCandidate: null,
      },
    },
    {
      provider: 'github',
      providerEventType: 'pull_request_review',
      providerAction: 'submitted',
      deliveryId: 'fixture-github-pull-request-review',
      payload: {
        action: 'submitted',
        repository: {
          id: 1,
          full_name: 'acme/repo',
          private: false,
        },
        review: {
          id: 11,
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: null,
        repositoryFullName: 'acme/repo',
      },
      expected: {
        subjectType: 'pull_request_review',
        classification: 'sync_only',
        triggerCandidate: null,
      },
    },
    {
      provider: 'github',
      providerEventType: 'push',
      providerAction: null,
      deliveryId: 'fixture-github-push',
      payload: {
        after: 'abc123',
        repository: {
          id: 1,
          full_name: 'acme/repo',
          private: false,
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: null,
        repositoryFullName: 'acme/repo',
      },
      expected: {
        subjectType: 'push',
        classification: 'sync_only',
        triggerCandidate: null,
      },
    },
    {
      provider: 'github',
      providerEventType: 'workflow_run',
      providerAction: 'completed',
      deliveryId: 'fixture-github-workflow-run',
      payload: {
        action: 'completed',
        repository: {
          id: 1,
          full_name: 'acme/repo',
          private: false,
        },
        workflow_run: {
          id: 12,
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: null,
        repositoryFullName: 'acme/repo',
      },
      expected: {
        subjectType: 'workflow_run',
        classification: 'sync_only',
        triggerCandidate: null,
      },
    },
    {
      provider: 'github',
      providerEventType: 'check_run',
      providerAction: 'completed',
      deliveryId: 'fixture-github-check-run',
      payload: {
        action: 'completed',
        repository: {
          id: 1,
          full_name: 'acme/repo',
          private: false,
        },
        check_run: {
          id: 13,
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: null,
        repositoryFullName: 'acme/repo',
      },
      expected: {
        subjectType: 'check_run',
        classification: 'sync_only',
        triggerCandidate: null,
      },
    },
    {
      provider: 'github',
      providerEventType: 'deployment_status',
      providerAction: 'created',
      deliveryId: 'fixture-github-deployment-status',
      payload: {
        action: 'created',
        repository: {
          id: 1,
          full_name: 'acme/repo',
          private: false,
        },
        deployment_status: {
          id: 14,
        },
      },
      refs: {
        issueId: null,
        commentId: null,
        projectId: null,
        repositoryFullName: 'acme/repo',
      },
      expected: {
        subjectType: 'deployment_status',
        classification: 'sync_only',
        triggerCandidate: null,
      },
    },
  ]
}

export function buildSupportedPhase3Fixtures(
  baseTimestampMs: number,
): Phase3WebhookFixture[] {
  return [
    ...buildSupportedLinearFixtures(baseTimestampMs),
    ...buildSupportedGitHubFixtures(),
  ]
}

export function buildUnsupportedLinearFixture(
  baseTimestampMs: number,
): Record<string, unknown> {
  return {
    action: 'create',
    type: 'Cycle',
    webhookTimestamp: baseTimestampMs,
    data: {
      id: 'cycle-fixture-1',
    },
  }
}

export function buildUnsupportedGitHubFixture(): Record<string, unknown> {
  return {
    action: 'completed',
    repository: {
      id: 1,
      full_name: 'acme/repo',
      private: false,
    },
    check_suite: {
      id: 15,
    },
  }
}
