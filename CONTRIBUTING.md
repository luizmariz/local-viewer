# Contributing to Local Viewer

Thanks for your interest! This is a small, focused project — the goal is a lean
single-container viewer, not a kitchen sink. PRs that keep it simple are gold.

## Ground rules

- **Lean by design.** Build the 80% people use; skip deep/rarely-used features.
- **One container.** No mandatory external services; `CGO_ENABLED=0`; SQLite is a file.
- **Loading feedback on every server-backed action** (spinner / disabled button / "loading…").
- **Never commit secrets.** PIN hashes and credentials are hashed/encrypted at rest.

Read **[AGENTS.md](AGENTS.md)** for architecture and the full conventions, and
**[src/view/CONVENTIONS.md](src/view/CONVENTIONS.md)** before touching the frontend.

## Project layout

```
src/main.go      Go server + route wiring + //go:embed view
src/core/**      backend packages: auth awsx dockerx kafkax pgmqx store sse
src/view/**      the SPA — buildless ES modules + lv-* Web Components (no build step)
example/         LocalStack compose + seed scripts for local testing
```

Module path: `github.com/luizmariz/local-viewer`. The `main` package is `./src`.

## Dev setup

```bash
go run ./src                 # http://localhost:8080
npm install && npm run example   # optional: LocalStack + seed data to test against
```

Frontend is **buildless** — edit `src/view/**` and refresh; no bundler/Node build.

## Before you open a PR

```bash
go build ./... && go vet ./... && go test ./...
node --check src/view/**/*.js     # frontend modules are ESM
```

For frontend behaviour, drive the module graph against jsdom globals (jsdom
can't execute `<script type=module>`) — see the harness pattern in
`src/view/CONVENTIONS.md`. Do a final visual pass in a real browser.

## Commits & versioning

- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `ci:` …
- **SemVer** via git tags. Maintainers cut a release by tagging `vX.Y.Z`, which
  triggers CI to publish the Docker image and release binaries. Update
  `CHANGELOG.md` under `[Unreleased]` in your PR.

## Reporting bugs / ideas

Open a GitHub issue with steps to reproduce (and the backend you were pointing
at — LocalStack, Garage, real AWS, etc.). Keep feature requests aligned with the
"lean" goal.
