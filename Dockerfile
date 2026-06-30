# Multi-stage build → tiny static image (deploy like Portainer: a single container).
# Builds on the native arch and cross-compiles to the target arch, so multi-arch
# (amd64/arm64) is fast and needs no QEMU for the Go build.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETOS TARGETARCH
ARG VERSION=dev
# main package lives in ./src (it embeds ./src/view); backend packages in src/core.
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath \
      -ldflags "-s -w -X main.Version=${VERSION}" \
      -o /out/local-viewer ./src

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/local-viewer /local-viewer
# The Docker view talks to the host Docker daemon — mount the socket at runtime:
#   docker run -p 8080:8080 -v /var/run/docker.sock:/var/run/docker.sock \
#     -v lv-data:/data ghcr-or-dockerhub/local-viewer
EXPOSE 8080
ENV LSV_ADDR=:8080 LSV_DATA=/data
VOLUME ["/data"]
ENTRYPOINT ["/local-viewer"]
