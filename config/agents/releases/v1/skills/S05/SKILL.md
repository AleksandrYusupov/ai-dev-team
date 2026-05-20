# S05 — Comment Thread Distiller

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Сжимает длинные треды в canonical decisions summary + unresolved questions.
- Why: Сильно экономит контекст и снижает потерю решений.

## When To Use
- Сжимает длинные треды в canonical decisions summary + unresolved questions.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Хранить timeline, speaker, action, open question, superseded notes.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Хранить timeline, speaker, action, open question, superseded notes.

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
