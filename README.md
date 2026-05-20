# AI Dev Team

AI Dev Team is an experimental control plane for coordinating software delivery work across Linear, GitHub, Temporal, Postgres, local runner hosts, and agent-specific prompt/skill bundles.

The project models Linear as the human-facing operator surface, Temporal as workflow execution truth, GitHub as code and CI truth, Postgres as durable system state, and trusted runner hosts as the place where local Codex/Claude-style provider sessions execute work.

## Current Maturity

This repository is source-only and published for inspection, experimentation, and collaboration. The implementation includes the core control-plane packages, workflow configuration, runner-host protocol surfaces, prompt/skill library snapshots, fake-runner smoke paths, and documentation for local setup.

Production credential automation is intentionally not shipped as a turnkey feature. Secrets, OAuth tokens, webhook signing secrets, and provider credentials must remain outside the repository and behind a secret manager or broker boundary.

## Architecture At A Glance

- `apps/control-api`: Fastify service for internal inspection routes, webhook ingress, runner-host protocol routes, and knowledge/context reads.
- `apps/workflow-worker`: Temporal worker, inbox processing, outbox execution, and lifecycle orchestration.
- `apps/runner-host`: trusted local runner process for provider adapters, shared MCP lifecycle, worktrees, artifacts, and fake smoke execution.
- `packages/db`: Postgres schema, migrations, config publishing, runtime helpers, and validation CLIs.
- `packages/shared`: shared DTOs, enums, and cross-package contracts.
- `packages/config`: environment parsing and runtime configuration.
- `config/workflow`: file-backed workflow/status/routing truth.
- `config/agents`: versioned role charters, prompt families, skills, skill packs, provider overlays, and published snapshots.
- `mcp`: experimental MCP server prototypes for broker and policy boundaries.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system map.

For the Git-tracked public project documentation export, start with
[docs/project/README.md](docs/project/README.md). It includes the project
overview, functionality guide, roadmap/status notes, agent-system docs, and the
open-source release checklist.

## Quickstart

Prerequisites:

- Node.js 22 or newer
- Corepack with pnpm
- Docker for the local Postgres and Temporal stack

```bash
corepack enable
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm db:validate-workflow-config
corepack pnpm db:validate-agent-config
corepack pnpm db:validate-agent-standards
corepack pnpm typecheck
corepack pnpm test
```

For fake local runner testing:

```bash
corepack pnpm test:phase6
```

For development process entrypoints, see [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

## Project Documentation

The public project docs live in [docs/project](docs/project/). They are a
sanitized export of the private project knowledge base and are intended to be
committed with the public repository.

- [Project Overview](docs/project/PROJECT_OVERVIEW.md)
- [Functionality Guide](docs/project/FUNCTIONALITY.md)
- [Roadmap And Status](docs/project/ROADMAP_AND_STATUS.md)
- [Agent System](docs/project/AGENT_SYSTEM.md)
- [Open Source Release](docs/project/OPEN_SOURCE_RELEASE.md)

## Configuration And Secrets

Copy `.env.example` to `.env.local` and replace placeholders with local values. Never commit `.env`, `.env.local`, real webhook secrets, API tokens, OAuth credentials, runner bearer tokens, personal vault paths, or production URLs.

The system stores integration auth metadata in Postgres, but raw secret material must stay in a secret manager or broker. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) and [SECURITY.md](SECURITY.md).

## Verification

The main local checks are:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:integration
```

Integration tests require local infrastructure and `DATABASE_URL`. Start the stack with:

```bash
corepack pnpm infra:up
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project keeps package-level source code, runtime config, and docs reviewable as normal pull requests.

## License

MIT. See [LICENSE](LICENSE).
