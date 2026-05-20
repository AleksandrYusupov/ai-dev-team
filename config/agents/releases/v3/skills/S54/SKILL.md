# S54 — Integration Go-Live, Observability & Rollback Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Produces a complete rollback and observability plan for integrations: circuit breaker configuration, health check endpoints, degraded-mode behavior, automatic rollback triggers, post-launch monitoring window, and manual rollback procedure.
- Why: External integrations have vendor-dependent failure modes that require explicit circuit breakers, degraded-mode definitions, and time-boxed post-launch monitoring — code and tests alone do not cover post-deploy survivability.

## When To Use
- When an integration is preparing for production deployment and needs a complete observability and rollback plan (typically after S53 checklist).
- When BuildAgent-Integrations (A08) or IntegrationAgent (A21) needs to define circuit breaker, health check, and degraded-mode specifications.
- When ReleaseAgent (A15) or MonitoringAgent (A16) needs rollback triggers and post-launch monitoring parameters for an external integration.
- Do NOT use for internal service rollback — this skill is specifically for external vendor integrations with third-party failure modes.

## Inputs
- Integration spec: provider name, API endpoints, expected traffic volume, SLA requirements.
- Circuit breaker configuration: error rate threshold, evaluation window, half-open probe interval.
- Health check definition: endpoint URL, expected response, check interval, failure threshold.
- Degraded-mode behavior spec: what the application does when the integration is unavailable.
- Rollback trigger criteria: error rate, latency, auth failure count, manual override.
- Post-launch monitoring parameters: window duration, key metrics, alert thresholds.

## Steps

1. **Define circuit breaker configuration** — specify for each integration endpoint:
   - Error rate threshold that trips the breaker (recommend: 50% errors over 60-second window).
   - Evaluation window duration and minimum request count for statistical significance.
   - Half-open state: probe interval (recommend: 30 seconds), success count to close (recommend: 3 consecutive).
   - Open state behavior: fail-fast with cached response, fallback, or queue for retry.
   - Record: endpoint, thresholds, states, transitions, fallback behavior.
2. **Specify health check endpoints** — define for the integration:
   - A synthetic health check that validates connectivity and authentication without side effects.
   - Expected healthy response: status code, response time threshold (recommend: <2 seconds), body pattern.
   - Check interval (recommend: 30 seconds) and failure threshold before marking unhealthy (recommend: 3 consecutive).
   - Integration with the platform health system (status page, load balancer, orchestrator awareness).
   - Record: health check URL alias, interval, thresholds, escalation on persistent failure.
3. **Document degraded-mode behavior** — define what the application does when the integration is down:
   - User-facing behavior: error message, reduced functionality description, ETA communication.
   - Data handling: queue writes for retry, serve cached data, or block the operation entirely.
   - Dependent features: list all features affected and their individual degraded behavior.
   - Recovery behavior: how the application resumes normal operation when the integration recovers.
   - Record: feature list, degraded behavior per feature, recovery strategy, user communication.
4. **Configure automatic rollback triggers** — define thresholds that trigger automatic rollback:
   - Error rate trigger: >X% errors sustained for Y minutes (recommend: >10% for 5 minutes).
   - Latency trigger: p95 latency >X ms sustained for Y minutes (recommend: >3x baseline for 5 minutes).
   - Auth failure trigger: >0 auth failures in Z-minute window (recommend: any auth failure in 5 minutes).
   - Webhook delivery failure trigger: >X% delivery failures over Y minutes (recommend: >20% for 10 minutes).
   - Manual rollback: always available, documented as a one-command or one-click action.
   - Record: trigger type, threshold, evaluation window, action (disable integration, revert deploy, or both).
5. **Define post-launch monitoring window** — specify the observation period after go-live:
   - Window duration (recommend: 72 hours for new integrations, 24 hours for updates).
   - Key metrics to watch: error rate, latency p50/p95/p99, auth success rate, webhook delivery rate.
   - Alert thresholds during the window (tighter than steady-state; recommend: 50% of normal thresholds).
   - Responsible party for monitoring during the window (on-call, integration owner, or dedicated watcher).
   - Exit criteria: what defines "monitoring window passed" (all metrics within thresholds for the full window).
   - Record: window duration, metrics, thresholds, responsible party, exit criteria.
6. **Document manual rollback procedure** — produce a step-by-step runbook:
   - Step 1: Disable the integration feature flag or disconnect the endpoint.
   - Step 2: Verify traffic is no longer reaching the integration (check dashboards).
   - Step 3: Revert deployment if code changes are involved (deploy previous version).
   - Step 4: Drain any queued work or route it to fallback handling.
   - Step 5: Notify stakeholders (automated alert or manual communication).
   - Step 6: Confirm rollback is complete (health checks green, error rate normalized).
   - Estimated total time: document expected duration (recommend: <15 minutes).
   - Record: runbook steps, estimated time, verification checks, notification targets.
7. **Produce observability and rollback plan** — emit `integration_observability_rollback_plan` containing:
   - Circuit breaker configuration per endpoint.
   - Health check specification.
   - Degraded-mode behavior matrix (feature x degraded behavior).
   - Automatic rollback trigger table (trigger x threshold x action).
   - Post-launch monitoring window parameters.
   - Manual rollback runbook.
   - Overall plan readiness verdict: `complete`, `incomplete` (with missing items listed).

## Stop Conditions
- **Done** when all six plan sections are documented and the combined plan is emitted.
- **Incomplete** if any section cannot be defined due to missing integration specs — document what is missing and block go-live on those items.
- **Never deploy without at least a manual rollback procedure.** Automatic triggers are strongly recommended but manual rollback is mandatory.

## Escalation Rules
- Escalate when no degraded-mode behavior is defined and the integration affects user-facing features.
- Escalate when automatic rollback triggers cannot be configured due to platform limitations.
- Escalate when the post-launch monitoring window is shorter than 24 hours for a new integration.
- Do NOT escalate for integrations with well-tested rollback paths and existing circuit breakers being updated.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not define "rollback = redeploy" without specifying what to redeploy and how to verify.** Rollback must be a concrete runbook.
- **Do not skip degraded-mode definition.** "The feature just breaks" is not an acceptable degraded-mode behavior.
- **Do not set post-launch monitoring to zero.** Every integration launch needs an observation window.
- **Do not include raw credentials or signing secrets in the observability plan.** Use aliases, dashboard links, and metric names only.

## Denied Actions
- Do not deploy an integration without at least a manual rollback procedure on record.
- Do not store or log raw credentials, tokens, or signing secrets in any plan output.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
