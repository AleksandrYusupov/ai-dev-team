import { createHash } from 'node:crypto'

import { parse } from 'yaml'

import type { UpsertIssueContractSnapshotInput, JsonObject } from '@ai-dev-team/db'
import type {
  AuthScheme,
  IntegrationKind,
  IntegrationCredentialRequirement,
  IssueContractDependencies,
  IssueContractVerificationPath,
} from '@ai-dev-team/shared'
import { AUTH_SCHEMES, INTEGRATION_KINDS } from '@ai-dev-team/shared'

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function getEnumValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
): T | null {
  return typeof value === 'string' && allowedValues.includes(value as T)
    ? (value as T)
    : null
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => getString(entry))
      .filter((entry): entry is string => entry !== null)
  }

  const single = getString(value)

  return single ? [single] : []
}

function toJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as JsonObject
}

function stringifyDependencyEntry(value: unknown): string | null {
  const single = getString(value)

  if (single) {
    return single
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const pairs = Object.entries(value as Record<string, unknown>)
    .map(([key, nestedValue]) => {
      const normalizedValue = getString(nestedValue)

      return normalizedValue ? `${key}:${normalizedValue}` : null
    })
    .filter((entry): entry is string => entry !== null)

  return pairs.length > 0 ? pairs.join(',') : null
}

function toDependencyList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyDependencyEntry(entry))
      .filter((entry): entry is string => entry !== null)
  }

  const single = stringifyDependencyEntry(value)

  return single ? [single] : []
}

function toCredentialRequirements(
  value: unknown,
): IntegrationCredentialRequirement[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        const normalized = entry.trim()

        return {
          key: normalized,
          label: normalized,
          environment: 'sandbox',
          optional: false,
          description: null,
        } satisfies IntegrationCredentialRequirement
      }

      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null
      }

      const objectValue = entry as JsonObject
      const key =
        getString(objectValue.key) ??
        getString(objectValue.name) ??
        getString(objectValue.slot)

      if (!key) {
        return null
      }

      return {
        key,
        label:
          getString(objectValue.label) ??
          getString(objectValue.title) ??
          key,
        environment:
          getString(objectValue.environment) ??
          getString(objectValue.env) ??
          'sandbox',
        optional: getBoolean(objectValue.optional) ?? false,
        description:
          getString(objectValue.description) ??
          getString(objectValue.notes),
      } satisfies IntegrationCredentialRequirement
    })
    .filter((entry): entry is IntegrationCredentialRequirement => entry !== null)
}

function extractFrontmatter(markdown: string): string | null {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)

  return match?.[1] ?? null
}

function findIssueDescription(data: JsonObject): string | null {
  return (
    getString(data.description) ??
    getString(data.body) ??
    getString(data.descriptionData)
  )
}

function toVerificationPath(value: unknown): IssueContractVerificationPath {
  if (Array.isArray(value)) {
    return {
      automated: value
        .map((entry) => getString(entry))
        .filter((entry): entry is string => entry !== null),
      manual: [],
    }
  }

  const objectValue = toJsonObject(value)

  return {
    automated: toStringList(objectValue.automated),
    manual: toStringList(objectValue.manual),
  }
}

function toDependencies(value: unknown): IssueContractDependencies {
  const objectValue = toJsonObject(value)
  const blockedBy =
    toDependencyList(objectValue.blocked_by).length > 0
      ? toDependencyList(objectValue.blocked_by)
      : toDependencyList(objectValue.blockedBy).length > 0
        ? toDependencyList(objectValue.blockedBy)
        : toDependencyList(objectValue.upstream)

  return {
    blocks: toDependencyList(objectValue.blocks),
    blockedBy,
    external: toDependencyList(objectValue.external),
  }
}

export function parseIssueContractSnapshot(input: {
  issueId: string
  projectId: string | null
  data: JsonObject
}): UpsertIssueContractSnapshotInput | null {
  const description = findIssueDescription(input.data)

  if (!description) {
    return null
  }

  const frontmatter = extractFrontmatter(description)

  if (!frontmatter) {
    return null
  }

  let parsed: unknown

  try {
    parsed = parse(frontmatter)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`linear_issue_contract_yaml_invalid: ${message}`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('linear_issue_contract_yaml_invalid: expected mapping')
  }

  const contract = {
    project: getString((parsed as JsonObject).project) ?? input.projectId,
    primaryRepo:
      getString((parsed as JsonObject).primary_repo) ??
      getString((parsed as JsonObject).primaryRepo),
    affectedRepos:
      toStringList((parsed as JsonObject).affected_repos).length > 0
        ? toStringList((parsed as JsonObject).affected_repos)
        : toStringList((parsed as JsonObject).affectedRepos),
    goal: getString((parsed as JsonObject).goal) ?? '',
    background: getString((parsed as JsonObject).background),
    scope:
      toStringList((parsed as JsonObject).scope).length > 0
        ? toStringList((parsed as JsonObject).scope)
        : getString((parsed as JsonObject).scope)
          ? [getString((parsed as JsonObject).scope) as string]
          : [],
    nonGoals:
      toStringList((parsed as JsonObject).non_goals).length > 0
        ? toStringList((parsed as JsonObject).non_goals)
        : toStringList((parsed as JsonObject).nonGoals),
    acceptanceCriteria:
      toStringList((parsed as JsonObject).acceptance_criteria).length > 0
        ? toStringList((parsed as JsonObject).acceptance_criteria)
        : toStringList((parsed as JsonObject).acceptanceCriteria),
    verificationPath:
      Object.keys(toJsonObject((parsed as JsonObject).verification_path)).length > 0
        ? toVerificationPath((parsed as JsonObject).verification_path)
        : toVerificationPath((parsed as JsonObject).verificationPath),
    docsLinks:
      toStringList((parsed as JsonObject).docs_links).length > 0
        ? toStringList((parsed as JsonObject).docs_links)
        : toStringList((parsed as JsonObject).docsLinks),
    dependencies: toDependencies((parsed as JsonObject).dependencies),
    risk: getString((parsed as JsonObject).risk),
    doneWhen:
      toStringList((parsed as JsonObject).done_when).length > 0
        ? toStringList((parsed as JsonObject).done_when)
        : toStringList((parsed as JsonObject).doneWhen),
    openQuestions:
      toStringList((parsed as JsonObject).open_questions).length > 0
        ? toStringList((parsed as JsonObject).open_questions)
        : toStringList((parsed as JsonObject).openQuestions),
    humanDecisionRequired:
      getBoolean((parsed as JsonObject).human_decision_required) ??
      getBoolean((parsed as JsonObject).humanDecisionRequired),
    issueType:
      getString((parsed as JsonObject).issue_type) ??
      getString((parsed as JsonObject).issueType),
    source: getString((parsed as JsonObject).source),
    mode: getString((parsed as JsonObject).mode),
    providerName:
      getString((parsed as JsonObject).provider_name) ??
      getString((parsed as JsonObject).providerName),
    integrationKind:
      getEnumValue<IntegrationKind>(
        (parsed as JsonObject).integration_kind,
        INTEGRATION_KINDS,
      ) ??
      getEnumValue<IntegrationKind>(
        (parsed as JsonObject).integrationKind,
        INTEGRATION_KINDS,
      ),
    authScheme:
      getEnumValue<AuthScheme>(
        (parsed as JsonObject).auth_scheme,
        AUTH_SCHEMES,
      ) ??
      getEnumValue<AuthScheme>((parsed as JsonObject).authScheme, AUTH_SCHEMES),
    requiredCredentials:
      toCredentialRequirements((parsed as JsonObject).required_credentials)
        .length > 0
        ? toCredentialRequirements((parsed as JsonObject).required_credentials)
        : toCredentialRequirements((parsed as JsonObject).requiredCredentials),
    secretSlots:
      toStringList((parsed as JsonObject).secret_slots).length > 0
        ? toStringList((parsed as JsonObject).secret_slots)
        : toStringList((parsed as JsonObject).secretSlots),
    requiredScopes:
      toStringList((parsed as JsonObject).required_scopes).length > 0
        ? toStringList((parsed as JsonObject).required_scopes)
        : toStringList((parsed as JsonObject).requiredScopes),
    oauthRedirectUris:
      toStringList((parsed as JsonObject).oauth_redirect_uris).length > 0
        ? toStringList((parsed as JsonObject).oauth_redirect_uris)
        : toStringList((parsed as JsonObject).oauthRedirectUris),
    sandboxAccountRequired:
      getBoolean((parsed as JsonObject).sandbox_account_required) ??
      getBoolean((parsed as JsonObject).sandboxAccountRequired),
    webhookRequired:
      getBoolean((parsed as JsonObject).webhook_required) ??
      getBoolean((parsed as JsonObject).webhookRequired),
    webhookCallbackUrls:
      toStringList((parsed as JsonObject).webhook_callback_urls).length > 0
        ? toStringList((parsed as JsonObject).webhook_callback_urls)
        : toStringList((parsed as JsonObject).webhookCallbackUrls),
    rateLimitNotes:
      getString((parsed as JsonObject).rate_limit_notes) ??
      getString((parsed as JsonObject).rateLimitNotes),
    errorModel:
      toStringList((parsed as JsonObject).error_model).length > 0
        ? toStringList((parsed as JsonObject).error_model)
        : toStringList((parsed as JsonObject).errorModel),
    testStrategy:
      toStringList((parsed as JsonObject).test_strategy).length > 0
        ? toStringList((parsed as JsonObject).test_strategy)
        : toStringList((parsed as JsonObject).testStrategy),
    goLiveChecklist:
      toStringList((parsed as JsonObject).go_live_checklist).length > 0
        ? toStringList((parsed as JsonObject).go_live_checklist)
        : toStringList((parsed as JsonObject).goLiveChecklist),
    rollbackPlan:
      toStringList((parsed as JsonObject).rollback_plan).length > 0
        ? toStringList((parsed as JsonObject).rollback_plan)
        : toStringList((parsed as JsonObject).rollbackPlan),
  }

  const snapshotHash = createHash('sha256')
    .update(JSON.stringify(contract))
    .digest('hex')

  return {
    issueId: input.issueId,
    snapshotHash,
    primaryRepo: contract.primaryRepo,
    affectedRepos: contract.affectedRepos,
    docsLinks: contract.docsLinks,
    risk: contract.risk,
    dependencies: contract.dependencies,
    contractJson: contract,
  }
}
