# F09 — Decision Log & Memory Skill

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Поддерживает compact decision log: какие решения приняты, когда, кем, на основании чего; умеет резюмировать длинные comment threads.
- Why: Снижает повторные вопросы и позволяет агентам не тащить всю переписку целиком.

## When To Use
- Поддерживает compact decision log: какие решения приняты, когда, кем, на основании чего; умеет резюмировать длинные comment threads.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Структура записи: timestamp, actor, decision, rationale, evidence, supersedes, unresolved_questions. Должен обновлять summary инкрементально.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Структура записи: timestamp, actor, decision, rationale, evidence, supersedes, unresolved_questions. Должен обновлять summary инкрементально.

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
