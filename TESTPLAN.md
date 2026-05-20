# Test Plan

## Automated checks
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm test:integration`
- `corepack pnpm test:phase6`
- `corepack pnpm test:phase6:live`
- `corepack pnpm build`

## Phase 6 promotion gate
- `corepack pnpm verify:phase6:promotion` is the rollout-grade Phase 6 verification command.
- Root `corepack pnpm run ci` intentionally excludes `test:phase6:live`; the live Codex/Claude proof remains a separate mandatory promotion gate because it depends on the local runner-host runtime contract rather than only deterministic repository checks.

## IntegrationAgent and Secrets/Auth plane coverage
- Contract tests must cover the extended issue contract fields:
  - `provider_name`
  - `integration_kind`
  - `auth_scheme`
  - `required_credentials`
  - `secret_slots`
  - `required_scopes`
  - `oauth_redirect_uris`
  - `sandbox_account_required`
  - `webhook_required`
  - `webhook_callback_urls`
  - `rate_limit_notes`
  - `error_model`
  - `test_strategy`
  - `go_live_checklist`
  - `rollback_plan`
- Metadata-only auth-plane tests must prove:
  - raw secret/token values never land in Postgres rows, prompt bundles, or docs artifacts;
  - OAuth callback capture persists only state, granted scopes, safe error text, and callback timing;
  - context packs can surface sanitized integration artifacts from `artifact_registry` without pulling raw vendor docs or secrets.
- Runner/route tests must cover:
  - `/internal/issues/:issueId/integrations/*` inspection routes;
  - public `/oauth/callback/:providerName` handling;
  - integration-capability config parsing for runner allowlists and broker flags.
- Label/gate enforcement tests must prove:
  - unresolved `needs:*` / `sandbox:*` / `prod-access:*` prerequisites keep the issue out of `Ready for Build`;
  - unresolved `secret_slots` keep integration work out of `Ready for Build` even if the generic readiness gate would otherwise pass;
  - production-credential paths require an explicit prod-access approval before readiness can clear.
- Integration lifecycle tests must cover:
  - `Needs Spec` or `Planned` moving to `Needs Input` when credentials, consent, redirect URI registration, or webhook registration are missing;
  - `Needs Input -> Planned` only after slot fill / consent completion / webhook validation produces the required sanitized artifacts;
  - `Blocked` transitions for invalid scope, expired/revoked token, vendor outage, broker outage, sandbox failure, and rate-limit lockout.
- `IntegrationOnboardingWorkflow` tests must cover:
  - dedupe and replay safety for repeated onboarding events;
  - safe parent-workflow handoff semantics for long-lived human-gated onboarding;
  - browser-consent paths remaining human-in-the-loop rather than silently completing from headless execution.
- Integration runner-routing tests must prove:
  - non-integration runners cannot claim integration issues;
  - integration-capable runners require the advertised broker/doc/integration-lab MCP servers, not only boolean capability flags;
  - browser-consent flows are never routed to runners that do not advertise human-in-the-loop consent support.

## Phase 2 automated coverage requirements
- Migration tests for clean bootstrap and safe re-run semantics.
- Seed loader tests for YAML validation, referential integrity, and immutable insert behavior.
- Publish-command tests for single active version, advisory-lock protection, and publish-forward rollback semantics.
- Transaction tests proving that `issue_runtime_state`, `issue_runs`, `status_transition_audit`, `artifact_registry`, and `workflow_effect_outbox` commit atomically.
- Projection tests proving `status_projection` and `blocked_issues_projection` stay aligned with runtime state writes.

## Phase 3 automated coverage requirements
- Webhook-route tests proving raw request bodies are preserved for signature verification and that malformed payloads, missing delivery headers, and unsupported provider events are rejected with `400`.
- Webhook-route tests proving oversized webhook payloads are rejected with `413`.
- Webhook-route tests proving valid and invalid Linear/GitHub deliveries are persisted into `raw_event_inbox` with correct provider metadata and dedupe behavior.
- Migration tests proving `raw_event_inbox`, `comment_log`, and the nullable `replay_window_valid` durability flag are created alongside the existing Phase 2 tables.
- Inbox-processor tests proving supported Linear and GitHub event families normalize into canonical envelopes from persisted inbox rows.
- Inbox-processor tests proving stale Linear deliveries and failed signatures are ignored deterministically instead of being normalized.
- Inbox-processor unit tests proving `@ask` parsing ignores code blocks / quotes, `human_input_received` is not emitted without explicit answer validation, and legacy Linear rows with `replay_window_valid = null` still use timestamp fallback.
- Inbox-processor tests proving `comment_log` writes are transactional and replay/redrive can succeed from an existing `raw_event_inbox` row without a fresh HTTP delivery.
- Shared compiled fixture-corpus tests proving the same supported provider payloads are reused across route and inbox normalization coverage.
- Integration scripts for DB-backed packages must execute serially against the shared test database to avoid false deadlocks between independent integration files.

## Phase 4 automated coverage requirements
- Migration tests for clean bootstrap and safe re-run semantics of:
  - `repository_registry`
  - `project_repository_mappings`
  - `linear_issue_contract_snapshots`
  - `knowledge_note_snapshots`
  - `context_pack_cache`
- Constraint tests proving exactly one `primary` repository mapping can exist per Linear project and that superseded context-pack rows never overwrite prior immutable bundles.
- Resolver tests proving explicit issue-contract repository assignments win over `project_repository_mappings`.
- Resolver tests proving missing or ambiguous repository mapping fails deterministically with the documented error contract.
- Root-note resolution tests proving the builder uses explicit `docs_links` first, then the primary repository root note, then affected-repository root notes.
- Snapshot-selection tests proving the builder uses the newest valid `fresh` note snapshot even when the newest ingest attempt is `stale` or `failed`.
- Link-expansion tests proving only one-hop expansion is allowed and only within the documented allowlist roots.
- Wiki-link tests proving short links resolve against the current note directory first and only fall back to unique basename matches when no local match exists.
- Broken-link tests proving missing optional shared links only emit source-trace warnings, while a missing required primary root note fails the bundle.
- Determinism tests proving identical inputs produce the same `input_fingerprint` and byte-equivalent ordered `bundle_json`.
- Cache invalidation tests proving contract changes, relevant-comment changes, note-snapshot changes, and repo-guidance changes each produce a new immutable context-pack row.
- Comment-selection tests proving `latest_relevant_comments` contains only `prompt`, `answer_candidate`, and `manual_override_candidate` rows by default, ordered newest-first, with optional triggering-comment inclusion preserved.
- Repo-guidance tests proving `agent_guidance_scope` accepts only repo-root-relative allowlisted paths and rejects path traversal or absolute paths.
- Budget and redaction tests proving raw webhook payloads, full comment logs, unbounded note bodies, and secrets never appear in prompt-facing `bundle_json`.
- Cloud-safe tests proving context-pack assembly works from Postgres-backed snapshots and cache rows without direct filesystem access to the local Obsidian vault.

## Phase 5 automated coverage requirements
- Validator tests for allowed and disallowed transitions, single-trigger enforcement, guard failures, and explainable error payloads.
- Transaction tests proving runtime state, issue runs, transition audit, artifacts, and outbox writes remain atomic on every accepted lifecycle transition path.
- Workflow tests for `IssueLifecycleWorkflow` covering:
  - bootstrap issue start;
  - idempotent start by workflow ID;
  - signal handling for normalized lifecycle commands;
  - canonical command handling for manual overrides and human-input submission;
  - block/unblock semantics;
  - bounded-history behavior through continue-as-new or an equivalent explicit rollover policy.
- Workflow tests for `CommentResponseWorkflow` covering:
  - comment-driven human input resolution;
  - duplicate comment handling by canonical comment identity;
  - safe handoff into the canonical issue lifecycle workflow;
  - superseded/no-op completion when the issue is no longer in `needs_input` or the open operator question is already closed.
- Inspection tests covering lifecycle snapshot, journey, system-health, and stuck-issues responses as DB-backed read surfaces.
- Serialization tests for the minimum observability metadata contract so the shipped fields stay stable across later phases.
- Integration tests proving one persisted ingress event leads to one workflow action even under duplicate delivery or redrive from `raw_event_inbox`.
- Integration tests proving lifecycle command dispatch uses the canonical workflow ID and does not create duplicate workflow executions.
- Recovery tests proving worker restart or workflow replay does not corrupt lifecycle state, duplicate an open run, or duplicate outbox effects.
- Tests proving noop external handlers for future runner commands are not counted as successful real external fulfillment.

## Local verification sequence
1. Copy `.env.example` to `.env.local` or export the variables in your shell.
2. Run `corepack pnpm infra:up`.
3. Run `corepack pnpm db:migrate`.
4. Re-run `corepack pnpm db:migrate` and confirm it is a no-op on an already migrated database.
5. Run `corepack pnpm db:validate-workflow-config`.
6. Run `WORKFLOW_CONFIG_PUBLISHED_BY=local-smoke DATABASE_URL=... corepack pnpm db:publish-workflow-config` and verify:
   - one new `config_version` is inserted;
   - exactly one config set is active for new runs;
   - a repeated publish of the same manifest is either a no-op or an explicit integrity error, never a silent overwrite.
7. Run `DATABASE_URL=... corepack pnpm test:integration`.
8. Verify webhook ingress with the DB-backed integration suite:
   - `apps/control-api` persists supported Linear and GitHub deliveries into `raw_event_inbox`;
   - unsupported webhook families (including GitHub `check_suite`) fail at the HTTP edge with `400`;
   - stale Linear deliveries persist with `replay_window_valid = false`;
   - `apps/workflow-worker` normalizes the inbox rows, writes `comment_log`, and persists `linear_issue_contract_snapshots` from Linear `Issue` events.
9. Run `DATABASE_URL=... KNOWLEDGE_SYNC_VAULT_ROOT=... corepack pnpm dev:knowledge-sync` on a trusted machine and confirm `knowledge_note_snapshots` are populated.
   - Re-run the sync with a small `KNOWLEDGE_SYNC_BATCH_SIZE` and confirm later runs continue progressing instead of reprocessing only the first notes in sort order.
10. Verify the new Phase 4 internal inspection routes:
   - `GET /internal/repositories/:repoSlug`
   - `GET /internal/projects/:projectId/repository-mapping`
   - `GET /internal/issues/:issueId/context-pack`
11. Verify the Phase 5 lifecycle smoke path once workflow code lands:
   - start the Temporal dev server, the main `workflow-worker` process, and the outbox executor loop;
   - ingest a representative issue bootstrap flow and confirm the canonical lifecycle workflow is created once;
   - ingest a representative comment/manual-input flow and confirm `human_input_received` returns the issue from `needs_input` to `needs_spec` exactly once;
   - verify `CommentResponseWorkflow` either hands off a deterministic follow-up command or safely no-ops when the human gate is already closed;
   - verify duplicate delivery or replay does not create a second workflow or a duplicate issue run.
12. Verify that accepted lifecycle transitions still write runtime state, runs, audit rows, artifacts, and outbox rows atomically.
13. Verify that a worker restart preserves lifecycle state and does not duplicate side effects on replay.
14. Verify the minimum observability surfaces:
   - `GET /internal/issues/:issueId/lifecycle-snapshot`
   - `GET /internal/issues/:issueId/journey`
   - `GET /internal/metrics/system-health`
   - `GET /internal/metrics/stuck-issues`
15. Optionally run `DATABASE_URL=... corepack pnpm run ci` for the full repository verification path.
16. Run `corepack pnpm infra:down` after the smoke check.

## Exit criteria for Phase 2
- A clean database can be migrated to the latest schema and re-migrated safely without drift.
- A new workflow config version can be published without mutating prior published rows.
- Bootstrap runtime state for a new issue can be inserted with a pinned `config_version`.
- Transition audit and outbox rows are written in the same transaction as runtime-state updates.
- Read models can be queried directly from physical projection tables without reconstructing state from joins or refresh jobs.
- The outbox executor can claim, complete, retry, and dead-letter commands using the persisted outbox contract.

## Exit criteria for Phase 3
- Supported Linear and GitHub webhook families can be accepted through `apps/control-api` and durably persisted into `raw_event_inbox`.
- Unsupported provider event families are rejected at the HTTP edge and never create inbox rows.
- Duplicate deliveries do not create duplicate inbox rows and increment delivery-attempt tracking instead.
- `apps/workflow-worker` can claim persisted inbox rows, normalize them into canonical envelopes, and write `comment_log` for Linear comments.
- Invalid signatures and stale Linear deliveries remain queryable in `raw_event_inbox` but never become normalized downstream work.
- New Linear inbox rows persist edge replay eligibility in `replay_window_valid`; legacy rows with `null` remain replayable through worker-side fallback.
- Replay/redrive can succeed from an existing `raw_event_inbox` row without repeating the original HTTP delivery.

## Exit criteria for Phase 4
- A deterministic context pack can be assembled for an issue from persisted issue-contract, repository-mapping, note-snapshot, and repo-guidance inputs.
- Exactly one primary repository is enforced per Linear project when repository mappings are used as the fallback source.
- Explicit repository assignments inside the issue contract override project-level repository mappings.
- The worker persists hash-stable `linear_issue_contract_snapshots` from persisted Linear `Issue` deliveries without moving context assembly into workflow definition code.
- Raw history, raw webhook payloads, and secrets are excluded from prompt-facing `bundle_json`.
- Optional broken shared-note links degrade to source-trace warnings, but missing required primary root notes fail the bundle deterministically.
- The builder prefers the newest valid `fresh` note snapshot while still surfacing stale/failed latest attempts through deterministic warnings or errors.
- Cloud-side orchestration can resolve context only from Postgres-backed snapshots and cache rows without direct vault access.
- Operators can refresh note snapshots, rebuild context-pack cache rows, and redrive stale bundles without mutating prior immutable context-pack records.

## Exit criteria for Phase 5
- Every lifecycle status change reaches Postgres through the validator-backed transition path only.
- `IssueLifecycleWorkflow` and `CommentResponseWorkflow` exist as real Temporal workflows, not as bootstrap stubs.
- Duplicate ingress or replay does not create duplicate workflow instances, duplicate runs, duplicate audit rows, or duplicate side effects.
- Manual overrides and human-input flows are validated and auditable instead of bypassing policy.
- Worker restart or workflow replay preserves deterministic lifecycle state.
- Minimum observability surfaces are available from persisted DB truth and do not depend on Temporal UI for the baseline contract.
- Internal operator routes require bearer authentication, except `/internal/healthz`.
- Future runner commands may still be noop-backed, but that limitation is explicit and does not block Phase 5 acceptance.

## Phase 6 automated coverage requirements
- Migration tests for `workflow_role_execution_policies`, `runner_nodes`, `runner_capabilities`, `runner_leases`, and `runner_lease_attempts`, including uniqueness and safe re-run semantics.
- Workflow-config publish/load tests covering `role_execution_policies.yaml`, per-role provider order, `owner_role` keys, `primary_provider`, `secondary_provider`, `fallback_triggers`, `max_provider_failovers`, `mcp_profile_ref`, `required_capabilities`, and config-version pinning.
- Workflow-config regression tests proving policy-only manifest changes change the workflow-config fingerprint and cannot be silently republished as identical content.
- Capability-manifest validation tests covering supported roles, run kinds, MCP/tool baseline, workspace roots, host grouping, MCP sharing scopes, interrupt/checkpoint flags, and the new `RUNNER_MCP_COMMANDS_JSON` truthiness gate.
- Add integration-capable runner coverage:
  - `networkModesSupported`
  - `allowedDocDomains`
  - `allowedSandboxDomains`
  - `supportsBrowserConsent`
  - `supportsSecretBroker`
  - `supportsOAuthBroker`
  - `supportsIntegrationLab`
- Lease lifecycle tests covering:
  - request -> acquire;
  - acquire -> execution_started;
  - execution_started -> completed / failed;
  - release after completion;
  - cancellation_requested;
  - heartbeat_lost -> expired / requeue.
- Attempt-routing tests proving lease allocation uses persisted capability truth and role execution policy truth and does not dispatch incompatible work to the wrong provider or runner node.
- Attempt-routing tests proving capability narrowing respects `required_capabilities`, `runner_requirement_profile_json`, current runner concurrency, and repo/worktree constraints instead of filtering only by provider/role/run kind.
- Host-group routing tests proving shared MCP reuse never crosses `host_group_id` boundaries and that cross-group re-routing is visible as a new durable provider attempt.
- Provider failover tests covering:
  - primary provider quota exhaustion before `execution_started` opens a secondary attempt and preserves one logical lease;
  - primary provider `rate_limited_exhausted` before `execution_started` opens a secondary attempt and preserves one logical lease;
  - primary provider `auth_unavailable` opens a secondary attempt with explicit `fallback_reason`;
  - `provider_unhealthy` and `no_eligible_runner` are eligible for cross-provider fallback only before `execution_started`;
  - transient transport or worker failure retries the same provider first and does not immediately fail over;
  - post-start limit exhaustion without checkpoint does not auto-fail over and ends in a controlled failure/blocked path;
  - post-start failure with durable checkpoint and `supportsCheckpointResume = true` can resume on a secondary provider as a new attempt.
- Transport tests for authenticated long-poll acquisition, heartbeat idempotency, duplicate completion delivery and safe retry after transient control-plane failure.
- Shared MCP pool tests proving:
  - same-repo agent sessions on one host reuse one repo-scoped `serena` process instead of spawning one per session;
  - cross-repo concurrency isolates repo-scoped `serena` while still reusing host-scoped `obsidian` and `context7`;
  - `serena=repo`, `obsidian=host`, `context7=host`, and unproven multiplex-safe servers default to `exclusive`;
  - reuse keys are derived from `(server_name, sharing_scope, repo_slug-or-null, config_hash)`;
  - `execution_session_key` is the reuse boundary for the primary agent plus delegated sub-agents within one attempt;
  - `exclusive` servers are never silently multiplexed.
- Control-api route tests covering:
  - runner inventory, MCP-pool snapshot, lease detail and failover inspection reads;
  - authenticated runner-host protocol routes for manifest publish, long-poll claim, execution-start, heartbeat, completion, failure and cancel acknowledgement;
  - auth separation between operator `/internal` routes and runner-host protocol routes.
- Fake-runner integration tests proving one persisted `create_runner_lease` intent becomes exactly one logical lease and a provider-attempt history that stays replay-safe.
- Worktree lifecycle tests covering deterministic worktree path creation, cleanup, preserved checkpoint resume and non-mutation of the primary checkout.
- Artifact bundle tests covering summary, changed-files list, test-result payloads, patch/blob references, provider/tool attribution, `providerAttemptNo`, `fallbackFromProvider`, `executionSessionKey`, `mcpProfileRef`, failover metadata, MCP binding summaries, and `AgentExecutionMetadataV2` serialization.
- Artifact delivery tests proving terminal completion is accepted only after durable artifact/blob references are available and that duplicate completion resolves to the same artifact-bundle record.
- Interrupt/cancel tests proving an operator-initiated cancellation does not silently disappear and that unsupported interrupt capability remains explicit.
- Recovery tests proving heartbeat loss, runner restart, duplicate result delivery and worker restart do not corrupt logical lease truth, attempt truth or MCP allocation accounting.
- Heartbeat snapshot tests proving the persisted MCP pool snapshot feeds the operator-visible lease timeline and pool inspection routes.
- Root deterministic-gate tests proving `corepack pnpm test:phase6` exercises the `@ai-dev-team/runner-host test:phase6` slice instead of leaving it as an optional package-local follow-up.
- Live-proof tests proving the review path reaches terminal `completed` and leaves durable `runner_artifact_bundle`, `agent_execution_metadata`, `review_report`, and `verification_result` evidence on a runner host in a different `host_group_id` from the build path.

## Phase 6 local verification sequence
1. Complete the full Phase 5 local verification sequence first.
2. Verify the repository exposes documented runner-host start entrypoints plus the deterministic fake-runner/fake-MCP smoke helpers before attempting Phase 6 promotion.
3. Prepare a local env file rather than relying on ad-hoc shell exports. `corepack pnpm test:phase6:live` loads `.env.local` first, then `.env`, and fails fast with the aggregated missing-key list when the Phase 6 live contract is incomplete.
4. Run `corepack pnpm test:phase6` and confirm the deterministic contract, DB-backed integration checks, and runner-host slice are green.
5. Start one trusted Codex-capable runner host and one trusted Claude-capable runner host with valid runner auth credentials, `RUNNER_MCP_COMMANDS_JSON`, and distinct workspace/worktree/artifact roots.
   - Repo-owned wrapper commands may use `node dist/...`; the runner-host config normalizes those paths against `apps/runner-host` so the same env contract works from repo-root and package-root launches.
   - The live harness requires an effective provider command for each real provider via `CODEX_COMMAND` or `CODEX_CLI_BIN`, and via `CLAUDE_CODE_COMMAND` or `CLAUDE_CLI_BIN`.
   - `CODEX_CLI_BIN` and `CLAUDE_CLI_BIN` are optional probe overrides unless the selected `*_COMMAND` uses the repo-owned adapter wrapper, in which case the matching CLI binary must still be available for the provider probe.
   - When `PHASE6_LIVE_CODEX_*` / `PHASE6_LIVE_CLAUDE_*` root overrides are omitted, the live harness derives deterministic provider-specific child roots and fails fast if the effective roots collide.
6. Publish capability manifests for both runner hosts and verify they appear in the runner inventory inspection surface exactly once each.
7. Trigger one build-oriented lifecycle path that emits `create_runner_lease` and verify:
   - exactly one `runner_leases` row is created;
   - exactly one provider attempt is opened against the role policy primary provider;
   - lease state moves from `requested` to `acquired` to `execution_started`.
8. Verify heartbeat updates keep the lease healthy and that stopping heartbeats moves the lease into operator-visible degraded/expired handling.
   The runner host must emit the first heartbeat immediately after `execution_started` so even short-lived attempts persist `/internal/runners/mcp-pool` truth before terminal completion.
9. Verify a completed build execution returns a durable artifact bundle reference and marks the lease `completed` before `released`.
10. Verify a fallback-eligible failure opens a new `runner_lease_attempts` row on the configured secondary provider, preserves the prior failed attempt row, and records `provider_attempt_no`, `fallback_from_provider`, `fallback_reason`, `execution_session_key`, `mcp_profile_ref`, and `mcp_bindings_summary`.
11. Verify a started attempt without checkpoint does not auto-fail over across providers.
12. Verify a started attempt with checkpoint enters `heartbeat_lost` first and only then:
   - expires after the grace period when `supportsCheckpointResume = false`;
   - reopens as a new recovery attempt after the grace period when `supportsCheckpointResume = true`.
13. Verify a cancellation request becomes visible as `cancellation_requested`, receives an explicit cancel acknowledgement (`accepted`, `already_terminal`, or `unsupported`), and eventually resolves to either `released` or an explicit terminal runner result.
14. Verify worktree cleanup and checkpoint-resume behavior on one representative rerun path.
15. Verify provider attribution, fallback reason, `fallbackTriggeredCount`, `fallback_reason`, `mcp_pool_reuse_ratio`, `shared_mcp_process_count`, `provider_limit_exhaustion_events`, and lease lifecycle metrics are visible through the current inspection routes.
    Current operator surfaces include `/internal/runners/metrics/provider-failover`, `/internal/runners/mcp-pool`, and `/internal/runners/leases/:leaseId`.
16. Verify a policy-only edit to `role_execution_policies.yaml` changes the manifest fingerprint and requires a real publish-forward config version bump.
17. Run `corepack pnpm test:phase6:live` and confirm the live proof succeeds with one real Codex-host build run and one real Claude-host review run on different `host_group_id` values, with:
   - terminal review completion and durable `runner_artifact_bundle`, `agent_execution_metadata`, `review_report`, and `verification_result` evidence;
   - `/internal/runners/mcp-pool` proving bindings and `sessionCounts` stay within the correct `host_group_id`;
   - `/internal/runners/leases/:leaseId` proving build and review attempts retain distinct `execution_session_key` and host-group attribution.

## Exit criteria for Phase 6
- One Codex-capable runner host and one Claude-capable runner host can register, publish valid capability manifests, and complete the live proof on the local machine.
- Orchestration can allocate a logical lease using persisted capability truth and role execution policy truth only.
- Runner hosts can acquire, heartbeat, execute and release work without direct lifecycle-table mutation.
- The system distinguishes persisted lease intent from actual execution start/completion in durable state and operator inspection.
- Heartbeat loss, lease expiry, provider exhaustion and cancellation are visible and recoverable through documented runbooks.
- Returned artifact bundles are versioned, durable and sufficient for later Phase 7 consumers.
- Shared MCP reuse is measurable and effective for repo-scoped and host-scoped servers.
- Provider fallback leaves a durable attempt trail and does not mutate business truth ad hoc.
- The deterministic and live verification gates are both required for honest Phase 6 closure.
- The live proof must show a Codex build path and a Claude review path on different `host_group_id` values, and the review path must end in terminal `completed` with durable review artifacts and execution metadata.
- Integration-specific addendum:
  - at least one API-key sandbox path, one OAuth2 Authorization Code + PKCE path, and one signed webhook path must complete the `Needs Input` protocol without exposing raw credentials.

## Phase 7 automated coverage requirements
- Run-classification tests proving build execution and review execution are distinguishable in persisted truth and can be inspected separately after completion or replay.
- Task-envelope tests proving build execution receives a frozen `contextPackRef` / `contextPackFingerprint`, and review execution receives that same frozen fingerprint plus the referenced build artifact bundle.
- Lifecycle tests proving one representative issue can traverse `ready_for_build -> coding -> agent_review -> needs_human_decision` without manual DB mutation or out-of-band orchestration.
- Review-result tests proving review completion yields a durable disposition (`human_gate_required`, `rework_recommended`, or `review_inconclusive`) and maps to the expected lifecycle command path.
- Context-stability tests proving a build/review cycle does not silently consume newer note snapshots or newer comments once the frozen build context has been issued.
- Artifact-contract tests covering:
  - build summary;
  - changed-files list;
  - patch/diff artifact reference;
  - branch metadata;
  - bounded test-result summary;
  - review disposition;
  - structured findings with severity and optional file/line evidence;
  - reviewed build-artifact reference.
- Linear state-sync tests proving:
  - review completion generates exactly one idempotent summary publication intent;
  - duplicate completion or replay does not create duplicate operator-facing comments;
  - published comment payloads remain bounded and summary-first instead of inlining raw diff/log payloads.
- Inspection-route tests proving operators can see:
  - the frozen context fingerprint used for the build/review cycle;
  - the build artifact bundle reviewed;
  - the latest review disposition;
  - the human-gate reason for `needs_human_decision`.
- Recovery tests proving worker restart, duplicate review delivery, or temporary Linear write-back failure do not corrupt lifecycle truth or mint divergent artifact bundles/comments.
- Dedicated deterministic gate requirement: Phase 7 is not honest without `test:phase7` or an equivalently documented command surface that exercises the full contract above.
- Dedicated live gate requirement: Phase 7 is not honest without `test:phase7:live`, and the live harness must execute on the canonical `test_repo` without deterministic-only bypasses.

## Phase 7 local verification sequence
1. Complete the full Phase 6 local verification sequence first.
2. Run `node scripts/bootstrap-phase7-test-repo.mjs` and verify the canonical Phase 7 reference repo is `test_repo`, populated at `PHASE7_TEST_REPO_PATH` or `/tmp/ai-dev-team/reference_repos/test_repo`, and registered through the repository bootstrap path.
3. Verify the issue contract or project mapping for the smoke issue resolves to `test_repo` deterministically.
4. Run `corepack pnpm test:phase7` and confirm the deterministic Phase 7 gate is green.
5. Run `corepack pnpm test:phase7:live` and confirm the live proof reaches `needs_human_decision` and delivers the Linear summary through the outbox path.
6. Start the minimum long-lived processes:
   - Postgres
   - Temporal dev server
   - `apps/control-api`
   - `apps/workflow-worker`
   - outbox executor loop
   - one Codex-capable `apps/runner-host`
   - one Claude-capable `apps/runner-host`
7. Trigger one representative issue to `Ready for Build` and verify the build execution is created with a frozen `contextPackFingerprint`.
8. Verify build completion returns one durable build artifact bundle containing summary, changed files, patch/diff reference, branch metadata and bounded test results.
8. Verify the issue enters `Agent Review` and opens a separate review execution that references the same frozen context fingerprint plus the completed build artifact bundle.
9. Verify review completion returns one durable review artifact bundle with disposition, decision summary and structured findings.
10. Verify the lifecycle path moves the issue to `Needs Human Decision` without manual orchestration outside the platform.
11. Verify exactly one Linear-visible review summary is published, and that it references the review disposition and artifact bundle without inlining raw logs or raw diff blobs.
12. Verify inspection surfaces can reconstruct the full build/review chain after the fact.

## Exit criteria for Phase 7
- One canonical reference repo is fixed and documented for the happy path.
- Build and review executions are first-class, separately auditable runtime entities.
- Both executions consume frozen deterministic context and durable artifact inputs.
- One issue can travel from `Ready for Build` to `Needs Human Decision` without manual DB edits, manual lease surgery or out-of-band operator glue.
- Review completion drives one idempotent human-visible Linear summary/update path.
- Operators can inspect which frozen context pack was used, which build artifact bundle was reviewed, and why the issue now requires human decision.
- Release notes and docs do not claim GitHub PR/check/deploy automation as part of Phase 7 closure.
- `verify:phase7:promotion` is green and includes both `test:phase7` and `test:phase7:live`.
