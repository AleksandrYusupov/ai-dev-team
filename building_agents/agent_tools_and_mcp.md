# AI-отдел разработки: карта инструментов, тулов и MCP по ролям агентов

> Этот документ дополняет `ai_dept_agents_and_skills_report_v2.md`. Скиллы (промпты/инструкции) уже описаны — здесь собраны **реальные исполняемые инструменты**: MCP-серверы, CLI-утилиты, GitHub Actions, API-интеграции и библиотеки, которые каждый агент должен иметь в своём toolbelt.

**Легенда приоритетов:**
- 🔴 **MUST** — без этого агент не может выполнять свою основную миссию
- 🟡 **STRONG** — значительно повышает качество/скорость, настоятельно рекомендуется
- 🟢 **NICE** — полезно, но можно добавить позже

---

## Общая инфраструктура (shared toolplane)

Прежде чем описывать каждого агента, зафиксируем общие MCP и тулы, доступные всем или большинству агентов через orchestration layer.

### Shared MCP серверы

| MCP | Назначение | Приоритет | Пакет / URL |
|-----|-----------|-----------|-------------|
| **Linear (official remote)** | Issues, comments, statuses, labels, projects, milestones | 🔴 MUST | `https://mcp.linear.app/mcp` (OAuth) |
| **GitHub (official)** | Repos, PRs, issues, commits, diffs, code search, CODEOWNERS | 🔴 MUST | `@modelcontextprotocol/server-github` |
| **Obsidian** | ADR, runbooks, architecture notes, knowledge base | 🔴 MUST | `@bitbonsai/mcpvault` или `obsidian-mcp-server` (cyanheads) |
| **PostgreSQL / Supabase** | Secrets/Auth plane metadata, registry, workflow state | 🔴 MUST | `@crystaldba/postgres-mcp` или `supabase-mcp-server` |
| **Filesystem** | Чтение/запись файлов в рабочих директориях runner'а | 🔴 MUST | `@modelcontextprotocol/server-filesystem` |
| **Git** | Read, search, blame, log, diff на уровне repo | 🔴 MUST | `@modelcontextprotocol/server-git` |
| **Memory** | Knowledge graph для persistent context между сессиями | 🟡 STRONG | `@modelcontextprotocol/server-memory` |
| **Fetch** | HTTP-запросы к vendor docs, API specs, external resources | 🟡 STRONG | `@modelcontextprotocol/server-fetch` |
| **Sequential Thinking** | Structured reasoning для complex decisions | 🟢 NICE | `@modelcontextprotocol/server-sequential-thinking` |
| **Context7** | Up-to-date docs для любых библиотек/фреймворков | 🟡 STRONG | `https://mcp.context7.com/mcp` |

### Shared CLI тулы (доступны всем build/test агентам)

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `git` | Version control operations | 🔴 MUST |
| `gh` (GitHub CLI) | PR creation, review, status checks, releases | 🔴 MUST |
| `pnpm` / `npm` | Package management, script execution | 🔴 MUST |
| `jq` / `yq` | JSON/YAML parsing в пайплайнах | 🟡 STRONG |

---

## A00 — OrchestratorAgent

**Миссия:** управляет state machine issue, запускает агентов, следит за gates.

### MCP серверы

| MCP | Зачем именно этому агенту | Приоритет |
|-----|--------------------------|-----------|
| **Linear** | Основной рабочий инструмент: читает/пишет issues, меняет статусы, публикует comments, управляет labels | 🔴 MUST |
| **GitHub** | Отслеживает PR status, CI checks, merge readiness, deployment events | 🔴 MUST |
| **Obsidian** | Читает operating model, workflow policies, runbooks для принятия routing decisions | 🔴 MUST |
| **PostgreSQL** | Запрос workflow state, registry data, integration prerequisites status | 🔴 MUST |
| **Memory** | Persistent memory о текущих workflow, decisions, in-flight tasks | 🟡 STRONG |
| **Slack** (если используется) | Отправка escalation/status notifications команде | 🟢 NICE |

### CLI / API тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `gh` CLI | Быстрая проверка PR/CI status без full GitHub MCP | 🟡 STRONG |
| **Temporal CLI** (`tctl` / `temporal`) | Управление workflow executions, signals, queries | 🔴 MUST |
| Custom orchestration API client | Запуск/остановка agent tasks, status transitions | 🔴 MUST |

---

## A01 — IntakeAgent

**Миссия:** нормализует вход, типизирует, ищет дубликаты, определяет маршрут.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Linear** | Чтение новых issues, comment threads, labels, projects; поиск дубликатов по existing issues | 🔴 MUST |
| **GitHub** | Проверка, есть ли связанные PR, open issues в repos | 🟡 STRONG |
| **Obsidian** | Поиск related ADR/docs для routing decisions | 🟡 STRONG |
| **PostgreSQL** | Запрос registry для repo/project mapping | 🔴 MUST |
| **Context7** | Быстрая проверка, существуют ли упомянутые библиотеки/API | 🟢 NICE |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| Embeddings API (OpenAI / Anthropic) | Semantic similarity для duplicate detection | 🟡 STRONG |
| Custom vector store client | Поиск по issue corpus для near-duplicates | 🟡 STRONG |

---

## A02 — ContextAgent

**Миссия:** собирает authoritative context pack для других агентов.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Obsidian** | Главный source: ADR, SPEC, PLAN, runbooks, architecture docs | 🔴 MUST |
| **GitHub** | Чтение AGENTS.md, CLAUDE.md, README, recent PR diffs, CODEOWNERS | 🔴 MUST |
| **Git** | Blame, log, search по repo для targeted context | 🔴 MUST |
| **Linear** | Comment history, decisions, linked issues | 🔴 MUST |
| **PostgreSQL** | Registry, sanitized integration artifacts, context-pack metadata | 🔴 MUST |
| **Memory** | Cached context packs, cross-session knowledge | 🟡 STRONG |
| **Fetch** | Загрузка external docs (vendor API references) по allowlist | 🟡 STRONG |
| **Context7** | Up-to-date документация по используемым библиотекам | 🟡 STRONG |

---

## A03 — SpecAgent

**Миссия:** превращает brief в исполнимый контракт задачи.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Linear** | Чтение brief/comments, запись spec draft как comment | 🔴 MUST |
| **Obsidian** | Чтение existing specs/ADR как reference, запись SPEC.md | 🔴 MUST |
| **GitHub** | Чтение repo structure, existing tests, API contracts | 🟡 STRONG |
| **Fetch** | Загрузка vendor API docs для integration specs | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **spec-kit** (`github/spec-kit`) | Spec-driven development toolkit | 🟡 STRONG |

---

## A04 — ArchitectAgent

**Миссия:** архитектурные решения, ADR, option matrix.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Obsidian** | Чтение/запись ADR, architecture notes | 🔴 MUST |
| **GitHub** | Cross-repo analysis: читает code structure, dependency graphs, CI configs | 🔴 MUST |
| **Git** | Глубокий анализ: blame, history, branch topology | 🟡 STRONG |
| **PostgreSQL** | Registry: service dependencies, environments, required checks | 🔴 MUST |
| **Sequential Thinking** | Structured reasoning для complex architectural trade-offs | 🟡 STRONG |
| **Fetch** | Чтение external architecture references, RFC docs | 🟡 STRONG |
| **Context7** | Reference docs по фреймворкам для корректных architecture decisions | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **madge** (`npm`) | Dependency graph visualization для JS/TS projects | 🟡 STRONG |
| **ts-morph** / **jscodeshift** | AST analysis для cross-repo impact assessment | 🟢 NICE |
| **Mermaid CLI** (`mmdc`) | Генерация architecture diagrams из ADR | 🟢 NICE |

---

## A05 — PlanAgent

**Миссия:** декомпозиция, sub-issues, execution plan.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Linear** | Создание sub-issues, milestones, linking, dependency ordering | 🔴 MUST |
| **GitHub** | Понимание repo boundaries для decomposition | 🟡 STRONG |
| **Obsidian** | Чтение SPEC/ADR, запись PLAN.md | 🔴 MUST |
| **PostgreSQL** | Registry для mapping repos, services, environments | 🟡 STRONG |

---

## A21 — IntegrationAgent

**Миссия:** integration lifecycle — readiness, auth model, onboarding, go-live boundary.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Linear** | Управление integration-specific issue fields, Needs Input handshakes | 🔴 MUST |
| **PostgreSQL** | Secrets/Auth plane metadata: credential slots, OAuth registrations, consent state, webhook registrations, validation runs | 🔴 MUST |
| **GitHub** | Чтение existing adapter code, integration patterns в repos | 🟡 STRONG |
| **Obsidian** | Integration runbooks, auth decision records, webhook contracts | 🔴 MUST |
| **Fetch** | Загрузка vendor API docs, OAuth discovery endpoints, webhook specs | 🔴 MUST |
| **Context7** | Документация по OAuth libraries, SDK reference | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **curl** / **httpie** | Sandbox API probing, health checks, OAuth discovery | 🔴 MUST |
| **jwt-cli** (`npm jwt-cli`) | JWT decode/inspect для OAuth token analysis (без raw secrets) | 🟡 STRONG |
| **openapi-generator** CLI | Валидация OpenAPI specs, client stub generation | 🟡 STRONG |
| **webhook.site** API / **smee.io** | Webhook testing в sandbox mode | 🟢 NICE |

---

## A06 — BuildAgent-Backend

**Миссия:** backend code changes — API, services, business logic.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | PR creation, code push, branch management, CI status | 🔴 MUST |
| **Git** | Commit, diff, blame, branch ops | 🔴 MUST |
| **Filesystem** | Чтение/запись кода, конфигов | 🔴 MUST |
| **PostgreSQL** | Запросы к dev DB для schema inspection, data validation | 🟡 STRONG |
| **Context7** | Документация по используемым framework/libraries | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `pnpm` / `npm` / `yarn` | Build, test, lint execution | 🔴 MUST |
| `tsc` (TypeScript compiler) | Type checking | 🔴 MUST |
| **ESLint** / **Biome** | Linting, formatting | 🔴 MUST |
| **Vitest** / **Jest** | Test runner | 🔴 MUST |
| `gh` CLI | PR creation, review request | 🔴 MUST |
| **prisma** CLI / **drizzle-kit** | Schema management если используется ORM | 🟡 STRONG |
| **tsx** / **ts-node** | Быстрое выполнение TypeScript скриптов | 🟡 STRONG |
| **Docker CLI** | Container build/test если applicable | 🟢 NICE |

---

## A07 — BuildAgent-Frontend

**Миссия:** UI/UX code — components, pages, design system adherence.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | PR creation, code, CI status | 🔴 MUST |
| **Git** | Commits, branching | 🔴 MUST |
| **Filesystem** | Code read/write | 🔴 MUST |
| **Figma** (official MCP) | Чтение design tokens, component specs, design context | 🟡 STRONG |
| **Context7** | React/Next.js/Tailwind docs | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `pnpm` / `npm` | Build, dev server, test | 🔴 MUST |
| `tsc` | Type checking | 🔴 MUST |
| **ESLint** / **Biome** | Linting | 🔴 MUST |
| **Vitest** / **Jest** + **Testing Library** | Component testing | 🔴 MUST |
| **Playwright** | E2E tests, visual screenshots | 🟡 STRONG |
| **Storybook CLI** | Component isolation, visual testing | 🟡 STRONG |
| **axe-core CLI** / **pa11y** | Accessibility auditing | 🟡 STRONG |
| **Lighthouse CI** | Performance, a11y, best practices audit | 🟢 NICE |

---

## A08 — BuildAgent-Integrations

**Миссия:** adapter/client/webhook code в рамках IntegrationAgent boundaries.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | PR, code, CI | 🔴 MUST |
| **Git** | Commits, branching | 🔴 MUST |
| **Filesystem** | Code read/write | 🔴 MUST |
| **PostgreSQL** | Чтение sanitized integration artifacts (НЕ raw secrets) | 🔴 MUST |
| **Fetch** | Vendor API docs, sandbox probing (по allowlist) | 🟡 STRONG |
| **Context7** | SDK docs для third-party libraries | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| Всё из BuildAgent-Backend плюс: | | |
| **openapi-generator** CLI | Генерация typed clients из OpenAPI specs | 🟡 STRONG |
| **Postman CLI** (`newman`) | Contract test execution | 🟡 STRONG |
| **curl** / **httpie** | Sandbox API testing | 🟡 STRONG |
| **msw** (Mock Service Worker) | Mock server для integration tests | 🟡 STRONG |
| **nock** / **undici.MockPool** | HTTP mocking в unit tests | 🟡 STRONG |

---

## A09 — BuildAgent-DataMigration

**Миссия:** safe schema/data changes, migrations.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | Code, PR | 🔴 MUST |
| **Git** | Commits | 🔴 MUST |
| **PostgreSQL** | Schema inspection, query plan analysis, data verification | 🔴 MUST |
| **Filesystem** | Migration file creation | 🔴 MUST |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **prisma migrate** / **drizzle-kit** / **supabase db** | Migration generation, application | 🔴 MUST |
| `psql` | Direct SQL execution, EXPLAIN ANALYZE | 🔴 MUST |
| **pg_dump** / **pg_restore** | Backup before migration | 🟡 STRONG |
| **pgcli** | Interactive SQL с autocomplete | 🟢 NICE |

---

## A10 — BuildAgent-InfraIaC

**Миссия:** infrastructure-as-code, CI/CD, environment configs.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | Code, PR, GitHub Actions workflows | 🔴 MUST |
| **Git** | Commits | 🔴 MUST |
| **Filesystem** | IaC files, configs | 🔴 MUST |
| **Terraform** (official MCP) | Registry queries, workspace state, run management | 🟡 STRONG |
| **Cloudflare** MCP (если используется) | Workers, KV, R2, D1 management | 🟢 NICE |
| **Supabase** MCP | DB, auth, edge functions, project management | 🟡 STRONG |
| **Vercel** MCP (если используется) | Deployments, projects, domains | 🟢 NICE |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **Terraform** CLI / **OpenTofu** | IaC plan/apply | 🔴 MUST (если используется) |
| `gh` CLI | GitHub Actions workflow dispatch, secrets management | 🔴 MUST |
| **Docker** CLI | Container builds, compose | 🟡 STRONG |
| **supabase** CLI | Local dev, migrations, edge functions | 🟡 STRONG |
| **vercel** CLI | Deployments, env management | 🟢 NICE |
| **act** (nektos/act) | Локальный запуск GitHub Actions | 🟢 NICE |

---

## A11 — TestAgent

**Миссия:** стратегия тестирования, написание и выполнение тестов, coverage gaps.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | Чтение diff для targeted test generation, CI results | 🔴 MUST |
| **Git** | Diff analysis для affected-path testing | 🔴 MUST |
| **Filesystem** | Чтение/запись тестов | 🔴 MUST |
| **PostgreSQL** | Test data setup/validation | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **Vitest** / **Jest** | Unit + integration test runner | 🔴 MUST |
| **Playwright** | E2E browser testing | 🔴 MUST |
| **c8** / **istanbul** / **v8 coverage** | Code coverage analysis | 🔴 MUST |
| **msw** | API mocking для integration tests | 🟡 STRONG |
| **Testing Library** | DOM testing utilities | 🟡 STRONG |
| **supertest** | HTTP API testing | 🟡 STRONG |
| **Stryker** | Mutation testing для оценки test quality | 🟢 NICE |
| **fast-check** | Property-based testing | 🟢 NICE |

---

## A12 — ReviewAgent

**Миссия:** независимый semantic review до human review.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | Чтение PR diff, файлов, comments; написание review comments | 🔴 MUST |
| **Git** | Blame, history для understanding context of changes | 🔴 MUST |
| **Linear** | Чтение spec/contract для acceptance matching | 🔴 MUST |
| **Obsidian** | ADR/architecture reference для review decisions | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `gh` CLI | PR review submission, status checks | 🔴 MUST |
| **ESLint** / **Biome** | Automated lint verification | 🟡 STRONG |
| `tsc --noEmit` | Type safety verification | 🟡 STRONG |
| **knip** | Dead code / unused exports detection | 🟡 STRONG |
| **depcheck** | Unused dependency detection | 🟢 NICE |

---

## A13 — SecurityAgent

**Миссия:** secure-by-design и secure-by-implementation review.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | Чтение code, deps, CI security scan results, Dependabot alerts | 🔴 MUST |
| **Git** | History analysis для secrets в commits | 🟡 STRONG |
| **Snyk** MCP | Vulnerability scanning: SCA, SAST, container, IaC scanning | 🔴 MUST |
| **Sentry** MCP | Error tracking, security-relevant exceptions | 🟡 STRONG |
| **PostgreSQL** | Auth plane metadata verification | 🟡 STRONG |
| **Obsidian** | Threat models, security policies, compliance docs | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **Snyk CLI** (`snyk test`, `snyk code test`) | SAST + SCA scanning | 🔴 MUST |
| **npm audit** / **pnpm audit** | Dependency vulnerability scan | 🔴 MUST |
| **Trivy** | Container/filesystem vulnerability scanner | 🟡 STRONG |
| **gitleaks** | Secrets detection в git history | 🔴 MUST |
| **semgrep** | Custom SAST rules, OWASP patterns | 🟡 STRONG |
| **trufflehog** | Deep secrets scanning | 🟡 STRONG |
| **socket** CLI (Socket.dev) | Supply chain risk для npm packages | 🟡 STRONG |
| **osv-scanner** (Google) | OSV vulnerability database lookup | 🟢 NICE |
| **bearer** CLI | Data flow / privacy scanning | 🟢 NICE |

### GitHub Actions (security в CI)

| Action | Назначение | Приоритет |
|--------|-----------|-----------|
| `github/codeql-action` | GitHub native SAST | 🟡 STRONG |
| `snyk/actions` | Snyk в CI pipeline | 🔴 MUST |
| `aquasecurity/trivy-action` | Container scanning в CI | 🟡 STRONG |
| `gitleaks/gitleaks-action` | Pre-commit secrets scan | 🔴 MUST |
| `step-security/harden-runner` | GitHub Actions runtime security | 🟡 STRONG |

---

## A14 — DocsAgent

**Миссия:** documentation as part of delivery.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Obsidian** | Главный target: запись/обновление ADR, runbooks, architecture docs | 🔴 MUST |
| **GitHub** | Обновление README, inline docs, PR descriptions | 🔴 MUST |
| **Git** | Diff analysis для определения, что документировать | 🔴 MUST |
| **Linear** | Чтение spec/contract для release notes | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **Mermaid CLI** (`mmdc`) | Генерация diagrams для docs | 🟡 STRONG |
| **typedoc** / **tsdoc** | API documentation generation | 🟡 STRONG |
| **markdownlint** CLI | Markdown quality checking | 🟡 STRONG |
| **vale** | Prose style/grammar linting для docs | 🟢 NICE |

---

## A15 — ReleaseAgent

**Миссия:** merge/deploy/smoke/rollback orchestration.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | Merge execution, branch protection status, release creation, deploy triggers | 🔴 MUST |
| **Linear** | Status transitions, release notes linking | 🔴 MUST |
| **Sentry** MCP | Post-deploy error monitoring, release tracking | 🟡 STRONG |
| **Vercel** MCP (если используется) | Deployment status, rollback triggers | 🟡 STRONG |
| **Supabase** MCP | Edge function deployments, migration status | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `gh` CLI | Release creation, merge, deployment dispatch | 🔴 MUST |
| **changesets** (`@changesets/cli`) | Versioning и changelog generation | 🟡 STRONG |
| **semantic-release** | Automated versioning based on commits | 🟡 STRONG |
| **curl** / **httpie** | Smoke test execution (health endpoints) | 🔴 MUST |
| **Playwright** | Post-deploy smoke testing UI | 🟡 STRONG |

---

## A16 — MonitoringAgent

**Миссия:** post-deploy health, incident triage, SLO/SLI.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Sentry** MCP (official) | Error tracking, issue details, release health, performance | 🔴 MUST |
| **Grafana** MCP (official) | Dashboards, metrics, alerts, datasource queries | 🔴 MUST |
| **Datadog** MCP (если используется вместо Grafana) | Metrics, logs, SLOs, monitors, CI pipelines | 🔴 MUST |
| **Linear** | Создание bug issues, reopen/rework recommendations | 🔴 MUST |
| **GitHub** | Корреляция deploy commits ↔ incidents | 🟡 STRONG |
| **PostgreSQL** | Запрос deployment events, integration health state | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **sentry-cli** | Release management, sourcemap upload, issue queries | 🟡 STRONG |
| **curl** / **httpie** | Health check probing | 🔴 MUST |
| **Grafana API** (через Fetch MCP) | Query alerts, dashboards programmatically | 🟡 STRONG |
| `psql` | Query application logs/metrics tables | 🟡 STRONG |

---

## A17 — ProvisionerAgent

**Миссия:** новые repo/project scaffolds, golden paths.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | Repo creation, branch protection setup, template instantiation | 🔴 MUST |
| **Linear** | Project/team creation, label setup | 🔴 MUST |
| **Obsidian** | Creating initial docs structure | 🟡 STRONG |
| **PostgreSQL** | Registry updates | 🔴 MUST |
| **Supabase** MCP | Project scaffolding, DB setup, edge functions | 🟡 STRONG |
| **Vercel** MCP | Project creation, domain setup | 🟢 NICE |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `gh` CLI | Repo creation, settings, secrets, branch protection | 🔴 MUST |
| **degit** / **giget** | Template repo cloning | 🟡 STRONG |
| **supabase** CLI | Project init, DB setup | 🟡 STRONG |
| `pnpm init` / **create-turbo** | Monorepo scaffolding | 🟡 STRONG |

---

## A18 — DependencyAgent

**Миссия:** зависимости, flags, stale code.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | Dependabot alerts, PR creation для updates, security advisories | 🔴 MUST |
| **Git** | Анализ dependency changes across branches | 🟡 STRONG |
| **Snyk** MCP | Vulnerability scanning, fix PRs | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `pnpm update` / `npm update` | Dependency refresh | 🔴 MUST |
| **npm audit** / **pnpm audit** | Vulnerability detection | 🔴 MUST |
| **Snyk CLI** | Deep SCA scanning | 🟡 STRONG |
| **npm-check-updates** (`ncu`) | Обнаружение available updates | 🔴 MUST |
| **depcheck** | Unused dependency detection | 🟡 STRONG |
| **knip** | Dead code, unused exports, stale configs | 🟡 STRONG |
| **socket** CLI | Supply chain risk assessment | 🟡 STRONG |
| **license-checker** | License compliance verification | 🟢 NICE |

---

## A19 — EvalsAgent

**Миссия:** качество агентов, skills, engineering system.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **GitHub** | PR outcome metrics, review comments, merge rates | 🔴 MUST |
| **Linear** | Cycle time, stuck issues, rework rate, completion rates | 🔴 MUST |
| **PostgreSQL** | Agent execution logs, quality scores, eval results | 🔴 MUST |
| **Sentry** MCP | Escaped bug rate, error trends post-deploy | 🟡 STRONG |
| **Grafana** / **Datadog** MCP | DORA metrics, system health trends | 🟡 STRONG |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| **Anthropic Evals SDK** | Eval set creation и benchmarking | 🔴 MUST |
| `gh` CLI | Querying PR metrics | 🟡 STRONG |
| **Vitest** | Running eval test suites | 🟡 STRONG |
| Custom eval runner | Gold task execution и scoring | 🔴 MUST |
| `psql` | Querying metrics tables | 🟡 STRONG |

---

## A20 — ReporterAgent

**Миссия:** human-readable комментарии, status digests, stakeholder communication.

### MCP серверы

| MCP | Зачем | Приоритет |
|-----|-------|-----------|
| **Linear** | Публикация comments, structured asks, status updates | 🔴 MUST |
| **GitHub** | PR description writing, review summary | 🟡 STRONG |
| **Slack** (если используется) | Team notifications, digest posts | 🟢 NICE |
| **Notion** (если используется) | Stakeholder reports | 🟢 NICE |

### CLI / тулы

| Тул | Назначение | Приоритет |
|-----|-----------|-----------|
| `gh` CLI | PR comment writing | 🟡 STRONG |

---

## Сводная матрица: MCP × Agent

> Таблица показывает, какие MCP используются каждым агентом. **R** = read, **W** = write, **RW** = read+write.

| MCP / Agent | A00 Orch | A01 Intake | A02 Ctx | A03 Spec | A04 Arch | A05 Plan | A21 Int | A06-10 Build* | A11 Test | A12 Review | A13 Sec | A14 Docs | A15 Rel | A16 Mon | A17 Prov | A18 Dep | A19 Evals | A20 Rep |
|-------------|----------|------------|---------|----------|----------|----------|---------|---------------|----------|------------|---------|----------|---------|---------|----------|---------|-----------|---------|
| Linear | RW | R | R | RW | R | RW | RW | R | R | R | R | R | RW | RW | RW | — | R | RW |
| GitHub | R | R | R | R | R | R | R | RW | RW | RW | R | RW | RW | R | RW | RW | R | R |
| Git | — | — | R | — | R | — | — | RW | R | R | R | R | — | — | — | R | — | — |
| Obsidian | R | R | RW | RW | RW | RW | RW | R | — | R | R | RW | — | — | RW | — | — | — |
| PostgreSQL | RW | R | R | — | R | R | RW | R | R | — | R | — | — | R | RW | — | RW | — |
| Sentry | — | — | — | — | — | — | — | — | — | — | R | — | R | RW | — | — | R | — |
| Grafana/DD | — | — | — | — | — | — | — | — | — | — | — | — | — | RW | — | — | R | — |
| Snyk | — | — | — | — | — | — | — | — | — | — | RW | — | — | — | — | R | — | — |
| Terraform | — | — | — | — | — | — | — | R (IaC) | — | — | — | — | — | — | R | — | — | — |
| Fetch | — | — | R | R | R | — | R | R | — | — | — | — | — | — | — | — | — | — |
| Context7 | — | R | R | — | R | — | R | R | — | — | — | — | — | — | — | — | — | — |
| Memory | R | — | R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

*Build = все BuildAgent профили (Backend, Frontend, Integrations, DataMigration, InfraIaC) — конкретный набор зависит от профиля.

---

## Рекомендуемый порядок внедрения

### Phase 1 — Core foundation (Wave 1 agents)

1. **Linear MCP** (official remote) — подключить первым, это central nervous system
2. **GitHub MCP** — второй must-have, covers code + CI + PR
3. **Git MCP** — дополняет GitHub более глубоким repo access
4. **PostgreSQL MCP** — registry + auth plane + workflow state
5. **Obsidian MCP** — knowledge base access
6. **Filesystem MCP** — базовые file operations
7. CLI тулы: `gh`, `pnpm`, `tsc`, `eslint`, `vitest`, `git`

### Phase 2 — Quality & Security (Wave 2 agents)

8. **Snyk MCP** + Snyk CLI — security scanning
9. **Sentry MCP** — error tracking / post-deploy monitoring
10. **Grafana MCP** или **Datadog MCP** — observability
11. **Context7** — library docs
12. **Fetch MCP** — external resources
13. CLI тулы: `gitleaks`, `semgrep`, `playwright`, `changesets`

### Phase 3 — Platform & Enablement (Wave 3 agents)

14. **Terraform MCP** — IaC management
15. **Supabase MCP** — если Supabase как primary platform
16. **Vercel MCP** — если Vercel как deployment target
17. **Figma MCP** — design-to-code workflows
18. **Sequential Thinking** + **Memory** MCP — advanced reasoning
19. CLI тулы: `knip`, `socket`, `stryker`, `newman`

---

## Рекомендации по безопасности инструментов

1. **Каждый MCP сервер должен быть scoped**: read-only где возможно, write только для specific tools
2. **GitHub tokens**: используй fine-grained PAT с minimum required permissions per agent
3. **Linear API keys**: один key для orchestrator, read-only keys для passive agents
4. **PostgreSQL**: separate read-only и read-write connection strings per agent role
5. **Snyk/Sentry/Grafana**: API keys с read-only scope где достаточно
6. **Fetch MCP**: allowlist доменов per agent — IntegrationAgent видит vendor docs, BuildAgent нет
7. **Filesystem MCP**: jail каждый agent в свою working directory
8. **Secrets**: ни один MCP не должен возвращать raw secret values — только metadata/aliases
