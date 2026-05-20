# F04 — Git Hygiene & Branch Safety

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- Why: Нужен всем агентам, которые пишут код или готовят PR.

## When To Use
- Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Правила: не работать на dirty tree без явного разрешения, не расширять scope diff, коммитить малыми инкрементами, линковать issue/PR, уважать branch protection.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Правила: не работать на dirty tree без явного разрешения, не расширять scope diff, коммитить малыми инкрементами, линковать issue/PR, уважать branch protection.

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
