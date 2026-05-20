# S27 — Docs Synchronizer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Обновляет README, runbooks, inline docs и release notes в соответствии с code changes.
- Why: Docs as part of delivery, not afterthought.

## When To Use
- When code changes are complete and the diff may have made existing documentation stale (README, API docs, runbooks, CHANGELOG).
- When a BuildAgent (A06-A10) finishes implementation and needs docs synchronized before PR submission.
- When DocsAgent (A14) runs a post-merge documentation consistency sweep.
- Do NOT use to create documentation from scratch — this skill only synchronizes existing docs with code changes.

## Inputs
- Code diff: the complete set of changes from the implementation task (files added, modified, deleted).
- Context pack (from F02): architecture summary, conventions, authoritative links to documentation files.
- Repo guidance (from F03): doc file locations, doc format conventions, changelog format, inline comment style.
- Issue contract: task scope, type, affected areas — used to determine which docs are in scope.
- Existing documentation inventory: list of doc files in the repo (README, API docs, runbooks, CHANGELOG, ADR index, inline module docs).

## Steps

1. **Inventory affected docs** — scan the code diff to identify which documentation files may be stale. Check: README (if public API or setup changed), API docs (if endpoints/schemas changed), runbooks (if operational procedures changed), CHANGELOG (if user-visible behavior changed), inline module comments (if function signatures or behavior changed).
2. **Classify doc impact** — for each affected doc file, classify the impact: `must_update` (content is factually wrong without update), `should_update` (content is incomplete but not wrong), `flag_for_review` (customer-facing or policy-critical, needs human eyes).
3. **Update must-update docs** — apply precise edits to docs classified as `must_update`. Match the existing doc style and format. Update code examples, command snippets, configuration references, and API schemas to reflect the new code state.
4. **Update should-update docs** — apply edits to docs classified as `should_update`. Add missing information introduced by the change. Do not restructure or rewrite sections that are unrelated to the diff.
5. **Update CHANGELOG** — if the change is user-visible, add an entry to CHANGELOG following the repo's existing format (Keep a Changelog, conventional, or custom). Place the entry under the correct version/unreleased section.
6. **Sync inline docs** — update inline comments, docstrings, and module-level documentation for changed functions, classes, and modules. Ensure parameter descriptions, return types, and behavior notes match the new implementation.
7. **Flag for human review** — collect all docs classified as `flag_for_review` into a review list with: file path, section affected, reason for flag (customer-facing, policy-critical, ambiguous intent). Do not modify these docs — only flag them.
8. **Verify no secret leakage** — scan all doc updates for accidental inclusion of secrets, tokens, internal URLs, or raw credentials. If found, remove and flag.
9. **Emit sync report** — produce a structured report listing: docs updated (with summary of changes), docs flagged for human review (with reasons), docs confirmed unchanged. Attach the report to the PR notes.

## Stop Conditions
- **Done** when all `must_update` and `should_update` docs are updated, flagged docs are listed, and the sync report is produced.
- **Done** when CHANGELOG is updated for user-visible changes and inline docs match the new code.
- **Stop early** if no documentation is affected by the diff — emit an empty sync report confirming no updates needed.

## Escalation Rules
- Escalate when a doc file referenced by the diff does not exist (possible doc gap predating this change).
- Escalate when customer-facing documentation requires changes that alter the product's public commitments or SLA language.
- Escalate when the diff introduces a new public API with no existing documentation to synchronize against — creation of new docs is out of scope.
- Do NOT escalate for minor formatting inconsistencies in existing docs — fix them inline.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not create documentation from scratch.** This skill synchronizes existing docs only. New doc creation requires explicit human or DocsAgent initiation.
- **Do not rewrite entire doc files.** Make targeted edits that reflect the diff — nothing more.
- **Do not update docs unrelated to the current diff.** Resist the urge to "fix" pre-existing doc issues outside scope.
- **Do not include raw secrets, internal URLs, or credential values in documentation.**
- **Do not silently modify flagged docs.** Customer-facing and policy-critical content must go through human review.

## Denied Actions
- Do not create new documentation files — only update existing ones.
- Do not modify docs that are flagged as requiring human review.
- Do not include secrets, tokens, or raw credentials in any documentation update.
- Do not merge or push — only prepare doc updates as part of the diff for review.
