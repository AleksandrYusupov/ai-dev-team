# S51 — Webhook Contract & Signature Hardening Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Проектирует и проверяет webhook contracts: callback URL, event filtering, signature verification, replay/idempotency handling, retry/DLQ strategy, timeout behavior, delivery correlation и verification reports.
- Why: Webhook-интеграции чаще всего падают на подписи, повторных доставках и несогласованной модели событий.

## When To Use
- Проектирует и проверяет webhook contracts: callback URL, event filtering, signature verification, replay/idempotency handling, retry/DLQ strategy, timeout behavior, delivery correlation и verification reports.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Всегда включать secret/signature verification, HTTPS, minimal event subscription, event/action filtering, correlation id, async processing, replay-safe idempotency, delivery diagnostics и smoke checklist. Генерировать webhook_contract и webhook_validation_report.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Всегда включать secret/signature verification, HTTPS, minimal event subscription, event/action filtering, correlation id, async processing, replay-safe idempotency, delivery diagnostics и smoke checklist. Генерировать webhook_contract и webhook_validation_report.

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
