# S53 — Integration Go-Live & Observability Checklist

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Generates a go-live checklist for integrations: all credential prerequisites resolved, smoke tests passed, observability hooks installed, rollback plan documented, and human approval obtained.
- Why: Integrations that skip structured go-live review fail silently in production because missing prerequisites, absent monitoring, or unclear rollback paths are discovered only during incidents.

## When To Use
- When an integration has passed smoke testing (S52) and is a candidate for production deployment.
- When IntegrationAgent (A21) or OrchestratorAgent (A00) needs a structured gate before enabling an integration in production.
- When a previously live integration is being re-deployed after significant changes and needs re-validation.
- Do NOT use as a substitute for smoke testing — this skill assumes S52 has already run. Use S52 first, then S53.

## Inputs
- Integration smoke report: output from S52 (pass/fail status, environment confirmation).
- Credential readiness record: all required credential aliases resolved, rotation schedule set, expiry monitoring active.
- Observability configuration: dashboard links or specs, alert rules, log query templates.
- Rollback plan reference: documented rollback procedure, rollback trigger criteria, responsible party.
- Human approval record: approver identity, approval timestamp, approval scope (which integration, which environment).

## Steps

1. **Verify credential prerequisites** — confirm all production credentials are ready:
   - All required credential aliases exist in the production credential store.
   - Credentials have been rotated at least once (initial provisioning is not the production value).
   - Expiry monitoring is active — alerts fire before credential expiry (recommend: 14 days before).
   - Scopes match what the integration requires (no over-provisioned or under-provisioned access).
   - Record: credential alias list, rotation status, expiry dates, scope match (no raw values).
2. **Confirm smoke tests passed** — validate the S52 smoke report:
   - Overall smoke verdict is `passed` (not `partial_pass` or `failed`).
   - Smoke report timestamp is recent (within 48 hours; flag if older).
   - Smoke environment matches the expected sandbox for this integration.
   - Any previously flagged `partial_pass` items have been remediated and re-tested.
   - Record: smoke report reference, verdict, timestamp, remediation status.
3. **Verify observability hooks** — confirm monitoring and alerting are configured:
   - A dashboard exists showing: request volume, error rate, latency percentiles, auth failure count.
   - Alert rules are defined for: error rate spike (>5% over baseline), latency degradation (>2x p95), auth failures (>0 in 5min window), webhook delivery failures.
   - Log queries are documented for common troubleshooting scenarios (auth failures, API errors, webhook mismatches).
   - Health check endpoint is configured and monitored by the platform health system.
   - Record: dashboard link/ID, alert rule IDs, log query references, health check URL.
4. **Validate rollback plan** — confirm a rollback procedure is documented and actionable:
   - Rollback trigger criteria are defined (error rate threshold, latency threshold, manual trigger).
   - Rollback steps are documented as a numbered runbook (not just "revert the deploy").
   - Rollback has been tested or dry-run at least once (flag if not).
   - Responsible party for rollback execution is identified (on-call, integration owner, or specific person).
   - Estimated rollback time is documented (recommend: <15 minutes from decision to completion).
   - Record: rollback runbook reference, trigger criteria, responsible party, estimated time.
5. **Obtain human go-live approval** — confirm a human has explicitly approved:
   - Approver identity is recorded (name, role, or team).
   - Approval timestamp is recorded.
   - Approval scope is explicit: which integration, which provider, which environment (production).
   - Approval is conditional on all preceding checklist items being green (no overrides without escalation).
   - Record: approver identity, timestamp, scope, any conditional notes.
6. **Produce go-live checklist report** — emit `integration_go_live_checklist` containing:
   - Per-item status: `green` (ready), `yellow` (ready with caveats), `red` (blocked).
   - Overall go-live verdict: `approved`, `approved_with_caveats`, or `blocked`.
   - Blocking items with required remediation actions.
   - Human approval record attached as the final gate.

## Stop Conditions
- **Done** when all checklist items are evaluated and the report is emitted.
- **Blocked** if any item is `red` — the integration must not go live until remediation is complete.
- **Never bypass human approval.** Automated systems may prepare the checklist, but a human must sign off.

## Escalation Rules
- Escalate when smoke tests have not been run or the report is older than 48 hours.
- Escalate when production credentials are missing or have never been rotated.
- Escalate when no rollback plan exists or the rollback has never been tested.
- Do NOT escalate for `yellow` items that have documented caveats and an accepted risk owner.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not auto-approve go-live without human sign-off.** The checklist prepares the decision; a human makes it.
- **Do not accept stale smoke results.** Re-run S52 if the report is older than 48 hours.
- **Do not treat "observability will be added post-launch" as acceptable.** Monitoring must be in place before go-live.
- **Do not include raw credential values in the checklist report.** Aliases and metadata only.

## Denied Actions
- Do not approve go-live without explicit human approval on record.
- Do not store or log raw credentials, tokens, or signing secrets in the checklist output.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
