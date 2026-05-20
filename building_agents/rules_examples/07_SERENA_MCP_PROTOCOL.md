# Serena MCP Protocol (Codex + Serena)

This protocol defines how an agent should configure and use **Serena MCP** when working in a real codebase.

Serena is best treated as a **repo-intelligence layer**:
- it helps you find symbols, references, and structure,
- it can run onboarding and persist “memories” per project,
- it supports safer refactors than plain text edits.

---

## 0) When to use Serena (and when not to)

Use Serena for:
- locating entrypoints and key symbols quickly,
- finding references before changing contracts,
- understanding large codebases via onboarding + memories,
- symbol-aware refactors (rename/refactor) instead of brittle search/replace.

Do not use Serena as a substitute for:
- reading the actual code you will change,
- running tests,
- updating Obsidian documentation,
- the dedicated change log.

---

## 1) Configure Serena for Codex

### Option A — Add via your agent config file (recommended)
Add a server block to the MCP config used by your local agent runner:

```toml
[mcp_servers.serena]
command = "uvx"
args = ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server", "--context", "codex"]
```

**Optional quality-of-life improvements:**

1) Auto-detect project from current working directory (avoids manual activation in many setups):

```toml
[mcp_servers.serena]
command = "uvx"
args = [
  "--from", "git+https://github.com/oraios/serena",
  "serena", "start-mcp-server",
  "--context", "codex",
  "--project-from-cwd"
]
```

2) Disable the web dashboard if you do not want it (enabled by default):

```toml
args = ["...", "--enable-web-dashboard", "false"]
```

### Option B — Add via Codex CLI
If you prefer the CLI, use `codex mcp add ...` (Codex will write config for you). Use the `--` separator before the server command.

---

## 2) Session start procedure (required)

At the beginning of every Codex session (or whenever the MCP server restarts):

1) **Confirm Serena is connected**
- In Codex TUI: use `/mcp` and confirm `serena` appears.

2) **Confirm the active project**
- If you configured `--project-from-cwd`, still confirm the correct project is active.
- Otherwise, **activate the current directory** using the Serena tool:
  - `activate_project` with the current path (or the known project name).

3) **Run onboarding (first time per project)**
- Use `check_onboarding_performed`.
- If not performed:
  - run `onboarding`,
  - ensure Serena memories were actually written.

4) **Load memories early for non-trivial tasks**
- Use `list_memories`, then `read_memory` for the few that matter.
- Keep it small: only load what you need.

**Rules:**
- **MUST** do (1) and (2) before relying on Serena tools.
- **SHOULD** do onboarding before big changes.
- **SHOULD** start with a clean git state for non-trivial tasks.

---

## 3) Recommended Serena tool usage patterns

### 3.1 Understanding a module before editing
Use this order:
1. `find_file` / `list_dir` to locate relevant files (high-level).
2. `get_symbols_overview` to see top-level structure.
3. `find_symbol` to locate the exact symbol(s) you care about.
4. `find_referencing_symbols` before changing signatures/contracts.

### 3.2 Editing strategy (keep it safe)
Prefer symbol-aware edits when possible:
- Use `rename_symbol` for renames.
- Use `replace_symbol_body` for replacing implementations of a function/class.
- Use `insert_before_symbol` / `insert_after_symbol` to add code adjacent to a symbol.

Avoid:
- large blind “replace content” operations across many files,
- multi-module refactors without a plan and tests.

### 3.3 When Serena reads too much / context grows
For large tasks:
- plan first, implement second (two sessions is fine).
- use Serena’s “prepare for new conversation” / summary tools:
  - `prepare_for_new_conversation`
  - `summarize_changes`
- write the summary into a memory (`write_memory`) and continue in a new session.

---

## 4) Security and safety rules (Serena-specific)

- **MUST** use version control and commit frequently for large edits.
- **MUST** monitor tool executions and shell commands.
- **SHOULD** consider read-only mode in the Serena project configuration when you only want analysis.
- **SHOULD** restrict enabled tools in Serena configuration for sensitive environments.
- **SHOULD** consider running Serena in a sandbox (e.g., Docker) for higher-risk repos.

---

## 5) Logging requirements

In `04_AGENT_CHANGELOG.md`, record (summary only):
- whether Serena was used,
- which project was active,
- key lookups (symbols/files),
- any refactors done via Serena tools,
- any memories created/updated.

Do **not** paste huge tool outputs.
