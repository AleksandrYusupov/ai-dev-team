# S53 — Integration Runner Capability & Network Policy Matcher

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Сопоставляет integration work с runner capability manifests: networkModesSupported, allowedDocDomains, allowedSandboxDomains, supportsBrowserConsent, supportsSecretBroker, supportsOAuthBroker, supportsIntegrationLab.
- Why: Лучше не запускать интеграционную задачу, чем запустить её на раннере, который физически не может безопасно её выполнить.

## When To Use
- Сопоставляет integration work с runner capability manifests: networkModesSupported, allowedDocDomains, allowedSandboxDomains, supportsBrowserConsent, supportsSecretBroker, supportsOAuthBroker, supportsIntegrationLab.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: На входе issue contract + integration classification + runner manifest. На выходе compatible runners, denied reasons, required network mode, missing capability flags и escalation. Любая несоответствующая задача не должна лизиться non-integration runner'ом.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: На входе issue contract + integration classification + runner manifest. На выходе compatible runners, denied reasons, required network mode, missing capability flags и escalation. Любая несоответствующая задача не должна лизиться non-integration runner'ом.

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
