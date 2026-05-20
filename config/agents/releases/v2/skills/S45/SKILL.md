# S45 — Prompt/Instruction Tuner

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Оптимизирует descriptions/frontmatter/instructions для лучшего triggering accuracy и меньшего prompt bloat.
- Why: Нужен, потому что skills и AGENTS.md быстро разрастаются и начинают мешать друг другу.

## When To Use
- Оптимизирует descriptions/frontmatter/instructions для лучшего triggering accuracy и меньшего prompt bloat.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Проводить trigger analysis, undertrigger/overtrigger, ambiguity fixes, brevity optimization.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Проводить trigger analysis, undertrigger/overtrigger, ambiguity fixes, brevity optimization.

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
