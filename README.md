<div align="center">

# Local Viewer

**One container. One dashboard for all your local & dev infrastructure.**

A self-hostable web UI — deploy it like Portainer (a single Docker container) —
that puts your AWS-compatible services, Kafka, Postgres PGMQ, and Docker into one
tiling dashboard.

[![CI](https://github.com/luizmariz/local-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/luizmariz/local-viewer/actions/workflows/ci.yml)
[![Release](https://github.com/luizmariz/local-viewer/actions/workflows/release.yml/badge.svg)](https://github.com/luizmariz/local-viewer/actions/workflows/release.yml)
[![Docker Hub](https://img.shields.io/docker/pulls/luizipsum/local-viewer)](https://hub.docker.com/r/luizipsum/local-viewer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

<img width="3824" height="1907" alt="image" src="https://github.com/user-attachments/assets/ea1f1c6a-0101-45f3-bbc8-1f2b8c08795c" />

## Why

When you develop against LocalStack, Garage, MinIO, a Kafka broker, a Postgres
PGMQ, and a pile of Docker containers, you end up juggling the AWS CLI, three web
consoles, `docker logs`, and a SQL client. **Local Viewer** is one small,
self-hosted app that shows all of it in a draggable, tiling dashboard — no cloud
account, no telemetry, no build step.

It is **not** a production cloud console. It's the lightweight cockpit for your
*local* and *dev* stacks.

## Features

- 🧩 **Tiling dashboard** — drag views into split panels; each panel keeps its own
  state; name and save layouts.
- ☁️ **AWS-compatible, multi-connection** — point at LocalStack, Garage, MinIO,
  real AWS, anything compatible, all at once:
  - **SQS** — depths (visible / in-flight / delayed), peek, **purge**, DLQ **redrive**.
  - **S3** — buckets → objects (search + pagination), text/JSON **preview & edit**,
    **image preview**, **upload** (button + drag-and-drop), create, delete.
  - **CloudFormation** — changeset banner you can execute.
- 🔢 **Kafka** topics + message peek, and **Postgres PGMQ** queues + message peek.
- 🐳 **Docker** — containers with live **CPU/memory** bars, **logs**, **env**, and
  bulk start/stop/restart/delete; images & volumes with "used by".
- 📜 **Operations log** with a real-world **log formatter** (strips ANSI, parses
  ISO/syslog/glog/Kafka), raw ⇄ formatted toggle, copy per line.
- 🔒 Optional **6-digit PIN** lock (hashed + encrypted at rest).
- 🌐 English & Português (Brasil).
- 📦 **Single container** — Go backend with an embedded buildless SPA, SQLite,
  `CGO_ENABLED=0` distroless image (~tens of MB).

## Quick start (Docker — recommended)

```bash
docker run -d --name local-viewer \
  -p 8080:8080 \
  -v /var/run/docker.sock:/var/run/docker.sock \   # enables the Docker view
  -v local-viewer-data:/data \                      # persists connections + PIN
  luizipsum/local-viewer:latest
```

Open <http://localhost:8080>. Use **Views** (top-left) to drag panels into a
layout, the **gear** to add connections / set a PIN, and **Logs** for the live
operations log.

> The `-v docker.sock` mount is optional — only the Docker view needs it.
> Everything is stored in the `/data` volume (a single SQLite file).

### docker-compose

```yaml
services:
  local-viewer:
    image: luizipsum/local-viewer:latest
    ports: ["8080:8080"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - local-viewer-data:/data
    restart: unless-stopped
volumes:
  local-viewer-data:
```

## Install options

| Method | How |
|---|---|
| **Docker** (recommended) | `docker run … luizipsum/local-viewer:latest` (above). |
| **Prebuilt binary** | Download for your OS/arch from the [latest release](https://github.com/luizmariz/local-viewer/releases/latest) (Linux/macOS/Windows · amd64/arm64), then run `./local-viewer`. |
| **From source** | See [Build from source](#build-from-source). |

The binary is self-contained (the SPA is embedded). It writes a SQLite file to
`./data` by default.

## Configuration

All optional — configure connections in the UI; tweak the runtime via env vars:

| Env | Default | Purpose |
|---|---|---|
| `LSV_ADDR` | `:8080` | Listen address. |
| `LSV_DATA` | `data` (`/data` in Docker) | Directory for the SQLite DB. |
| `LSV_DOCKER_HOST` | `/var/run/docker.sock` | Docker socket/endpoint for the Docker view. |
| `LSV_PEEK` | `5` | How many messages to peek per queue/topic. |

Connections (AWS endpoints, Kafka brokers, PGMQ DSNs) are added in **Settings →
Connections** and stored encrypted. Set a PIN in **Settings → Security** to lock
the instance.

## Try it with example backends

```bash
npm install
npm run example                                            # LocalStack (S3/SQS/CFN) + seed data
docker compose -f example/docker-compose.extras.yml up -d  # Kafka + Postgres PGMQ
```

Then add a connection per backend in **Settings → Connections** (e.g. Kafka
`localhost:9092`, PGMQ `postgres://postgres:postgres@localhost:5433/postgres`).

> The example pins LocalStack's free community image; `latest` may require a license.

## Build from source

Requires **Go ≥ 1.26** (and Docker for the container image). The frontend is
buildless — no Node toolchain needed to build the app.

```bash
git clone https://github.com/luizmariz/local-viewer.git
cd local-viewer

go run ./src                       # dev: http://localhost:8080
go build -o local-viewer ./src     # release binary (SPA embedded)

docker build -t local-viewer .     # container image
```

## Contributing

Contributions welcome! Start with **[CONTRIBUTING.md](CONTRIBUTING.md)** and
**[AGENTS.md](AGENTS.md)** (architecture + conventions). In short:

- Backend = Go in `src/`; frontend = buildless ES modules + `lv-*` Web Components
  in `src/view/` (see `src/view/CONVENTIONS.md`).
- Verify before pushing: `go build ./... && go vet ./... && go test ./...` and
  `node --check src/view/**/*.js`.
- Conventional commits; SemVer via git tags.

## Versioning & releases

[Semantic Versioning](https://semver.org). Tagging `vX.Y.Z` triggers a release:
a multi-arch Docker image (`:X.Y.Z` + `:latest`) on Docker Hub, plus
cross-platform binaries attached to the GitHub Release. See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © Luiz Mariz
