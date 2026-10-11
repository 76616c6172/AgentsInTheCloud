// Downstream release identity. App updates, System recovery, and release tooling
// must agree; upstream runtime/base images remain pinned by their own Dockerfiles.
export const distribution = {
  repository: "76616c6172/agents-in-the-cloud",
  source: "https://github.com/76616c6172/AgentsInTheCloud",
} as const;
export const appImage = `ghcr.io/${distribution.repository}`;
export const systemImage = `${appImage}-system`;
