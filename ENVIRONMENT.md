# Environment And Secrets

## Purpose
This repository uses a small, explicit environment contract for the shipped Phase 3 control-plane platform and the shipped Phase 4 repository-registry / knowledge-context extension:
- immutable workflow-config validation and publish;
- transactional runtime-state, audit, artifact, and outbox writes;
- control-api inspection routes over physical read models;
- provider webhook ingress with durable raw-event persistence;
- inbox and outbox executor polling against Postgres-backed commands;
- repository-registry, knowledge-note snapshot, and deterministic context-pack assembly flows.

## Environment model
- Copy [.env.example](.env.example) into a local, untracked env file such as `.env.local`, or export the variables in your shell.
- `packages/config` is the canonical parser for runtime configuration.
- Missing required values fail fast at process start.
- `scripts/phase6-live.mjs` loads `.env.local` first and then `.env`. Real Phase 6 live-proof runs should use a prepared local env file instead of relying on transient shell state.

## Required variables for shipped Phase 1-3 code
- `NODE_ENV`: `development`, `test`, or `production`
- `APP_VERSION`: application version string
- `LOG_LEVEL`: `trace`, `debug`, `info`, `warn`, or `error`
- `CONTROL_API_HOST`: bind host for `control-api`
- `CONTROL_API_PORT`: bind port for `control-api`
- `INTERNAL_API_BEARER_TOKEN`: shared bearer secret required for all `/internal` routes except `/internal/healthz`
- `LINEAR_WEBHOOK_SECRET`: HMAC secret for Linear webhook signature verification
- `GITHUB_WEBHOOK_SECRET`: HMAC secret for GitHub `X-Hub-Signature-256` verification
- `WEBHOOK_REPLAY_WINDOW_MS`: max allowed skew between a Linear webhook timestamp and receipt time
- `WEBHOOK_MAX_PAYLOAD_BYTES`: maximum accepted webhook payload size for `control-api`
- `DATABASE_URL`: Postgres connection string
- `DB_POOL_MAX`: maximum Postgres pool size
- `TEMPORAL_SERVER_ADDRESS`: Temporal gRPC address, defaults to `127.0.0.1:7233`
- `TEMPORAL_NAMESPACE`: Temporal namespace, defaults to `default`
- `TEMPORAL_TASK_QUEUE`: Temporal task queue, defaults to `ai-dev-team`
- `WORKFLOW_INGRESS_BATCH_SIZE`: max inbox rows claimed per processor poll, defaults to `25`
- `WORKFLOW_INGRESS_POLL_INTERVAL_MS`: inbox poll interval, defaults to `1000`
- `WORKFLOW_INGRESS_MAX_ATTEMPTS`: dead-letter threshold for inbox processing failures, defaults to `5`
- `WORKFLOW_OUTBOX_BATCH_SIZE`: max outbox commands claimed per poll, defaults to `25`
- `WORKFLOW_OUTBOX_POLL_INTERVAL_MS`: poll interval for the outbox executor, defaults to `1000`
- `WORKFLOW_OUTBOX_MAX_ATTEMPTS`: dead-letter threshold for outbox commands, defaults to `5`
- `WORKFLOW_OUTBOX_PROCESSING_TIMEOUT_MS`: stale-processing reclaim timeout, defaults to `30000`
- `WORKFLOW_CONFIG_PUBLISHED_BY`: optional operator identity used by `db:publish-workflow-config`, defaults to `local-cli`

## Phase 4 shipped environment contract
These variables are now consumed by the Phase 4 implementation.

### Cloud-side services
- `CONTEXT_PACK_MAX_TOKENS`: maximum target size for the prompt-facing bundle after summaries and excerpt caps are applied.
- `CONTEXT_PACK_MAX_COMMENTS`: maximum number of recent relevant comments allowed in `latest_relevant_comments`.
- `CONTEXT_PACK_MAX_NOTES`: maximum number of note snapshots allowed in `docs_pack`.

### Trusted local knowledge-sync process
- `KNOWLEDGE_SYNC_VAULT_ROOT`: absolute filesystem path to the trusted local Obsidian vault root. Cloud services must not require or read this variable.
- `KNOWLEDGE_SYNC_BATCH_SIZE`: maximum number of notes processed in one local sync batch.
- `KNOWLEDGE_SNAPSHOT_MAX_NOTE_BYTES`: maximum note payload size read from the vault before sanitization and summarization.

### Contract notes
- `knowledge-sync` is a non-public local entrypoint, not an HTTP route.
- Cloud-side orchestration reads only `knowledge_note_snapshots` and `context_pack_cache` from Postgres.
- Context-pack invalidation is fingerprint-only. There is no TTL-based cache invalidation surface in the shipped runtime contract.
- Model-facing bundles remain summary-first; raw webhook payloads, full comment logs, and secrets remain out of the prompt bundle.

## IntegrationAgent and Secrets/Auth plane contract
This repository now reserves explicit configuration surface for the future `Secrets/Auth plane`, while keeping the first implementation as control-plane modules inside existing services rather than new deployables.

### Control-api integration settings
- `VENDOR_DOCS_ALLOWLIST`: comma-separated allowlist of vendor documentation domains.
- `SECRET_SERVICE_BACKEND`: current expected backend identifier; MVP default is `gcp_secret_manager`.
- `GCP_SECRET_MANAGER_PROJECT_ID`: optional GCP project for the future Secret Manager-backed secret plane.
- `SECRET_SERVICE_DEFAULT_PREFIX`: default alias prefix used when secret slots are provisioned.
- `OAUTH_PUBLIC_CALLBACK_BASE_URL`: canonical base URL for OAuth callback registration and broker handoff.
- `OAUTH_REDIRECT_PATH_PREFIX`: default path prefix used when composing redirect URIs.
- `OAUTH_ENFORCE_PKCE`: boolean guard that defaults Authorization Code onboarding to PKCE-safe flows.
- `INTEGRATION_LAB_ENABLED`: enables the future integration-lab execution surface.
- `INTEGRATION_LAB_MAX_PROBE_REQUESTS`: hard ceiling for metadata-only validation probes.
- `INTEGRATION_LAB_ALLOWED_SANDBOX_DOMAINS`: comma-separated sandbox/API domain allowlist for future integration probes.

### Runner capability settings
- `RUNNER_NETWORK_MODES_SUPPORTED`
- `RUNNER_ALLOWED_DOC_DOMAINS`
- `RUNNER_ALLOWED_SANDBOX_DOMAINS`
- `RUNNER_SUPPORTS_BROWSER_CONSENT`
- `RUNNER_SUPPORTS_SECRET_BROKER`
- `RUNNER_SUPPORTS_OAUTH_BROKER`
- `RUNNER_SUPPORTS_INTEGRATION_LAB`

Allowed `RUNNER_NETWORK_MODES_SUPPORTED` values:
- `docs_allowlist`: allowlisted vendor-doc fetch only.
- `sandbox_api_allowlist`: allowlisted sandbox/API execution only.
- `release_broker_only`: production-credential operations must stay behind the broker boundary with no direct live vendor access from the runner.

### Reserved broker topology notes
- The current foundation pass keeps `secret-service`, `oauth-service`, and `integration-lab` as logical modules inside existing services, so no broker base-URL env vars are parsed yet.
- If those modules are externalized later, reserve a separate auth surface for each broker instead of reusing `INTERNAL_API_BEARER_TOKEN`:
  - `SECRET_BROKER_BASE_URL`
  - `SECRET_BROKER_AUDIENCE`
  - `OAUTH_BROKER_BASE_URL`
  - `OAUTH_BROKER_AUDIENCE`
  - `INTEGRATION_LAB_BASE_URL`
  - `INTEGRATION_LAB_AUDIENCE`
- Reserved broker env names must remain documented as future wiring until the code actually parses them. Do not claim them as active runtime requirements before that change lands.

### Storage split invariants
- Raw secret values, authorization codes, access tokens, and refresh tokens must not be written to:
  - Postgres metadata tables
  - Obsidian notes
  - repo-local docs
  - `artifact_registry`
  - prompt/context bundles
- Postgres may store only:
  - secret aliases
  - provider/environment bindings
  - requested/granted scopes
  - consent state
  - callback timing
  - validation status
  - rotation/revoke metadata
  - webhook registration metadata
- Public OAuth callback handling must persist only sanitized callback facts, not raw authorization codes.

## Phase 5 workflow runtime contract
Phase 5 reuses the existing Temporal environment contract for worker-side workflow execution. It does not introduce separate runner-specific settings or a duplicate Temporal address surface.
The minimum observability foundation for Phase 5 is DB-backed. `INTERNAL_API_BEARER_TOKEN` remains required for the internal route surface and now also protects the Phase 5 lifecycle operator and inspection routes in `apps/control-api`.

### Temporal connection contract
- `TEMPORAL_SERVER_ADDRESS`, `TEMPORAL_NAMESPACE`, and `TEMPORAL_TASK_QUEUE` remain the canonical Temporal connection settings.
- These variables are consumed by `apps/workflow-worker` for workflow/activity execution.
- `apps/control-api` no longer requires a Temporal client at startup for the baseline Phase 5 inspection surface; webhook ingress and DB-backed lifecycle inspection must stay available during Temporal outages.

### Process topology for Phase 5 verification
The minimum long-lived processes for a realistic Phase 5 smoke path are:
- Postgres
- Temporal dev server
- `apps/control-api`
- `apps/workflow-worker`
- outbox executor loop

Notes:
- `dev:inbox-processor` remains a debug entrypoint. The production-oriented Phase 5 path should be exercisable through the main worker process and its registered workflow set.
- Workflow lifecycle correctness must not depend on real runner processes; runner-specific environment variables remain deferred to Phase 6.

### Write-side boundary rules
- `apps/control-api` still must not mutate runtime tables directly.
- Webhook ack success must not depend on Temporal availability.
- `POST /internal/issues/:issueId/lifecycle-commands` derives its own canonical source server-side (`operator_api` for `ingestSystemCommand`, `system_timer` for `ingestTimerFired`) and rejects caller attempts to spoof workflow-internal source values.
- Lifecycle command dispatch into Temporal may happen only after durable inbox persistence/normalization or through an explicit internal/operator command surface.
- The minimum lifecycle inspection surfaces (`/internal/issues/:issueId/lifecycle-snapshot`, `/internal/issues/:issueId/journey`, `/internal/metrics/system-health`, `/internal/metrics/stuck-issues`) must be readable from persisted truth alone.
- All `/internal` routes except `/internal/healthz` require `Authorization: Bearer <INTERNAL_API_BEARER_TOKEN>`.

## Secrets contract
- Do not commit real credentials or environment-specific URLs to the repository.
- Local development secrets live only in shell exports or untracked env files.
- Shared environments must supply secrets through the deployment platform's secret manager.
- The only true secret in the local stack is the database credential embedded in `DATABASE_URL`.
- `LINEAR_WEBHOOK_SECRET` and `GITHUB_WEBHOOK_SECRET` are also secrets and must come from an untracked env file or a deployment secret manager.
- `WORKFLOW_CONFIG_PUBLISHED_BY` is operational metadata, not a secret.
- Integration-specific additions:
  - GitHub environment secrets remain a delivery mechanism, not the canonical onboarding truth for external integrations.
  - `credential_slots`, OAuth registrations/sessions, token handles, and webhook registrations are metadata-only truth; secret material must remain behind the external secret manager/broker boundary.
  - User passwords and raw API keys must never be requested or pasted into Linear comments.

## Local infrastructure bootstrap
The repository includes [compose.yaml](compose.yaml) for the minimum local dependencies:
- `postgres` on `127.0.0.1:5432`
- `temporal` development server on `127.0.0.1:7233`
- Temporal Web UI on `http://127.0.0.1:8233`

Commands:
- `corepack pnpm infra:up`
- `corepack pnpm db:migrate`
- `corepack pnpm db:validate-workflow-config`
- `corepack pnpm db:publish-workflow-config`
- `corepack pnpm dev:control-api`
- `corepack pnpm dev:knowledge-sync`
- `corepack pnpm dev:workflow-worker`
- `corepack pnpm dev:inbox-processor`
- `corepack pnpm dev:outbox-executor`
- `corepack pnpm test:integration`
- `corepack pnpm infra:down`

## Notes
- The Temporal container uses the official dev-server command `temporal server start-dev` via Docker.
- `apps/control-api` exposes read-only inspection routes plus Phase 3 webhook ingress:
  - `GET /internal/workflow-config/active`
  - `GET /internal/issues/:issueId/runtime-state`
  - `GET /internal/issues/:issueId/status-projection`
  - `GET /internal/issues/:issueId/blocked-projection`
  - `POST /internal/issues/:issueId/lifecycle-commands`
  - `GET /internal/issues/:issueId/lifecycle-snapshot`
  - `GET /internal/issues/:issueId/journey`
  - `GET /internal/metrics/system-health`
  - `GET /internal/metrics/stuck-issues`
  - `GET /internal/metrics/daily?date=YYYY-MM-DD`
  - `GET /internal/repositories/:repoSlug`
  - `GET /internal/projects/:projectId/repository-mapping`
  - `GET /internal/issues/:issueId/context-pack`
  - `GET /internal/issues/:issueId/integrations/summary`
  - `GET /internal/issues/:issueId/integrations/credential-slots`
  - `GET /internal/issues/:issueId/integrations/oauth-registrations`
  - `GET /internal/issues/:issueId/integrations/oauth-consents`
  - `GET /internal/issues/:issueId/integrations/token-handles`
  - `GET /internal/issues/:issueId/integrations/webhooks`
  - `GET /internal/issues/:issueId/integrations/validation-runs`
- `POST /webhooks/linear`
- `POST /webhooks/github`
- `GET /oauth/callback/:providerName`
- `apps/workflow-worker` now runs the Temporal worker and the inbox processor in the same long-lived process; `dev:inbox-processor` remains available as an isolated debug entrypoint.
- `apps/workflow-worker` now also runs a lifecycle-command dispatch loop that claims `lifecycle_command_inbox` rows and delivers them to `IssueLifecycleWorkflow` via Temporal `signalWithStart`.
- `apps/workflow-worker` now also persists `linear_issue_contract_snapshots` from persisted Linear `Issue` inbox rows while keeping context assembly outside workflow definition code.
- Linear replay-window enforcement is based on the persisted `webhookTimestamp` compared with ingress receipt time; GitHub replay protection relies on delivery-id dedupe because GitHub does not provide an equivalent webhook timestamp.
- The local stack is for development and verification only, not for production.
- `knowledge-sync` remains local and non-public even after Phase 4 ships; there is intentionally no HTTP trigger for it.
- Phase 5 should not add new environment variables unless a concrete workflow-runtime need cannot be expressed with the existing Temporal/config surface. If new workflow-only knobs are introduced later, document them here separately from future Phase 6 runner settings.

## Phase 6 runner runtime contract
Phase 6 adds runner-specific settings and process topology on top of the existing Temporal/control-plane contract. The cloud side still owns orchestration truth; trusted runner hosts own only local execution, provider session handling and shared MCP lifecycle.

### Runner transport and auth contract
- The canonical first transport is authenticated HTTPS long-poll from runner hosts to the control plane.
- Each runner host has a stable `RUNNER_NODE_ID` and a secret `RUNNER_AUTH_TOKEN`.
- Runner auth is distinct from `INTERNAL_API_BEARER_TOKEN`; internal operator auth and runner auth must not share the same credential.
- Runner transport must remain outbound from the trusted machine; the control plane does not initiate shell sessions into runner hosts.
- Provider order is role-scoped and pinned by workflow `config_version`; published `role_execution_policies.yaml` is keyed by `owner_role` and carries `primary_provider`, `secondary_provider`, `fallback_triggers`, `max_provider_failovers`, `mcp_profile_ref`, and `required_capabilities`.
- Runner-side environment may advertise capabilities but may not override the control-plane provider order.
- Automatic cross-provider failover is allowed only for `quota_exhausted`, `rate_limited_exhausted`, `auth_unavailable`, `provider_unhealthy`, and `no_eligible_runner`; transient transport or worker failures retry within the same provider budget first.
- The control plane keeps the runner-host credential map in a dedicated environment variable:
  - `RUNNER_AUTH_TOKENS_JSON`: JSON object mapping `RUNNER_NODE_ID -> RUNNER_AUTH_TOKEN`.
- Long-poll hold time is controlled by:
  - `RUNNER_LONG_POLL_MAX_WAIT_MS`

### Required Phase 6 environment variables
- Control-plane side:
  - `RUNNER_AUTH_TOKENS_JSON`
  - `RUNNER_LONG_POLL_MAX_WAIT_MS`
- `RUNNER_NODE_ID`
- `RUNNER_HOST_GROUP_ID`
- `RUNNER_AUTH_TOKEN`
- `RUNNER_POLL_BASE_URL`
- `RUNNER_POLL_TIMEOUT_MS`
- `RUNNER_HEARTBEAT_INTERVAL_MS`
- `RUNNER_HEARTBEAT_EXPIRY_MS`
- `RUNNER_MAX_CONCURRENT_LEASES`
- `RUNNER_WORKSPACE_ROOT`
- `RUNNER_WORKTREE_ROOT`
- `RUNNER_ARTIFACT_ROOT`
- `RUNNER_PROVIDERS` (comma-separated subset of `codex,claude`; optional when runner-host config already supplies provider defaults)
- `RUNNER_MCP_CONFIG_HASH`
- `RUNNER_MCP_HOST_SERVERS` (comma-separated host-scoped servers)
- `RUNNER_MCP_REPO_SERVERS` (comma-separated repo-scoped servers)
- `RUNNER_MCP_EXCLUSIVE_SERVERS` (comma-separated exclusive servers)
- `RUNNER_MCP_COMMANDS_JSON` (JSON object mapping `serverName -> shell command`; backing commands are required for any server that is advertised)
- `RUNNER_SKILLS_AVAILABLE` (optional fake-mode fixture list; in real mode it is not the source of managed runner skill truth)
- `RUNNER_SKILL_CACHE_ROOT` (optional managed skill cache root; defaults to `${RUNNER_WORKSPACE_ROOT}/.runner-managed-skills`)
- `CODEX_CLI_BIN` (optional probe override for the Codex adapter binary; the live harness still verifies the effective command is available when this is omitted)
- `CLAUDE_CLI_BIN` (optional probe override for the Claude adapter binary; the live harness still verifies the effective command is available when this is omitted)
- `CODEX_COMMAND` (optional shell command for Codex-backed runners; typically a repo-owned adapter such as `node dist/codex-adapter.js`)
- `CLAUDE_CODE_COMMAND` (optional shell command for Claude-backed runners; typically a repo-owned adapter such as `node dist/claude-adapter.js`)
- `CODEX_HOME` (optional host-level Codex auth source root; execution still gets an isolated per-attempt `CODEX_HOME`, and managed skills are mounted there from the pinned synced bundle rather than discovered from `$CODEX_HOME/skills`)
- Optional live-proof overrides:
  - `PHASE6_LIVE_CODEX_WORKSPACE_ROOT`
  - `PHASE6_LIVE_CODEX_WORKTREE_ROOT`
  - `PHASE6_LIVE_CODEX_ARTIFACT_ROOT`
  - `PHASE6_LIVE_CLAUDE_RUNNER_NODE_ID`
  - `PHASE6_LIVE_CLAUDE_RUNNER_AUTH_TOKEN`
  - `PHASE6_LIVE_CLAUDE_RUNNER_HOST_GROUP_ID` (defaults to `<RUNNER_HOST_GROUP_ID>-review`)
  - `PHASE6_LIVE_CLAUDE_WORKSPACE_ROOT`
  - `PHASE6_LIVE_CLAUDE_WORKTREE_ROOT`
  - `PHASE6_LIVE_CLAUDE_ARTIFACT_ROOT`
- Optional fake-mode overrides:
  - `RUNNER_FAKE_AGENT_LIBRARY_RELEASE_ID`
  - `RUNNER_FAKE_AGENT_LIBRARY_FINGERPRINT`

Live-proof contract notes:
- `scripts/phase6-live.mjs` requires an effective provider command for each real provider via `CODEX_COMMAND` or `CODEX_CLI_BIN`, and via `CLAUDE_CODE_COMMAND` or `CLAUDE_CLI_BIN`.
- If `CODEX_COMMAND` or `CLAUDE_CODE_COMMAND` points at the repo-owned adapter wrapper, the matching `*_CLI_BIN` must still be present for the underlying provider CLI probe.
- When the host-specific live-proof root overrides are omitted, the harness derives deterministic `codex/` and `claude/` child roots under `RUNNER_WORKSPACE_ROOT`, `RUNNER_WORKTREE_ROOT`, and `RUNNER_ARTIFACT_ROOT`.
- The live harness fails fast if the effective Codex and Claude workspace/worktree/artifact roots collapse to the same path.

### Process topology for Phase 6 verification
The minimum long-lived processes for a realistic Phase 6 smoke path are:
- Postgres
- Temporal dev server
- `apps/control-api`
- `apps/workflow-worker`
- outbox executor loop
- one Codex-capable `apps/runner-host`
- one Claude-capable `apps/runner-host`
- optional local smoke helpers:
- `corepack pnpm dev:fake-runner`
- `corepack pnpm dev:fake-mcp`
- `corepack pnpm test:phase6`
- `corepack pnpm test:phase6:live`
- `test:phase6:live` starts compiled `control-api`, `workflow-worker`, `outbox-executor`, one Codex runner host, and one Claude runner host, then proves build and review execution across distinct host groups.

### Host grouping semantics
- `RUNNER_HOST_GROUP_ID` is a trust and placement boundary, not cosmetic metadata.
- Hosts in the same group are expected to share the same auth issuance rules, MCP/process-topology policy and compatible local execution posture.
- Shared MCP bindings must never be reused across different host groups.
- Any re-route from one host group to another must be recorded as a new durable provider attempt instead of looking like in-place continuation of the prior host-local execution session.

### Runner boundary notes
- Runner hosts publish capability manifests at startup and whenever capability-relevant state changes.
- Runner hosts must expose distinct `workspace` and `worktree` roots; execution must not mutate the control-plane repository checkout.
- Runner hosts must also expose a distinct `artifact` root used for durable patch/test/output bundle staging before upload/report.
- Lease acquisition, heartbeat, completion, failure and cancellation acknowledgement all require durable server-side confirmation.
- A granted logical lease must not be presented as a successful execution before a durable execution-start or execution-complete report exists.
- Every runner host must run one host-level MCP pool manager.
- MCP bindings are shared according to explicit manifest `sharingScope` values:
  - `host`
  - `repo`
  - `exclusive`
- Default sharing contract is:
  - `serena=repo`
  - `obsidian=host`
  - `context7=host`
  - any server without proven multiplex safety = `exclusive`
- Deterministic reuse keys are derived from `(server_name, sharing_scope, repo_slug-or-null, config_hash)`.
- The runner manifest must only advertise providers that have a real local adapter command and MCP servers that have a real backing command in `RUNNER_MCP_COMMANDS_JSON`.
- Repo-owned adapter and MCP commands that use `node dist/...` are normalized against `apps/runner-host`, so the same env contract works whether the runner host is started from the repo root or the package directory.
- Provider adapters and delegated sub-agents must reuse MCP bindings issued for the current `execution_session_key` instead of spawning new MCP processes by default.
- `execution_session_key` is attempt-scoped and names the binding set reused by the primary agent and delegated sub-agents for that attempt.
- Automatic cross-provider failover is `checkpoint_only`: after `execution_started`, a cross-provider retry requires a durable checkpoint and `supportsCheckpointResume = true`.
- Managed runner skills are synced from the active published `agent_library_release` through authenticated control-plane endpoints before the first manifest publish in `RUNNER_RUNTIME_MODE=real`.
- Real-mode managed install truth lives under `RUNNER_SKILL_CACHE_ROOT` as immutable `releases/<releaseId>` bundles plus transient `staging/` directories used for verified install/promote.
- `runner-host` publishes `skillsAvailable` in real mode from the active synced managed bundle only. It no longer derives managed availability from local user-level agent skill directories or from `RUNNER_SKILLS_AVAILABLE`.
- `RUNNER_SKILLS_AVAILABLE` remains env-driven only in `RUNNER_RUNTIME_MODE=fake`, where deterministic harnesses may advertise fixture skills without a synced managed bundle.
- Real-mode manifest truth also exposes `activeAgentLibraryReleaseId`, `activeAgentLibraryFingerprint`, `skillSyncStatus`, `skillSyncError`, and `installedSkillBundles[]`.
- On integrity mismatch, provider incompatibility, or incomplete install, runner-host degrades instead of advertising synthetic availability: `skillSyncStatus=degraded`, `activeAgentLibraryReleaseId=null`, and managed `skillsAvailable=[]`.
- Control-plane routing and lease eligibility now use the lease's pinned `agent_library_release_id` plus the runner's persisted `installed_skill_bundles`; hosts missing the exact pinned release bundle or the required `agent_skill_packs.skill_refs` inside that bundle must not claim the lease.
- Every successful provider attempt snapshots `installed_skill_refs`, `resolved_skill_refs`, and `skipped_optional_skill_refs` in `runner_lease_attempts` so audit views do not drift after host inventory changes.
- The canonical routing manifest filename is `routing-skill-pack-map.yaml`.
- Codex execution mounts the pinned managed bundle into an isolated per-attempt `CODEX_HOME/skills`; Claude execution stages the same pinned bundle under `providerStageRoot/managed-skills`.

### Phase 6 runner-host protocol surface
The first production-ready runner-host protocol is exposed by `apps/control-api` as a dedicated authenticated surface, separate from `/internal` operator routes.

Expected endpoints:
- `PUT /runner-host/manifests/current`
- `POST /runner-host/leases:claim-next`
- `GET /runner-host/skill-sync/active-release`
- `GET /runner-host/skill-sync/releases/:releaseId`
- `POST /runner-host/attempts/:leaseAttemptId/execution-started`
- `POST /runner-host/attempts/:leaseAttemptId/heartbeat`
- `POST /runner-host/attempts/:leaseAttemptId/artifacts`
- `POST /runner-host/attempts/:leaseAttemptId/completed`
- `POST /runner-host/attempts/:leaseAttemptId/failed`
- `POST /runner-host/attempts/:leaseAttemptId/cancel`

Contract notes:
- These endpoints are thin protocol adapters over persisted runner/lease truth. They must not redefine lifecycle business status semantics inline.
- All runner-host requests use `Authorization: Bearer <RUNNER_AUTH_TOKEN>`.
- `/internal/**` routes continue using `INTERNAL_API_BEARER_TOKEN`; the two auth domains must remain separate.
- `packages/shared` owns the versioned request/response payload contracts for these routes. The current shared DTO surface covers manifest publish, claim-next, execution-started, heartbeat, completion, failure, cancel and the operator inspection views used for Phase 6 closure.
- Manifest publish is idempotent by `runnerNodeId + manifestVersion`.
- Execution-started is idempotent by `leaseAttemptId + executionSessionKey`.
- Completed, failed and cancel-ack outcomes are terminal and duplicate-safe by `leaseAttemptId`.
- Cancel acknowledgement must durably resolve to one of `accepted`, `already_terminal`, or `unsupported`.

### Protocol field ownership
- `mcp_profile_ref` comes from published `role_execution_policies.yaml` truth pinned by `config_version`.
- `toolBaseline` and MCP `reusePolicy` come from the active runner capability manifest for the claiming runner node.
- `mcp_bindings_summary` comes from runtime-observed host-level MCP pool allocations for the current attempt and must be echoed by execution-start, terminal result and cancel-ack payloads rather than guessed from config alone.
- `mcpPoolSnapshot` is the operator-visible heartbeat snapshot of the current host-level MCP pool state.
- Runner hosts emit an initial heartbeat snapshot immediately after `execution_started` and then continue on the configured heartbeat interval so short-lived attempts still persist operator-visible MCP pool truth.
- `/internal/runners/mcp-pool` and `/internal/runners/leases/:leaseId` are the operator inspection surfaces for current MCP bindings and lease timeline truth.

### Artifact delivery contract
- Runner hosts may stage artifacts locally under `RUNNER_ARTIFACT_ROOT`, but terminal protocol completion is valid only after any large payloads are durably uploaded and referenced by stable artifact/blob URIs.
- Small metadata may be carried inline, but patch blobs, logs, screenshots and large test outputs must be referenced rather than embedded into workflow history.
- Duplicate completion delivery must resolve to the same durable artifact-bundle record for the same `leaseAttemptId`.

### Secrets contract additions for Phase 6
- `RUNNER_AUTH_TOKEN` is a true secret and must come from an untracked env file or secret manager.
- Provider session credentials remain local to the trusted runner machine and must not be copied into the cloud-side control plane.
- Artifact storage credentials, if introduced, must also be isolated from operator and webhook secrets.
- MCP server credentials or local auth material on the runner host must remain local to the trusted host and must not be serialized into capability manifests, artifact bundles or prompt/context payloads.

## Phase 7 first end-to-end build/review contract
Phase 7 reuses the Phase 4 context-pack contract, the Phase 5 lifecycle authority and the Phase 6 runner/runtime contract. It should not introduce broad new infrastructure settings unless the requirement cannot be expressed through the existing surfaces.

### Required Phase 7 additions
- `LINEAR_API_TOKEN`: bearer token used by the outbox/state-sync path to publish review summaries and decision handoff comments back to Linear.
- `LINEAR_API_BASE_URL`: optional override for the Linear API base URL; defaults to the production Linear API host when omitted.

### Required environmental preconditions
- The canonical reference repo must already exist in `repository_registry` with a deterministic `repo_slug`, default branch, root note and trusted-host checkout path.
- For the first live Phase 7 proof, the canonical reference repo is fixed to `repo_slug = test_repo` with a trusted checkout supplied by `PHASE7_TEST_REPO_PATH`, defaulting to `/tmp/ai-dev-team/reference_repos/test_repo`.
- The canonical Phase 7 reference repo must be created and registered through `node scripts/bootstrap-phase7-test-repo.mjs`; live proofs must not depend on a manually prepared checkout or ad hoc DB inserts.
- The smoke-path issue must resolve to that repo through explicit issue-contract assignment or project mapping; Phase 7 must not rely on operator memory to decide which repo is being built.
- The default deterministic mapping for the first proof is `project_repository_mappings -> test_repo`; smoke issues should not rely on ad-hoc operator overrides.
- The primary root note and required linked notes for that repo must have fresh Postgres-backed snapshots before the build/review cycle starts.
- Outbox/state-sync workers that publish to Linear must run with the same post-commit semantics as the rest of the workflow-effect path; no inline Linear write-back is allowed from the request edge or from provider runtimes.

### Contract notes
- Phase 7 must freeze one `contextPackFingerprint` for a build/review cycle. Later comment or note changes must not silently change the already-issued build or review task.
- Phase 7 does not require GitHub App auth, PR creation or check-sync env vars. If those are introduced, they belong to the explicit Phase 8 contract instead of being smuggled into Phase 7.
- If runner hosts need to fetch frozen context or build-artifact references over HTTP, those reads must stay behind the existing authenticated runner/internal surfaces and must never expose direct filesystem vault paths.

### Secrets contract additions for Phase 7
- `LINEAR_API_TOKEN` is a true secret and must come from an untracked env file or secret manager.
- Local live proofs may use the repo-owned Linear stub started by `test:phase7:live`, but the outbox path remains fail-closed: the command must error if no Linear token/base URL is configured for the running worker process.
- Review summaries, findings and artifact links published back to Linear must remain summary-first and must not embed raw secrets, raw webhook payloads, raw diff blobs or full logs.
