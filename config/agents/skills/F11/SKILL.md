# F11 — Telemetry & Artifact Linker

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Links issue, workflow run, branch, PR, checks, deployment, dashboards, logs, and agent session external URLs into a coherent traceability chain.
- Why: Without end-to-end linking, humans lose observability over the agent system. Every artifact should be traceable back to its origin.

## When To Use
- When assembling a context pack that needs to reference existing engineering artifacts (branches, PRs, deployments).
- When a downstream agent needs to know what already exists for a task (to avoid duplicate work or to link new artifacts).
- When publishing context pack results back to Linear for operator visibility.
- Do NOT use for creating new artifacts — this skill links existing ones.

## Inputs
- Issue identifier (Linear issue ID or key).
- Workflow run ID (if available).
- Repo mapping result: primary_repo, affected_repos.
- Agent session correlation IDs (if available from prior runs).

## Steps

1. **Query existing artifacts** — search for artifacts already associated with this task:
   - Git branches matching the issue identifier or naming convention.
   - Open or merged PRs linked to the issue.
   - CI check runs and their statuses.
   - Deployment records (staging, production) if the task has reached that phase.
   - Dashboard or monitoring URLs relevant to the affected services.
2. **Collect agent session links** — if prior agent runs exist for this task, collect their correlation IDs and artifact references from the workflow engine.
3. **Build canonical URL set** — for each found artifact, produce a canonical URL:
   - Branch: `<git_host>/<org>/<repo>/tree/<branch>`
   - PR: `<git_host>/<org>/<repo>/pull/<number>`
   - Deployment: deployment URL from the deployment record
   - Dashboard: monitoring/dashboard URL from service configuration
   - Agent session: internal workflow run URL
4. **Verify link validity** — confirm that URLs point to existing resources (not deleted branches or closed deployments). Mark invalid links as `stale` rather than including broken references.
5. **Publish to Linear** — if configured, write canonical URLs back into the Linear issue as a structured comment or activity entry for operator visibility.
6. **Emit structured output** — produce a telemetry links section ready for inclusion in the context pack.

## Stop Conditions
- **Done** when all available artifact sources have been queried and valid links collected.
- **Done** when stale/invalid links are identified and marked.
- **Stop if** no artifacts exist for this task (new task) — emit an empty telemetry section with "no prior artifacts" note.

## Escalation Rules
- Escalate when the workflow engine is unavailable and prior run data cannot be retrieved.
- Do NOT escalate for tasks with no existing artifacts — this is normal for new tasks.
- Do NOT escalate for individual broken links — mark them as `stale` and proceed.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not include broken/stale URLs without marking them.** Downstream agents may try to use them.
- **Do not create new artifacts.** This skill is read-only for artifact discovery.
- **Do not embed full artifact content.** Include URLs and metadata, not the content of PRs or deployments.
- **Do not include links from other projects.** Cross-project isolation applies.

## Denied Actions
- Do not write code or patches.
- Do not create branches, PRs, or deployments.
- Do not modify existing artifacts.
