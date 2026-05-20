# F02 — Context Pack Builder

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Assembles a compact, deduplicated context pack from Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADRs, PLAN, SPEC, runbooks, project registry, and (for integration tasks) sanitized integration artifact references.
- Why: The best agent pipelines win on context quality, not model capability. A well-assembled context pack is the single biggest multiplier for downstream agent performance.

## When To Use
- When a downstream agent (SpecAgent, PlanAgent, BuildAgent-*, ReviewAgent, TestAgent) needs a structured context package before starting work.
- When a task transitions between workflow phases and context needs to be refreshed or re-scoped.
- When multiple sources (Obsidian, repo files, comments, registry) need to be merged into a single authoritative view.
- Do NOT use for ad-hoc queries — this skill produces a full structured artifact, not quick lookups.

## Inputs
- Architecture summary (from S04 retrieval): invariants, boundaries, NFR constraints, deployment assumptions.
- Effective conventions (from F03 interpretation): build/test commands, code style, patterns, error handling.
- Decision log (from F09 + S05): resolved decisions, unresolved questions, superseded items.
- Dependency map (from F10): service deps, required checks, environments.
- Telemetry links (from F11): branch/PR/deployment/dashboard URLs.
- Sanitized integration metadata (from F13): cleaned refs, redaction log.
- Issue contract: task scope, type, risk, labels, affected areas.
- Repo mapping result: primary_repo, affected_repos.

## Steps

1. **Receive assembled inputs** — collect all intermediate outputs from skills S04, S05, F03, F09, F10, F11, F13 that were run earlier in the ContextAgent execution sequence.
2. **Validate completeness** — check that all required sections have content or explicit `known_unknown` markers. If a critical section (architecture, conventions) is entirely empty, flag it in the decision summary.
3. **Deduplicate** — scan for repeated information across sections (e.g., the same constraint appearing in architecture AND conventions). Keep the most authoritative version and remove duplicates.
4. **Structure the pack** — organize into canonical sections: `meta`, `architecture`, `conventions`, `decisions`, `dependencies`, `telemetry`, `known_unknowns`, `integration_metadata`, `authoritative_links`.
5. **Compact** — ensure each section is a structured summary, not a raw dump. Architecture constraints should be bullet-pointed invariants, not full document copies. Conventions should be actionable rules, not prose.
6. **Add authoritative links** — for every major claim in the pack, include the source path (Obsidian note, repo file, registry entry) so downstream agents can verify.
7. **Compute fingerprint** — generate a SHA-256 fingerprint of the assembled pack for audit traceability.
8. **Emit artifact** — produce the `context_pack` as a typed output artifact with the canonical structure.

## Stop Conditions
- **Done** when the context pack contains all available sections, is deduplicated, has authoritative links, and has a computed fingerprint.
- **Done** when all known unknowns are explicitly surfaced with severity classification.
- **Stop early** if no required inputs are available and escalation has been triggered — do not produce a partial pack without flagging it.

## Escalation Rules
- Escalate when source-of-truth inputs are missing, contradictory, or blocked by a human-owned zone.
- Escalate when both architecture AND conventions sections are empty — this indicates upstream retrieval failure, not a normal gap.
- Do NOT escalate for individual missing optional sections (telemetry, integration metadata) — mark as `known_unknown` and proceed.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not paste raw documents into the pack.** Summarize and structure. A 2000-line raw Obsidian dump is a failure.
- **Do not fabricate context.** If a source is unavailable, mark it as `unknown` — never invent constraints or conventions.
- **Do not include content from other projects.** The pack serves exactly one project's context boundary.
- **Do not skip deduplication.** Repeated information wastes context window and confuses downstream agents.

## Denied Actions
- Do not write code or patches.
- Do not include raw secrets, tokens, or credential values.
- Do not produce the pack without running F13 (auth data boundary) first.
