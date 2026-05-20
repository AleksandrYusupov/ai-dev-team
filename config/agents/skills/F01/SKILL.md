# F01 — Issue Contract Parser

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- Why: Даёт всем агентам одинаковую исходную модель задачи и резко снижает дрейф смысла между triage/spec/build/review.

## When To Use
- When a new Linear issue arrives and needs to be converted into a structured contract before any agent can start work.
- When an existing issue's comment thread has evolved (new decisions, scope changes, @ask answers) and the contract needs re-parsing.
- When IntakeAgent or OrchestratorAgent routes a task and requires a normalized contract to select the correct downstream agents.
- When SpecAgent or PlanAgent needs a machine-readable input to begin specification or decomposition.
- Do NOT use for issues that are purely informational (e.g., announcements, retrospective notes) and do not require agent action.

## Inputs
- Issue body — заголовок, описание, markdown-контент из Linear issue.
- Labels — массив label names/ids, включая приоритет, area, team, type.
- Status — текущий статус issue в workflow (triage, in_progress, done и т.д.).
- Project — Linear project id и name для определения repo routing.
- Comments — полный comment thread, включая timestamps и авторов.
- Links — связанные issues, PRs, external URLs, parent/sub-issue relations.
- Repository Registry — справочник repo_id -> repo_kind, environments, team, CI checks.

## Steps
1. **Extract raw fields** — собрать issue body, title, labels, status, project, assignee, priority и все comments в единую raw структуру. Зафиксировать issue_id и snapshot timestamp.
2. **Parse comment thread chronologically** — пройти comments по timestamps; выделить @ask вопросы, ответы на них, явные decisions (помеченные как "decision:", "resolved:", "agreed:"), scope changes и blockers. Построить decisions_summary.
3. **Identify goal and scope** — из body и decisions_summary извлечь goal (одно предложение, что должно быть достигнуто), scope (конкретные boundaries работы), non-goals (явно исключённые вещи). Если goal не формулируется однозначно — пометить confidence < 0.7 и добавить goal в missing_fields.
4. **Extract acceptance criteria and verification path** — найти acceptance criteria (чеклист или bullet list условий приёмки), verification_path (какие тесты, checks, smoke steps подтверждают done). Если acceptance criteria отсутствуют — добавить в missing_fields, но не выдумывать.
5. **Resolve repo and dependencies** — через Repository Registry определить primary_repo и affected_repos по project, labels, area. Извлечь dependencies (другие issues, services, APIs) и risk level из labels или явных упоминаний в body/comments.
6. **Detect integration-specific fields** — если labels или body указывают на integration work, заполнить optional поля: provider_name, integration_kind, auth_scheme, required_credentials, secret_slots, required_scopes, oauth_redirect_uris, webhook_callback_urls, test_strategy, go_live_checklist, rollback_plan. Поля, не найденные в источнике, добавить в missing_fields.
7. **Collect open questions** — агрегировать неотвеченные @ask, нерезолвленные обсуждения, противоречия между body и comments. Каждый open question получает id, author, timestamp, текст.
8. **Assemble and validate contract** — собрать JSON contract со всеми полями. Вычислить confidence (0.0–1.0) на основе полноты: goal + scope + acceptance_criteria + verification_path = core fields; каждый missing core field снижает confidence на 0.15. Вернуть `{contract, confidence, missing_fields, open_questions}`.

## Stop Conditions
- **Done** when the JSON contract contains goal, scope, and at least one of acceptance_criteria or verification_path, and confidence >= 0.5.
- **Done with warnings** when contract is assembled but confidence < 0.7 — missing_fields и open_questions передаются downstream агентам как explicit gaps.
- **Stop early** if issue body is empty and no comments contain actionable content — return empty contract with confidence = 0.0 and escalate.

## Escalation Rules
- Escalate when goal cannot be determined from any source (body + comments) — ambiguous scope требует human clarification.
- Escalate when acceptance criteria and verification path are both missing and issue is marked as high priority.
- Escalate when contradictory decisions found in comment thread (два решения по одному вопросу без final resolution).
- Do NOT escalate for missing optional integration fields — просто включить их в missing_fields.
- Do NOT escalate for low-priority issues with confidence >= 0.5.

## Anti-Patterns
- **Do not invent acceptance criteria that are not in the source.** Если criteria нет — missing_fields, а не фантазия.
- **Do not flatten the comment thread.** Хронологический порядок и авторство критичны для decisions_summary.
- **Do not ignore @ask questions without answers.** Каждый unresolved @ask — это open_question в контракте.
- **Do not hardcode repo mapping.** Всегда использовать Repository Registry; не угадывать repo по названию issue.
- **Do not merge separate issues into one contract.** Один issue — один contract, даже если issues связаны.

## Denied Actions
- Do not write code, patches, or implementation.
- Do not modify the source Linear issue (no status changes, no comment posting).
- Do not access secrets or credentials.
- Do not make assumptions about repo structure beyond what Repository Registry provides.
- Do not execute verification steps — только описать verification_path.
