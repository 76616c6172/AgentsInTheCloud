# syntax=docker/dockerfile:1
# Shared base for workspace and service daemons. Neither AgentsInTheCloud nor workspace
# policy belongs here. Build from this directory with ./build.sh --load.
FROM docker:29.9.2-dind@sha256:9e79b879b177fbd72c34376a3dd3d91747da5db49e1f560f76aea59561471977 AS docker-tools
FROM ubuntu:26.04 AS ubuntu

# Compile natively, including CGO/seccomp, even when targeting the other CPU.
FROM --platform=$BUILDPLATFORM golang:1.27.3@sha256:b76020929b709ddb6202afc05410a0faefae20ae05e27ad548b3870092688a69 AS build
ARG TARGETARCH
RUN dpkg --add-architecture "$TARGETARCH" \
    && apt-get update && apt-get install -y --no-install-recommends \
      libseccomp-dev libseccomp-dev:${TARGETARCH} libc6-dev:${TARGETARCH} pkg-config \
      gcc-aarch64-linux-gnu gcc-x86-64-linux-gnu \
    && rm -rf /var/lib/apt/lists/*
# Docker v29.9.2 (tag commit): pin the source, then apply both reviewable patches.
ADD --checksum=sha256:80c3d6f0cdc01d97be093563a9457c281f23f53ba4f36f5e49d9558322ea13cd \
    https://codeload.github.com/moby/moby/tar.gz/0367cbeb49b9d98cb0b4f51e95f7b54b4803e76c /tmp/moby.tar.gz
WORKDIR /src
RUN tar xzf /tmp/moby.tar.gz --strip-components=1 && rm /tmp/moby.tar.gz
COPY patches/ /patches/
RUN git apply /patches/0001-moby-mount-manager.patch \
    && git apply /patches/0002-buildkit-erofs.patch \
    && git apply /patches/0007-buildkit-erofs-cache-staging.patch
RUN --mount=type=cache,id=patched-docker-go-${TARGETARCH},target=/root/.cache/go-build \
    /usr/local/go/bin/go test -mod=vendor \
      github.com/moby/buildkit/snapshot \
      github.com/moby/buildkit/exporter/containerimage \
      -run 'TestManagedMount|TestFetchOnly' -count=1 \
    && case "$TARGETARCH" in \
         arm64) compiler=aarch64-linux-gnu ;; \
         amd64) compiler=x86_64-linux-gnu ;; \
         *) exit 1 ;; \
       esac \
    && CGO_ENABLED=1 GOOS=linux GOARCH="$TARGETARCH" CC="${compiler}-gcc" \
      PKG_CONFIG_LIBDIR="/usr/lib/${compiler}/pkgconfig" \
      /usr/local/go/bin/go build -mod=vendor -trimpath \
      -tags 'seccomp exclude_graphdriver_btrfs' \
      -ldflags '-X github.com/moby/moby/v2/dockerversion.Version=29.9.2-agents-in-the-cloud-erofs -X github.com/moby/moby/v2/dockerversion.GitCommit=0367cbe+agents-in-the-cloud-erofs' \
      -o /out/dockerd ./cmd/dockerd \
    && /usr/local/go/bin/go version -m /out/dockerd > /out/build-info.txt

# The transfer helper uses the same containerd release as the runtime below.
FROM --platform=$BUILDPLATFORM golang:1.27.3@sha256:b76020929b709ddb6202afc05410a0faefae20ae05e27ad548b3870092688a69 AS image-transfer
WORKDIR /src
COPY image-transfer/go.mod image-transfer/go.sum ./
RUN GOTOOLCHAIN=go1.27.3 go mod download
COPY image-transfer/*.go ./
ARG TARGETARCH
RUN --mount=type=cache,id=agents-in-the-cloud-image-transfer-go,target=/root/.cache/go-build \
    GOTOOLCHAIN=go1.27.3 go test ./... \
    && GOTOOLCHAIN=go1.27.3 CGO_ENABLED=0 GOOS=linux GOARCH="$TARGETARCH" go build -trimpath -o /out/agents-in-the-cloud-image-transfer .

# Patch ctr cache leases and the daemon's empty-mount EROFS differ dispatch.
# Keep the shims from the matching upstream release.
FROM --platform=$BUILDPLATFORM golang:1.27.3@sha256:b76020929b709ddb6202afc05410a0faefae20ae05e27ad548b3870092688a69 AS containerd-patched
ADD --checksum=sha256:e38df0eeb40d2304f3450edb148aee838cb0a57f3976a47c78870f92c80f1796 \
    https://codeload.github.com/containerd/containerd/tar.gz/b7a25261e029d68978bbf290df0a62fc819b3c51 /tmp/containerd.tar.gz
WORKDIR /src
RUN tar xzf /tmp/containerd.tar.gz --strip-components=1 && rm /tmp/containerd.tar.gz
COPY patches/0003-containerd-erofs-cache-lease.patch /tmp/lease.patch
COPY patches/0004-containerd-erofs-empty-mounts.patch /tmp/empty-mounts.patch
COPY patches/0005-containerd-erofs-cache-reuse.patch /tmp/cache-reuse.patch
COPY patches/0006-containerd-loop-device-node.patch /tmp/loop-device-node.patch
RUN git apply /tmp/lease.patch /tmp/empty-mounts.patch /tmp/cache-reuse.patch /tmp/loop-device-node.patch
ARG TARGETARCH
RUN --mount=type=cache,id=agents-in-the-cloud-ctr-go,target=/root/.cache/go-build \
    GOTOOLCHAIN=go1.27.3 go test -mod=vendor ./internal/erofsutils \
    && GOTOOLCHAIN=go1.27.3 CGO_ENABLED=0 GOOS=linux GOARCH="$TARGETARCH" go build -mod=vendor -trimpath \
      -ldflags '-X github.com/containerd/containerd/v2/version.Version=v2.4.2-agents-in-the-cloud -X github.com/containerd/containerd/v2/version.Revision=b7a25261e029d68978bbf290df0a62fc819b3c51+cache-lease+mount-root+cache-reuse+loop-node' \
      -o /out/ ./cmd/ctr ./cmd/containerd

FROM --platform=$BUILDPLATFORM ubuntu:26.04 AS containerd
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
COPY containerd.sha256 /tmp/containerd.sha256
RUN cd /tmp \
    && curl -fSL -o containerd-2.4.2-linux-${TARGETARCH}.tar.gz \
      https://github.com/containerd/containerd/releases/download/v2.4.2/containerd-2.4.2-linux-${TARGETARCH}.tar.gz \
    && grep " containerd-2.4.2-linux-${TARGETARCH}.tar.gz$" containerd.sha256 | sha256sum -c - \
    && mkdir /out && tar xzf containerd-2.4.2-linux-${TARGETARCH}.tar.gz -C /out

FROM ubuntu AS runtime
LABEL org.opencontainers.image.source="https://github.com/lucasmeijer/atelier" \
      org.opencontainers.image.title="AgentsInTheCloud Docker runtime" \
      org.opencontainers.image.description="Ubuntu-based Docker runtime with patched embedded BuildKit and containerd EROFS shared-cache support."
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates erofs-utils iproute2 iptables libseccomp2 tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/erofs-cache /data/docker /data/containerd /etc/docker /etc/containerd
COPY --from=docker-tools /usr/local/bin/docker /usr/local/bin/docker-init /usr/local/bin/docker-proxy /usr/local/bin/runc /usr/local/bin/
COPY --from=docker-tools /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
COPY --from=containerd /out/bin/ /usr/local/bin/
COPY --from=containerd-patched /out/ /usr/local/bin/
COPY --from=build /out/dockerd /usr/local/bin/dockerd
COPY --from=image-transfer /out/agents-in-the-cloud-image-transfer /usr/local/bin/agents-in-the-cloud-image-transfer
COPY --from=build /src/LICENSE /src/NOTICE /usr/share/agents-in-the-cloud-patched-docker/
COPY --from=build /out/build-info.txt /usr/share/agents-in-the-cloud-patched-docker/build-info.txt
COPY patches/ /usr/share/agents-in-the-cloud-patched-docker/patches/
COPY containerd.toml /etc/containerd/config.toml
COPY daemon.json /etc/docker/daemon.json
COPY --chmod=755 entrypoint.sh /usr/local/bin/agents-in-the-cloud-dockerd
# Both daemon stores live under this one explicitly mounted volume. No VOLUME
# instruction: derived images choose their storage and do not inherit anonymous volumes.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/agents-in-the-cloud-dockerd"]
CMD ["dockerd"]
