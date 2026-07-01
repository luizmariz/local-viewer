# Changelog

All notable changes to **Local Viewer** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-01

### Added

- **Live tail** — detail panes now keep updating on the poll cycle **while open**:
  a selected Docker container's **logs** re-tail continuously (scroll stays pinned
  to the bottom while following, or holds your position if you scrolled up), and
  an open **Kafka topic** / **PGMQ queue** re-peeks its messages. SQS message
  peeks were already live. All follow the header's pause/interval control.
- **Version in Settings** — an **About** row shows the running `Local Viewer vX.Y.Z`
  (from `/api/version`), so it's easy to report which build you're on when debugging.

## [0.1.0] - 2026-06-30

First public release. A single self-hostable container that gives you a tiling
dashboard over your local/dev infrastructure.

### Added

- **Tiling dashboard** — drag views onto a recursive split layout; each panel
  keeps independent state; layouts auto-save and can be named/saved/restored.
- **AWS-compatible cloud viewer** across **multiple connections** at once:
  - **SQS** — queues aggregated per connection, depth counts (visible / in-flight /
    delayed), message peek, **purge**, and DLQ **redrive**; drag-to-reorder.
  - **S3** — buckets and objects with search + pagination; text/JSON **preview &
    edit**, **image preview**, **upload** (button + drag-and-drop), create text
    object, delete.
  - **CloudFormation** — changeset banner with one-click execute.
- **Kafka** — topics with partition/message counts and a message peek pane.
- **Postgres PGMQ** — queues with depth/total/oldest age and message peek.
- **Docker view** — containers with live **CPU & memory** workload bars,
  per-container **logs** and **environment variables**, multi-select **bulk
  start/stop/restart/delete**; images and volumes with "used by" and bulk delete.
- **Operations log** — live SSE stream with a real-world log **formatter**
  (strips ANSI colour codes; parses ISO/syslog/glog/Kafka formats; compact
  timestamp + level over a full-width message) and a **Raw ⇄ Formatted** toggle,
  expandable into a wide modal. Per-entry copy buttons.
- **Security** — optional 6-digit **PIN** lock (HMAC-hashed, encrypted at rest;
  constant-time check; signed httpOnly session cookie). All `/api/*` is gated
  when a PIN is set.
- **i18n** — English and Brazilian Portuguese.
- **Single container** — Go backend with an embedded buildless SPA (native ES
  modules + `lv-*` Web Components), SQLite storage, `CGO_ENABLED=0` distroless image.

[Unreleased]: https://github.com/luizmariz/local-viewer/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/luizmariz/local-viewer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/luizmariz/local-viewer/releases/tag/v0.1.0
