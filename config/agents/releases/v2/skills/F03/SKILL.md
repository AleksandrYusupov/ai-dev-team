# F03 — Repo Guidance Interpreter

## Summary
- Category: `foundation`
- Availability: `template`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules.
- Why: Агенты работают лучше, когда инструкции лежат рядом с кодом, а не только в голове команды.

## When To Use
- Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Нужно поддержать layered instructions: global -> org -> repo -> path-specific -> task-specific. Проверять конфликтующие правила и выдавать effective instructions.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Нужно поддержать layered instructions: global -> org -> repo -> path-specific -> task-specific. Проверять конфликтующие правила и выдавать effective instructions.

## Stop Conditions
- TODO: define the exact completion boundary.

## Escalation Rules
- Escalate when source-of-truth inputs are missing, contradictory, or blocked by a human-owned zone.
- TODO: add skill-specific escalation thresholds.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- TODO: add skill-specific anti-patterns.

## Denied Actions
- Do not treat this skeleton metadata as runtime-ready execution logic before the later runtime-consumption blocks.
