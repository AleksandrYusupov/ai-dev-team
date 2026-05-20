# AI Dev Team Control Plane Plan

## Current phase
- Repository has shipped the Phase 4 repository-registry and deterministic knowledge/context foundation from `ai_dev_team/architecture/05_full_system_implementation_plan`.
- Current shipped state now includes Phase 1-3 persistence, config publish, event ingress, Phase 4 repository-registry/context-pack assembly, and the contracted Phase 5 lifecycle orchestration surface.
- Repository also already ships the first Phase 6 scaffold layer:
  - `config/workflow/role_execution_policies.yaml`
  - shared runner/task/artifact/metadata DTOs in `packages/shared`
  - runner schema, migrations, and DB helpers in `packages/db`
  - runner inventory / lease / failover / MCP-pool inspection reads in `apps/control-api`
- Repository now also ships the first executable Phase 6 runtime slice:
  - dedicated `/runner-host/*` authenticated write surface plus internal operator cancel route in `apps/control-api`;
  - durable cancel bookkeeping and Postgres-backed runner artifact blob staging in `packages/db`;
  - `apps/runner-host` with Codex/Claude/fake provider adapters, repo-owned adapter entrypoints, host-level MCP pooling, deterministic worktree handling, and smoke harnesses;
  - root command surface for `dev:runner-host:codex`, `dev:runner-host:claude`, `dev:fake-runner`, `dev:fake-mcp`, `test:phase6`, and `test:phase6:live`.
- Goal for the current state: keep the persistence truth, config publish path, ingress pipeline, repository registry, deterministic context-pack contract, and Phase 5 lifecycle orchestration stable while later phases add runner, GitHub, and release automation on top.
- Phase 6 acceptance is split honestly between two required gates:
  - deterministic `test:phase6`, which now includes the `@ai-dev-team/runner-host test:phase6` slice as part of the root gate;
- live `test:phase6:live`, which loads `.env.local` first, then `.env`, and proves a Codex build path plus a Claude review path on distinct `host_group_id` values with distinct workspace/worktree/artifact roots, terminal review completion, and durable runner artifacts/metadata.
- Repository should now be treated as `Phase 6 closed / Phase 7 planning in progress`, not as Phase 7-ready execution truth.
- Phase 7 is not ready until the repo gains an explicit review runtime path, frozen context consumption during provider execution, fail-closed Linear write-back, one canonical reference repo, and dedicated deterministic plus live Phase 7 verification.
- Canonical Phase 5 contract and audit trail live in the Obsidian vault:
  - `ai_dev_team/architecture/07_phase_5_issue_lifecycle_workflow_spec`
  - `ai_dev_team/implementation/08_phase_5_readiness_and_execution_contract`

## IntegrationAgent foundation update
- The control plane now explicitly models `IntegrationAgent` as an internal orchestration role, not as a new visible Linear actor.
- A new `Secrets/Auth plane` is now part of the documented and coded system contract:
  - raw secret or token material remains outside Postgres and outside repo docs;
  - Postgres stores only aliases, scope metadata, consent state, callback state, webhook registration state, validation results, and audit-safe summaries;
  - sanitized integration artifacts flow through `artifact_registry` and context packs, while auth truth lives in dedicated metadata tables.
- The current foundation pass ships:
  - shared DTOs/enums for integration kinds, auth schemes, slot/session/token/webhook state, and runner capability manifests;
  - Postgres schema/migrations for `credential_slots`, `oauth_client_registrations`, `oauth_consent_sessions`, `token_handles`, `webhook_registrations`, and `integration_validation_runs`;
  - control-api inspection routes for integration state plus a public OAuth callback route that persists sanitized callback status only;
  - context-pack support for `integration_brief`, `auth_decision_record`, `webhook_contract`, and `integration_go_live_checklist` references from `artifact_registry`.
- This pass does not yet ship a live secret broker, real OAuth token exchange, or vendor sandbox execution. Those remain future implementation work on top of the new contracts.
- Production credential use is still out of scope for the shipped foundation and must remain behind an explicit `prod-access:approved` gate plus human rollback ownership.

## Shipped scope through Phase 3
- `packages/db` owns the Postgres schema, migrations, seed loading, and config publish transaction.
- `packages/db` also owns `raw_event_inbox`, `comment_log`, delivery dedupe helpers, inbox claim/fail/complete helpers, and comment-log upsert semantics.
- `apps/workflow-worker` owns transition-validation services, run lifecycle rules, audit writes, outbox writes, projection maintenance, and the Phase 3 inbox processor that normalizes persisted provider deliveries.
- `apps/control-api` owns the provider edge: webhook routes, raw-body capture, signature verification, delivery extraction, and durable handoff into `raw_event_inbox`. It still does not own workflow config publishing or transition persistence.
- `packages/shared` owns cross-package literal unions and DTOs, including the canonical ingress-envelope contract, but the source of truth for workflow rules remains the versioned YAML under `config/workflow/`.
- `compose.yaml` remains the minimum local Postgres + Temporal bootstrap required to validate the Phase 2 data layer locally.
- Root scripts expose the operational entrypoints:
  - `db:validate-workflow-config`
  - `db:publish-workflow-config`
  - `dev:knowledge-sync`
  - `dev:inbox-processor`
  - `dev:outbox-executor`
  - `test:integration`

## Shipped Phase 4 surface
- `packages/shared` now owns the shipped Phase 4 DTOs for repository-registry rows, issue-contract snapshots, knowledge-note snapshots, context packs, source traces, and deterministic Phase 4 error codes.
- `packages/config` now parses the shipped Phase 4 knowledge budgets for `control-api` and the trusted-local `knowledge-sync` runtime contract.
- `packages/db` now owns the shipped Phase 4 schema and helpers for:
  - `repository_registry`
  - `project_repository_mappings`
  - `linear_issue_contract_snapshots`
  - `knowledge_note_snapshots`
  - `context_pack_cache`
- `apps/workflow-worker` now persists normalized `linear_issue_contract_snapshots` from persisted Linear `Issue` events as part of the inbox transaction, while still keeping context assembly out of workflow definitions.
- `apps/control-api` now owns:
  - the Phase 4 knowledge/context module;
  - deterministic context-pack assembly and immutable cache writes;
  - internal inspection routes for repositories, project mappings, and context packs;
  - the trusted-local `knowledge-sync` entrypoint that snapshots Obsidian notes into Postgres.

## Constraints
- Runtime-critical guidance must live in the repo, not only in Obsidian.
- Transition logic, audit schema and outbox semantics are defined in Obsidian architecture notes and must remain the source constraints for later phases.
- The existing monorepo shape remains the default; Phase 4 must not introduce a new package or deployable unless an implementation obstacle proves the current split insufficient.
- Phase 3 keeps `linear-ingest` and `github-ingest` inside `apps/control-api` route plugins; do not split them into new deployables without a concrete ownership/traffic reason.
- Phase 6 runner-host truth comes from `RUNNER_MCP_COMMANDS_JSON`, the repo-owned adapter commands, and the effective command checks performed by the live harness; `CODEX_CLI_BIN` and `CLAUDE_CLI_BIN` are optional probe overrides, not unconditional requirements.
- `status_projection` and `blocked_issues_projection` are physical Postgres tables maintained by write-side code, not SQL views or materialized views.
- Issue-scoped transition transactions use explicit row locking and `REPEATABLE READ`; config publish uses an advisory lock plus `SERIALIZABLE` retry semantics.
- Rollback for workflow config is publish-forward: never mutate or delete published rows, publish a new higher `config_version` instead.
- Environment and secrets handling are documented in `ENVIRONMENT.md` and enforced by `packages/config`.
- `raw_event_inbox` is the only durability boundary for external webhook deliveries; HTTP handlers must not mutate runtime state or signal Temporal inline.
- The inbox processor may normalize and persist canonical envelopes in Phase 3, but broad downstream orchestration side effects remain deferred until later phases add explicit consumers.

## Delivered Phase 3 surface
1. `packages/db` contains the full Phase 2 schema, manifest loader/validator, publish transaction, and runtime read helpers.
2. `config/workflow/` contains the immutable YAML manifests for config sets, statuses, triggers, reasons, rules, and entry hooks.
3. `apps/control-api` now also exposes `/webhooks/linear` and `/webhooks/github`, preserves raw bodies for HMAC verification, and durably persists supported provider deliveries.
4. `packages/db` now stores replayable ingress rows in `raw_event_inbox` and normalized Linear comment history in `comment_log`.
5. `apps/workflow-worker` now contains a background inbox processor that normalizes supported Linear and GitHub event families into canonical envelopes and writes `comment_log` transactionally.
6. `.github/workflows/ci.yml` still runs the verification path, and local integration scripts now execute DB-backed integration files serially to avoid false deadlocks against the shared test database.

## Operational rules
1. Validate manifests before publish and publish before exercising worker transition paths in a fresh environment.
2. Treat `workflow_config_sets` as immutable; rollback is publish-forward only.
3. `control-api` owns only provider-edge ingest writes into `raw_event_inbox`; it must not directly mutate `issue_runtime_state` or signal workflows.
4. Treat `status_projection` and `blocked_issues_projection` as transactional read models owned by write-side code, not views.
5. Treat `raw_event_inbox` rows as replayable source records: delivery dedupe happens on `(provider, delivery_id)`, normalization happens in `apps/workflow-worker`, and redrive must never require a new HTTP delivery.
6. Treat Phase 4 context packs as immutable bundles keyed by input fingerprint; any effective input change must produce a new cache row rather than mutating an existing bundle in place.
7. Keep the prompt-facing context compact and deterministic: issue contract, decision summary, latest relevant comments, bounded docs excerpts, repo guidance, budgets, and source trace only.

## Phase 4 shipped contract
- Canonical Phase 4 roadmap and defaults live in:
  - `ai_dev_team/architecture/05_full_system_implementation_plan`
  - `ai_dev_team/architecture/06_repository_registry_and_context_pack_spec`
  - `ai_dev_team/implementation/06_phase_4_readiness_and_execution_contract`
- Phase 4 does not introduce a new deployable service. The shipped knowledge-service surface lives as a module inside `apps/control-api`.
- `packages/db` owns the shipped DDL, migrations, and DB helpers for the repository-registry, project-mapping, issue-contract, note-snapshot, and context-pack-cache tables.
- `packages/shared` owns the shipped DTOs and literal unions for repository-registry rows, mapping views, note snapshots, context-pack metadata, and source-trace payloads.
- `apps/control-api` owns the shipped Phase 4 knowledge/context module:
  - repository-registry reads
  - project-to-repo mapping resolution
  - latest-valid note-snapshot selection with source-trace warnings when the newest attempt is stale or failed
  - deterministic context-pack assembly with newest-first relevant comment selection
  - repo-guidance loading from allowlisted repo-root-relative files only
  - internal inspection routes for repository and context-pack reads
  - trusted-local `knowledge-sync` entrypoint for moving Obsidian note snapshots into Postgres using bounded batch progress and Obsidian-style wiki-link resolution
- `apps/workflow-worker` does not own context assembly in Phase 4. It only persists issue-contract snapshots from inbox rows and leaves ready-made context-pack consumption to later phases.

## Phase 5 target surface
- Production-ready Phase 5 means transition validator plus real lifecycle workflow skeleton.
- Phase 5 must ship:
  - `IssueLifecycleWorkflow` as the canonical long-lived workflow per issue;
  - `CommentResponseWorkflow` as the short-lived orchestration boundary for comment-derived lifecycle work;
  - explicit signal / query contracts for lifecycle commands, with updates reserved for a later synchronous operator surface only if it proves necessary;
  - idempotent workflow start and signal handling;
  - deterministic issue-run open / continue / close handling;
  - manual override and human-input semantics that still flow through validator-backed policy;
  - DB-backed lifecycle inspection surfaces and authenticated internal operator routes.
- Phase 5 also must ship the minimum observability foundation:
  - `agent_execution_metadata` for orchestration-side executions;
  - `system-health` and `stuck-issues` inspection surfaces;
  - a deterministic lifecycle snapshot / journey view built from persisted DB truth.
- Phase 5 is not finished merely because the system can persist `create_runner_lease` or `release_runner_lease` intents in the outbox.

## Phase 5 package ownership
- `apps/workflow-worker` owns:
  - Temporal workflow definitions;
  - activities that wrap transition application and run-lifecycle services;
  - background dispatch from normalized inbox rows into Temporal;
  - lifecycle recovery behavior after worker restart.
- `apps/control-api` owns:
  - durable webhook ingress only;
  - read-only inspection routes;
  - any future explicit operator/internal command routes using Temporal client APIs.
- `packages/db` owns:
  - persisted runtime state;
  - issue runs;
  - transition audit;
  - artifacts;
  - outbox;
  - projections;
  - any strictly necessary lifecycle idempotency metadata.
- `packages/shared` owns:
  - lifecycle command payload DTOs;
  - query/update response DTOs;
  - explainable error contracts.
- `packages/db` and `apps/control-api` must keep the observability foundation DB-backed and replay-safe; no Temporal UI dependency is allowed for the minimum operator inspection contract.

## Phase 5 workflow boundaries
- `validateTransition()` remains the only legal gate for business status changes.
- Workflow code coordinates command ordering and timer behavior; it does not redefine transition semantics.
- Workflow definitions must stay deterministic and must not perform direct non-deterministic I/O.
- DB writes, audit writes, run mutations, artifact writes, and outbox writes stay behind activities and existing application services.
- External side effects remain post-commit and outbox-only.
- Duplicate webhook deliveries, replayed inbox rows, or repeated operator commands must not create duplicate workflow instances, duplicate runs, or duplicate side effects.
- The same issue must never have more than one canonical lifecycle workflow at a time.

## Phase 5 non-goals
- No real runner execution.
- No real lease fulfillment beyond persisted intent generation.
- No runner heartbeat/capability protocol.
- No worktree, branch, or PR orchestration.
- No full scorecards, alerting engine, or weekly digest automation in Phase 5.
- No merge/deploy coupling as a readiness requirement for Phase 5.

## Phase 6 target surface
- Production-ready Phase 6 means real runner fabric on top of the already-shipped Phase 5 orchestration boundary.
- Phase 6 no longer starts from zero in this repo. The missing work is execution/runtime completion on top of the existing schema/config/shared/read-side scaffold.
- Phase 6 must ship:
  - the already-shipped `workflow_role_execution_policies`, `runner_nodes`, `runner_capabilities`, `runner_leases`, and `runner_lease_attempts` must become exercised production truth instead of dormant scaffold;
  - one Codex-capable runner host and one Claude-capable runner host using the same versioned task and artifact contracts;
  - authenticated runner registration, long-poll lease acquisition, heartbeat, execution-start, completion and failure reporting through a dedicated runner-host protocol surface;
  - explicit cancellation acknowledgement on the runner-host protocol surface; a cancel request is not complete until the control plane durably records `accepted`, `already_terminal`, or `unsupported`;
  - explicit logical lease states that distinguish requested intent, acquired lease, execution start, completion/failure, fallback exhaustion and release;
  - provider-attempt states that make failover history durable and auditable, with `runner_leases` as logical truth and `runner_lease_attempts` as provider-level try/fallback truth;
  - `role_execution_policies.yaml` as a config-version-pinned `primary -> secondary` provider policy source keyed by `owner_role` and carrying `primary_provider`, `secondary_provider`, `fallback_triggers`, `max_provider_failovers`, `mcp_profile_ref`, and `required_capabilities`;
  - host-level shared MCP pooling with explicit `host`, `repo`, and `exclusive` sharing scopes plus deterministic reuse keys and `execution_session_key` reuse across the primary agent and delegated sub-agents for the same attempt;
  - provider-agnostic task envelopes and artifact bundle envelopes owned by `packages/shared`, including `mcp_profile_ref`, `mcp_bindings_summary`, and `AgentExecutionMetadataV2` parity;
  - explicit `host_group_id` semantics as a trusted routing boundary for shared MCP reuse, failover visibility and operator drain/quarantine actions;
  - stable source-of-truth ownership for `mcp_profile_ref`, `tool_baseline`, `reusePolicy`, `mcp_bindings_summary` and `execution_session_key` so runner/runtime code does not guess them ad hoc;
  - artifact upload/finalization semantics where large payloads are durably staged before terminal result acceptance;
  - worktree lifecycle, checkpoint resume and interrupt/cancel semantics at the runner boundary;
  - documented runner-host start entrypoints and deterministic fake-runner/fake-MCP smoke harnesses in the repo itself;
  - runner inventory, active-lease, expired-lease, failover, and MCP-pool inspection surfaces.
- Phase 6 is not finished merely because `create_runner_lease` stops being a noop; persisted command intent must remain distinct from fulfilled execution.
- Phase 6 is also not finished if 10 same-repo swarm agents on one host still spawn 10 separate `serena` instances or if provider fallback cannot be reconstructed from durable DB truth.

## Phase 6 package ownership
- `apps/workflow-worker` owns:
  - logical lease fulfillment orchestration from persisted outbox intents;
  - timeout, heartbeat-expiry, same-provider retry and cross-provider failover coordination;
  - durable ingestion of runner execution results and artifact references.
- `apps/control-api` owns:
  - authenticated internal inspection and operator routes for runner inventory, lease health, failover health and MCP-pool health;
  - the authenticated runner-host transport surface as a thin protocol boundary only;
  - no direct mutation of lifecycle business truth outside the documented contracts.
- `packages/db` owns:
  - runner policy, registry, capability, logical-lease and attempt schema;
  - DB helpers for inventory, routing, liveness and recovery reads.
- `packages/shared` owns:
  - capability manifest DTOs;
  - lease/task/result payload contracts;
  - explainable runner failure payloads.
- `apps/runner-host` owns:
  - host-level MCP pool manager;
  - provider CLI/session execution bridge;
  - worktree management;
  - manifest publication and heartbeat emission;
  - artifact bundle production.
- `packages/config` owns:
  - `RunnerHostConfig`;
  - runner-host auth, poll, heartbeat, workspace/worktree, artifact-root and MCP topology env parsing.

## Phase 6 workflow and lease boundaries
- Phase 6 must not redefine workflow IDs, lifecycle status semantics, run taxonomy or manual override policy from Phase 5.
- `validateTransition()` and `applyTransition()` remain the only legal gates for business lifecycle changes.
- Lease allocation state and execution state are related but not identical:
  - `requested` means orchestration emitted durable intent;
  - `acquired` means a concrete runner node accepted the logical lease or provider attempt;
  - `execution_started` means provider-side task execution actually began;
  - `completed` / `failed` / `released` / `provider_fallback_exhausted` are separate terminal or semi-terminal states.
- Provider failover is role-scoped and config-version-pinned:
  - `runner_requirement_profile` may narrow capabilities;
  - it may not rewrite provider order;
  - automatic cross-provider failover is `checkpoint_only`;
  - only `quota_exhausted`, `rate_limited_exhausted`, `auth_unavailable`, `provider_unhealthy`, and `no_eligible_runner` may trigger cross-provider fallback;
  - transient transport or worker failures retry within the same provider budget before any cross-provider fallback is considered.
- Runner transport is authenticated HTTPS long-poll by default; any future WebSocket path must preserve the same logical protocol.
- Runner-host write protocol is complete only when it includes manifest publish, claim-next, execution-started, heartbeat, completed, failed and cancel-ack routes with idempotent delivery semantics.
- Provider-specific details stay inside adapters. Workflow config and lifecycle rules must consume only provider-agnostic contracts.
- Shared MCP servers are host-level or repo-level resources by default. Provider adapters and delegated sub-agents must reuse bound MCP sessions for the current `execution_session_key` instead of spawning fresh servers unless the manifest marks a server `exclusive`.
- `host_group_id` is a trust and placement boundary, not decorative metadata. Shared MCP bindings must never cross host-group boundaries, and any re-route across host groups must appear as a new durable provider attempt.
- Field ownership is fixed:
  - `mcp_profile_ref` comes from published role execution policy truth;
  - `tool_baseline` and `reusePolicy` come from the active runner capability manifest;
  - `mcp_bindings_summary` comes from the host-level MCP pool manager's runtime-observed allocation for the current attempt.
- Phase 6 may persist branch/worktree metadata, but it must not take ownership of PR/check/deploy loops before Phase 7.

## Phase 6 non-goals
- No GitHub App branch / PR / check synchronization as a readiness requirement.
- No release/deploy automation.
- No multi-repo choreography.
- No API-mode provider backend.
- No assumption that multiple concurrent leases per runner are safe in the first production-ready cut.
- No claim that provider execution is successful merely because a lease was granted.
- No arbitrary per-issue provider override beyond capability narrowing.
- No automatic cross-provider continuation after `execution_started` without a durable checkpoint and explicit resume support.

## Phase 6 acceptance markers
- Returned artifact bundles and persisted `AgentExecutionMetadataV2` must expose failover and shared MCP reuse facts, not only provider identity.
- A started attempt without durable checkpoint must not auto-fail over across providers.
- `runner_lease_attempts` must remain sufficient to reconstruct provider-attempt order, fallback reason, `execution_session_key`, `mcp_profile_ref`, and `mcp_bindings_summary` without consulting transient runner memory.
- The repository must expose documented runner-host start entrypoints, a deterministic fake-runner/fake-MCP smoke path, and a live proof path before Phase 6 can be called production-ready.

## Phase 7 target surface
- Production-ready Phase 7 means one honest end-to-end engineering loop from `Ready for Build` through `Coding` and `Agent Review` into `Needs Human Decision` on one canonical reference repo.
- Phase 7 must ship:
  - one canonical reference repo with deterministic repository resolution, trusted-host checkout, and fresh root-note snapshot coverage;
  - explicit build execution truth on top of Phase 6 runner fabric;
  - explicit review execution truth on top of Phase 6 runner fabric;
  - frozen `contextPackFingerprint` semantics for one build/review cycle;
  - durable build artifact bundles with summary, changed files, patch/diff reference, branch metadata and bounded test results;
  - durable review artifact bundles with structured findings, review disposition, decision summary and the reviewed build artifact reference;
  - idempotent state-sync of review summary and findings back to Linear;
  - lifecycle mapping from review completion into `Needs Human Decision` without manual orchestration outside the platform.
- Phase 7 is not finished merely because `agent_review` exists as a status or because build artifacts can be stored. Review must be a real runtime path with durable outcomes and operator-visible write-back.

## Phase 7 package ownership
- `apps/workflow-worker` owns:
  - build/review orchestration over the existing lifecycle workflow;
  - frozen context resolution for the build/review cycle;
  - review completion to lifecycle-command mapping;
  - outbox/state-sync command emission for Linear-visible review results.
- `apps/control-api` owns:
  - read-side inspection for build/review artifact bundles and latest review state;
  - any narrow authenticated fetch surface needed by runner hosts to read frozen context or build-artifact references;
  - no direct mutation of lifecycle business truth.
- `packages/db` owns:
  - persisted run/execution classification for build and review;
  - artifact registration and replay-safe result ingestion;
  - any durable linkage between review output and the build artifact bundle it inspected.
- `packages/shared` owns:
  - versioned build/review task payloads;
  - versioned review findings and decision-summary contracts.
- `apps/runner-host` owns:
  - provider execution using the frozen context/build artifact inputs;
  - no business-status mutation or direct Linear write-back.

## Phase 7 build and review boundaries
- Build and review must be first-class, separately auditable runtime entities. Review cannot remain an implicit side effect inside build completion metadata.
- A Phase 7 build/review cycle uses one frozen pre-build `contextPackFingerprint`. Review may add build artifacts as evidence, but it must not silently rebuild context from newer comments, newer notes, or mutable repo state.
- Phase 7 may persist branch metadata and patch/diff references, but it must not claim GitHub PR/check truth. Draft PR creation, check sync and merge gates remain Phase 8.
- Review completion must yield one durable disposition:
  - `human_gate_required`
  - `rework_recommended`
  - `review_inconclusive`
- Phase 7 business-status outcome is intentionally conservative: normal review completion ends in `Needs Human Decision`, with the disposition carried in artifacts and Linear write-back.

## Phase 7 non-goals
- No GitHub App auth as a readiness requirement.
- No mandatory draft PR creation.
- No PR review comments or check-state sync as closure criteria.
- No merge/deploy coupling.
- No multi-repo support as a Phase 7 readiness requirement.

## Phase 7 acceptance markers
- One canonical reference repo is fixed and documented. For the first production proof, this is `test_repo`.
- Build and review executions are separately auditable in persisted truth.
- Build and review both consume frozen deterministic context and durable artifact inputs.
- Review completion deterministically drives one human-visible `Needs Human Decision` handoff and one idempotent Linear summary publication.
- The repository exposes a dedicated deterministic Phase 7 verification path plus one live local proof path before Phase 7 can be called production-ready.
- The deterministic verification gate is `corepack pnpm test:phase7`.
- The live local proof gate is `corepack pnpm test:phase7:live`.
- The promotion gate is `corepack pnpm run verify:phase7:promotion`, and it is only honest when both deterministic and live gates pass on the canonical `test_repo`.
- The first live proof path is anchored to `test_repo` at `PHASE7_TEST_REPO_PATH` or `/tmp/ai-dev-team/reference_repos/test_repo` via persisted repository-registry plus project-mapping truth.

## External integrations ownership split
- `apps/control-api` now owns:
  - internal integration-state inspection routes;
  - the public OAuth callback capture endpoint;
  - no direct raw-secret read API.
- `packages/db` now owns:
  - auth/integration metadata schema;
  - metadata-only read/write helpers for consent callback capture and integration inspection;
  - sanitized artifact lookups for context-pack assembly.
- `apps/workflow-worker` now owns:
  - issue-contract parsing for integration-specific fields;
  - workflow-config support for integration reason codes/triggers;
  - a minimal `IntegrationOnboardingWorkflow` skeleton for future human-gated onboarding orchestration.
- Future modules are still planned as logical control-plane modules, not separate deployables by default:
  - `secret-service`
  - `oauth-service`
  - `integration-lab`

## Phase 4 operating constraints
- No new package or deployable is allowed for Phase 4 unless an implementation obstacle proves the current monorepo split insufficient.
- Cloud-side orchestration must read only Postgres-backed `knowledge_note_snapshots` and `context_pack_cache`; it must not depend on direct filesystem access to the local Obsidian vault.
- `knowledge-sync` is a trusted local process, not a public HTTP API. Only it may read the local Obsidian vault directly for Phase 4.
- Prompt bundles remain summary-first: raw webhook payloads, full comment logs, full note bodies, and secrets stay out of the prompt-facing context pack.
- Context-pack invalidation is fingerprint-based. The shipped runtime contract does not expose a TTL override.

## 2026-03-26 implementation status
- Phase 5 is no longer docs-only in this repo.
- Shipped in code:
  - shared lifecycle contracts and typed validator/outbox metadata DTOs;
  - `lifecycle_command_inbox`, `opened_run_kind`, `mv_status_dwell_times`, and `agent_metrics_daily`;
  - real Temporal workflow definitions for issue lifecycle and comment-response handling;
  - deterministic `human_input_received -> needs_spec` handoff with validator-backed artifacts and guards;
  - canonical lifecycle command dispatch that always targets `issue:{issueId}`;
  - DB-backed lifecycle snapshot, journey, system-health, stuck-issues, and daily metrics reads;
  - authenticated `/internal` operator/query routes guarded by `INTERNAL_API_BEARER_TOKEN`;
  - control-api startup that no longer hard-depends on Temporal availability for webhook ingress.
- Also already shipped as Phase 6 scaffold:
  - workflow-config support for `role_execution_policies.yaml`;
  - shared `RoleExecutionPolicyV1`, `RunnerCapabilityManifestV1`, `RunnerLeaseAttemptV1`, `TaskEnvelopeV2`, `ArtifactBundleV2`, and `AgentExecutionMetadataV2` contracts;
  - runner schema/migrations for policy, inventory, logical leases, attempts, and read models;
  - DB helpers for manifest upsert, lease creation/release, attempt claim/start/heartbeat/complete/fail;
  - control-api inspection reads for runner inventory, active/stale leases, per-lease attempt detail, and provider failover metrics.
- Still intentionally not shipped:
  - real runner fulfillment;
  - provider adapters / runner daemons;
  - authenticated runner-host protocol routes and runner-host auth separation;
  - host-level MCP pool manager and real MCP binding persistence;
  - capability-aware lease routing, same-provider transient retry, and durable task/result ingestion with `execution_session_key`, `mcp_profile_ref`, and `mcp_bindings_summary`;
  - any public state that would imply persisted runner commands equal successful execution.
