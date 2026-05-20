# S54 — Integration Go-Live, Observability & Rollback Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Готовит integration_go_live_checklist, observability hooks, smoke path, release notes constraints и rollback/mitigation plan для внешних интеграций.
- Why: У внешних интеграций важны не только код и тесты, но и post-deploy visibility, vendor failure modes и безопасный rollback.

## When To Use
- Готовит integration_go_live_checklist, observability hooks, smoke path, release notes constraints и rollback/mitigation plan для внешних интеграций.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Должен включать dashboards/alerts, webhook delivery health, auth failure signals, rate-limit signals, redaction rules для release notes/incident notes, rollback triggers и customer-impact communication hints.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Должен включать dashboards/alerts, webhook delivery health, auth failure signals, rate-limit signals, redaction rules для release notes/incident notes, rollback triggers и customer-impact communication hints.

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
