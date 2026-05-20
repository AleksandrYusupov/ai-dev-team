# S02 — Duplicate & Similar Issue Detector

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Ищет дубликаты, близкие прошлые задачи, связанные PR/incident/postmortem.
- Why: Снимает шум в Triage.

## When To Use
- When a new issue is created and needs to be checked against the existing corpus before triage proceeds.
- When IntakeAgent suspects a recurring problem pattern and needs to surface related historical context.
- When an incident is reported and related past incidents, postmortems, or fixes need to be found quickly.
- Do NOT use for general knowledge retrieval — this skill searches structured issue/PR/incident records, not documentation.

## Inputs
- Candidate issue: title, description, labels, affected area (from the incoming issue payload).
- Issue corpus index: searchable index of all open and recently closed issues from Linear (from vector store or search API).
- PR corpus index: titles, descriptions, and linked issues from GitHub PRs in the last 90 days (from GitHub search API cache).
- Incident records: past incident titles, severity, root cause summaries, postmortem links (from incident management system or indexed store).
- Similarity threshold configuration: configurable float, default 0.85 for exact duplicate, 0.60 for related (from agent config or env).

## Steps

1. **Normalize candidate** — extract a clean searchable representation from the incoming issue. Strip markdown formatting, code blocks, and boilerplate templates. Produce a normalized title and a normalized description body for matching.
2. **Generate embedding** — compute a semantic embedding vector for the normalized candidate using the configured embedding model. This vector is the primary input for similarity search.
3. **Search issue corpus** — run a semantic similarity search against the Linear issue index. Retrieve the top 10 results ranked by cosine similarity. For each result, record: issue ID, title, status, similarity score, and creation date.
4. **Search PR corpus** — run the same semantic search against the GitHub PR index. Retrieve the top 5 results. For each result, record: PR number, title, merged status, similarity score, and linked issue IDs.
5. **Search incident records** — run the semantic search against indexed incidents and postmortems. Retrieve the top 5 results. For each result, record: incident ID, title, severity, resolution status, similarity score, and postmortem link.
6. **Classify matches** — for each result across all three corpora, apply the threshold classification:
   - Score >= `duplicate_threshold` (default 0.85): mark as `exact_duplicate`.
   - Score >= `related_threshold` (default 0.60) and < `duplicate_threshold`: mark as `related`.
   - Score < `related_threshold`: discard from results.
7. **Determine action** — based on classified matches:
   - If any `exact_duplicate` exists with status `open`: recommend `close_as_duplicate` and reference the original issue.
   - If any `exact_duplicate` exists with status `closed/resolved`: recommend `reopen_or_link` and include resolution context.
   - If only `related` matches exist: recommend `link_and_proceed` and attach related items as context for downstream agents.
   - If no matches above threshold: recommend `no_duplicates_found` and proceed normally.
8. **Emit detection artifact** — produce a structured output containing: `action` (close_as_duplicate | reopen_or_link | link_and_proceed | no_duplicates_found), `exact_duplicates[]`, `related_issues[]`, `related_prs[]`, `related_incidents[]`, each with ID, title, score, and status.

## Stop Conditions
- **Done** when the detection artifact is emitted with the action recommendation and all match lists populated (even if empty).
- **Done** when an exact duplicate is found and the `close_as_duplicate` recommendation is produced with the reference issue ID.
- **Stop early** if the embedding service is unavailable — emit a `search_unavailable` status and let IntakeAgent proceed without duplicate check rather than blocking triage.

## Escalation Rules
- Escalate when multiple exact duplicates are found across different statuses (e.g., one open, one closed) — human judgment needed on which to reference.
- Escalate when a candidate matches an open incident with severity `critical` or `high` — this may indicate an ongoing production issue.
- Do NOT escalate for related-but-not-duplicate matches — attach them as context and proceed.

## Anti-Patterns
- **Do not lower the duplicate threshold to catch more matches.** False-positive duplicates cause more damage than missed ones. Keep the threshold strict.
- **Do not search only by title.** Title-only matching misses issues with different phrasing but identical root cause. Always use semantic search on the full normalized content.
- **Do not mark issues as duplicates without providing the reference.** Every `close_as_duplicate` recommendation must include the specific original issue ID.
- **Do not ignore closed issues in the search.** A closed issue may indicate a past fix that regressed or a design decision that explains the current behavior.

## Denied Actions
- Do not close or modify any issues — this skill produces recommendations, not mutations.
- Do not access raw incident postmortem documents — use only indexed summaries to stay within context budget.
- Do not store or cache the candidate embedding beyond the current execution — embeddings are ephemeral per invocation.
