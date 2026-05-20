# Release Checklist

## Purpose
This file tracks the release checklist for the shipped control-plane through the Phase 6 runner-fabric slice, including the separate live Codex/Claude promotion proof.

## Pre-release checks
1. Run `corepack pnpm lint`.
2. Run `corepack pnpm typecheck`.
3. Run `corepack pnpm test`.
4. Run `corepack pnpm test:integration`.
5. Run `corepack pnpm test:phase6`.
6. Run `corepack pnpm verify:phase6:promotion`.
   This is intentionally separate from root `corepack pnpm run ci` because the live proof depends on the real runner-host runtime contract and must stay explicit at promotion time.
7. Run `corepack pnpm build`.
8. Run `corepack pnpm db:validate-workflow-config`.
9. Run `corepack pnpm db:migrate` against the target environment.
10. Run `corepack pnpm db:publish-workflow-config` against the target environment with an explicit `WORKFLOW_CONFIG_PUBLISHED_BY`.
11. Validate that `LINEAR_WEBHOOK_SECRET`, `GITHUB_WEBHOOK_SECRET`, `WEBHOOK_REPLAY_WINDOW_MS`, webhook body-size settings, and `INTERNAL_API_BEARER_TOKEN` are present in the target environment.
12. Exercise the Postgres-backed integration suite or equivalent smoke path for webhook ingress and inbox processing before promotion.
13. Verify the Phase 5 minimum observability surfaces are available and DB-backed:
    - lifecycle snapshot;
    - issue journey;
    - system-health;
    - stuck-issues.
14. For integration-facing releases, verify the metadata-only auth plane:
    - `credential_slots`
    - `oauth_client_registrations`
    - `oauth_consent_sessions`
    - `token_handles`
    - `webhook_registrations`
    - `integration_validation_runs`
15. Verify no release artifact, prompt bundle, or operator-visible summary contains raw credentials or tokens.
16. For Phase 7 or later engineering-loop releases, verify the canonical reference repo resolves deterministically from repository-registry truth before promotion and that Phase 7 write-back is fail-closed if Linear delivery cannot complete.

## Integration credential rotation
1. Rotate the secret in the external secret manager or broker first; do not patch raw values into Postgres or Linear.
2. Update only the alias/binding metadata if the logical slot name changes.
3. Re-run a safe validation probe and persist the result in `integration_validation_runs`.
4. For OAuth client rotation, confirm:
   - the registration alias is updated;
   - consent state is still valid or explicitly re-opened;
   - token handles are either refreshed through the broker or marked invalid.
5. For webhook signing-secret rotation, keep the old and new secret active only for the shortest overlapping verification window that the provider requires.
6. If validation fails, roll back the alias/binding change and do not mark the slot validated.

## OAuth consent and callback recovery
1. Identify the `oauth_consent_sessions.state`, provider, issue ID, and current status before any recovery step.
2. Redrive the operator flow by issuing a new consent session if the original state is lost or expired; do not re-use an unknown callback state.
3. Treat the public callback endpoint as sanitized state capture only. If the downstream broker/token exchange failed, recover in the broker layer instead of editing callback metadata by hand.
4. If the provider returned reduced scopes, move the issue back through the documented `Needs Input` or `Blocked` path instead of forcing readiness.
5. Record any revoke/refresh action in the release log and preserve the old audit metadata.

## Redirect URI change
1. Identify the provider, environment, current registered redirect URIs, and the control-plane callback base URL before making changes.
2. Add the new redirect URI in the vendor console first, but keep the old URI active until callback validation succeeds.
3. Update the control-plane callback configuration and any affected registration metadata aliases in the same release window.
4. Run a fresh consent session against the new URI and verify the callback is captured as sanitized state only.
5. Remove the old redirect URI only after the new URI has passed validation and the issue is no longer blocked on consent.
6. If validation fails, roll back both the config change and the vendor-console redirect URI change together.

## Token revoke and recovery
1. Identify the token-handle row, secret alias, consent session, expiry metadata, and current issue status before taking action.
2. Revoke tokens through the broker or provider console first; do not mark a token revoked in Postgres unless the external revoke step is already known to be true.
3. Persist only metadata changes in `token_handles` and related validation artifacts after the revoke or refresh outcome is known.
4. If refresh or revoke fails, move the issue through the documented `Blocked` path and preserve the last known-good audit trail.
5. Recovery must issue a fresh consent or credential validation path instead of manually patching token-like metadata back to `active`.

## Webhook registration recovery
1. Identify the registration row, callback URL, provider environment, configured events, and signing-secret alias.
2. If the provider-side registration drifted, reconcile it in the vendor console and then re-run replay-safe signature validation.
3. Use replay fixtures or sandbox replay where possible; do not mark a webhook `validated` without a durable verification result.
4. If replay safety or signature verification fails, keep the issue/operator state blocked until a fresh validation run succeeds.

## Broker outage and recovery
1. Identify which logical surface is degraded: secret broker, OAuth broker, or integration-lab.
2. Keep integration issues in `Blocked` with an explicit broker-outage reason code while the broker path is unavailable.
3. Do not bypass the broker by pasting secrets, codes, or tokens into Postgres, Linear, or repo docs.
4. After broker recovery, re-run the smallest safe validation path: credential validation, consent completion check, or sandbox/webhook verification.
5. Record the outage window, affected providers, and recovery action in the release log before unblocking the issue.

## Webhook secret rotation
1. Provision the new Linear and GitHub webhook secrets in the target environment before changing provider-side webhook settings.
2. Deploy the new application version with the updated secrets and confirm `POST /webhooks/linear` and `POST /webhooks/github` still accept signed deliveries in the target environment.
3. Rotate the provider-side webhook configuration to the new secret only after the new application version is healthy.
4. Confirm that fresh supported deliveries continue to persist with `signature_status = verified`.
5. If verification fails, roll back the application secret and provider-side secret together. Do not leave the system in a split-secret state.

## Prod credential approval and rollback
1. Confirm the issue has an explicit `prod-access:approved` gate before any production credential is activated.
2. Verify the production path uses the broker boundary or secret manager delivery path only; never promote a sandbox secret alias into production by renaming metadata.
3. Capture the approval actor, provider environment, intended rollback owner, and go-live checklist in the release log before activation.
4. If production validation fails, revoke or disable the production credential first, then roll back the application/config change.
5. Keep the issue blocked until both the credential state and the application state are back to a known-good configuration.

## Raw inbox replay / redrive
1. Inspect the stuck row in `raw_event_inbox` and confirm `processing_status`, `processing_attempt_count`, `last_error`, `signature_status`, and `replay_window_valid`.
2. Only redrive rows that were already durably persisted by the HTTP edge. Do not re-send provider deliveries just to recover worker processing.
3. For a pure retry, clear the terminal worker error by setting `processing_status = 'failed'` and `last_error = null`, then restart the inbox processor or run the local processor loop.
4. For malformed or incomplete rows, patch only the minimal persisted fields required for deterministic normalization, then redrive the existing row instead of inserting a new delivery.
5. Preserve `delivery_id`, `raw_body`, `request_headers`, `signature_status`, and the first-seen audit timestamps. Redrive must not destroy audit provenance.
6. Treat `replay_window_valid = false` on Linear rows as an intentional ignore signal. Do not force such rows back into downstream normalization unless a separate incident process explicitly approves it.

## Phase 4 registry seed / backfill procedure
1. Apply the Phase 4 schema migration in the target environment before seeding registry or snapshot data.
2. Seed `repository_registry` from the approved repo inventory and verify each row has a canonical `repo_slug`, GitHub coordinates, default branch, and Obsidian root note.
3. Seed `project_repository_mappings` from the approved Linear project inventory and verify each project has at most one `primary` mapping.
4. Backfill `linear_issue_contract_snapshots` only from normalized issue contract sources. Do not store raw Linear description bodies as the canonical machine-readable contract.
5. Verify seed and backfill jobs are idempotent: re-running them must update nothing or insert only previously missing rows.

## Phase 4 knowledge-note snapshot refresh / redrive
1. Run the trusted-local `knowledge-sync` process on a machine that has access to the local Obsidian vault.
2. Refresh note snapshots from the canonical root notes and allowed one-hop links only. Resolve short wiki-links against the current note directory first, then unique basename fallback, and do not allow unrestricted graph crawls during recovery.
3. Preserve note source metadata, content hashes, and source-updated timestamps when redriving snapshots.
4. If a note exceeds the configured max size or fails sanitization, mark it with an explicit status and keep the failure visible for operators instead of silently omitting it.
5. Re-run the same sync batch after fixing note content and confirm the snapshot hash changes deterministically and that later runs continue making forward progress when the vault exceeds one batch.

## Phase 4 context-pack cache rebuild
1. Rebuild context packs from persisted issue-contract snapshots, repository mappings, newest valid note snapshots, relevant comments, and repo guidance only.
2. Compute a new `input_fingerprint` for every rebuild candidate before writing a new cache row.
3. Never mutate an existing `context_pack_cache` row in place. Supersede it by writing a new immutable row and marking the older row with `superseded_at` when appropriate.
4. Confirm that unchanged inputs produce the same fingerprint and no duplicate active bundle is written.
5. Confirm that changed contract, comment, note-snapshot, or repo-guidance inputs produce a new immutable cache row and that same-fingerprint rebuilds remain no-ops.

## Phase 4 degraded-mode guidance
1. If note snapshots are stale or unavailable, fail closed when the missing data includes the required primary repository root note, but prefer the newest valid `fresh` snapshot for optional notes when one exists.
2. If only optional shared-note links are missing, keep the context pack build eligible but record the missing note in `source_trace` warnings.
3. Do not fall back from cloud services to direct filesystem vault reads. The cloud path must remain Postgres-snapshot-only, even in degraded mode.
4. If a rebuild cannot produce a valid context pack, surface the deterministic error contract rather than shipping a partial prompt with unknown omissions.

## Phase 4 pre-promotion inspection
1. Inspect the assembled context pack for one representative issue before promoting Phase 4 behavior.
2. Verify the bundle contains:
   - the normalized issue contract;
   - repository resolution output;
   - summary-first `decision_summary`;
   - bounded newest-first `latest_relevant_comments` limited to operator-significant classifications;
   - bounded `docs_pack`;
   - bounded repo guidance;
   - explicit `budgets`;
   - explicit `source_trace`.
3. Verify the bundle does not contain raw webhook payloads, full comment logs, unbounded note bodies, or secrets.
4. Verify the `source_trace` points back to the exact snapshot and guidance inputs used for the bundle.
5. Only promote Phase 4 after the operator can repeat the same build and obtain the same fingerprint from unchanged inputs.

## Phase 5 pre-promotion checklist
1. Verify the target environment runs the real Phase 5 workflow set rather than the bootstrap-only stub.
2. Verify the worker registers both `IssueLifecycleWorkflow` and `CommentResponseWorkflow`.
3. Verify lifecycle command dispatch uses the canonical workflow ID and idempotent start behavior.
4. Verify one bootstrap flow and one comment/manual-input flow reach Temporal from persisted inputs and produce the expected lifecycle state in Postgres.
5. Verify duplicate ingress or redrive from persisted inbox rows does not create duplicate workflow executions, duplicate runs, or duplicate side effects.
6. Verify manual status changes still flow through validator-backed policy rather than direct runtime-table writes.
7. Verify the target environment has the expected Temporal namespace/task queue configuration and that the worker can poll it successfully.
8. Verify `apps/control-api` can still start, accept webhooks, and serve DB-backed lifecycle inspection while Temporal is unavailable.
9. Verify all `/internal` routes except `/internal/healthz` require `Authorization: Bearer <INTERNAL_API_BEARER_TOKEN>`.
10. If `create_runner_lease` / `release_runner_lease` remain noop-backed, make that limitation explicit in the release notes and exclude runner fulfillment from Phase 5 acceptance.
11. Verify the minimum observability surfaces are served from persisted DB truth and do not require Temporal UI access for operators.

## Phase 5 workflow recovery / redrive
1. Identify the issue ID, canonical workflow ID, most recent accepted command ID, and current lifecycle snapshot before taking recovery action.
2. Distinguish the failure class first:
   - workflow start failure;
   - activity failure;
   - outbox fulfillment failure;
   - duplicate-command suppression confusion;
   - worker outage / replay lag.
3. For failed workflow starts triggered by persisted ingress rows, redrive from the persisted inbox row or internal lifecycle command source. Do not re-send provider webhooks just to recreate the same start condition.
4. For failed activities, prefer retrying or replaying the workflow task path. Do not patch runtime-state tables directly unless an incident procedure explicitly authorizes DB surgery.
5. For outbox failures, recover through the outbox executor contract. Do not hide an outbox problem by manually mutating workflow state.
6. Record the recovery action, operator identity, and affected workflow IDs in the incident/release log.

## Phase 5 promotion blockers
- Duplicate ingress still creates duplicate workflows or duplicate runs.
- Worker replay or restart corrupts lifecycle state.
- Manual override bypasses validator-backed policy.
- The target environment can only run the bootstrap stub and not the real lifecycle workflows.
- Release messaging claims runner execution readiness while runner commands are still noop-backed.

## Phase 6 pre-promotion checklist
1. Verify the target environment includes the Phase 6 schema for `workflow_role_execution_policies`, `runner_nodes`, `runner_capabilities`, `runner_leases`, and `runner_lease_attempts`.
2. Verify the published workflow-config fingerprint changes when `role_execution_policies.yaml` changes and that policy-only changes cannot be silently treated as identical content.
3. Verify published role policies are keyed by `owner_role` and expose `primary_provider`, `secondary_provider`, `fallback_triggers`, `max_provider_failovers`, `mcp_profile_ref`, and `required_capabilities`.
4. Verify one Codex-capable runner host and one Claude-capable runner host can authenticate, register, and publish manifests exactly once each.
   Run the live-proof from a prepared local env file; `corepack pnpm test:phase6:live` loads `.env.local` first and then `.env`.
5. Verify lease routing uses persisted capability truth, role execution policy truth, required capabilities and concurrency limits and never dispatches a task to an incompatible provider or runner.
6. Verify the repository exposes documented runner-host start entrypoints and a deterministic fake-runner/fake-MCP smoke path suitable for Phase 6 promotion checks, and that `RUNNER_MCP_COMMANDS_JSON` is present while the live harness verifies the effective Codex/Claude commands are available. `CODEX_CLI_BIN` and `CLAUDE_CLI_BIN` remain optional probe overrides when the runner-host config already supplies defaults.
   Repo-owned `node dist/...` wrapper commands are expected to resolve correctly from either repo-root or package-root launches.
7. Verify one representative build task reaches `requested -> acquired -> execution_started -> completed/released` with a durable artifact bundle reference.
8. Verify one representative review task reaches `acquired -> execution_started -> completed` on the Claude host and leaves durable `runner_artifact_bundle`, `agent_execution_metadata`, `review_report`, and `verification_result` evidence.
9. Verify only `quota_exhausted`, `rate_limited_exhausted`, `auth_unavailable`, `provider_unhealthy`, and `no_eligible_runner` can trigger automatic cross-provider fallback before `execution_started`, and that transient transport/worker failures retry on the same provider first.
10. Verify a fallback-eligible pre-start failure opens a new `runner_lease_attempts` row and leaves a durable attempt trail with `provider_attempt_no`, `fallback_from_provider`, `fallback_reason`, `execution_session_key`, `mcp_profile_ref`, and `mcp_bindings_summary`.
11. Verify a started attempt without checkpoint does not auto-fail over across providers.
12. Verify heartbeat loss is surfaced as an operator-visible degraded lease condition first, and only then resolves to `expired` or a reopened recovery attempt after the grace period according to `supportsCheckpointResume`.
    Short-lived attempts must still persist at least one MCP pool heartbeat snapshot immediately after `execution_started`, so `/internal/runners/mcp-pool` remains inspectable even when completion happens before the regular heartbeat interval.
13. Verify cancellation requests become durable lease state and produce an explicit runner outcome through the runner-host cancel acknowledgement path.
14. Verify host-group routing boundaries are inspectable through `/internal/runners/mcp-pool` and `/internal/runners/leases/:leaseId`, that the build and review live-proof hosts use different `host_group_id` values, and that shared MCP bindings and `sessionCounts` are never reused across those boundaries.
15. Verify terminal completion is accepted only after durable artifact/blob references exist and duplicate completion cannot create divergent final results.
16. Verify the target environment surfaces runner inventory, active leases, expired leases, `fallbackTriggeredCount`, `fallback_reason`, `mcp_pool_reuse_ratio`, `shared_mcp_process_count`, and `provider_limit_exhaustion_events`.
    Current operator surfaces include `/internal/runners/metrics/provider-failover`, `/internal/runners/mcp-pool`, and `/internal/runners/leases/:leaseId`.
17. Verify release notes do not claim PR/check/deploy integration as part of Phase 6 readiness.

## Phase 6 runner recovery / redrive
1. Identify the lease ID, issue ID, run ID, assigned runner node, last heartbeat timestamp, and last durable execution state before taking action.
2. Distinguish the failure class first:
  - runner never acquired the lease;
  - runner acquired but never started execution;
  - heartbeat loss during execution;
  - `quota_exhausted`, `rate_limited_exhausted`, `auth_unavailable`, `provider_unhealthy`, or `no_eligible_runner` before execution start;
  - transient transport or worker failure that must retry on the same provider first;
  - artifact upload/result reporting failure;
  - duplicate completion delivery;
  - control-plane routing or capability mismatch.
3. For heartbeat loss, prefer marking the lease degraded/expired and re-queueing a new attempt instead of mutating the existing lease into success.
4. For provider exhaustion or provider unavailability, allow automatic cross-provider failover only if the failure class is in policy and the attempt has not started execution, or if a durable checkpoint exists and resume is supported.
5. For artifact/reporting failures, recover from the durable lease/execution records and artifact references; do not assume the provider-side process result without a durable report.
6. For capability mismatches, drain or disable the offending runner node before re-routing work.
7. For MCP pool incidents, restart or drain the affected runner host; do not reclassify the logical lease as successful just because a shared MCP process was recycled.
8. For stuck cancellation, inspect whether the runner-host ever emitted a cancel acknowledgement; do not infer success from a mere `cancellation_requested` state.
9. Record the recovery action, operator identity, affected lease IDs and runner node IDs in the incident/release log.

## Phase 6 promotion blockers
- Runner manifests are missing, malformed or ambiguous.
- Lease routing can dispatch work to the wrong provider or an incompatible runner.
- Heartbeat loss is not operator-visible.
- A granted lease can be mistaken for completed execution.
- Artifact bundle persistence is non-deterministic or lossy.
- Cancellation or interrupt requests disappear without a durable outcome.
- Provider failover is invisible, unauditable or bypasses lifecycle truth.
- Shared MCP reuse is not measurable or same-repo fan-out still spawns redundant `serena` processes on one host.

## Phase 7 pre-promotion checklist
1. Verify the target environment already passes the full Phase 6 deterministic and live verification gates.
2. Run `node scripts/bootstrap-phase7-test-repo.mjs` and verify the canonical Phase 7 reference repo is fixed to `test_repo` in `repository_registry` with trusted-host checkout path supplied by `PHASE7_TEST_REPO_PATH`, defaulting to `/tmp/ai-dev-team/reference_repos/test_repo`.
3. Verify the smoke-path issue resolves to `test_repo` deterministically through issue-contract or project-mapping truth.
4. Verify the published workflow/config surface distinguishes build execution from review execution in a way that remains queryable and auditable after replay.
5. Verify the build task contract carries a frozen `contextPackRef` / `contextPackFingerprint` and the review task contract consumes that same frozen fingerprint plus the referenced build artifact bundle.
6. Verify one representative build execution reaches durable completion and produces summary, changed files, patch/diff reference, branch metadata and bounded test results.
7. Verify one representative review execution reaches durable completion and produces a review disposition, decision summary and structured findings tied to the build artifact bundle it inspected.
8. Verify review completion moves the issue to `Needs Human Decision` without manual DB edits, lease surgery or out-of-band operator glue.
9. Verify Linear write-back is enabled with `LINEAR_API_TOKEN` and that duplicate completion or replay cannot create duplicate operator-facing review-summary comments.
10. Verify operator inspection can answer which frozen context pack was used, which build artifact was reviewed and why the issue now requires human decision.
11. Verify release notes do not claim GitHub App auth, draft PR creation, check sync, merge gates or deploy automation as part of Phase 7 readiness.
12. Verify the repo exposes a dedicated deterministic `test:phase7` gate and a live `test:phase7:live` gate before promotion.
13. Verify `corepack pnpm run verify:phase7:promotion` passes end-to-end.

## Phase 7 build/review recovery / redrive
1. Identify the issue ID, build execution ID, review execution ID, frozen `contextPackFingerprint`, build artifact bundle ID and latest lifecycle snapshot before taking action.
2. Distinguish the failure class first:
   - build execution failed before artifact completion;
   - build execution completed but review did not start;
   - review execution failed before durable result ingestion;
   - review result was durably stored but Linear write-back failed;
   - duplicate result delivery or replay caused conflicting operator-visible output;
   - reference-repo or context-pack resolution drift invalidated the cycle.
3. For build execution failures, recover from the existing lease/run truth and worktree/artifact records. Do not bypass the platform by manually patching issue status to `Agent Review`.
4. For review-start failures, redrive from the persisted `agent_review` bridge state or review command source. Do not recreate the path by manually posting operator comments.
5. For review-result ingestion failures, recover from the durable review artifact bundle or runner completion payload. Do not infer success from provider-side stdout alone.
6. For Linear publication failures, redrive the outbox/state-sync path. Do not paste manual summary comments that bypass idempotency and audit truth.
7. If frozen context or reference-repo inputs were wrong, close the broken cycle explicitly and start a new build/review cycle with a new context fingerprint rather than mutating the existing cycle in place.
8. Record the recovery action, operator identity and affected issue/run/artifact IDs in the incident/release log.

## Phase 7 promotion blockers
- The canonical reference repo is not fixed, not fresh, or not resolvable deterministically from persisted truth.
- Review remains a status label without a first-class runtime execution/result contract.
- Provider execution still ignores the frozen context reference carried by the task envelope.
- Review completion cannot drive `Needs Human Decision` without manual orchestration outside the platform.
- Linear write-back for review summaries/findings is noop-backed, lossy or non-idempotent.
- Operators cannot reconstruct which build artifact bundle was reviewed or which frozen context pack was used.
- Release messaging claims PR/check/deploy automation before Phase 8 exists.

## Release artifacts for shipped Phase 3
- YAML-backed workflow config under `config/workflow/`.
- Immutable workflow-config publish flow in `packages/db`.
- Postgres schema for runtime state, runs, audit, artifacts, outbox, and projections.
- Non-deterministic workflow application services in `apps/workflow-worker`.
- Outbox executor with retry and dead-letter semantics in `apps/workflow-worker`.
- Read-only inspection routes in `apps/control-api`.
- Webhook ingress routes in `apps/control-api` for Linear and GitHub.
- `raw_event_inbox` and `comment_log` persistence in `packages/db`.
- Inbox processor normalization loop in `apps/workflow-worker`.
- CI workflow with dedicated Postgres-backed integration job.

## Release artifacts for shipped Phase 4 plus shared observability foundation
- Repository-registry schema and helpers in `packages/db`.
- Shared repository-registry, note-snapshot, and context-pack DTOs in `packages/shared`.
- Phase 4 repository and context-pack inspection surface in `apps/control-api`.
- Trusted-local `knowledge-sync` entrypoint for moving Obsidian note snapshots into Postgres.
- Deterministic context-pack builder and immutable cache semantics.
- Operator-visible runbooks for registry seed, note-snapshot refresh, cache rebuild, and degraded-mode handling.
- Phase 5 minimum observability foundation: lifecycle snapshot, issue journey, system-health, stuck-issues, and `agent_execution_metadata`.

## Release artifacts expected when Phase 5 ships
- Real `IssueLifecycleWorkflow` and `CommentResponseWorkflow` registrations in `apps/workflow-worker`.
- Activity wrappers over validator-backed transition application and run-lifecycle services.
- Lifecycle command DTOs and explainable response contracts.
- Idempotent lifecycle command dispatch from persisted inputs into Temporal.
- Authenticated internal operator/query routes and DB-backed lifecycle inspection surfaces.
- Operator-visible lifecycle inspection and workflow recovery guidance.

## Release artifacts expected when Phase 6 ships
- Runner policy, registry, logical-lease and attempt schema and DB helpers in `packages/db`.
- Shared capability manifest, lease/task/result DTOs and `AgentExecutionMetadataV2` in `packages/shared`.
- One Codex-capable `apps/runner-host` and one Claude-capable `apps/runner-host` using the shared protocol.
- Host-level MCP pool manager with explicit sharing scopes and deterministic reuse keys.
- Repo-owned Codex and Claude adapter entrypoints that honor `RUNNER_MCP_COMMANDS_JSON`, `CODEX_CLI_BIN`, and `CLAUDE_CLI_BIN`.
- Dedicated runner-host protocol routes and auth separation in `apps/control-api`.
- Documented runner-host start entrypoints plus deterministic fake-runner/fake-MCP smoke/harness commands.
- Lease lifecycle metrics plus operator-visible runner/lease/failover/MCP inspection surfaces.
- Operator-visible recovery guidance for stuck, expired, failed and provider-exhausted leases.
- Integration-specific additions already staged by the current foundation pass:
  - metadata-only auth plane tables and inspection routes;
  - public OAuth callback capture endpoint;
  - sanitized integration artifacts in context-pack assembly.

## Release artifacts expected when Phase 7 ships
- Canonical Phase 7 build/review contract in the Obsidian architecture docs plus repo-local Phase 7 runbooks.
- One documented canonical reference repo and smoke issue path.
- Versioned build and review task/result payload contracts in `packages/shared`.
- Persisted build/review execution distinction and artifact linkage in `packages/db`.
- Review completion bridge from runtime result to lifecycle/outbox truth in `apps/workflow-worker`.
- Idempotent Linear review-summary publication path using `LINEAR_API_TOKEN`.
- Deterministic `test:phase7` gate plus one live local `test:phase7:live` proof path on the canonical reference repo.

## Rollback guidance
- Revert the release commit.
- Re-run the previous known-good deployment.
- If a schema migration was applied and must be reversed before release, execute the matching down migration manually before re-deploying.
- Never mutate or delete published workflow-config rows. Config rollback is publish-forward only: publish a new higher `config_version` that supersedes the prior active set.
- Preserve `raw_event_inbox` rows during rollback; they are replayable audit records and should not be truncated as part of an application rollback.
- Keep provider webhook endpoints on the last known-good secret during rollback. Secret rollback and application rollback must stay paired.
- For Phase 4, never delete prior `context_pack_cache` rows as part of rollback. Roll back by stopping the new builder behavior and rebuilding forward with a corrected fingerprinted input set if needed.
- For Phase 5, do not “fix” stuck workflow state by direct DB mutation unless an incident procedure explicitly allows it and the workflow has been accounted for separately.
- For Phase 6, do not mark a lease successful or released by direct DB surgery unless an incident procedure explicitly allows it and the runner-side execution state has been independently accounted for.
- If worker code and already-started workflow histories are incompatible, stop new lifecycle command dispatch, drain or recover the affected workflow set deliberately, and only then roll back code.
- Workflow/config rollback remains publish-forward for business semantics: never mutate historical audit or published config rows to fake compatibility.
