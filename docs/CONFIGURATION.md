# Configuration

Configuration is parsed by `packages/config`. Copy `.env.example` to `.env.local` for local development and replace placeholders locally.

Never commit `.env`, `.env.local`, production URLs, webhook secrets, bearer tokens, API keys, OAuth secrets, personal vault paths, or runner worktree paths.

## Secret Classes

- Secret: must be supplied through an untracked env file, shell export, GitHub Actions secret, or deployment secret manager.
- Local metadata: safe local-only defaults such as ports, task queue names, and development paths.
- Public metadata: safe to document because it does not grant access.
- Optional secret: absent by default; required only when enabling a live integration.

## Environment Variables

| Variable | Class | Required For | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | Public metadata | all services | `development`, `test`, or `production`. |
| `APP_VERSION` | Public metadata | all services | Version label for logs/metadata. |
| `LOG_LEVEL` | Public metadata | all services | `trace`, `debug`, `info`, `warn`, or `error`. |
| `CONTROL_API_HOST` | Local metadata | control-api | Local bind host. |
| `CONTROL_API_PORT` | Local metadata | control-api | Local bind port. |
| `INTERNAL_API_BEARER_TOKEN` | Secret | control-api internal routes | Generate a unique value per environment. |
| `RUNNER_AUTH_TOKENS_JSON` | Secret | control-api runner auth | JSON map of runner node id to bearer token. |
| `RUNNER_LONG_POLL_MAX_WAIT_MS` | Public metadata | control-api | Max runner long-poll wait. |
| `LINEAR_WEBHOOK_SECRET` | Secret | Linear webhook ingress | Provider webhook signing secret. |
| `GITHUB_WEBHOOK_SECRET` | Secret | GitHub webhook ingress | Provider webhook signing secret. |
| `WEBHOOK_REPLAY_WINDOW_MS` | Public metadata | webhooks | Linear replay-window validation. |
| `WEBHOOK_MAX_PAYLOAD_BYTES` | Public metadata | control-api | Fastify body limit. |
| `CONTEXT_PACK_MAX_TOKENS` | Public metadata | context assembly | Prompt-facing budget. |
| `CONTEXT_PACK_MAX_COMMENTS` | Public metadata | context assembly | Comment count cap. |
| `CONTEXT_PACK_MAX_NOTES` | Public metadata | context assembly | Note count cap. |
| `VENDOR_DOCS_ALLOWLIST` | Public metadata | integration metadata | Comma-separated documentation domains. |
| `SECRET_SERVICE_BACKEND` | Public metadata | integration metadata | Backend identifier, for example `gcp_secret_manager`. |
| `GCP_SECRET_MANAGER_PROJECT_ID` | Local metadata | future secret manager use | Project id, not a credential. |
| `SECRET_SERVICE_DEFAULT_PREFIX` | Local metadata | integration metadata | Alias prefix, not secret material. |
| `OAUTH_PUBLIC_CALLBACK_BASE_URL` | Local metadata | OAuth callback registration | Use local URL in development and deployment URL in hosted environments. |
| `OAUTH_REDIRECT_PATH_PREFIX` | Public metadata | OAuth callback registration | Defaults to `/oauth/callback`. |
| `OAUTH_ENFORCE_PKCE` | Public metadata | OAuth onboarding | Keep enabled by default. |
| `INTEGRATION_LAB_ENABLED` | Public metadata | integration lab | Enables metadata/probe paths. |
| `INTEGRATION_LAB_MAX_PROBE_REQUESTS` | Public metadata | integration lab | Probe ceiling. |
| `INTEGRATION_LAB_ALLOWED_SANDBOX_DOMAINS` | Public metadata | integration lab | Sandbox allowlist. |
| `DATABASE_URL` | Secret | DB-backed services | Local example uses Docker Postgres. Hosted values are secret. |
| `DB_POOL_MAX` | Public metadata | DB-backed services | Pool size. |
| `KNOWLEDGE_SYNC_VAULT_ROOT` | Local metadata | knowledge-sync | Machine-local path. Do not commit personal paths. |
| `KNOWLEDGE_SYNC_BATCH_SIZE` | Public metadata | knowledge-sync | Snapshot batch size. |
| `KNOWLEDGE_SNAPSHOT_MAX_NOTE_BYTES` | Public metadata | knowledge-sync | Max note size before processing. |
| `TEMPORAL_SERVER_ADDRESS` | Local metadata | workflow-worker | Local Temporal address. |
| `TEMPORAL_NAMESPACE` | Public metadata | workflow-worker | Temporal namespace. |
| `TEMPORAL_TASK_QUEUE` | Public metadata | workflow-worker | Worker task queue. |
| `WORKFLOW_OUTBOX_*` | Public metadata | workflow-worker | Outbox polling and timeout knobs. |
| `WORKFLOW_INGRESS_*` | Public metadata | workflow-worker | Inbox polling and retry knobs. |
| `RUNNER_NETWORK_MODES_SUPPORTED` | Public metadata | runner-host | Comma-separated integration network modes. |
| `RUNNER_ALLOWED_DOC_DOMAINS` | Public metadata | runner-host | Documentation allowlist. |
| `RUNNER_ALLOWED_SANDBOX_DOMAINS` | Public metadata | runner-host | Sandbox API allowlist. |
| `RUNNER_SUPPORTS_BROWSER_CONSENT` | Public metadata | runner-host | Capability flag. |
| `RUNNER_SUPPORTS_SECRET_BROKER` | Public metadata | runner-host | Capability flag. |
| `RUNNER_SUPPORTS_OAUTH_BROKER` | Public metadata | runner-host | Capability flag. |
| `RUNNER_SUPPORTS_INTEGRATION_LAB` | Public metadata | runner-host | Capability flag. |
| `RUNNER_NODE_ID` | Local metadata | runner-host | Stable runner id. |
| `RUNNER_HOST_GROUP_ID` | Local metadata | runner-host | Trusted placement boundary. |
| `RUNNER_AUTH_TOKEN` | Secret | runner-host | Must match the control-api token map. |
| `RUNNER_POLL_BASE_URL` | Local metadata | runner-host | Control API base URL. |
| `RUNNER_POLL_TIMEOUT_MS` | Public metadata | runner-host | Poll timeout. |
| `RUNNER_HEARTBEAT_INTERVAL_MS` | Public metadata | runner-host | Heartbeat cadence. |
| `RUNNER_HEARTBEAT_EXPIRY_MS` | Public metadata | runner-host | Expiry threshold. |
| `RUNNER_MAX_CONCURRENT_LEASES` | Public metadata | runner-host | Defaults to low concurrency. |
| `RUNNER_WORKSPACE_ROOT` | Local metadata | runner-host | Local workspace root. Do not commit personal paths. |
| `RUNNER_WORKTREE_ROOT` | Local metadata | runner-host | Local worktree root. Do not commit personal paths. |
| `RUNNER_ARTIFACT_ROOT` | Local metadata | runner-host | Local artifact root. Do not commit personal paths. |
| `RUNNER_PROVIDERS` | Public metadata | runner-host | `codex`, `claude`, or fake mode values. |
| `RUNNER_SUPPORTED_ROLES` | Public metadata | runner-host | Declared role capability. |
| `RUNNER_SUPPORTED_RUN_KINDS` | Public metadata | runner-host | Declared run-kind capability. |
| `RUNNER_SUPPORTED_REPO_KINDS` | Public metadata | runner-host | Declared repo-kind capability. |
| `RUNNER_TOOL_BASELINE` | Public metadata | runner-host | Declared tool surface. |
| `RUNNER_MCP_CONFIG_HASH` | Public metadata | runner-host | Deterministic MCP config marker. |
| `RUNNER_MCP_HOST_SERVERS` | Public metadata | runner-host | Host-scoped MCP names. |
| `RUNNER_MCP_REPO_SERVERS` | Public metadata | runner-host | Repo-scoped MCP names. |
| `RUNNER_MCP_EXCLUSIVE_SERVERS` | Public metadata | runner-host | Exclusive MCP names. |
| `RUNNER_MCP_COMMANDS_JSON` | Local metadata | runner-host | Local commands only; do not include credentials. |
| `RUNNER_SKILL_CACHE_ROOT` | Local metadata | runner-host | Managed skill cache path. |
| `RUNNER_SUPPORTS_INTERRUPT` | Public metadata | runner-host | Capability flag. |
| `RUNNER_SUPPORTS_CHECKPOINT_RESUME` | Public metadata | runner-host | Capability flag. |
| `RUNNER_SUPPORTS_ARTIFACT_UPLOAD` | Public metadata | runner-host | Capability flag. |
| `RUNNER_SUPPORTS_CONCURRENT_SESSIONS` | Public metadata | runner-host | Capability flag. |
| `CODEX_CLI_BIN` | Local metadata | runner-host | Local CLI executable name/path. |
| `CLAUDE_CLI_BIN` | Local metadata | runner-host | Local CLI executable name/path. |
| `CODEX_COMMAND` | Local metadata | runner-host | Optional local command wrapper. |
| `CLAUDE_CODE_COMMAND` | Local metadata | runner-host | Optional local command wrapper. |
| `LINEAR_API_TOKEN` | Optional secret | live Linear writeback | Leave empty unless using live Linear APIs. |
| `LINEAR_API_BASE_URL` | Public metadata | live Linear writeback | Defaults to Linear GraphQL API. |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Optional secret | GitHub API tasks | Prefer GitHub Apps or least-privilege tokens. |
| `TOOLING_POLICY_PATH` | Public metadata | validation | Path to tooling policy manifest. |
| `WORKFLOW_CONFIG_PUBLISHED_BY` | Public metadata | config publishing | Operator label, not a credential. |

## Local Placeholder Rules

Use placeholders in committed examples. Use real values only in:

- `.env.local` ignored by Git;
- shell exports;
- GitHub Actions secrets;
- deployment secret managers.

If a value can authenticate a request, sign a webhook, exchange a token, or access a private service, treat it as a secret.
