# Agentic Coding Checklists

Use these as strict “gates”. If any checkbox cannot be honestly satisfied, do not ship.

---

## Checklist A — Preflight (Architecture-first)

- [ ] I located the relevant architecture documentation in Obsidian.
- [ ] I read the pages that describe: system boundaries, invariants, and the part I will change.
- [ ] I identified impacted components, interfaces, and owners.

**Serena (if configured):**
- [ ] Serena MCP is connected in Codex (`/mcp` shows it).
- [ ] The correct project is active (activated or auto-detected).
- [ ] If this is the first Serena session for the project:
  - [ ] onboarding is complete,
  - [ ] key memories exist and are readable.

**Sequential Thinking (recommended for non-trivial tasks):**
- [ ] I used Sequential Thinking to create a short plan (or I explicitly decided it is unnecessary).

**Context7 (required):**
- [ ] I called Context7 and captured:
  - [ ] recommended files to read,
  - [ ] local conventions and patterns,
  - [ ] exact build/test commands,
  - [ ] relevant constraints.

- [ ] I can state the acceptance criteria in one paragraph.
- [ ] I listed what is explicitly out of scope.
- [ ] I identified risk areas (security/data/perf/backward compatibility).
- [ ] I start from a clean git state for non-trivial edits (or I documented why not).

---

## Checklist B — Plan

- [ ] I wrote a plan in Markdown (template used).
- [ ] The plan includes the minimal set of files to touch.
- [ ] The plan does **not** introduce new abstractions without a reason.
- [ ] The plan includes a test strategy (fast checks + deeper checks if needed).
- [ ] The plan includes required documentation updates (Obsidian pages and repo docs).
- [ ] I considered at least one simpler alternative.
- [ ] I defined a rollback/migration approach when relevant.

Serena-aware planning (if available):
- [ ] I listed which symbols/files I will confirm via Serena before editing.
- [ ] I noted any refactors that should use symbol-aware tools (rename/refactor), not text edits.

---

## Checklist C — Implement

**Context7 (required):**
- [ ] Before editing a new area, I called Context7 for that area.

**Serena (recommended if available):**
- [ ] I used Serena to confirm the correct entrypoints/symbols before making edits.
- [ ] I used Serena “find references” before changing contracts or signatures.
- [ ] I used symbol-aware operations (rename/refactor) when appropriate.

General implementation discipline:
- [ ] I made changes in small increments (reviewable diff).
- [ ] I avoided unrelated refactors and formatting-only noise.
- [ ] I followed existing patterns for:
  - [ ] error handling,
  - [ ] logging/metrics,
  - [ ] configuration,
  - [ ] naming and folder structure.
- [ ] New code is placed near similar code (for convention inheritance).
- [ ] No secrets or sensitive data are in prompts, logs, or commits.

---

## Checklist D — Verify (Bug loop)

- [ ] I ran formatters/linters.
- [ ] I ran type checks (if applicable).
- [ ] I ran unit tests relevant to the change.
- [ ] I ran integration/e2e tests if the change impacts boundaries.
- [ ] If a bug was found:
  - [ ] I added a regression test (or documented why not).
  - [ ] I rewrote the faulty logic instead of patching around it.
  - [ ] I re-ran checks until green.
- [ ] I performed a quick “simplicity audit”:
  - [ ] no unnecessary abstractions,
  - [ ] no unused code paths,
  - [ ] no speculative complexity.

---

## Checklist E — Documentation (Obsidian-first)

- [ ] I updated the relevant Obsidian pages to match reality.
- [ ] I updated repo docs/README/runbooks if impacted.
- [ ] Docs explain:
  - [ ] what changed,
  - [ ] why,
  - [ ] how to use it,
  - [ ] how to test it,
  - [ ] migration/rollback (if needed),
  - [ ] limitations and gotchas.

**If I created a new Obsidian note:**
- [ ] The note contains the root-folder hashtag (example: `Pal/` → `#pal`).
- [ ] The note contains meaningful `[[double bracket]]` links to related notes.
- [ ] I updated at least one existing note to link back to the new note (bidirectional graph).

---

## Checklist F — Dedicated Change Log

- [ ] I appended an entry to `04_AGENT_CHANGELOG.md`.
- [ ] The entry includes:
  - [ ] scope & summary,
  - [ ] Context7 call summaries,
  - [ ] Serena usage summary (if Serena is configured),
  - [ ] Sequential Thinking summary (if used),
  - [ ] commands and tests run,
  - [ ] verification results,
  - [ ] docs updated,
  - [ ] risks and mitigations.
- [ ] The entry is understandable by someone who did not do the work.

---

## Checklist G — Ship (Commit / PR)

- [ ] The diff is minimal and readable.
- [ ] PR description includes: summary, rationale, test evidence, docs updates, risks.
- [ ] I linked to the relevant Obsidian doc(s) and the change log entry.
- [ ] I did a final scan for:
  - [ ] broken imports,
  - [ ] dead code,
  - [ ] inconsistent naming,
  - [ ] missing error handling,
  - [ ] missing tests.
