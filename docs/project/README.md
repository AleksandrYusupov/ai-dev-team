# Project Documentation

This folder is the public, Git-tracked project documentation export for AI Dev Team.
It is a curated and sanitized companion to the private Obsidian project notes. It
keeps the public repository useful without publishing private vault paths, live
workspace identifiers, vendor account details, webhook URLs, or credentials.

## Start Here

- [Project Overview](PROJECT_OVERVIEW.md) describes the product goal, system
  boundaries, and main source-of-truth model.
- [Functionality Guide](FUNCTIONALITY.md) explains the main workflows and runtime
  surfaces by feature area.
- [Roadmap And Status](ROADMAP_AND_STATUS.md) summarizes the implementation
  phases and current maturity.
- [Agent System](AGENT_SYSTEM.md) documents roles, prompt/skill bundles, layered
  instructions, provider overlays, and runner-host responsibilities.
- [Open Source Release](OPEN_SOURCE_RELEASE.md) records the public release
  readiness model and pre-push security checklist.

## Related Repository Docs

- [Architecture](../ARCHITECTURE.md)
- [Configuration](../CONFIGURATION.md)
- [Local Development](../LOCAL_DEVELOPMENT.md)
- [Security](../../SECURITY.md)
- [Contributing](../../CONTRIBUTING.md)

## Export Policy

- Public docs may describe architecture, setup, local development, and extension
  points.
- Public docs must not include real secrets, webhook URLs, OAuth credentials,
  private Linear workspace identifiers, private Obsidian vault contents, local
  user paths, or production operational metadata.
- When private Obsidian notes change, update this folder with the smallest
  sanitized public summary that helps contributors understand the project.
