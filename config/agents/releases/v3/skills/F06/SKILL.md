# F06 — Structured Summary Writer

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- Why: Агентная система умирает, если люди не понимают, что именно уже сделано и что осталось.

## When To Use
- When an agent completes a work phase and needs to post a structured update to a Linear comment or PR description.
- When a blocker, question, or risk needs to be communicated to humans in a scannable format.
- When release notes, postmortem summaries, or monitoring status updates need to be generated from raw agent outputs.
- When OrchestratorAgent or any downstream agent needs a human-readable summary before handing off to the next phase.
- Do NOT use for internal agent-to-agent data transfer — use structured JSON contracts (F01/F02) instead.

## Inputs
- Summary format — один из: `work_summary`, `blocker_summary`, `question_summary`, `pr_summary`, `release_summary`, `monitoring_summary`.
- Raw content — неструктурированные данные: agent logs, diff stats, test results, error messages, timeline events.
- Contract reference — issue_id и/или PR id для linkback.
- Audience hint — `human_reviewer`, `product_owner`, `on_call_engineer`, `release_manager` (влияет на уровень технических деталей).
- Prior summaries — предыдущие сводки по этому issue/PR (для delta mode: что изменилось с прошлого раза).

## Steps
1. **Select format template** — по значению summary format выбрать соответствующий шаблон. Каждый шаблон определяет обязательные секции: work_summary = `[facts, changes, remaining, links]`; blocker_summary = `[blocker, impact, asks, links]`; question_summary = `[questions, context, options, asks]`; pr_summary = `[what, why, how, test_plan, links]`; release_summary = `[changes, breaking, migration, rollback, links]`; monitoring_summary = `[status, metrics, alerts, unknowns, links]`.
2. **Extract facts from raw content** — пройти raw content и выделить только верифицируемые факты: конкретные файлы, числа, test results, error messages, timestamps. Отделить facts от interpretations. Если факт не подтверждён source data — не включать.
3. **Identify unknowns and open asks** — из raw content и contract выделить: unknowns (вещи, которые агент не смог определить) и asks (конкретные вопросы или действия, которые нужны от человека). Каждый ask должен быть actionable: кто, что, зачем.
4. **Compose summary body** — заполнить секции шаблона. Правила: максимум 5-7 bullet points на секцию; каждый bullet начинается с глагола или состояния; без вводных слов ("следует отметить", "важно заметить"); числа и paths без markdown bold (читаемость в Linear). Если audience = product_owner, убрать implementation details и оставить business impact.
5. **Attach links** — добавить секцию links: issue URL, PR URL, CI run URL, relevant dashboard URLs, previous summary links. Без битых ссылок — если URL не передан в inputs, не генерировать placeholder.
6. **Delta check against prior summaries** — если переданы prior summaries, сравнить: новые facts, resolved asks, changed status. Добавить delta marker `[NEW]` / `[RESOLVED]` / `[CHANGED]` к соответствующим bullets. Не повторять unchanged facts целиком.
7. **Final validation** — проверить: (a) нет пустых обязательных секций, (b) каждый ask содержит actionable request, (c) facts секция не содержит предположений, (d) summary не превышает 300 слов для work/blocker/question или 500 слов для release/pr/monitoring.

## Stop Conditions
- **Done** when all mandatory sections for the selected format are filled with at least one fact-based bullet each, and the summary passes final validation.
- **Done with warnings** when one optional section is empty but all mandatory sections are complete — include a note about the gap.
- **Stop early** if raw content is empty or contains no extractable facts — return a minimal summary stating "No actionable content available" and escalate.

## Escalation Rules
- Escalate when raw content contains contradictory facts that cannot be resolved without human input.
- Escalate when a blocker_summary or question_summary has asks that have been unresolved for more than 2 prior summaries.
- Do NOT escalate for missing optional links or dashboard URLs.
- Do NOT escalate when audience hint is not provided — default to `human_reviewer`.

## Anti-Patterns
- **Do not write vague summaries.** "Работа продвигается" — не summary. Каждый bullet должен содержать конкретный факт или конкретный вопрос.
- **Do not include unverified claims as facts.** Если тесты не запускались, не писать "tests pass". Отнести в unknowns.
- **Do not repeat the entire prior summary.** Использовать delta mode; повторение создаёт noise и скрывает прогресс.
- **Do not mix formats.** Один вызов = один format. Если нужны и work_summary и blocker_summary — два отдельных вызова.
- **Do not add decorative text.** Без приветствий, благодарностей, emoji, мотивационных фраз. Только signal.

## Denied Actions
- Do not modify source issues, PRs, or comments — только генерировать текст summary.
- Do not execute commands or run tests — только описывать результаты из raw content.
- Do not include secrets, tokens, or credential values in any summary.
- Do not fabricate links, metric values, or test results.
- Do not post summaries directly — возвращать текст вызывающему агенту для публикации.
