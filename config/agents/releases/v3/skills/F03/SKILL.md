# F03 — Repo Guidance Interpreter

## Summary
- Category: `foundation`
- Availability: `template`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Parses and merges layered instruction files (AGENTS.md, CLAUDE.md, path-specific instructions, prompt files) into an effective instruction set, resolving conflicts per the system's precedence hierarchy.
- Why: Agents work better when instructions sit alongside code, but multiple instruction layers can conflict. This skill resolves them deterministically.

## When To Use
- Before assembling a context pack, to produce the effective conventions and rules for each affected repo.
- When a task involves multiple repos with potentially conflicting guidance.
- When path-specific instructions exist and must be layered on top of root-level repo guidance.
- Do NOT use for reading individual files — use direct file read for that. This skill is about merging and conflict resolution.

## Inputs
- Project profile: `config/agent-standards/project-profiles/<project_id>.yaml` — defines which repo guidance files to load.
- System-level standards: standards bundle ref from the project profile.
- Repo guidance files per repo: `AGENTS.md`, `PLAN.md`, `TESTPLAN.md`, `RELEASE.md`, `ENVIRONMENT.md` (as listed in the project profile).
- Path-specific instructions: per-directory `AGENTS.md` files if they exist in affected paths.
- Task-level constraints: from the issue contract (labels, risk flags, type).

## Steps

1. **Load system-level baseline** — read the standards bundle referenced by the project profile. Extract non-negotiable rules (rulebook core principles, checklists, MCP protocols).
2. **Load project-level profile** — read the project profile. Extract project-scoped constraints: KB root, tool policy, escalation owners, naming conventions, human gates.
3. **Load repo-level guidance** — for each repo in the affected set, read the root `AGENTS.md` and any other guidance files listed in the project profile's `repo_guidance_files`. Parse sections: hard gates, sources of truth, implementation rules, verification rules, tool-specific instructions.
4. **Load path-specific overlays** — if the task's affected files fall within directories that have their own `AGENTS.md`, load those as additional overlays.
5. **Merge with precedence** — apply the layering policy (`system > project > repository > path > task`):
   - Lower layers may add detail or tighten constraints.
   - Lower layers may NOT relax or override higher-layer policy.
   - If two repos have conflicting rules, apply `strictest_constraint_wins`.
   - If rules are strictly incompatible (cannot both be true), flag as a conflict in the output.
6. **Produce effective instruction set** — output a merged, non-contradictory guidance block containing:
   - Build/test commands (per repo)
   - Code style and conventions
   - Error handling patterns
   - Tool usage rules (Serena, Context7, Sequential Thinking)
   - Verification requirements
   - Documentation update requirements
   - Repo-specific constraints
7. **Flag conflicts** — if unresolvable conflicts exist, include them in a `conflicts` section with both sources and the suggested resolution (escalate or use stricter rule).

## Stop Conditions
- **Done** when all affected repos have been parsed and a single effective instruction set is produced.
- **Done** when all conflicts are either resolved by `strictest_constraint_wins` or explicitly flagged.
- **Stop if** the project profile is missing — escalate with `needs_missing_file`.

## Escalation Rules
- Escalate when two repos have strictly incompatible constraints that cannot be resolved by `strictest_constraint_wins`.
- Escalate when the project profile is missing or references a non-existent standards bundle.
- Do NOT escalate for repos missing `AGENTS.md` — treat as "no repo-specific constraints" and note it.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not copy-paste entire instruction files into the output.** Produce a merged summary with references.
- **Do not silently drop conflicting rules.** Either resolve by precedence or flag explicitly.
- **Do not invent conventions.** If a repo has no style guide, say so — don't guess.
- **Do not override system-level rules with repo-level preferences.** System rules always win.

## Denied Actions
- Do not write code or patches.
- Do not modify instruction files — this skill is read-only.
- Do not relax human gates defined at the system or project level.
