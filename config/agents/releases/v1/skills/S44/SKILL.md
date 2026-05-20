# S44 — @ask Conversation Handler

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Умеет отличать просто комментарий от явного prompt event с @ask и корректно резюмировать накопившуюся переписку перед ответом.
- Why: Ключевой skill для работы внутри Linear comments.

## When To Use
- Умеет отличать просто комментарий от явного prompt event с @ask и корректно резюмировать накопившуюся переписку перед ответом.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Игнорировать @ask в quotes/code blocks; respect current workflow state; create signal/resume semantics.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Игнорировать @ask в quotes/code blocks; respect current workflow state; create signal/resume semantics.

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
