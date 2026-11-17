# Contributing to MCP VIDsigner

Thank you for your interest in contributing to MCP VIDsigner!

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Run tests: `npm test`

The test suite runs against a mocked `fetch` (see `tests/helpers/mock-fetch.ts`): no VIDsigner account, credentials, network access or vendor documentation is required to develop or test this project.

## Vendor documentation (optional)

The VIDsigner OpenAPI document and REST manual belong to Validated ID and are **not** part of this repository, and they must never be committed (neither the originals nor copies, excerpts or translations). If you are a Validated ID customer and want to run the extra checks or regenerate the generated files, put `VIDsignerOpenAPI_Lastest.json` and `VIDsignerAPI_Rest_Lastest.txt` in a directory outside the repository and point `VIDSIGNER_SPEC_DIR` at it:

```bash
export VIDSIGNER_SPEC_DIR=~/vidsigner-docs
npm test                    # also runs the tests that compare the artifacts against the vendor documents
npm run gen:types           # src/client/generated/vidsigner-api.ts
npm run gen:schemas         # data/openapi-surface.json and the generated zod schemas / client types
npm run gen:manual-fields   # tests/fixtures/rest-manual-fields.ts
npm run gen:errors          # src/client/errors/catalog.generated.ts
```

Without `VIDSIGNER_SPEC_DIR` those tests are skipped with a warning and the generators exit with an explanatory message. If you only edited `data/field-docs.json`, `data/manual-extras.json` or `src/tools/aliases.ts`, regenerate the schemas without the vendor documents: `npm run gen:schemas -- --from-surface`.

Descriptions in `data/field-docs.json` and the tool descriptions must be written in your own words, not copied from the vendor manual.

## Code Style

This project uses ESLint and Prettier for code formatting. Before committing:

```bash
npm run lint        # Check for linting errors
npm run lint:fix    # Fix linting errors
npm run format      # Format code with Prettier
```

Pre-commit hooks will automatically run linting on staged files.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Releases are automated from them, so the commit type decides whether a release happens and how the version changes.

Format: `<type>(<scope>): <description>`

| Type                                                        | Effect on the next release                       |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `feat`                                                      | minor version bump (0.1.0 -> 0.2.0)              |
| `fix`, `perf`                                               | patch version bump (0.1.0 -> 0.1.1)              |
| `feat!`, `fix!`, or a `BREAKING CHANGE:` footer             | major version bump (0.x -> 1.0.0)                |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | no release (they do not appear in the changelog) |

Examples:

```
feat(tools): add bulk expire for documents
fix(client): normalise the empty-list 404 of GET /signeddocuments
docs: clarify the production read-only gates
feat(client)!: rename the retry option

BREAKING CHANGE: `maxRetries` is now `retries`.
```

Write the description in the imperative, lower case and without a trailing period. The subject and body of `feat` and `fix` commits end up in `CHANGELOG.md` and in the GitHub release notes, so write them for the people who read the changelog.

## Pull Request Process

1. Create a feature branch from `development` (`main` only receives merges from `development`)
2. Make your changes
3. Ensure `npm run lint && npm run typecheck && npm run build && npm test` pass
4. If you add or change a tool, update its `docSummary`, `notes` and `example`, then run `npm run gen:docs`
5. Commit using conventional commits
6. Push and create a pull request against `development`

## Releasing (maintainers)

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io/). Never bump versions, edit `CHANGELOG.md` or push `v*` tags by hand: `version` in `package.json` and `server.json` is `0.0.0` in the repository until the release commit rewrites it.

Flow:

1. Work lands in `development` through pull requests (merge commits; do not squash, because the individual conventional commits are what is analysed).
2. To release, open a pull request from `development` to `main` and merge it with a **merge commit**.
3. The `Release` workflow (`.github/workflows/release.yml`) runs on the push to `main`:
   - lint, typecheck, build, tests, package contents check and `npm audit` on production dependencies;
   - semantic-release analyses the commits since the last `v*` tag. If none is a `feat`, `fix`, `perf` or breaking change, nothing is published;
   - otherwise it computes the version, writes `CHANGELOG.md`, `package.json`, `package-lock.json` and `server.json`, publishes `@nubiia/mcp-vidsigner` to npm with provenance, commits the files as `chore(release): X.Y.Z [skip ci]`, tags `vX.Y.Z` and creates the GitHub release;
   - when a version was published, it waits for it to appear on npm and publishes `server.json` to the MCP Registry (GitHub OIDC, no secret).
4. `publish-mcp.yml` is a manual fallback (`workflow_dispatch`) to republish to the MCP Registry if that last step failed.

The first release is computed from the baseline tag `v0.0.0`, which marks the initial commit: it makes the first `feat` release `0.1.0` instead of the semantic-release default of `1.0.0`. Do not delete or move that tag.

Repository settings the workflow depends on: the `NPM_TOKEN` secret (only until npm Trusted Publishing is configured, see the comment in `release.yml`), `main` allowing the `GITHUB_TOKEN` to push the release commit and tags, and Actions with read and write permissions.
