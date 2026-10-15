import { appRepository, githubRepository } from "./publishing.ts";

// Nox release tooling shares upstream's publishing identity. Runtime/base images
// remain pinned separately by their Dockerfiles.
export const distribution = {
  repository: appRepository.slice("ghcr.io/".length),
  source: `https://github.com/${githubRepository}`,
} as const;
export { appRepository as appImage, systemRepository as systemImage } from "./publishing.ts";
