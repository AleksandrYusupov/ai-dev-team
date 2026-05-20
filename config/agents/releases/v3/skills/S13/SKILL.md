# S13 — Dependency & Sequence Planner

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Строит dependency graph и рекомендует последовательность выполнения.
- Why: Снижает блокировки и rework.

## When To Use
- When S12 has produced a set of sub-issues that need ordering into an execution plan with explicit dependency edges.
- When a plan involves three or more sub-issues and the execution order is not obvious from the decomposition alone.
- When integration tasks require credential provisioning, consent flows, or external vendor steps that create hard blockers.
- Do NOT use for plans with two or fewer sub-issues where the sequence is trivially linear — just order them directly.

## Inputs
- Sub-issue list: structured output from S12 including id, repo, component, agent_profile, inputs, outputs, and parallel_group. Source: S12 output.
- Repo ownership map: mapping of repos to agent profiles and component boundaries. Source: project configuration.
- External blocker registry: known human gates, vendor SLAs, credential provisioning steps, and consent requirements. Source: project configuration or issue contract annotations.
- Prior execution plan (if re-invoking): previous DAG to update based on new sub-issues or changed constraints.

## Steps

1. **Build the raw dependency graph** — for each sub-issue, examine its `inputs` and `outputs` fields. Create a directed edge A -> B when:
   - B's `inputs` include an artifact that A's `outputs` produce
   - B modifies a component that A is also modifying (merge conflict risk)
   - B's acceptance criteria reference a state that A establishes
   - Record each edge with a label describing the dependency reason.
2. **Classify dependency types** — for each edge in the graph, assign one of three types:
   - `hard`: A must fully complete and be merged before B can start. Examples: schema migrations, shared contract definitions, credential provisioning, consent steps.
   - `soft`: A should complete before B, but B can start with stubs or mocks. Examples: API implementation where B can code against the contract before A's implementation is merged.
   - `external`: dependency on a human action, vendor response, or third-party system. Examples: API key provisioning, legal consent, infrastructure access grants.
   - Rule: credential prerequisites and consent steps are always classified as `hard`.
3. **Detect cycles** — scan the graph for circular dependencies. If a cycle is found:
   - Attempt to break it by reclassifying one edge from `hard` to `soft` (the weakest link)
   - If no edge can be safely downgraded, escalate — the decomposition from S12 needs revision
4. **Identify the critical path** — compute the longest chain of `hard` dependencies from any root node to any leaf node. This is the critical path that determines minimum total execution time. Mark all sub-issues on the critical path.
5. **Identify long poles** — find sub-issues that are:
   - On the critical path AND have complexity estimate `L`
   - Blocking three or more downstream sub-issues
   - Dependent on an `external` blocker with unknown or long SLA
   - These are high-risk items that deserve early attention or mitigation.
6. **Build parallel execution groups** — using the dependency graph, assign sub-issues to ordered waves:
   - Wave 0: sub-issues with no incoming `hard` edges (can start immediately)
   - Wave N: sub-issues whose `hard` predecessors are all in waves < N
   - Within each wave, all sub-issues can execute in parallel
   - Sub-issues with only `soft` incoming edges may optionally start one wave earlier (with stubs)
7. **Produce the execution plan** — output a structured sequence:
   - `dag_edges`: list of all edges with source, target, type, and reason
   - `critical_path`: ordered list of sub-issue ids on the critical path
   - `long_poles`: list of high-risk sub-issues with risk reason
   - `execution_waves`: ordered list of waves, each containing parallelizable sub-issue ids
   - `external_blockers`: list of external dependencies with owner, expected SLA, and mitigation
   - `estimated_total_waves`: number of sequential waves (minimum execution depth)
8. **Validate against S12 output** — verify that every sub-issue from S12 appears exactly once in the execution plan. Flag any orphaned sub-issues (not connected to the graph) or missing sub-issues.

## Stop Conditions
- **Done** when every sub-issue is assigned to an execution wave and all dependency edges are classified.
- **Done** when the critical path is identified and long poles are flagged.
- **Skip** if the sub-issue list contains two or fewer items — sequence them linearly without graph analysis.
- **Stop early** if a cycle cannot be broken without revising the decomposition — escalate to S12 for re-decomposition.

## Escalation Rules
- Escalate when a circular dependency cannot be resolved by reclassifying edges.
- Escalate when an external blocker has no identified owner or SLA.
- Escalate when the critical path exceeds the deadline implied by the parent issue contract.
- Escalate when a long pole sub-issue depends on an external blocker with SLA longer than the available time.
- Do NOT escalate for deep dependency chains — depth is expected in complex work. Escalate only for unresolvable cycles, missing owners, or timeline violations.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not treat all dependencies as hard.** Over-constraining the graph eliminates parallelism and slows execution.
- **Do not ignore soft dependencies.** They are real risks — track them even if they do not block wave assignment.
- **Do not forget external blockers.** Human gates and vendor dependencies are the most common source of delays.
- **Do not skip cycle detection.** A cyclic dependency graph produces an unexecutable plan.
- **Do not reorder sub-issues for convenience.** The graph determines the order — override only with explicit justification.
- **Do not merge the DAG back into a flat list.** The wave structure and edge types are the value of this skill.

## Denied Actions
- Do not modify or create sub-issues — this skill only sequences existing sub-issues from S12.
- Do not implement any sub-issue or write code.
- Do not resolve external blockers — only identify and document them.
- Do not change the parent issue contract or acceptance criteria.
