# F10 — Repo/Project Registry Resolver

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Resolves mappings from issue/project/area to primary_repo, affected_repos, service_dependencies, required_checks, and environments using the Repository Registry.
- Why: Key layer for multi-repo routing. Without deterministic repo resolution, agents guess where to work and break cross-repo dependencies.

## When To Use
- When a task needs to resolve which repositories are affected and what their dependencies are.
- When building a context pack that requires cross-repo dependency information.
- When determining which CI checks, environments, and services are involved in a task.
- Do NOT use for single-repo tasks where the repo is already known with high confidence — only invoke when routing or dependency mapping is needed.

## Inputs
- Issue contract: `project_id`, `area`, `component`, `service`, task labels.
- Repo mapping result from IntakeAgent (if available — provides initial `primary_repo` hint).
- Repository Registry source of truth (Postgres phase 4 registry per project profile).

## Steps

1. **Accept routing query** — receive the issue contract fields (`project_id`, `area`, `component`, `service`) and any initial repo hint from IntakeAgent.
2. **Query the Repository Registry** — using `repo-registry-mcp`, resolve:
   - `primary_repo`: the main repository for this task based on project mapping rules.
   - `affected_repos`: all additional repos that may need changes or that provide dependencies.
   - Resolution order: `issue_contract.primary_repo` → `issue_contract.affected_repos` → `project_repository_mappings.primary`.
3. **Resolve service dependencies** — for each identified repo, query the registry for:
   - Upstream and downstream service dependencies.
   - Shared libraries or packages.
   - Cross-repo API contracts.
4. **Resolve required checks** — determine which CI pipelines, test suites, and quality gates apply to each repo.
5. **Resolve environments** — identify target environments (staging, production, sandbox) and any environment-specific constraints.
6. **Resolve ownership** — determine `team_id`, `project_id`, `repo_kind` for each repo in the set.
7. **Compute confidence** — assign a confidence score to the resolution:
   - **High**: issue contract explicitly names the repo and registry confirms.
   - **Medium**: registry mapping resolved by area/component heuristic.
   - **Low**: fallback resolution with limited matching criteria.
8. **Produce routing explanation** — document how the resolution was made, which rules fired, and what alternatives were considered.
9. **Emit structured output** — produce the dependency map with repos, deps, checks, environments, confidence, and routing explanation.

## Stop Conditions
- **Done** when primary_repo is resolved (or explicitly marked as unresolvable) and all affected repos have been identified.
- **Done** when service dependencies, required checks, and environments are resolved for each repo.
- **Stop and escalate** if primary_repo cannot be resolved at any confidence level — fail closed per layering policy.

## Escalation Rules
- Escalate when `primary_repo` cannot be resolved from any source (issue contract, registry mappings).
- Escalate when the Registry is unavailable or returns inconsistent data.
- Escalate when a resolved repo does not exist in the registry (stale mapping).
- Do NOT escalate for missing affected_repos if the primary_repo is resolved — note them as `known_unknown` and proceed.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not guess repos.** If the registry cannot resolve a mapping, escalate — don't infer from file names or project names.
- **Do not hardcode repo paths.** Always resolve through the registry.
- **Do not ignore low-confidence resolutions.** Surface them in the routing explanation so downstream agents can verify.
- **Do not cache stale mappings.** Query the registry fresh for each task.

## Denied Actions
- Do not write code or patches.
- Do not modify the Repository Registry.
- Do not fabricate dependency information that the registry does not provide.
