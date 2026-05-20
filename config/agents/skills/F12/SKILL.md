# F12 — Evaluation & Benchmark Harness

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Запускает eval-наборы для агентов/скиллов, собирает quality metrics, variance, false-positive/false-negative patterns и regression alerts.
- Why: Без evals агентная команда деградирует незаметно. Этот скилл делает качество измеримым и regression — обнаружимым.

## When To Use
- **Mandatory** after any skill or agent prompt change — прогнать benchmark до и после, сравнить.
- When deploying a new version of a skill — выполнить full eval suite с gold tasks для before/after comparison.
- When investigating quality degradation reports — запустить targeted eval для конкретного агента/скилла.
- When onboarding a new agent or skill — создать baseline benchmark и gold task set.
- Do NOT use for one-off manual testing or ad-hoc debugging — этот скилл для systematic, repeatable evaluation.

## Inputs
- Eval target: agent_id и/или skill_id, version (current vs. candidate).
- Gold task set: коллекция задач с known-good inputs и expected outputs/behaviors.
  - Gold tasks: эталонные issues с expected contract parse results.
  - Gold PRs: эталонные code changes с expected review findings.
  - Gold verifications: эталонные verification paths с expected pass/fail outcomes.
- Eval suite config: which metrics to collect, thresholds, variance tolerance.
- Previous benchmark results (для before/after comparison).
- Rollback policy: автоматический откат при regression ниже threshold.

## Steps
1. **Load gold task set** — загрузить набор эталонных задач для целевого агента/скилла:
   - Валидировать, что gold set актуален (last reviewed date, schema version match).
   - Если gold set отсутствует или устарел — **STOP**, эскалировать для создания/обновления.
   - Разделить на categories: happy path, edge cases, adversarial inputs, regression cases.

2. **Capture baseline (before)** — зафиксировать текущие метрики перед изменением:
   - Выполнить полный eval suite на текущей (production) версии skill/agent.
   - Записать: accuracy, precision, recall, F1 для classification tasks.
   - Записать: quality score, completeness, correctness для generative tasks.
   - Записать: latency, token usage, error rate для operational metrics.
   - Сохранить как `baseline_{timestamp}.json`.

3. **Run candidate evaluation** — выполнить тот же eval suite на новой версии:
   - Использовать identically-configured environment — same gold tasks, same eval criteria.
   - Записать все те же метрики что и для baseline.
   - Для каждого gold task записать: input, expected output, actual output, match score, diff.
   - Сохранить как `candidate_{timestamp}.json`.

4. **Compute before/after delta** — сравнить baseline и candidate:
   - Для каждой метрики: absolute delta, percentage delta, significance (если sample size позволяет).
   - Identify regressions: метрики, которые ухудшились за threshold (default: >2% drop).
   - Identify improvements: метрики, которые улучшились.
   - Identify neutral: метрики в пределах variance tolerance.

5. **Analyze false-positive/false-negative patterns** — для classification-style skills:
   - Построить confusion matrix по gold tasks.
   - Выделить systematic patterns: какие типы inputs вызывают FP/FN.
   - Сравнить FP/FN patterns между baseline и candidate — новые patterns это red flag.
   - Записать: pattern description, affected gold tasks, severity.

6. **Variance analysis** — проверить стабильность результатов:
   - Выполнить eval suite 3-5 раз (если ресурсы позволяют) для оценки variance.
   - Если variance > threshold — пометить как unstable, включить в report.
   - Высокая variance на одном конкретном gold task — пометить как flaky eval case.

7. **Generate regression alert or approval** — принять решение:
   - Если regressions > 0 и severity HIGH — generate **REGRESSION ALERT**, block deployment.
   - Если regressions > 0 и severity LOW — generate **WARNING**, include in report, allow with review.
   - Если no regressions и improvements detected — generate **APPROVED**, proceed.
   - Если no regressions и no improvements — generate **NEUTRAL**, proceed.

8. **Apply auto-rollback rules** — если настроен автоматический откат:
   - При REGRESSION ALERT + auto-rollback policy — автоматически вернуть предыдущую версию skill/agent.
   - Записать rollback event: reason, metrics delta, affected tasks.
   - Уведомить EvalsAgent и OrchestratorAgent о rollback.

9. **Compile eval report** — собрать итоговый отчёт:
   - Summary: verdict (APPROVED / WARNING / REGRESSION / ROLLBACK).
   - Metrics table: baseline vs. candidate для каждой метрики.
   - Regression details: affected tasks, patterns, severity.
   - Recommendations: what to fix before re-evaluation.
   - Link to raw artifacts: full eval logs, gold task diffs, variance data.

## Stop Conditions
- **Done** when eval suite has completed, before/after delta computed, verdict issued, and report compiled.
- **Blocked** when gold task set is missing or outdated — cannot produce meaningful eval without ground truth.
- **Rollback triggered** when regression exceeds auto-rollback threshold — skill reverted, report filed.
- **Never skip** the before/after comparison — isolated candidate metrics are meaningless without baseline.

## Escalation Rules
- Escalate when gold task set needs updating (new edge cases discovered, schema changed).
- Escalate when regression is detected but auto-rollback is not configured and human decision is needed.
- Escalate when variance is too high to produce reliable before/after comparison.
- Escalate when eval suite itself produces errors (infrastructure issues, timeout, resource limits).
- Do NOT escalate for clean APPROVED results — routine success does not require human attention.

## Anti-Patterns
- **Do not evaluate without a baseline** — "it looks good" without before/after comparison is not evidence.
- **Do not use stale gold tasks** — gold set must reflect current requirements, not historical ones.
- **Do not cherry-pick gold tasks to show improvement** — eval must run on the full set, not a flattering subset.
- **Do not ignore variance** — a result that changes on every run is not a valid measurement.
- **Do not treat eval as a one-time event** — every skill change triggers eval, no exceptions.

## Denied Actions
- Do not modify gold task expected outputs to match candidate results — that is gaming the eval.
- Do not deploy a skill version that has not passed eval (unless explicit human override with documented reason).
- Do not delete or overwrite previous baseline results — all baselines are immutable history.
- Do not run eval on a different environment than production-equivalent — eval must reflect real conditions.
- Do not suppress regression alerts to avoid blocking deployment.
