import assert from 'node:assert/strict'
import test from 'node:test'

import { parseIssueContractSnapshot } from './issue-contract.js'

test('parseIssueContractSnapshot extracts frontmatter-backed contract fields', () => {
  const snapshot = parseIssueContractSnapshot({
    issueId: 'ISSUE-1',
    projectId: 'project-1',
    data: {
      description: `---
primary_repo: repo-primary
affected_repos:
  - repo-secondary
provider_name: Stripe
integration_kind: external_api
auth_scheme: oauth2_auth_code
required_credentials:
  - key: client_id
    label: OAuth client id
    environment: sandbox
  - key: client_secret
    label: OAuth client secret
    environment: sandbox
secret_slots:
  - stripe.sandbox.client_id
  - stripe.sandbox.client_secret
required_scopes:
  - read_write
oauth_redirect_uris:
  - https://control.example.test/oauth/callback/stripe
sandbox_account_required: true
webhook_required: true
webhook_callback_urls:
  - https://control.example.test/webhooks/stripe
rate_limit_notes:
  Stripe sandbox is bursty around token refresh
error_model:
  - 401 invalid_client
test_strategy:
  - Sandbox probe
go_live_checklist:
  - Approve prod credential
rollback_plan:
  - Revoke token handle
goal: Ship Phase 4
scope: Implement context packs
non_goals:
  - Rewrite the platform
acceptance_criteria:
  - Context pack route works
verification_path:
  - corepack pnpm test
docs_links:
  - ai_dev_team/architecture/06_repository_registry_and_context_pack_spec
dependencies:
  blocked_by:
  - ISSUE-2
risk: medium
done_when:
  - Docs updated
open_questions:
  - none
human_decision_required: false
---

body`,
    },
  })

  assert.ok(snapshot)
  assert.equal(snapshot.primaryRepo, 'repo-primary')
  assert.deepEqual(snapshot.affectedRepos, ['repo-secondary'])
  assert.deepEqual(snapshot.docsLinks, [
    'ai_dev_team/architecture/06_repository_registry_and_context_pack_spec',
  ])
  assert.equal(snapshot.contractJson.project, 'project-1')
  assert.equal(snapshot.contractJson.goal, 'Ship Phase 4')
  assert.equal(snapshot.contractJson.providerName, 'Stripe')
  assert.equal(snapshot.contractJson.integrationKind, 'external_api')
  assert.equal(snapshot.contractJson.authScheme, 'oauth2_auth_code')
  assert.deepEqual(snapshot.contractJson.secretSlots, [
    'stripe.sandbox.client_id',
    'stripe.sandbox.client_secret',
  ])
  assert.deepEqual(snapshot.contractJson.requiredScopes, ['read_write'])
  assert.equal(snapshot.contractJson.sandboxAccountRequired, true)
  assert.equal(snapshot.contractJson.webhookRequired, true)
  assert.deepEqual(snapshot.contractJson.doneWhen, ['Docs updated'])
  assert.deepEqual(snapshot.contractJson.dependencies.blockedBy, ['ISSUE-2'])
  assert.match(snapshot.snapshotHash, /^[a-f0-9]{64}$/)
})

test('parseIssueContractSnapshot accepts legacy upstream dependency alias', () => {
  const snapshot = parseIssueContractSnapshot({
    issueId: 'ISSUE-1',
    projectId: 'project-1',
    data: {
      description: `---
goal: Ship Phase 4
scope:
  - Implement compatibility
acceptance_criteria:
  - Legacy aliases still work
verification_path:
  - corepack pnpm test
done_when:
  - Tests are green
dependencies:
  upstream:
    - ISSUE-LEGACY-1
---
`,
    },
  })

  assert.ok(snapshot)
  assert.deepEqual(snapshot.contractJson.dependencies.blockedBy, [
    'ISSUE-LEGACY-1',
  ])
})

test('parseIssueContractSnapshot accepts camelCase blockedBy dependency alias', () => {
  const snapshot = parseIssueContractSnapshot({
    issueId: 'ISSUE-1',
    projectId: 'project-1',
    data: {
      description: `---
goal: Ship Phase 4
scope:
  - Preserve compatibility
acceptance_criteria:
  - camelCase dependencies still work
verification_path:
  - corepack pnpm test
done_when:
  - Tests are green
dependencies:
  blockedBy:
    - ISSUE-CAMEL-1
---
`,
    },
  })

  assert.ok(snapshot)
  assert.deepEqual(snapshot.contractJson.dependencies.blockedBy, [
    'ISSUE-CAMEL-1',
  ])
})

test('parseIssueContractSnapshot returns null when no frontmatter-backed contract exists', () => {
  const snapshot = parseIssueContractSnapshot({
    issueId: 'ISSUE-1',
    projectId: 'project-1',
    data: {
      description: 'Just free-form markdown without machine-readable contract',
    },
  })

  assert.equal(snapshot, null)
})

test('parseIssueContractSnapshot throws on malformed explicit yaml frontmatter', () => {
  assert.throws(
    () =>
      parseIssueContractSnapshot({
        issueId: 'ISSUE-1',
        projectId: 'project-1',
        data: {
          description: `---
primary_repo: [broken
---
`,
        },
      }),
    /linear_issue_contract_yaml_invalid/,
  )
})
