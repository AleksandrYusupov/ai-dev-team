# Agentic Coding Best Practices (Jan 2026 — Updated Jan 2026)

This bundle is a **tool-agnostic rulebook** for using (or building) coding agents that make safe, high‑quality, reviewable changes in real codebases.

It is written as **MUST / SHOULD / MAY** rules you can commit into a repository and treat like an internal engineering standard.

## What you get

- `01_AGENTIC_CODING_RULEBOOK.md`  
  The full “constitution” + detailed best practices.

- `02_CHECKLISTS.md`  
  Strict, practical checklists for each phase (preflight → plan → implement → verify → document → ship).

- `03_TEMPLATES.md`  
  Ready-to-copy templates for plans, AGENTS.md, changelog entries, architecture notes, and regression tests.

- `04_AGENT_CHANGELOG.md`  
  A dedicated, human-readable log file template for **every** code change (required by the rules).

- `05_CONTEXT7_PROTOCOL.md`  
  A strict protocol for how and when to call **Context7** (required by the rules).

- `06_OBSIDIAN_DOCS_PROTOCOL.md`  
  A protocol for “architecture-first” work when documentation lives in an Obsidian vault.

- `07_SERENA_MCP_PROTOCOL.md`  
  How to configure and use **Serena MCP** correctly with Codex (project activation, onboarding/memories, tool usage discipline).

- `08_SEQUENTIAL_THINKING_PROTOCOL.md`  
  Best practices for using **Sequential Thinking MCP** as a planning/debugging workspace without bloating context.

## Non‑negotiables (quick preview)

1. **Architecture first**: before touching code, study the current architecture and constraints in the Obsidian docs.
2. **Docs are part of done**: after changes, update the corresponding documentation (including new-note tagging + linking rules).
3. **Dedicated change log**: every change gets an entry in `04_AGENT_CHANGELOG.md`.
4. **Context7 every time**: when writing code, you must call Context7 (see protocol).
5. **Verify and rewrite**: run checks; if there are bugs, iterate until fixed.
6. **Simplicity is mandatory**: implement the simplest correct solution; avoid over‑engineering.
7. **Tool discipline**: use Serena for codebase intelligence; use Sequential Thinking for non-trivial planning; keep both summaries concise.

## Suggested usage

- Commit these files into your repo (or a central “engineering standards” repo).
- Reference them from your repo’s `AGENTS.md` (see templates).
- Treat checklists as “definition of done”.
- Keep `04_AGENT_CHANGELOG.md` updated alongside normal git history (the log is for **human narrative + agent traceability**).
