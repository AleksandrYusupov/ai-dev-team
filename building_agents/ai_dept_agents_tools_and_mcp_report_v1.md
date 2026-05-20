# AI-отдел разработки: карта инструментов и MCP по ролям

Этот документ продолжает твою карту ролей и скиллов, но переводит её в **реальную tool/MCP-оснастку**. Я не раздаю всем агентам одинаковый доступ. Наоборот: здесь зафиксирован **least-privilege набор** по каждой роли, где отдельно отмечены **must-have** и **strongly desirable** элементы.

## 1. Главный вывод

Для твоей архитектуры нужны **два слоя**:

1. **Внутренний control-plane MCP слой** — обязателен. Он должен отражать твою архитектуру источников истины: Linear, Temporal, GitHub, knowledge-service, registry, secrets/auth plane, observability bridge.

2. **Внешний слой сильных MCP и инструментов** — GitHub, Linear, Playwright, Sentry/Datadog, Figma, Terraform, DB Toolbox, Postman, Hookdeck/ngrok, CodeQL/Semgrep/Trivy, Langfuse, Promptfoo и т.д.

Критично: не давать каждому агенту прямой raw-доступ ко всем внешним MCP. Большая часть записи должна идти через твои внутренние wrapper/guard MCP, иначе у тебя поплывут права, source-of-truth и auditability.

## 2. Принципы назначения

- **Default = read-only.** Запись даётся только тем ролям, которым она реально нужна.
- **Write only through wrappers.** Официальные внешние MCP хороши как transport/capability layer, но важные записи должны проходить через твой policy-aware control plane.
- **Prod credentials / OAuth consent / vendor console / protected deploy = human-gated.** Это нельзя оставлять полностью автономно.
- **Один primary source на слой.** Один primary observability source, один primary feature-flag source, один primary cloud control-plane source. Не размазывай одинаковые полномочия по нескольким MCP без нужды.
- **Не использовать reference MCP servers как production-by-default.** Для filesystem/git/fetch-подобных штук либо жёстко харденить, либо заменять на собственные безопасные сервисы/wrappers.
- **Каждый MCP проходит allowlist + testing + audit.** До выдачи агентам — через registry/allowlist, MCP Inspector и централизованный gateway.

## 3. Shared baseline: что должно быть у отдела в целом

### 3.1 Внутренние custom MCP — non-negotiable

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `linear-control-mcp` | scoped-rw | Единая точка записи в Linear: статусы, комментарии, agent sessions, externalUrls, allowed transitions и reason codes. _Поверх официального Linear MCP; должен уважать твою state machine и @ask._ |
| must-have | internal-mcp | `github-control-mcp` | scoped-rw | Обёртка над GitHub для branch/PR/checks/deploy связки с repo allowlist, merge/deploy guardrails и audit trail. _Поверх официального GitHub MCP и GitHub App / installation tokens._ |
| must-have | internal-mcp | `temporal-workflow-mcp` | scoped-rw | Доступ к Query/Signal/Update, lookup активных runs и их machine-state без прямого доступа агентов к воркерам. |
| must-have | internal-mcp | `knowledge-service-mcp` | ro | Канонический доступ к Obsidian/docs context packs, а не прямое чтение vault агентами. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | Разрешает primary_repo, affected_repos, dependencies, environments, required_checks и guidance_scope. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | Хранит и раздаёт SPEC/ADR/PLAN, review reports, test reports, rollout notes, dashboards, PR/deploy links. |
| must-have | internal-mcp | `comment-memory-mcp` | rw | Канонический журнал комментариев, summaries, decision log, @ask extraction и resume context. |
| must-have | internal-mcp | `secrets-auth-plane-mcp` | metadata-only | Даёт только aliases/handles, consent state, redirect/callback facts и validation status; никогда не отдаёт raw secrets. |
| must-have | internal-mcp | `runner-capability-mcp` | ro | Проверяет network/browser/oauth/webhook lab capabilities и допустимые domains/tools для конкретного раннера. |
| must-have | internal-mcp | `policy-guard-mcp` | policy-enforcement | Единый least-privilege слой: какие команды, MCP, пути, environments и действия разрешены агенту. |
| must-have | internal-mcp | `observability-bridge-mcp` | ro | Нормализует деплой/релиз/ошибки/alerts/trace lookup поверх Sentry, Datadog и иных систем, чтобы агент видел один API. |
| must-have | internal-mcp | `release-policy-mcp` | ro+gate | Хранит release constraints, rollout policy, protected env requirements, monitoring windows, rollback rules. |
| must-have | internal-mcp | `migration-control-mcp` | nonprod-write/prod-read | Dry-run/backfill/chunking/checksum/reconciliation/rate-limit слой для миграций и data changes. |
| must-have | internal-mcp | `evals-dataset-mcp` | rw | Хранит eval datasets, scored traces, regressions и golden examples для EvalsAgent. |

### 3.2 Внешние MCP и инструменты общего назначения

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | scoped-rw | Официальный MCP для поиска/создания/обновления issues, comments, projects и product-management объектов. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | scoped-rw | Официальный MCP GitHub для branch/PR/issues/search/merge workflows; использовать только через allowlist и wrapper. |
| must-have | platform | [Docker MCP Gateway](https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/) | platform | Централизует конфигурацию, credentials и access control для множества MCP-серверов. |
| must-have | platform | [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) | platform | Нужен для тестирования и отладки каждого MCP до допуска в боевой allowlist. |
| must-have | platform | [OpenTelemetry](https://opentelemetry.io/docs/) | platform | Единый vendor-neutral стандарт traces/metrics/logs и context propagation для всего отдела. |
| must-have | tool | [Langfuse](https://langfuse.com/docs) | platform | Observability + datasets/evals по агентным трассам, с поддержкой OpenTelemetry. |
| must-have | tool | [Promptfoo](https://www.promptfoo.dev/docs/intro/) | platform | CLI для eval/red-team/CI по prompt- и agent-сценариям. |
| strongly desirable | external-mcp | [Sentry MCP Server](https://docs.sentry.io/ai/mcp/) | ro | Сильный app-centric источник issues, releases, performance и RCA; выбрать как primary, если Sentry — ваш app observability source. |
| strongly desirable | external-mcp | [Datadog MCP Server](https://docs.datadoghq.com/bits_ai/mcp_server/) | ro | Сильный infra/SRE-centric источник alerting, software delivery, feature flags и audit for MCP calls; выбрать как primary, если Datadog — ваш ops source. |
| must-have | external-mcp | [Google MCP Toolbox for Databases](https://googleapis.github.io/genai-toolbox/getting-started/introduction/) | ro/nonprod-write | Безопасная общая шина к БД с connection pooling и auth handling. |
| must-have | external-mcp | [Playwright MCP](https://github.com/microsoft/playwright-mcp) | controlled-rw | Browser automation для smoke/E2E/OAuth flows/UX verification без скриншотной магии. |
| must-have | tool | [CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/about-code-scanning-with-codeql) | ci | Базовый SAST и code scanning в GitHub. |
| must-have | tool | [Semgrep](https://semgrep.dev/docs/introduction) | ci/local | Быстрый SAST/SCA/secrets и кастомные rules под ваши secure coding policies. |
| must-have | tool | [Trivy](https://trivy.dev/docs/latest/) | ci/local | Vuln/misconfig/secret/license scanning для контейнеров, IaC и filesystem. |
| must-have | tool | [Renovate](https://docs.renovatebot.com/) | bot-rw | Основной двигатель для dependency freshness, scheduling и mass maintenance PRs. |
| must-have | tool | [Dependabot security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-dependabot-security-updates) | bot-rw | Полезен как security-specific слой поверх или рядом с Renovate. |
| must-have | tool | [Dependency graph](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependency-graph) | ro | Нужен для dependency discovery и impact analysis. |
| must-have | tool | [Dependency review](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/customizing-your-dependency-review-action-configuration) | ci | Блокирует merge PR с уязвимыми dependency changes, если workflow сделать required. |
| strongly desirable | tool | [Postman Collection Runner / Postman CLI](https://learning.postman.com/docs/collections/running-collections/intro-to-collection-runs/) | local+ci | Универсальный функциональный API smoke/regression runner и CI executor. |
| strongly desirable | tool | [Hookdeck or ngrok](https://hookdeck.com/docs/guides/how-to-test-webhooks-locally) | local+lab | Webhook tunneling/inspection/replay для интеграций и callback debugging. |
| strongly desirable | external-mcp | [Terraform MCP Server](https://developer.hashicorp.com/terraform/mcp-server) | ro/scoped-rw | Must-have для IaC-heavy контуров: актуальная Registry-документация, workspace ops и modules. |
| strongly desirable | external-mcp | [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/) | ro/scoped-rw | Критичен для design-driven frontend: design context, variables/styles, Code Connect, write-back to canvas. |
| strongly desirable | tool | [Schemathesis](https://schemathesis.readthedocs.io/en/stable/) | ci/local | Генерирует property-based tests из OpenAPI/GraphQL схем и часто находит edge-case баги, которые ручные тесты пропускают. |
| strongly desirable | tool | [Storybook + Chromatic](https://storybook.js.org/docs/writing-tests/visual-testing) | ci | Для UI component workflows, visual diffing и living docs. |
| strongly desirable | tool | [axe-core / Storybook a11y](https://storybook.js.org/docs/writing-tests/accessibility-testing) | ci/local | Базовый автоматизированный accessibility слой для UI. |
| strongly desirable | tool | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md) | ci | Performance/SEO/best-practices regression checks для web-фронта. |
| strongly desirable | tool | [Pa11y](https://pa11y.org/) | ci/dashboard | Полезен как второй accessibility слой и dashboard для non-dev stakeholders. |
| strongly desirable | external-mcp | [AWS Documentation / Knowledge / API MCPs](https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server) | ro/scoped-rw | Для AWS-heavy контуров: актуальная документация, knowledge и безопасные API operations. |
| strongly desirable | external-mcp | [Cloudflare MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/) | ro/scoped-rw | Для Cloudflare-heavy контуров: account config, security/performance suggestions, controlled changes. |
| strongly desirable | external-mcp | [Slack MCP](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server) | ro/scoped-rw | Для incident/release comms и поиска operational context в Slack. |
| strongly desirable | external-mcp | [LaunchDarkly MCP](https://launchdarkly.com/docs/home/getting-started/mcp) | scoped-rw | Feature flags + observability MCP для controlled rollouts. |
| strongly desirable | external-mcp | [GrowthBook MCP](https://docs.growthbook.io/integrations/mcp) | scoped-rw | Флаги и experiments, если стандартом выбран GrowthBook. |
| strongly desirable | external-mcp | [Unleash MCP](https://docs.getunleash.io/integrate/mcp) | scoped-rw | Флаги и rollout control, если стандартом выбран Unleash. |
| strongly desirable | external-mcp | [PostHog feature-flags MCP](https://posthog.com/docs/feature-flags/create-flags-mcp) | scoped-rw | Флаги + product telemetry, если стандартом выбран PostHog. |
| strongly desirable | external-mcp | [Stripe MCP](https://docs.stripe.com/mcp) | ro/scoped-rw | Сильный provider-specific MCP для payments/billing задач. |
| strongly desirable | tool | [Stripe CLI](https://docs.stripe.com/stripe-cli) | local+lab | Локальный тестинг Stripe API/webhooks. |
| strongly desirable | tool | [k6](https://grafana.com/docs/k6/latest/) | ci/local | Нагрузочное/reliability тестирование API и web сценариев в release/test контуре. |
| strongly desirable | external-mcp | [OpenAPI MCP](https://awslabs.github.io/mcp/servers/openapi-mcp-server) | ro/scoped-rw | Динамический мост от OpenAPI-спеков к вызываемым MCP tools. |

## 4. Что ставить каждой роли

### Control-plane и coordination

#### A00 — OrchestratorAgent

- **Миссия:** Управляет state machine issue, запускает/останавливает специализированных агентов, следит за human gates, publishes high-signal status back to Linear.
- **Почему именно так:** эта роль у тебя отвечает за Следить за allowed status transitions и запускать правильный workflow на каждом этапе, Выбирать нужного внутреннего агента/подагента по type, risk, repo, status, Публиковать summaries, blockers, next actions и links на артефакты.
- **Минимум must-have:** 10
- **Strongly desirable:** 2

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `linear-control-mcp` | scoped-rw | State machine, statuses, agent sessions, comments, externalUrls. |
| must-have | internal-mcp | `temporal-workflow-mcp` | scoped-rw | Запуск/остановка/сигналы/queries для workflows. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | Маршрутизация issue -> repo/project/env/checks. |
| must-have | internal-mcp | `comment-memory-mcp` | rw | Резюме ниток, @ask, decision log. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | Линкует PR, test reports, review reports, release artifacts. |
| must-have | internal-mcp | `release-policy-mcp` | ro+gate | Проверка human gates и deploy constraints. |
| must-have | internal-mcp | `runner-capability-mcp` | ro | Нельзя запускать integration-build без подходящего раннера. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro/scoped-rw | Читать PR/checks/deploy state и, при политике, запускать limited actions. |
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | scoped-rw | Базовый официальный transport к Linear под внутренней обёрткой. |
| must-have | platform | [OpenTelemetry + Langfuse](https://langfuse.com/docs) | platform | Трассировка handoff latency, rework loops и stuck issues. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Slack MCP](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server) | ro/scoped-rw | Статусы и инцидентные уведомления в общий operational layer. |
| strongly desirable | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Корреляция workflow state с prod signals при hotfix/release/monitoring. |

_Особое ограничение доступа:_ release-policy-mcp.

#### A01 — IntakeAgent

- **Миссия:** Нормализует новый вход: типизирует задачу, проверяет полноту, ищет дубликаты, определяет маршрут.
- **Почему именно так:** эта роль у тебя отвечает за Classify type/risk/source/mode, Detect duplicates and near-duplicates, Identify missing input.
- **Минимум must-have:** 6
- **Strongly desirable:** 2

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `linear-control-mcp` | scoped-rw | Чтение новых задач/комментариев и выставление triage labels/status. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | Определение primary_repo, project и service dependencies. |
| must-have | internal-mcp | `knowledge-service-mcp` | ro | Быстрая проверка linked docs и root-note контекста. |
| must-have | internal-mcp | `comment-memory-mcp` | ro | near-duplicate detection с учётом comment history. |
| must-have | internal-mcp | `duplicate-search-mcp` | ro | Поиск похожих issues/PR/incidents по semantic similarity. _Новый внутренний сервис; очень окупается._ |
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | scoped-rw | Официальный слой для triage operations. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Проверка репо/PR контекста и existing work. |
| strongly desirable | external-mcp | [OpenAPI MCP](https://awslabs.github.io/mcp/servers/openapi-mcp-server) | ro | Полезен, когда Intake должен понять, что задача integration/API-driven. |

#### A02 — ContextAgent

- **Миссия:** Собирает authoritative context pack для остальных агентов.
- **Почему именно так:** эта роль у тебя отвечает за Pull repo guidance, Retrieve docs/ADR/runbooks, Summarize comment history.
- **Минимум must-have:** 6
- **Strongly desirable:** 4

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `knowledge-service-mcp` | ro | Главный источник context packs из Obsidian/docs. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | repo/dependency/environment resolution. |
| must-have | internal-mcp | `comment-memory-mcp` | ro | Каноническая история комментариев и решений. |
| must-have | internal-mcp | `artifact-registry-mcp` | ro | Достаёт SPEC/ADR/PLAN/PR/reports. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Читает repo guidance, recent PRs, CODEOWNERS, workflows. |
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | ro | Тянет issue/project/milestone context. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/) | ro | Для frontend issues добавляет design context и variables/styles. |
| strongly desirable | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Для bug/hotfix задач нужен runtime context, а не только docs. |
| strongly desirable | external-mcp | [Google MCP Toolbox for Databases](https://googleapis.github.io/genai-toolbox/getting-started/introduction/) | ro | Для data-heavy issues достаёт schema/table facts. |
| strongly desirable | external-mcp | [AWS / Cloudflare docs MCP](https://awslabs.github.io/mcp/servers/aws-documentation-mcp-server) | ro | Для infra-heavy contexts. |

#### A03 — SpecAgent

- **Миссия:** Превращает brief в исполнимый контракт задачи.
- **Почему именно так:** эта роль у тебя отвечает за Generate issue contract, Separate scope/non-goals, Engineer acceptance criteria.
- **Минимум must-have:** 6
- **Strongly desirable:** 3

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `knowledge-service-mcp` | ro | SPEC должен опираться на канонический docs pack. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | Правильная фиксация primary/affected repos. |
| must-have | internal-mcp | `comment-memory-mcp` | ro | Учитывает решения и open questions из thread. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | Публикация SPEC drafts/final. |
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | scoped-rw | Обновление issue contract, questions, summaries. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Проверка repo-local guidance и текущих contracts/docs. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [OpenAPI MCP](https://awslabs.github.io/mcp/servers/openapi-mcp-server) | ro | Для API/integration specs даёт структуру реального surface. |
| strongly desirable | external-mcp | [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/) | ro | Для UI specs: flows, components, states. |
| strongly desirable | external-mcp | [Google MCP Toolbox for Databases](https://googleapis.github.io/genai-toolbox/getting-started/introduction/) | ro | Для data contracts и verification path. |

#### A04 — ArchitectAgent

- **Миссия:** Готовит архитектурные решения и ADR для risky/cross-cutting work.
- **Почему именно так:** эта роль у тебя отвечает за Option matrix, Cross-repo impact analysis, Migration design.
- **Минимум must-have:** 6
- **Strongly desirable:** 3

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `knowledge-service-mcp` | ro | ADR должен опираться на existing architecture knowledge. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | Видит cross-repo and service boundaries. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | Публикация ADRs и architectural options. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Читает codebase and workflow constraints. |
| must-have | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Архитектурные решения без runtime signals часто ошибочны. |
| must-have | external-mcp | [Google MCP Toolbox for Databases](https://googleapis.github.io/genai-toolbox/getting-started/introduction/) | ro | Нужно видеть schema/data coupling для risky changes. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Terraform MCP / AWS docs / Cloudflare MCP](https://developer.hashicorp.com/terraform/mcp-server) | ro | Для infra/security/perf architecture decisions. |
| strongly desirable | external-mcp | [OpenAPI MCP](https://awslabs.github.io/mcp/servers/openapi-mcp-server) | ro | Нужно для API boundary и contract decomposition. |
| strongly desirable | external-mcp | [Feature-flag MCP](https://launchdarkly.com/docs/home/getting-started/mcp) | ro | Помогает проектировать safe rollout strategy заранее. |

#### A05 — PlanAgent

- **Миссия:** Декомпозирует контракт на milestones/sub-issues и execution plan.
- **Почему именно так:** эта роль у тебя отвечает за Sub-issue generation, Dependency sequencing, Plan.md generation.
- **Минимум must-have:** 6
- **Strongly desirable:** 2

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `linear-control-mcp` | scoped-rw | Разбиение на sub-issues, milestones, dependencies. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | Multi-repo decomposition и required checks. |
| must-have | internal-mcp | `knowledge-service-mcp` | ro | План должен знать docs-driven constraints. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | Хранит plan artifacts и decomposition outputs. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Видит repo boundaries, workflows, CODEOWNERS. |
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | scoped-rw | Создание и редактирование projects, milestones, sub-issues. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | tool | [Dependency graph](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependency-graph) | ro | Помогает учитывать transitive blast radius в плане. |
| strongly desirable | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Для hotfix/reliability plans. |

#### A20 — ReporterAgent

- **Миссия:** Ведёт диалог в комментариях и переводит внутреннее состояние системы в понятный human-readable слой.
- **Почему именно так:** эта роль у тебя отвечает за Respond in comments, Summarize progress, Surface blockers/questions.
- **Минимум must-have:** 5
- **Strongly desirable:** 2

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `linear-control-mcp` | scoped-rw | Комментарии, questions, final summaries, @ask resume. |
| must-have | internal-mcp | `comment-memory-mcp` | rw | Конденсация длинных threads в high-signal ответы. |
| must-have | internal-mcp | `artifact-registry-mcp` | ro | Вставляет PR/reports/release notes links. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Чтение PR/check state для human-readable updates. |
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | scoped-rw | Публикация комментариев и project updates. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Sentry / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Ответы на вопросы по monitoring/release состоянии. |
| strongly desirable | external-mcp | [Slack MCP](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server) | ro/scoped-rw | Если понадобится писать статус-апдейты и outside-Linear comms. |


### Integration/auth boundary

#### A21 — IntegrationAgent

- **Миссия:** Ведёт внешний integration lifecycle как отдельный readiness/auth/onboarding/control-plane поток: классифицирует integration kind и auth scheme, готовит sanitized integration artifacts, держит build-loop вне Ready for Build до закрытия prerequisites и доводит интеграцию до go-live boundary.
- **Почему именно так:** эта роль у тебя отвечает за Classify provider, integration_kind and auth_scheme, Produce integration_brief and auth_decision_record, Extend/validate issue contract fields for provider, scopes, redirect URIs, callback URLs, test strategy, go-live checklist and rollback plan.
- **Минимум must-have:** 10
- **Strongly desirable:** 5

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `secrets-auth-plane-mcp` | metadata-only | Без этого IntegrationAgent превращается в источник утечек и raw creds drift. |
| must-have | internal-mcp | `runner-capability-mcp` | ro | Проверяет browser consent, allowed domains, webhook lab, secret broker. |
| must-have | internal-mcp | `policy-guard-mcp` | policy-enforcement | Жёсткая граница для OAuth/webhook/provider actions. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | integration_brief, auth_decision_record, webhook_validation_report, go-live checklist. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | Связывает интеграцию с сервисами, envs и repos. |
| must-have | external-mcp | [OpenAPI MCP](https://awslabs.github.io/mcp/servers/openapi-mcp-server) | ro/scoped-rw | Лучший общий мост к OpenAPI-first провайдерам. |
| must-have | tool | [Postman CLI / Collection Runner](https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/) | local+ci | Функциональные и regression сценарии по provider APIs. |
| must-have | tool | [Hookdeck or ngrok](https://hookdeck.com/docs/guides/how-to-test-webhooks-locally) | lab | Webhook receive/inspect/replay loop. |
| must-have | external-mcp | [Playwright MCP](https://github.com/microsoft/playwright-mcp) | controlled-rw | OAuth/browser consent, callback validation, dashboard setup rehearsals. |
| must-have | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Go-live и webhook failures должны видеть runtime signals. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Stripe MCP](https://docs.stripe.com/mcp) | ro/scoped-rw | Must-have, если integration kind = payments/billing. |
| strongly desirable | tool | [Stripe CLI](https://docs.stripe.com/stripe-cli) | lab | Локальный payment/webhook test loop. |
| strongly desirable | external-mcp | [Slack MCP](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server) | ro/scoped-rw | Must-have, если integration kind = Slack. |
| strongly desirable | external-mcp | [AWS / Cloudflare docs MCP](https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server) | ro | Помогают для providers с cloud-native docs/surfaces. |
| strongly desirable | tool | [Schemathesis](https://schemathesis.readthedocs.io/en/stable/) | ci/local | Автоматический negative/property-based слой поверх provider schemas. |

_Особое ограничение доступа:_ secrets-auth-plane-mcp.


### Build-профили

#### A06 — BuildAgent-Backend

- **Миссия:** Реализует backend code changes в пределах узкого плана и repo conventions.
- **Почему именно так:** эта роль у тебя отвечает за Implement scoped code changes, Run targeted tests, Update docs touched by code.
- **Минимум must-have:** 9
- **Strongly desirable:** 4

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `github-control-mcp` | scoped-rw | Repo-scoped coding, PR drafting, checks awareness. |
| must-have | internal-mcp | `knowledge-service-mcp` | ro | Repo guidance и docs-driven constraints. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | changed-files summary, build reports, PR notes. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | scoped-rw | Основной code/PR surface. |
| must-have | external-mcp | [Google MCP Toolbox for Databases](https://googleapis.github.io/genai-toolbox/getting-started/introduction/) | ro/nonprod-write | DB-aware backend changes и safe local validation. |
| must-have | external-mcp | [OpenAPI MCP](https://awslabs.github.io/mcp/servers/openapi-mcp-server) | ro | Контрактная работа с APIs. |
| must-have | tool | [Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/) | local+ci | API smoke/regression прямо из agent loop. |
| must-have | tool | [CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/about-code-scanning-with-codeql) | ci | Security/code scanning baseline. |
| must-have | tool | [Semgrep](https://semgrep.dev/docs/introduction) | ci/local | Быстрые локальные и CI security checks. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | tool | [Trivy](https://trivy.dev/docs/latest/) | ci/local | Если backend repo билдит контейнеры или имеет IaC. |
| strongly desirable | tool | [Schemathesis](https://schemathesis.readthedocs.io/en/stable/) | ci/local | Нужен для API-first repos. |
| strongly desirable | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Bugfix loop и hotfixes. |
| strongly desirable | external-mcp | [AWS / Cloudflare docs MCP](https://awslabs.github.io/mcp/servers/aws-documentation-mcp-server) | ro | Если backend тесно завязан на облачный stack. |

#### A07 — BuildAgent-Frontend

- **Миссия:** Реализует UI/UX/code changes с соблюдением design system, a11y и state flows.
- **Почему именно так:** эта роль у тебя отвечает за Build components/pages, Respect loading/error/empty states, Add analytics/a11y hooks.
- **Минимум must-have:** 7
- **Strongly desirable:** 3

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `github-control-mcp` | scoped-rw | UI code changes, PRs, checks. |
| must-have | internal-mcp | `knowledge-service-mcp` | ro | Repo guidance + docs. |
| must-have | external-mcp | [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/) | ro | Design context, variables, styles, Code Connect. |
| must-have | external-mcp | [Playwright MCP](https://github.com/microsoft/playwright-mcp) | controlled-rw | E2E, UX states, bug repro, smoke. |
| must-have | tool | [Storybook + Chromatic](https://storybook.js.org/docs/writing-tests/visual-testing) | ci | Компонентные living docs и visual regression. |
| must-have | tool | [axe-core / Storybook a11y](https://storybook.js.org/docs/writing-tests/accessibility-testing) | ci/local | Базовый accessibility gate. |
| must-have | tool | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md) | ci | Performance and best-practices regressions. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | tool | [Pa11y](https://pa11y.org/) | ci/dashboard | Второй accessibility слой и dashboard для non-engineers. |
| strongly desirable | external-mcp | [PostHog / LaunchDarkly / GrowthBook / Unleash MCP](https://posthog.com/docs/feature-flags/create-flags-mcp) | scoped-rw | UI rollouts, experiments, kill-switches. |
| strongly desirable | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Frontend errors and rollout feedback. |

#### A08 — BuildAgent-Integrations

- **Миссия:** Реализует adapter/client/webhook code внутри границ, заранее определённых IntegrationAgent и Secrets/Auth plane.
- **Почему именно так:** эта роль у тебя отвечает за Implement resilient API clients, adapters and webhook handlers, Respect integration_brief, auth_decision_record and webhook_contract, Consume secret aliases/handles and sanitized auth artifacts instead of raw credentials.
- **Минимум must-have:** 10
- **Strongly desirable:** 2

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `github-control-mcp` | scoped-rw | Integration code lives in repos, not in auth plane. |
| must-have | internal-mcp | `secrets-auth-plane-mcp` | metadata-only | Получает aliases/handles, never raw creds. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | failure-mode notes, validation reports, docs artifacts. |
| must-have | external-mcp | [OpenAPI MCP](https://awslabs.github.io/mcp/servers/openapi-mcp-server) | ro/scoped-rw | Provider contract execution surface. |
| must-have | tool | [Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/) | local+ci | Deterministic integration request suites. |
| must-have | tool | [Hookdeck or ngrok](https://hookdeck.com/docs/guides/how-to-test-webhooks-locally) | lab | Webhook handler development loop. |
| must-have | external-mcp | [Playwright MCP](https://github.com/microsoft/playwright-mcp) | controlled-rw | Dashboard/browser flows around integrations. |
| must-have | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Observe retries, webhook failures, rate limits. |
| must-have | tool | [CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/about-code-scanning-with-codeql) | ci | Security baseline. |
| must-have | tool | [Semgrep](https://semgrep.dev/docs/introduction) | ci/local | Secret misuse, auth mistakes, webhook hardening checks. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Stripe MCP / Slack MCP / provider-specific MCPs](https://docs.stripe.com/mcp) | ro/scoped-rw | Включать по provider family. |
| strongly desirable | tool | [Schemathesis](https://schemathesis.readthedocs.io/en/stable/) | ci/local | Полезен, когда у провайдера есть качественный spec. |

_Особое ограничение доступа:_ secrets-auth-plane-mcp.

#### A09 — BuildAgent-DataMigration

- **Миссия:** Ведёт safe schema/data changes и backfills.
- **Почему именно так:** эта роль у тебя отвечает за Design migrations, Keep backward compatibility, Prepare expand/migrate/contract steps.
- **Минимум must-have:** 6
- **Strongly desirable:** 2

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `github-control-mcp` | scoped-rw | Migration code and rollout docs in repo. |
| must-have | internal-mcp | `migration-control-mcp` | nonprod-write/prod-read | Dry-runs, chunking, progress, checksums, reconciliation. |
| must-have | internal-mcp | `repo-registry-mcp` | ro | affected services / environments. |
| must-have | external-mcp | `Google MCP Toolbox for Databases` | ro/nonprod-write | Schema inspection, safe query execution, validation. |
| must-have | external-mcp | [Feature-flag MCP](https://launchdarkly.com/docs/home/getting-started/mcp) | scoped-rw | Dark-launch / kill switch / staged activation для risky migrations. |
| must-have | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Detect data regressions after rollout. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | tool | [Postman CLI / Schemathesis](https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/) | ci/local | Если миграция задевает API behavior. |
| strongly desirable | tool | [k6](https://grafana.com/docs/k6/latest/) | ci/local | Backfill/perf impact and threshold testing. |

#### A10 — BuildAgent-InfraIaC

- **Миссия:** Меняет infrastructure-as-code, CI/CD и environment configs по golden path.
- **Почему именно так:** эта роль у тебя отвечает за Modify IaC safely, Respect least privilege, Bootstrap or update CI/CD.
- **Минимум must-have:** 6
- **Strongly desirable:** 4

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `github-control-mcp` | scoped-rw | IaC and workflow changes in repo. |
| must-have | internal-mcp | `release-policy-mcp` | ro+gate | Environment policies and deployment constraints. |
| must-have | external-mcp | [Terraform MCP Server](https://developer.hashicorp.com/terraform/mcp-server) | ro/scoped-rw | Актуальные provider/module/policy данные и workspace ops. |
| must-have | tool | [CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/about-code-scanning-with-codeql) | ci | Проверки для GitHub Actions и repo automation code. |
| must-have | tool | [Semgrep](https://semgrep.dev/docs/introduction) | ci/local | Custom policies по IaC/config/security. |
| must-have | tool | [Trivy](https://trivy.dev/docs/latest/) | ci/local | Misconfig/vuln scanning для Terraform/K8s/Docker и др. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [AWS docs/knowledge/API MCPs](https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server) | ro/scoped-rw | Если ваш IaC primarily AWS. |
| strongly desirable | external-mcp | [Cloudflare MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/) | ro/scoped-rw | Если ваш edge/network stack в Cloudflare. |
| strongly desirable | external-mcp | [Datadog MCP / Sentry MCP](https://docs.datadoghq.com/bits_ai/mcp_server/) | ro | Видеть последствия infra changes. |
| strongly desirable | platform | [Docker MCP Gateway](https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/) | platform | Удобен для platform-команды, которая обслуживает MCP layer. |

_Особое ограничение доступа:_ release-policy-mcp.


### Quality / review / security / docs

#### A11 — TestAgent

- **Миссия:** Строит и выполняет правильную стратегию доказательства качества.
- **Почему именно так:** эта роль у тебя отвечает за Choose test mix, Write tests, Run fail-first loop.
- **Минимум must-have:** 6
- **Strongly desirable:** 4

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `ci-verification-mcp` | rw | Единая оркестрация verification_path, сбор reports и verdicts. _Новый внутренний сервис поверх CI/test runners._ |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | Сохраняет test evidence и matrices. |
| must-have | external-mcp | [Playwright MCP](https://github.com/microsoft/playwright-mcp) | controlled-rw | E2E/smoke/browser checks. |
| must-have | tool | [Schemathesis](https://schemathesis.readthedocs.io/en/stable/) | ci/local | API property-based/negative testing. |
| must-have | tool | [Postman CLI / Newman](https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/) | ci/local | Deterministic API workflow suites. |
| must-have | tool | [axe-core / Storybook a11y](https://storybook.js.org/docs/writing-tests/accessibility-testing) | ci/local | Accessibility as part of verification_path. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | tool | [k6](https://grafana.com/docs/k6/latest/) | ci/local | Performance/smoke/reliability checks before release. |
| strongly desirable | external-mcp | [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/) | ro | Сравнение expected UX states с реализованным UI. |
| strongly desirable | tool | [Hookdeck / ngrok](https://hookdeck.com/docs/guides/how-to-test-webhooks-locally) | lab | Тестирование webhook flows. |
| strongly desirable | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Proof via runtime signals. |

#### A12 — ReviewAgent

- **Миссия:** Делает независимый semantic review изменений до human review.
- **Почему именно так:** эта роль у тебя отвечает за Semantic diff review, Regression hunting, Performance/scalability review.
- **Минимум must-have:** 5
- **Strongly desirable:** 4

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `knowledge-service-mcp` | ro | Свежий контекст для независимого review. |
| must-have | internal-mcp | `artifact-registry-mcp` | ro | Берёт plan/spec/test outputs/release notes. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Чтение diff/PR/checks/issues. |
| must-have | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Review должен видеть реальный blast radius и suspect changes. |
| must-have | tool | [Dependency graph + dependency review](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/customizing-your-dependency-review-action-configuration) | ro | Для review dependency changes. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Playwright MCP](https://github.com/microsoft/playwright-mcp) | controlled-rw | Bug repro / UI validation during review. |
| strongly desirable | external-mcp | [Google MCP Toolbox for Databases](https://googleapis.github.io/genai-toolbox/getting-started/introduction/) | ro | Проверка impact на schema/data paths. |
| strongly desirable | external-mcp | [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/) | ro | Для UI diffs и design conformance. |
| strongly desirable | tool | [CodeQL / Semgrep / Trivy reports](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/about-code-scanning-with-codeql) | ro | Security findings как часть review pack. |

#### A13 — SecurityAgent

- **Миссия:** Проверяет secure-by-design и secure-by-implementation аспекты.
- **Почему именно так:** эта роль у тебя отвечает за Threat modeling, Secure coding review, Supply chain/dependency risk.
- **Минимум must-have:** 8
- **Strongly desirable:** 3

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `secrets-auth-plane-mcp` | metadata-only | Security review auth/integration boundary без утечки секретов. |
| must-have | internal-mcp | `policy-guard-mcp` | policy-enforcement | Проверяет, что agent/tool scopes не размыты. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Чтение code, Actions, permissions, workflows. |
| must-have | tool | [CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/about-code-scanning-with-codeql) | ci | Основной security/code scanning baseline. |
| must-have | tool | [Semgrep](https://semgrep.dev/docs/introduction) | ci/local | Custom secure coding, secrets and business-logic rules. |
| must-have | tool | [Trivy](https://trivy.dev/docs/latest/) | ci/local | Vuln/misconfig/license/secret scanning. |
| must-have | tool | [Dependabot security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-dependabot-security-updates) | bot-rw | Security patch loop. |
| must-have | tool | [Dependency review](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/customizing-your-dependency-review-action-configuration) | ci | PR gate against known vulnerable dependency changes. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Detect exploit-like error patterns and release regressions. |
| strongly desirable | tool | [Promptfoo](https://www.promptfoo.dev/docs/intro/) | ci/local | Red-team промпты, evals и agent/MCP misuse tests. |
| strongly desirable | external-mcp | [Cloudflare secure MCP / AWS IAM docs](https://developers.cloudflare.com/agents/guides/securing-mcp-server/) | ro | Для cloud-specific auth/network posture. |

_Особое ограничение доступа:_ secrets-auth-plane-mcp.

#### A14 — DocsAgent

- **Миссия:** Поддерживает docs как часть delivery, а не как послесловие.
- **Почему именно так:** эта роль у тебя отвечает за Update README/runbooks/ADR index, Generate diagrams/summaries, Prepare release notes.
- **Минимум must-have:** 4
- **Strongly desirable:** 3

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `knowledge-service-mcp` | rw | Обновление canonical docs packs и индексируемых материалов. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | PR summaries, runbooks, diagrams, release notes. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | scoped-rw | README/runbook/docs changes in repo. |
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | ro/scoped-rw | Ссылки, summaries и completion docs назад в issue/project. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/) | ro | Подтягивать design context в UI docs. |
| strongly desirable | tool | [Storybook](https://storybook.js.org/docs/writing-tests/visual-testing) | ro | Living docs for frontend components. |
| strongly desirable | tool | [Postman collections](https://learning.postman.com/docs/collections/running-collections/intro-to-collection-runs/) | ro | API docs and examples sync. |


### Release / ops / platform / enablement

#### A15 — ReleaseAgent

- **Миссия:** Ведёт merge/deploy/smoke/rollback orchestration и release communication.
- **Почему именно так:** эта роль у тебя отвечает за Check merge gate, Trigger merge/deploy flows, Run smoke tests.
- **Минимум must-have:** 9
- **Strongly desirable:** 2

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `release-policy-mcp` | ro+gate | Central release constraints and rollout policy. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | release notes, smoke reports, rollback notes. |
| must-have | internal-mcp | `observability-bridge-mcp` | ro | Gate by health/alerts/errors. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | scoped-rw | PR merge, checks, releases, workflows. |
| must-have | platform | [GitHub environments / protected branches / CODEOWNERS](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) | platform | Human review, required checks and protected deploy gates. |
| must-have | external-mcp | [Feature-flag MCP](https://launchdarkly.com/docs/home/getting-started/mcp) | scoped-rw | Progressive rollout, canary, rollback without redeploy. |
| must-have | external-mcp | [Playwright MCP](https://github.com/microsoft/playwright-mcp) | controlled-rw | Post-merge smoke and user-path validation. |
| must-have | tool | [Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/) | ci/local | API smoke suites in deploy/release flow. |
| must-have | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Canary/health validation and rollback signals. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Slack MCP](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server) | scoped-rw | Release comms and incident channel coordination. |
| strongly desirable | tool | [k6](https://grafana.com/docs/k6/latest/) | ci/local | Canary/performance acceptance where needed. |

_Особое ограничение доступа:_ release-policy-mcp.

#### A16 — MonitoringAgent

- **Миссия:** Следит за post-deploy health и помогает в incident triage.
- **Почему именно так:** эта роль у тебя отвечает за Observe SLO/SLI impact, Analyze logs/traces/metrics, Compare canary vs baseline.
- **Минимум must-have:** 4
- **Strongly desirable:** 4

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `observability-bridge-mcp` | ro | Единый observability API для агентов. |
| must-have | internal-mcp | `release-policy-mcp` | ro | Знает monitoring windows и SLO/error-budget rules. |
| must-have | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Главный рабочий контур MonitoringAgent. |
| must-have | platform | [OpenTelemetry](https://opentelemetry.io/docs/) | platform | Трассы/метрики/логи + propagation across systems. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Связывает incident signals с suspect deploy/commit. |
| strongly desirable | external-mcp | [Feature-flag MCP](https://launchdarkly.com/docs/home/getting-started/mcp) | ro/scoped-rw | Быстрый rollback or partial disable path. |
| strongly desirable | external-mcp | [Slack MCP](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server) | ro/scoped-rw | Incident coordination. |
| strongly desirable | tool | [Playwright / k6 synthetic checks](https://grafana.com/docs/k6/latest/) | ci/local | Дополнительный live-path verification слой. |

#### A17 — ProvisionerAgent

- **Миссия:** Поднимает новые repo/project scaffolds и golden paths.
- **Почему именно так:** эта роль у тебя отвечает за Create repo scaffolds, Bootstrap CI/CD and checks, Write initial AGENTS/CLAUDE guidance.
- **Минимум must-have:** 9
- **Strongly desirable:** 3

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `github-control-mcp` | scoped-rw | Создание repo, templates, branch protections, workflows. |
| must-have | internal-mcp | `linear-control-mcp` | scoped-rw | Project links, labels, templates, status plumbing. |
| must-have | internal-mcp | `repo-registry-mcp` | rw | Создание и синхронизация registry records. |
| must-have | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | scoped-rw | Repo/project bootstrap and repo metadata operations. |
| must-have | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | scoped-rw | Project/milestone/update scaffolding. |
| must-have | platform | [GitHub environments / branch protections / CODEOWNERS](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | platform | Golden-path governance by default. |
| must-have | platform | [Docker MCP Gateway](https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/) | platform | Нужен platform-команде для централизованного MCP layer. |
| must-have | platform | [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) | platform | Перед публикацией любого MCP в allowlist. |
| must-have | tool | [Renovate + CodeQL + Dependency graph/review](https://docs.renovatebot.com/) | platform | Supply-chain hygiene by default in every new repo. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [Terraform MCP](https://developer.hashicorp.com/terraform/mcp-server) | scoped-rw | Если bootstrap включает infra/workspaces. |
| strongly desirable | external-mcp | [Sentry / Datadog project bootstrap](https://docs.sentry.io/ai/mcp/) | scoped-rw | Новый репо должен сразу получать observability project wiring. |
| strongly desirable | platform | [Langfuse + OpenTelemetry bootstrap](https://langfuse.com/docs) | platform | Для agent-aware repos и workflows. |

#### A18 — DependencyAgent

- **Миссия:** Держит зависимости, flags и stale code в здоровом состоянии.
- **Почему именно так:** эта роль у тебя отвечает за Dependency refresh, Changelog impact analysis, Flag cleanup.
- **Минимум must-have:** 6
- **Strongly desirable:** 3

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `github-control-mcp` | scoped-rw | Maintenance PRs, labels, tracking issues. |
| must-have | tool | [Dependency graph](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependency-graph) | ro | Основа для impact analysis. |
| must-have | tool | [Dependency review](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/customizing-your-dependency-review-action-configuration) | ci | PR gate on risky/vulnerable changes. |
| must-have | tool | [Renovate](https://docs.renovatebot.com/) | bot-rw | Основной dependency refresh engine. |
| must-have | tool | [Dependabot security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-dependabot-security-updates) | bot-rw | Security-patch fast path. |
| must-have | tool | [CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/about-code-scanning-with-codeql) | ci | Security regression check after dependency updates. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | tool | [Semgrep](https://semgrep.dev/docs/introduction) | ci/local | Дополнительная проверка опасных dependency patterns. |
| strongly desirable | tool | [Trivy](https://trivy.dev/docs/latest/) | ci/local | SBOM/vuln/license scan after updates. |
| strongly desirable | external-mcp | [Sentry MCP / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Корреляция dependency update -> prod regressions. |

#### A19 — EvalsAgent

- **Миссия:** Измеряет качество агентов, skills и overall engineering system.
- **Почему именно так:** эта роль у тебя отвечает за Build eval sets, Benchmark skill versions, Interpret DORA/SPACE/PR metrics.
- **Минимум must-have:** 5
- **Strongly desirable:** 3

**Must-have**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| must-have | internal-mcp | `evals-dataset-mcp` | rw | Datasets, regressions, golden sets. |
| must-have | internal-mcp | `artifact-registry-mcp` | rw | Stores benchmark reports and eval outputs. |
| must-have | platform | [OpenTelemetry](https://opentelemetry.io/docs/) | platform | Trace substrate for agent/system measurement. |
| must-have | tool | [Langfuse](https://langfuse.com/docs) | platform | Observability + production-trace evals + datasets. |
| must-have | tool | [Promptfoo](https://www.promptfoo.dev/docs/intro/) | ci/local | Prompt/agent eval and red-team harness. |

**Strongly desirable**

| Приоритет | Вид | Инструмент / MCP | Доступ | Зачем |
|---|---|---|---|---|
| strongly desirable | external-mcp | [GitHub MCP Server](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server) | ro | Связка eval results с PRs/code changes. |
| strongly desirable | external-mcp | [Linear MCP](https://linear.app/docs/mcp) | ro | Связка eval results с delivery outcomes and rework. |
| strongly desirable | external-mcp | [Sentry / Datadog MCP](https://docs.sentry.io/ai/mcp/) | ro | Incident escape rate и post-release quality. |


## 5. Что я бы жёстко не делал

- Не давал бы BuildAgent-ам прямой доступ к raw secret stores, OAuth token bodies, vendor consoles и production-only credential actions.
- Не подключал бы всем агентам generic filesystem/git reference MCP как боевой стандарт. Для продовой платформы лучше свои wrappers и repo-scoped runners.
- Не делал бы два разных writer-пути в Linear и GitHub без единой policy-обёртки: иначе начнут расходиться state machine и external side effects.
- Не смешивал бы `IntegrationAgent` и `BuildAgent-Integrations`: первый должен владеть readiness/auth/webhook boundary, второй — кодом внутри уже безопасных рамок.

## 6. Приоритет внедрения по волнам

### Wave 1 — foundation
- `linear-control-mcp`
- `github-control-mcp`
- `temporal-workflow-mcp`
- `knowledge-service-mcp`
- `repo-registry-mcp`
- `artifact-registry-mcp`
- `comment-memory-mcp`
- `policy-guard-mcp`
- `Linear MCP`
- `GitHub MCP Server`
- `Docker MCP Gateway`
- `MCP Inspector`
- `OpenTelemetry`
- `Langfuse`
- `Promptfoo`
- `CodeQL`
- `Semgrep`
- `Trivy`
- `Renovate`
- `Dependabot security updates`
- `Dependency graph`
- `Dependency review`

### Wave 2 — delivery quality
- `Playwright MCP`
- `Google MCP Toolbox for Databases`
- `Postman Collection Runner / Postman CLI`
- `Schemathesis`
- `Storybook + Chromatic`
- `axe-core / Storybook a11y`
- `Lighthouse CI`
- `Sentry MCP Server or Datadog MCP Server`
- `Feature-flag MCP`

### Wave 3 — domain specializations
- `Figma MCP Server`
- `Terraform MCP Server`
- `OpenAPI MCP`
- `Hookdeck or ngrok`
- `Stripe MCP`
- `Stripe CLI`
- `AWS Documentation / Knowledge / API MCPs`
- `Cloudflare MCP servers`
- `Slack MCP`
- `k6`

## 7. Самые сильные точечные апгрейды по сравнению с текущим состоянием

- **Orchestrator / Reporter** перестают быть «немыми» ботами и получают реальный control-plane через Linear + Temporal + artifact/memory MCP.
- **IntegrationAgent** получает свой отдельный auth/webhook/readiness стек и больше не смешивается с простым coding-loop.
- **Frontend / Test / Review** получают связку Figma + Playwright + Storybook/Chromatic + axe + Lighthouse, а не просто «умеют фронтенд».
- **Security / Dependency / Provisioning** получают не абстрактные инструкции, а реальные supply-chain и policy инструменты: CodeQL, Semgrep, Trivy, Renovate, Dependabot, dependency review.
- **EvalsAgent** получает нормальный eval stack: Langfuse + Promptfoo + OTel + datasets, а не просто общие рассуждения о метриках.
- **Release / Monitoring** получают feature-flag control + observability MCP + smoke/perf tooling, что резко повышает качество rollout и post-deploy window.

## 8. Артефакты

- Ниже рядом сохраню также CSV-матрицу `agent -> tool/mcp -> priority -> access`, чтобы это можно было дальше автоматизировать в orchestration layer.
