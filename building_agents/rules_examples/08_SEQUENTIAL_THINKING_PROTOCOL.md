# Sequential Thinking MCP Protocol (Best Practices)

This protocol defines how an agent should use **Sequential Thinking MCP** as a structured workspace for planning, revising, and branching—without bloating context or replacing real verification.

---

## 0) What Sequential Thinking is (and is not)

Sequential Thinking is:
- a structured way to record a thought sequence (steps),
- a way to revise prior steps and branch alternatives,
- a workspace that makes complex tasks more controllable.

Sequential Thinking is not:
- a substitute for tests,
- a guarantee of correctness,
- a reason to overcomplicate simple tasks.

---

## 1) When to use Sequential Thinking

**SHOULD use it when:**
- requirements are ambiguous or multi-step,
- you need a plan that touches multiple modules,
- debugging requires multiple hypotheses,
- you need to compare alternatives and pick the simplest one,
- you need to maintain coherent progress over a long task.

**SHOULD NOT use it when:**
- the task is trivial (single-file, obvious change),
- you already have a clear plan and a short implementation path.

---

## 2) How to write “good thoughts” (required style)

Each thought must be short and high-signal. Use this structure inside the `thought` string:

- **Goal:** what this step is trying to decide/do
- **Evidence:** what you observed (from docs/code/tools/tests)
- **Decision:** what you chose (keep it simple)
- **Next:** what you will do next

Example thought text (one step):
- “Goal: identify the safest entrypoint. Evidence: Obsidian says X, Serena shows Y. Decision: edit module Z only. Next: call Context7 for module Z conventions.”

Rules:
- **MUST** keep each thought to a few lines.
- **MUST** avoid narrative “thinking out loud”.
- **MUST** record decisions and assumptions explicitly.
- **MUST** include a stop condition in the final thought (“done when …”).

---

## 3) Using the tool fields (practical guidance)

The server exposes a tool named `sequential_thinking` with these key fields:
- `thought` (string)
- `thoughtNumber` (int)
- `totalThoughts` (int, estimate; adjust as needed)
- `nextThoughtNeeded` (bool)

Optional (use only when needed):
- `isRevision` + `revisesThought` (revise an earlier thought)
- `branchFromThought` + `branchId` (explore an alternative branch)
- `needsMoreThoughts` (if you realize the scope is larger)

Best practice:
- Start with `totalThoughts = 5` for a medium task; adjust up/down honestly.
- If you realize a prior decision was wrong, use `isRevision: true` and point to `revisesThought`.
- If you explore an alternative approach, use `branchFromThought` and a simple `branchId` (e.g., `A`, `B`).

---

## 4) Integration with this rulebook

When Sequential Thinking is used:
- **MUST** still follow the workflow gates:
  - read Obsidian architecture docs first,
  - call Context7 before writing/changing code in a new area,
  - verify with tests/linters,
  - update docs and the dedicated change log.
- **SHOULD** use Sequential Thinking to decide *which* Serena queries and Context7 calls are needed.

---

## 5) Logging requirements

In `04_AGENT_CHANGELOG.md`, include a short Sequential Thinking summary:
- the topic (what was planned),
- final chosen approach,
- any branches explored and why they were rejected.

Do not paste the full thought history unless explicitly requested.
