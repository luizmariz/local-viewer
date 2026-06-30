# AGENTS.md

Guidance for AI agents (and humans) working in this repo. Keep it lean and current.

## What this project is

**Local Viewer** is a self-hostable web UI you deploy as a **single Docker
container** (Portainer-style) to inspect your local/dev infrastructure in one
tiling dashboard:

- **AWS-compatible cloud viewer** — SQS, S3, CloudFormation — across **multiple
  connections** at once (LocalStack, Garage, MinIO, real AWS, any compatible
  endpoint).
- **Kafka** (topics + message peek) and **Postgres PGMQ** (queues + messages).
- A **lean Docker view** — containers (live cpu/mem, logs, env, bulk
  start/stop/restart/delete), images and volumes (with "used by").
- A live **operations log** with a real-world log **formatter** (raw ⇄ formatted).

It is a **Go backend** with an **embedded SPA** (no separate frontend build) and
**SQLite** storage; access is gated by an optional **6-digit PIN**.

## Layout

| Path | What |
|---|---|
| `src/main.go` | `package main`: HTTP server, route wiring, `//go:embed view`. Composition root. |
| `src/core/**` | Go backend packages: `auth` (PIN + signed-cookie sessions), `awsx` (S3/SQS/CFN), `dockerx` (Docker socket), `kafkax`, `pgmqx`, `store` (SQLite + encrypted connection store), `sse` (log stream). |
| `src/view/` | The SPA — buildless native ES modules + `lv-*` Web Components, served as-is by the Go embed. |
| `src/view/CONVENTIONS.md` | **Read this before touching the frontend.** |
| `example/` | LocalStack `docker-compose` + Node seed scripts for local testing. |
| `Dockerfile` | Multi-stage → distroless single-container image. |
| `.github/workflows/` | CI (build/test) + release (Docker image + cross-platform binaries). |

`go.mod` is at the repo root; the module path is `github.com/luizmariz/local-viewer`.
The `main` package is `./src` (it must sit *above* `view/` because `//go:embed`
cannot reference a sibling directory).

### Frontend module map (`src/view/`)

```
index.html          thin shell — loads /styles.css and /main.js (type=module)
styles.css          all CSS + :root design tokens
main.js             entry: wires modules + boot + the AWS poll loop
core/               util · i18n · icons · state · api · render (layout/lifecycle engine)
components/         lv-icon lv-button lv-input lv-checkbox lv-select lv-modal lv-toast tooltip · index.js
views/              shared · sqs · s3 · docker · providers · registry
features/           logs · cfbanner · auth · settings
```

## Non-negotiable rules

1. **Loading feedback on every server-backed action** — spinner / skeleton /
   busy-disabled button / inline "loading…". Never leave the UI dead in flight.
2. **Lean.** Build the 80% everyone uses; skip deep/rarely-used features.
3. **Incremental config.** Adding a connection never forces a global
   active-switch; configs accumulate and panels target what they need.
4. **One container to run.** No mandatory external services. SQLite is a file;
   the Docker view uses the mounted socket; cloud endpoints are user-supplied.
5. **CGO-free builds.** Pure-Go deps (e.g. `modernc.org/sqlite`) → image stays
   `CGO_ENABLED=0` + distroless.
6. **Never commit secrets.** PIN hashes and connection credentials are
   hashed/encrypted in SQLite, never in plaintext or the repo.

## Frontend conventions (essentials — full rules in `src/view/CONVENTIONS.md`)

- **Web Components first.** Use `lv-*` for buttons/icons/inputs/selects/modals/
  toasts; don't hand-roll inline buttons or SVGs. `<lv-button>` variants:
  `hdr · primary · ghost · danger · warn · icon · chip · chev · tab` (+ `size="sm"`).
  Add new icons to `core/icons.js`; render via `<lv-icon name="…">`.
- **No new inline `style=`** in app code — use classes + the `:root` tokens.
- **Fonts:** Ubuntu (UI), JetBrains Mono (**only** loaded payloads — logs,
  messages, object bodies, env), Heavy Data (the wordmark). Max font-size is **14px**
  (the wordmark is the one exception). Bundled under `src/view/fonts/`, embedded.
- **Render engine** (`core/render.js`): recursive split tree; each **panel owns
  independent state** (`vs`), preserved across rebuilds by leaf id (adding a pane
  never reloads the others). Views are injected via `registerViews()` so render
  never imports the views (acyclic). `update()` is hash-guarded to avoid flicker.
- **Decoupling via events:** `lv-conns` (connections changed), `lv-lang`
  (language), `lv-refresh` (post-action re-sweep). No cross-module import cycles.
- Custom **pointer-based** drag (not HTML5 DnD). Dark theme; per-view header tint.
- Tooltips: only on icon-only controls, shown **once** then never again.
  Narrow panels promote the detail pane to a full-panel overlay (CSS container query).

## Dev / verify

- **Run the app:** `go run ./src` → http://localhost:8080
  (env: `LSV_ADDR`, `LSV_DATA`, `LSV_DOCKER_HOST`, `LSV_PEEK`).
- **Example data:** `npm install && npm run example` (LocalStack + seed).
- **Frontend checks** (jsdom can't run `<script type=module>`, so import the
  module graph against jsdom globals — see `src/view/CONVENTIONS.md`):
  - `node --check` every `src/view/**/*.js` (they're ESM via `src/view/package.json`).
  - Boot harness mounts all views; component harness upgrades all `lv-*`.
  - Final visual pass in a real browser.
- **Go:** `go build ./... && go vet ./... && go test ./...`.

## Commit / PR / versioning

- Conventional, imperative commit messages (`feat:`, `fix:`, `docs:`, `chore:` …).
- **SemVer**, driven by git tags: pushing a tag `vX.Y.Z` triggers the release
  workflow (Docker image `:X.Y.Z` + `:latest`, and cross-platform binaries on the
  GitHub Release). `main` builds publish a `:edge` image. Keep `CHANGELOG.md` updated.
- Don't add new top-level modules/services without saying why.
- `server.js` (the old Node single-file prototype) has been removed — the app is
  the Go module; don't reintroduce it.
