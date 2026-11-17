# Changelog

All notable changes to `@nubiia/mcp-vidsigner` are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-17

### Initial public release

Unofficial, community-maintained MCP server and TypeScript client for the VIDsigner API. Not affiliated with, endorsed or sponsored by Validated ID.

- **81 MCP tools** over the two VIDsigner APIs: 35 for the signature API (VIDcloud 3.0: documents, signed documents, signatures and signers, batches, e-delivery, devices, search, XML sealing) and 46 for the management API (MGMT 1.0: partners, customers, subscriptions, enrollment codes, VIDmobile and VIDstamper users, certificates, statistics, T-Systems), with a tool description, a "Use when" hint and a description for every parameter.
- **Safety gates by risk.** Production starts read-only. Writes, destructive operations, downloads that mark a document as downloaded, signing links, credential reads and the management API each have their own flag, and a tool whose gate is closed is not registered.
- **Defences against prompt injection**: file reads limited to allow-listed folders, a private output folder, strict recipient format validation, optional allow-lists for email domains, phone prefixes, webhook hosts and asset hosts, URL checks in free-text fields, and no secrets or base64 content returned to the model.
- **Strict request schemas** generated from the API surface, the manual-only fields and the alternative spellings: unknown keys are rejected with a suggestion.
- **Typed client** (`@nubiia/mcp-vidsigner`): one method per operation, Basic/JWT authentication with caching and renewal, retries only for idempotent requests on 5xx and network errors, typed errors backed by the VIDsigner error catalog, and typed webhook payloads (`@nubiia/mcp-vidsigner/webhooks`).
- **Documentation** in English: README with a configuration matrix (environment x flags x visible tools), four example flows, known restrictions and limitations; per-tool reference in `docs/TOOLS.md`.
- **Generators** for the versioned artifacts (`gen:types`, `gen:schemas`, `gen:manual-fields`, `gen:errors`, `gen:docs`). They read the vendor documentation from `VIDSIGNER_SPEC_DIR`, which is not redistributed with the repository; the test suite and CI run on the versioned artifacts alone.
- **Tooling**: CI (lint, formatting, typecheck, build, tests on Node 20, 22 and 24, package contents check, audit), CodeQL, a tag-driven release workflow for npm and the MCP Registry, Docker image, Dependabot.

[0.1.0]: https://github.com/nubiia-dev/mcp-vidsigner/releases/tag/v0.1.0
