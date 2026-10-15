ARG ATELIER_RUNTIME_IMAGE=ghcr.io/lucasmeijer/agents-in-the-cloud-docker@sha256:149efe3189255442091157921511b6c122b0254bb07e24d08d24408b4b79deda
FROM oven/bun:1.4.0 AS bun-dist

FROM ubuntu:26.04 AS deps
ARG DEBIAN_FRONTEND=noninteractive
COPY --from=bun-dist /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-dist /usr/local/bin/bunx /usr/local/bin/bunx
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates
WORKDIR /app

COPY . .

# Claude Code runs in workspaces; the Agent SDK's bundled platform binaries are never used here.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile \
    && rm -rf node_modules/.bun/@anthropic-ai+claude-agent-sdk-*

FROM deps AS build
RUN bun run --cwd apps/web build:client

FROM ${ATELIER_RUNTIME_IMAGE} AS runtime
ARG DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      git-lfs \
      gosu \
      libcap2-bin \
      openssh-client \
      sudo \
      socat \
      util-linux \
      tmux

COPY --from=bun-dist /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-dist /usr/local/bin/bunx /usr/local/bin/bunx
RUN setcap cap_net_bind_service=+ep /usr/local/bin/bun

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV ATELIER_NAMESPACE=default
ENV ATELIER_DATA_DIR=/data/app

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build --exclude=node_modules /app /app
RUN printf '%s\n' '#!/usr/bin/env sh' 'exec /usr/local/bin/bun /app/packages/proxy-ingress/src/ingress/tailscale-serve-helper.ts "$@"' > /usr/local/bin/agents-in-the-cloud-tailscale-serve-helper \
 && chmod 755 /usr/local/bin/agents-in-the-cloud-tailscale-serve-helper /app/apps/web/docker-entrypoint.sh

ARG ATELIER_COMMIT_ID
ARG ATELIER_DEFAULT_WORKSPACE_IMAGE
ARG ATELIER_EAGERLY_PRELOAD="[]"
ENV ATELIER_COMMIT_ID=${ATELIER_COMMIT_ID}
ARG ATELIER_SOURCE=https://github.com/lucasmeijer/atelier
LABEL org.opencontainers.image.source="${ATELIER_SOURCE}" \
      org.opencontainers.image.revision="${ATELIER_COMMIT_ID}" \
      eagerly-preload="${ATELIER_EAGERLY_PRELOAD}"
RUN printf '%s\n' "$ATELIER_DEFAULT_WORKSPACE_IMAGE" > /app/.agents-in-the-cloud-default-workspace-image

EXPOSE 3000

ENTRYPOINT ["/app/apps/web/docker-entrypoint.sh"]
CMD ["bun", "run", "apps/web/src/server/main.ts"]
