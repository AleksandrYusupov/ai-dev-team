# S04 — Docs & ADR Retriever

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Finds relevant ADRs, specs, runbooks, Obsidian notes, and READMEs by task area and component. Ranks results by recency, authority, repo/area match, and decision relevance.
- Why: Needed by ContextAgent, ArchitectAgent, and ReviewAgent. Architecture docs are the primary constraint source — finding the right ones is critical.

## When To Use
- When building a context pack that needs architecture documentation for a specific task area or component.
- When an agent needs to understand architectural constraints, boundaries, or operational procedures before acting.
- When a task involves an area where ADRs or specs may have been written but the agent doesn't know which ones.
- Do NOT use for finding code files — use repo navigation tools for that. This skill is for documentation retrieval.

## Inputs
- Task area/component/service identifier (from issue contract or repo mapping).
- Project KB root (from project profile — e.g., `ai_dev_team/00_overview`).
- Repo list: primary_repo and affected_repos (from F10 or repo mapping).
- Optional: specific doc types to prioritize (ADR, spec, runbook, architecture overview).

## Steps

1. **Identify search scope** — determine the KB root and entry note from the project profile. Scope the search to the project's knowledge base, not the entire vault.
2. **Navigate from entry note** — start at the project's entry note (e.g., `ai_dev_team/00_overview`) and follow links to find the relevant architectural area:
   - Component/module documentation
   - Service boundary specifications
   - Subsystem architecture notes
3. **Search by relevance signals** — query the knowledge base for documents matching:
   - Component or service name mentioned in the issue contract
   - Module paths affected by the task
   - Keywords from the task description
   - Recently updated documents in the affected area
4. **Rank results** — score each found document on four dimensions:
   - **Recency**: more recently updated documents score higher (captures current state)
   - **Authority**: ADRs and specs score higher than informal notes; docs linked from the entry note score higher
   - **Area match**: documents explicitly about the affected component/service score higher than tangentially related ones
   - **Decision relevance**: documents containing decisions, constraints, or invariants relevant to the task score higher
5. **Extract key content** — from the top-ranked documents, extract:
   - Key invariants and constraints
   - Boundary contracts (APIs, schemas, events, DB tables)
   - Non-functional requirements (performance, SLAs, rate limits)
   - Deployment and compatibility assumptions
   - Known limitations and gotchas
6. **Collect authoritative links** — record the Obsidian note path for each document used, so downstream agents can verify.
7. **Note gaps** — if expected documentation is missing (e.g., no architecture doc for a major component), record it as a `known_unknown` with `needs_missing_file` severity.
8. **Emit structured output** — produce an architecture summary section ready for inclusion in the context pack.

## Stop Conditions
- **Done** when the top-ranked documents have been retrieved and key content extracted.
- **Done** when gaps are identified and recorded.
- **Stop early** if the KB root or entry note is missing — escalate with `needs_missing_file`.
- **Stop at reasonable depth** — do not crawl the entire vault. Follow links from the entry note up to 3 levels deep for the relevant area.

## Escalation Rules
- Escalate when the KB root or entry note does not exist.
- Escalate when critical architecture documentation is expected but absent for a high-risk task area.
- Do NOT escalate for areas with sparse documentation in low-risk tasks — note the gap and proceed.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not retrieve every document in the vault.** Use ranking and relevance to return only what matters.
- **Do not return raw document dumps.** Extract key content and provide links for full reading.
- **Do not include documents from other projects' KB roots.** Cross-project isolation applies.
- **Do not treat old, unlinked notes as authoritative.** Prioritize documents connected to the entry note graph.

## Denied Actions
- Do not write or modify documentation — this skill is read-only.
- Do not create new Obsidian notes.
- Do not delete or archive documents.
