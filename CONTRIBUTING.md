# Contributing

## Setup

```bash
corepack enable
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
corepack pnpm infra:up
corepack pnpm db:migrate
```

Use placeholder or locally generated secrets only. Do not commit `.env.local`.

## Development Checks

Run the fastest relevant checks before opening a pull request:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

For broader changes, also run:

```bash
corepack pnpm build
corepack pnpm test:integration
corepack pnpm test:phase6
```

## Pull Request Expectations

Pull requests should include:

- a short summary;
- the reason for the change;
- relevant tests or checks run;
- documentation updates when behavior, configuration, security posture, or operations change.

Avoid unrelated formatting churn and speculative abstractions.

## Documentation

Runtime-critical contributor docs live in the repository. Architecture and long-lived design notes may also have a private Obsidian source, but public documentation must be sanitized before it is committed.

Do not include raw secrets, private workspace identifiers, private vault paths, live webhook URLs, or private provider-console screenshots in docs.
