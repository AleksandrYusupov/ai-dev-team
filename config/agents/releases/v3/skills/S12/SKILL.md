# S12 — Work Breakdown & Sub-Issue Generator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Делит работу на milestones и sub-issues по repo/component/owner.
- Why: Ядро PlanAgent.

## When To Use
- When PlanAgent receives an approved issue contract that spans multiple repos, components, or agent profiles.
- When a task requires coordination across two or more BuildAgent specializations (e.g., backend + frontend + infra).
- When an issue is too large to be completed in a single atomic unit of work and needs decomposition into independently testable pieces.
- Do NOT use for single-repo, single-component tasks that map directly to one BuildAgent profile — assign those directly without decomposition.

## Inputs
- Issue contract: the approved task definition including type, area, component, acceptance criteria, and known constraints. Source: TriageAgent or human author via Linear.
- Repo ownership map: mapping of repositories to owning agent profiles and component boundaries. Source: project configuration / repo registry.
- Agent profile catalog: list of available BuildAgent profiles with their capabilities and repo scopes. Source: agent configuration.
- Prior decomposition (if re-invoking): previous sub-issue set to refine or extend based on feedback.

## Steps

1. **Parse the issue contract** — extract the scope of work from the issue contract. Identify:
   - Target repos (which codebases are touched)
   - Target components (which modules or services within each repo)
   - Required capabilities (backend, frontend, infra, data, etc.)
   - Acceptance criteria (what "done" looks like for the whole issue)
   - Known constraints (deadlines, feature flags, migration windows)
2. **Apply atomicity rules** — for each unit of work, verify it satisfies all atomicity constraints:
   - One repo per sub-issue (never cross repo boundaries in a single sub-issue)
   - One component per sub-issue (never mix unrelated modules)
   - One agent profile per sub-issue (the assignee must have full authority to complete it)
   - Independently testable (the sub-issue can be verified without waiting for other sub-issues)
   - Clear inputs/outputs (what artifacts the sub-issue consumes and produces)
3. **Identify integration prerequisites** — before implementation sub-issues, generate prerequisite sub-issues for:
   - Shared contracts (API schemas, protobuf definitions, event schemas)
   - Configuration scaffolding (env vars, feature flags, service registration)
   - Database migrations or schema changes that downstream work depends on
   - These prerequisites are always sequenced before their dependents.
4. **Identify parallelizable chunks** — group sub-issues that have no mutual dependencies into parallel execution groups. Two sub-issues are parallelizable when:
   - They touch different repos or different components within the same repo
   - Neither consumes an artifact produced by the other
   - They can be independently tested and merged
5. **Build the sub-issue list** — for each sub-issue, produce a structured record:
   - `id`: unique identifier within the parent issue (e.g., `PARENT-1`, `PARENT-2`)
   - `title`: concise description of the work
   - `repo`: target repository
   - `component`: target module or service
   - `agent_profile`: assigned BuildAgent profile
   - `inputs`: artifacts or preconditions this sub-issue requires
   - `outputs`: artifacts or state changes this sub-issue produces
   - `acceptance_criteria`: verifiable conditions for completion
   - `parallel_group`: which parallel execution group this belongs to
   - `estimated_complexity`: S / M / L based on scope
6. **Link to parent issue** — establish Linear parent/sub-issue relations:
   - Each sub-issue links back to the parent issue
   - Sub-issues within the same parallel group are noted as independent
   - Sub-issues with prerequisites reference their blockers explicitly
7. **Validate completeness** — verify that the union of all sub-issue acceptance criteria fully covers the parent issue acceptance criteria. If gaps exist, add missing sub-issues or flag incomplete coverage.

## Stop Conditions
- **Done** when every sub-issue satisfies atomicity rules and the full set covers the parent issue acceptance criteria.
- **Done** when integration prerequisites are identified and sequenced before their dependents.
- **Skip** if the issue maps to a single repo, single component, and single agent profile — pass it through as-is without decomposition.
- **Stop early** if the issue contract is ambiguous or missing acceptance criteria — escalate for clarification before decomposing.

## Escalation Rules
- Escalate when the issue contract lacks acceptance criteria or has contradictory requirements.
- Escalate when a required repo or component has no mapped agent profile in the catalog.
- Escalate when decomposition reveals scope that exceeds the original issue estimate by more than 3x.
- Do NOT escalate for large decompositions — many sub-issues are expected for cross-cutting work. Escalate only for missing information or ownership gaps.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not create sub-issues that cross repo boundaries.** One sub-issue = one repo, always.
- **Do not assign a sub-issue to an agent profile that lacks authority over the target repo/component.**
- **Do not skip integration prerequisites.** Shared contracts and migrations must be explicit sub-issues, not assumptions.
- **Do not create sub-issues without acceptance criteria.** Every sub-issue must be independently verifiable.
- **Do not over-decompose.** If a piece of work is already atomic, do not split it further just to increase the count.

## Denied Actions
- Do not implement any sub-issue — this skill only plans and creates issues.
- Do not modify code, configuration, or infrastructure.
- Do not assign sub-issues to human team members — only to agent profiles.
- Do not close or resolve the parent issue.
