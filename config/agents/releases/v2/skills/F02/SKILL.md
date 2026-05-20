# F02 — Context Pack Builder

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- Why: Лучшие агентные пайплайны побеждают не моделью, а качеством контекста.

## When To Use
- Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Должен уметь дедуплицировать контекст, выделять authoritative sources, собирать last relevant comments, decisions summary и отдельно формировать slim prompt context vs full raw log. Для integration-задач включать только sanitized integration artifact refs; не включать raw secrets, raw token state или raw vendor docs dumps.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Должен уметь дедуплицировать контекст, выделять authoritative sources, собирать last relevant comments, decisions summary и отдельно формировать slim prompt context vs full raw log. Для integration-задач включать только sanitized integration artifact refs; не включать raw secrets, raw token state или raw vendor docs dumps.

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
