# Context7 Protocol (Required)

This protocol defines how to use **Context7** during agentic coding.

> Goal: ensure the agent always has the **right** context before writing or changing code.

---

## 1) What Context7 is expected to do (assumptions)

Context7 should help you retrieve and structure the minimum necessary project context, such as:
- architecture constraints,
- relevant files and modules,
- conventions and patterns,
- build/test commands,
- known pitfalls (“gotchas”).

If your Context7 implementation does not provide one of these, you must compensate manually (e.g., by reading docs and summarizing them).

---

## 2) Mandatory call points

You **must** call Context7 at these points:

1. **Before planning**
   - Purpose: load architecture constraints and the “golden path” for this repo.

2. **Before editing a new area**
   - Purpose: ensure you match local conventions.

3. **Before introducing new behavior**
   - Purpose: confirm where the behavior should live and how it should be tested.

4. **Before final verification**
   - Purpose: sanity-check that you didn’t miss required steps (tests/docs/logs).

You may call it more often, but you must not use it as a substitute for running tests.

---

## 3) What every Context7 request must contain

Include, at minimum:

- **Task statement**: one paragraph describing the goal.
- **Scope**: files/modules/services involved.
- **Constraints**:
  - “Do not change public API unless necessary.”
  - “No new dependencies.”
  - “Keep it simple; avoid extra abstractions.”
  - “Docs are in Obsidian; update docs after.”
- **Verification expectation**: “Provide the exact commands for fast checks.”

---

## 4) Required outputs from Context7 (what you must extract)

After the call, you must extract (and write down):

1. **Files to read first** (the minimum set).
2. **Relevant conventions** (naming, patterns, error handling, logging).
3. **Verification commands** (format/lint/typecheck/test).
4. **Architecture constraints** (invariants, boundaries, ownership).
5. **Known pitfalls** (edge cases, footguns, historical quirks).

Record a summary (not a raw dump) in:
- your plan document, and
- `04_AGENT_CHANGELOG.md`.

---

## 5) How Context7 interacts with Serena + Sequential Thinking

This ruleset assumes complementary roles:

- **Serena MCP**: ground truth for *your* repo (symbols, references, navigation, memories).  
  Use it to find “where is this implemented?” and “what breaks if I change this?”

- **Context7**: ground truth for *external* docs and patterns (libraries, frameworks, language quirks), and to remind you of repo conventions.

- **Sequential Thinking**: a structured workspace to plan, revise, and branch on non-trivial tasks.

Rules:
- **MUST** call Context7 even if Serena is available (Context7 is required in this ruleset).
- **MUST** validate Context7 suggestions against actual code and tests.
- **SHOULD** keep the outputs short: write summaries, not dumps.

---

## 6) Example Context7 requests (copy/paste)

### Example A — Planning call
- “Load architecture context for <service>. List invariants, entrypoints, and where changes should occur. List the fastest verification commands. Point me to 3–7 relevant files. Do not propose code yet.”

### Example B — Before editing a module
- “I will modify <module>. Show conventions: error handling, logging, config, tests. Identify similar existing implementations and where unit tests live.”

### Example C — Before final verify
- “Given the changes in <files/modules>, list required checks and docs updates for this repo. Call out any likely missing steps.”

---

## 7) Failure mode policy

If you skip Context7, the change is non-compliant.

If Context7 is unavailable:
- you must manually gather the same information,
- document what you did,
- and note the outage in the change log entry.
