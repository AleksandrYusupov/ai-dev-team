# Agentic Coding Templates

Copy/paste and fill. Keep them short and factual.

---

## Template 0 — Repo `AGENTS.md` (Codex project instructions)

> Keep this file short and high-signal. If it grows too large, split it into per-directory `AGENTS.md` files.

```markdown
# AGENTS.md — Project Instructions (Agentic Coding)

## Golden rules (non-negotiable)
- Architecture-first: read Obsidian docs before editing code.
- Docs are part of done: update Obsidian + repo docs after changes.
- Dedicated agent changelog: append an entry to `04_AGENT_CHANGELOG.md` for every non-trivial change.
- Context7 required: call Context7 before writing/changing code in a new area.
- Verify and rewrite: run checks; if bugs remain, simplify and rewrite until fixed.
- Simplicity mandatory: no over-engineering, no speculative abstractions.

## Tooling (if available)
- Serena MCP: use for symbol search, references, onboarding/memories, and safe refactors (see `07_SERENA_MCP_PROTOCOL.md`).
- Sequential Thinking MCP: use for non-trivial planning/debugging (see `08_SEQUENTIAL_THINKING_PROTOCOL.md`).

## Build / test commands
Fast checks:
- `<command>`
- `<command>`

Full checks:
- `<command>`
- `<command>`

## Repo conventions (examples)
- Error handling: ...
- Logging: ...
- Config: ...
- Testing locations: ...
```

---

## Template 1 — Implementation Plan (`PLAN.md`)

```markdown
# Plan: <short title>

## Goal
<What we are changing, in one paragraph.>

## Acceptance criteria
- [ ] ...
- [ ] ...

## Non-goals / out of scope
- ...

## Architecture constraints (from Obsidian)
- Source pages:
  - <Obsidian path/link>
  - <Obsidian path/link>
- Invariants:
  - ...
- Boundaries touched:
  - ...

## Context7 summary
- Call(s) made:
  - <what you requested>
- Key conventions/patterns:
  - ...
- Files to read first:
  - ...

## Serena summary (if available)
- Project activation:
  - <project name/path + date>
- Symbols/files confirmed:
  - ...
- Expected refactors:
  - ...

## Proposed approach (simplest first)
1. ...
2. ...

### Alternatives considered
- Option A: ... (rejected because ...)
- Option B: ... (rejected because ...)

## Files expected to change
- `path/to/file`: reason
- `path/to/file`: reason

## Test strategy
Fast checks:
- `...`

Deeper checks (if needed):
- `...`

## Docs to update (Obsidian + repo)
- Obsidian:
  - <page>
- Repo docs:
  - <file>

## Risks & mitigations
- Risk: ...
  - Mitigation: ...

## Rollback / migration
- ...
```

---

## Template 2 — Context7 Call Record (`CONTEXT7_NOTE.md`)

```markdown
# Context7 call: <topic>

## Why this call
<What decision you needed to make.>

## Inputs
- Query / request: ...
- Scope (modules/files): ...

## Output summary (bullet, not raw dump)
- Conventions:
  - ...
- Relevant files:
  - ...
- Commands:
  - ...
- Constraints:
  - ...

## How it changed the plan
- ...
```

---

## Template 3 — Sequential Thinking Session Summary (`SEQUENTIAL_THINKING_SUMMARY.md`)

```markdown
# Sequential Thinking session: <topic>

## Why used
<Non-trivial planning, debugging, branching decisions, etc.>

## Key assumptions
- ...

## Final plan / decision (summary)
- ...

## Branches explored (if any)
- Branch <id>: ... → outcome

## Stop conditions
- "Done" when:
  - ...
```

---

## Template 4 — Serena Session Start Prompt (copy into agent chat)

```text
Use Serena:
1) get_current_config
2) activate the current working directory as the project (or confirm it is active)
3) if onboarding is not done: run onboarding and write key memories
Then summarize:
- key architecture files found
- key symbols/entrypoints for this task
Do not edit code yet.
```

---

## Template 5 — Regression Test Note (`REGRESSION_TEST_NOTE.md`)

```markdown
# Regression test: <bug short name>

## Bug description
<What was broken and why it mattered.>

## Reproduction (pre-fix)
- Steps:
  1. ...
- Expected vs actual:
  - Expected: ...
  - Actual: ...

## Test added
- Location: `path/to/test`
- What it asserts:
  - ...

## Fix summary
- ...

## Verification
- Commands:
  - `...`
- Results:
  - ...
```

---

## Template 6 — PR Description

```markdown
## Summary
<What changed in 3–6 bullets.>

## Why
<Business/technical rationale.>

## What changed
- ...
- ...

## How to test
- `...` (fast)
- `...` (deeper)

## Evidence
- Tests: <pass/fail + notes>

## Docs
- Updated Obsidian pages:
  - ...
- Updated repo docs:
  - ...

## Risks
- ...
- Mitigations:
  - ...

## Changelog
- Entry: `04_AGENT_CHANGELOG.md` @ <date/time/anchor>
```

---

## Template 7 — Obsidian Note Skeleton (new note)

```markdown
# <Note title>
#<root_folder_tag>

## TL;DR
<1–4 bullets.>

## Context
- Why this note exists:
  - ...

## Details
<Simple, structured explanation. Use short sections.>

## Links
- Parent / index: [[<Index note>]]
- Related: [[<Related note 1>]], [[<Related note 2>]]
- Systems / components: [[<Component note>]]
```

---

## Template 8 — Lightweight ADR (Architecture Decision Record)

```markdown
# ADR: <decision title>

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
<What forced a decision.>

## Decision
<The simplest decision that works.>

## Consequences
Positive:
- ...

Negative / trade-offs:
- ...

## Alternatives considered
- ...
```
