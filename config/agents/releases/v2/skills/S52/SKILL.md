# S52 — Integration Validation & Sandbox Readiness Orchestrator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Проверяет sandbox/onboarding readiness, credential validation state, test strategy, smoke path и evidence completeness до coding/release stages.
- Why: Даже хороший integration code бесполезен, если у команды нет рабочего sandbox, scopes, consent или replayable validation path.

## When To Use
- Проверяет sandbox/onboarding readiness, credential validation state, test strategy, smoke path и evidence completeness до coding/release stages.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Должен выпускать credential_validation_report и integration_smoke_report. В MVP опирается на текущие metadata routes, sanitized artifacts и DB-backed readiness facts; в будущих фазах расширяется до real broker probes и integration lab/replay tooling.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Должен выпускать credential_validation_report и integration_smoke_report. В MVP опирается на текущие metadata routes, sanitized artifacts и DB-backed readiness facts; в будущих фазах расширяется до real broker probes и integration lab/replay tooling.

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
- Do not request, paste, persist, or summarize raw secrets, tokens, browser session dumps, or vendor-console exports.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
