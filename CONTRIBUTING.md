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

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

Format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:

```
feat(tools): add bulk expire for documents
fix(client): normalise the empty-list 404 of GET /signeddocuments
docs: clarify the production read-only gates
```

## Pull Request Process

1. Create a feature branch from `development`
2. Make your changes
3. Ensure `npm run lint && npm run typecheck && npm run build && npm test` pass
4. If you add or change a tool, update its `docSummary`, `notes` and `example`, then run `npm run gen:docs`
5. Commit using conventional commits
6. Push and create a pull request against `development`

## Releasing (maintainers)

1. Bump `version` in `package.json` and in both places of `server.json`, and update `CHANGELOG.md`
2. Merge to `main` and push a tag `vX.Y.Z`: the `Publish` workflow validates, publishes to npm and to the MCP Registry
